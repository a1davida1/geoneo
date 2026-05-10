/**
 * Schema Analyzer — deterministic Schema.org JSON-LD detection, validation,
 * depth scoring, and generation. NO LLM at runtime.
 *
 * Detects: JSON-LD <script type="application/ld+json">, microdata
 * itemscope/itemtype, basic OpenGraph as schema-adjacent.
 *
 * Per Schema.org docs (https://schema.org/), each type has a required core
 * (@context, @type, name) plus strongly-recommended fields per type. We
 * validate against published Google rich-result requirements where stricter.
 *
 * Generates ready-to-paste JSON-LD from real extracted page facts —
 * no AI completion, just structured field assembly + spec validation.
 */

const REQUIRED_BY_TYPE = {
  LocalBusiness: ['name', 'address'],
  Organization: ['name'],
  Service: ['name', 'provider'],
  Product: ['name'],
  FAQPage: ['mainEntity'],
  BreadcrumbList: ['itemListElement'],
  Review: ['itemReviewed', 'reviewRating', 'author'],
  AggregateRating: ['ratingValue', 'reviewCount'],
  Person: ['name'],
  Article: ['headline', 'author', 'datePublished'],
  WebSite: ['name', 'url'],
  WebPage: ['name'],
  Event: ['name', 'startDate', 'location']
};

// Strongly-recommended fields beyond the required core. Coverage of these
// drives the depth score 0-100. Pulled from Schema.org + Google Search
// Central rich-result documentation as of 2026.
const RECOMMENDED_BY_TYPE = {
  LocalBusiness: [
    'address', 'telephone', 'openingHours', 'openingHoursSpecification', 'geo',
    'image', 'logo', 'url', 'priceRange', 'paymentAccepted', 'areaServed',
    'sameAs', 'aggregateRating', 'review', 'hasOfferCatalog', 'description',
    'email', 'foundingDate', 'numberOfEmployees', 'currenciesAccepted'
  ],
  Organization: [
    'logo', 'url', 'sameAs', 'address', 'telephone', 'email',
    'contactPoint', 'foundingDate', 'description', 'image', 'aggregateRating'
  ],
  Service: [
    'description', 'serviceType', 'areaServed', 'provider', 'offers',
    'aggregateRating', 'image', 'hoursAvailable', 'serviceOutput'
  ],
  Product: [
    'image', 'description', 'brand', 'offers', 'aggregateRating',
    'review', 'sku', 'gtin', 'mpn'
  ],
  FAQPage: ['mainEntity'],
  BreadcrumbList: ['itemListElement'],
  Review: ['datePublished', 'reviewBody', 'name'],
  AggregateRating: ['bestRating', 'worstRating'],
  Article: [
    'image', 'dateModified', 'publisher', 'mainEntityOfPage',
    'description', 'articleBody', 'wordCount'
  ],
  WebSite: ['potentialAction', 'description', 'publisher'],
  Event: ['endDate', 'description', 'image', 'offers', 'organizer']
};

// Type aliases — Schema.org has many subtypes that should validate as their
// parent. e.g. Restaurant validates as LocalBusiness too.
const SCHEMA_TYPE_ALIASES = {
  Restaurant: 'LocalBusiness', Hotel: 'LocalBusiness', Lodging: 'LocalBusiness',
  Plumber: 'LocalBusiness', Electrician: 'LocalBusiness', HVACBusiness: 'LocalBusiness',
  RoofingContractor: 'LocalBusiness', GeneralContractor: 'LocalBusiness',
  HomeAndConstructionBusiness: 'LocalBusiness', LegalService: 'LocalBusiness',
  Attorney: 'LocalBusiness', Dentist: 'LocalBusiness', Physician: 'LocalBusiness',
  AutoBodyShop: 'LocalBusiness', AutoRepair: 'LocalBusiness',
  Store: 'LocalBusiness', GardenStore: 'LocalBusiness',
  TouristAttraction: 'LocalBusiness', TravelAgency: 'LocalBusiness',
  PestControlBusiness: 'LocalBusiness', RealEstateAgent: 'LocalBusiness',
  ProfessionalService: 'LocalBusiness', FinancialService: 'LocalBusiness',
  EmergencyService: 'LocalBusiness', PoliceStation: 'LocalBusiness',
  NewsArticle: 'Article', BlogPosting: 'Article', TechArticle: 'Article'
};

