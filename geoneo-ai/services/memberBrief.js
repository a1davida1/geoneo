/**
 * Weekly member brief: actionable recommendations + AI citation bundle from saved audit.
 */

const LIFT_BY_KEY = {
  'robots-meta': { timeEstimate: '15–25 min', lift: 'Medium' },
  'structured-data': { timeEstimate: '45–90 min', lift: 'High' },
  'local-geo': { timeEstimate: '1–2 hours', lift: 'High' },
  'paragraph-depth': { timeEstimate: '2–4 hours', lift: 'High' },
  'trust-signals': { timeEstimate: '45–90 min', lift: 'High' },
  grammar: { timeEstimate: '1–3 hours', lift: 'Medium' },
  title: { timeEstimate: '15–25 min', lift: 'High' },
  'meta-description': { timeEstimate: '20–40 min', lift: 'Medium' },
  h1: { timeEstimate: '15–25 min', lift: 'High' }
};

function enrichActionPlanItem(item, index) {
  const key = item.key || '';
  const extra = LIFT_BY_KEY[key] || { timeEstimate: '45–90 min', lift: 'Medium–High' };
  return {
    priority: item.priority || index + 1,
    key,
    action: item.action || item.solutionTitle || '',
    outcome: item.outcome || item.solution || '',
    timeEstimate: item.timeEstimate || extra.timeEstimate,
    lift: item.lift || extra.lift
  };
}

/**
 * Build 3 weekly actions from full audit result.
 * @param {object} auditRecord - row from audits.json
 */
function buildWeeklyRecommendations(auditRecord) {
  const full = auditRecord.fullAuditResult || auditRecord;
  const plan = Array.isArray(full.prioritizedActionPlan) ? full.prioritizedActionPlan : [];
  const slice = plan.slice(0, 3).map((item, i) => enrichActionPlanItem(item, i));

  if (slice.length >= 3) return slice;

  // Fallback from topFixes strings
  const topFixes = Array.isArray(full.topFixes) ? full.topFixes : [];
  while (slice.length < 3 && topFixes[slice.length]) {
    slice.push({
      priority: slice.length + 1,
      key: `quick-win-${slice.length}`,
      action: topFixes[slice.length],
      outcome: 'Addresses a flagged issue from your last GeoNeo audit.',
      timeEstimate: '30–60 min',
      lift: 'Medium'
    });
  }

  return slice.slice(0, 3);
}

/**
 * AI citation subsection for member dashboard.
 */
function buildAiCitationBrief(auditRecord) {
  const full = auditRecord.fullAuditResult || auditRecord;
  const recs = Array.isArray(full.aiCitationRecommendations) ? full.aiCitationRecommendations : [];
  const pillarScore = typeof full.scores?.ai === 'number' ? full.scores.ai : null;
  const schemaPass = Array.isArray(full.checks)
    ? full.checks.some((c) => c.key === 'structured-data' && String(c.status).toUpperCase() === 'PASS')
    : false;

  return {
    pillarScore,
    recommendationCount: recs.length,
    topRecommendations: recs.slice(0, 5).map((r) => ({
      question: r.question || r.title || '',
      reason: r.reason || r.detail || '',
      fixHint: r.fix || r.suggestion || ''
    })),
    hasSchema: Boolean(full.siteProfile?.seoSignals?.schemaCount > 0 || schemaPass)
  };
}

module.exports = {
  buildWeeklyRecommendations,
  buildAiCitationBrief
};
