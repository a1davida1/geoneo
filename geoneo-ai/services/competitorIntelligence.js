/**
 * Live competitor intelligence payload for member dashboard (audit-backed + tracked history).
 */

const { extractRootDomain } = require('./serpProvider');
const { calculateVisibilityScore } = require('./visibilityScoring');
const {
  getTrackedCompetitors,
  setTrackedCompetitors,
  recordCompetitorScore,
  getCompetitorMovement
} = require('./competitorTracking');
const { getLatestAuditForDomain } = require('./auditLookup');

function normalizeDomainToken(input) {
  if (!input) return '';
  try {
    const u = new URL(String(input).startsWith('http') ? input : `https://${input}`);
    return extractRootDomain(u.href);
  } catch {
    return String(input).toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  }
}

function gapsFromComparison(ourBreakdown, competitorBreakdown) {
  const gaps = [];
  if (!ourBreakdown || !competitorBreakdown) return gaps;
  const keys = Object.keys(ourBreakdown);
  for (const k of keys) {
    const ours = Number(ourBreakdown[k]) || 0;
    const delta = Number(competitorBreakdown[k] ?? 0) - ours;
    if (delta > 8) {
      gaps.push(`${k}: competitor stronger on this pillar (~${delta}+ pts vs your score)`);
    }
  }
  if (gaps.length === 0) {
    gaps.push('Tight race: focus on review velocity + FAQ content to pull ahead.');
  }
  return gaps.slice(0, 4);
}

/**
 * Seed tracked competitors from audit snapshot if none stored yet.
 */
async function ensureTrackedFromAudit(ownerDomain, auditRecord) {
  const existing = await getTrackedCompetitors(ownerDomain);
  if (existing.length > 0) return;

  const full = auditRecord.fullAuditResult || auditRecord;
  const snap = full.searchSnapshot || auditRecord.searchSnapshot || {};
  const rows = Array.isArray(snap.competitors) ? snap.competitors : [];
  const list = [];
  for (const c of rows) {
    const raw = c.domain || c.url || c.link || '';
    const d = normalizeDomainToken(raw);
    if (!d) continue;
    const name = c.name || c.title || d;
    if (d === ownerDomain) continue;
    list.push({ domain: d, name });
    if (list.length >= 6) break;
  }

  if (list.length) {
    await setTrackedCompetitors(ownerDomain, list);
  }
}

/**
 * @param {string} ownerDomain
 * @returns {Promise<object>}
 */
async function buildCompetitorIntelligencePayload(ownerDomain) {
  const domain = normalizeDomainToken(ownerDomain);
  const latest = await getLatestAuditForDomain(domain);
  if (!latest) {
    return { ok: false, error: 'no_audit' };
  }

  await ensureTrackedFromAudit(domain, latest);

  const ourScore = calculateVisibilityScore({
    ...latest,
    fullAuditResult: latest.fullAuditResult || latest
  });

  let tracked = await getTrackedCompetitors(domain);

  // If audit has no competitors in snapshot, still return empty state honestly
  if (tracked.length === 0) {
    return {
      ok: true,
      domain,
      yourScore: ourScore.overall,
      competitors: [],
      message: 'No competitors captured on your last audit. Run a new audit with competitor names or market queries to populate this view.'
    };
  }

  const cards = [];
  for (const t of tracked) {
    const compDomain = t.domain;
    const compAudit = await getLatestAuditForDomain(compDomain);

    if (compAudit) {
      const competitorScore = calculateVisibilityScore({
        ...compAudit,
        fullAuditResult: compAudit.fullAuditResult || compAudit
      });
      const overall = competitorScore.overall;

      await recordCompetitorScore(domain, compDomain, overall, { source: 'audit' });
      const movement = await getCompetitorMovement(domain, compDomain);
      const change = movement && movement.change != null ? movement.change : 0;
      const prev = overall - change;

      cards.push({
        name: t.name || compDomain,
        domain: compDomain,
        scoreSource: 'audit',
        currentScore: overall,
        previousScore: prev,
        change,
        trend: movement?.trend || 'stable',
        insight: 'Score from GeoNeo audit data for this domain.',
        gaps: gapsFromComparison(ourScore.breakdown, competitorScore.breakdown)
      });
    } else {
      cards.push({
        name: t.name || compDomain,
        domain: compDomain,
        scoreSource: 'pending',
        currentScore: null,
        previousScore: null,
        change: null,
        trend: 'unknown',
        insight:
          'No GeoNeo audit on file for this competitor. Run an audit for this domain to record an evidence-based score and movement.',
        gaps: [
          'Benchmark unavailable until this competitor has a stored GeoNeo audit.',
          'Tip: add them as a paid audit URL or capture them on your next full site scan.'
        ]
      });
    }
  }

  return {
    ok: true,
    domain,
    yourScore: ourScore.overall,
    competitors: cards
  };
}

module.exports = {
  buildCompetitorIntelligencePayload,
  ensureTrackedFromAudit,
  normalizeDomainToken
};
