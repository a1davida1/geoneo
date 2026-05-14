/**
 * Email Blast pipeline.
 *
 * Pulls qualified prospects from the audit archive, applies a strict
 * pre-filter to suppress tire-kickers + already-good sites + locked-in
 * agency accounts, generates a per-prospect personalized email with
 * an HMAC-signed qualifier link, and enqueues to the existing
 * email-outbox (data/email-outbox.json) which is sent by the existing
 * pipeline (Resend or stub).
 *
 * Design principles:
 *   - Server-side selection only (UI just displays the result of preview()).
 *   - Idempotency: each email has an idempotencyKey of {blastId}:{domain}
 *     so re-running the same blast can't double-send. The outbox dedupes
 *     by idempotencyKey natively.
 *   - Suppression: domains marked suppressedReason in the archive, or
 *     emailed within SUPPRESS_RECENT_MS, never receive a new email.
 *   - Audit-link signing: every link uses qualifier.signQualifierToken so
 *     submissions can be verified without lookup.
 *   - Dry-run: preview() returns the candidate list + sample email without
 *     touching the outbox.
 *   - Every send marks the archive (recordEmailSent) so subsequent blasts
 *     and preview()s see the prospect as already-emailed.
 *
 * Persistence of blast jobs themselves: data/email-blast-jobs.json so the
 * UI can show "Blast #12 sent 47 emails on 2026-05-11, 8 qualified, 3 hot".
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const archive = require('./auditArchive');
const qualifier = require('./qualifier');
const outbox = require('./emailOutbox');
const drip = require('./dripCampaign');

const JOBS_PATH = path.join(__dirname, '..', 'data', 'email-blast-jobs.json');
const SUPPRESS_RECENT_MS = 30 * 24 * 60 * 60 * 1000; // don't re-email within 30 days
const DEFAULT_FILTER = {
  scoreMax: 65,
  hasEmail: true,
  hasOpportunityAtLeast: 300,
  notSuppressed: true,
  notMaintenanceCustomer: true,       // paying customers never get cold blasts
  seoOwnerNotIn: ['national_agency'], // contract-locked, hard to displace
  notQualified: true                  // already-qualified prospects don't need re-blast
};
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 500;
const PUBLIC_BASE_URL = process.env.GEONEO_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`;
const FROM_NAME = process.env.GEONEO_FROM_NAME || 'GeoNeo Audit Team';
const FROM_EMAIL = process.env.GEONEO_FROM_EMAIL || 'audit@geoneo.ai';
const REPLY_TO = process.env.GEONEO_REPLY_TO || FROM_EMAIL;
const UNSUBSCRIBE_BASE = process.env.GEONEO_UNSUBSCRIBE_URL || `${PUBLIC_BASE_URL}/unsubscribe`;

function newBlastId() {
  return `blast_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Subject variants for A/B testing. Every blast picks one variant per
 * domain deterministically (hash of domain → bucket) so:
 *   - Re-runs of the same blast for the same domain pick the same variant
 *   - Distribution across the population is even (mod-by-N on a SHA1 hash)
 *
 * Each variant is a `(candidate) => string` function so it can use real
 * audit numbers + business name. Track the chosen variantKey in the
 * outbox row so we can correlate opens/replies with subject later.
 */
const SUBJECT_VARIANTS = [
  {
    key: 'v1_dollar_loss',
    desc: 'Dollar-loss-first (loss aversion)',
    render: (c, ctx) => ctx.dollarHigh
      ? `${c.businessName}: $${c.dollarOpportunityLow}-$${c.dollarOpportunityHigh}/mo of ${ctx.cityState || c.industry} demand isn\u2019t reaching you`
      : `${c.businessName}: a quick visibility audit (${c.grade || 'D'} on local search)`
  },
  {
    key: 'v2_score_curiosity',
    desc: 'Score-first (curiosity)',
    render: (c, ctx) => c.overallScore != null
      ? `${c.businessName} scored ${c.overallScore}/100 on the GeoNeo audit — here\u2019s why`
      : `Quick audit: ${c.businessName} on AI search + Google`
  },
  {
    key: 'v3_local_question',
    desc: 'Local-question (community framing)',
    render: (c, ctx) => ctx.cityState
      ? `When ${ctx.cityState} customers search for ${c.industry || 'your services'}, do they find ${c.businessName}?`
      : `Does Google show ${c.businessName} when your customers actually search?`
  },
  {
    key: 'v4_competitor_compare',
    desc: 'Competitor-compare (FOMO)',
    render: (c, ctx) => c.overallScore != null
      ? `${c.businessName} vs your top ${c.industry || 'competitor'} — visibility gap report inside`
      : `${c.businessName}: how you compare to the top ${c.industry || 'competitor'} on local search`
  }
];

