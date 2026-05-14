/**
 * Outbox Sender — drains the email outbox queue every TICK_MS.
 *
 * Drives the actual email delivery for everything we queue (audit blasts,
 * Fix-Plan delivery on purchase, drip-campaign follow-ups, qualifier follow-ups).
 *
 * Send paths:
 *   - RESEND_API_KEY set → real send via Resend HTTPS API
 *   - else → stub-log to console + mark `state=sent_stub` so you can prove the
 *     pipeline works locally without burning real sends
 *
 * Backoff schedule for transient failures (5xx, 429, network, timeout):
 *   attempts=1  → wait 60s
 *   attempts=2  → wait 5min
 *   attempts=3  → wait 30min
 *   attempts=4  → wait 2h
 *   attempts=5  → wait 12h
 *   attempts>5  → state=failed (no more retries)
 *
 * Permanent failures (4xx other than 429, missing recipient) → state=failed
 * immediately, never retried.
 *
 * Per-tick safety:
 *   - Caps at MAX_PER_TICK sends (50) so a backlog doesn't burst against the
 *     provider rate limit
 *   - Caps at HOURLY_SEND_CAP per hour (configurable via env) so domain
 *     reputation doesn't take a hit if the queue suddenly grows
 *   - Skips entries whose nextAttemptAt is in the future
 *
 * Bookkeeping marks (idempotent — re-runs of the same idempotencyKey are a noop):
 *   - state: queued → sending → sent | retrying | failed | sent_stub
 *   - attempts: incremented on every attempt
 *   - lastAttemptAt, providerMessageId, lastError
 *
 * Hooks back into auditArchive.recordEmailSent on each successful send so the
 * Lead Pipeline / Email Blast filters see an accurate "last emailed" mark.
 */

const cron = require('node-cron');
const outbox = require('./emailOutbox');
const archive = require('./auditArchive');

const TICK_MS = Number(process.env.OUTBOX_TICK_MS) || 60 * 1000;
const MAX_PER_TICK = Number(process.env.OUTBOX_MAX_PER_TICK) || 50;
// Hourly cap is mutable at runtime via setHourlyCap() so admins can throttle
// without restarting the process. Initial value comes from env (or default).
let HOURLY_SEND_CAP = Number(process.env.OUTBOX_HOURLY_CAP) || 200;
const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM_NAME = process.env.GEONEO_FROM_NAME || 'GeoNeo Audit Team';
const FROM_EMAIL = process.env.GEONEO_FROM_EMAIL || 'audit@geoneo.ai';
const REPLY_TO = process.env.GEONEO_REPLY_TO || FROM_EMAIL;

let running = false;
let tickInterval = null;
let cronTask = null;
const sendTimestamps = []; // sliding window for hourly throttle

function recentSendCount() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (sendTimestamps.length && sendTimestamps[0] < cutoff) sendTimestamps.shift();
  return sendTimestamps.length;
}

function noteSend() {
  sendTimestamps.push(Date.now());
}

/** Pick rows that are ready to (re-)send right now. */
function pickReady(list) {
  const now = Date.now();
  return list.filter((row) => {
    if (row.state === 'sent' || row.state === 'sent_stub' || row.state === 'failed' || row.state === 'skipped') return false;
    if (row.state === 'sending') return false; // someone else may be processing
    if (!row.to) return false;
    if (row.nextAttemptAt && new Date(row.nextAttemptAt).getTime() > now) return false;
    return true;
  });
}

function classifyError(err) {
  // Decide retry vs permanent
  if (!err) return { retryable: true, message: 'unknown' };
  const msg = err && err.message ? String(err.message) : String(err);
  if (/abort|timeout|network|ECONN|ENOTFOUND|EAI_AGAIN/i.test(msg)) return { retryable: true, message: msg };
  if (/HTTP 5\d\d/i.test(msg)) return { retryable: true, message: msg };
  if (/HTTP 429/i.test(msg)) return { retryable: true, message: msg };
  if (/HTTP 4\d\d/i.test(msg)) return { retryable: false, message: msg };
  return { retryable: true, message: msg };
}

function nextAttemptAt(attempts) {
  // attempts is the count AFTER this failure, so use [attempts-1] for delay
  const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
  return new Date(Date.now() + delay).toISOString();
}

async function sendViaResend(row) {
  if (!process.env.RESEND_API_KEY) {
    return { stub: true, providerMessageId: 'stub_' + row.id };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [row.to],
        subject: row.subject,
        html: row.html,
        reply_to: REPLY_TO
      })
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const err = new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
      throw err;
    }
    const json = await r.json();
    return { stub: false, providerMessageId: json.id || null };
  } finally {
    clearTimeout(timer);
  }
}

