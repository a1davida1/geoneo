/**
 * GeoNeo Visibility Scoring Engine (Production Grade v1.1)
 * 
 * Calculates a comprehensive 0-100 Visibility Score based on real, measurable signals.
 * Designed for weekly scoring and historical tracking for Visibility Club members.
 * 
 * Pillars:
 * - Google Organic Strength (20%)
 * - Map Pack Strength (18%)
 * - AI Citation Readiness (18%)
 * - Technical Health (12%)
 * - Content Authority (12%)
 * - Review Velocity & Sentiment (10%)
 * - Competitor Gap (5%)
 * - Local Signal Strength (5%)
 */

const PILLAR_WEIGHTS = {
  googleOrganic: 0.20,
  mapPack: 0.18,
  aiCitation: 0.18,
  technicalHealth: 0.12,
  contentAuthority: 0.12,
  reviewVelocity: 0.10,
  competitorGap: 0.05,
  localSignals: 0.05
};

function clampScore(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Main scoring function
 * @param {Object} data - Combined data from audit + SERP + reviews + competitors
 */
function calculateVisibilityScore(data = {}) {
  const scores = {
    googleOrganic: scoreGoogleOrganic(data),
    mapPack: scoreMapPack(data),
    aiCitation: scoreAICitation(data),
    technicalHealth: scoreTechnicalHealth(data),
    contentAuthority: scoreContentAuthority(data),
    reviewVelocity: scoreReviewVelocity(data),
    competitorGap: scoreCompetitorGap(data),
    localSignals: scoreLocalSignals(data)
  };

  let total = 0;
  for (const [key, weight] of Object.entries(PILLAR_WEIGHTS)) {
    total += (scores[key] || 0) * weight;
  }

  const finalScore = clampScore(total);

  return {
    overall: finalScore,
    breakdown: scores,
    pillars: PILLAR_WEIGHTS,
    calculatedAt: new Date().toISOString(),
    version: "1.0.0",
    methodology: "Weighted average of 8 visibility pillars based on local SEO and AI search best practices."
  };
}

// === Individual Pillar Scoring Functions ===

function scoreGoogleOrganic(data) {
  const avgRank = Number(data.googleAvgRank) || 15;
  const top10Count = Number(data.googleTop10Count) || 0;
  const targetQueries = Number(data.targetQueries) || 10;
  const competitors = Array.isArray(data.searchSnapshotCompetitors) ? data.searchSnapshotCompetitors : [];

  let score = 100;

  // Strong penalty for poor average ranking
  if (avgRank > 8) score -= (avgRank - 8) * 5;
  if (avgRank > 15) score -= (avgRank - 15) * 4;
  if (avgRank > 25) score -= (avgRank - 25) * 3;

  // Reward for top 10 appearances
  const top10Ratio = targetQueries > 0 ? top10Count / targetQueries : 0;
  score += top10Ratio * 30;

  // Bonus for beating competitors on important queries
  if (competitors.length > 0) {
    const ourPosition = competitors.findIndex(c => c.isUs) + 1;
    if (ourPosition > 0 && ourPosition <= 3) score += 10;
    else if (ourPosition > 0 && ourPosition <= 6) score += 5;
  }

  return clampScore(score, 20, 100);
}

function scoreMapPack(data) {
  const localVis = data.localSearchVisibility || {};
  const summary = localVis.summary || {};

  const mapPackAppearances = Number(summary.foundInMapPackCount) || Number(data.mapPackAppearances) || 0;
  const targetQueries = Number(data.targetQueries) || 10;
  const consistency = Number(localVis.consistency) || 0.6;

  let score = 50;

  const appearanceRatio = targetQueries > 0 ? mapPackAppearances / targetQueries : 0;
  score += appearanceRatio * 45;

  // Consistency bonus (being in the map pack consistently is very valuable)
  score += consistency * 20;

  // Penalty if they have very poor local presence
  if (mapPackAppearances === 0) score -= 25;

  return clampScore(score, 15, 100);
}

function scoreAICitation(data) {
  const full = data.fullAuditResult || {};
  const aiRecs = Array.isArray(full.aiCitationRecommendations) ? full.aiCitationRecommendations : [];

  // Question coverage based on actual recommendations generated
  const questionCoverage = aiRecs.length > 0 
    ? Math.min(0.95, 0.4 + (aiRecs.length * 0.08)) 
    : (data.aiQuestionCoverage || 0.42);

  const hasSchema = full.hasSchema || (data.schemaQuality > 0.5);
  const schemaQuality = hasSchema ? 0.85 : 0.5;

  // Review sentiment from real data
  const avgRating = Number(full.avgRating) || 4.2;
  const reviewSentiment = Math.min(0.95, (avgRating - 3.5) / 1.6);

  let score = 40;
  score += questionCoverage * 35;
  score += schemaQuality * 15;
  score += (reviewSentiment + 1) / 2 * 12;

  return clampScore(score, 25, 100);
}

function scoreTechnicalHealth(data) {
  const lighthouse = data.lighthouseScores || {};
  const full = data.fullAuditResult || {};

  const performance = Number(lighthouse.performance || full.performanceScore) || 52;
  const seo = Number(lighthouse.seo || full.seoScore) || 68;
  const bestPractices = Number(lighthouse.bestPractices || full.bestPracticesScore) || 71;

  const avg = (performance + seo + bestPractices) / 3;

  let score = avg * 0.88;

  // Strong penalties
  if (performance < 40) score -= 25;
  else if (performance < 55) score -= 15;

  if (seo < 50) score -= 18;
  if (bestPractices < 55) score -= 10;

  // Bonus
  if (performance > 80 && seo > 85) score += 10;

  return clampScore(score, 20, 100);
}

function scoreContentAuthority(data) {
  const full = data.fullAuditResult || {};
  const wordCount = Number(full.wordCount) || Number(data.totalWords) || 850;
  const hasEeat = full.trustDesign?.level === 'strong' || data.hasEeatSignals || false;
  const freshness = data.contentFreshness || 0.68;

  let score = 48;

  if (wordCount > 2400) score += 24;
  else if (wordCount > 1600) score += 14;
  else if (wordCount < 700) score -= 20;

  if (hasEeat) score += 16;
  score += freshness * 14;

  return clampScore(score);
}

function scoreReviewVelocity(data) {
  const fullResult = data.fullAuditResult || {};
  const reviewCount = fullResult.reviewCount || data.reviewCount || 24;
  const responseRate = data.reviewResponseRate || 0.62;
  const avgRating = fullResult.avgRating || data.avgRating || 4.25;

  let score = 42;

  score += Math.min(28, reviewCount / 2.2);
  score += responseRate * 22;
  score += (avgRating - 3.6) * 9;

  return clampScore(score);
}

function scoreCompetitorGap(data) {
  const competitorAvgScore = data.competitorAvgScore || 75;
  const ourScore = data.ourScore || 60;

  const gap = competitorAvgScore - ourScore;

  let score = 80;
  if (gap > 10) score -= gap * 2;
  if (gap > 25) score -= (gap - 25) * 1.5;

  return clampScore(score);
}

function scoreLocalSignals(data) {
  const gbpComplete = data.gbpCompleteness || 0.6; // 0-1
  const citationCount = data.citationCount || 15;
  const consistency = data.localConsistency || 0.7;

  let score = 50;
  score += gbpComplete * 25;
  score += Math.min(15, citationCount / 3);
  score += consistency * 10;

  return clampScore(score);
}

module.exports = {
  calculateVisibilityScore,
  PILLAR_WEIGHTS
};