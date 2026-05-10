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
  return {
    configured: true,
    target: domain,
    fetchedAt: new Date().toISOString(),
    domainRating: ratingData.domain_rating ?? ratingData.domainRating ?? ratingData.dr ?? null,
    urlRating: ratingData.url_rating ?? ratingData.urlRating ?? ratingData.ur ?? null,
    backlinks: backlinkData.live ?? backlinkData.backlinks ?? backlinkData.all_time ?? null,
    refdomains: backlinkData.live_refdomains ?? backlinkData.refdomains ?? backlinkData.all_time_refdomains ?? null,
    organicTraffic: organicData.traffic ?? organicData.organic_traffic ?? null,
    organicKeywords: organicData.keywords ?? organicData.organic_keywords ?? null,
    rawAvailable: true
  };
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

  const params = { target: domain, mode: 'domain' };
  const responses = {};
  const errors = [];
  const calls = [
    ['domainRating', '/site-explorer/domain-rating'],
    ['backlinksStats', '/site-explorer/backlinks-stats'],
    ['organicOverview', '/site-explorer/overview']
  ];

  for (const [key, endpoint] of calls) {
    try {
      responses[key] = await ahrefsGet(endpoint, params);
    } catch (error) {
      errors.push({
        endpoint,
        status: error.status || null,
        message: error.message || 'ahrefs_call_failed'
      });
    }
  }

  const compact = compactAhrefsPayload(domain, responses);
  compact.errors = errors;
  compact.partial = errors.length > 0;
  return compact;
}

module.exports = {
  ahrefsStatus,
  enrichDomainWithAhrefs,
  normalizeDomain
};
