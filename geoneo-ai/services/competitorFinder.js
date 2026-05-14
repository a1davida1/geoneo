/**
 * Competitor finder. Given a seed domain, find other domains that compete
 * with it by:
 *   1. Pulling the seed's top N organic keywords from Ahrefs (or the cached
 *      enrichment that the prospect-hunter pipeline already saved)
 *   2. Running each keyword through the SERP provider and collecting every
 *      unique non-seed domain that ranks in the organic top-N
 *   3. Counting how many shared keywords each competitor has with the seed
 *      so we can rank by overlap (more shared = more direct competitor)
 *   4. Filtering out aggregators + listicles using the same blocklist
 *      that gates lead-gen candidate quality
 *
 * Output: ranked list of competitor domains with overlap count + sample
 * shared queries + Ahrefs-style metrics (DR, traffic) when available.
 *
 * No LLM. Pure SERP scrape + Ahrefs lookups.
 */

const { createSerpProvider, normalizeDomain, extractRootDomain } = require('./serpProvider');
const { enrichDomainWithAhrefs, ahrefsStatus } = require('./ahrefsClient');

// Re-use the aggregator blocklist already defined in leadGenBatch by importing
// the helpers. (They're internal but exposed via classifyCandidateQuality.)
const leadGen = require('./leadGenBatch');

const DEFAULT_KEYWORD_LIMIT = 8;       // pull top 8 keywords from seed
const DEFAULT_PER_QUERY_RESULTS = 10;  // examine top 10 organic per query
const DEFAULT_MAX_COMPETITORS = 20;
const DEFAULT_TIMEOUT_MS = 25000;

function isAggregatorDomain(domain) {
  // Mirror the blocklist used by lead-gen — just a heuristic guard.
  if (!domain) return true;
  const blocklist = ['yelp.com', 'angi.com', 'thumbtack.com', 'bbb.org', 'facebook.com',
    'instagram.com', 'linkedin.com', 'youtube.com', 'tiktok.com', 'mapquest.com', 'pinterest.com',
    'reddit.com', 'wikipedia.org', 'amazon.com', 'walmart.com', 'lowes.com', 'homedepot.com',
    'nextdoor.com', 'porch.com', 'houzz.com', 'modernize.com', 'networx.com', 'homeguide.com',
    'sears.com', 'contractorconnection.com', 'serviceseeking.com', 'taskrabbit.com', 'handy.com',
    'foursquare.com', 'mapsofworld.com', 'google.com', 'bing.com', 'yellowpages.com',
    'bingplaces.com', 'maps.google.com'];
  return blocklist.some((b) => domain === b || domain.endsWith('.' + b));
}

/**
 * Pull top-N organic keywords for the seed domain. Tries Ahrefs first
 * (real data), falls back to a generated set of "{industry} {city}" style
 * queries when Ahrefs is unavailable or returns nothing.
 */
async function getSeedKeywords(seedDomain, { fallbackContext = {}, limit = DEFAULT_KEYWORD_LIMIT } = {}) {
  if (ahrefsStatus().enabled) {
    try {
      const enrich = await enrichDomainWithAhrefs(seedDomain);
      const list = Array.isArray(enrich.organicKeywordsTop) ? enrich.organicKeywordsTop : [];
      const sortedByVolume = list
        .filter((kw) => kw && kw.keyword && (kw.position || 0) <= 30)
        .sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0))
        .slice(0, limit)
        .map((kw) => ({ keyword: kw.keyword, position: kw.position, volume: kw.volume, source: 'ahrefs' }));
      if (sortedByVolume.length) return sortedByVolume;
    } catch {
      // fall through to fallback
    }
  }
  // Fallback: generate queries from industry + city if available
  const fallback = [];
  const industry = (fallbackContext.industry || '').trim();
  const city = (fallbackContext.city || '').trim();
  if (industry && city) {
    fallback.push({ keyword: `${industry} ${city}`, source: 'fallback' });
    fallback.push({ keyword: `best ${industry} ${city}`, source: 'fallback' });
    fallback.push({ keyword: `${industry} near me ${city}`, source: 'fallback' });
  }
  if (industry) fallback.push({ keyword: industry, source: 'fallback' });
  return fallback.slice(0, limit);
}