function pickSubjectVariant(domain, blastId) {
  // Hash (domain) for stability across blast re-runs of the same domain;
  // including blastId would change the variant per blast which defeats A/B.
  const hash = crypto.createHash('sha1').update(String(domain || '')).digest();
  const bucket = hash[0] % SUBJECT_VARIANTS.length;
  return SUBJECT_VARIANTS[bucket];
}

function clampBatchSize(n) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, v));
}

/**
 * Resolve filter input from the admin UI into the full archive.queryArchive
 * filter object. Defaults are conservative (exclude tire-kickers, exclude
 * agencies, exclude already-qualified, etc).
 */
function buildArchiveFilter(input = {}) {
  const filter = {
    ...DEFAULT_FILTER,
    city: input.city || undefined,
    state: input.state || undefined,
    industry: input.industry || undefined,
    notEmailedSince: new Date(Date.now() - SUPPRESS_RECENT_MS).toISOString(),
    limit: clampBatchSize(input.batchSize || DEFAULT_BATCH_SIZE) * 4 // overshoot to allow dedup
  };
  if (input.scoreMax != null) filter.scoreMax = Number(input.scoreMax);
  if (input.scoreMin != null) filter.scoreMin = Number(input.scoreMin);
  if (input.hasOpportunityAtLeast != null) filter.hasOpportunityAtLeast = Number(input.hasOpportunityAtLeast);
  if (input.includeAgencies === true) filter.seoOwnerNotIn = [];
  if (input.includeAlreadyEmailed === true) {
    delete filter.notEmailedSince;
    filter.neverEmailed = false;
  }
  if (input.includeAlreadyQualified === true) {
    filter.notQualified = false;
  }
  return filter;
}

/**
 * Pick the actual emails to send from the (possibly larger) candidate set.
 * Removes any candidate without a usable email, then takes the worst-N by
 * score (the archive query already sorts worst-first).
 */
function selectFromCandidates(candidates, batchSize) {
  const cap = clampBatchSize(batchSize);
  const usable = (candidates || []).filter((c) => c.primaryEmail && c.domain);
  return usable.slice(0, cap);
}

function pickPrimaryEmail(candidate) {
  return candidate.primaryEmail || (candidate.contactInfo && candidate.contactInfo.emails && candidate.contactInfo.emails[0]) || null;
}

/**
 * Build a single personalized email. Uses real audit numbers + the
 * outreach plan (we already generate this per-candidate during lead-gen)
 * and embeds the qualifier link. No template variables left unfilled —
 * if a field is missing, the line is dropped gracefully.
 */
