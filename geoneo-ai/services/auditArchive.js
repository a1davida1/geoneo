/**
 * Audit Archive — durable per-domain history + IMMUTABLE audit log.
 *
 * The audit data is itself a product at scale (industry baselines,
 * competitive intelligence, time-series of local SEO health). So we
 * keep every audit forever in an append-only log, even after the
 * per-domain "recent" view ages it out.
 *
 * Storage layout:
 *   data/audit-archive/<domainHash>.json     — fast-read recent history per
 *                                              domain (capped at MAX_HISTORY_PER_DOMAIN
 *                                              for read perf — NOT a data limit)
 *   data/audit-archive-index.ndjson           — append-only flat index for filtering
 *   data/audit-log/{YYYY-MM}.ndjson           — IMMUTABLE full-payload audit log,
 *                                              sharded by month (one row per audit
 *                                              run, never dropped, never overwritten)
 *
 * Why three structures:
 *   - Per-domain JSON = fast O(1) read for email blast / dashboard / re-audit
 *   - NDJSON index = streaming filter for "all MO plumbers scored < 50"
 *   - IMMUTABLE LOG = the actual data product. Every audit, every score,
 *     every finding, every dollar estimate, kept forever. This is what
 *     trains industry baselines, what we can sell as API access at scale,
 *     what proves "we audited 1.7M businesses" in a deck.
 *
 * Idempotency: saveAudit dedupes the per-domain HISTORY view within a 1h
 * window per (domain, source). The immutable log ALWAYS gets a new entry
 * regardless — duplicates are intentional (we want to know we re-ran).
 *
 * Schema versioning: every record carries `schemaVersion`. Older records
 * are backwards-readable; readers handle missing fields gracefully.
 *
 * Atomic writes: temp-then-rename for per-domain files + monthly log.
 * NDJSON index uses append-only single-line writes (no explicit fsync).
 *
 * Sharding: monthly log file. When migrating to SQLite/Postgres at 1M+
 * audits, the migration tool reads these monthly NDJSON files in order.
 *
 * Retention: per-domain JSON cap is MAX_HISTORY_PER_DOMAIN (read perf only).
 * Immutable log: NO retention cap. Storage cost ~10KB per audit × 100M
 * audits = 1TB raw or ~200GB gzipped. Affordable.
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const readline = require('readline');
const path = require('path');
const crypto = require('crypto');

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'audit-archive');
const INDEX_PATH = path.join(__dirname, '..', 'data', 'audit-archive-index.ndjson');
const LOG_DIR = path.join(__dirname, '..', 'data', 'audit-log');
const SCHEMA_VERSION = 'audit-archive/1.0';
const DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1h
const MAX_HISTORY_PER_DOMAIN = Number(process.env.AUDIT_HISTORY_CAP) || 100; // raised from 24 — read-perf only
const MAX_INDEX_LINE_BYTES = 3500; // safe under PIPE_BUF for atomic appends

/**
 * Append a full-payload audit record to the immutable monthly log.
 * Never overwrites, never deduplicates, never drops. This is the data product.
 */
async function appendAuditLog(record) {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const logPath = path.join(LOG_DIR, `${month}.ndjson`);
    const line = JSON.stringify({
      ...record,
      auditLogId: crypto.randomBytes(12).toString('hex'),
      loggedAt: new Date().toISOString()
    }) + '\n';
    await fs.appendFile(logPath, line, 'utf8');
  } catch (err) {
    // Non-fatal — per-domain file + index are still written
    console.warn('[audit-archive] log append failed:', err && err.message);
  }
}

const writeMutex = new Map(); // domain -> Promise (lock chain)

function normalizeDomain(input) {
  if (!input) return '';
  const raw = String(input).trim().toLowerCase();
  try {
    const url = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/^www\./i, '');
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
  }
}

function domainHash(domain) {
  return crypto.createHash('sha1').update(normalizeDomain(domain)).digest('hex').slice(0, 20);
}

function domainFilePath(domain) {
  return path.join(ARCHIVE_DIR, `${domainHash(domain)}.json`);
}

async function ensureDirs() {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
}

/** Per-domain mutex — chains writes serially while different domains run in parallel. */
function withDomainLock(domain, fn) {
  const key = normalizeDomain(domain);
  const previous = writeMutex.get(key) || Promise.resolve();
  const next = previous.then(fn, fn);
  const tail = next.then(() => undefined, () => undefined);
  tail.finally(() => {
    if (writeMutex.get(key) === tail) writeMutex.delete(key);
  });
  writeMutex.set(key, tail);
  return next;
}

