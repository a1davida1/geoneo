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
  const ratingData = responses.domainRating?.data || responses.domainRating || {};
  const backlinkData = responses.backlinksStats?.data || responses.backlinksStats || {};
  const organicData = responses.organicOverview?.data || responses.organicOverview || {};
  const organicKwData = responses.organicKeywords?.data || responses.organicKeywords || {};
  const paidKwData = responses.paidKeywords?.data || responses.paidKeywords || {};
  
  // Extract keyword counts
  const organicKeywords = organicData.keywords ?? organicData.organic_keywords ?? organicKwData.total ?? null;
  const paidKeywords = paidKwData.total ?? paidKwData.keywords ?? null;
  
  return {
    configured: true,
    target: domain,
    fetchedAt: new Date().toISOString(),
    domainRating: ratingData.domain_rating ?? ratingData.domainRating ?? ratingData.dr ?? null,
    urlRating: ratingData.url_rating ?? ratingData.urlRating ?? ratingData.ur ?? null,
    backlinks: backlinkData.live ?? backlinkData.backlinks ?? backlinkData.all_time ?? null,
    refdomains: backlinkData.live_refdomains ?? backlinkData.refdomains ?? backlinkData.all_time_refdomains ?? null,
    organicTraffic: organicData.traffic ?? organicData.organic_traffic ?? null,
    organicKeywords,
    paidKeywords,
    keywordMetrics: {
      organicCount: organicKeywords,
      paidCount: paidKeywords,
      trafficValue: organicData.traffic_value ?? organicData.organic_traffic_value ?? null
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

  const params = { target: domain, mode: 'domain' };
  const kwParams = { target: domain, mode: 'domain', limit: 10 }; // lightweight keyword sample
  const responses = {};
  const errors = [];
  const calls = [
    ['domainRating', '/site-explorer/domain-rating', params],
    ['backlinksStats', '/site-explorer/backlinks-stats', params],
    ['organicOverview', '/site-explorer/overview', params],
    ['organicKeywords', '/site-explorer/organic-keywords', kwParams],
    ['paidKeywords', '/site-explorer/paid-keywords', kwParams]
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
