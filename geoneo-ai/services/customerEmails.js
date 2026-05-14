/**
 * Customer-facing email templates.
 *
 * Used by the qualifier CTA endpoints (/api/customer/send-proposal, /send-full-report,
 * /optin-monthly) and by the Fix Plan delivery (/api/customer/fix-plan).
 *
 * Hand-written HTML with minimal inline styles so they render reliably across
 * mobile + desktop + dark-mode email clients. Always include unsubscribe.
 */

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderProposalEmail({ businessName, domain, audit }) {
  const score = audit?.overallScore;
  const grade = audit?.grade;
  const dollar = audit?.dollarOpportunity?.monthly || {};
  const top = (audit?.topFiveFindings || []).slice(0, 3);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="max-width:580px;margin:0 auto;padding:24px 18px;">
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <p style="margin:0 0 12px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">1-page audit + ROI proposal</p>
      <h1 style="margin:0 0 6px;font-size:1.5rem;">${escape(businessName)}</h1>
      <p style="margin:0 0 18px;color:#475569;font-size:0.95rem;">${escape(domain)}</p>
      ${score != null ? `<div style="background:#f1f5f9;padding:14px 18px;border-radius:8px;margin-bottom:14px;"><strong>Visibility score:</strong> ${escape(score)}/100 · grade ${escape(grade || '—')}</div>` : ''}
      ${dollar.high ? `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:14px 18px;margin-bottom:14px;border-radius:6px;">
        <div style="font-size:13px;color:#78350f;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Estimated monthly opportunity</div>
        <div style="font-size:1.75rem;font-weight:800;color:#92400e;margin-top:4px;">$${escape(dollar.low?.toLocaleString())} – $${escape(dollar.high?.toLocaleString())}/mo</div>
      </div>` : ''}
      ${top.length ? `<h3 style="margin:18px 0 6px;font-size:1.1rem;">Top fixes (priority order)</h3>
      <ol style="padding-left:20px;margin:0 0 18px;">${top.map((f) => `<li style="margin:8px 0;"><strong>${escape(f.title)}</strong>${f.dollarImpact?.monthly?.high ? ` <span style="color:#16a34a;">($${escape(f.dollarImpact.monthly.low)}–$${escape(f.dollarImpact.monthly.high)}/mo)</span>` : ''}<br><span style="color:#475569;font-size:0.9rem;">${escape(f.detail || '')}</span></li>`).join('')}</ol>` : ''}
      <h3 style="margin:18px 0 6px;font-size:1.1rem;">ROI math</h3>
      <p style="margin:0 0 18px;font-size:0.95rem;color:#475569;">$199 one-time Fix Plan recovers a fraction of one month's lost demand. The math is in your favor by 5–20×.</p>
      <p style="margin:24px 0 0;text-align:center;"><a href="https://geoneo.ai/pricing.html#fix-plan" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">See the $199 Fix Plan →</a></p>
      <p style="margin:24px 0 0;font-size:0.78rem;color:#94a3b8;text-align:center;">Forward this proposal to whoever decides on marketing.</p>
    </div>
  </div>
</body></html>`;
}

function renderFullReportEmail({ businessName, domain, audit }) {
  const score = audit?.overallScore;
  const findings = (audit?.findings || []).slice(0, 12);
  const dollar = audit?.dollarOpportunity?.monthly || {};
  const sections = audit?.sections || {};
  const sectionLine = (k, label) => sections[k]?.overallScore != null
    ? `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;">${escape(label)}</td><td style="text-align:right;font-weight:700;">${escape(sections[k].overallScore)}/100</td></tr>` : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="max-width:620px;margin:0 auto;padding:24px 18px;">
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <p style="margin:0 0 12px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Full visibility audit + DIY checklist</p>
      <h1 style="margin:0 0 6px;font-size:1.5rem;">${escape(businessName)}</h1>
      <p style="margin:0 0 18px;color:#475569;">${escape(domain)} · score ${escape(score ?? '—')}/100${dollar.high ? ` · $${escape(dollar.low)}–$${escape(dollar.high)}/mo opportunity` : ''}</p>

      <h3 style="margin:18px 0 6px;font-size:1.05rem;">Pillar scores</h3>
      <table style="width:100%;border-collapse:collapse;font-size:0.92rem;">
        <tbody>
          ${sectionLine('schema', 'Schema.org structured data')}
          ${sectionLine('eeat', 'E-E-A-T (trust signals)')}
          ${sectionLine('geo', 'AI-search readiness (GEO)')}
          ${sectionLine('nap', 'NAP consistency (Name/Address/Phone)')}
          ${sectionLine('sitemap', 'Sitemap.xml quality')}
          ${sectionLine('images', 'Image audit (alt text, format, CLS)')}
          ${sectionLine('performance', 'Page performance (Core Web Vitals)')}
          ${sectionLine('content', 'Content quality (grammar, clarity)')}
        </tbody>
      </table>

      <h3 style="margin:24px 0 6px;font-size:1.05rem;">DIY checklist — top ${findings.length} fixes you can do this week</h3>
      <ol style="padding-left:20px;margin:0 0 18px;">${findings.map((f) => `<li style="margin:8px 0;"><strong>${escape(f.title)}</strong> <span style="background:#e0e7ff;color:#3730a3;font-size:0.7rem;padding:1px 6px;border-radius:999px;font-weight:700;text-transform:uppercase;">${escape(f.severity || 'low')}</span><br><span style="color:#475569;font-size:0.9rem;">${escape(f.detail || '')}</span></li>`).join('')}</ol>

      <p style="margin:24px 0 0;background:#f1f5f9;padding:14px 18px;border-radius:8px;font-size:0.92rem;color:#475569;">Want us to do these for you? The $199 Fix Plan ships exact code-paste blocks + 2 months of Maintenance free.</p>
      <p style="margin:14px 0 0;text-align:center;"><a href="https://geoneo.ai/pricing.html#fix-plan" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">See pricing →</a></p>
    </div>
  </div>
</body></html>`;
}

function renderOptInEmail({ businessName, domain }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="max-width:520px;margin:0 auto;padding:24px 18px;">
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 12px;font-size:1.4rem;">✅ You're opted in for monthly re-audits</h2>
      <p style="margin:0 0 14px;font-size:1rem;">We'll re-audit <strong>${escape(domain)}</strong> for ${escape(businessName)} every 30 days.</p>
      <p style="margin:0 0 14px;color:#475569;font-size:0.95rem;">You'll only hear from us when:</p>
      <ul style="padding-left:20px;color:#475569;font-size:0.95rem;">
        <li>Your visibility score moves more than 5 points</li>
        <li>A new high-impact issue appears</li>
        <li>A new feature in the audit could help your business</li>
      </ul>
      <p style="margin:18px 0 0;font-size:0.85rem;color:#94a3b8;">We never share or sell your contact info. Unsubscribe by replying with "STOP".</p>
    </div>
  </div>
</body></html>`;
}