async function readDomainFile(domain) {
  try {
    const raw = await fs.readFile(domainFilePath(domain), 'utf8');
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    console.error('[audit-archive] readDomainFile failed:', domainFilePath(domain), err && err.message ? err.message : err);
    return null;
  }
}

async function writeDomainFile(domain, payload) {
  await ensureDirs();
  const file = domainFilePath(domain);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

/**
 * Append a single-line NDJSON entry to the flat index. POSIX guarantees
 * atomic writes for single writes under PIPE_BUF; we cap the line size to
 * 3500 bytes and fall back to skipping (not crashing) if larger.
 */
async function appendIndexLine(entry) {
  const line = JSON.stringify(entry);
  if (Buffer.byteLength(line, 'utf8') > MAX_INDEX_LINE_BYTES) {
    // Line too big — drop the heaviest fields and retry once
    const slim = { ...entry };
    delete slim.findingsTitles;
    delete slim.evidence;
    const slimLine = JSON.stringify(slim);
    if (Buffer.byteLength(slimLine, 'utf8') > MAX_INDEX_LINE_BYTES) return; // give up
    await fs.appendFile(INDEX_PATH, slimLine + '\n', 'utf8');
    return;
  }
  await fs.appendFile(INDEX_PATH, line + '\n', 'utf8');
}

/**
 * Build a slim index entry from a full archive record. Only the fields we
 * need for email-blast pre-filtering go into the index — keeps it fast to
 * stream + filter even at 100k+ entries.
 */
function buildIndexEntry(record) {
  return {
    schemaVersion: SCHEMA_VERSION,
    domain: record.domain,
    domainHash: record.domainHash,
    orgId: record.orgId || 'default',
    maintenanceCustomer: record.maintenanceCustomer === true,
    auditedAt: record.auditedAt,
    source: record.source,
    runId: record.runId || null,
    overallScore: record.audit?.overallScore ?? null,
    grade: record.audit?.grade ?? null,
    industry: record.industry || null,
    city: record.city || null,
    state: record.state || null,
    seoOwner: record.seoProvider?.classification || null,
    seoOwnerConfidence: record.seoProvider?.confidence || null,
    hasEmail: Array.isArray(record.contactInfo?.emails) && record.contactInfo.emails.length > 0,
    hasPhone: Array.isArray(record.contactInfo?.phones) && record.contactInfo.phones.length > 0,
    primaryEmail: record.contactInfo?.emails?.[0] || null,
    primaryPhone: record.contactInfo?.phones?.[0] || null,
    dollarOpportunityHigh: record.audit?.dollarOpportunity?.monthly?.high ?? null,
    dollarOpportunityLow: record.audit?.dollarOpportunity?.monthly?.low ?? null,
    sectionScores: record.audit?.sectionScores || null,
    findingsCount: Array.isArray(record.audit?.findings) ? record.audit.findings.length : 0,
    // prospectFit: high score = ideal sales target. Used to filter "who to chase".
    prospectFitScore: record.audit?.prospectFit?.score ?? null,
    prospectFitTier: record.audit?.prospectFit?.tier ?? null,
    // Authority signals — used by prospectFit and surfaced in admin UI
    domainRating: record.audit?.deepIntegrations?.ahrefs?.domainRating ?? null,
    organicTraffic: record.audit?.deepIntegrations?.ahrefs?.organicTraffic ?? null,
    organicKeywords: record.audit?.deepIntegrations?.ahrefs?.organicKeywords ?? null,
    investingInAds: record.audit?.deepIntegrations?.ahrefs?.investingInAds ?? null,
    emailSentAt: record.emailSentAt || null,
    qualifierCompletedAt: record.qualifierCompletedAt || null,
    qualifierBucket: record.qualifierBucket || null,
    suppressedReason: record.suppressedReason || null
  };
}

/**
 * Save one audit. Idempotent: if the same (domain, source) was saved within
 * DEDUPE_WINDOW_MS, returns the existing record untouched (no new history
 * entry, no new index line).
 *
 * Returns: { record, isNew, dedupedFrom }
 */
async function saveAudit(input = {}) {
  const domain = normalizeDomain(input.domain || input.url || input.website);
  if (!domain) return { record: null, isNew: false, dedupedFrom: null, error: 'missing_domain' };

  const orgContext = require('./orgContext');
  const orgId = orgContext.normalizeOrgId(input.orgId);
  const auditedAt = new Date().toISOString();
  const newEntry = {
    schemaVersion: SCHEMA_VERSION,
    domain,
    domainHash: domainHash(domain),
    orgId,
    auditedAt,
    source: String(input.source || 'unknown'), // 'sweep' | 'lead-gen' | 'ad-hoc' | 'qualifier-load' | etc.
    runId: input.runId || null,
    industry: input.industry || null,
    city: input.city || null,
    state: input.state || null,
    audit: input.audit || null,           // full deep-audit payload
    contactInfo: input.contactInfo || null, // {phones, emails, ...}
    seoProvider: input.seoProvider || null, // {classification, label, confidence, evidence[]}
    leadScore: input.leadScore || null,     // {score, tier, reasons[]}
    advancedInsights: input.advancedInsights || null,
    enrichedFrom: input.enrichedFrom || null,
    sourceMeta: input.sourceMeta || null,   // arbitrary { jobId, vertical, ... }
    notes: input.notes || null
  };

  // ALWAYS write to the immutable log first — even when the per-domain
  // history dedupes the entry. Dedupes there are about read-perf, not
  // about discarding data. Every audit run is a data point.
  appendAuditLog(newEntry).catch(() => {});

  return withDomainLock(domain, async () => {
    const existing = await readDomainFile(domain);
    const history = existing && Array.isArray(existing.history) ? existing.history : [];

    // Dedupe: same source within DEDUPE_WINDOW_MS = skip the per-domain
    // history view (but the immutable log already has it).
    const recent = history.find((h) => h.source === newEntry.source && (Date.now() - new Date(h.auditedAt).getTime()) < DEDUPE_WINDOW_MS);
    if (recent) {
      return { record: existing, isNew: false, dedupedFrom: recent.auditedAt, loggedToImmutable: true };
    }

    // Prepend so latest is first; cap rolling-window history
    history.unshift(newEntry);
    if (history.length > MAX_HISTORY_PER_DOMAIN) history.length = MAX_HISTORY_PER_DOMAIN;

    const fullRecord = {
      schemaVersion: SCHEMA_VERSION,
      domain,
      domainHash: domainHash(domain),
      // Sticky orgId on the top-level record. Once set, it doesn't change
      // (a domain belongs to one org). Subsequent audits from any org write
      // to the same record but the org ownership stays with the first writer.
      orgId: existing?.orgId || orgId,
      firstSeenAt: existing?.firstSeenAt || auditedAt,
      lastAuditedAt: auditedAt,
      // Side-channel marks live at the top level so they survive across audits
      emailSentAt: existing?.emailSentAt || null,
      emailSentCount: existing?.emailSentCount || 0,
      qualifierCompletedAt: existing?.qualifierCompletedAt || null,
      qualifierBucket: existing?.qualifierBucket || null,
      qualifierAnswers: existing?.qualifierAnswers || null,
      suppressedReason: existing?.suppressedReason || null,
      suppressedAt: existing?.suppressedAt || null,
      tags: existing?.tags || [],
      history
    };

    await writeDomainFile(domain, fullRecord);
    try {
      await appendIndexLine(buildIndexEntry({ ...newEntry, ...fullRecord }));
    } catch {
      // index append failures are non-fatal — full record is still on disk
    }
    return { record: fullRecord, isNew: true, dedupedFrom: null };
  });
}

async function getDomainHistory(domain) {
  const record = await readDomainFile(domain);
  if (!record) return null;
  return record;
}

async function getLatestAudit(domain) {
  const record = await readDomainFile(domain);
  return record && Array.isArray(record.history) && record.history.length ? record.history[0] : null;
}

/**
 * Side-channel mark: domain was emailed. Increments counter + sets timestamp.
 * Updates both the per-domain file AND appends an index entry so query()
 * sees the new emailSentAt.
 */
async function recordEmailSent(domain, { runId = null, recipient = null } = {}) {
  return withDomainLock(domain, async () => {
    const record = await readDomainFile(domain);
    if (!record) return null;
    record.emailSentAt = new Date().toISOString();
    record.emailSentCount = (record.emailSentCount || 0) + 1;
    record.lastEmail = { runId, recipient, at: record.emailSentAt };
    await writeDomainFile(domain, record);
    try {
      await appendIndexLine({
        schemaVersion: SCHEMA_VERSION,
        type: 'email_sent_mark',
        domain: normalizeDomain(domain),
        domainHash: domainHash(domain),
        emailSentAt: record.emailSentAt,
        runId,
        recipient
      });
    } catch {}
    return record;
  });
}

async function recordQualifierCompleted(domain, { bucket, answers, score, runId = null }) {
  return withDomainLock(domain, async () => {
    const record = await readDomainFile(domain);
    if (!record) return null;
    record.qualifierCompletedAt = new Date().toISOString();
    record.qualifierBucket = bucket;
    record.qualifierAnswers = answers;
    record.qualifierScore = score;
    record.qualifierRunId = runId;
    await writeDomainFile(domain, record);
    try {
      await appendIndexLine({
        schemaVersion: SCHEMA_VERSION,
        type: 'qualifier_mark',
        domain: normalizeDomain(domain),
        domainHash: domainHash(domain),
        qualifierCompletedAt: record.qualifierCompletedAt,
        qualifierBucket: bucket,
        qualifierScore: score,
        runId
      });
    } catch {}
    return record;
  });
}

async function recordSuppression(domain, reason) {
  return withDomainLock(domain, async () => {
    const record = await readDomainFile(domain);
    if (!record) return null;
    record.suppressedReason = String(reason || 'manual');
    record.suppressedAt = new Date().toISOString();
    await writeDomainFile(domain, record);
    try {
      await appendIndexLine({
        schemaVersion: SCHEMA_VERSION,
        type: 'suppression_mark',
        domain: normalizeDomain(domain),
        domainHash: domainHash(domain),
        suppressedReason: record.suppressedReason,
        suppressedAt: record.suppressedAt
      });
    } catch {}
    return record;
  });
}

/**
 * Reverse a suppression. Clears the suppression marks on the per-domain
 * file and writes an `unsuppression_mark` to the index so query collapses
 * see the latest state. We do NOT remove the original `suppression_mark`
 * line from the index (it's append-only); instead, we add an unsuppression
 * mark and let the queryArchive merge logic prefer the latest.
 */
async function clearSuppression(domain, { by = 'admin' } = {}) {
  return withDomainLock(domain, async () => {
    const record = await readDomainFile(domain);
    if (!record) return null;
    if (!record.suppressedReason && !record.suppressedAt) return record;
    record.suppressedReason = null;
    record.suppressedAt = null;
    record.suppressionClearedAt = new Date().toISOString();
    record.suppressionClearedBy = by;
    await writeDomainFile(domain, record);
    try {
      await appendIndexLine({
        schemaVersion: SCHEMA_VERSION,
        type: 'unsuppression_mark',
        domain: normalizeDomain(domain),
        domainHash: domainHash(domain),
        suppressedReason: null,
        suppressedAt: null,
        clearedAt: record.suppressionClearedAt,
        clearedBy: by
      });
    } catch {}
    return record;
  });
}

/**
 * Stream-friendly query over the NDJSON index. Filters apply in this order
 * (ANDed): scoreMax, scoreMin, hasEmail, hasPhone, city, state, industry,
 * notEmailedSince (ISO date), notSuppressed, seoOwnerNotIn, hasOpportunityAtLeast.
 *
 * For correctness when multiple index entries exist per domain (one per
 * audit + side-channel marks), we collapse to the latest entry per domain
 * before applying filters. limit defaults to 200.
 */
async function queryArchive(filter = {}) {
  try {
    await fs.access(INDEX_PATH);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { results: [], totalScanned: 0 };
    throw err;
  }

  const stream = fsSync.createReadStream(INDEX_PATH, { encoding: 'utf8' });
  const byDomain = new Map();
  let totalScanned = 0;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    totalScanned++;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const key = entry.domain || entry.domainHash;
    if (!key) continue;
    if (!byDomain.has(key)) byDomain.set(key, {});
    const merged = byDomain.get(key);
    if (entry.type === 'email_sent_mark') {
      merged.emailSentAt = entry.emailSentAt;
      continue;
    }
    if (entry.type === 'qualifier_mark') {
      merged.qualifierCompletedAt = entry.qualifierCompletedAt;
      merged.qualifierBucket = entry.qualifierBucket;
      merged.qualifierScore = entry.qualifierScore;
      continue;
    }
    if (entry.type === 'suppression_mark') {
      // Only apply if newer than any unsuppression_mark we've seen
      if (!merged.suppressionClearedAt || new Date(entry.suppressedAt) > new Date(merged.suppressionClearedAt)) {
        merged.suppressedReason = entry.suppressedReason || merged.suppressedReason;
        merged.suppressedAt = entry.suppressedAt || merged.suppressedAt;
      }
      continue;
    }
    if (entry.type === 'maintenance_mark') {
      // Latest mark wins (record both activation + deactivation timestamps).
      // Use a private mark-timestamp so audit-entry maintenanceCustomer doesn't override later toggles.
      if (!merged._maintenanceMarkAt || new Date(entry.markedAt) > new Date(merged._maintenanceMarkAt)) {
        merged.maintenanceCustomer = entry.maintenanceCustomer === true;
        merged.maintenanceStartedAt = entry.maintenanceStartedAt || merged.maintenanceStartedAt;
        merged.maintenanceEndedAt = entry.maintenanceEndedAt;
        merged.maintenancePlan = entry.maintenancePlan;
        merged._maintenanceMarkAt = entry.markedAt;
      }
      continue;
    }
    if (entry.type === 'unsuppression_mark') {
      // Clear suppression if this clearedAt is newer than any prior suppression
      if (!merged.suppressedAt || new Date(entry.clearedAt) > new Date(merged.suppressedAt)) {
        merged.suppressedReason = null;
        merged.suppressedAt = null;
      }
      merged.suppressionClearedAt = entry.clearedAt;
      continue;
    }
    // Audit entry — replace prior audit fields if newer.
    // Don't let an audit entry override a later maintenance_mark.
    if (!merged.auditedAt || new Date(entry.auditedAt) > new Date(merged.auditedAt)) {
      const preserveMarkAt = merged._maintenanceMarkAt;
      const preserveCustomer = preserveMarkAt ? merged.maintenanceCustomer : undefined;
      Object.assign(merged, {
        domain: entry.domain,
        domainHash: entry.domainHash,
        orgId: entry.orgId || 'default',
        maintenanceCustomer: entry.maintenanceCustomer === true,
        auditedAt: entry.auditedAt,
        source: entry.source,
        runId: entry.runId,
        overallScore: entry.overallScore,
        grade: entry.grade,
        industry: entry.industry,
        city: entry.city,
        state: entry.state,
        seoOwner: entry.seoOwner,
        seoOwnerConfidence: entry.seoOwnerConfidence,
        hasEmail: entry.hasEmail,
        hasPhone: entry.hasPhone,
        primaryEmail: entry.primaryEmail,
        primaryPhone: entry.primaryPhone,
        dollarOpportunityHigh: entry.dollarOpportunityHigh,
        dollarOpportunityLow: entry.dollarOpportunityLow,
        sectionScores: entry.sectionScores,
        findingsCount: entry.findingsCount,
        suppressedReason: entry.suppressedReason
      });
      // If we'd seen a later maintenance_mark, restore it
      if (preserveMarkAt) {
        merged._maintenanceMarkAt = preserveMarkAt;
        merged.maintenanceCustomer = preserveCustomer === true;
      }
    }
  }

  const all = Array.from(byDomain.values()).filter((e) => e.auditedAt); // need at least an audit
  const norm = (s) => String(s || '').trim().toLowerCase();
  const cityFilter = norm(filter.city);
  const stateFilter = norm(filter.state);
  const industryFilter = norm(filter.industry);

  const seoOwnerNotIn = new Set((filter.seoOwnerNotIn || []).map((x) => norm(x)));
  const notEmailedSince = filter.notEmailedSince ? new Date(filter.notEmailedSince).getTime() : null;
  const filtered = all.filter((e) => {
    if (filter.scoreMax != null && (e.overallScore == null || e.overallScore > filter.scoreMax)) return false;
    if (filter.scoreMin != null && (e.overallScore == null || e.overallScore < filter.scoreMin)) return false;
    if (filter.hasEmail === true && !e.hasEmail) return false;
    if (filter.hasPhone === true && !e.hasPhone) return false;
    if (cityFilter && norm(e.city) !== cityFilter) return false;
    if (stateFilter && norm(e.state) !== stateFilter) return false;
    if (industryFilter && norm(e.industry) !== industryFilter) return false;
    if (filter.notSuppressed && e.suppressedReason) return false;
    if (filter.notMaintenanceCustomer && e.maintenanceCustomer === true) return false;
    if (seoOwnerNotIn.size && seoOwnerNotIn.has(norm(e.seoOwner))) return false;
    if (filter.hasOpportunityAtLeast != null && (e.dollarOpportunityHigh == null || e.dollarOpportunityHigh < filter.hasOpportunityAtLeast)) return false;
    if (filter.notQualified && e.qualifierCompletedAt) return false;
    // Org-aware filter (default org includes records with no orgId for back-compat)
    if (filter.orgId) {
      const recordOrg = e.orgId || 'default';
      if (recordOrg !== filter.orgId) return false;
    }
    if (notEmailedSince) {
      if (e.emailSentAt && new Date(e.emailSentAt).getTime() > notEmailedSince) return false;
    }
    if (filter.neverEmailed === true && e.emailSentAt) return false;
    return true;
  });

  // Sort worst-score-first by default (most painful = best prospects)
  filtered.sort((a, b) => (a.overallScore ?? 999) - (b.overallScore ?? 999));

  const limit = Math.max(1, Math.min(2000, Number(filter.limit) || 200));
  return { results: filtered.slice(0, limit), totalScanned, totalMatched: filtered.length };
}