async function processOne(row) {
  // Mark "sending" so a parallel tick doesn't double-process. We don't have
  // cross-process locking, but the in-process tick gate prevents that.
  await outbox.patchOutboxEntryById(row.id, { state: 'sending' });
  let result;
  try {
    result = await sendViaResend(row);
  } catch (err) {
    const cls = classifyError(err);
    const attempts = (row.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS || !cls.retryable) {
      await outbox.patchOutboxEntryById(row.id, {
        state: 'failed', attempts, lastAttemptAt: new Date().toISOString(),
        lastError: cls.message
      });
      return { ok: false, retryable: false, error: cls.message };
    }
    await outbox.patchOutboxEntryById(row.id, {
      state: 'retrying', attempts, lastAttemptAt: new Date().toISOString(),
      lastError: cls.message, nextAttemptAt: nextAttemptAt(attempts)
    });
    return { ok: false, retryable: true, error: cls.message };
  }
  // Success — mark sent, archive side-channel, throttle counter
  await outbox.patchOutboxEntryById(row.id, {
    state: result.stub ? 'sent_stub' : 'sent',
    sent: true,
    attempts: (row.attempts || 0) + 1,
    lastAttemptAt: new Date().toISOString(),
    providerMessageId: result.providerMessageId,
    lastError: null
  });
  noteSend();
  if (row.domain) {
    archive.recordEmailSent(row.domain, { runId: row.idempotencyKey, recipient: row.to }).catch(() => {});
  }
  return { ok: true, stub: result.stub, messageId: result.providerMessageId };
}

async function tick() {
  if (running) return;
  running = true;
  let sent = 0, failed = 0, retried = 0;
  try {
    const list = await outbox.loadOutbox();
    const ready = pickReady(list);
    if (!ready.length) return;
    const remainingHourlyCap = Math.max(0, HOURLY_SEND_CAP - recentSendCount());
    if (remainingHourlyCap === 0) {
      console.log(`[outbox-sender] hourly cap hit (${HOURLY_SEND_CAP}/hr). Skipping ${ready.length} queued.`);
      return;
    }
    const slice = ready.slice(0, Math.min(MAX_PER_TICK, remainingHourlyCap));
    for (const row of slice) {
      const r = await processOne(row);
      if (r.ok) sent++;
      else if (r.retryable) retried++;
      else failed++;
    }
    if (sent || failed || retried) {
      console.log(`[outbox-sender] tick: ${sent} sent · ${retried} retrying · ${failed} permanently failed · ${ready.length - slice.length} deferred`);
    }
  } catch (err) {
    console.warn('[outbox-sender] tick failed:', err && err.message);
  } finally {
    running = false;
  }
}

/**
 * Boot the sender. Two scheduling modes:
 *   1. Lightweight setInterval (default for local dev)
 *   2. node-cron string from env CRON_OUTBOX_SCHEDULE (multi-instance prod)
 */
function startSender() {
  if (process.env.CRON_OUTBOX_SCHEDULE) {
    if (cronTask) try { cronTask.stop(); } catch {}
    cronTask = cron.schedule(process.env.CRON_OUTBOX_SCHEDULE, () => { tick().catch(() => {}); });
    console.log('[outbox-sender] scheduled via cron:', process.env.CRON_OUTBOX_SCHEDULE);
  } else {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
    console.log(`[outbox-sender] started · tick=${TICK_MS}ms · max/tick=${MAX_PER_TICK} · hourly cap=${HOURLY_SEND_CAP} · provider=${process.env.RESEND_API_KEY ? 'resend' : 'stub'}`);
    // Run once immediately so any backlog drains right away
    tick().catch(() => {});
  }
}

function stopSender() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  if (cronTask) { try { cronTask.stop(); } catch {} cronTask = null; }
}

/**
 * Runtime throttle controls. Admin can adjust the hourly cap without
 * restarting the process. Returns the new effective cap.
 */
function setHourlyCap(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) throw new Error('hourly cap must be >= 0');
  HOURLY_SEND_CAP = Math.floor(v);
  console.log(`[outbox-sender] hourly cap updated → ${HOURLY_SEND_CAP}/hr`);
  return HOURLY_SEND_CAP;
}

function getThrottleStatus() {
  const sent = recentSendCount();
  return {
    hourlyCap: HOURLY_SEND_CAP,
    sentLastHour: sent,
    remainingThisHour: Math.max(0, HOURLY_SEND_CAP - sent),
    maxPerTick: MAX_PER_TICK,
    tickMs: TICK_MS,
    provider: process.env.RESEND_API_KEY ? 'resend' : 'stub'
  };
}

module.exports = { startSender, stopSender, tick, setHourlyCap, getThrottleStatus };
