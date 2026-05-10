/**
 * Shared audit record lookup by domain (no circular dependency with server.js).
 */

const fs = require('fs/promises');
const path = require('path');
const { extractRootDomain, normalizeDomain } = require('./serpProvider');

const ROOT = path.join(__dirname, '..');

function resolveAuditsJsonPath() {
  return process.env.GEONEO_AUDITS_PATH
    ? path.resolve(process.env.GEONEO_AUDITS_PATH)
    : path.join(ROOT, 'data', 'audits.json');
}

async function loadAuditRecords(opts = {}) {
  const filePath = opts.filePath || resolveAuditsJsonPath();
  const fsApi = opts.fsApi || fs;

  try {
    const raw = await fsApi.readFile(filePath, 'utf8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e && e.code === 'ENOENT') return [];
    throw e;
  }
}

async function getLatestAuditForDomain(domain, opts = {}) {
  const allRecords = await loadAuditRecords(opts);
  const queryRoot = extractRootDomain(normalizeDomain(domain));
  if (!queryRoot) {
    return null;
  }

  const matches = allRecords.filter((r) => {
    const recordDomain = extractRootDomain(r.website || r.finalUrl || '');
    return recordDomain === queryRoot;
  });

  if (matches.length === 0) return null;

  return matches.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
}

module.exports = {
  loadAuditRecords,
  getLatestAuditForDomain
};
