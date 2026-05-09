/**
 * Persist implementation tracker state per domain (local JSON, atomic writes, optimistic retries).
 */

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = process.env.GEONEO_FIX_TRACKER_PATH
  ? path.resolve(process.env.GEONEO_FIX_TRACKER_PATH)
  : path.join(ROOT, 'data', 'fixTracker.json');

const MAX_ITEMS_PER_DOMAIN = 250;
const MAX_TITLE_LEN = 400;
const MAX_NOTES_LEN = 8000;
const MAX_WRITE_ATTEMPTS = 12;
const ALLOWED_STATUS = new Set(['not_started', 'in_progress', 'done', 'blocked', 'cancelled']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadAll() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function saveAll(data) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, FILE);
}

function makeId() {
  return `fix_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeDomainKey(domain) {
  return String(domain || '').toLowerCase().replace(/^www\./, '');
}

/**
 * @param {object} merged
 * @param {object[]} existingItems
 * @param {boolean} isUpdate
 * @returns {string[]} error codes
 */
function validateItem(merged, existingItems, isUpdate) {
  const errors = [];
  const title = String(merged.title || '').trim();
  if (!title) errors.push('title_required');
  if (title.length > MAX_TITLE_LEN) errors.push('title_too_long');
  const notes = merged.notes != null ? String(merged.notes) : '';
  if (notes.length > MAX_NOTES_LEN) errors.push('notes_too_long');
  const status = String(merged.status || 'not_started').trim();
  if (!ALLOWED_STATUS.has(status)) errors.push('invalid_status');
  if (!isUpdate && existingItems.length >= MAX_ITEMS_PER_DOMAIN) errors.push('max_items');
  const src = merged.source != null ? String(merged.source).trim() : '';
  if (src.length > 120) errors.push('source_too_long');
  return errors;
}

async function getTracker(domain) {
  const key = normalizeDomainKey(domain);
  const data = await loadAll();
  if (!data[key]) {
    return { domain: key, items: [] };
  }
  return data[key];
}

async function upsertItem(domain, patch) {
  const key = normalizeDomainKey(domain);
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      const data = await loadAll();
      if (!data[key]) data[key] = { domain: key, items: [] };

      const id = patch.id || makeId();
      const idx = data[key].items.findIndex((i) => i.id === id);
      const isUpdate = idx >= 0;
      const prev = isUpdate ? data[key].items[idx] : {};
      const merged = {
        title: patch.title != null ? String(patch.title).trim() : String(prev.title || '').trim(),
        notes: patch.notes != null ? String(patch.notes) : (prev.notes != null ? String(prev.notes) : ''),
        status: String((patch.status != null ? patch.status : prev.status) || 'not_started').trim(),
        source: patch.source != null ? String(patch.source).trim() : String(prev.source || 'manual')
      };
      const errors = validateItem(merged, data[key].items, isUpdate);
      if (errors.length) {
        const err = new Error(`fix_tracker_validation:${errors.join(',')}`);
        err.code = 'VALIDATION';
        err.validationErrors = errors;
        throw err;
      }

      const now = new Date().toISOString();
      const parsedScoreBefore = patch.scoreBefore != null ? Number(patch.scoreBefore) : null;
      const parsedScoreAfter = patch.scoreAfter != null ? Number(patch.scoreAfter) : null;
      const item = {
        id,
        title: merged.title || 'Untitled fix',
        source: merged.source || 'manual',
        status: merged.status,
        createdAt: prev.createdAt || now,
        updatedAt: now,
        scoreBefore: Number.isFinite(parsedScoreBefore) ? parsedScoreBefore : (prev.scoreBefore ?? null),
        scoreAfter: Number.isFinite(parsedScoreAfter) ? parsedScoreAfter : (prev.scoreAfter ?? null),
        notes: merged.notes
      };

      if (idx >= 0) {
        data[key].items[idx] = item;
      } else {
        data[key].items.push(item);
      }

      await saveAll(data);
      return item;
    } catch (e) {
      lastErr = e;
      if (e.code === 'VALIDATION') throw e;
      await sleep(8 + Math.floor(Math.random() * 40));
    }
  }
  const wrap = new Error('fix_tracker_write_conflict');
  wrap.cause = lastErr;
  throw wrap;
}

async function deleteItem(domain, id) {
  const key = normalizeDomainKey(domain);
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    try {
      const data = await loadAll();
      if (!data[key]) return false;
      const before = data[key].items.length;
      data[key].items = data[key].items.filter((i) => i.id !== id);
      await saveAll(data);
      return data[key].items.length < before;
    } catch (e) {
      lastErr = e;
      await sleep(8 + Math.floor(Math.random() * 40));
    }
  }
  const wrap = new Error('fix_tracker_write_conflict');
  wrap.cause = lastErr;
  throw wrap;
}

module.exports = {
  getTracker,
  upsertItem,
  deleteItem,
  validateItem,
  MAX_ITEMS_PER_DOMAIN,
  FILE
};
