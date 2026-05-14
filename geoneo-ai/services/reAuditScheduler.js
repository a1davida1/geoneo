/**
 * Re-audit scheduler — automatic monthly re-audits + score-drop alerts.
 *
 * Walks the audit archive daily and:
 *   1. Picks every domain where lastAuditedAt > REAUDIT_INTERVAL_DAYS
 *      AND the lead is in stage `won` or qualifier-completed (we only
 *      auto-rerun for known engaged prospects; scratch the rest)
 *   2. Re-runs the full deep audit (re-uses the same pipeline as ad-hoc audit)
 *   3. Compares new overallScore to previous (history[1]):
 *        - drop ≥ ALERT_DROP_THRESHOLD (10) → queue alert email
 *        - rise ≥ ALERT_RISE_THRESHOLD (10) → queue celebration email (Maintenance customers)
 *   4. Saves new audit (auditArchive auto-handles the history append)
 *
 * Bounded to MAX_PER_DAY (default 50) re-audits per tick to avoid blowing
 * the daily SerpAPI/PageSpeed budget. Spreads audits across the day.
 *
 * Cron: default daily at 4am server time. Configurable via REAUDIT_CRON.
 */

const fs = require('fs/promises');
const path = require('path');
const cron = require('node-cron');
const archive = require('./auditArchive');
const outbox = require('./emailOutbox');
const qualifier = require('./qualifier');

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'audit-archive');
const REAUDIT_INTERVAL_DAYS = Number(process.env.REAUDIT_INTERVAL_DAYS) || 30;
// Maintenance customers ($79/mo) get a tighter 7-day cadence so the
// promised "weekly re-score" actually delivers. Configurable via env.
const MAINTENANCE_REAUDIT_INTERVAL_DAYS = Number(process.env.MAINTENANCE_REAUDIT_INTERVAL_DAYS) || 7;
const ALERT_DROP_THRESHOLD = Number(process.env.REAUDIT_ALERT_DROP) || 10;
const ALERT_RISE_THRESHOLD = Number(process.env.REAUDIT_ALERT_RISE) || 10;
const MAX_PER_DAY = Number(process.env.REAUDIT_MAX_PER_DAY) || 50;
const DEFAULT_CRON = process.env.REAUDIT_CRON || '0 4 * * *'; // 4am daily
const PUBLIC_BASE_URL = process.env.GEONEO_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`;
const FROM_NAME = process.env.GEONEO_FROM_NAME || 'GeoNeo Audit Team';

let cronTask = null;
let runner = null; // { runDeepAuditFn(domain) }

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * A lead is "monitored" — auto re-audits run for it — if any of:
 *   - Active Maintenance ($79/mo) customer (maintenanceCustomer === true)
 *   - opted-in via cold_unknown bucket (qualifier flagged opt-in)
 *   - stage = won/booked (paid customer or scheduled call)
 *   - manually flagged record.monitored=true
 *
 * For non-monitored leads, we don't auto-rerun (saves SerpAPI credits).
 */
function isMonitored(record) {
  if (record.maintenanceCustomer === true) return true;
  if (record.monitored === true) return true;
  const stage = record.pipeline?.status;
  if (['won', 'booked'].includes(stage)) return true;
  if (record.qualifierBucket === 'cold_unknown') return true;
  return false;
}

/**
 * Pick the right re-audit interval for this record. Maintenance customers
 * get the weekly cadence (7d default); everyone else gets the monthly
 * default (30d). Returns days as a Number.
 */
function intervalDaysFor(record) {
  if (record.maintenanceCustomer === true) return MAINTENANCE_REAUDIT_INTERVAL_DAYS;
  return REAUDIT_INTERVAL_DAYS;
}

async function loadAllArchiveRecords() {
  let files;
  try { files = await fs.readdir(ARCHIVE_DIR); } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const records = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    try {
      const raw = await fs.readFile(path.join(ARCHIVE_DIR, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.domain) records.push(parsed);
    } catch {}
  }
  return records;
}

function buildAlertEmail({ businessName, domain, prevScore, newScore, drop }) {
  const direction = drop > 0 ? 'dropped' : 'improved';
  const change = Math.abs(drop);
  const url = `${PUBLIC_BASE_URL}/audit-results.html?url=${encodeURIComponent('https://' + domain)}`;
  return {
    subject: `${businessName}: visibility score ${direction} ${change} points (now ${newScore}/100)`,
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
      <div style="max-width:540px;margin:0 auto;padding:24px 18px;">
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
          <p style="margin:0 0 12px;font-size:13px;color:${drop > 0 ? '#dc2626' : '#16a34a'};text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">${drop > 0 ? '⚠ Score drop alert' : '✅ Score improvement'}</p>
          <h2 style="margin:0 0 12px;">${escape(businessName)}</h2>
          <p style="margin:0 0 14px;">Your monthly re-audit just completed. Visibility score ${escape(direction)} <strong>${escape(change)} points</strong>:</p>
          <div style="background:#f1f5f9;border-radius:8px;padding:14px 18px;margin:0 0 14px;">
            <span style="font-size:1.4rem;font-weight:700;color:#94a3b8;">${escape(prevScore)}</span>
            <span style="margin:0 12px;color:#94a3b8;">→</span>
            <span style="font-size:1.6rem;font-weight:800;color:${drop > 0 ? '#dc2626' : '#16a34a'};">${escape(newScore)}</span>
            <span style="font-size:0.95rem;color:#64748b;margin-left:8px;">/100</span>
          </div>
          ${drop > 0 ? `<p style="margin:0 0 14px;color:#475569;">A ${escape(change)}-point drop usually means: a competitor moved up, you broke something on the site, or Google changed how it weights one of the pillars. Re-open the audit to see which pillar dropped.</p>` : `<p style="margin:0 0 14px;color:#475569;">Nice work. Whatever you did is moving the needle.</p>`}
          <p style="margin:24px 0;text-align:center;"><a href="${escape(url)}" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Open the new audit →</a></p>
          <p style="margin:0;font-size:12px;color:#94a3b8;">— ${escape(FROM_NAME)}</p>
        </div>
      </div>
    </body></html>`
  };
}