function buildEmailForCandidate(candidate, { blastId, runId = null }) {
  const domain = candidate.domain;
  const recipient = pickPrimaryEmail(candidate);
  const businessName = candidate.businessName || candidate.companyName || candidate.name || domain;
  const score = candidate.overallScore;
  const grade = candidate.grade;
  const dollarLow = candidate.dollarOpportunityLow ?? null;
  const dollarHigh = candidate.dollarOpportunityHigh ?? null;
  const industry = candidate.industry || 'your business';
  const city = candidate.city || 'your area';
  const state = candidate.state || '';
  const cityState = [city, state].filter(Boolean).join(', ');

  const qualifierToken = qualifier.signQualifierToken({ domain, runId: runId || blastId });
  const qualifierUrl = `${PUBLIC_BASE_URL}/audit-results.html?` +
    `url=${encodeURIComponent('https://' + domain)}` +
    `&industry=${encodeURIComponent(industry)}` +
    `&city=${encodeURIComponent(city)}` +
    `&state=${encodeURIComponent(state)}` +
    `&token=${encodeURIComponent(qualifierToken)}` +
    `&qualify=1`;
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE}?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(qualifierToken)}`;

  const subjectCandidate = {
    businessName,
    industry,
    grade,
    overallScore: score,
    dollarOpportunityLow: dollarLow,
    dollarOpportunityHigh: dollarHigh
  };
  const subjectCtx = { cityState, dollarHigh };
  const variant = pickSubjectVariant(domain, blastId);
  const subject = variant.render(subjectCandidate, subjectCtx);
  const subjectVariantKey = variant.key;

  const dollarLine = dollarHigh
    ? `Your audit shows you\u2019re missing roughly $${dollarLow.toLocaleString()}-$${dollarHigh.toLocaleString()}/month in unconverted local search demand for ${industry} in ${cityState || 'your area'}.`
    : `Your audit shows clear gaps in how ${industry} customers in ${cityState || 'your area'} can find you.`;

  const scoreLine = score != null
    ? `Overall visibility score: ${score}/100 (grade ${grade || 'D'}).`
    : 'See your full visibility breakdown by clicking below.';

  const ownerLine = candidate.seoOwner && candidate.seoOwner !== 'unknown'
    ? `We detected the site is currently in "${candidate.seoOwner.replace(/_/g, ' ')}" hands.`
    : '';

  const body = [
    `Hi — quick note from the GeoNeo audit team.`,
    '',
    dollarLine,
    scoreLine,
    ownerLine,
    '',
    `5 questions takes 60 seconds and tells you (and us) whether we\u2019re a useful match. We score honestly: if you\u2019re happy with your current vendor, we\u2019ll say so and walk away.`,
    '',
    `→ Open your audit + 60-sec qualifier: ${qualifierUrl}`,
    '',
    `Want us to walk you through it on the phone instead? Just reply to this email with "call me" and we\u2019ll ring you within the hour.`,
    '',
    `If you\u2019d rather not hear from us again, click here: ${unsubscribeUrl}`,
    '',
    `— ${FROM_NAME}`
  ].filter(Boolean).join('\n');

  const html = renderHtmlEmail({
    businessName,
    cityState,
    industry,
    score,
    grade,
    dollarLow,
    dollarHigh,
    ownerLine,
    qualifierUrl,
    unsubscribeUrl
  });

  const idempotencyKey = `${blastId}:${domain}`;
  return {
    idempotencyKey,
    type: 'audit_blast',
    to: recipient,
    subject,
    subjectVariantKey,
    html,
    text: body,
    domain,
    score,
    qualifierToken,
    qualifierUrl,
    unsubscribeUrl,
    queuedAt: null,
    blastId
  };
}

function renderHtmlEmail({ businessName, cityState, industry, score, grade, dollarLow, dollarHigh, ownerLine, qualifierUrl, unsubscribeUrl }) {
  const escape = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dollarBlock = dollarHigh
    ? `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;margin:18px 0;border-radius:6px;">
         <div style="font-size:13px;color:#78350f;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Estimated monthly opportunity</div>
         <div style="font-size:24px;font-weight:800;color:#92400e;margin-top:4px;">$${dollarLow.toLocaleString()} – $${dollarHigh.toLocaleString()}/mo</div>
         <div style="font-size:13px;color:#78350f;margin-top:4px;">in unconverted local search demand for ${escape(industry)} in ${escape(cityState || 'your area')}</div>
       </div>`
    : '';
  const scoreBlock = score != null
    ? `<div style="display:flex;align-items:center;gap:14px;margin:14px 0;">
         <div style="width:64px;height:64px;border-radius:50%;border:3px solid ${score < 50 ? '#dc2626' : score < 65 ? '#f59e0b' : '#16a34a'};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;color:#0f172a;">${escape(grade || 'D')}</div>
         <div><div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Overall visibility score</div><div style="font-size:20px;font-weight:700;">${escape(score)}/100</div></div>
       </div>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="max-width:540px;margin:0 auto;padding:24px 18px;">
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <p style="margin:0 0 12px;font-size:15px;">Hi — quick note from the <strong>GeoNeo audit team</strong>.</p>
      <p style="margin:0 0 8px;font-size:15px;">We ran a deep visibility audit on <strong>${escape(businessName)}</strong>.</p>
      ${scoreBlock}
      ${dollarBlock}
      ${ownerLine ? `<p style="margin:0 0 12px;font-size:14px;color:#475569;">${escape(ownerLine)}</p>` : ''}
      <p style="margin:18px 0 8px;font-size:15px;">5 questions, 60 seconds. We score honestly — if you're happy with your current setup, we'll say so and walk away.</p>
      <p style="margin:0 0 14px;">
        <a href="${escape(qualifierUrl)}" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:15px;">Open your audit + 60-sec qualifier →</a>
      </p>
      <p style="margin:0 0 20px;font-size:14px;color:#475569;background:#f1f5f9;padding:10px 14px;border-radius:8px;border-left:3px solid #0369a1;">
        <strong>Prefer to chat?</strong> Hit reply with <em>"call me"</em> and we'll walk you through it on the phone within the hour.
      </p>
      <p style="margin:0;font-size:12px;color:#94a3b8;">
        ${escape(FROM_NAME)} · <a href="${escape(unsubscribeUrl)}" style="color:#94a3b8;">Unsubscribe</a>
      </p>
    </div>
  </div>
