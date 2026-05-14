/**
 * Sweep scheduler — runs Prospect Hunter across many verticals automatically.
 *
 * Job model:
 *   - One job at a time (queue if more arrive)
 *   - Each job picks one (city, state) and a list of verticals
 *   - For each vertical: discover candidates → audit each in parallel → keep
 *     the worst N globally (by overallScore ascending) plus the worst per
 *     vertical for breakdown views
 *   - Persists to disk every 30s and after each vertical completes so a
 *     server restart can resume from the last completed vertical
 *
 * Recurrence:
 *   - kind: "now" → fires immediately
 *   - kind: "cron" → registered with node-cron, fires on schedule. Recurring
 *     jobs spawn a fresh job instance per fire (not the same one re-queued).
 *
 * Failure containment:
 *   - A bad vertical (e.g., SerpAPI 400) marks that vertical "failed" in the
 *     job state and continues with the rest.
 *   - Audit timeouts on individual sites are recorded as failed candidates
 *     and don't stop the vertical.
 *   - Server restart: any job in `running` state is rolled back to `queued`
 *     on boot and resumed from the next un-completed vertical.
 *
 * NOT a generic background-job framework — purpose-built for sweeps.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');

const STORE_PATH = path.join(__dirname, '..', 'data', 'scheduler-jobs.json');
/** Jobs persisted at most every PERSIST_INTERVAL_MS (debounced flush after mutations). */
const PERSIST_INTERVAL_MS = 30 * 1000;
/** Missing audit scores sort after real scores when ranking worst-first in sweep output. */
const MISSING_AUDIT_SCORE_SENTINEL = 999;
const DEFAULT_WORST_N = 100;
const MAX_WORST_N = 500;
const MAX_VERTICAL_QUANTITY = 50;
const DEFAULT_VERTICAL_QUANTITY = 25;
const PER_VERTICAL_KEEP = 5; // worst N per vertical for the breakdown view

let runner = null;        // { runAuditFn, discoverFn, getVerticalsFn, ... }
let storeCache = null;    // { jobs: [...] }
let persistTimer = null;
let workerLoopRunning = false;
const cronTasks = new Map(); // jobId -> node-cron Task