/**
 * Run each keyword through the SERP provider and collect every unique
 * non-seed domain that ranks. Returns a Map<domain, { overlapCount,
 * sampleQueries[], topPositions[] }>.
 */
async function findCompetitorDomains(seedDomain, keywords, { location = '', perQueryResults = DEFAULT_PER_QUERY_RESULTS } = {}) {
  if (!keywords || !keywords.length) return new Map();
  const seedRoot = normalizeDomain(seedDomain);
  const provider = createSerpProvider();
  if (typeof provider.getSearchResults !== 'function') return new Map();
  const competitors = new Map(); // domain → { overlapCount, sampleQueries: [], topPositions: [] }
  for (const kw of keywords) {
    let raw;
    try {
      raw = await Promise.race([
        provider.getSearchResults(kw.keyword, location, { num: perQueryResults }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('serp_timeout')), DEFAULT_TIMEOUT_MS))
      ]);
    } catch {
      continue;
    }
    const normalized = provider.normalizeResults(raw, { query: kw.keyword, location });
    const organic = (normalized.organicResults || []).slice(0, perQueryResults);
    for (const r of organic) {
      const root = extractRootDomain(r.domain || r.url);
      if (!root || root === seedRoot) continue;
      if (isAggregatorDomain(root)) continue;
      if (!competitors.has(root)) {
        competitors.set(root, { domain: root, overlapCount: 0, sampleQueries: [], topPositions: [] });
      }
      const c = competitors.get(root);
      c.overlapCount++;
      if (c.sampleQueries.length < 5) c.sampleQueries.push(kw.keyword);
      c.topPositions.push(r.position);
    }
  }
  return competitors;
}

/**
 * Optionally enrich each competitor with Ahrefs metrics so the UI can
 * sort by DR + traffic. Skipped when Ahrefs not configured (quiet fallback).
 */
async function enrichCompetitorMetrics(competitorList) {
  if (!ahrefsStatus().enabled) return competitorList;
  const enriched = await Promise.all(competitorList.map(async (c) => {
    try {
      const data = await enrichDomainWithAhrefs(c.domain);
      return {
        ...c,
        domainRating: data.domainRating ?? null,
        organicTraffic: data.organicTraffic ?? null,
        organicKeywords: data.organicKeywords ?? null,
        refdomains: data.refdomains ?? null
      };
    } catch {
      return c;
    }
  }));
  return enriched;
}

/**
 * Top-level: find competitors for one seed domain + assemble the final
 * ranked list. limit caps how many competitors to return (after sorting
 * by overlapCount desc, then DR desc when available).
 */
async function findCompetitorsFor(seedDomain, { location = '', industry = '', city = '', limit = DEFAULT_MAX_COMPETITORS, enrichWithAhrefs = true } = {}) {
  if (!seedDomain) throw new Error('seedDomain required');
  const keywords = await getSeedKeywords(seedDomain, { fallbackContext: { industry, city } });
  if (!keywords.length) {
    return { seedDomain, keywordsUsed: [], competitors: [], ahrefsAvailable: ahrefsStatus().enabled };
  }
  const competitorMap = await findCompetitorDomains(seedDomain, keywords, { location });
  let competitors = Array.from(competitorMap.values());
  // Sort by overlap count desc, then by best avg position
  competitors.sort((a, b) => {
    if (b.overlapCount !== a.overlapCount) return b.overlapCount - a.overlapCount;
    const aAvg = a.topPositions.reduce((s, n) => s + n, 0) / Math.max(1, a.topPositions.length);
    const bAvg = b.topPositions.reduce((s, n) => s + n, 0) / Math.max(1, b.topPositions.length);
    return aAvg - bAvg;
  });
  competitors = competitors.slice(0, limit);
  if (enrichWithAhrefs) competitors = await enrichCompetitorMetrics(competitors);
  return {
    seedDomain,
    keywordsUsed: keywords.map((k) => k.keyword),
    keywordSource: keywords[0]?.source || null,
    competitors,
    ahrefsAvailable: ahrefsStatus().enabled
  };
}

module.exports = {
  findCompetitorsFor,
  getSeedKeywords,
  findCompetitorDomains,
  isAggregatorDomain
};
