const AHREFS_API_BASE = 'https://api.ahrefs.com/v3';
const AHREFS_TIMEOUT_MS = 30000;

function hasAhrefsKey(env = process.env) {
  return Boolean(env.AHREFS_API_KEY);
}

function ahrefsStatus(env = process.env) {
  return {
    configured: hasAhrefsKey(env),
    envVar: 'AHREFS_API_KEY',
    mode: hasAhrefsKey(env) ? 'available_optional_paid_call' : 'not_configured',
    supportedSignals: ['domain_rating', 'url_rating', 'backlinks', 'refdomains', 'organic_traffic'],
    secretExposed: false,
    note: 'Ahrefs enrichment is optional and should only run when explicitly enabled because it may consume paid API units.'
  };
}

function normalizeDomain(input) {
  return String(input || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();
}

async function ahrefsGet(endpoint, params, env = process.env) {
  if (!hasAhrefsKey(env)) {
    throw new Error('AHREFS_API_KEY env var required');
  }
  const url = new URL(`${AHREFS_API_BASE}${endpoint}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AHREFS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.AHREFS_API_KEY}` },
      signal: controller.signal
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }
    if (!response.ok) {
      const error = new Error(`Ahrefs ${endpoint} failed with HTTP ${response.status}`);
      error.status = response.status;
      error.response = parsed;
      throw error;
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function compactAhrefsPayload(domain, responses) {
  // v3 wraps metrics inside `metrics` (single endpoint may return `domain_rating`
  // at top level, others under `metrics`/`stats`). Cover all observed shapes.
  const ratingRoot = responses.domainRating || {};
  const ratingData = ratingRoot.metrics || ratingRoot.domain_rating || ratingRoot.data || ratingRoot;
  const backlinkRoot = responses.backlinksStats || {};
  const backlinkData = backlinkRoot.metrics || backlinkRoot.stats || backlinkRoot.data || backlinkRoot;
  const organicRoot = responses.organicOverview || {};
  const organicData = organicRoot.metrics || organicRoot.data || organicRoot;
  const organicKwRoot = responses.organicKeywords || {};
  const organicKwData = organicKwRoot.organic_keywords || organicKwRoot.keywords || organicKwRoot.data || organicKwRoot;
  const paidPagesRoot = responses.paidPages || {};
  const paidPagesData = paidPagesRoot.pages || paidPagesRoot.data || (Array.isArray(paidPagesRoot) ? paidPagesRoot : []);

  const organicKeywords = organicData.org_keywords ?? organicData.organic_keywords ?? organicData.keywords ?? (Array.isArray(organicKwData) ? organicKwData.length : null);
  const paidKeywords = organicData.paid_keywords ?? null;
  const paidTraffic = organicData.paid_traffic ?? null;
  const paidCost = organicData.paid_cost ?? null; // Ahrefs returns cost in cents
  const paidPagesCount = organicData.paid_pages ?? null;
  const investingInAds = (paidKeywords > 0) || (paidTraffic > 0); // qualifier signal

  return {
    configured: true,
    target: domain,
    fetchedAt: new Date().toISOString(),
    domainRating: ratingData.domain_rating ?? ratingData.dr ?? null,
    urlRating: ratingData.url_rating ?? ratingData.ur ?? null,
    backlinks: backlinkData.live ?? backlinkData.backlinks ?? null,
    refdomains: backlinkData.live_refdomains ?? backlinkData.refdomains ?? null,
    organicTraffic: organicData.org_traffic ?? organicData.organic_traffic ?? organicData.traffic ?? null,
    organicKeywords,
    paidKeywords,
    paidTraffic,
    paidCostMonthlyUsd: paidCost != null ? Math.round(paidCost / 100) : null,
    paidPagesCount,
    investingInAds,
    topPaidPages: Array.isArray(paidPagesData) ? paidPagesData.slice(0, 5).map((p) => ({
      url: p.url || p.raw_url || null,
      monthlyTraffic: p.sum_traffic ?? null,
      monthlyValue: p.value ?? null,
      adsCount: p.ads_count ?? null,
      topKeyword: p.top_keyword ?? null,
      keywordCount: p.keywords ?? null
    })) : [],
    keywordMetrics: {
      organicCount: organicKeywords,
      paidCount: paidKeywords,
      trafficValue: organicData.org_traffic_value ?? organicData.organic_traffic_value ?? organicData.traffic_value ?? null
    },
    rawAvailable: true
  };
}

// File-backed response cache. Domain-rating and backlink data don't change
// hour-to-hour — caching for 7 days saves ~99% of API credits during repeat
// audits and during AI-call retries on the same prospect.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const AHREFS_CACHE_DIR = path.join(__dirname, '..', 'data', 'ahrefs-cache');
const AHREFS_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function ahrefsCacheKey(domain) {
  return crypto.createHash('sha1').update(domain).digest('hex').slice(0, 16);
}

async function readAhrefsCache(domain) {
  try {
    const file = path.join(AHREFS_CACHE_DIR, ahrefsCacheKey(domain) + '.json');
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > AHREFS_CACHE_TTL_MS) return null;
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...parsed, _cachedAt: stat.mtimeMs, _cacheAgeHours: Math.round((Date.now() - stat.mtimeMs) / 3600000) };
  } catch {
    return null;
  }
}

