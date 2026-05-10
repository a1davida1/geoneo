/**
 * Dollar Lift Engine — turns audit findings into explainable dollar estimates.
 *
 * NO LLM. Pure deterministic math. Every estimate exposes its inputs so the
 * customer (or Matt on a call) can trace the number back to industry CPL,
 * monthly query volume, position-lift assumption, and CTR curve.
 *
 * Two flavors of estimate per finding:
 *  - GENERAL ("Contractors in your vertical without X average $Y-$Z/mo")
 *  - SPECIFIC ("YOU specifically are missing from N queries; at $CPL that's $Y-$Z/mo")
 *
 * The estimate has a confidence band (low/high) and a method label so we
 * never claim more precision than we have.
 */

// Industry CPL benchmarks (USD per acquired lead). Used to convert position
// gains into dollar value. Values are local-market averages from public
// LSA + Google Ads + agency-published reports as of 2026.
const CPL_BY_INDUSTRY = {
  attorney: 120, lawyer: 120, legal: 120, 'personal injury': 250,
  roofing: 85, roofer: 85,
  hvac: 75, heating: 70, cooling: 70, 'air conditioning': 75,
  restoration: 70, 'water damage': 80, 'mold remediation': 80, 'fire damage': 90,
  plumber: 65, plumbing: 65, 'emergency plumber': 95,
  electrician: 60, electrical: 60,
  'garage door': 60,
  remodeling: 55, contractor: 50, construction: 50, 'general contractor': 50, 'kitchen remodel': 75, 'bathroom remodel': 65,
  'pest control': 50, exterminator: 50, 'termite': 70,
  painting: 45, painter: 45,
  dentist: 45, dental: 45, 'dental implants': 200, 'cosmetic dentist': 130,
  landscaping: 40, lawn: 35, 'tree service': 35, arborist: 35,
  hotel: 40, lodging: 40, 'bed and breakfast': 35,
  restaurant: 25, cafe: 22, bar: 20,
  cleaning: 30, janitorial: 30,
  fishing: 25, 'fishing guide': 25,
  entertainment: 22, theater: 22, attractions: 22,
  towing: 35, recovery: 35, 'auto body': 40, 'auto repair': 35, mechanic: 35,
  'real estate agent': 90, realtor: 90, 'real estate': 90,
  insurance: 65, 'insurance agent': 65,
  accountant: 55, cpa: 55, bookkeeping: 45,
  chiropractor: 70, physiotherapy: 60,
  veterinarian: 55, vet: 55,
  'moving company': 55, movers: 55,
  locksmith: 40,
  'beauty salon': 25, salon: 25, barber: 18, spa: 35, nails: 22,
  default: 50
};

// CTR curve by SERP position (Google organic, local-pack, AI snippets).
// Source: composite of Advanced Web Ranking + Sistrix 2024-2025 click studies
// for local-intent commercial queries (lower CTR vs informational queries).
const CTR_BY_POSITION = {
  // Organic positions
  organic: [
    { pos: 1, ctr: 0.31 }, { pos: 2, ctr: 0.21 }, { pos: 3, ctr: 0.15 },
    { pos: 4, ctr: 0.10 }, { pos: 5, ctr: 0.07 }, { pos: 6, ctr: 0.05 },
    { pos: 7, ctr: 0.04 }, { pos: 8, ctr: 0.03 }, { pos: 9, ctr: 0.025 }, { pos: 10, ctr: 0.022 },
    { pos: 11, ctr: 0.012 }, { pos: 15, ctr: 0.008 }, { pos: 20, ctr: 0.005 }, { pos: 99, ctr: 0.001 }
  ],
  // Local pack (3-pack map) positions
  localPack: [
    { pos: 1, ctr: 0.45 }, { pos: 2, ctr: 0.28 }, { pos: 3, ctr: 0.18 }, { pos: 99, ctr: 0 }
  ],
  // AI engine citations — binary (cited or not), but for math purposes we
  // treat a citation as ~0.20 CTR-equivalent for queries the engine answered
  aiCitation: [
    { pos: 1, ctr: 0.20 }, { pos: 99, ctr: 0 }
  ]
};

// Conversion rate from click → lead → customer for local services.
// Click → lead: typical 4-8% for service business landing pages.
// Lead → customer: typical 25-40% (warm inbound has high close rate).
const CONVERSION_RATES = {
  clickToLead: { low: 0.04, high: 0.08 },
  leadToCustomer: { low: 0.25, high: 0.40 }
};

