/**
 * Optional weekly HTML email via Resend. If RESEND_API_KEY is unset, rows go to data/email-outbox.json.
 * Outbox rows carry idempotency keys, attempt metadata, and stable fields for replay.
 */

const {
  enqueueOutboxEntry,
  patchOutboxEntryById,
  stableIdempotencyKey,
  isoWeekUtcKey
} = require('./emailOutbox');

async function appendOutbox(entry) {
  const idempotencyKey = entry.idempotencyKey
    || stableIdempotencyKey([entry.type || 'row', entry.to, entry.subject, entry.reason, entry.domain]);
  return enqueueOutboxEntry({ ...entry, idempotencyKey });
}

/**
 * @param {{ to: string, subject: string, html: string, type?: string, idempotencyKey?: string, dedupeBucket?: string }} opts
 */
async function sendTransactionalEmail(opts) {
  const idempotencyKey = opts.idempotencyKey
    || stableIdempotencyKey([opts.type || 'transactional', opts.to || '', opts.subject || '', opts.dedupeBucket || '']);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const r = await enqueueOutboxEntry({
      type: opts.type || 'transactional',
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      idempotencyKey,
      state: 'queued',
      sent: false
    });
    return { ok: true, mode: 'outbox', duplicate: r.duplicate, entry: r.entry };
  }

  const from = process.env.RESEND_FROM || 'GeoNeo <reports@onboarding.resend.dev>';
  const created = await enqueueOutboxEntry({
    type: opts.type || 'transactional',
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    idempotencyKey,
    state: 'sending',
    sent: false
  });
  const row = created.entry;
  if (created.duplicate && row.state === 'sent') {
    return { ok: true, mode: 'resend', duplicate: true, entry: row };
  }

  const now = new Date().toISOString();
  let res;
  let rawText = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    res = await fetch('https://api.resend.com/emails', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html
      })
    });
    rawText = await res.text();
  } catch (e) {
    clearTimeout(timeoutId);
    await patchOutboxEntryById(row.id, {
      attempts: (row.attempts || 0) + 1,
      lastAttemptAt: now,
      lastError: e.message || 'network_error',
      state: 'failed'
    });
    throw e;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    await patchOutboxEntryById(row.id, {
      attempts: (row.attempts || 0) + 1,
      lastAttemptAt: now,
      lastError: `Resend ${res.status}: ${rawText.slice(0, 800)}`,
      state: 'failed'
    });
    throw new Error(`Resend error ${res.status}: ${rawText}`);
  }

  let body = {};
  try {
    body = JSON.parse(rawText);
  } catch {
    body = {};
  }

  await patchOutboxEntryById(row.id, {
    state: 'sent',
    sent: true,
    attempts: (row.attempts || 0) + 1,
    lastAttemptAt: now,
    lastError: null,
    providerMessageId: body.id || null
  });

  return {
    ok: true,
    mode: 'resend',
    duplicate: false,
    providerMessageId: body.id || null
  };
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildWeeklyScoreEmailHtml({ businessName, domain, score }) {
  const b = score.breakdown || {};
  const rows = Object.keys(b)
    .map((k) => `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(k)}</td><td style="padding:8px;border-bottom:1px solid #eee;"><strong>${escapeHtml(b[k])}</strong></td></tr>`)
    .join('');
  return `
<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="color:#111;">Your GeoNeo visibility score</h1>
  <p>Hi ${escapeHtml(businessName) || 'there'},</p>
  <p>Your latest <strong>GeoNeo Visibility Score</strong> for <strong>${escapeHtml(domain)}</strong> is:</p>
  <p style="font-size:42px;font-weight:800;margin:16px 0;">${escapeHtml(score.overall)}</p>
  <table style="width:100%;border-collapse:collapse;margin-top:16px;">${rows}</table>
  <p style="margin-top:24px;color:#555;">Open your dashboard for history and competitor alerts.</p>
  <p style="margin-top:32px;font-size:13px;color:#999;">GeoNeo · Ozarks home-service visibility</p>
</body></html>`;
}

/**
 * @param {object} auditRecord - latest audit for domain
 * @param {object} scoreResult - calculateVisibilityScore output
 */
async function trySendWeeklyScoreReport(auditRecord, scoreResult) {
  const week = isoWeekUtcKey();
  const siteDomain = (auditRecord.website || '').replace(/^https?:\/\//, '').split('/')[0] || 'your-site';
  const email = auditRecord.businessEmail || auditRecord.email || '';

  if (!email) {
    await enqueueOutboxEntry({
      type: 'weekly_score_skipped',
      idempotencyKey: stableIdempotencyKey(['weekly_score_skipped', siteDomain, week]),
      reason: 'no_email_on_record',
      domain: siteDomain,
      score: scoreResult.overall,
      state: 'skipped',
      sent: false,
      to: '',
      subject: '',
      html: ''
    });
    return { ok: false, reason: 'no_email' };
  }

  const displayDomain = siteDomain;
  const html = buildWeeklyScoreEmailHtml({
    businessName: auditRecord.businessName || auditRecord.company || auditRecord.contactName,
    domain: displayDomain,
    score: scoreResult
  });

  const idempotencyKey = stableIdempotencyKey(['weekly_score_email', displayDomain, week, email.toLowerCase()]);

  return sendTransactionalEmail({
    type: 'weekly_score',
    to: email,
    subject: `Weekly visibility score: ${scoreResult.overall} (${displayDomain})`,
    html,
    idempotencyKey,
    dedupeBucket: week
  });
}

module.exports = {
  sendTransactionalEmail,
  trySendWeeklyScoreReport,
  buildWeeklyScoreEmailHtml,
  appendOutbox
};
