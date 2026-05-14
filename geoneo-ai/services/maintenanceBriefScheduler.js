/**
 * Maintenance brief scheduler. Every Monday morning, picks every active
 * Maintenance ($79/mo) customer and queues a personalized weekly brief
 * email. Brief shows score delta vs last week, fixes the customer
 * shipped (findings disappeared), new issues that appeared, and the
 * top 3 recommended fixes for this week.
 *
 * Cron: default Monday 8am ET = 13:00 UTC (`0 13 * * 1`). Configurable
 * via MAINTENANCE_BRIEF_CRON env.
 *
 * Idempotency: we tag each enqueued email with a key
 * `maint-brief:{domain}:{YYYY-MM-DD}` so a re-run of the same Monday
 * is a noop in the outbox.
 *
 * Dependency injection: needs runDeepAuditFn so it can opportunistically
 * trigger a fresh audit before building the brief if the latest audit
 * is older than 24h. (Re-audit scheduler runs at 4am, but if it failed
 * for some reason we still want the brief to use fresh data.)
 */

const cron = require('node-cron');
const archive = require('./auditArchive');
const outbox = require('./emailOutbox');
const leadPipeline = require('./leadPipeline');
const auditDiff = require('./auditDiff');
const { renderMaintenanceWeeklyBrief } = require('./customerEmails');

const DEFAULT_CRON = process.env.MAINTENANCE_BRIEF_CRON || '0 13 * * 1'; // Mon 13:00 UTC = 8am/9am ET
const STALE_AUDIT_HOURS = Number(process.env.MAINTENANCE_BRIEF_STALE_HOURS) || 36; // re-audit if older than this
const MAX_PER_TICK = Number(process.env.MAINTENANCE_BRIEF_MAX_PER_TICK) || 200;
const PUBLIC_BASE_URL = process.env.GEONEO_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`;
const FROM_NAME = process.env.GEONEO_FROM_NAME || 'GeoNeo Audit Team';

let cronTask = null;
let runner = null;

/**
 * For a single Maintenance customer, build + queue this week's brief.
 * Returns { ok, queued, reason }.
 */
async function buildAndQueueBriefFor(customer) {
  const domain = customer.domain;
  const recipient = customer.contactEmail;
  if (!recipient) return { ok: false, reason: 'no_recipient' };

  // Pull full history; if newest audit is stale, opportunistically refresh
  let record = await archive.getDomainHistory(domain);
  const newest = record?.history?.[0];
  if (newest) {
    const ageHours = (Date.now() - new Date(newest.audit?.generatedAt || newest.generatedAt || record.lastAuditedAt || 0).getTime()) / (60 * 60 * 1000);
    if (ageHours > STALE_AUDIT_HOURS && runner && runner.runDeepAuditFn) {
      try {
        // Brief opportunistically refreshes for maintenance customers — full deep tier
        await runner.runDeepAuditFn({
          url: `https://${domain}`,
          industry: newest.industry,
          city: newest.city,
          state: newest.state,
          batchMode: false,
          auditDepth: 'deep'
        });
        // Re-read after fresh audit lands
        record = await archive.getDomainHistory(domain);
      } catch (err) {
        console.warn('[maintenance-brief] pre-brief audit failed:', domain, err && err.message);
      }
    }
  }
  if (!record || !record.history || !record.history.length) {
    return { ok: false, reason: 'no_audit_data' };
  }
  const latest = record.history[0];
  const currentScore = latest.audit?.overallScore ?? null;
  if (currentScore == null) return { ok: false, reason: 'no_score' };

  // Diff vs ~7 days ago
  const diff = auditDiff.diffVsNDaysAgo(record.history, 7) || {
    scoreDelta: 0, fixedFindings: [], newFindings: [], summary: { totalFixed: 0, totalNew: 0 }
  };
  const prevScore = diff.comparedAgainst
    ? (record.history.find((h) => (h.audit?.generatedAt || h.generatedAt) === diff.comparedAgainst.generatedAt)?.audit?.overallScore ?? currentScore)
    : currentScore;

  // Recommended top-3 from current findings (severity high first, dollar impact second)
  const findings = (latest.audit?.findings || []).slice();
  const sevRank = { high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => {
    const sa = sevRank[String(a.severity || '').toLowerCase()] || 0;
    const sb = sevRank[String(b.severity || '').toLowerCase()] || 0;
    if (sb !== sa) return sb - sa;
    const da = a.dollarImpact?.monthly?.high || 0;
    const db = b.dollarImpact?.monthly?.high || 0;
    return db - da;
  });
  const top3 = findings.slice(0, 3);

  // Build dashboard link with long-lived signed token
  const qualifierService = require('./qualifier');
  const token = qualifierService.signQualifierToken({ domain, ttlMs: 365 * 24 * 60 * 60 * 1000 });
  const dashboardUrl = `${PUBLIC_BASE_URL}/customer-dashboard.html?token=${encodeURIComponent(token)}`;

  const businessName = customer.businessName || latest.sourceMeta?.businessName || domain;
  const weekOf = new Date().toISOString().slice(0, 10);
  const html = renderMaintenanceWeeklyBrief({
    businessName,
    domain,
    dashboardUrl,
    currentScore,
    prevScore,
    scoreDelta: diff.scoreDelta || 0,
    fixedFindings: diff.fixedFindings,
    newFindings: diff.newFindings,
    top3Recommended: top3,
    weekOf
  });
  const subject = diff.scoreDelta > 0
    ? `${businessName}: visibility up ${diff.scoreDelta}pts this week (${currentScore}/100)`
    : (diff.scoreDelta < 0
      ? `${businessName}: visibility down ${Math.abs(diff.scoreDelta)}pts this week (${currentScore}/100)`
      : `${businessName}: weekly brief — ${currentScore}/100`);
  const idempotencyKey = `maint-brief:${domain}:${weekOf}`;
  try {
    const result = await outbox.enqueueOutboxEntry({
      idempotencyKey,
      type: 'maintenance_weekly_brief',
      to: recipient,
      subject,
      html,
      domain,
      reason: 'maintenance_weekly_brief'
    });
    if (result.duplicate) return { ok: true, queued: false, reason: 'already_queued_this_week' };
    return { ok: true, queued: true };
  } catch (err) {
    return { ok: false, reason: 'enqueue_failed: ' + err.message };
  }
}