// Estimated monthly query volume for "[industry] [city]" queries by city size.
// Pulled from Google Keyword Planner / DataForSEO benchmarks for US local
// commercial queries 2024-2025. These are PER QUERY (e.g., "plumber Branson MO"
// gets ~X searches/mo). Multi-query verticals multiply by 5-15x for the
// long-tail set (emergency, drain, water-heater, etc.).
const QUERY_VOLUME_BY_CITY_SIZE = {
  // City population brackets → est. monthly searches for primary commercial query
  micro: { popMax: 25000, primaryQueryMonthly: 70, longTailMultiplier: 6 },     // Branson, Ozark, Republic
  small: { popMax: 75000, primaryQueryMonthly: 220, longTailMultiplier: 8 },    // Joplin, Bentonville, Rogers
  medium: { popMax: 250000, primaryQueryMonthly: 720, longTailMultiplier: 11 }, // Springfield, Fayetteville, Little Rock
  large: { popMax: 1000000, primaryQueryMonthly: 2400, longTailMultiplier: 14 },
  metro: { popMax: Infinity, primaryQueryMonthly: 7800, longTailMultiplier: 18 }
};

const KNOWN_CITY_POPULATIONS = {
  branson: 12500, ozark: 21000, republic: 18000, nixa: 24000,
  joplin: 51000, bentonville: 56000, rogers: 71000, fayetteville: 95000,
  springfield: 170000, 'little rock': 198000,
  // expansion grid
  tulsa: 410000, 'oklahoma city': 695000, wichita: 397000, 'kansas city': 510000,
  'st louis': 293000, columbia: 130000, 'cape girardeau': 40000
};

function cplFor(industry) {
  if (!industry) return CPL_BY_INDUSTRY.default;
  const key = String(industry).toLowerCase().trim();
  if (CPL_BY_INDUSTRY[key]) return CPL_BY_INDUSTRY[key];
  for (const [k, v] of Object.entries(CPL_BY_INDUSTRY)) {
    if (key.includes(k)) return v;
  }
  return CPL_BY_INDUSTRY.default;
}

function citySizeBucketFor(city) {
  if (!city) return QUERY_VOLUME_BY_CITY_SIZE.small;
  const key = String(city).toLowerCase().trim();
  const pop = KNOWN_CITY_POPULATIONS[key];
  if (!pop) return QUERY_VOLUME_BY_CITY_SIZE.small; // unknown small-town default
  for (const [, bucket] of Object.entries(QUERY_VOLUME_BY_CITY_SIZE)) {
    if (pop <= bucket.popMax) return bucket;
  }
  return QUERY_VOLUME_BY_CITY_SIZE.metro;
}

function ctrAtPosition(curve, position) {
  const list = CTR_BY_POSITION[curve] || CTR_BY_POSITION.organic;
  const numericPos = Number.isFinite(Number(position)) ? Number(position) : 99;
  // Find the closest entry at or below the requested position
  const sorted = list.slice().sort((a, b) => a.pos - b.pos);
  let last = sorted[sorted.length - 1];
  for (const entry of sorted) {
    if (entry.pos >= numericPos) return entry.ctr;
    last = entry;
  }
  return last.ctr;
}

function range(low, high) {
  return { low: Math.round(low), high: Math.round(high) };
}

/**
 * Compute the dollar lift from moving from currentPosition → targetPosition
 * for a single query at a known monthly search volume.
 *
 * Returns a confidence-banded range with explainable inputs.
 */
function estimateQueryLift({ industry, monthlyVolume, currentPosition, targetPosition = 1, surface = 'organic' }) {
  const cpl = cplFor(industry);
  const ctrCurrent = ctrAtPosition(surface, currentPosition);
  const ctrTarget = ctrAtPosition(surface, targetPosition);
  const ctrGain = Math.max(0, ctrTarget - ctrCurrent);

  const monthlyClicksGained = monthlyVolume * ctrGain;
  const leadsLow = monthlyClicksGained * CONVERSION_RATES.clickToLead.low;
  const leadsHigh = monthlyClicksGained * CONVERSION_RATES.clickToLead.high;
  const dollarsLow = leadsLow * cpl;
  const dollarsHigh = leadsHigh * cpl;

  return {
    monthlyDollarLift: range(dollarsLow, dollarsHigh),
    monthlyLeadLift: range(leadsLow, leadsHigh),
    monthlyClicksGained: Math.round(monthlyClicksGained),
    inputs: {
      query_volume_monthly: monthlyVolume,
      current_position: currentPosition,
      target_position: targetPosition,
      surface,
      ctr_at_current: ctrCurrent,
      ctr_at_target: ctrTarget,
      ctr_gain: ctrGain,
      industry_cpl: cpl,
      click_to_lead_rate: CONVERSION_RATES.clickToLead,
      method: 'CPL × position_lift × CTR_curve × monthly_volume'
    }
  };
}