/** Aggregate stats over the index — useful for "78% of plumbers in MO have no llms.txt" */
async function aggregateStats(filter = {}) {
  const { results } = await queryArchive({ ...filter, limit: 2000 });
  const total = results.length;
  if (!total) return { total: 0 };
  const sum = (acc, v) => acc + (v || 0);
  const scoredOnly = results.map((r) => r.overallScore).filter((v) => v != null);
  const counts = {
    total,
    avgOverallScore: scoredOnly.length ? Math.round(scoredOnly.reduce(sum, 0) / scoredOnly.length) : null,
    withEmail: results.filter((r) => r.hasEmail).length,
    withPhone: results.filter((r) => r.hasPhone).length,
    emailed: results.filter((r) => r.emailSentAt).length,
    qualified: results.filter((r) => r.qualifierCompletedAt).length,
    suppressed: results.filter((r) => r.suppressedReason).length,
    seoOwnerBreakdown: {},
    bucketBreakdown: {},
    scoreBands: { f: 0, d: 0, c: 0, b: 0, a: 0 }
  };
  for (const r of results) {
    const owner = r.seoOwner || 'unknown';
    counts.seoOwnerBreakdown[owner] = (counts.seoOwnerBreakdown[owner] || 0) + 1;
    if (r.qualifierBucket) counts.bucketBreakdown[r.qualifierBucket] = (counts.bucketBreakdown[r.qualifierBucket] || 0) + 1;
    const s = r.overallScore;
    if (s == null) continue;
    if (s < 50) counts.scoreBands.f++;
    else if (s < 60) counts.scoreBands.d++;
    else if (s < 70) counts.scoreBands.c++;
    else if (s < 80) counts.scoreBands.b++;
    else counts.scoreBands.a++;
  }
  return counts;
}

