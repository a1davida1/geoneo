/**
 * Human call queue. The "Your Queue" view for Dave + Matt — every lead
 * the AI dialer routed to a human (booked meeting, callback, transferred
 * live, top-decile direct).
 *
 * Each entry carries a one-screen pre-call brief so the human can pick
 * up the call cold:
 *   - Who: business name, contact, phone, location, industry
 *   - Why hot: AI summary, qualifier answers, top findings, dollar opp
 *   - What to ask: 3-5 talking points generated from the audit
 *   - What to close: recommended tier + ROI math
 *
 * States: queued → in_progress → completed | rescheduled | no_show
 *
 * Storage: data/human-call-queue.json with atomic writes.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'human-call-queue.json');
const MAX_RETENTION = 1000;
const MAX_WRITE_ATTEMPTS = 12;

const VALID_STATES = new Set(['queued', 'in_progress', 'completed', 'rescheduled', 'no_show', 'cancelled']);
const VALID_OUTCOMES = new Set(['won', 'lost', 'rescheduled', 'no_show', 'needs_follow_up']);

function newId() {
  return `hq_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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
 * Build the talking points + recommended close for the pre-call brief.
 */
function buildBrief(leadSnapshot, reason, aiSummary) {
  const audit = leadSnapshot?.audit || {};
  const top = (audit.findings || audit.topFiveFindings || []).slice(0, 3);
  const opp = audit.dollarOpportunity?.monthly || {};
  const qualifier = leadSnapshot?.qualifier;
  const tier = qualifier?.recommendedTier || (opp.high >= 3000 ? 'smart_spend' : 'visibility_129');
  const talkingPoints = [
    opp.high ? `Lead with the dollar number: "$${opp.low?.toLocaleString()}-$${opp.high?.toLocaleString()}/mo in missed local search."` : 'Lead with the audit score and top finding.',
    top[0] ? `Reference top finding: "${top[0].title}"` : null,
    qualifier?.bucket ? `Qualifier already pegged them as: ${qualifier.bucket} (${qualifier.persona || 'unknown persona'})` : 'No qualifier completed — confirm budget + timeline first.',
    aiSummary ? `AI's read: ${aiSummary.slice(0, 200)}` : null,
    `Recommended ask: ${tier === 'smart_spend' ? '$499/mo Smart Spend' : (tier.startsWith('white_glove') ? '$800-$1500/mo White Glove' : '$129-$199/mo')}`
  ].filter(Boolean);
  return { talkingPoints, recommendedTier: tier };
}

/**
 * Enqueue a new entry to the human queue.
 */
async function enqueue({ fromAiCallId, domain, businessName, contactPhone, contactEmail, industry, city, state, priority = 'p3', assignedTo = null, reason, aiCallSummary, priceVariant, leadSnapshot }) {
  if (!domain) throw new Error('domain required');
  return withQueue((queue) => {
    const brief = buildBrief(leadSnapshot, reason, aiCallSummary);
    const entry = {
      id: newId(),
      fromAiCallId: fromAiCallId || null,
      domain,
      businessName: businessName || domain,
      contactPhone: contactPhone || null,
      contactEmail: contactEmail || null,
      industry: industry || null,
      city: city || null,
      state: state || null,
      priority, // p1 (top decile) | p2 | p3 | p4
      assignedTo, // 'dave' | 'matt' | null (unassigned)
      reason, // 'booked_meeting' | 'callback_requested' | 'transferred_human'
      aiCallSummary: aiCallSummary || null,
      priceVariant: priceVariant || null,
      enqueuedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      state: 'queued',
      outcome: null,
      brief,
      notes: []
    };
    queue.calls.unshift(entry);
    if (queue.calls.length > MAX_RETENTION) queue.calls = queue.calls.slice(0, MAX_RETENTION);
    return entry;
  });
}

async function listQueue({ assignedTo = null, state = null, priority = null, limit = 100 } = {}) {
  const queue = await loadQueue();
  let filtered = queue.calls;
  if (assignedTo) filtered = filtered.filter((c) => c.assignedTo === assignedTo);
  if (state) filtered = filtered.filter((c) => c.state === state);
  if (priority) filtered = filtered.filter((c) => c.priority === priority);
  // Sort: p1 first, then enqueuedAt desc (newest first within priority)
  const priorityRank = { p1: 4, p2: 3, p3: 2, p4: 1 };
  filtered.sort((a, b) => {
    const pa = priorityRank[a.priority] || 0;
    const pb = priorityRank[b.priority] || 0;
    if (pa !== pb) return pb - pa;
    return new Date(b.enqueuedAt) - new Date(a.enqueuedAt);
  });
  return filtered.slice(0, Math.max(1, Math.min(500, limit)));
}

async function getEntry(id) {
  const queue = await loadQueue();
  return queue.calls.find((c) => c.id === id) || null;
}

async function patchEntry(id, patch) {
  return withQueue((queue) => {
    const idx = queue.calls.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    if (patch.state && !VALID_STATES.has(patch.state)) throw new Error(`invalid state: ${patch.state}`);
    if (patch.outcome && !VALID_OUTCOMES.has(patch.outcome)) throw new Error(`invalid outcome: ${patch.outcome}`);
    queue.calls[idx] = { ...queue.calls[idx], ...patch };
    return queue.calls[idx];
  });
}

async function assignTo(id, who) {
  return patchEntry(id, { assignedTo: who });
}

async function markStarted(id) {
  return patchEntry(id, { state: 'in_progress', startedAt: new Date().toISOString() });
}

async function markCompleted(id, { outcome, note = null } = {}) {
  return withQueue((queue) => {
    const idx = queue.calls.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    if (outcome && !VALID_OUTCOMES.has(outcome)) throw new Error(`invalid outcome: ${outcome}`);
    queue.calls[idx].state = outcome === 'rescheduled' ? 'rescheduled' : (outcome === 'no_show' ? 'no_show' : 'completed');
    queue.calls[idx].outcome = outcome;
    queue.calls[idx].completedAt = new Date().toISOString();
    if (note) {
      queue.calls[idx].notes = queue.calls[idx].notes || [];
      queue.calls[idx].notes.push({ at: new Date().toISOString(), text: String(note).slice(0, 4000) });
    }
    return queue.calls[idx];
  });
}

async function addNote(id, text) {
  return withQueue((queue) => {
    const idx = queue.calls.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    queue.calls[idx].notes = queue.calls[idx].notes || [];
    queue.calls[idx].notes.push({ at: new Date().toISOString(), text: String(text).slice(0, 4000) });
    return queue.calls[idx];
  });
}

async function getStats() {
  const queue = await loadQueue();
  const out = { total: queue.calls.length, byState: {}, byOutcome: {}, byAssignee: {}, p1Open: 0 };
  for (const c of queue.calls) {
    out.byState[c.state] = (out.byState[c.state] || 0) + 1;
    if (c.outcome) out.byOutcome[c.outcome] = (out.byOutcome[c.outcome] || 0) + 1;
    if (c.assignedTo) out.byAssignee[c.assignedTo] = (out.byAssignee[c.assignedTo] || 0) + 1;
    if (c.priority === 'p1' && (c.state === 'queued' || c.state === 'in_progress')) out.p1Open++;
  }
  return out;
}

module.exports = {
  enqueue,
  listQueue,
  getEntry,
  patchEntry,
  assignTo,
  markStarted,
  markCompleted,
  addNote,
  getStats,
  buildBrief,
  VALID_STATES,
  VALID_OUTCOMES,
  FILE
};