function newJobId() {
  return `sweep_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

async function loadStore() {
  if (storeCache) return storeCache;
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    if (!raw.trim()) { storeCache = { jobs: [] }; return storeCache; }
    const parsed = JSON.parse(raw);
    storeCache = { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  } catch {
    storeCache = { jobs: [] };
  }
  return storeCache;
}

async function persistStore() {
  if (!storeCache) return;
  try {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(storeCache, null, 2), 'utf8');
    await fs.rename(tmp, STORE_PATH);
  } catch (err) {
    console.warn('[scheduler] persist failed:', err && err.message);
  }
}

function schedulePersistDebounced() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    await persistStore();
  }, PERSIST_INTERVAL_MS);
}

/** Bound the worst-N value to a sensible range. */
function normalizeWorstN(value, fallback = DEFAULT_WORST_N) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(10, Math.min(MAX_WORST_N, n));
}

function normalizeQuantity(value, fallback = DEFAULT_VERTICAL_QUANTITY) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(5, Math.min(MAX_VERTICAL_QUANTITY, n));
}

/**
 * Flatten the prospect-verticals groups file into a flat string[] of vertical
 * values. Caller can override with their own list.
 */
function flattenVerticals(verticalsFile) {
  if (!verticalsFile) return [];
  if (Array.isArray(verticalsFile)) return verticalsFile;
  const groups = Array.isArray(verticalsFile.groups) ? verticalsFile.groups : [];
  const out = [];
  for (const g of groups) {
    for (const item of (g.items || [])) {
      if (item && item.value) out.push(String(item.value));
    }
  }
  return out;
}

function summarizeJob(job) {
  if (!job) return null;
  const completedVerticals = (job.verticals || []).filter((v) => ['complete', 'failed'].includes(v.status)).length;
  const totalAuditedCandidates = (job.verticals || []).reduce((s, v) => s + ((v.audited || 0)), 0);
  return {
    id: job.id,
    label: job.label,
    status: job.status,
    city: job.city,
    state: job.state,
    worstN: job.worstN,
    quantityPerVertical: job.quantityPerVertical,
    cronSchedule: job.cronSchedule || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    nextRunAt: job.nextRunAt || null,
    totalVerticals: (job.verticals || []).length,
    completedVerticals,
    totalAuditedCandidates,
    worstSitesCount: (job.worstSites || []).length,
    error: job.error || null
  };
}

async function listJobs() {
  const store = await loadStore();
  return store.jobs
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map(summarizeJob);
}

async function getJob(id) {
  const store = await loadStore();
  return store.jobs.find((j) => j.id === id) || null;
}

async function cancelJob(id) {
  const store = await loadStore();
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return null;
  if (['complete', 'failed', 'cancelled'].includes(job.status)) return job;
  job.status = 'cancelled';
  job.cancelledAt = new Date().toISOString();
  // Stop the cron if attached
  if (cronTasks.has(id)) {
    try { cronTasks.get(id).stop(); } catch {}
    cronTasks.delete(id);
  }
  await persistStore();
  return job;
}

/**
 * Create + persist a new job. Does NOT block the caller — the worker loop
 * picks it up next tick.
 *
 * For "cron" kind, we register the cron task that creates a fresh "now" job
 * each time it fires. The cron job itself stays in the store so the user can
 * see "next run at X" + cancel it.
 */
async function createJob(input = {}) {
  const store = await loadStore();
  const now = new Date().toISOString();
  const verticalsList = (Array.isArray(input.verticals) ? input.verticals : [])
    .map((v) => String(v).trim())
    .filter(Boolean);

  // Multi-city: input.cities = [{ city, state }, ...] OR fall back to input.city + input.state
  let citiesList;
  if (Array.isArray(input.cities) && input.cities.length) {
    citiesList = input.cities
      .map((c) => ({ city: String(c.city || '').trim(), state: String(c.state || '').trim() }))
      .filter((c) => c.city && c.state);
  } else if (input.city && input.state) {
    citiesList = [{ city: String(input.city).trim(), state: String(input.state).trim() }];
  } else {
    citiesList = [];
  }
  if (!citiesList.length) throw new Error('at least one city + state pair is required');
  if (!verticalsList.length) throw new Error('at least one vertical is required');
  const kind = input.kind === 'cron' ? 'cron' : 'now';
  if (kind === 'cron' && !cron.validate(String(input.cronSchedule || ''))) {
    throw new Error('cronSchedule is invalid');
  }

  // autoBlastAfter — when sweep completes, fire a targeted email blast to
  // the worst-N domains that have a discoverable email. Optional, defaults off.
  const autoBlastAfter = input.autoBlastAfter
    ? {
        enabled: true,
        maxRecipients: Math.max(10, Math.min(500, Number(input.autoBlastAfter.maxRecipients) || 100)),
        scoreMax: Math.max(20, Math.min(100, Number(input.autoBlastAfter.scoreMax) || 65))
      }
    : null;

  const totalLegs = citiesList.length * verticalsList.length;
  const cityLabel = citiesList.length === 1
    ? `${citiesList[0].city}, ${citiesList[0].state}`
    : `${citiesList.length} cities`;
  const job = {
    id: newJobId(),
    kind, // "now" or "cron"
    label: input.label || `${cityLabel} sweep · ${verticalsList.length} vertical${verticalsList.length === 1 ? '' : 's'} · ${totalLegs} leg${totalLegs === 1 ? '' : 's'}`,
    cities: citiesList,
    // legacy fields kept for backwards-compatible UI rendering
    city: citiesList[0].city,
    state: citiesList[0].state,
    worstN: normalizeWorstN(input.worstN),
    quantityPerVertical: normalizeQuantity(input.quantityPerVertical),
    cronSchedule: kind === 'cron' ? String(input.cronSchedule).trim() : null,
    autoBlastAfter,
    nextRunAt: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    status: kind === 'cron' ? 'cron_active' : 'queued',
    // verticals[] now becomes city × vertical legs
    verticals: citiesList.flatMap((c) => verticalsList.map((v) => ({
      vertical: v,
      city: c.city,
      state: c.state,
      status: 'pending',
      candidates: 0,
      audited: 0,
      failed: 0,
      worstSites: [],
      startedAt: null,
      completedAt: null,
      error: null
    }))),
    worstSites: [],
    autoBlastResult: null,
    error: null
  };

  store.jobs.unshift(job);
  const beforeIds = new Set(store.jobs.map((j) => j.id));
  store.jobs = store.jobs.slice(0, 50);
  const afterIds = new Set(store.jobs.map((j) => j.id));
  for (const id of beforeIds) {
    if (!afterIds.has(id) && cronTasks.has(id)) {
      try { cronTasks.get(id).stop(); } catch {}
      cronTasks.delete(id);
    }
  }
  await persistStore();

  if (kind === 'cron') {
    registerCronJob(job);
  }

  // Kick the worker loop so a "now" job starts immediately.
  if (kind === 'now') startWorkerLoop();

  return job;
}

/**
 * Register a node-cron task that creates a fresh sweep job each time it fires.
 * The recurring job in the store (status=cron_active) is just metadata.
 */
function registerCronJob(cronJob) {
  if (cronTasks.has(cronJob.id)) {
    try { cronTasks.get(cronJob.id).stop(); } catch {}
    cronTasks.delete(cronJob.id);
  }
  try {
    const task = cron.schedule(cronJob.cronSchedule, async () => {
      try {
        await createJob({
          kind: 'now',
          city: cronJob.city,
          state: cronJob.state,
          verticals: cronJob.verticals.map((v) => v.vertical),
          worstN: cronJob.worstN,
          quantityPerVertical: cronJob.quantityPerVertical,
          label: `${cronJob.label} (auto fire)`
        });
      } catch (err) {
        console.warn('[scheduler] cron fire failed for', cronJob.id, ':', err.message);
      }
    });
    cronTasks.set(cronJob.id, task);
  } catch (err) {
    console.warn('[scheduler] failed to register cron for', cronJob.id, ':', err.message);
  }
}

/** Pick the next runnable "now" job, or null. */
function pickNextJob(store) {
  return store.jobs.find((j) => j.kind === 'now' && (j.status === 'queued' || j.status === 'running'));
}

/**
 * Run one job to completion. Each vertical is processed sequentially, with
 * per-vertical concurrency in the discover/audit step.
 */
async function runJob(job) {
  if (!runner) {
    job.status = 'failed';
    job.error = 'scheduler runner not configured';
    job.completedAt = new Date().toISOString();
    await persistStore();
    return;
  }

  job.status = 'running';
  job.startedAt = job.startedAt || new Date().toISOString();
  await persistStore();

  for (const v of job.verticals) {
    // Cancellation check at the start of each vertical
    const fresh = await getJob(job.id);
    if (!fresh || fresh.status === 'cancelled') return;

    if (v.status === 'complete' || v.status === 'failed') continue; // resume case
    v.status = 'running';
    v.startedAt = new Date().toISOString();
    schedulePersistDebounced();

    // Per-leg city/state; falls back to the job-level city/state for
    // legacy single-city jobs created before multi-city support.
    const legCity = v.city || job.city;
    const legState = v.state || job.state;

    try {
      // 1. Discover candidates for this (vertical, city, state)
      const discovered = await runner.discoverFn({
        industry: v.vertical,
        city: legCity,
        state: legState,
        quantity: job.quantityPerVertical
      });
      const candidates = Array.isArray(discovered.candidates) ? discovered.candidates : [];
      v.candidates = candidates.length;

      // 2. Audit each candidate at 4-way concurrency
      const queue = candidates.slice();
      const auditedRows = [];
      let failed = 0;
      async function worker() {
        while (queue.length) {
          const c = queue.shift();
          if (!c) continue;
          try {
            const audit = await runner.auditFn({
              url: c.website || `https://${c.domain}`,
              industry: v.vertical,
              city: legCity,
              state: legState
            });
            if (audit && audit.audit) {
              auditedRows.push({
                domain: c.domain,
                website: c.website,
                businessName: c.businessName || c.domain,
                vertical: v.vertical,
                overallScore: audit.audit.overallScore,
                grade: audit.audit.grade,
                dollarOpportunity: audit.audit.dollarOpportunity || null,
                sectionScores: audit.audit.sectionScores || null,
                phone: (c.contactInfo && c.contactInfo.phones && c.contactInfo.phones[0]) || null,
                email: (c.contactInfo && c.contactInfo.emails && c.contactInfo.emails[0]) || null,
                seoOwner: c.seoProvider && c.seoProvider.classification || null
              });
            } else {
              failed++;
            }
          } catch (err) {
            failed++;
          }
          v.audited = auditedRows.length;
          v.failed = failed;
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()]);

      // 3. Sort worst-first, keep top N for vertical breakdown
      auditedRows.sort((a, b) => (a.overallScore ?? MISSING_AUDIT_SCORE_SENTINEL) - (b.overallScore ?? MISSING_AUDIT_SCORE_SENTINEL));
      v.worstSites = auditedRows.slice(0, PER_VERTICAL_KEEP);

      // 4. Merge into global worst-N for the job
      job.worstSites = [...(job.worstSites || []), ...auditedRows]
        .sort((a, b) => (a.overallScore ?? MISSING_AUDIT_SCORE_SENTINEL) - (b.overallScore ?? MISSING_AUDIT_SCORE_SENTINEL))
        .slice(0, job.worstN);

      v.status = 'complete';
      v.completedAt = new Date().toISOString();
    } catch (err) {
      v.status = 'failed';
      v.error = err && err.message ? err.message : String(err);
      v.completedAt = new Date().toISOString();
    }
    await persistStore();
  }

  // Was the job cancelled mid-flight?
  const finalCheck = await getJob(job.id);
  if (!finalCheck || finalCheck.status === 'cancelled') return;
  job.status = 'complete';
  job.completedAt = new Date().toISOString();
  await persistStore();

  // Auto-blast hook: if the job was created with autoBlastAfter, fire a
  // targeted email blast to the worst-N domains that have an email on file.
  // Failure is non-fatal — sweep is still marked complete.
  if (job.autoBlastAfter && job.autoBlastAfter.enabled && runner.emailBlastFn) {
    try {
      const eligibleDomains = (job.worstSites || [])
        .filter((s) => s.email && (s.overallScore == null || s.overallScore <= job.autoBlastAfter.scoreMax))
        .map((s) => s.domain)
        .filter(Boolean)
        .slice(0, job.autoBlastAfter.maxRecipients);
      if (eligibleDomains.length) {
        const blastJob = await runner.emailBlastFn({
          domains: eligibleDomains,
          runId: job.id,
          reasonTag: 'sweep_auto_blast'
        });
        job.autoBlastResult = {
          blastJobId: blastJob.id,
          enqueuedCount: blastJob.enqueuedCount,
          skippedCount: blastJob.skippedCount,
          firedAt: new Date().toISOString()
        };
      } else {
        job.autoBlastResult = {
          blastJobId: null,
          enqueuedCount: 0,
          skippedCount: 0,
          firedAt: new Date().toISOString(),
          note: 'no eligible domains with email'
        };
      }
      await persistStore();
    } catch (err) {
      job.autoBlastResult = { error: err && err.message ? err.message : 'auto_blast_failed', firedAt: new Date().toISOString() };
      await persistStore();
    }
  }
}

