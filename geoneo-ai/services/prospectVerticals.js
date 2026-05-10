'use strict';

const fs = require('fs');
const path = require('path');

let cache = { mtimeMs: null, payload: null };

/**
 * Load prospect vertical groups from data/prospect-verticals.json.
 * Caches by mtime so edits apply without restart.
 *
 * @param {string} rootDir - GeoNeo package root (__dirname parent of data/)
 * @returns {{ version: number, groups: Array<{ label: string, items: Array<{ value: string, label: string }> }> }}
 */
function loadProspectVerticals(rootDir) {
  const filePath = path.join(rootDir, 'data', 'prospect-verticals.json');
  const st = fs.statSync(filePath);
  if (cache.payload != null && cache.mtimeMs === st.mtimeMs) {
    return cache.payload;
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`prospect_verticals_parse: ${e.message || 'invalid_json'}`);
  }

  if (!raw || !Array.isArray(raw.groups) || raw.groups.length === 0) {
    throw new Error('prospect_verticals_invalid: missing groups');
  }

  for (let i = 0; i < raw.groups.length; i++) {
    const g = raw.groups[i];
    if (!g || typeof g.label !== 'string' || !g.label.trim() || !Array.isArray(g.items)) {
      throw new Error(`prospect_verticals_invalid: group ${i}`);
    }
    for (let j = 0; j < g.items.length; j++) {
      const it = g.items[j];
      if (!it || typeof it.value !== 'string' || typeof it.label !== 'string') {
        throw new Error(`prospect_verticals_invalid: group ${i} item ${j}`);
      }
      if (!it.value.trim() || !it.label.trim()) {
        throw new Error(`prospect_verticals_invalid: empty value/label at ${i}.${j}`);
      }
    }
  }

  const payload = {
    version: typeof raw.version === 'number' ? raw.version : 1,
    groups: raw.groups
  };
  cache = { mtimeMs: st.mtimeMs, payload };
  return payload;
}

function clearProspectVerticalsCacheForTests() {
  cache = { mtimeMs: null, payload: null };
}

module.exports = { loadProspectVerticals, clearProspectVerticalsCacheForTests };