</body></html>`;
}

/**
 * Preview a blast: returns the selected candidates (no enqueue) + a sample
 * email rendered for the first candidate. Used by the admin UI before send.
 */
async function preview(input = {}) {
  const filter = buildArchiveFilter(input);
  const { results, totalScanned, totalMatched } = await archive.queryArchive(filter);
  const selected = selectFromCandidates(results, input.batchSize || DEFAULT_BATCH_SIZE);
  const sample = selected.length ? buildEmailForCandidate(selected[0], { blastId: 'preview' }) : null;
  return {
    filter,
    totalScanned,
    totalMatched,
    selectedCount: selected.length,
    selected: selected.map((c) => ({
      domain: c.domain,
      businessName: c.businessName || c.domain,
      city: c.city,
      state: c.state,
      industry: c.industry,
      overallScore: c.overallScore,
      grade: c.grade,
      seoOwner: c.seoOwner,
      primaryEmail: c.primaryEmail,
      dollarOpportunity: { low: c.dollarOpportunityLow, high: c.dollarOpportunityHigh }
    })),
    sampleEmail: sample ? { subject: sample.subject, text: sample.text, html: sample.html, qualifierUrl: sample.qualifierUrl, to: sample.to } : null
  };
}

/**
 * Send a blast. Each candidate gets an entry in the email outbox + the
 * archive is marked emailSent. Persists a job summary so the UI can list
 * past blasts. dryRun=true returns the same shape but skips outbox enqueue
 * and archive marks.
 */
async function send(input = {}) {
  const blastId = newBlastId();
  const dryRun = Boolean(input.dryRun);
  const filter = buildArchiveFilter(input);
  const { results, totalMatched } = await archive.queryArchive(filter);
  const selected = selectFromCandidates(results, input.batchSize || DEFAULT_BATCH_SIZE);
  const queuedAt = new Date().toISOString();
  const enqueued = [];
  const skipped = [];
  for (const c of selected) {
    const emailRow = buildEmailForCandidate(c, { blastId, runId: input.runId });
    if (!emailRow.to) {
      skipped.push({ domain: c.domain, reason: 'no_email' });
      continue;
    }
    if (dryRun) {
      enqueued.push({ ...emailRow, dryRun: true });
      continue;
    }
    try {
      const queue = await outbox.enqueueOutboxEntry({
        idempotencyKey: emailRow.idempotencyKey,
        type: emailRow.type,
        to: emailRow.to,
        subject: emailRow.subject,
        subjectVariantKey: emailRow.subjectVariantKey,
        html: emailRow.html,
        domain: emailRow.domain,
        score: emailRow.score,
        reason: 'audit_blast',
        queuedAt
      });
      if (queue.duplicate) {
        skipped.push({ domain: c.domain, reason: 'already_in_outbox' });
        continue;
      }
      await archive.recordEmailSent(c.domain, { runId: blastId, recipient: emailRow.to });
      // Auto-start the audit_followup drip sequence so day-3/7/14 reminders
      // fire if the prospect doesn't respond. Halted automatically when they
      // qualify or stage advances.
      drip.startSequence(c.domain, 'audit_followup').catch(() => {});
      enqueued.push({
        idempotencyKey: emailRow.idempotencyKey,
        domain: c.domain,
        to: emailRow.to,
        subject: emailRow.subject,
        subjectVariantKey: emailRow.subjectVariantKey,
        score: emailRow.score
      });
    } catch (err) {
      skipped.push({ domain: c.domain, reason: 'enqueue_error: ' + (err && err.message ? err.message : 'unknown') });
    }
  }
  const job = {
    id: blastId,
    createdAt: queuedAt,
    dryRun,
    filter,
    totalMatched,
    selectedCount: selected.length,
    enqueuedCount: enqueued.length,
    skippedCount: skipped.length,
    enqueued: enqueued.map((e) => ({ domain: e.domain, to: e.to, subject: e.subject, subjectVariantKey: e.subjectVariantKey, score: e.score })),
    skipped
  };
  if (!dryRun) await persistJob(job);
  return job;
}

let jobsCache = null;
async function loadJobs() {
  if (jobsCache) return jobsCache;
  try {
    const raw = await fs.readFile(JOBS_PATH, 'utf8');
    if (!raw.trim()) { jobsCache = { jobs: [] }; return jobsCache; }
    jobsCache = { jobs: JSON.parse(raw).jobs || [] };
  } catch (err) {
    if (err && err.code !== 'ENOENT') console.warn('[email-blast] jobs read failed:', err.message);
    jobsCache = { jobs: [] };
  }
  return jobsCache;
}

async function persistJob(job) {
  const store = await loadJobs();
  store.jobs.unshift(job);
  store.jobs = store.jobs.slice(0, 100);
  await fs.mkdir(path.dirname(JOBS_PATH), { recursive: true });
  const tmp = `${JOBS_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmp, JOBS_PATH);
}