// Recommended schemas per business vertical for local home-service contractors.
// What a contractor SHOULD have on their site to maximize rich-result eligibility.
const VERTICAL_SCHEMA_RECOMMENDATIONS = {
  default: ['LocalBusiness', 'WebSite', 'BreadcrumbList', 'FAQPage'],
  contractor: ['LocalBusiness', 'Service', 'WebSite', 'BreadcrumbList', 'FAQPage', 'AggregateRating'],
  restaurant: ['Restaurant', 'Menu', 'WebSite', 'BreadcrumbList', 'FAQPage', 'AggregateRating'],
  hotel: ['Hotel', 'WebSite', 'BreadcrumbList', 'FAQPage', 'AggregateRating', 'Review'],
  professional: ['LocalBusiness', 'Person', 'Service', 'WebSite', 'BreadcrumbList', 'FAQPage'],
  attorney: ['LegalService', 'Attorney', 'Person', 'WebSite', 'BreadcrumbList', 'FAQPage'],
  medical: ['MedicalBusiness', 'Physician', 'WebSite', 'BreadcrumbList', 'FAQPage']
};

function pickVerticalKey(industry = '') {
  const ind = String(industry).toLowerCase();
  if (/restaurant|cafe|bar|grill|diner|bistro/.test(ind)) return 'restaurant';
  if (/hotel|lodging|inn|resort|motel|bed.*breakfast/.test(ind)) return 'hotel';
  if (/attorney|lawyer|legal/.test(ind)) return 'attorney';
  if (/doctor|dentist|medical|physician|clinic/.test(ind)) return 'medical';
  if (/contractor|plumber|electrician|hvac|roofing|painter|landscape|tree|pest|garage|remodel|construction/.test(ind)) return 'contractor';
  if (/accountant|consultant|advisor|agent/.test(ind)) return 'professional';
  return 'default';
}

/**
 * Extract every JSON-LD <script> from raw HTML.
 * Returns array of { raw, parsed (object|null), parseError, lineHint }.
 */
function extractJsonLdBlocks(html = '') {
  const blocks = [];
  if (!html) return blocks;
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    let parsed = null;
    let parseError = null;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parseError = err.message || 'JSON parse failed';
    }
    blocks.push({ raw, parsed, parseError });
  }
  return blocks;
}

/**
 * Flatten @graph arrays + bare arrays into a single list of typed nodes.
 */
function flattenSchemaNodes(parsedJsonLd) {
  const out = [];
  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node !== 'object') return;
    if (Array.isArray(node['@graph'])) { node['@graph'].forEach(walk); }
    if (node['@type']) out.push(node);
  }
  walk(parsedJsonLd);
  return out;
}

function normalizeType(typeValue) {
  if (!typeValue) return null;
  if (Array.isArray(typeValue)) return typeValue.map(t => SCHEMA_TYPE_ALIASES[t] || t);
  return SCHEMA_TYPE_ALIASES[typeValue] || typeValue;
}

function getPrimaryType(node) {
  const t = node['@type'];
  if (Array.isArray(t)) return t[0];
  return t;
}

// Per Schema.org spec: nested object fields must contain meaningful sub-fields,
// not just be present. PostalAddress without addressLocality is useless.
const NESTED_FIELD_REQUIREMENTS = {
  address: ['streetAddress', 'addressLocality', 'addressRegion'],
  geo: ['latitude', 'longitude'],
  contactPoint: ['telephone'],
  aggregateRating: ['ratingValue', 'reviewCount'],
  review: ['author', 'reviewRating'],
  offers: ['price', 'priceCurrency'],
  brand: ['name'],
  publisher: ['name'],
  author: ['name'],
  itemReviewed: ['name'],
  reviewRating: ['ratingValue']
};