/**
 * Worker loop. Runs at most one job at a time. Sleeps 5s between checks
 * when nothing is queued.
 */
async function startWorkerLoop() {
  if (workerLoopRunning) return;
  workerLoopRunning = true;
  try {
    /* eslint-disable no-constant-condition */
    while (true) {
      const store = await loadStore();
      const job = pickNextJob(store);
      if (!job) {
        workerLoopRunning = false;
        return;
      }
      try {
        await runJob(job);
      } catch (err) {
        job.status = 'failed';
        job.error = err && err.message ? err.message : String(err);
        job.completedAt = new Date().toISOString();
        await persistStore();
      }
    }
  } finally {
    workerLoopRunning = false;
  }
}

/**
 * Boot — wire in the runner functions, re-register cron tasks from disk, and
 * resume any job that was mid-flight when the server died.
 */
async function bootScheduler({ runAuditFn, discoverFn, getVerticalsFn, emailBlastFn = null }) {
  runner = { auditFn: runAuditFn, discoverFn, getVerticalsFn, emailBlastFn };
  const store = await loadStore();

  // Re-register cron jobs
  for (const job of store.jobs) {
    if (job.kind === 'cron' && job.status === 'cron_active' && job.cronSchedule) {
      registerCronJob(job);
    }
  }
  // Reset any "running" job back to queued so the worker picks it up
  for (const job of store.jobs) {
    if (job.status === 'running') {
      job.status = 'queued';
      job.error = job.error || 'resumed after server restart';
    }
  }
  await persistStore();
  // Boot the worker
  startWorkerLoop();
}

module.exports = {
  bootScheduler,
  createJob,
  getJob,
  listJobs,
  cancelJob,
  flattenVerticals,
  normalizeWorstN,
  normalizeQuantity
};