/**
 * Onboarding email sent the moment a $79/mo Maintenance customer is
 * activated. Sets expectations: weekly re-audit, weekly brief, fix
 * tracker, dashboard link. Bookmark-the-dashboard CTA up top.
 */
function renderMaintenanceOnboardingEmail({ businessName, domain, dashboardUrl }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="max-width:580px;margin:0 auto;padding:24px 18px;">
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <p style="margin:0 0 12px;font-size:13px;color:#16a34a;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;">✓ Maintenance is live</p>
      <h1 style="margin:0 0 6px;font-size:1.5rem;">Welcome, ${escape(businessName)}</h1>
      <p style="margin:0 0 18px;color:#475569;">${escape(domain)}</p>

      <p style="margin:0 0 14px;">Here's what happens automatically from today on:</p>
      <ul style="padding-left:20px;margin:0 0 18px;color:#475569;">
        <li style="margin:6px 0;"><strong>Every Monday:</strong> we re-run your full visibility audit. Score + pillars refresh.</li>
        <li style="margin:6px 0;"><strong>Every Monday morning:</strong> brief email lands in your inbox. What changed, what to fix.</li>
        <li style="margin:6px 0;"><strong>Anytime:</strong> open your dashboard to see history, fix tracker, and run an on-demand re-audit.</li>
        <li style="margin:6px 0;"><strong>Score drops 10+ pts:</strong> instant alert email so you can react.</li>
      </ul>

      <p style="margin:24px 0;text-align:center;">
        <a href="${escape(dashboardUrl)}" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Open my dashboard →</a>
      </p>
      <p style="margin:0 0 4px;font-size:0.85rem;color:#475569;"><strong>Bookmark this link.</strong> It's your permanent access — works without a password.</p>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
      <p style="margin:0 0 6px;font-size:0.85rem;color:#475569;"><strong>Cancel anytime.</strong> Reply to this email with "cancel" and we'll stop charging + stop sending. No contracts, no hassle.</p>
      <p style="margin:0;font-size:0.78rem;color:#94a3b8;">— GeoNeo Maintenance Team</p>
    </div>
  </div>
</body></html>`;
}

/**
 * Weekly brief — the Monday delivery. Shows: score delta, top fixes
 * the customer made (findings disappeared), new issues that appeared,
 * recommended priorities for this week.
 */
function renderMaintenanceWeeklyBrief({ businessName, domain, dashboardUrl, currentScore, prevScore, scoreDelta, fixedFindings, newFindings, top3Recommended, weekOf }) {
  const deltaArrow = scoreDelta > 0 ? '▲' : (scoreDelta < 0 ? '▼' : '—');
  const deltaColor = scoreDelta > 0 ? '#16a34a' : (scoreDelta < 0 ? '#dc2626' : '#94a3b8');
  const deltaText = scoreDelta === 0 ? 'no change' : `${deltaArrow} ${Math.abs(scoreDelta)} pts`;
  const fixedBlock = (fixedFindings || []).length
    ? `<h3 style="margin:18px 0 6px;font-size:1.05rem;color:#16a34a;">✓ You fixed ${fixedFindings.length} issue${fixedFindings.length === 1 ? '' : 's'}</h3>
       <ul style="padding-left:20px;margin:0 0 14px;color:#475569;">${fixedFindings.slice(0, 5).map((f) => `<li style="margin:4px 0;">${escape(f.title)}</li>`).join('')}</ul>`
    : '';
  const newBlock = (newFindings || []).length
    ? `<h3 style="margin:18px 0 6px;font-size:1.05rem;color:#dc2626;">⚠ ${newFindings.length} new issue${newFindings.length === 1 ? '' : 's'} appeared</h3>
       <ul style="padding-left:20px;margin:0 0 14px;color:#475569;">${newFindings.slice(0, 5).map((f) => `<li style="margin:4px 0;"><strong>${escape(f.title)}</strong>${f.severity ? ` <span style="font-size:0.72rem;color:#94a3b8;text-transform:uppercase;">(${escape(f.severity)})</span>` : ''}</li>`).join('')}</ul>`
    : '';
  const recBlock = (top3Recommended || []).length
    ? `<h3 style="margin:18px 0 6px;font-size:1.05rem;">🎯 This week's top 3</h3>
       <ol style="padding-left:20px;margin:0 0 14px;color:#475569;">${top3Recommended.slice(0, 3).map((f) => `<li style="margin:6px 0;"><strong>${escape(f.title)}</strong>${f.dollarImpact?.monthly?.high ? ` <span style="color:#16a34a;font-weight:600;">+$${escape(f.dollarImpact.monthly.low)}–$${escape(f.dollarImpact.monthly.high)}/mo</span>` : ''}<br><span style="font-size:0.9rem;">${escape((f.detail || '').slice(0, 200))}</span></li>`).join('')}</ol>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="max-width:600px;margin:0 auto;padding:24px 18px;">
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <p style="margin:0 0 6px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Weekly brief · ${escape(weekOf)}</p>
      <h1 style="margin:0 0 4px;font-size:1.4rem;">${escape(businessName)}</h1>
      <p style="margin:0 0 18px;color:#475569;font-size:0.92rem;">${escape(domain)}</p>

      <div style="background:#f1f5f9;border-radius:10px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
        <div>
          <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Score this week</div>
          <div style="font-size:2rem;font-weight:800;line-height:1;">${escape(currentScore)}<span style="font-size:1rem;color:#94a3b8;">/100</span></div>
        </div>
        <div style="border-left:1px solid #cbd5e1;padding-left:14px;">
          <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">vs last week (${escape(prevScore)})</div>
          <div style="font-size:1.1rem;font-weight:700;color:${deltaColor};">${deltaText}</div>
        </div>
      </div>

      ${fixedBlock}
      ${newBlock}
      ${recBlock}

      <p style="margin:24px 0;text-align:center;">
        <a href="${escape(dashboardUrl)}" style="display:inline-block;background:#0369a1;color:white;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;">Open my dashboard →</a>
      </p>
      <p style="margin:0;font-size:0.78rem;color:#94a3b8;text-align:center;">— GeoNeo Maintenance Team</p>
    </div>
  </div>
</body></html>`;
}

/**
 * Cancellation acknowledgment. Sent when a customer's Maintenance is
 * ended (manual toggle or future Stripe webhook). Reassures + leaves
 * the door open for a comeback.
 */
function renderMaintenanceCancellationEmail({ businessName, domain }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="max-width:540px;margin:0 auto;padding:24px 18px;">
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <p style="margin:0 0 12px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Maintenance ended</p>
      <h2 style="margin:0 0 14px;font-size:1.3rem;">All done, ${escape(businessName)}.</h2>
      <p style="margin:0 0 14px;color:#475569;">We've ended your $79/mo Maintenance for <strong>${escape(domain)}</strong>. No more charges, no more weekly emails.</p>
      <p style="margin:0 0 14px;color:#475569;">Your dashboard link stays live for one more month so you can grab anything you need (history, fix tracker notes, latest audit). After that, you'd need a fresh audit to re-engage.</p>
      <p style="margin:18px 0 0;color:#475569;">If we got anything wrong, just reply. We'd rather fix it than lose you.</p>
      <p style="margin:14px 0 0;font-size:0.78rem;color:#94a3b8;">— GeoNeo Maintenance Team</p>
    </div>
  </div>
</body></html>`;
}

module.exports = {
  renderProposalEmail,
  renderFullReportEmail,
  renderOptInEmail,
  renderMaintenanceOnboardingEmail,
  renderMaintenanceWeeklyBrief,
  renderMaintenanceCancellationEmail
};