function fieldPresent(node, fieldName) {
  if (!node) return false;
  const v = node[fieldName];
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) {
    if (v.length === 0) return false;
    // Array of objects: at least one must be substantive
    if (typeof v[0] === 'object') return v.some(item => isSubstantiveObject(item, fieldName));
    return true;
  }
  if (typeof v === 'object') {
    if (Object.keys(v).length === 0) return false;
    return isSubstantiveObject(v, fieldName);
  }
  // Scalar — also validate format for known fields
  return isValidScalar(fieldName, v);
}

function isSubstantiveObject(obj, fieldName) {
  if (!obj || typeof obj !== 'object') return false;
  const required = NESTED_FIELD_REQUIREMENTS[fieldName];
  if (!required) return Object.keys(obj).length > 1; // at minimum @type + something
  return required.every(req => {
    const val = obj[req];
    if (val === undefined || val === null || val === '') return false;
    // Recursively validate scalars within nested object (lat/lng range, etc.)
    if (typeof val !== 'object') return isValidScalar(req, val);
    return true;
  });
}

function isValidScalar(fieldName, value) {
  const str = String(value).trim();
  if (!str) return false;
  switch (fieldName) {
    case 'telephone':
      // E.164 or common US formats; reject obvious placeholders
      return /[\d]/.test(str) && !/^(?:asdf|test|xxx|none|n\/a|tbd)/i.test(str) && (str.match(/\d/g) || []).length >= 7;
    case 'url':
    case 'image':
    case 'logo':
      try { new URL(str); return true; } catch { return false; }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
    case 'latitude':
    case 'longitude': {
      const n = Number(str);
      if (!Number.isFinite(n)) return false;
      if (fieldName === 'latitude') return n >= -90 && n <= 90;
      return n >= -180 && n <= 180;
    }
    case 'ratingValue': {
      const n = Number(str);
      return Number.isFinite(n) && n >= 0 && n <= 5;
    }
    case 'reviewCount': {
      const n = Number(str);
      return Number.isFinite(n) && n >= 0 && Number.isInteger(n);
    }
    case 'priceRange':
      return /^[$£€¥₹]{1,4}$/.test(str) || /^\d+\s*[-–]\s*\d+/.test(str);
    case 'datePublished':
    case 'dateModified':
    case 'startDate':
    case 'endDate':
    case 'foundingDate':
      return !isNaN(Date.parse(str));
    default:
      return true;
  }
}

/**
 * Validate a single schema node against required + recommended fields.
 * Returns { type, status, requiredMissing, recommendedMissing, depthScore, presentFields, fieldCount }.
 */
function validateNode(node) {
  const rawType = getPrimaryType(node);
  const canonicalType = normalizeType(rawType) || rawType;
  const lookupType = (typeof canonicalType === 'string') ? canonicalType : (canonicalType || ['Thing'])[0];
  const required = REQUIRED_BY_TYPE[lookupType] || [];
  const recommended = RECOMMENDED_BY_TYPE[lookupType] || [];

  const requiredMissing = required.filter(f => !fieldPresent(node, f));
  const recommendedMissing = recommended.filter(f => !fieldPresent(node, f));

  const allCovered = required.length + recommended.length;
  const allPresent = (required.length - requiredMissing.length) + (recommended.length - recommendedMissing.length);
  const depthScore = allCovered > 0 ? Math.round((allPresent / allCovered) * 100) : (lookupType ? 50 : 0);

  let status = 'pass';
  if (requiredMissing.length > 0) status = 'fail';
  else if (recommendedMissing.length / Math.max(1, recommended.length) > 0.6) status = 'warn';

  return {
    type: rawType,
    canonicalType: lookupType,
    status,
    requiredMissing,
    recommendedMissing,
    depthScore,
    presentFields: Object.keys(node).filter(k => k !== '@context' && k !== '@type'),
    fieldCount: Object.keys(node).length
  };
}

/**
 * Detect microdata (itemscope itemtype="...") presence and types.
 * Doesn't fully parse — just enumerates types found.
 */