/**
 * Compute the SPECIFIC dollar loss for a prospect based on their actual
 * audit data — number of queries they're missing from, observed positions,
 * and their industry/city.
 */
function estimateSpecificLoss({ industry, city, missingFromQueries = 0, totalQueriesTested = 8, currentAvgPosition = 99 }) {
  const cityBucket = citySizeBucketFor(city);
  const cpl = cplFor(industry);

  // Estimate total relevant monthly query volume for this prospect's market
  // = primary query + long-tail set
  const longTailQueries = Math.min(totalQueriesTested, cityBucket.longTailMultiplier);
  const totalMonthlyVolume = cityBucket.primaryQueryMonthly + (longTailQueries * cityBucket.primaryQueryMonthly * 0.18);

  // Of that volume, the prospect captures CTR-at-current, loses CTR-at-1
  const ctrAtCurrent = ctrAtPosition('organic', currentAvgPosition);
  const ctrAtTop = ctrAtPosition('organic', 1);
  const lostCtr = Math.max(0, ctrAtTop - ctrAtCurrent);

  // Apply the missing-from-queries ratio: if missing from 6/8 = 75% of opportunity
  const missingRatio = totalQueriesTested > 0 ? missingFromQueries / totalQueriesTested : 0;
  const effectiveLostMonthlyVolume = totalMonthlyVolume * Math.max(0.4, missingRatio); // floor at 40% even for partial misses

  const monthlyClicksLost = effectiveLostMonthlyVolume * lostCtr;
  const leadsLow = monthlyClicksLost * CONVERSION_RATES.clickToLead.low;
  const leadsHigh = monthlyClicksLost * CONVERSION_RATES.clickToLead.high;
  const dollarsLow = leadsLow * cpl;
  const dollarsHigh = leadsHigh * cpl;

  const monthly = range(dollarsLow, dollarsHigh);
  return {
    monthlyDollarLoss: monthly,
    monthlyLeadLoss: range(leadsLow, leadsHigh),
    annualDollarLoss: { low: monthly.low * 12, high: monthly.high * 12 },
    inputs: {
      industry,
      city,
      cityPopulationBucket: cityBucket.popMax === Infinity ? 'metro' : (cityBucket.popMax === 25000 ? 'micro' : (cityBucket.popMax === 75000 ? 'small' : (cityBucket.popMax === 250000 ? 'medium' : 'large'))),
      industry_cpl: cpl,
      total_queries_tested: totalQueriesTested,
      missing_from_queries: missingFromQueries,
      missing_ratio: Math.round(missingRatio * 100) / 100,
      effective_monthly_volume: Math.round(effectiveLostMonthlyVolume),
      current_avg_position: currentAvgPosition,
      ctr_lost: lostCtr,
      method: 'cityBucket.volume × missing_ratio × ctr_lift × click_to_lead × cpl'
    }
  };
}

/**
 * Compute the GENERAL dollar context for a vertical+market — what businesses
 * in this category typically lose if they don't have a given capability.
 * Used for "Contractors in your vertical without X average $Y-$Z/mo" framing.
 */
function estimateGeneralContext({ industry, city, capability }) {
  const cityBucket = citySizeBucketFor(city);
  const cpl = cplFor(industry);

  // Capability impact factor — how much of total opportunity volume is
  // captured by this single capability. Sourced from public SEO studies +
  // our own audit data.
  const CAPABILITY_IMPACT = {
    schema_localBusiness: 0.15,    // ~15% lift from complete LocalBusiness schema in local pack eligibility
    schema_faq: 0.12,              // ~12% lift from FAQ schema for AI engine citation
    eeat_strong: 0.18,             // ~18% lift from strong E-E-A-T signals
    geo_llms_txt: 0.06,            // ~6% lift currently (early adopter advantage)
    geo_passage_blocks: 0.10,      // ~10% lift from Q&A / definition blocks
    nap_consistent: 0.08,          // ~8% lift from cross-platform NAP consistency
    sitemap_complete: 0.04,        // ~4% lift from clean sitemap.xml
    mobile_optimized: 0.14,        // ~14% lift from mobile-first ranking
    page_speed: 0.09,              // ~9% lift from Core Web Vitals improvement
    content_velocity: 0.16,        // ~16% lift from regular publishing (1+/week)
    ad_alignment: 0.22             // ~22% lift from properly-aligned ad spend (Smart Spend tier)
  };

  const impactFactor = CAPABILITY_IMPACT[capability] || 0.08;
  const longTailVolume = cityBucket.primaryQueryMonthly * cityBucket.longTailMultiplier * 0.18;
  const totalVolume = cityBucket.primaryQueryMonthly + longTailVolume;

  // What the average business loses by not having this capability
  const lostMonthlyClicks = totalVolume * impactFactor * 0.25; // 25% capture from opportunity
  const dollarsLow = lostMonthlyClicks * CONVERSION_RATES.clickToLead.low * cpl;
  const dollarsHigh = lostMonthlyClicks * CONVERSION_RATES.clickToLead.high * cpl;

  const monthly = range(dollarsLow, dollarsHigh);
  return {
    monthlyDollarLoss: monthly,
    annualDollarLoss: { low: monthly.low * 12, high: monthly.high * 12 },
    inputs: {
      industry,
      city,
      capability,
      capability_impact_factor: impactFactor,
      industry_cpl: cpl,
      total_relevant_monthly_volume: Math.round(totalVolume),
      method: 'Industry-vertical benchmark: capability_impact × city_volume × cpl'
    },
    framing: `Contractors in ${industry || 'your vertical'} ${city ? `serving ${city}-size markets ` : ''}who lack ${capabilityLabel(capability)} typically miss $${Math.round(dollarsLow)}-$${Math.round(dollarsHigh)} per month in unconverted local search demand.`
  };
}

