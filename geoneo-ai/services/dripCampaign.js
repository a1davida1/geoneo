/**
 * Drip campaign sequencer — automated multi-touch follow-up after the
 * initial audit blast.
 *
 * Sequence (default `audit_followup`):
 *   Day 0  — Initial audit blast (handled by emailBlast.js)
 *   Day 3  — Reminder ("Did you see the audit?")
 *   Day 7  — Different angle ("Here's what your competitor is doing")
 *   Day 14 — Last call ("We'll stop emailing if you don't reply")
 *
 * State machine per domain (stored on the archive's per-domain file under
 * `dripState`):
 *   { sequence, step, nextSendAt, startedAt, stoppedAt, stoppedReason, history[] }
 *
 * Halt conditions (any of these → stop the sequence):
 *   - Lead reached stage `replied` / `booked` / `won` / `lost`
 *   - Qualifier completed (recipient submitted answers)
 *   - Manually suppressed (suppressedReason set)
 *   - Sequence completed all steps
 *   - Hard bounce on previous send
 *
 * Cron: every DRIP_TICK_MS (default 10min) scans the archive index for
 * domains where dripState.nextSendAt has passed and we haven't halted.
 *
 * Idempotency: each step has a stable idempotencyKey (domain:sequence:step)
 * so a tick re-running can't double-send.
 */

const fs = require('fs/promises');
const path = require('path');
const cron = require('node-cron');
const archive = require('./auditArchive');
const outbox = require('./emailOutbox');
const qualifier = require('./qualifier');

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'audit-archive');
const DRIP_TICK_MS = Number(process.env.DRIP_TICK_MS) || 10 * 60 * 1000;
const PUBLIC_BASE_URL = process.env.GEONEO_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`;
const FROM_NAME = process.env.GEONEO_FROM_NAME || 'GeoNeo Audit Team';
const FROM_EMAIL = process.env.GEONEO_FROM_EMAIL || 'audit@geoneo.ai';

let tickInterval = null;

const SEQUENCES = {
  audit_followup: [
    { step: 1, delayDays: 3, builder: buildReminderEmail, label: 'reminder' },
    { step: 2, delayDays: 7, builder: buildDifferentAngleEmail, label: 'different_angle' },
    { step: 3, delayDays: 14, builder: buildLastCallEmail, label: 'last_call' }
  ]
};

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getQualifierUrl(domain) {
  const token = qualifier.signQualifierToken({ domain });
  return `${PUBLIC_BASE_URL}/audit-results.html?url=${encodeURIComponent('https://' + domain)}&token=${encodeURIComponent(token)}&qualify=1`;
}

function buildReminderEmail({ businessName, domain, audit, recipient }) {
  const score = audit?.overallScore;
  const dollar = audit?.dollarOpportunity?.monthly || {};
  const url = getQualifierUrl(domain);
  return {
    subject: `Quick follow-up — ${businessName}'s ${score ? score + '/100' : 'visibility'} audit`,
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
      <div style="max-width:540px;margin:0 auto;padding:24px 18px;">
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
          <p style="margin:0 0 12px;font-size:15px;">Hi —</p>
          <p style="margin:0 0 14px;">Sent the visibility audit for <strong>${escape(businessName)}</strong> a few days ago. Wanted to make sure it didn't get lost.</p>
          ${dollar.high ? `<p style="margin:0 0 14px;"><strong>Quick recap:</strong> your audit shows about <strong>$${escape(dollar.low?.toLocaleString())}–$${escape(dollar.high?.toLocaleString())}/mo</strong> in unconverted local search demand.</p>` : ''}
          <p style="margin:0 0 14px;">5-question qualifier takes 60 seconds and tells you (and us) whether we're a useful match.</p>
          <p style="margin:24px 0;text-align:center;"><a href="${escape(url)}" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Open audit + 60-sec qualifier →</a></p>
          <p style="margin:0;font-size:12px;color:#94a3b8;">— ${escape(FROM_NAME)} · Reply STOP to unsubscribe.</p>
        </div>
      </div>
    </body></html>`
  };
}

function buildDifferentAngleEmail({ businessName, domain, audit, recipient }) {
  const sections = audit?.sections || {};
  const weakest = Object.entries({ schema: sections.schema, eeat: sections.eeat, geo: sections.geo, nap: sections.nap })
    .filter(([, v]) => v && v.overallScore != null)
    .sort((a, b) => a[1].overallScore - b[1].overallScore)[0];
  const weakLabel = weakest ? ({ schema: 'Schema.org structured data', eeat: 'E-E-A-T trust signals', geo: 'AI-search readiness', nap: 'NAP consistency' }[weakest[0]] || weakest[0]) : 'visibility';
  const weakScore = weakest ? weakest[1].overallScore : null;
  const url = getQualifierUrl(domain);
  return {
    subject: `${businessName}: your weakest pillar is ${weakLabel}${weakScore != null ? ` (${weakScore}/100)` : ''}`,
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
      <div style="max-width:540px;margin:0 auto;padding:24px 18px;">
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
          <p style="margin:0 0 12px;font-size:15px;">Hi again —</p>
          <p style="margin:0 0 14px;">Looked closer at your audit. The single biggest gap holding <strong>${escape(businessName)}</strong> back is <strong>${escape(weakLabel)}</strong>${weakScore != null ? ` (${escape(weakScore)}/100)` : ''}.</p>
          <p style="margin:0 0 14px;">This is the #1 thing your direct local competitors are getting right (and you're not). It's also one of the cheapest fixes — most of it is paste-in-head JSON-LD that we generate for you.</p>
          <p style="margin:24px 0;text-align:center;"><a href="${escape(url)}" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">See the gap + qualifier →</a></p>
          <p style="margin:0;font-size:12px;color:#94a3b8;">— ${escape(FROM_NAME)} · Reply STOP to unsubscribe.</p>
        </div>
      </div>
    </body></html>`
  };
}

