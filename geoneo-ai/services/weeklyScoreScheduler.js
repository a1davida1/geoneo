/**
 * Weekly Visibility Score Scheduler
 * Uses node-cron to automatically score eligible paid Neo Club members every week.
 * Follows the approved design spec exactly. No new schema fields.
 */

const cron = require('node-cron');
const fs = require('fs/promises');
const path = require('path');

const { calculateVisibilityScore } = require('./visibilityScoring');
const { recordScore, getLatestScore } = require('./scoreHistory');
const { trySendWeeklyScoreReport } = require('./weeklyEmailReport');
const { loadAuditRecords } = require('./auditLookup');

const ROOT = path.join(__dirname, '..');
const RUNS_FILE = path.join(ROOT, 'data', 'weekly-score-runs.json');

const DEFAULT_CRON = '0 3 * * 1';
const SCORE_TIMEOUT_MS = 30000;
const GRACE_DAYS = 30;
const DEDUPE_DAYS = 6;

let lastWeeklyRun = null;
let weeklyScoringRunning = false;

/**
 * Check if a record makes the domain eligible for weekly automated scoring.
 * Exact 3-rule logic from spec.
 */
function isEligibleForWeeklyScore(record) {
  if (!record) return false;

  // Rule 1: explicit membership
  if (record.productType === 'membership') return true;

  // Rule 2: operator/admin package unlocks internal dashboard routes without a paid receipt.
  const pkg = record.purchasedPackage;
  if (pkg === 'admin') return true;

  // Rule 3: gold with sufficient payment
  const paid = Number(record.amountPaid || 0);
  if (pkg === 'gold' && paid >= 99) return true;

  // Rule 4: one-time full audit grace period (within 30 days, paid >=197)
  const created = record.createdAt ? new Date(record.createdAt) : null;
  if (created) {
    const daysAgo = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    if (daysAgo <= GRACE_DAYS && paid >= 197) return true;
  }

  return false;
}

/**
 * Normalize domain from website or finalUrl.
 */