async function listJobs() {
  const store = await loadJobs();
  return store.jobs;
}

/**
 * Send a blast targeted at a specific list of domains (skips the city/state
 * filter — caller has already done the selection in the UI). Each domain is
 * looked up in the archive to get its latest audit + contacts; if a domain
 * has no archive record yet (e.g. user marked it before the audit ran),
 * it's skipped with reason "no_archive_record".
 *
 * Used by the "Blast all kept" bulk action on Prospect Hunter cards and by
 * the auto-blast-after-sweep hook in the scheduler.
 */
async function sendTargeted({ domains = [], dryRun = false, runId = null, reasonTag = 'targeted' } = {}) {
  const blastId = newBlastId();
  const queuedAt = new Date().toISOString();
  const enqueued = [];
  const skipped = [];
  for (const rawDomain of domains) {
    const domain = String(rawDomain || '').trim().toLowerCase();
    if (!domain) { skipped.push({ domain: rawDomain, reason: 'invalid_domain' }); continue; }
    const record = await archive.getDomainHistory(domain);
    if (!record || !record.history || !record.history.length) {
      skipped.push({ domain, reason: 'no_archive_record' });
      continue;
    }
    const latest = record.history[0];
    // Build a candidate-shaped object for buildEmailForCandidate
    const candidate = {
      domain,
      businessName: latest.sourceMeta?.businessName || domain,
      city: latest.city,
      state: latest.state,
      industry: latest.industry,
      overallScore: latest.audit?.overallScore ?? null,
      grade: latest.audit?.grade ?? null,
      dollarOpportunityHigh: latest.audit?.dollarOpportunity?.monthly?.high ?? null,
      dollarOpportunityLow: latest.audit?.dollarOpportunity?.monthly?.low ?? null,
      seoOwner: latest.seoProvider?.classification ?? null,
      primaryEmail: latest.contactInfo?.emails?.[0] ?? null,
      contactInfo: latest.contactInfo
    };
    const emailRow = buildEmailForCandidate(candidate, { blastId, runId });
    if (!emailRow.to) { skipped.push({ domain, reason: 'no_email' }); continue; }
    if (dryRun) { enqueued.push({ ...emailRow, dryRun: true }); continue; }
    try {
      const queue = await outbox.enqueueOutboxEntry({
        idempotencyKey: emailRow.idempotencyKey,
        type: emailRow.type,
        to: emailRow.to,
        subject: emailRow.subject,
        subjectVariantKey: emailRow.subjectVariantKey,
        html: emailRow.html,
        domain: emailRow.domain,
        score: emailRow.score,
        reason: `audit_blast:${reasonTag}`,
        queuedAt
      });
      if (queue.duplicate) { skipped.push({ domain, reason: 'already_in_outbox' }); continue; }
      await archive.recordEmailSent(domain, { runId: blastId, recipient: emailRow.to });
      enqueued.push({
        idempotencyKey: emailRow.idempotencyKey,
        domain,
        to: emailRow.to,
        subject: emailRow.subject,
        subjectVariantKey: emailRow.subjectVariantKey,
        score: emailRow.score
      });
    } catch (err) {
      skipped.push({ domain, reason: 'enqueue_error: ' + (err && err.message ? err.message : 'unknown') });
    }
  }
  const job = {
    id: blastId,
    createdAt: queuedAt,
    dryRun,
    targeted: true,
    reasonTag,
    runId,
    requestedCount: domains.length,
    selectedCount: domains.length,
    enqueuedCount: enqueued.length,
    skippedCount: skipped.length,
    enqueued: enqueued.map((e) => ({ domain: e.domain, to: e.to, subject: e.subject, score: e.score })),
    skipped
  };
  if (!dryRun) await persistJob(job);
  return job;
}

