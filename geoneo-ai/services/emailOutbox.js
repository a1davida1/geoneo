/**
 * Durable email queue with idempotency keys, attempt counts, and stable row shape.
 */

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTBOX = process.env.GEONEO_EMAIL_OUTBOX_PATH
  ? path.resolve(process.env.GEONEO_EMAIL_OUTBOX_PATH)
  : path.join(ROOT, 'data', 'email-outbox.json');

function makeEntryId() {
  return `em_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function stableIdempotencyKey(parts) {
  return crypto.createHash('sha256').update(parts.filter(Boolean).join('\0')).digest('hex').slice(0, 48);
}

async function loadOutbox() {
  let raw;
  try {
    raw = await fs.readFile(OUTBOX, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('[emailOutbox] Failed to parse', OUTBOX, e && e.message ? e.message : e, 'raw head:', raw.slice(0, 200));
    return [];
  }
}

async function saveOutbox(list) {
  await fs.mkdir(path.dirname(OUTBOX), { recursive: true });
  const tmp = `${OUTBOX}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await fs.rename(tmp, OUTBOX);
}

/**
 * @param {{ idempotencyKey: string, type?: string, to?: string, subject?: string, html?: string, state?: string, sent?: boolean, reason?: string, domain?: string, score?: number, attempts?: number, lastAttemptAt?: string|null, lastError?: string|null, providerMessageId?: string|null }} entry
 */
async function enqueueOutboxEntry(entry) {
  const idempotencyKey = entry.idempotencyKey;
  if (!String(idempotencyKey || '').trim()) {
    throw new Error('enqueueOutboxEntry requires idempotencyKey');
  }

  const list = await loadOutbox();
  const existing = list.find((r) => r.idempotencyKey === idempotencyKey);
  if (existing) {
    if (existing.state === 'sent' || existing.state === 'skipped') {
      return { ok: true, duplicate: true, entry: existing };
    }
    return { ok: true, duplicate: false, entry: existing };
  }

  const now = new Date().toISOString();
  const row = {
    id: entry.id || makeEntryId(),
    idempotencyKey,
    type: entry.type || 'transactional',
    to: entry.to || '',
    subject: entry.subject || '',
    html: entry.html != null ? String(entry.html) : '',
    state: entry.state || 'queued',
    sent: Boolean(entry.sent),
    attempts: Number(entry.attempts) || 0,
    lastAttemptAt: entry.lastAttemptAt != null ? entry.lastAttemptAt : null,
    lastError: entry.lastError != null ? String(entry.lastError) : null,
    providerMessageId: entry.providerMessageId || null,
    reason: entry.reason || '',
    domain: entry.domain || '',
    score: entry.score,
    queuedAt: entry.queuedAt || now,
    updatedAt: now
  };

  list.push(row);
  await saveOutbox(list);
  return { ok: true, duplicate: false, entry: row };
}

/**
 * @param {string} id
 * @param {object} patch
 */
async function patchOutboxEntryById(id, patch) {
  const list = await loadOutbox();
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  list[idx] = {
    ...list[idx],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await saveOutbox(list);
  return list[idx];
}

function isoWeekUtcKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

module.exports = {
  enqueueOutboxEntry,
  patchOutboxEntryById,
  loadOutbox,
  saveOutbox,
  stableIdempotencyKey,
  isoWeekUtcKey,
  OUTBOX_PATH: OUTBOX
};
