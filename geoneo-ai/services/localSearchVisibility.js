const fs = require('fs/promises');
const path = require('path');
const { createSerpProvider, extractRootDomain, normalizeDomain } = require('./serpProvider');

const QUERY_COUNT = 3;

const US_STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'
};

function buildSerpLocation({ city, state }) {
  const cityVal = normalizeText(city);
  const stateVal = normalizeText(state);
  const fullState = US_STATE_NAMES[stateVal.toUpperCase()] || stateVal;

  // User-supplied city/state always wins over any env default.
  if (cityVal && fullState) return `${cityVal}, ${fullState}, United States`;
  if (fullState) return `${fullState}, United States`;

  // Fall back to SERP_LOCATION only when no city/state was provided by the caller.
  const envLocation = normalizeText(process.env.SERP_LOCATION);
  if (envLocation) return envLocation;

  return 'United States';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(items) {
  return [...new Set((Array.isArray(items) ? items : []).map((item) => normalizeText(item)).filter(Boolean))];
}

function toLabel(value) {
  return normalizeText(value).toLowerCase();
}

function inferIndustry({
  industry,
  businessCategory,
  siteProfile,
  title,
  h1
}) {
  const explicit = normalizeText(industry || businessCategory);
  if (explicit) {
    return explicit;
  }
  const keywords = Array.isArray(siteProfile?.visibleServiceKeywords) ? siteProfile.visibleServiceKeywords : [];
  if (keywords.length) {
    return keywords[0];
  }
  const source = toLabel(`${title || ''} ${h1 || ''}`);
  // Target verticals per docs/POSITIONING.md (Year 1):
  // plumbing, HVAC, roofing, electrical, pest control, tree service,
  // garage door, restoration. Secondary patterns kept for broader coverage.
  const patterns = [
    { pattern: /roof|roofing/, value: 'roofing' },
    { pattern: /plumb|drain|water heater|sewer/, value: 'plumber' },
    { pattern: /hvac|heating|cooling|air conditioning|furnace|\bac\b/, value: 'hvac' },
    { pattern: /electri/, value: 'electrician' },
    { pattern: /pest|exterminat|termite|rodent/, value: 'pest control' },
    { pattern: /tree service|tree removal|stump|arborist/, value: 'tree service' },
    { pattern: /garage door/, value: 'garage door' },
    { pattern: /restoration|water damage|fire damage|mold remediation|mitigation/, value: 'restoration' },
    // Secondary (not Year-1 target but we still detect them to avoid falling back to 'local service'):
    { pattern: /dental|dentist/, value: 'dentist' },
    { pattern: /attorney|law firm|legal/, value: 'attorney' },
    { pattern: /landscap|lawn/, value: 'landscaping' },
    { pattern: /cleaning|maid/, value: 'cleaning service' }
  ];
  const found = patterns.find((entry) => entry.pattern.test(source));
  return found ? found.value : 'local service';
}

function inferLocation({ market, city, state, siteProfile }) {
  const explicitMarket = normalizeText(market);
  if (explicitMarket) {
    return explicitMarket;
  }
  const cityValue = normalizeText(city);
  const stateValue = normalizeText(state);
  if (cityValue || stateValue) {
    return `${cityValue} ${stateValue}`.trim();
  }
  const mentions = Array.isArray(siteProfile?.locationMentions) ? siteProfile.locationMentions : [];
  const firstCityState = mentions.find((item) => /,\s*[A-Z]{2}\b/.test(item));
  if (firstCityState) {
    return normalizeText(firstCityState);
  }
  return '';
}

function inferServiceVariantTerms(industrySeed) {
  const base = toLabel(industrySeed);
  const variants = [];
  // Year-1 target verticals (docs/POSITIONING.md):
  if (/plumb/.test(base)) {
    variants.push('emergency plumber', 'water heater repair', 'drain cleaning');
  } else if (/roof/.test(base)) {
    variants.push('roof repair', 'roof replacement', 'emergency roofing');
  } else if (/hvac|heating|cooling|furnace|\bac\b/.test(base)) {
    variants.push('ac repair', 'furnace repair', 'hvac installation');
  } else if (/electric/.test(base)) {
    variants.push('emergency electrician', 'electrical repair', 'panel upgrade');
  } else if (/pest|exterminat|termite/.test(base)) {
    variants.push('pest control service', 'termite treatment', 'exterminator');
  } else if (/tree/.test(base)) {
    variants.push('tree removal', 'tree trimming', 'stump grinding');
  } else if (/garage door/.test(base)) {
    variants.push('garage door repair', 'garage door opener', 'garage door installation');
  } else if (/restoration|water damage|fire damage|mold/.test(base)) {
    variants.push('water damage restoration', 'fire damage restoration', 'mold remediation');
  // Secondary verticals:
  } else if (/dent/.test(base)) {
    variants.push('emergency dentist', 'teeth cleaning', 'family dentist');
  } else {
    variants.push(`best ${industrySeed}`, `${industrySeed} near me`, `${industrySeed} company`);
  }
  return uniqueStrings(variants);
}

function generateLocalIntentQueries({
  industry,
  city,
  state,
  businessCategory,
  businessName,
  market,
  siteProfile,
  title,
  h1
}) {
  const industrySeed = inferIndustry({ industry, businessCategory, siteProfile, title, h1 });
  const locationSeed = inferLocation({ market, city, state, siteProfile });
  const locationSuffix = locationSeed ? ` ${locationSeed}` : '';
  const business = normalizeText(businessName || siteProfile?.businessName);
  const variants = inferServiceVariantTerms(industrySeed);

  const candidates = uniqueStrings([
    `${industrySeed} in${locationSuffix}`,
    `best ${industrySeed}${locationSuffix}`,
    `emergency ${industrySeed}${locationSuffix}`,
    `${variants[0] || industrySeed}${locationSuffix}`,
    `${variants[1] || `${industrySeed} near me`}${locationSuffix}`,
    `${variants[2] || `${industrySeed} company`}${locationSuffix}`,
    business ? `${business}${locationSuffix}` : '',
    `${industrySeed} ${locationSeed || 'near me'}`
  ]);

  return candidates.slice(0, QUERY_COUNT);
}

function domainMatchesTarget(candidateDomain, targetDomain) {
  const candidateRoot = extractRootDomain(candidateDomain);
  const targetRoot = extractRootDomain(targetDomain);
  return Boolean(candidateRoot && targetRoot && candidateRoot === targetRoot);
}

function detectClientPresence(result, clientDomain) {
  const organic = Array.isArray(result?.organicResults) ? result.organicResults : [];
  const localPack = Array.isArray(result?.localPackResults) ? result.localPackResults : [];
  const organicHit = organic.find((entry) => domainMatchesTarget(entry.domain || entry.url, clientDomain));
  const localHit = localPack.find((entry) => domainMatchesTarget(entry.domain || entry.url, clientDomain));
  return {
    clientFoundOrganic: Boolean(organicHit),
    clientOrganicRank: organicHit ? Number(organicHit.position) || null : null,
    clientFoundLocalPack: Boolean(localHit),
    clientLocalPackRank: localHit ? Number(localHit.position) || null : null
  };
}

function extractCompetitorDomains(result, clientDomain) {
  const all = []
    .concat(Array.isArray(result?.organicResults) ? result.organicResults : [])
    .concat(Array.isArray(result?.localPackResults) ? result.localPackResults : []);
  return uniqueStrings(
    all
      .map((entry) => normalizeDomain(entry.domain || entry.url))
      .filter((domain) => domain && !domainMatchesTarget(domain, clientDomain))
  );
}

function buildCompetitorAggregates(resultRows) {
  const frequency = new Map();
  const matrix = {};

  resultRows.forEach((row, queryIndex) => {
    const queryKey = `query-${queryIndex + 1}`;
    const organic = Array.isArray(row.organicResults) ? row.organicResults : [];
    const localPack = Array.isArray(row.localPackResults) ? row.localPackResults : [];

    [...organic, ...localPack].forEach((entry) => {
      const domain = normalizeDomain(entry.domain || entry.url);
      if (!domain) {
        return;
      }
      frequency.set(domain, (frequency.get(domain) || 0) + 1);
      if (!matrix[domain]) {
        matrix[domain] = {};
      }
      const current = matrix[domain][queryKey];
      if (current === undefined || Number(entry.position) < current) {
        matrix[domain][queryKey] = Number(entry.position) || null;
      }
    });
  });

  const competitorsByFrequency = [...frequency.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

  return {
    competitorsByFrequency,
    topRecurringCompetitors: competitorsByFrequency.slice(0, 5),
    competitorAppearanceMatrix: matrix
  };
}

function computeVisibilityScore(rows) {
  let total = 0;
  rows.forEach((row) => {
    if (row.clientFoundOrganic) {
      total += row.clientOrganicRank ? Math.max(2, 12 - row.clientOrganicRank) : 4;
    }
    if (row.clientFoundLocalPack) {
      total += row.clientLocalPackRank ? Math.max(1, 8 - row.clientLocalPackRank) : 3;
    }
  });
  return Math.max(0, Math.min(100, Math.round((total / (QUERY_COUNT * 20)) * 100)));
}

function buildBusinessTakeaway(row) {
  if (row.clientFoundOrganic && row.clientFoundLocalPack) {
    return 'You appear in both organic and local results for this query. Keep improving trust and local proof to defend position.';
  }
  if (row.clientFoundOrganic && !row.clientFoundLocalPack) {
    return 'You rank organically, but map-pack visibility is weak. Improve GBP signals, reviews, and local citation consistency.';
  }
  if (!row.clientFoundOrganic && row.clientFoundLocalPack) {
    return 'You are visible in local pack but missing from top organic results. Strengthen landing page relevance and on-page authority.';
  }
  return 'You are not visible in top results for this query. Competitors are capturing local demand you could convert.';
}

function filterRowsForPackage(rows, level) {
  if (level === 'gold' || level === 'admin') {
    return rows;
  }
  if (level === 'silver') {
    return rows.map((row) => ({
      query: row.query,
      location: row.location,
      timestamp: row.timestamp,
      clientFoundOrganic: row.clientFoundOrganic,
      clientOrganicRank: row.clientOrganicRank,
      clientFoundLocalPack: row.clientFoundLocalPack,
      clientLocalPackRank: row.clientLocalPackRank,
      topCompetitorDomains: row.topCompetitorDomains,
      organicResults: row.organicResults,
      localPackResults: row.localPackResults,
      takeaway: row.takeaway
    }));
  }
  return [];
}

function formatVisibilitySummary(localSearchVisibility) {
  const summary = localSearchVisibility?.summary || {};
  const found = Number(summary.foundInOrganicCount) || 0;
  const local = Number(summary.foundInLocalPackCount) || 0;
  const missing = Number(summary.missingCount) || 0;
  const total = Number(summary.totalQueries) || QUERY_COUNT;
  const topCompetitorAppearanceCount = Number(summary.topCompetitorAppearanceCount) || 0;
  return `Found in Top 10: ${found}/${total}. Missing: ${missing}/${total}. Map Pack: ${local}/${total}. Top competitor appears: ${topCompetitorAppearanceCount}/${total}.`;
}

function filterLocalSearchVisibilityByPackage(localSearchVisibility, level) {
  const safe = localSearchVisibility || {
    status: 'unavailable',
    generatedQueries: [],
    results: [],
    summary: {}
  };
  const base = {
    status: safe.status || 'ok',
    generatedQueries: Array.isArray(safe.generatedQueries) ? safe.generatedQueries : [],
    summary: safe.summary || {},
    visibilitySummary: formatVisibilitySummary(safe),
    error: safe.error || ''
  };

  if (level === 'free') {
    return base;
  }
  if (level === 'silver') {
    return {
      ...base,
      results: filterRowsForPackage(safe.results, 'silver'),
      topRecurringCompetitors: Array.isArray(safe.topRecurringCompetitors) ? safe.topRecurringCompetitors : []
    };
  }
  return {
    ...safe,
    ...base,
    results: filterRowsForPackage(safe.results, 'gold'),
    competitorsByFrequency: safe.competitorsByFrequency || [],
    topRecurringCompetitors: safe.topRecurringCompetitors || [],
    competitorAppearanceMatrix: safe.competitorAppearanceMatrix || {}
  };
}

async function maybeWriteScreenshot({ auditId, queryIndex, screenshot, rootDir }) {
  if (!screenshot || !screenshot.screenshotUrl) {
    return { screenshotUrl: '', screenshotPath: '' };
  }
  const enabled = String(process.env.SERP_SCREENSHOT_ENABLED || 'true').toLowerCase() === 'true';
  if (!enabled) {
    return { screenshotUrl: screenshot.screenshotUrl, screenshotPath: '' };
  }

  const shouldDownload = String(process.env.SERP_SCREENSHOT_DOWNLOAD || 'false').toLowerCase() === 'true';
  const relPath = path.join('data', 'serp-screenshots', auditId, `query-${queryIndex + 1}.png`);
  const absPath = path.join(rootDir, relPath);

  if (!shouldDownload) {
    return { screenshotUrl: screenshot.screenshotUrl, screenshotPath: absPath };
  }

  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const response = await fetch(screenshot.screenshotUrl);
    if (!response.ok) {
      return { screenshotUrl: screenshot.screenshotUrl, screenshotPath: '' };
    }
    const contentType = normalizeText(response.headers.get('content-type')).toLowerCase();
    if (!contentType.includes('image/')) {
      return { screenshotUrl: screenshot.screenshotUrl, screenshotPath: '' };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(absPath, buffer);
    return { screenshotUrl: screenshot.screenshotUrl, screenshotPath: absPath };
  } catch {
    return { screenshotUrl: screenshot.screenshotUrl, screenshotPath: '' };
  }
}

async function runLocalSearchVisibilityAudit({
  auditId,
  rootDir,
  targetUrl,
  finalUrl,
  industry,
  city,
  state,
  market,
  businessCategory,
  businessName,
  siteProfile,
  title,
  h1
}) {
  const provider = createSerpProvider();
  const clientDomain = normalizeDomain(finalUrl || targetUrl);
  const generatedQueries = generateLocalIntentQueries({
    industry,
    city,
    state,
    market,
    businessCategory,
    businessName,
    siteProfile,
    title,
    h1
  });
  const location = buildSerpLocation({ city, state });
  const fallbackQueries = uniqueStrings([
    `${industry || businessCategory || 'local service'} ${market || `${city || ''} ${state || ''}`.trim()}`.trim(),
    `${industry || businessCategory || 'local service'} near me`
  ]);
  while (generatedQueries.length < QUERY_COUNT && fallbackQueries.length) {
    generatedQueries.push(fallbackQueries.shift());
  }
  while (generatedQueries.length < QUERY_COUNT) {
    generatedQueries.push(`best local service ${location || 'near me'} ${generatedQueries.length + 1}`);
  }
  const resultRows = [];
  const errors = [];

  for (let idx = 0; idx < QUERY_COUNT; idx += 1) {
    const query = generatedQueries[idx];
    if (!query) {
      continue;
    }
    try {
      const raw = await provider.getSearchResults(query, location, { num: 10 });
      const normalized = provider.normalizeResults(raw, { query, location });
      const clientPresence = detectClientPresence(normalized, clientDomain);
      const topCompetitorDomains = extractCompetitorDomains(normalized, clientDomain).slice(0, 8);
      const screenshotMetaRaw = await provider.getSerpScreenshot(query, location, {
        rawResult: raw,
        normalizedResult: normalized,
        queryIndex: idx,
        auditId
      });
      const screenshotMeta = await maybeWriteScreenshot({
        auditId,
        queryIndex: idx,
        screenshot: screenshotMetaRaw,
        rootDir
      });

      resultRows.push({
        query,
        location: normalized.location || location,
        timestamp: normalized.timestamp || new Date().toISOString(),
        organicResults: Array.isArray(normalized.organicResults) ? normalized.organicResults.slice(0, 10) : [],
        localPackResults: Array.isArray(normalized.localPackResults) ? normalized.localPackResults.slice(0, 10) : [],
        ...clientPresence,
        screenshotUrl: screenshotMeta.screenshotUrl || '',
        screenshotPath: screenshotMeta.screenshotPath || '',
        topCompetitorDomains,
        takeaway: buildBusinessTakeaway({
          ...clientPresence
        }),
        querySource: 'generated'
      });
    } catch (error) {
      errors.push({
        query,
        message: error && error.message ? error.message : 'local search query failed'
      });
      resultRows.push({
        query,
        location,
        timestamp: new Date().toISOString(),
        organicResults: [],
        localPackResults: [],
        clientFoundOrganic: false,
        clientOrganicRank: null,
        clientFoundLocalPack: false,
        clientLocalPackRank: null,
        screenshotUrl: '',
        screenshotPath: '',
        topCompetitorDomains: [],
        takeaway: 'Local ranking data unavailable for this query.',
        querySource: 'generated',
        error: error && error.message ? error.message : 'local search query failed'
      });
    }
  }

  const foundInOrganicCount = resultRows.filter((row) => row.clientFoundOrganic).length;
  const foundInLocalPackCount = resultRows.filter((row) => row.clientFoundLocalPack).length;
  const missingCount = resultRows.filter((row) => !row.clientFoundOrganic && !row.clientFoundLocalPack).length;
  const aggregates = buildCompetitorAggregates(resultRows.map((row) => ({
    organicResults: row.organicResults,
    localPackResults: row.localPackResults
  })));
  const visibilityScore = computeVisibilityScore(resultRows);
  const topCompetitorAppearanceCount = aggregates.topRecurringCompetitors[0]?.count || 0;
  let interpretation = 'Customers are seeing your competitors before they see you.';
  if (foundInOrganicCount >= 4 || (foundInOrganicCount >= 3 && foundInOrganicCount > missingCount)) {
    interpretation = 'You are visible in most searches, but competitors still appear often. Keep improving to protect lead flow.';
  } else if (foundInOrganicCount > 0 && foundInOrganicCount === missingCount) {
    interpretation = 'You appear in some searches but still miss too many opportunities in your area.';
  }

  return {
    status: errors.length ? (resultRows.length ? 'partial' : 'unavailable') : 'ok',
    provider: provider.name,
    generatedQueries: generatedQueries.slice(0, QUERY_COUNT),
    results: resultRows.slice(0, QUERY_COUNT),
    competitorsByFrequency: aggregates.competitorsByFrequency,
    topRecurringCompetitors: aggregates.topRecurringCompetitors,
    competitorAppearanceMatrix: aggregates.competitorAppearanceMatrix,
    summary: {
      foundInOrganicCount,
      foundInLocalPackCount,
      missingCount,
      totalQueries: QUERY_COUNT,
      topCompetitorAppearanceCount,
      interpretation,
      recurringCompetitors: aggregates.topRecurringCompetitors,
      visibilityScore
    },
    errors
  };
}

module.exports = {
  generateLocalIntentQueries,
  runLocalSearchVisibilityAudit,
  filterLocalSearchVisibilityByPackage,
  detectClientPresence,
  extractCompetitorDomains
};
