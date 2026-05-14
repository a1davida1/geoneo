/**
 * AI call queue. Persistent JSON store of every call we've enqueued for
 * the AI dialer + every call's terminal state. Atomic writes (temp + rename)
 * with optimistic-retry so concurrent enqueue/dispatch/complete don't race.
 *
 * Call lifecycle states:
 *   queued       — created, not dispatched yet
 *   dialing      — sent to provider, waiting on first webhook event
 *   in_progress  — call connected, customer talking
 *   completed    — call ended, outcome known
 *   no_answer    — provider reports no pickup
 *   voicemail    — left a voicemail
 *   failed       — provider error or call abnormally ended
 *   cancelled    — operator cancelled before dial
 *
 * Each call carries a frozen snapshot of the lead + script at enqueue
 * time. That way even if the lead's audit data changes later, the AI
 * dialer reads the script that was built for the original moment.
 *
 * Idempotency: enqueue keys default to `{domain}:{YYYY-MM-DD}` so two
 * accidental enqueues for the same domain on the same day are deduped.
 *
 * Storage: data/ai-call-queue.json (single file; sufficient for thousands
 * of calls). When this scales beyond ~10k entries, swap for SQLite or
 * Postgres — same interface, drop-in replacement.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'ai-call-queue.json');
const MAX_RETENTION = 5000;
const MAX_WRITE_ATTEMPTS = 12;

const VALID_STATES = new Set([
  'queued', 'dialing', 'in_progress', 'completed',
  'no_answer', 'voicemail', 'failed', 'cancelled'
]);

const VALID_OUTCOMES = new Set([
  'closed_won',          // AI closed the deal solo
  'callback_requested',  // customer wants a future call
  'booked_meeting',      // AI booked a human follow-up
  'transferred_human',   // live-transferred to a human closer
  'no_interest',         // hard no, mark lost
  'do_not_call',         // suppress
  'wrong_number',        // bad data, suppress
  'voicemail',           // left voicemail
  'no_answer',           // never picked up
  'call_failed'          // provider error
]);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function newCallId() {
  return `call_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

async function loadQueue() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    if (!raw.trim()) return { calls: [] };
    const parsed = JSON.parse(raw);
    return { calls: Array.isArray(parsed.calls) ? parsed.calls : [] };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { calls: [] };
    throw err;
  }
}

async function saveQueue(queue) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(queue, null, 2), 'utf8');
  await fs.rename(tmp, FILE);
}

/**
 * Optimistic retry helper — load → mutate → save. Retries on write
 * conflict (handles concurrent writers within a process; for cross-process
 * a real lock is needed, but with a single Node process we're fine).
 */
async function withQueue(mutator) {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    try {
      const queue = await loadQueue();
      const result = mutator(queue);
      await saveQueue(queue);
      return result;
    } catch (err) {
      lastErr = err;
      await sleep(8 + Math.floor(Math.random() * 40));
    }
  }
  throw new Error('queue_write_conflict: ' + (lastErr && lastErr.message));
}

/**
 * Enqueue a new call. The script object is frozen into the queue entry
 * so future audit changes don't affect the call mid-flight. Returns
 * { call, isDuplicate }.
 */
async function enqueueCall({ lead, script, priceVariant, idempotencyKey, scheduledAt = null, priority = 'normal', consentOverride = false } = {}) {
  if (!lead || !lead.domain) throw new Error('lead with .domain required');
  if (!script) throw new Error('script required');
  // CONSENT GATE: TCPA "express written consent" required before we dial.
  // Override exists for admin "I have docs / call request came via SMS / they
  // walked into the office" cases — must be explicit.
  if (!consentOverride) {
    const callConsent = require('./callConsent');
    const consented = await callConsent.hasValidConsent(lead.domain);
    if (!consented) {
      throw new Error('no_consent: domain has no documented call consent on file. Use consentOverride if you have offline consent docs.');
    }
  }
  const key = idempotencyKey || `${lead.domain}:${new Date().toISOString().slice(0, 10)}`;
  return withQueue((queue) => {
    const existing = queue.calls.find((c) => c.idempotencyKey === key);
    if (existing) return { call: existing, isDuplicate: true };
    const call = {
      id: newCallId(),
      idempotencyKey: key,
      domain: lead.domain,
      businessName: lead.businessName || lead.domain,
      contactPhone: lead.contactInfo?.primaryPhone || lead.contactPhone || null,
      contactEmail: lead.contactInfo?.primaryEmail || null,
      industry: lead.industry,
      city: lead.city,
      state: lead.state,
      priceVariant,
      priority,
      consentOverride: Boolean(consentOverride),
      consentSource: script.consentSource || null,
      scheduledAt,
      enqueuedAt: new Date().toISOString(),
      dispatchedAt: null,
      startedAt: null,
      completedAt: null,
      durationSec: null,
      state: 'queued',
      outcome: null,
      provider: null,
      providerCallId: null,
      providerCost: null,
      transcript: null,
      transcriptUrl: null,
      summary: null,
      aiSentiment: null,
      attempts: 0,
      lastError: null,
      // Snapshot — the script + lead frozen at enqueue time
      scriptSnapshot: script,
      // Routing metadata, populated post-call by aiCallRouter
      routedTo: null,
      humanQueueId: null
    };
    queue.calls.unshift(call);
    if (queue.calls.length > MAX_RETENTION) queue.calls = queue.calls.slice(0, MAX_RETENTION);
    return { call, isDuplicate: false };
  });
}