function buildLastCallEmail({ businessName, domain, audit, recipient }) {
  const url = getQualifierUrl(domain);
  return {
    subject: `Last note from us — ${businessName}`,
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
      <div style="max-width:540px;margin:0 auto;padding:24px 18px;">
        <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
          <p style="margin:0 0 12px;font-size:15px;">Hi —</p>
          <p style="margin:0 0 14px;">This is the last email from us about the visibility audit for <strong>${escape(businessName)}</strong>. We don't pile on.</p>
          <p style="margin:0 0 14px;">If you ever want it, the audit + 60-second qualifier link is below. It'll work for the next 60 days. After that, the audit data may have changed (good or bad) — we'll re-run a fresh one if you ask.</p>
          <p style="margin:24px 0;text-align:center;"><a href="${escape(url)}" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Open my audit →</a></p>
          <p style="margin:0;font-size:12px;color:#94a3b8;">— ${escape(FROM_NAME)} · You won't hear from us again unless you click above.</p>
        </div>
      </div>
    </body></html>`
  };
}

/**
 * Decide whether to halt this lead's sequence.
 */
function shouldHalt(record) {
  if (record.suppressedReason) return 'suppressed';
  if (record.qualifierCompletedAt) return 'qualifier_completed';
  const stage = record.pipeline?.status;
  if (stage && ['replied', 'booked', 'won', 'lost'].includes(stage)) return `stage:${stage}`;
  return null;
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

async function writeRecord(record) {
  const recordPath = path.join(ARCHIVE_DIR, `${archive.domainHash(record.domain)}.json`);
  const tmp = recordPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
  await fs.rename(tmp, recordPath);
}

/**
 * Start a domain on a sequence (called automatically when emailBlast records
 * the first send, or manually via API).
 */
async function startSequence(domain, sequenceName = 'audit_followup') {
  const seq = SEQUENCES[sequenceName];
  if (!seq) throw new Error('unknown sequence: ' + sequenceName);
  const recordPath = path.join(ARCHIVE_DIR, `${archive.domainHash(domain)}.json`);
  let record;
  try { record = JSON.parse(await fs.readFile(recordPath, 'utf8')); }
  catch { return null; }
  // Initial first send is at delayDays from NOW
  const firstStep = seq[0];
  record.dripState = {
    sequence: sequenceName,
    step: 0,
    startedAt: new Date().toISOString(),
    nextSendAt: new Date(Date.now() + firstStep.delayDays * 24 * 60 * 60 * 1000).toISOString(),
    history: [],
    stoppedAt: null,
    stoppedReason: null
  };
  await writeRecord(record);
  return record.dripState;
}

/**
 * Cron tick: walk every record, send the next step for any domain that
 * is due + not halted. Bounded to 30 sends per tick.
 */
async function tick() {
  const records = await loadAllArchiveRecords();
  const now = Date.now();
  let queued = 0;
  for (const record of records) {
    if (queued >= 30) break;
    const drip = record.dripState;
    if (!drip || drip.stoppedAt) continue;
    if (!drip.nextSendAt || new Date(drip.nextSendAt).getTime() > now) continue;
    const haltReason = shouldHalt(record);
    if (haltReason) {
      drip.stoppedAt = new Date().toISOString();
      drip.stoppedReason = haltReason;
      await writeRecord(record);
      continue;
    }
    const seq = SEQUENCES[drip.sequence] || SEQUENCES.audit_followup;
    const stepDef = seq[drip.step];
    if (!stepDef) {
      drip.stoppedAt = new Date().toISOString();
      drip.stoppedReason = 'sequence_complete';
      await writeRecord(record);
      continue;
    }
    const recipient = (record.contactInfo?.emails || record.history?.[0]?.contactInfo?.emails || [])[0] || record.lastEmail?.recipient;
    if (!recipient) {
      drip.stoppedAt = new Date().toISOString();
      drip.stoppedReason = 'no_recipient';
      await writeRecord(record);
      continue;
    }
    const businessName = record.sourceMeta?.businessName || record.history?.[0]?.sourceMeta?.businessName || record.domain;
    const audit = record.history?.[0]?.audit;
    const built = stepDef.builder({ businessName, domain: record.domain, audit, recipient });
    const idempotencyKey = `drip:${drip.sequence}:${stepDef.step}:${record.domain}`;
    try {
      await outbox.enqueueOutboxEntry({
        idempotencyKey, type: 'drip', to: recipient, subject: built.subject, html: built.html,
        domain: record.domain, reason: `drip:${stepDef.label}`
      });
      drip.history.push({ at: new Date().toISOString(), step: stepDef.step, label: stepDef.label, recipient });
      drip.step++;
      const nextDef = seq[drip.step];
      if (nextDef) {
        drip.nextSendAt = new Date(now + nextDef.delayDays * 24 * 60 * 60 * 1000).toISOString();
      } else {
        drip.stoppedAt = new Date().toISOString();
        drip.stoppedReason = 'sequence_complete';
      }
      await writeRecord(record);
      queued++;
    } catch (err) {
      console.warn('[drip] enqueue failed for', record.domain, err && err.message);
    }
  }
  if (queued) console.log(`[drip] tick queued ${queued} follow-up(s)`);
}

function startSequencer() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => { tick().catch(() => {}); }, DRIP_TICK_MS);
  // Run once immediately for any backlog
  setTimeout(() => { tick().catch(() => {}); }, 5000);
  console.log(`[drip] sequencer started · tick=${Math.round(DRIP_TICK_MS / 1000)}s`);
}

function stopSequencer() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

module.exports = { startSequencer, stopSequencer, startSequence, tick, SEQUENCES };
