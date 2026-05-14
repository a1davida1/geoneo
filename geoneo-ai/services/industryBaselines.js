/**
 * Industry baselines — aggregate audit metrics per (industry, citySize)
 * cohort so individual audits can be framed against peers:
 *
 *   "You scored 47/100. Median plumber in a small market: 58. Top quartile: 71."
 *
 * Builds the baseline from the existing audit archive (no separate data
 * source). Cached to disk; refreshed on demand or via cron. The cache
 * survives restarts so we don't re-aggregate 1000+ records on every audit.
 *
 * Cohort definition:
 *   - industry: normalized industry slug (plumber, hvac, electrician, …)
 *   - citySizeBucket: micro (<25k) | small (25-100k) | medium (100-500k) | large (>500k)
 *
 * Per cohort we compute, for each pillar score AND overall score:
 *   - p25 / p50 (median) / p75 / p90
 *   - sample size n (we treat n<5 cohorts as "not enough data")
 *   - generated_at timestamp
 *
 * Refresh policy:
 *   - rebuild() walks every per-domain archive file, takes the latest audit
 *     per domain, groups by cohort, computes percentiles
 *   - getBaseline(industry, city) returns the cached value (or null if
 *     cohort is too small)
 *   - rebuildIfStale(maxAgeMs=24h) is the boot/cron entrypoint
 *
 * Output cache: data/industry-baselines.json (atomic write).
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { citySizeBucketFor } = require('./dollarLiftEngine');

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'audit-archive');
const CACHE_PATH = path.join(__dirname, '..', 'data', 'industry-baselines.json');
// Spec: minimum sample size of 20 (was 5). Below threshold, fall back to
// looser cohort (industry-wide → size-wide → global).
const MIN_COHORT_SIZE = Number(process.env.BASELINE_MIN_COHORT_SIZE) || 20;
// Trim top + bottom 5% before computing percentiles (kills outlier
// distortion from one stellar or one terrible site in a small cohort).
const TRIM_PERCENTILE = Number(process.env.BASELINE_TRIM_PERCENT) || 0.05;
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Compute approximate percentile from a sorted array.
 * Uses linear interpolation between adjacent ranks.
 */
function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * (p / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return Math.round(sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo));
}

/**
 * Trim top + bottom TRIM_PERCENTILE before stats. Eliminates distortion from
 * a single stellar or a single broken site in a small cohort.
 */
function trimOutliers(sortedAsc, trim = TRIM_PERCENTILE) {
  if (sortedAsc.length < 10) return sortedAsc; // too small to trim safely
  const trimCount = Math.floor(sortedAsc.length * trim);
  if (trimCount < 1) return sortedAsc;
  return sortedAsc.slice(trimCount, sortedAsc.length - trimCount);
}

function statsForArray(values) {
  const filtered = values.filter((v) => Number.isFinite(v));
  if (filtered.length < MIN_COHORT_SIZE) return null;
  const sortedAll = filtered.slice().sort((a, b) => a - b);
  const sorted = trimOutliers(sortedAll);
  return {
    n: filtered.length,             // total samples (pre-trim)
    nTrimmed: sorted.length,         // samples used for percentiles
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    min: sortedAll[0],               // raw min/max (not trimmed) — useful for context
    max: sortedAll[sortedAll.length - 1]
  };
}

/**
 * Bucket a city into our 4-tier size cohort. Reuses the same buckets as
 * dollarLiftEngine so $$ math + baselines line up.
 */
function citySizeKey(city) {
  const b = citySizeBucketFor(city);
  if (!b) return 'unknown';
  if (b.popMax <= 25000) return 'micro';
  if (b.popMax <= 100000) return 'small';
  if (b.popMax <= 500000) return 'medium';
  return 'large';
}

function normalizeIndustry(s) {
  return String(s || 'unknown').trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '_').slice(0, 40) || 'unknown';
}

/**
 * Load every archive record's latest audit + cohort key. Returns an array
 * of { industry, citySize, audit }.
 */
async function loadAllLatestAudits() {
  let files;
  try {
    files = await fs.readdir(ARCHIVE_DIR);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    try {
      const raw = await fs.readFile(path.join(ARCHIVE_DIR, f), 'utf8');
      const parsed = JSON.parse(raw);
      const latest = parsed.history && parsed.history[0];
      if (!latest || !latest.audit) continue;
      out.push({
        industry: normalizeIndustry(latest.industry),
        citySize: citySizeKey(latest.city),
        audit: latest.audit
      });
    } catch {}
  }
  return out;
}

/**
 * Walk every archived audit, group by (industry, citySize), and compute
 * percentiles for overallScore + each pillar. Returns the full baseline
 * tree {industry: {citySize: {overall, pillars}}}.
 */