/**
 * Aggregate subject-variant performance across all past blast jobs.
 * Returns one row per variantKey: enqueued count + delivered count
 * (delivered comes from the outbox row state once sender lands them).
 *
 * Note: open/reply attribution requires inbound webhook (Resend webhooks
 * for opens, /api/inbound/email for replies). Until those land, this
 * shows volume + delivery status only — but it's enough to spot
 * "variant 3 had 50% lower bounce rate" type signals.
 */
async function subjectVariantStats() {
  const outboxModule = require('./emailOutbox');
  const [jobs, outboxRows] = await Promise.all([
    listJobs(),
    outboxModule.loadOutbox()
  ]);
  const stats = SUBJECT_VARIANTS.reduce((acc, v) => {
    acc[v.key] = { variantKey: v.key, desc: v.desc, enqueued: 0, sent: 0, sentStub: 0, failed: 0, retrying: 0, queued: 0 };
    return acc;
  }, {});
  // From blast jobs: count enqueued per variant
  for (const job of jobs || []) {
    for (const e of (job.enqueued || [])) {
      const k = e.subjectVariantKey;
      if (k && stats[k]) stats[k].enqueued++;
    }
  }
  // From outbox: status per variant
  for (const row of outboxRows || []) {
    const k = row.subjectVariantKey;
    if (!k || !stats[k]) continue;
    if (row.state === 'sent') stats[k].sent++;
    else if (row.state === 'sent_stub') stats[k].sentStub++;
    else if (row.state === 'failed') stats[k].failed++;
    else if (row.state === 'retrying' || row.state === 'sending') stats[k].retrying++;
    else stats[k].queued++;
  }
  return Object.values(stats);
}

module.exports = {
  preview,
  send,
  sendTargeted,
  listJobs,
  buildEmailForCandidate,
  buildArchiveFilter,
  pickSubjectVariant,
  subjectVariantStats,
  SUBJECT_VARIANTS,
  DEFAULT_FILTER,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE
};