function capabilityLabel(capability) {
  const labels = {
    schema_localBusiness: 'a complete LocalBusiness schema',
    schema_faq: 'FAQ schema for AI citations',
    eeat_strong: 'strong E-E-A-T signals (credentials, reviews, trust marks)',
    geo_llms_txt: 'an llms.txt file for AI engines',
    geo_passage_blocks: 'AI-citable Q&A and definition blocks',
    nap_consistent: 'consistent NAP across major platforms',
    sitemap_complete: 'a clean sitemap.xml',
    mobile_optimized: 'mobile-first optimization',
    page_speed: 'good Core Web Vitals',
    content_velocity: 'regular publishing cadence',
    ad_alignment: 'properly-aligned ad spend'
  };
  return labels[capability] || capability;
}

/**
 * Top-level: produce both general + specific dollar context for a single
 * audit finding. This is what gets stamped onto every finding in the audit
 * output.
 */
function estimateForFinding({ findingKey, industry, city, missingFromQueries = 0, totalQueriesTested = 8, currentAvgPosition = 99 }) {
  // Map finding key → capability for the general estimate
  const FINDING_TO_CAPABILITY = {
    'schema-add-LocalBusiness': 'schema_localBusiness',
    'schema-add-FAQPage': 'schema_faq',
    'eeat-trust-add-phone': 'eeat_strong',
    'eeat-trust-add-address': 'eeat_strong',
    'eeat-experience-add-years': 'eeat_strong',
    'eeat-expertise-credentials': 'eeat_strong',
    'eeat-authority-press': 'eeat_strong',
    'geo-add-llms-txt': 'geo_llms_txt',
    'geo-add-qa-blocks': 'geo_passage_blocks',
    'geo-add-definition-blocks': 'geo_passage_blocks',
    'geo-unblock-ai-crawlers': 'geo_passage_blocks',
    'nap-inconsistent': 'nap_consistent',
    'sitemap-missing': 'sitemap_complete',
    'mobile-not-optimized': 'mobile_optimized',
    'cwv-poor': 'page_speed',
    'content-velocity-low': 'content_velocity',
    'ad-spend-misaligned': 'ad_alignment'
  };

  const capability = FINDING_TO_CAPABILITY[findingKey] || 'schema_localBusiness';
  const general = estimateGeneralContext({ industry, city, capability });
  const specific = estimateSpecificLoss({ industry, city, missingFromQueries, totalQueriesTested, currentAvgPosition });

  return {
    findingKey,
    general,
    specific,
    headlineText: `Industry baseline: $${general.monthlyDollarLoss.low}-$${general.monthlyDollarLoss.high}/mo. Your specific exposure: $${specific.monthlyDollarLoss.low}-$${specific.monthlyDollarLoss.high}/mo (missing from ${missingFromQueries}/${totalQueriesTested} queries we ran).`
  };
}

module.exports = {
  CPL_BY_INDUSTRY,
  CTR_BY_POSITION,
  CONVERSION_RATES,
  QUERY_VOLUME_BY_CITY_SIZE,
  cplFor,
  citySizeBucketFor,
  ctrAtPosition,
  estimateQueryLift,
  estimateSpecificLoss,
  estimateGeneralContext,
  estimateForFinding,
  capabilityLabel
};