function detectMicrodataTypes(html = '') {
  const types = new Set();
  const re = /itemtype=["']https?:\/\/schema\.org\/([A-Za-z]+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) types.add(m[1]);
  return Array.from(types);
}

/**
 * Detect RDFa schema typeof attributes.
 */
function detectRdfaTypes(html = '') {
  const types = new Set();
  const re = /typeof=["'](?:schema:)?([A-Za-z]+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) types.add(m[1]);
  return Array.from(types);
}

/**
 * Detect Open Graph + Twitter Card meta — schema-adjacent signals.
 */
function detectOpenGraph(html = '') {
  const og = {};
  const tw = {};
  const ogRe = /<meta[^>]+property=["']og:([\w:]+)["'][^>]+content=["']([^"']*)["']/gi;
  const twRe = /<meta[^>]+name=["']twitter:([\w:]+)["'][^>]+content=["']([^"']*)["']/gi;
  let m;
  while ((m = ogRe.exec(html)) !== null) og[m[1]] = m[2];
  while ((m = twRe.exec(html)) !== null) tw[m[1]] = m[2];
  return { og, twitter: tw, ogPresent: Object.keys(og).length > 0, twitterPresent: Object.keys(tw).length > 0 };
}

/**
 * Top-level analyzer. Extracts, flattens, validates every schema block.
 * Returns the consolidated schema audit for a page.
 */
function analyzeSchemas({ html, industry, businessFacts = {} }) {
  const blocks = extractJsonLdBlocks(html || '');
  const parseErrors = blocks.filter(b => b.parseError).map(b => b.parseError);
  const allNodes = blocks
    .filter(b => b.parsed)
    .flatMap(b => flattenSchemaNodes(b.parsed));

  const microdataTypes = detectMicrodataTypes(html || '');
  const rdfaTypes = detectRdfaTypes(html || '');
  const openGraph = detectOpenGraph(html || '');

  const validated = allNodes.map(validateNode);
  const presentTypes = new Set(validated.map(v => v.canonicalType).filter(Boolean));

  const verticalKey = pickVerticalKey(industry);
  const recommendedTypes = VERTICAL_SCHEMA_RECOMMENDATIONS[verticalKey] || VERTICAL_SCHEMA_RECOMMENDATIONS.default;
  const missingTypes = recommendedTypes.filter(t => !presentTypes.has(t) && !presentTypes.has(SCHEMA_TYPE_ALIASES[t]));

  const avgDepth = validated.length
    ? Math.round(validated.reduce((s, v) => s + v.depthScore, 0) / validated.length)
    : 0;

  const overallScore = computeOverallSchemaScore({
    blockCount: blocks.length,
    parseErrors: parseErrors.length,
    nodeCount: allNodes.length,
    avgDepth,
    requiredFailures: validated.filter(v => v.status === 'fail').length,
    presentTypes,
    recommendedTypes,
    missingTypes
  });

  const fixes = buildSchemaFixes({
    validated,
    missingTypes,
    parseErrors,
    industry,
    businessFacts
  });

  return {
    overallScore,
    status: overallScore >= 80 ? 'pass' : (overallScore >= 50 ? 'warn' : 'fail'),
    blockCount: blocks.length,
    parseErrors,
    nodes: validated,
    presentTypes: Array.from(presentTypes),
    recommendedTypes,
    missingTypes,
    avgDepthScore: avgDepth,
    microdataTypes,
    rdfaTypes,
    openGraph,
    fixes,
    evidence: blocks.slice(0, 6).map(b => ({ snippet: (b.raw || '').slice(0, 240), parsedOk: !b.parseError }))
  };
}

function computeOverallSchemaScore({ blockCount, parseErrors, nodeCount, avgDepth, requiredFailures, presentTypes, recommendedTypes, missingTypes }) {
  if (blockCount === 0) return 0;
  let score = 100;
  // No nodes at all — schema present but empty
  if (nodeCount === 0) return 10;
  // Parse errors are costly
  score -= Math.min(40, parseErrors * 20);
  // Required-field failures are costly
  score -= Math.min(30, requiredFailures * 10);
  // Missing recommended types for the vertical
  const recCount = recommendedTypes.length || 1;
  const missingRatio = missingTypes.length / recCount;
  score -= Math.round(missingRatio * 30);
  // Average depth nudges up to 20 points
  score = Math.round((score * 0.8) + (avgDepth * 0.2));
  return Math.max(0, Math.min(100, score));
}

function buildSchemaFixes({ validated, missingTypes, parseErrors, industry, businessFacts }) {
  const fixes = [];

  if (parseErrors.length) {
    fixes.push({
      key: 'schema-parse-error',
      severity: 'high',
      title: `${parseErrors.length} JSON-LD block${parseErrors.length > 1 ? 's' : ''} fail to parse`,
      detail: 'Invalid JSON in your structured-data scripts means search engines see no schema at all on this page. Validate every <script type="application/ld+json"> block with a JSON linter.',
      effortMinutes: 15,
      copyPasteReady: false,
      evidence: parseErrors.slice(0, 3).map(e => ({ snippet: String(e).slice(0, 200) }))
    });
  }

  validated.forEach((v) => {
    if (v.requiredMissing.length) {
      fixes.push({
        key: `schema-required-missing-${v.canonicalType}`,
        severity: 'high',
        title: `${v.canonicalType} is missing required field${v.requiredMissing.length > 1 ? 's' : ''}: ${v.requiredMissing.join(', ')}`,
        detail: `Schema.org requires these fields for ${v.canonicalType}. Without them search engines may discard the schema entirely.`,
        effortMinutes: 10,
        copyPasteReady: false
      });
    }
  });

  missingTypes.forEach((type) => {
    const generated = generateSchemaForType(type, industry, businessFacts);
    if (generated) {
      fixes.push({
        key: `schema-add-${type}`,
        severity: type === 'LocalBusiness' ? 'high' : 'medium',
        title: `Add ${type} schema`,
        detail: `Recommended schema type for the ${pickVerticalKey(industry)} vertical. Pre-filled JSON-LD ready to paste in <head>.`,
        effortMinutes: 5,
        copyPasteReady: true,
        generatedJsonLd: `<script type="application/ld+json">\n${JSON.stringify(generated, null, 2)}\n</script>`
      });
    }
  });

  return fixes;
}

/**
 * Build deterministic JSON-LD from extracted business facts.
 * No LLM — just merge real data into Schema.org type contracts.
 */
function generateSchemaForType(type, industry, facts = {}) {
  const f = facts || {};
  // FAQPage and BreadcrumbList have their own data sources (faqs / breadcrumbs).
  // WebSite needs a URL but not full business basics.
  const typesNotNeedingBusinessBasics = new Set(['BreadcrumbList', 'WebSite', 'FAQPage']);
  const hasBasics = f.businessName && (f.url || f.address || f.phone);
  if (!hasBasics && !typesNotNeedingBusinessBasics.has(type)) {
    return null;
  }
  switch (type) {
    case 'LocalBusiness': {
      const schema = {
        '@context': 'https://schema.org',
        '@type': SCHEMA_TYPE_ALIASES[industryTypeFor(industry)] ? industryTypeFor(industry) : 'LocalBusiness',
        name: f.businessName || 'Your Business',
        url: f.url
      };
      if (f.phone) schema.telephone = f.phone;
      if (f.email) schema.email = f.email;
      if (f.streetAddress || f.city || f.state || f.zip) {
        schema.address = {
          '@type': 'PostalAddress',
          streetAddress: f.streetAddress || undefined,
          addressLocality: f.city || undefined,
          addressRegion: f.state || undefined,
          postalCode: f.zip || undefined,
          addressCountry: 'US'
        };
      }
      if (Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lng))) {
        schema.geo = { '@type': 'GeoCoordinates', latitude: Number(f.lat), longitude: Number(f.lng) };
      }
      if (f.priceRange) schema.priceRange = f.priceRange;
      if (Array.isArray(f.areaServed) && f.areaServed.length) {
        schema.areaServed = f.areaServed.map(a => ({ '@type': 'City', name: a }));
      }
      if (Array.isArray(f.sameAs) && f.sameAs.length) schema.sameAs = f.sameAs;
      if (Array.isArray(f.openingHours) && f.openingHours.length) {
        schema.openingHoursSpecification = f.openingHours.map(h => ({
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: h.dayOfWeek,
          opens: h.opens,
          closes: h.closes
        }));
      }
      if (f.image) schema.image = f.image;
      if (f.logo) schema.logo = f.logo;
      if (f.description) schema.description = f.description;
      // Trim undefined leaves
      return pruneUndefined(schema);
    }
    case 'WebSite':
      return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: f.businessName || f.siteName || 'Your Business',
        url: f.url,
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: (f.url || '') + '?q={search_term_string}' },
          'query-input': 'required name=search_term_string'
        }
      };
    case 'BreadcrumbList':
      return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: f.url || '' }
        ]
      };
    case 'FAQPage': {
      // Refuse to generate junk. Real FAQ schema requires REAL Q&A content,
      // not Mad Libs. Either we have extracted FAQ blocks from the page or
      // mined from competitors, or we return null and the fix becomes
      // "extract these competitor FAQ topics and answer them in your voice."
      if (!Array.isArray(f.faqs) || !f.faqs.length) return null;
      const mainEntity = f.faqs.map(faq => ({
        '@type': 'Question',
        name: String(faq.question || '').trim(),
        acceptedAnswer: { '@type': 'Answer', text: String(faq.answer || '').trim() }
      })).filter(q => q.name && q.acceptedAnswer.text);
      if (!mainEntity.length) return null;
      return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity
      };
    }
    case 'Service':
      return {
        '@context': 'https://schema.org',
        '@type': 'Service',
        serviceType: industry || 'Local services',
        provider: {
          '@type': 'LocalBusiness',
          name: f.businessName || 'Your Business',
          url: f.url
        },
        areaServed: Array.isArray(f.areaServed) && f.areaServed.length
          ? f.areaServed.map(a => ({ '@type': 'City', name: a }))
          : (f.city ? [{ '@type': 'City', name: f.city }] : undefined)
      };
    case 'Organization':
      return pruneUndefined({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: f.businessName,
        url: f.url,
        logo: f.logo,
        sameAs: Array.isArray(f.sameAs) && f.sameAs.length ? f.sameAs : undefined
      });
    default:
      return null;
  }
}