async function writeAhrefsCache(domain, payload) {
  try {
    await fs.mkdir(AHREFS_CACHE_DIR, { recursive: true });
    const file = path.join(AHREFS_CACHE_DIR, ahrefsCacheKey(domain) + '.json');
    await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // Cache write failures are non-fatal
  }
}

async function enrichDomainWithAhrefs(domainInput, opts = {}) {
  const domain = normalizeDomain(domainInput);
  if (!domain) return { configured: hasAhrefsKey(), target: '', skipped: true, error: 'missing_domain' };
  if (!opts.enabled) {
    return { ...ahrefsStatus(), target: domain, skipped: true, reason: 'not_enabled_for_run' };
  }
  if (!hasAhrefsKey()) {
    return { ...ahrefsStatus(), target: domain, skipped: true, reason: 'missing_AHREFS_API_KEY' };
  }

  // Cache lookup — saves API credits on repeat audits within 7 days
  if (!opts.skipCache) {
    const cached = await readAhrefsCache(domain);
    if (cached) {
      return { ...cached, fromCache: true, cacheAgeHours: cached._cacheAgeHours };
    }
  }

  // Ahrefs v3 requires `date` (YYYY-MM-DD). mode=subdomains is critical:
  // most sites have traffic on www.example.com, not the apex. mode=domain
  // gave us 0/0 even when Ahrefs UI showed thousands of keywords.
  const today = new Date().toISOString().slice(0, 10);
  const baseParams = { target: domain, mode: 'subdomains', date: today, country: 'us', protocol: 'both' };
  const kwParams = { ...baseParams, limit: 10 };
  const responses = {};
  const errors = [];
  // v3 endpoints. /site-explorer/paid-keywords doesn't exist; use the metrics
  // endpoint for paid totals and /site-explorer/paid-pages for ad-spending pages.
  // paid_traffic > 0 = high-intent prospect (already buying ads).
  const calls = [
    ['domainRating', '/site-explorer/domain-rating', { ...baseParams, select: 'domain_rating' }],
    ['backlinksStats', '/site-explorer/backlinks-stats', { ...baseParams, select: 'live,live_refdomains' }],
    ['organicOverview', '/site-explorer/metrics', { ...baseParams, select: 'org_traffic,org_keywords,org_traffic_value,paid_keywords,paid_traffic,paid_cost,paid_pages' }],
    ['organicKeywords', '/site-explorer/organic-keywords', { ...kwParams, select: 'keyword,best_position,volume' }],
    ['paidPages', '/site-explorer/paid-pages', { ...kwParams, select: 'url,sum_traffic,value,ads_count,top_keyword,keywords' }]
  ];

  const results = await Promise.allSettled(
    calls.map(([key, endpoint, callParams]) => ahrefsGet(endpoint, callParams))
  );
  results.forEach((result, i) => {
    const [key, endpoint] = calls[i];
    if (result.status === 'fulfilled') {
      responses[key] = result.value;
    } else {
      const error = result.reason;
      errors.push({
        endpoint,
        status: error.status || null,
        message: error.message || 'ahrefs_call_failed'
      });
    }
  });

  const compact = compactAhrefsPayload(domain, responses);
  compact.errors = errors;
  compact.partial = errors.length > 0;
  compact.fromCache = false;

  // Only cache successful responses — partial/errored responses stay live
  // so they have a chance to recover. DR === null cache is also blocked.
  if (errors.length === 0 && compact.domainRating != null) {
    await writeAhrefsCache(domain, compact);
  }
  return compact;
}

module.exports = {
  ahrefsStatus,
  enrichDomainWithAhrefs,
  normalizeDomain
};
