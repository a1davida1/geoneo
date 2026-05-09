/**
 * Deeper technical SEO signal pass built from existing audit payload (no extra HTTP in MVP).
 * Surfaces Core Web Vitals–adjacent scores, crawl/index hygiene, and structured data readiness.
 */

function statusFromPassFail(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'PASS') return { ok: true, severity: 'pass' };
  if (s === 'FIX' || s === 'FAIL') return { ok: false, severity: s === 'FAIL' ? 'high' : 'medium' };
  console.warn('[technicalSeoDeep] unknown status treated as failing:', status);
  return { ok: false, severity: 'unknown' };
}

/**
 * @param {Object} auditRecord - saved audit row or fullAuditResult
 * @returns {{ summaryScore: number, findings: Array<{key: string, status: string, detail: string, impact: string}>, googleGrades: object|null }}
 */
function analyzeTechnicalSeoDeep(auditRecord) {
  const full = auditRecord.fullAuditResult || auditRecord;
  const checks = Array.isArray(full.checks) ? full.checks : [];
  const google = full.googleGrades || null;

  const findings = [];
  const techKeys = new Set([
    'canonical', 'robots-meta', 'robots-txt', 'sitemap', 'structured-data', 'image-alt',
    'meta-description', 'title', 'h1', 'og-tags', 'mobile-viewport'
  ]);

  for (const c of checks) {
    const key = c.key || '';
    if (!techKeys.has(key)) continue;
    const st = statusFromPassFail(c.status);
    if (!st.ok) {
      findings.push({
        key,
        status: c.status,
        detail: c.message || key,
        impact: key === 'structured-data' || key === 'canonical' ? 'high' : 'medium'
      });
    }
  }

  let summaryScore = 72;
  if (google) {
    const grades = [google.performance, google.seo, google.bestPractices, google.accessibility]
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    if (grades.length > 0) {
      summaryScore = Math.round(grades.reduce((a, b) => a + b, 0) / grades.length);
    }
  }

  const penalty = Math.min(40, findings.filter((f) => f.impact === 'high').length * 12
    + findings.filter((f) => f.impact === 'medium').length * 4);
  summaryScore = Math.max(35, Math.min(100, summaryScore - penalty));

  return {
    summaryScore,
    findings: findings.slice(0, 12),
    googleGrades: google,
    checksEvaluated: checks.filter((c) => techKeys.has(c.key)).length
  };
}

module.exports = {
  analyzeTechnicalSeoDeep
};
