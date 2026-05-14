/**
 * Call consent log. Append-only NDJSON record of every documented consent
 * for an AI outbound call. Required for TCPA "prior express written
 * consent" defense — without this log, a class action has no defense.
 *
 * Sources of consent (any of):
 *   - email_reply       : user replied "yes" / "call me" / explicit consent in inbound email
 *   - admin_override    : operator manually marked consent (e.g. customer phoned in to ask)
 *   - qualifier_optin   : user checked a consent box during qualifier flow
 *
 * Per consent record:
 *   - domain (the lead being called)
 *   - source (one of the above)
 *   - capturedAt (ISO timestamp)
 *   - ip (request IP)
 *   - userAgent (browser/email-client UA)
 *   - tokenHash (SHA-256 of the signed token, NOT the raw token)
 *   - rawSnippet (first ~200 chars of the inbound email body, if email_reply)
 *
 * Storage: data/call-consent-log.ndjson, append-only. Never delete an
 * entry — revocation is recorded as a separate consent_revoked event.
 *
 * Lookup: hasValidConsent(domain) returns the latest consent state
 * (consented + when + how, OR revoked + when).
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'data', 'call-consent-log.ndjson');
const VALID_SOURCES = new Set([
  'email_reply',
  'admin_override',
  'qualifier_optin',
  'consent_revoked'
]);

function hashToken(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
}

function normalizeDomain(d) {
  return String(d || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}

/**
 * Append a consent event. Does NOT enforce uniqueness — multiple consents
 * for the same domain are fine (creates a richer audit trail).
 */
async function recordConsent({ domain, source, ip = null, userAgent = null, token = null, rawSnippet = null, by = null, note = null } = {}) {
  const d = normalizeDomain(domain);
  if (!d) throw new Error('domain required');
  if (!VALID_SOURCES.has(source)) throw new Error(`invalid consent source: ${source}`);
  const entry = {
    schemaVersion: 'consent-log/1.0',
    domain: d,
    source,
    capturedAt: new Date().toISOString(),
    ip: ip || null,
    userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
    tokenHash: hashToken(token),
    rawSnippet: rawSnippet ? String(rawSnippet).slice(0, 200) : null,
    by: by || null,
    note: note ? String(note).slice(0, 200) : null
  };
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.appendFile(FILE, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

/**
 * Record a revocation. Creates a consent_revoked event in the log.
 * Use this when the user replies STOP / unsubscribe / "do not call".
 */
async function revokeConsent({ domain, source = 'admin_override', note = null, by = null } = {}) {
  return recordConsent({
    domain,
    source: 'consent_revoked',
    by, note
  });
}

/**
 * Walk the log and return the latest state for a domain:
 *   { consented: bool, lastSource, lastCapturedAt, history: [...] }
 *
 * Algorithm: stream the file, collect all events for the domain, the
 * latest non-revoked event wins UNLESS a later consent_revoked exists.
 */
async function getConsentStatus(domain) {
  const d = normalizeDomain(domain);
  if (!d) return { consented: false, history: [] };
  if (!fsSync.existsSync(FILE)) return { consented: false, history: [] };
  const stream = fsSync.createReadStream(FILE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const history = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.domain === d) history.push(entry);
    } catch {}
  }
  if (!history.length) return { consented: false, history: [] };
  // Sort newest-first
  history.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  const latest = history[0];
  const consented = latest.source !== 'consent_revoked';
  return {
    consented,
    lastSource: latest.source,
    lastCapturedAt: latest.capturedAt,
    history
  };
}

/**
 * Quick gate for the AI dialer. Returns true only if the latest event
 * for this domain is a consent (not a revocation). Designed for the
 * dispatcher's per-call check.
 */
async function hasValidConsent(domain) {
  const status = await getConsentStatus(domain);
  return status.consented === true;
}

/**
 * Bulk: list all currently-consented domains. Useful for the admin
 * "consented leads ready to dial" view.
 */
async function listConsentedDomains() {
  if (!fsSync.existsSync(FILE)) return [];
  const stream = fsSync.createReadStream(FILE, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const byDomain = new Map();
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const existing = byDomain.get(entry.domain);
      if (!existing || new Date(entry.capturedAt) > new Date(existing.capturedAt)) {
        byDomain.set(entry.domain, entry);
      }
    } catch {}
  }
  const out = [];
  for (const [domain, entry] of byDomain) {
    if (entry.source !== 'consent_revoked') {
      out.push({
        domain,
        source: entry.source,
        capturedAt: entry.capturedAt,
        ip: entry.ip
      });
    }
  }
  out.sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
  return out;
}

module.exports = {
  recordConsent,
  revokeConsent,
  getConsentStatus,
  hasValidConsent,
  listConsentedDomains,
  VALID_SOURCES,
  FILE
};