/**
 * Tick: pick all active Maintenance customers + build/queue brief for each.
 * Bounded by MAX_PER_TICK so a sudden surge of customers doesn't blow
 * the SerpAPI/PageSpeed budget in one shot.
 */
async function tickMaintenanceBriefs() {
  let customers;
  try {
    customers = await leadPipeline.listMaintenanceCustomers();
  } catch (err) {
    console.warn('[maintenance-brief] failed to list customers:', err && err.message);
    return { ok: false, error: err.message };
  }
  if (!customers.length) {
    console.log('[maintenance-brief] tick: no active Maintenance customers');
    return { ok: true, queued: 0, skipped: 0 };
  }
  const slice = customers.slice(0, MAX_PER_TICK);
  let queued = 0; let skipped = 0; let failed = 0;
  for (const c of slice) {
    const r = await buildAndQueueBriefFor(c);
    if (r.ok && r.queued) queued++;
    else if (r.ok && !r.queued) skipped++;
    else failed++;
  }
  console.log(`[maintenance-brief] tick complete: ${customers.length} customers · ${queued} queued · ${skipped} skipped (already queued or no change) · ${failed} failed`);
  return { ok: true, totalCustomers: customers.length, queued, skipped, failed };
}

function startMaintenanceBriefScheduler({ runDeepAuditFn } = {}) {
  runner = { runDeepAuditFn };
  if (cronTask) try { cronTask.stop(); } catch {}
  if (!cron.validate(DEFAULT_CRON)) {
    console.warn('[maintenance-brief] invalid cron:', DEFAULT_CRON);
    return;
  }
  cronTask = cron.schedule(DEFAULT_CRON, () => { tickMaintenanceBriefs().catch(() => {}); });
  console.log(`[maintenance-brief] scheduler started · cron=${DEFAULT_CRON} · stale_hours=${STALE_AUDIT_HOURS}`);
}

function stopMaintenanceBriefScheduler() {
  if (cronTask) { try { cronTask.stop(); } catch {} cronTask = null; }
}

module.exports = {
  startMaintenanceBriefScheduler,
  stopMaintenanceBriefScheduler,
  tickMaintenanceBriefs,
  buildAndQueueBriefFor
};