/**
 * Pick the next batch of calls ready to dial right now. Filters:
 *   - state = queued
 *   - scheduledAt is null OR <= now
 *
 * Sort: priority (high → low), then enqueuedAt asc (FIFO).
 */
async function nextBatch({ limit = 10 } = {}) {
  const queue = await loadQueue();
  const now = Date.now();
  const ready = queue.calls.filter((c) => {
    if (c.state !== 'queued') return false;
    if (c.scheduledAt && new Date(c.scheduledAt).getTime() > now) return false;
    return true;
  });
  const priorityRank = { high: 3, normal: 2, low: 1 };
  ready.sort((a, b) => {
    const pa = priorityRank[a.priority] || 2;
    const pb = priorityRank[b.priority] || 2;
    if (pa !== pb) return pb - pa;
    return new Date(a.enqueuedAt) - new Date(b.enqueuedAt);
  });
  return ready.slice(0, limit);
}

async function getCall(callId) {
  const queue = await loadQueue();
  return queue.calls.find((c) => c.id === callId) || null;
}

async function getCallByProviderId(provider, providerCallId) {
  if (!provider || !providerCallId) return null;
  const queue = await loadQueue();
  return queue.calls.find((c) => c.provider === provider && c.providerCallId === providerCallId) || null;
}

/**
 * Generic patch — caller must provide a valid state if changing it.
 * Returns the updated call or null if not found.
 */
async function patchCall(callId, patch) {
  return withQueue((queue) => {
    const idx = queue.calls.findIndex((c) => c.id === callId);
    if (idx === -1) return null;
    if (patch.state && !VALID_STATES.has(patch.state)) throw new Error(`invalid state: ${patch.state}`);
    if (patch.outcome && !VALID_OUTCOMES.has(patch.outcome)) throw new Error(`invalid outcome: ${patch.outcome}`);
    queue.calls[idx] = { ...queue.calls[idx], ...patch };
    return queue.calls[idx];
  });
}

/**
 * Mark dispatched — provider has accepted the call.
 */
async function markDispatched(callId, { provider, providerCallId }) {
  return patchCall(callId, {
    state: 'dialing',
    provider,
    providerCallId,
    dispatchedAt: new Date().toISOString(),
    attempts: ((await getCall(callId))?.attempts || 0) + 1
  });
}

/**
 * Mark completed with full outcome data. Triggers post-call routing
 * (caller's responsibility — this just stores).
 */
async function markCompleted(callId, {
  state = 'completed', outcome, transcript = null, transcriptUrl = null,
  summary = null, durationSec = null, providerCost = null, aiSentiment = null
} = {}) {
  return patchCall(callId, {
    state,
    outcome,
    transcript,
    transcriptUrl,
    summary,
    durationSec,
    providerCost,
    aiSentiment,
    completedAt: new Date().toISOString()
  });
}

async function markFailed(callId, error) {
  return patchCall(callId, {
    state: 'failed',
    lastError: String(error || 'unknown_error').slice(0, 500),
    completedAt: new Date().toISOString()
  });
}

async function cancelCall(callId, reason = 'admin_cancelled') {
  return patchCall(callId, {
    state: 'cancelled',
    lastError: reason,
    completedAt: new Date().toISOString()
  });
}

/**
 * Aggregate stats for the admin overview panel.
 */
async function getStats() {
  const queue = await loadQueue();
  const stats = {
    total: queue.calls.length,
    byState: {},
    byOutcome: {},
    queuedNow: 0,
    inProgress: 0,
    last24h: 0,
    last7d: 0,
    last24hCost: 0
  };
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const c of queue.calls) {
    stats.byState[c.state] = (stats.byState[c.state] || 0) + 1;
    if (c.outcome) stats.byOutcome[c.outcome] = (stats.byOutcome[c.outcome] || 0) + 1;
    if (c.state === 'queued') stats.queuedNow++;
    if (c.state === 'in_progress' || c.state === 'dialing') stats.inProgress++;
    const enq = new Date(c.enqueuedAt).getTime();
    if (enq > dayAgo) stats.last24h++;
    if (enq > weekAgo) stats.last7d++;
    if (c.providerCost && enq > dayAgo) stats.last24hCost += Number(c.providerCost) || 0;
  }
  return stats;
}

/**
 * List recent calls for the admin panel; supports basic filters.
 */
async function listCalls({ state = null, outcome = null, domain = null, limit = 50 } = {}) {
  const queue = await loadQueue();
  let filtered = queue.calls;
  if (state) filtered = filtered.filter((c) => c.state === state);
  if (outcome) filtered = filtered.filter((c) => c.outcome === outcome);
  if (domain) filtered = filtered.filter((c) => c.domain === domain);
  return filtered.slice(0, Math.max(1, Math.min(500, limit)));
}

module.exports = {
  enqueueCall,
  nextBatch,
  getCall,
  getCallByProviderId,
  patchCall,
  markDispatched,
  markCompleted,
  markFailed,
  cancelCall,
  getStats,
  listCalls,
  VALID_STATES,
  VALID_OUTCOMES,
  FILE
};