async function tickReAudits() {
  if (!runner || !runner.runDeepAuditFn) {
    console.warn('[re-audit] runner not configured, skipping tick');
    return;
  }
  const records = await loadAllArchiveRecords();
  const now = Date.now();
  // Pick monitored records whose lastAuditedAt is older than their cohort's
  // interval. Maintenance customers use 7d; everyone else uses 30d.
  // Maintenance customers get priority in the slice (they paid).
  const due = records
    .filter((r) => isMonitored(r))
    .filter((r) => {
      const intervalMs = intervalDaysFor(r) * 24 * 60 * 60 * 1000;
      return r.lastAuditedAt && (now - new Date(r.lastAuditedAt).getTime()) > intervalMs;
    })
    .sort((a, b) => {
      // Maintenance customers first (they're paying), then oldest-first
      if (a.maintenanceCustomer && !b.maintenanceCustomer) return -1;
      if (!a.maintenanceCustomer && b.maintenanceCustomer) return 1;
      return new Date(a.lastAuditedAt) - new Date(b.lastAuditedAt);
    })
    .slice(0, MAX_PER_DAY);

  if (!due.length) {
    console.log('[re-audit] tick: no domains due');
    return;
  }
  const maintCount = due.filter((r) => r.maintenanceCustomer).length;
  console.log(`[re-audit] tick: re-auditing ${due.length} monitored domain(s) (${maintCount} maintenance, ${due.length - maintCount} other)`);

  let alerted = 0;
  let newFindingAlerts = 0;
  for (const record of due) {
    try {
      const url = `https://${record.domain}`;
      // Maintenance customers paid for depth — fire all deep integrations.
      // Other monitored leads (won/booked/cold_unknown) get standard tier.
      const tier = record.maintenanceCustomer ? 'deep' : 'standard';
      const result = await runner.runDeepAuditFn({
        url,
        industry: record.history?.[0]?.industry,
        city: record.history?.[0]?.city,
        state: record.history?.[0]?.state,
        batchMode: false,
        auditDepth: tier
      });
      if (!result?.audit?.overallScore) continue;
      const newScore = result.audit.overallScore;
      // history[0] is now the new audit, history[1] is the prior
      const refreshed = await archive.getDomainHistory(record.domain);
      const prevScore = refreshed?.history?.[1]?.audit?.overallScore;
      const recipient = refreshed?.contactInfo?.emails?.[0] || refreshed?.history?.[0]?.contactInfo?.emails?.[0];
      if (prevScore != null && recipient) {
        const drop = prevScore - newScore; // positive = dropped, negative = improved
        if (drop >= ALERT_DROP_THRESHOLD || drop <= -ALERT_RISE_THRESHOLD) {
          const businessName = refreshed.sourceMeta?.businessName || record.domain;
          const built = buildAlertEmail({ businessName, domain: record.domain, prevScore, newScore, drop });
          const idempotencyKey = `reaudit-alert:${record.domain}:${new Date().toISOString().slice(0, 10)}`;
          await outbox.enqueueOutboxEntry({
            idempotencyKey, type: 'reaudit_alert', to: recipient,
            subject: built.subject, html: built.html,
            domain: record.domain, reason: drop > 0 ? 'score_drop' : 'score_rise'
          });
          alerted++;
        }
        // NEW: detect newly-introduced critical/major findings (regardless of score change)
        const newFindings = detectNewCriticalFindings(refreshed.history?.[0]?.audit, refreshed.history?.[1]?.audit);
        if (newFindings.length && recipient) {
          const businessName = refreshed.sourceMeta?.businessName || record.domain;
          const built = buildNewFindingAlertEmail({ businessName, domain: record.domain, newFindings, currentScore: newScore });
          const idempotencyKey = `reaudit-new-finding:${record.domain}:${new Date().toISOString().slice(0, 10)}`;
          await outbox.enqueueOutboxEntry({
            idempotencyKey, type: 'new_finding_alert', to: recipient,
            subject: built.subject, html: built.html,
            domain: record.domain, reason: 'new_critical_finding'
          });
          newFindingAlerts++;
        }
      }
    } catch (err) {
      console.warn('[re-audit] failed for', record.domain, ':', err && err.message);
    }
  }
  console.log(`[re-audit] tick complete: re-audited ${due.length}, queued ${alerted} score alert(s), ${newFindingAlerts} new-finding alert(s)`);
}