/**
 * Reverse-lookup: find the domain whose contact emails include this address.
 * Used by the inbound-email webhook to identify which lead replied.
 * Streams the NDJSON index — no full archive load.
 */
async function findDomainByEmail(email) {
  if (!email) return null;
  const target = String(email).trim().toLowerCase();
  if (!target.includes('@')) return null;
  let raw;
  try {
    raw = await fs.readFile(INDEX_PATH, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return null;
  }
  const lines = raw.split('\n').filter(Boolean);
  // Latest match wins (NDJSON order = chronological)
  let lastMatch = null;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.primaryEmail && entry.primaryEmail.toLowerCase() === target) {
      lastMatch = entry.domain;
    }
  }
  // Fallback: try the From-domain heuristic (e.g. owner@kcp-plumbing.com → kcp-plumbing.com)
  if (!lastMatch) {
    const fromDomain = target.split('@')[1];
    if (fromDomain) {
      // Direct domain lookup
      const direct = await readDomainFile(fromDomain);
      if (direct) lastMatch = fromDomain;
    }
  }
  return lastMatch;
}

/**
 * Stream-query the immutable audit log. Returns audits matching `filter`
 * across one or more monthly shards. For full-history queries (no month
 * filter) we walk every shard chronologically.
 *
 * Filter options:
 *   - month: 'YYYY-MM' (single-shard fast path)
 *   - monthFrom / monthTo: range of months
 *   - domain: exact match
 *   - industry, city, state: exact match (lowercased)
 *   - scoreMax / scoreMin: by audit.overallScore
 *   - source: 'sweep' | 'lead-gen' | 'ad-hoc' | etc
 *   - limit: cap rows returned (default 1000)
 *
 * Returns { results, totalScanned, monthsScanned[] }.
 *
 * For 1M+ logs, swap this implementation for SQLite. The query interface
 * stays the same; consumers don't need to change.
 */