function industryTypeFor(industry) {
  const ind = String(industry || '').toLowerCase();
  // Ordered: more specific keywords FIRST so "auto body" wins over "auto"
  const map = [
    // Home services
    ['plumber', 'Plumber'], ['plumbing', 'Plumber'],
    ['electrician', 'Electrician'], ['electrical', 'Electrician'],
    ['hvac', 'HVACBusiness'], ['heating', 'HVACBusiness'], ['cooling', 'HVACBusiness'], ['air conditioning', 'HVACBusiness'],
    ['roofing', 'RoofingContractor'], ['roofer', 'RoofingContractor'],
    ['general contractor', 'GeneralContractor'], ['contractor', 'GeneralContractor'], ['construction', 'GeneralContractor'], ['remodeling', 'GeneralContractor'], ['remodeler', 'GeneralContractor'],
    ['pest control', 'PestControlBusiness'], ['exterminator', 'PestControlBusiness'],
    ['painting', 'HousePainter'], ['painter', 'HousePainter'],
    ['locksmith', 'Locksmith'],
    ['moving company', 'MovingCompany'], ['movers', 'MovingCompany'],
    // Auto
    ['auto body', 'AutoBodyShop'],
    ['auto parts', 'AutoPartsStore'],
    ['auto repair', 'AutoRepair'], ['mechanic', 'AutoRepair'],
    ['gas station', 'GasStation'],
    ['car wash', 'AutoWash'],
    // Professional services
    ['attorney', 'Attorney'], ['lawyer', 'Attorney'], ['legal', 'LegalService'],
    ['accountant', 'AccountingService'], ['cpa', 'AccountingService'], ['bookkeeping', 'AccountingService'],
    ['real estate agent', 'RealEstateAgent'], ['realtor', 'RealEstateAgent'], ['real estate', 'RealEstateAgent'],
    ['insurance', 'InsuranceAgency'],
    ['financial', 'FinancialService'],
    // Medical
    ['dentist', 'Dentist'], ['dental', 'Dentist'],
    ['physician', 'Physician'], ['doctor', 'Physician'],
    ['chiropractor', 'Chiropractor'],
    ['optometrist', 'Optician'],
    ['veterinarian', 'VeterinaryCare'],
    ['pharmacy', 'Pharmacy'],
    // Food + hospitality
    ['restaurant', 'Restaurant'],
    ['bar', 'BarOrPub'], ['pub', 'BarOrPub'],
    ['cafe', 'CafeOrCoffeeShop'], ['coffee', 'CafeOrCoffeeShop'],
    ['bakery', 'Bakery'],
    ['hotel', 'Hotel'], ['lodging', 'Hotel'], ['inn ', 'Hotel'], ['motel', 'Motel'], ['resort', 'Resort'],
    ['bed and breakfast', 'BedAndBreakfast'],
    // Outdoor + recreation
    ['tree service', 'LocalBusiness'], ['arborist', 'LocalBusiness'],
    ['landscaping', 'LandscapingBusiness'], ['lawn', 'LandscapingBusiness'],
    ['fishing guide', 'TouristAttraction'], ['fishing', 'TouristAttraction'],
    ['hunting', 'TouristAttraction'],
    ['marina', 'TouristAttraction'],
    // Personal services
    ['salon', 'BeautySalon'], ['barber', 'BarberShop'], ['spa', 'DaySpa'], ['nail salon', 'NailSalon'],
    ['gym', 'ExerciseGym'], ['fitness', 'ExerciseGym'], ['yoga', 'ExerciseGym'],
    ['daycare', 'ChildCare'], ['child care', 'ChildCare'], ['preschool', 'Preschool'],
    ['cleaning', 'HomeAndConstructionBusiness'], ['janitorial', 'HomeAndConstructionBusiness'],
    ['dry cleaner', 'DryCleaningOrLaundry'], ['laundromat', 'DryCleaningOrLaundry'],
    // Retail
    ['grocery', 'GroceryStore'],
    ['hardware store', 'HardwareStore'],
    ['furniture store', 'FurnitureStore'],
    ['jewelry store', 'JewelryStore'],
    ['clothing store', 'ClothingStore'],
    ['shoe store', 'ShoeStore'],
    ['bike shop', 'BikeStore'],
    ['liquor store', 'LiquorStore'],
    // Garage door / specialty home
    ['garage door', 'HomeAndConstructionBusiness'],
    ['restoration', 'HomeAndConstructionBusiness'], ['water damage', 'HomeAndConstructionBusiness'], ['mold remediation', 'HomeAndConstructionBusiness'],
    // Towing / emergency
    ['towing', 'AutomotiveBusiness'], ['recovery', 'AutomotiveBusiness'],
    ['emergency service', 'EmergencyService'],
    // Entertainment
    ['theater', 'PerformingArtsTheater'], ['theatre', 'PerformingArtsTheater'],
    ['attraction', 'TouristAttraction'],
    ['museum', 'Museum']
  ];
  if (/\bvet\b/.test(ind) && !ind.includes('veteran')) return 'VeterinaryCare';
  for (const [k, v] of map) {
    if (ind.includes(k)) return v;
  }
  return 'LocalBusiness';
}

// FAQ defaults removed. Real FAQ schema requires real Q&A content from the
// page or mined from competitor FAQ blocks. Generic Mad Libs FAQs hurt the
// brand and pattern-match as AI-generated to both readers and AI engines.

function pruneUndefined(obj) {
  if (Array.isArray(obj)) return obj.map(pruneUndefined).filter(v => v !== undefined);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const cleaned = (v && typeof v === 'object') ? pruneUndefined(v) : v;
      if (cleaned === undefined) continue;
      if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) continue;
      out[k] = cleaned;
    }
    return out;
  }
  return obj;
}

module.exports = {
  analyzeSchemas,
  extractJsonLdBlocks,
  flattenSchemaNodes,
  validateNode,
  generateSchemaForType,
  industryTypeFor,
  pickVerticalKey,
  REQUIRED_BY_TYPE,
  RECOMMENDED_BY_TYPE,
  VERTICAL_SCHEMA_RECOMMENDATIONS
};
