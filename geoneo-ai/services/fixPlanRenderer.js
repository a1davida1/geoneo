/**
 * Fix Plan renderer — generates the full $199 deliverable as a printable
 * HTML page from the audit archive.
 *
 * Includes:
 *   - Cover with score, dollar opportunity, business name
 *   - 8-pillar score breakdown
 *   - Top 5 prioritized fixes with effort + impact + paste-ready snippets
 *   - All findings (full list)
 *   - Generated assets (LocalBusiness JSON-LD, llms.txt, Organization, etc)
 *     with copy-paste blocks
 *   - Implementation roadmap by week
 *   - "What to expect" section (timeline + measurement)
 *
 * Designed to print to PDF cleanly. Customer can save the URL or print.
 */

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pillarRow(label, score) {
  if (score == null) return '';
  const color = score >= 75 ? '#16a34a' : score >= 50 ? '#d97706' : '#dc2626';
  return `<tr><td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">${escape(label)}</td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #e2e8f0;font-weight:700;color:${color};">${escape(score)}/100</td></tr>`;
}

function findingBlock(f, idx) {
  const sev = f.severity || 'low';
  const sevColor = sev === 'high' ? '#dc2626' : sev === 'medium' ? '#d97706' : '#64748b';
  const dollar = f.dollarImpact?.monthly;
  const snippet = f.snippet || f.generatedJsonLd;
  return `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:1.25rem;margin-bottom:1rem;page-break-inside:avoid;">
    <h3 style="margin:0 0 0.5rem;display:flex;align-items:baseline;gap:0.6rem;">
      <span style="background:#0369a1;color:white;width:30px;height:30px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:0.95rem;font-weight:700;">${idx + 1}</span>
      <span style="flex:1;">${escape(f.title)}</span>
      <span style="background:${sevColor}1a;color:${sevColor};font-size:0.7rem;padding:2px 8px;border-radius:999px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;">${escape(sev)}</span>
    </h3>
    ${f.detail ? `<p style="margin:0.5rem 0;color:#475569;">${escape(f.detail)}</p>` : ''}
    <div style="display:flex;gap:1rem;flex-wrap:wrap;font-size:0.85rem;color:#64748b;margin:0.75rem 0;">
      ${f.effortMinutes ? `<span><strong>Effort:</strong> ${escape(f.effortMinutes)} min</span>` : ''}
      ${dollar?.high ? `<span><strong style="color:#16a34a;">Recovers:</strong> $${escape(dollar.low)}–$${escape(dollar.high)}/mo</span>` : ''}
      ${f.section ? `<span><strong>Pillar:</strong> ${escape(f.section)}</span>` : ''}
    </div>
    ${snippet ? `<div style="background:#0f172a;color:#bbf7d0;padding:1rem 1.25rem;border-radius:8px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:0.78rem;line-height:1.55;white-space:pre-wrap;word-break:break-all;overflow-x:auto;"><div style="color:#475569;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">Paste this:</div>${escape(snippet)}</div>` : ''}
    ${f.evidence && Array.isArray(f.evidence) && f.evidence.length ? `<details style="margin-top:0.75rem;"><summary style="cursor:pointer;color:#0369a1;font-size:0.85rem;">Evidence (${f.evidence.length})</summary><ul style="margin:0.5rem 0 0;padding-left:1.25rem;font-size:0.85rem;color:#475569;">${f.evidence.slice(0, 6).map((e) => `<li>${escape(typeof e === 'string' ? e : e.message || JSON.stringify(e))}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

function assetBlock(label, content, lang) {
  if (!content) return '';
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  return `<div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:1.25rem;margin-bottom:1rem;page-break-inside:avoid;">
    <h3 style="margin:0 0 0.5rem;font-size:1.05rem;">${escape(label)}</h3>
    <p style="margin:0 0 0.75rem;color:#475569;font-size:0.88rem;">Paste this in your site's <code>&lt;head&gt;</code> ${lang === 'txt' ? 'or save as the file shown' : ''}.</p>
    <div style="background:#0f172a;color:#bbf7d0;padding:1rem 1.25rem;border-radius:8px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:0.78rem;line-height:1.55;white-space:pre-wrap;word-break:break-all;overflow-x:auto;">${escape(text)}</div>
  </div>`;
}

function renderFixPlan({ businessName, domain, audit }) {
  if (!audit) return '<p>Audit data unavailable.</p>';
  const score = audit.overallScore;
  const grade = audit.grade;
  const dollar = audit.dollarOpportunity?.monthly || {};
  const annual = audit.dollarOpportunity?.annual || {};
  const sections = audit.sections || {};
  const top5 = audit.topFiveFindings || [];
  const allFindings = audit.findings || [];
  const assets = audit.generatedAssets || {};
  const generatedAt = audit.generatedAt ? new Date(audit.generatedAt).toLocaleString() : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fix Plan — ${escape(businessName)}</title>
  <style>
    body { background:#f8fafc; color:#0f172a; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; line-height:1.55; margin:0; }
    .page { max-width:780px; margin:0 auto; padding:2rem 1.5rem 4rem; }
    .cover { background:linear-gradient(135deg,#0f172a,#1e293b); color:#f1f5f9; padding:2rem; border-radius:14px; margin-bottom:2rem; page-break-after:avoid; }
    .cover .eyebrow { font-size:0.78rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.08em; margin:0 0 0.5rem; }
    .cover h1 { margin:0 0 0.5rem; font-size:2rem; }
    .cover .biz { color:#cbd5e1; margin:0 0 1.25rem; font-size:1.05rem; }
    .cover-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; margin-top:1.5rem; }
    .cover-stat { background:rgba(255,255,255,0.06); border-radius:10px; padding:1rem; }
    .cover-stat .k { font-size:0.7rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px; }
    .cover-stat .v { font-size:1.6rem; font-weight:800; color:#f1f5f9; line-height:1; }
    .cover-stat .v.green { color:#bbf7d0; }
    h2 { margin:2rem 0 1rem; font-size:1.4rem; padding-bottom:6px; border-bottom:2px solid #0369a1; }
    .pillar-table { width:100%; background:white; border:1px solid #e2e8f0; border-radius:10px; padding:1rem 1.5rem; }
    .pillar-table table { width:100%; border-collapse:collapse; }
    .roadmap-week { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:1.25rem 1.5rem; margin-bottom:1rem; page-break-inside:avoid; }
    .roadmap-week h3 { margin:0 0 0.5rem; color:#0369a1; }
    .roadmap-week ul { margin:0.5rem 0 0; padding-left:1.25rem; color:#475569; }
    .roadmap-week ul li { margin:4px 0; }
    .footer-note { text-align:center; color:#94a3b8; font-size:0.85rem; padding:2rem 1rem; line-height:1.6; }
    @media print {
      body { background:white; }
      .page { padding:0; max-width:100%; }
      .cover { background:white !important; color:#0f172a; border:2px solid #0f172a; }
      .cover h1, .cover .biz, .cover-stat .v, .cover-stat .v.green, .cover-stat .k { color:#0f172a !important; }
      .cover-stat { background:#f1f5f9 !important; }
      h2 { page-break-after:avoid; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="cover">
      <p class="eyebrow">$199 Fix Plan · GeoNeo AI</p>
      <h1>${escape(businessName)}</h1>
      <p class="biz">${escape(domain)}${generatedAt ? ` · audit ${escape(generatedAt)}` : ''}</p>
      <div class="cover-grid">
        <div class="cover-stat">
          <div class="k">Visibility score</div>
          <div class="v">${escape(score ?? '—')}/100 <span style="font-size:0.95rem;color:#cbd5e1;">(${escape(grade || '—')})</span></div>
        </div>
        ${dollar.high ? `<div class="cover-stat">
          <div class="k">Monthly opportunity recovered</div>
          <div class="v green">$${escape(dollar.low?.toLocaleString())}–$${escape(dollar.high?.toLocaleString())}</div>
          <div style="font-size:0.78rem;color:#94a3b8;margin-top:4px;">Annualized: $${escape(annual.low?.toLocaleString() || 0)}–$${escape(annual.high?.toLocaleString() || 0)}</div>
        </div>` : ''}
      </div>
    </div>

    <h2>Pillar scores</h2>
    <div class="pillar-table">
      <table>
        <tbody>
          ${pillarRow('Schema.org structured data', sections.schema?.overallScore)}
          ${pillarRow('E-E-A-T (trust signals)', sections.eeat?.overallScore)}
          ${pillarRow('AI-search readiness (GEO)', sections.geo?.overallScore)}
          ${pillarRow('NAP consistency', sections.nap?.overallScore)}
          ${pillarRow('Sitemap.xml quality', sections.sitemap?.overallScore)}
          ${pillarRow('Image audit', sections.images?.overallScore)}
          ${pillarRow('Page performance (Core Web Vitals)', sections.performance?.overallScore)}
          ${pillarRow('Content quality (grammar)', sections.content?.overallScore)}
        </tbody>
      </table>
    </div>

    <h2>Top ${top5.length} fixes — implement in this order</h2>
    ${top5.map((f, i) => findingBlock(f, i)).join('')}

    <h2>Generated assets — paste-ready</h2>
    ${assetBlock('LocalBusiness JSON-LD (homepage)', assets.localBusinessSchema, 'json')}
    ${assetBlock('WebSite JSON-LD (homepage)', assets.websiteSchema, 'json')}
    ${assetBlock('Organization JSON-LD (homepage + about)', assets.organizationSchema, 'json')}
    ${assetBlock('BreadcrumbList JSON-LD (per inner page)', assets.breadcrumbSchema, 'json')}
    ${assetBlock('llms.txt (save to your site root)', assets.llmsTxt, 'txt')}

    <h2>Implementation roadmap</h2>
    <div class="roadmap-week">
      <h3>Week 1 — Schema + NAP foundation</h3>
      <ul>
        <li>Paste the LocalBusiness JSON-LD into your homepage <code>&lt;head&gt;</code>.</li>
        <li>Audit every page for consistent business name + phone + address. Pick one canonical version.</li>
        <li>Set up Google Business Profile if not already.</li>
      </ul>
    </div>
    <div class="roadmap-week">
      <h3>Week 2 — AI search readiness + content</h3>
      <ul>
        <li>Save the generated llms.txt to your site root (<code>https://${escape(domain)}/llms.txt</code>).</li>
        <li>Add Q&amp;A blocks to your top 3 service pages (use the schema we generated).</li>
        <li>Verify all major AI crawlers are allowed in <code>robots.txt</code> (GPTBot, ClaudeBot, PerplexityBot, Google-Extended).</li>
      </ul>
    </div>
    <div class="roadmap-week">
      <h3>Week 3 — Performance + images</h3>
      <ul>
        <li>Fix the top performance findings flagged above (LCP, CLS, INP).</li>
        <li>Convert hero images to WebP, add alt text, set explicit width/height.</li>
        <li>Implement lazy loading on below-the-fold images.</li>
      </ul>
    </div>
    <div class="roadmap-week">
      <h3>Week 4 — Sitemap + monitoring</h3>
      <ul>
        <li>Generate or update sitemap.xml to include all canonical URLs.</li>
        <li>Add Sitemap directive to robots.txt.</li>
        <li>Re-audit at <a href="https://geoneo.ai/audit-results.html?url=https://${escape(domain)}">geoneo.ai/audit-results.html?url=${escape(domain)}</a> and confirm score lift.</li>
      </ul>
    </div>

    ${allFindings.length > 5 ? `<h2>All findings (full list)</h2>
    <ul>${allFindings.map((f) => `<li><strong>[${escape(f.section || '')}]</strong> ${escape(f.title)} <span style="color:#64748b;">(${escape(f.severity || 'low')})</span></li>`).join('')}</ul>` : ''}

    <p class="footer-note">
      Fix Plan generated deterministically from your audit data. Every paste-block was built from your real site signals.<br>
      Maintenance Plan ($79/mo) re-audits monthly + alerts when scores drop. Smart Spend ($499/mo) takes over your existing budget. Reply to your audit email or visit geoneo.ai/pricing.html.
    </p>
  </div>
</body>
</html>`;
}

module.exports = { renderFixPlan };