async function rebuild() {
  const records = await loadAllLatestAudits();
  // Group by cohort
  const cohorts = new Map();
  for (const r of records) {
    for (const cohortKey of [`${r.industry}|${r.citySize}`, `${r.industry}|all`, `all|${r.citySize}`, 'all|all']) {
      if (!cohorts.has(cohortKey)) cohorts.set(cohortKey, { overall: [], pillars: {} });
      const c = cohorts.get(cohortKey);
      c.overall.push(r.audit.overallScore);
      const ss = r.audit.sectionScores || {};
      for (const [k, v] of Object.entries(ss)) {
        if (!c.pillars[k]) c.pillars[k] = [];
        c.pillars[k].push(v);
      }
    }
  }
  // Compute percentiles per cohort
  const baselines = {};
  for (const [key, data] of cohorts) {
    const [industry, citySize] = key.split('|');
    const overallStats = statsForArray(data.overall);
    if (!overallStats) continue; // too small
    const pillarStats = {};
    for (const [k, vals] of Object.entries(data.pillars)) {
      const stats = statsForArray(vals);
      if (stats) pillarStats[k] = stats;
    }
    if (!baselines[industry]) baselines[industry] = {};
    baselines[industry][citySize] = {
      overall: overallStats,
      pillars: pillarStats
    };
  }
  const cache = {
    schemaVersion: 'industry-baselines/1.0',
    generatedAt: new Date().toISOString(),
    sourceRecords: records.length,
    cohortCount: Object.values(baselines).reduce((s, c) => s + Object.keys(c).length, 0),
    minCohortSize: MIN_COHORT_SIZE,
    baselines
  };
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  const tmp = CACHE_PATH + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
  await fs.rename(tmp, CACHE_PATH);
  return cache;
}

let _cache = null;
async function loadCache() {
  if (_cache) return _cache;
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    _cache = JSON.parse(raw);
    return _cache;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Read-side API. Returns { overall, pillars, percentile } for the given
 * (industry, city) cohort. Falls back to looser cohorts:
 *   1. exact (industry + citySize)
 *   2. industry-wide (industry, all sizes)
 *   3. citySize-wide (all industries, this size)
 *   4. global (all industries, all sizes)
 *
 * If `score` is provided, also computes the percentile rank of that score
 * within the cohort.
 */
async function getBaseline({ industry, city, score = null } = {}) {
  const cache = await loadCache();
  if (!cache) return null;
  const ind = normalizeIndustry(industry);
  const size = citySizeKey(city);
  const candidates = [`${ind}|${size}`, `${ind}|all`, `all|${size}`, 'all|all'];
  for (const key of candidates) {
    const [i, s] = key.split('|');
    const cohort = cache.baselines[i]?.[s];
    if (!cohort) continue;
    let percentileRank = null;
    if (score != null && Number.isFinite(score)) {
      const o = cohort.overall;
      if (score >= o.p90) percentileRank = '90th+';
      else if (score >= o.p75) percentileRank = '75th-89th';
      else if (score >= o.p50) percentileRank = '50th-74th';
      else if (score >= o.p25) percentileRank = '25th-49th';
      else percentileRank = '<25th';
    }
    return {
      cohort: { industry: i, citySize: s, n: cohort.overall.n },
      cohortMatch: key === candidates[0] ? 'exact' : (i === 'all' && s !== 'all' ? 'size_only' : (s === 'all' && i !== 'all' ? 'industry_only' : 'global')),
      overall: cohort.overall,
      pillars: cohort.pillars,
      percentileRank,
      generatedAt: cache.generatedAt
    };
  }
  return null;
}

/**
 * Rebuild only if cache is missing or older than maxAgeMs. Used by the
 * boot path + an optional cron tick. Non-fatal: returns null + logs on error.
 */
async function rebuildIfStale(maxAgeMs = DEFAULT_STALE_MS) {
  try {
    let needsRebuild = false;
    if (!fsSync.existsSync(CACHE_PATH)) {
      needsRebuild = true;
    } else {
      const stat = await fs.stat(CACHE_PATH);
      if ((Date.now() - stat.mtimeMs) > maxAgeMs) needsRebuild = true;
    }
    if (!needsRebuild) {
      _cache = null; // force re-read on next getBaseline
      return { skipped: true, reason: 'fresh' };
    }
    _cache = null;
    const result = await rebuild();
    console.log(`[industry-baselines] rebuilt: ${result.cohortCount} cohorts from ${result.sourceRecords} records`);
    return { skipped: false, ...result };
  } catch (err) {
    console.warn('[industry-baselines] rebuild failed:', err && err.message);
    return { error: err && err.message };
  }
}

/**
 * Monthly cron — recomputes baselines on the 1st of every month at 5am UTC.
 * Cheap operation (~ a few seconds even at 10k records). Configurable cron
 * expression via BASELINES_CRON env.
 */
let cronTask = null;
function startBaselineScheduler() {
  const cron = require('node-cron');
  const cronExpr = process.env.BASELINES_CRON || '0 5 1 * *'; // 5am UTC, 1st of month
  if (cronTask) try { cronTask.stop(); } catch {}
  if (!cron.validate(cronExpr)) {
    console.warn('[baselines] invalid cron:', cronExpr);
    return;
  }
  cronTask = cron.schedule(cronExpr, () => {
    rebuild().then((c) => {
      console.log(`[baselines] monthly rebuild: ${c.cohortCount} cohorts from ${c.sourceRecords} records`);
    }).catch((err) => {
      console.warn('[baselines] monthly rebuild failed:', err && err.message);
    });
  });
  console.log(`[baselines] monthly cron scheduled · ${cronExpr}`);
}
function stopBaselineScheduler() {
  if (cronTask) { try { cronTask.stop(); } catch {} cronTask = null; }
}

module.exports = {
  rebuild,
  rebuildIfStale,
  getBaseline,
  citySizeKey,
  normalizeIndustry,
  startBaselineScheduler,
  stopBaselineScheduler,
  trimOutliers,
  MIN_COHORT_SIZE,
  TRIM_PERCENTILE
};