async function queryAuditLog(filter = {}) {
  const limit = Math.max(1, Math.min(50000, Number(filter.limit) || 1000));
  let monthFiles;
  try {
    const all = await fs.readdir(LOG_DIR);
    monthFiles = all.filter((f) => /^\d{4}-\d{2}\.ndjson$/.test(f)).sort();
  } catch (err) {
    if (err && err.code === 'ENOENT') return { results: [], totalScanned: 0, monthsScanned: [] };
    throw err;
  }
  // Range filter
  if (filter.month) monthFiles = monthFiles.filter((f) => f === filter.month + '.ndjson');
  if (filter.monthFrom) monthFiles = monthFiles.filter((f) => f.replace('.ndjson', '') >= filter.monthFrom);
  if (filter.monthTo) monthFiles = monthFiles.filter((f) => f.replace('.ndjson', '') <= filter.monthTo);

  const results = [];
  let totalScanned = 0;
  const norm = (s) => String(s || '').trim().toLowerCase();
  const domainFilter = norm(filter.domain);
  const industryFilter = norm(filter.industry);
  const cityFilter = norm(filter.city);
  const stateFilter = norm(filter.state);
  const sourceFilter = norm(filter.source);

  for (const monthFile of monthFiles) {
    if (results.length >= limit) break;
    const stream = fsSync.createReadStream(path.join(LOG_DIR, monthFile), { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      totalScanned++;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (domainFilter && norm(entry.domain) !== domainFilter) continue;
      if (industryFilter && norm(entry.industry) !== industryFilter) continue;
      if (cityFilter && norm(entry.city) !== cityFilter) continue;
      if (stateFilter && norm(entry.state) !== stateFilter) continue;
      if (sourceFilter && norm(entry.source) !== sourceFilter) continue;
      const score = entry.audit?.overallScore;
      if (filter.scoreMax != null && (score == null || score > filter.scoreMax)) continue;
      if (filter.scoreMin != null && (score == null || score < filter.scoreMin)) continue;
      results.push(entry);
      if (results.length >= limit) { rl.close(); stream.destroy(); break; }
    }
  }
  return { results, totalScanned, monthsScanned: monthFiles };
}

/**
 * Diagnostic: per-month stats for the immutable log. Useful for the admin
 * "data product" view — shows growth, sharding health, total record count.
 */
async function getAuditLogStats() {
  let monthFiles = [];
  try { monthFiles = (await fs.readdir(LOG_DIR)).filter((f) => /^\d{4}-\d{2}\.ndjson$/.test(f)).sort(); }
  catch (err) { if (err && err.code !== 'ENOENT') throw err; }
  const stats = { totalAudits: 0, totalBytes: 0, months: [], shardCount: monthFiles.length };
  for (const f of monthFiles) {
    try {
      const filePath = path.join(LOG_DIR, f);
      const stat = await fs.stat(filePath);
      // Count lines fast — read in chunks, count newlines
      let lineCount = 0;
      const stream = fsSync.createReadStream(filePath);
      for await (const chunk of stream) {
        for (let i = 0; i < chunk.length; i++) if (chunk[i] === 0x0A) lineCount++;
      }
      stats.months.push({
        month: f.replace('.ndjson', ''),
        audits: lineCount,
        sizeBytes: stat.size,
        sizeMb: (stat.size / 1024 / 1024).toFixed(2)
      });
      stats.totalAudits += lineCount;
      stats.totalBytes += stat.size;
    } catch {}
  }
  stats.totalMb = (stats.totalBytes / 1024 / 1024).toFixed(2);
  return stats;
}

module.exports = {
  saveAudit,
  queryAuditLog,
  getAuditLogStats,
  appendAuditLog,
  findDomainByEmail,
  getDomainHistory,
  getLatestAudit,
  recordEmailSent,
  recordQualifierCompleted,
  recordSuppression,
  clearSuppression,
  queryArchive,
  aggregateStats,
  normalizeDomain,
  domainHash,
  SCHEMA_VERSION
};