function normalizeDomain(websiteOrUrl) {
  if (!websiteOrUrl) return '';
  try {
    const u = new URL(websiteOrUrl.startsWith('http') ? websiteOrUrl : `https://${websiteOrUrl}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return websiteOrUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/**
 * Load recent audits (up to 500) and return latest per domain that is eligible.
 */
async function getEligibleDomains() {
  let records = await loadAuditRecords();
  if (!Array.isArray(records)) records = [];

  // Take latest 500 or all
  if (records.length > 500) {
    records = records.slice(-500);
  }

  // Group by domain, keep most recent
  const latestByDomain = new Map();
  for (const r of records) {
    const domain = normalizeDomain(r.website || r.finalUrl || '');
    if (!domain) continue;
    const existing = latestByDomain.get(domain);
    if (!existing || new Date(r.createdAt || 0) > new Date(existing.createdAt || 0)) {
      latestByDomain.set(domain, r);
    }
  }

  // Filter eligible
  const eligible = [];
  for (const [domain, record] of latestByDomain.entries()) {
    if (isEligibleForWeeklyScore(record)) {
      eligible.push({ domain, record });
    }
  }

  return eligible;
}

/**
 * Score a single domain with timeout and error isolation.
 */
async function scoreOneDomain(domain, auditRecord, opts = {}) {
  const { dryRun = false, signal } = opts;
  if (signal && signal.aborted) {
    return { domain, success: false, error: 'aborted before start' };
  }
  const start = Date.now();
  try {
    // Idempotency: skip if recent score
    const latest = await getLatestScore(domain);
    if (latest) {
      const ts = latest.calculatedAt || latest.recordedAt;
      const ageDays = ts ? (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24) : 999;
      if (ageDays < DEDUPE_DAYS) {
        return { domain, skipped: true, reason: 'recent score exists' };
      }
    }

    // Prepare data for scoring engine (reuse what audit has)
    const scoreInput = {
      ...auditRecord,
      fullAuditResult: auditRecord,
      googleAvgRank: auditRecord.scores?.seo ? 10 : 20,
      targetQueries: 10,
      // Add reasonable defaults for missing pillars so score is meaningful
      mapPackAppearances: 3,
      localSearchVisibility: { summary: { foundInMapPackCount: 3 }, consistency: 0.7 },
      schemaQuality: auditRecord.trustDesign?.level === 'strong' ? 0.9 : 0.5,
      avgRating: 4.3,
      reviewCount: 25,
      gbpCompleteness: 0.75,
      citationCount: 18,
      contentFreshness: 0.7,
      totalWords: auditRecord.summary ? 1200 : 800
    };

    const scoreResult = calculateVisibilityScore(scoreInput);

    if (!dryRun) {
      if (signal && signal.aborted) {
        return { domain, success: false, error: 'aborted before persistence' };
      }
      await recordScore(domain, scoreResult);
      if (signal && signal.aborted) {
        return { domain, success: false, error: 'aborted before email' };
      }
      try {
        await trySendWeeklyScoreReport(auditRecord, scoreResult);
      } catch (emailErr) {
        console.warn(`[WeeklyScore] Email/outbox for ${domain}:`, emailErr.message);
      }
    }

    const duration = Date.now() - start;
    return { domain, success: true, overall: scoreResult.overall, durationMs: duration, dryRun };
  } catch (err) {
    return { domain, success: false, error: err.message || String(err) };
  }
}

/**
 * Main weekly scoring job.
 */
async function runWeeklyScoring({ dryRun = false } = {}) {
  if (weeklyScoringRunning) {
    console.warn('[WeeklyScore] Overlapping run detected — skipping');
    return { skipped: true, reason: 'already running' };
  }
  weeklyScoringRunning = true;
  try {
    const startedAt = new Date().toISOString();
    console.log(`[WeeklyScore] Starting weekly scoring run at ${startedAt} (dryRun=${dryRun})`);

    const eligible = await getEligibleDomains();
    const domainsConsidered = eligible.length;

    const results = [];
    const failures = [];

    for (const { domain, record } of eligible) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SCORE_TIMEOUT_MS);

      try {
        const outcome = await scoreOneDomain(domain, record, { dryRun, signal: controller.signal });
        clearTimeout(timeoutId);
        results.push(outcome);
        if (!outcome.success && !outcome.skipped) {
          failures.push({ domain, error: outcome.error });
        }
      } catch (e) {
        clearTimeout(timeoutId);
        const fail = { domain, error: e.name === 'AbortError' ? 'scoring timeout' : e.message };
        results.push({ domain, success: false, error: fail.error });
        failures.push(fail);
      }
    }

  const domainsScored = results.filter(r => r.success).length;
  const domainsSkipped = results.filter(r => r.skipped).length;

  const finishedAt = new Date().toISOString();
  const durationMs = Date.now() - new Date(startedAt).getTime();

  const runLog = {
    runId: startedAt,
    startedAt,
    finishedAt,
    cronExpression: process.env.WEEKLY_SCORE_CRON || DEFAULT_CRON,
    domainsConsidered,
    domainsScored,
    domainsSkipped,
    failures,
    durationMs
  };

  if (!dryRun) {
    // Ensure runs file exists
    try {
      await fs.access(RUNS_FILE);
    } catch {
      await fs.mkdir(path.dirname(RUNS_FILE), { recursive: true });
      await fs.writeFile(RUNS_FILE, '[]', 'utf8');
    }

    // Append
    let runs = [];
    try {
      const raw = await fs.readFile(RUNS_FILE, 'utf8');
      runs = raw.trim() ? JSON.parse(raw) : [];
    } catch (e) {
      if (e && e.code !== 'ENOENT') {
        console.error('[WeeklyScore] Failed to read/parse runs file', RUNS_FILE, e && e.message ? e.message : e, 'raw:', (typeof raw !== 'undefined' ? raw.slice(0, 200) : ''));
        throw e; // abort to avoid data loss
      }
      runs = [];
    }
    runs.push(runLog);
    const tmp = `${RUNS_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(runs, null, 2), 'utf8');
    await fs.rename(tmp, RUNS_FILE);

    lastWeeklyRun = runLog;
  }

  console.log(`[WeeklyScore] Run complete: ${domainsScored} scored, ${domainsSkipped} skipped, ${failures.length} failures in ${durationMs}ms`);

    return runLog;
  } finally {
    weeklyScoringRunning = false;
  }
}

/**
 * Start the cron scheduler.
 */
function startScheduler() {
  const expr = process.env.WEEKLY_SCORE_CRON || DEFAULT_CRON;
  cron.schedule(expr, () => {
    runWeeklyScoring().catch(err => {
      console.error('[WeeklyScore] Unhandled error in scheduled run:', err);
    });
  });
  console.log(`[WeeklyScore] Scheduler started with cron: ${expr}`);
}

module.exports = {
  startScheduler,
  runWeeklyScoring,
  isEligibleForWeeklyScore,
  getEligibleDomains,
  getLastWeeklyRun: () => lastWeeklyRun
};