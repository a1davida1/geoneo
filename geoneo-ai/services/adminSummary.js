/**
 * Aggregated read-only snapshot for the /admin operator shell (no secrets).
 */

const path = require('path');
const fs = require('fs/promises');
const { loadAuditRecords } = require('./auditLookup');
const { getEligibleDomains } = require('./weeklyScoreScheduler');

const ROOT = path.join(__dirname, '..');

function dataPath(filename, envOverride) {
  if (envOverride && String(envOverride).trim()) {
    return path.resolve(envOverride);
  }
  return path.join(ROOT, 'data', filename);
}

async function safeJsonRead(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

/**
 * @returns {Promise<object>}
 */
async function loadAdminSummary() {
  const records = await loadAuditRecords();
  const sorted = Array.isArray(records)
    ? records.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    : [];
  const newest = sorted[0];

  const pipelinePath = dataPath('pipeline.json', process.env.GEONEO_PIPELINE_PATH);
  const leadsPath = dataPath('leads.json', process.env.GEONEO_LEADS_PATH);
  const competitorsPath = dataPath('competitors.json', process.env.GEONEO_COMPETITORS_PATH);
  const fixPath = dataPath('fixTracker.json', process.env.GEONEO_FIX_TRACKER_PATH);
  const outboxPath = dataPath('email-outbox.json', process.env.GEONEO_EMAIL_OUTBOX_PATH);
  const runsPath = dataPath('weekly-score-runs.json', process.env.GEONEO_WEEKLY_RUNS_PATH);
  const scoresPath = dataPath('scores.json', process.env.GEONEO_SCORES_PATH);

  const pipeline = await safeJsonRead(pipelinePath, {});
  const leads = await safeJsonRead(leadsPath, []);
  const competitors = await safeJsonRead(competitorsPath, {});
  const fixTracker = await safeJsonRead(fixPath, {});
  const outbox = await safeJsonRead(outboxPath, []);
  const runs = await safeJsonRead(runsPath, []);
  const scores = await safeJsonRead(scoresPath, []);

  const eligible = await getEligibleDomains();

  const outboxStats = {
    queued: 0,
    sending: 0,
    failed: 0,
    sent: 0,
    skipped: 0,
    other: 0
  };
  for (const row of Array.isArray(outbox) ? outbox : []) {
    const s = String(row.state || 'queued');
    if (Object.prototype.hasOwnProperty.call(outboxStats, s)) {
      outboxStats[s] += 1;
    } else {
      outboxStats.other += 1;
    }
  }

  const lastRunFromFile = Array.isArray(runs) && runs.length ? runs[runs.length - 1] : null;

  return {
    generatedAt: new Date().toISOString(),
    dataPaths: {
      audits: process.env.GEONEO_AUDITS_PATH || path.join(ROOT, 'data', 'audits.json'),
      pipeline: pipelinePath,
      leads: leadsPath,
      competitors: competitorsPath,
      fixTracker: fixPath,
      emailOutbox: outboxPath,
      weeklyRuns: runsPath,
      scores: scoresPath
    },
    audits: {
      totalRecords: sorted.length,
      newestCreatedAt: newest?.createdAt || null
    },
    pipeline: { domainsTracked: Object.keys(pipeline).length },
    sessionLeads: { count: Array.isArray(leads) ? leads.length : 0 },
    weeklyScoring: {
      eligibleDomains: eligible.length,
      cron: process.env.WEEKLY_SCORE_CRON || '0 3 * * 1',
      lastRunFromFile: lastRunFromFile
        ? {
            finishedAt: lastRunFromFile.finishedAt,
            domainsConsidered: lastRunFromFile.domainsConsidered,
            domainsScored: lastRunFromFile.domainsScored,
            domainsSkipped: lastRunFromFile.domainsSkipped,
            failuresCount: (lastRunFromFile.failures || []).length
          }
        : null
    },
    competitors: { ownerDomainsTracked: Object.keys(competitors).length },
    fixTracker: { domainsWithItems: Object.keys(fixTracker).length },
    emailOutbox: {
      totalRows: Array.isArray(outbox) ? outbox.length : 0,
      byState: outboxStats,
      tail: (Array.isArray(outbox) ? outbox : []).slice(-8).map((r) => ({
        id: r.id,
        type: r.type,
        state: r.state,
        to: r.to,
        subject: r.subject ? String(r.subject).slice(0, 72) : '',
        queuedAt: r.queuedAt,
        attempts: r.attempts,
        lastError: r.lastError ? String(r.lastError).slice(0, 120) : null
      }))
    },
    scoreHistory: { entries: Array.isArray(scores) ? scores.length : 0 }
  };
}

module.exports = { loadAdminSummary };