/**
 * Diff two audits — return findings that are in the newer audit, weren't
 * in the older audit, and are severity critical or major. These are the
 * "something just broke" signals worth an immediate alert.
 */
function detectNewCriticalFindings(newAudit, oldAudit) {
  if (!newAudit || !oldAudit) return [];
  const oldKeys = new Set((oldAudit.findings || []).map((f) => f.key || f.id));
  return (newAudit.findings || []).filter((f) => {
    const sev = String(f.severity || '').toLowerCase();
    if (sev !== 'critical' && sev !== 'high' && sev !== 'major') return false;
    return !oldKeys.has(f.key || f.id);
  }).slice(0, 5);
}

function buildNewFindingAlertEmail({ businessName, domain, newFindings, currentScore }) {
  const url = `${PUBLIC_BASE_URL}/audit-results.html?url=${encodeURIComponent('https://' + domain)}`;
  const findingsList = newFindings.map((f) =>
    `<li style="margin:8px 0;"><strong>${escape(f.title)}</strong><br><span style="color:#475569;font-size:0.9rem;">${escape((f.detail || '').slice(0, 200))}</span></li>`
  ).join('');
  return {
    subject: `${businessName}: ${newFindings.length} new critical issue${newFindings.length === 1 ? '' : 's'} detected`,
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
      <div style="max-width:560px;margin:0 auto;padding:24px 18px;">
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
          <p style="margin:0 0 12px;font-size:13px;color:#dc2626;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">⚠ New issues detected</p>
          <h2 style="margin:0 0 12px;">${escape(businessName)}</h2>
          <p style="margin:0 0 14px;">Your weekly re-audit just completed (current score: <strong>${escape(currentScore)}/100</strong>) and found <strong>${escape(newFindings.length)}</strong> critical issue${newFindings.length === 1 ? '' : 's'} that weren't there last week:</p>
          <ol style="padding-left:20px;margin:0 0 18px;color:#0f172a;">${findingsList}</ol>
          <p style="margin:0 0 14px;color:#475569;">Open the dashboard to see what changed and how to fix each one.</p>
          <p style="margin:24px 0;text-align:center;"><a href="${escape(url)}" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Open the new audit →</a></p>
          <p style="margin:0;font-size:12px;color:#94a3b8;">— ${escape(FROM_NAME)}</p>
        </div>
      </div>
    </body></html>`
  };
}

function startReAuditScheduler({ runDeepAuditFn }) {
  runner = { runDeepAuditFn };
  if (cronTask) { try { cronTask.stop(); } catch {} }
  if (!cron.validate(DEFAULT_CRON)) {
    console.warn('[re-audit] invalid cron:', DEFAULT_CRON);
    return;
  }
  cronTask = cron.schedule(DEFAULT_CRON, () => { tickReAudits().catch(() => {}); });
  console.log(`[re-audit] scheduler started · cron=${DEFAULT_CRON} · interval=${REAUDIT_INTERVAL_DAYS}d · alert threshold=${ALERT_DROP_THRESHOLD}pt`);
}

function stopReAuditScheduler() {
  if (cronTask) { try { cronTask.stop(); } catch {} cronTask = null; }
}

module.exports = { startReAuditScheduler, stopReAuditScheduler, tickReAudits };
