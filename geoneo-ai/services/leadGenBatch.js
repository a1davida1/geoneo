const fs = require('fs/promises');
const path = require('path');
const { extractRootDomain } = require('./serpProvider');
const { ahrefsStatus } = require('./ahrefsClient');

const MAX_LEAD_GEN_QUANTITY = 250;
const DEFAULT_LEAD_GEN_QUANTITY = 100;

function leadGenPath() {
  return process.env.GEONEO_LEAD_GEN_PATH
    ? path.resolve(process.env.GEONEO_LEAD_GEN_PATH)
    : path.join(__dirname, '..', 'data', 'lead-gen-runs.json');
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeLeadGenQuantity(value, fallback = DEFAULT_LEAD_GEN_QUANTITY) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < 1) return 1;
  if (n > MAX_LEAD_GEN_QUANTITY) return MAX_LEAD_GEN_QUANTITY;
  return n;
}

function normalizeUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizeDomainToken(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    return extractRootDomain(normalizeUrl(raw));
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function candidateKey(candidate) {
  return normalizeDomainToken(candidate.domain || candidate.website || candidate.url || candidate.companyName || candidate.businessName);
}

// Domains that are aggregators / directories / social / publishers — never the
// "real" business site we want to audit. Match against root domain.
const AGGREGATOR_BLOCKLIST = [
  // generic local directories
  'yelp.com', 'tripadvisor.com', 'bbb.org', 'angi.com', 'angieslist.com', 'homeadvisor.com',
  'mapquest.com', 'thumbtack.com', 'nextdoor.com', 'foursquare.com',
  'yellowpages.com', 'superpages.com', 'citysearch.com', 'manta.com', 'dexknows.com',
  'whitepages.com', 'expertise.com', 'three-best-rated.com', 'threebestrated.com',
  'porch.com', 'houzz.com', 'buildzoom.com', 'bark.com',
  'modernize.com', 'networx.com', 'homeguide.com', 'sears.com',
  'contractorconnection.com', 'serviceseeking.com', 'taskrabbit.com',
  'handy.com', 'fivelistly.com', 'quora.com',
  // social / search
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'pinterest.com',
  'tiktok.com', 'youtube.com', 'linkedin.com', 'reddit.com', 'quora.com',
  'google.com', 'bing.com', 'duckduckgo.com',
  // category-specific verticals (listings, not the businesses themselves)
  'weddingwire.com', 'theknot.com', 'zola.com', 'eventbrite.com', 'ticketmaster.com',
  'opentable.com', 'resy.com', 'yelp.co.uk',
  'zillow.com', 'realtor.com', 'redfin.com', 'trulia.com', 'homes.com',
  'vrbo.com', 'airbnb.com', 'booking.com', 'hotels.com', 'expedia.com', 'kayak.com',
  'avvo.com', 'findlaw.com', 'justia.com', 'lawyers.com', 'martindale.com',
  'healthgrades.com', 'zocdoc.com', 'vitals.com', 'webmd.com',
  // wikipedia / news / publishing
  'wikipedia.org', 'wikimedia.org', 'medium.com', 'substack.com',
  'nytimes.com', 'washingtonpost.com', 'usatoday.com', 'cnn.com', 'foxnews.com',
  'npr.org', 'bbc.com', 'huffpost.com', 'forbes.com', 'inc.com', 'entrepreneur.com'
];

// Title patterns that mean "listicle / roundup article", not a real business site.
const LISTICLE_TITLE_PATTERNS = [
  /^\s*top\s+\d+\b/i,
  /^\s*best\s+\d+\b/i,
  /^\s*\d+\s+best\b/i,
  /^\s*the\s+\d+\s+(best|top)\b/i,
  /\b(best|top)\s+\d+\s+(of|in|for)\b/i,
  /\bbest\s+(of\s+)?(the\s+)?\d{4}\b/i, // "best of 2024"
  /\b(best|top)\s+[a-z\s]{3,40}\s+(in|near|of|for)\s+[A-Z][a-z]/i, // "best plumbers in Branson"
  /\broundup\b/i,
  /\bcompare\s+the\s+best\b/i,
  /\bawards?\s*\|?\s*\d{4}\b/i // "Awards | 2024"
];

// URL paths that signal an article, not a homepage.
const ARTICLE_PATH_PATTERNS = [
  /\/blog\//i,
  /\/article(s)?\//i,
  /\/news\//i,
  /\/press\//i,
  /\/\d{4}\/\d{2}\//, // /2024/05/
  /\/best-(of|the)\b/i,
  /\/top-\d+\b/i,
  /\/reviews?\//i,
  /\/category\//i,
  /\/tag\//i,
  /\/author\//i
];

function isBlockedAggregator(domain) {
  if (!domain) return false;
  return AGGREGATOR_BLOCKLIST.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
}

function looksLikeListicleTitle(title) {
  const t = normalizeString(title);
  if (!t) return false;
  return LISTICLE_TITLE_PATTERNS.some((rx) => rx.test(t));
}

function looksLikeArticlePath(urlOrWebsite) {
  const u = normalizeString(urlOrWebsite);
  if (!u) return false;
  let pathname = '';
  try { pathname = new URL(u.startsWith('http') ? u : `https://${u}`).pathname || '/'; }
  catch { return false; }
  if (pathname === '/' || pathname === '') return false;
  return ARTICLE_PATH_PATTERNS.some((rx) => rx.test(pathname));
}

/**
 * Reject before reaching the candidate list:
 *   - aggregators / directories / social / news publishers
 *   - listicle / roundup article titles
 *   - URLs that point at /blog/ /article/ /2024/05/ etc instead of a homepage
 *
 * Returns { ok, reason }. `ok=false` means do not include as a candidate.
 */
function classifyCandidateQuality(row) {
  const domain = normalizeDomainToken(row.domain || row.website || row.url);
  if (!domain) return { ok: false, reason: 'no_domain' };

  const resultType = normalizeString(row.resultType).toLowerCase();
  const category = normalizeString(row.category).toLowerCase();
  // Whitelist permissive — only reject EXPLICIT non-business types like
  // "article", "video", "pdf". Unknown/missing → allow and let other
  // signals (aggregator blocklist, listicle title, article path) decide.
  // 'unknown' = SerpAPI didn't classify it. Don't reject those — let other
  // signals (aggregator blocklist, listicle title, article path) decide.
  const ALLOWED_RESULT_TYPES = ['local_business', 'business', 'organic_business', 'website', 'organic', 'unknown', '', null, undefined];
  const ALLOWED_CATEGORIES = ['business', 'local', 'unknown', 'organic', '', null, undefined];
  if (resultType && !ALLOWED_RESULT_TYPES.includes(resultType)) {
    return { ok: false, reason: `result_type:${resultType}` };
  }
  if (category && !ALLOWED_CATEGORIES.includes(category)) {
    return { ok: false, reason: `category:${category}` };
  }

  if (isBlockedAggregator(domain)) {
    return { ok: false, reason: 'aggregator_or_directory' };
  }

  if (looksLikeListicleTitle(row.title || row.businessName || row.name)) {
    return { ok: false, reason: 'listicle_title' };
  }

  if (looksLikeArticlePath(row.url || row.website)) {
    return { ok: false, reason: 'article_path' };
  }

  // SLD-level hint: if the second-level label itself contains "best", "top10",
  // "reviews", treat as suspicious unless source already classified it as business.
  const sld = domain.split('.').slice(0, -1).join('.');
  if (/^(best|top\d|topten|reviews?|guide)/i.test(sld) && resultType !== 'local_business') {
    return { ok: false, reason: 'reviewish_sld' };
  }

  return { ok: true };
}

function isBusinessCandidate(row) {
  return classifyCandidateQuality(row).ok;
}

function rowToCandidate(row, opts = {}, source = 'market') {
  const domain = normalizeDomainToken(row.domain || row.website || row.url);
  const website = normalizeUrl(row.website || row.url || domain);
  return {
    id: domain,
    domain,
    website,
    businessName: normalizeString(row.businessName || row.companyName || row.name || row.title || domain),
    industry: normalizeString(opts.industry),
    city: normalizeString(opts.city),
    state: normalizeString(opts.state),
    zip: normalizeString(opts.zip),
    source,
    sourceRank: Number(row.rank || row.position || row.firstObservedRank || 0) || null,
    sourceQuery: normalizeString(row.query || row.primaryQuery),
    confidence: Number(row.confidence || row.sourceConfidence || 0) || null,
    resultType: normalizeString(row.resultType || row.category || 'business'),
    notes: normalizeString(row.inclusionReason || row.whyRank || row.notes)
  };
}

function extractLeadGenCandidates(marketModel, opts = {}) {
  const quantity = normalizeLeadGenQuantity(opts.quantity);
  const overview = marketModel?.industryAnalysis?.overview || {};
  const rows = [
    ...(Array.isArray(overview.orderedResults) ? overview.orderedResults : []),
    ...(Array.isArray(overview.rawVisibleResults) ? overview.rawVisibleResults : []),
    ...(Array.isArray(marketModel?.competitors) ? marketModel.competitors : [])
  ];
  const seen = new Set();
  const out = [];
  const rejectedByDomain = new Map(); // dedup: same domain across queries = one entry
  for (const row of rows) {
    if (!row) continue;
    const quality = classifyCandidateQuality(row);
    if (!quality.ok) {
      const dom = normalizeDomainToken(row.domain || row.website || row.url) || `_${rejectedByDomain.size}`;
      const existing = rejectedByDomain.get(dom);
      if (existing) {
        existing.appearances += 1;
      } else {
        rejectedByDomain.set(dom, {
          domain: dom,
          title: normalizeString(row.title || row.businessName || row.name),
          reason: quality.reason,
          appearances: 1
        });
      }
      continue;
    }
    const candidate = rowToCandidate(row, opts);
    candidate.title = normalizeString(row.title || candidate.businessName);
    const key = candidateKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= quantity) break;
  }
  // Tag the array with diagnostic info that the discovery endpoint can surface.
  Object.defineProperty(out, '_rejected', { value: Array.from(rejectedByDomain.values()).slice(0, 50), enumerable: false });
  return out;
}

/**
 * 7-bucket SEO owner classifier.
 *
 * Buckets (from "shoestring" to "white shoe"):
 *   diy_self          — owner built it themselves, no SEO tooling
 *   diy_with_help     — DIY platform but a Yoast/RankMath plugin is on
 *   local_marketer    — single freelancer / web designer footprint
 *   boutique_agency   — small agency (custom WP + GTM + 2-3 SEO tools)
 *   national_agency   — major SEO/marketing agency vendor footprint
 *   inhouse_team      — enterprise CMS + sophisticated markup
 *   unknown           — not enough signal
 *
 * Returns { classification, confidence, evidence[], scores{} } so the UI can
 * show *why* and the closer can read it back without inventing reasons.
 */
const NATIONAL_AGENCY_VENDORS = [
  { rx: /\bscorpion(\.co|inc|healthcare|cms)\b|cdn\.scorpion/i, label: 'Scorpion footprint detected' },
  { rx: /\bthryv\b/i, label: 'Thryv footprint detected' },
  { rx: /\bblue\s*corona\b/i, label: 'Blue Corona footprint detected' },
  { rx: /\brev[\s-]?local\b/i, label: 'RevLocal footprint detected' },
  { rx: /\bweb\s*fx\b/i, label: 'WebFX footprint detected' },
  { rx: /\bhibu\b/i, label: 'Hibu footprint detected' },
  { rx: /\brankings?\.io\b/i, label: 'Rankings.io footprint detected' },
  { rx: /\bsearchkings?\b/i, label: 'SearchKings footprint detected' },
  { rx: /\bnetsertive\b/i, label: 'Netsertive footprint detected' },
  { rx: /\bsurefire\s*local\b/i, label: 'Surefire Local footprint detected' },
  { rx: /\bbrightlocal\b/i, label: 'BrightLocal tooling detected' },
  { rx: /\bhennessey\s*digital\b/i, label: 'Hennessey Digital footprint detected' },
  { rx: /\bsmile\s*group\b/i, label: 'Smile Group footprint detected' },
  { rx: /\bjuris\s*page\b/i, label: 'JurisPage footprint detected' },
  { rx: /\b(podium|birdeye)\b/i, label: 'Podium / Birdeye review tooling' }
];

const BOUTIQUE_AGENCY_HINTS = [
  /website (?:by|design(?:ed)? by|powered by|built by) [a-z0-9 .,&'-]{3,40}/i,
  /(digital marketing|seo agency|web design agency|marketing agency) [a-z]{3,30}/i,
  /<a[^>]*href="https?:\/\/[^"]+(agency|marketing|media|design)[^"]*"[^>]*>/i
];

const PRO_TOOLING_HINTS = [
  { rx: /yoast (seo|premium)/i, label: 'Yoast SEO plugin' },
  { rx: /rank\s*math/i, label: 'RankMath SEO plugin' },
  { rx: /all in one seo/i, label: 'AIOSEO plugin' },
  { rx: /(gtm-[a-z0-9]+|googletagmanager\.com)/i, label: 'Google Tag Manager' },
  { rx: /(google-?analytics|gtag\(|datalayer|UA-\d{4,}-\d|G-[A-Z0-9]{6,})/i, label: 'Google Analytics' },
  { rx: /(facebook\.com\/tr|fbq\(['"]init['"])/i, label: 'Meta Pixel' },
  { rx: /(linkedin\.com\/insight|_linkedin_partner_id)/i, label: 'LinkedIn Insight Tag' },
  { rx: /hotjar\.com/i, label: 'Hotjar analytics' },
  { rx: /clarity\.ms/i, label: 'Microsoft Clarity' }
];

const DIY_PLATFORM_HINTS = [
  { rx: /wixsite\.com|wixstatic\.com|wix-\w+\.com/i, label: 'Wix site' },
  { rx: /godaddysites\.com|godaddy[\s-]*website[\s-]*builder/i, label: 'GoDaddy site builder' },
  { rx: /weebly\.com/i, label: 'Weebly' },
  { rx: /sites\.google\.com/i, label: 'Google Sites' },
  { rx: /yola\.(com|net)/i, label: 'Yola' },
  { rx: /jimdo(site|free)?\.com/i, label: 'Jimdo' },
  { rx: /strikingly\.com/i, label: 'Strikingly' }
];

const ENTERPRISE_CMS_HINTS = [
  { rx: /\bdrupal\b|\/sites\/default\/files\//i, label: 'Drupal' },
  { rx: /\badobe\s*experience\s*manager\b|aem\.live/i, label: 'Adobe Experience Manager' },
  { rx: /\bsitecore\b/i, label: 'Sitecore' },
  { rx: /\bcontentful\b/i, label: 'Contentful headless CMS' },
  { rx: /\bcontentstack\b/i, label: 'Contentstack' },
  { rx: /\bsanity(\.io)?\b/i, label: 'Sanity headless CMS' },
  { rx: /\bnext\.js\b|__NEXT_DATA__/i, label: 'Next.js application' },
  { rx: /\bgatsby\.js\b|___gatsby/i, label: 'Gatsby site' }
];

const COMMON_CMS_HINTS = [
  { rx: /\/wp-(content|includes)\//i, label: 'WordPress' },
  { rx: /elementor/i, label: 'Elementor builder' },
  { rx: /\bdivi(-builder)?\b/i, label: 'Divi theme/builder' },
  { rx: /squarespace\.com|static\.squarespace\.com/i, label: 'Squarespace' },
  { rx: /webflow\.com|wf-domain/i, label: 'Webflow' },
  { rx: /shopify\.com|cdn\.shopify\.com/i, label: 'Shopify' },
  { rx: /duda\b|dudamobile/i, label: 'Duda' }
];

function assessSeoProvider(input = {}) {
  const htmlLower = normalizeString(input.html).toLowerCase();
  const textLower = normalizeString(input.visibleText || input.auditText).toLowerCase();
  const title = normalizeString(input.pageTitle || input.title).toLowerCase();
  const audit = input.auditResult || {};
  const seoSignals = audit?.siteProfile?.seoSignals || {};
  const googleSeo = Number(audit?.googleGrades?.seo);

  function onPage(pattern) {
    return (
      (htmlLower && pattern.test(htmlLower)) ||
      (textLower && pattern.test(textLower)) ||
      (title && pattern.test(title))
    );
  }

  const evidence = {
    national: [],
    boutique: [],
    diy: [],
    pro: [],
    enterprise: [],
    cms: []
  };

  for (const v of NATIONAL_AGENCY_VENDORS) if (onPage(v.rx)) evidence.national.push(v.label);
  for (const v of DIY_PLATFORM_HINTS) if (onPage(v.rx)) evidence.diy.push(v.label);
  for (const v of ENTERPRISE_CMS_HINTS) if (onPage(v.rx)) evidence.enterprise.push(v.label);
  for (const v of PRO_TOOLING_HINTS) if (onPage(v.rx)) evidence.pro.push(v.label);
  for (const v of COMMON_CMS_HINTS) if (onPage(v.rx)) evidence.cms.push(v.label);
  for (const rx of BOUTIQUE_AGENCY_HINTS) {
    const m = htmlLower && htmlLower.match(rx);
    if (m && m[0]) evidence.boutique.push(`Footer/credit line: "${m[0].slice(0, 90)}"`);
  }

  if (Number(seoSignals.schemaCount || 0) >= 2) evidence.pro.push(`${seoSignals.schemaCount} JSON-LD schema blocks present`);
  if (seoSignals.canonical && seoSignals.sitemap && seoSignals.robotsMeta) evidence.pro.push('Canonical + sitemap + robots meta all present');
  if (Number.isFinite(googleSeo) && googleSeo >= 85) evidence.pro.push(`Strong technical SEO grade (${googleSeo}/100)`);
  if (Number.isFinite(googleSeo) && googleSeo < 50 && Number(seoSignals.schemaCount || 0) === 0) evidence.diy.push(`Weak SEO grade (${googleSeo}/100) with no schema`);

  // No data at all
  if (!htmlLower && !textLower && !title) {
    return {
      classification: 'unknown',
      label: 'Unknown',
      confidence: 'low',
      evidence: ['No page HTML/title available for attribution'],
      scores: {}
    };
  }

  const proCount = evidence.pro.length;
  const cmsCount = evidence.cms.length;
  const diyCount = evidence.diy.length;
  const boutiqueCount = evidence.boutique.length;
  const nationalCount = evidence.national.length;
  const enterpriseCount = evidence.enterprise.length;

  // National agency: explicit vendor footprint wins immediately.
  if (nationalCount > 0) {
    return {
      classification: 'national_agency',
      label: 'National agency',
      confidence: 'high',
      evidence: evidence.national.slice(0, 4),
      scores: { national: nationalCount, boutique: boutiqueCount, pro: proCount, diy: diyCount }
    };
  }

  // Enterprise team: AEM/Sitecore/Drupal/Next.js + at least 1 pro signal.
  if (enterpriseCount > 0 && proCount >= 1) {
    return {
      classification: 'inhouse_team',
      label: 'In-house team',
      confidence: enterpriseCount >= 2 || proCount >= 3 ? 'high' : 'medium',
      evidence: [...evidence.enterprise, ...evidence.pro].slice(0, 4),
      scores: { enterprise: enterpriseCount, pro: proCount }
    };
  }

  // Boutique agency: explicit footer credit beats heuristics.
  if (boutiqueCount > 0 && proCount >= 1) {
    return {
      classification: 'boutique_agency',
      label: 'Boutique agency',
      confidence: 'high',
      evidence: [...evidence.boutique, ...evidence.pro].slice(0, 4),
      scores: { boutique: boutiqueCount, pro: proCount }
    };
  }

  // DIY platform with help (Wix + Yoast, etc.) or strong pro tooling without diy markers.
  if (diyCount > 0 && proCount >= 1) {
    return {
      classification: 'diy_with_help',
      label: 'DIY with help',
      confidence: 'medium',
      evidence: [...evidence.diy, ...evidence.pro].slice(0, 4),
      scores: { diy: diyCount, pro: proCount }
    };
  }

  // Pure DIY platform.
  if (diyCount > 0) {
    return {
      classification: 'diy_self',
      label: 'DIY (owner-built)',
      confidence: 'high',
      evidence: evidence.diy.slice(0, 4),
      scores: { diy: diyCount }
    };
  }

  // Local marketer / freelancer: WordPress with 2+ pro tools, no agency credit.
  if (cmsCount > 0 && proCount >= 2) {
    return {
      classification: 'local_marketer',
      label: 'Local marketer / freelancer',
      confidence: proCount >= 3 ? 'medium' : 'low',
      evidence: [...evidence.cms, ...evidence.pro].slice(0, 4),
      scores: { cms: cmsCount, pro: proCount }
    };
  }

  // CMS only or pro tooling only — partial signal.
  if (proCount >= 2 || cmsCount >= 1) {
    return {
      classification: 'local_marketer',
      label: 'Local marketer / freelancer',
      confidence: 'low',
      evidence: [...evidence.cms, ...evidence.pro].slice(0, 4),
      scores: { cms: cmsCount, pro: proCount }
    };
  }

  // Some pro signal but no CMS — could be DIY with one plugin.
  if (proCount === 1) {
    return {
      classification: 'diy_with_help',
      label: 'DIY with help',
      confidence: 'low',
      evidence: evidence.pro.slice(0, 4),
      scores: { pro: proCount }
    };
  }

  // Boutique credit alone (footer says "website by X agency") with no other tooling
  // is still a useful signal — call it local_marketer at low confidence.
  if (boutiqueCount > 0) {
    return {
      classification: 'local_marketer',
      label: 'Local marketer / freelancer',
      confidence: 'low',
      evidence: evidence.boutique.slice(0, 4),
      scores: { boutique: boutiqueCount }
    };
  }

  return {
    classification: 'unknown',
    label: 'Unknown',
    confidence: 'low',
    evidence: ['No clear CMS, agency, or SEO tooling footprint detected'],
    scores: {}
  };
}

function uniqueMatches(text, regex, limit = 5) {
  const seen = new Set();
  const out = [];
  let match = regex.exec(text);
  while (match && out.length < limit) {
    const value = normalizeString(match[0]);
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push(value);
    }
    match = regex.exec(text);
  }
  return out;
}

/**
 * Reverse common email obfuscations so the regex below can catch them:
 *   "name [at] domain.com"      → "name@domain.com"
 *   "name (at) domain (dot) com" → "name@domain.com"
 *   "name AT domain DOT com"     → "name@domain.com"
 *   "name @ domain . com"        → "name@domain.com"
 */
function deobfuscateEmails(input) {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/\s*[\[\(\{]\s*at\s*[\]\)\}]\s*/gi, '@');
  s = s.replace(/\s+at\s+(?=[a-z0-9.-]+\.[a-z]{2,})/gi, '@');
  s = s.replace(/\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*/gi, '.');
  s = s.replace(/\s+dot\s+(?=[a-z]{2,})/gi, '.');
  s = s.replace(/\s+@\s+/g, '@');
  return s;
}

/**
 * Pull emails + phones out of one HTML payload.
 * Handles tel:/mailto: hrefs, visible-text matches, JSON-LD telephone fields,
 * and "name [at] domain dot com" obfuscation.
 */
function extractContactsFromHtml(html) {
  const raw = String(html || '');
  if (!raw) return { phones: [], emails: [], hasAddress: false };

  const textForEmails = deobfuscateEmails(raw);

  const mailtoRe = /href=["']mailto:([^"'?]+)/gi;
  const telRe = /href=["']tel:([^"']+)/gi;
  const phoneTextRe = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g;
  const emailTextRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

  const phoneSet = new Set();
  const emailSet = new Set();

  let m;
  while ((m = mailtoRe.exec(raw)) !== null) {
    if (m[1]) emailSet.add(m[1].trim().toLowerCase());
  }
  while ((m = telRe.exec(raw)) !== null) {
    if (m[1]) phoneSet.add(m[1].replace(/[^\d+]/g, ''));
  }
  for (const match of textForEmails.match(emailTextRe) || []) {
    emailSet.add(match.trim().toLowerCase());
  }
  for (const match of raw.match(phoneTextRe) || []) {
    const cleaned = match.replace(/[^\d+]/g, '');
    if (cleaned.replace(/\D/g, '').length >= 10) phoneSet.add(cleaned);
  }

  // Filter out obvious junk emails (pixel tracking, image filenames, etc.)
  const isUsableEmail = (e) => {
    if (!/@/.test(e)) return false;
    if (/\.(png|jpg|jpeg|gif|svg|webp|ico)$/i.test(e)) return false;
    if (/(sentry|wixpress|squarespace-cdn|cloudfront|gstatic|googleusercontent)/i.test(e)) return false;
    if (/^(no-?reply|donotreply|postmaster|webmaster|abuse|hostmaster)@/i.test(e)) return false;
    return true;
  };

  return {
    phones: Array.from(phoneSet).slice(0, 6),
    emails: Array.from(emailSet).filter(isUsableEmail).slice(0, 6),
    hasAddress: /\b\d{1,6}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(St|Ave|Rd|Blvd|Dr|Ln|Way|Ct|Pl|Hwy)\b/.test(raw)
  };
}

function extractContactInfo(input = {}) {
  const text = normalizeString(input.text || input.html || input.visibleText);
  const signals = input?.auditResult?.siteProfile?.contactSignals || {};
  // Use the new HTML extractor when we have HTML; fall back to plain-text regex otherwise.
  let phones = [];
  let emails = [];
  if (input.html || /<[a-z][^>]*>/i.test(text)) {
    const c = extractContactsFromHtml(input.html || text);
    phones = c.phones;
    emails = c.emails;
  } else if (text) {
    const detext = deobfuscateEmails(text);
    phones = uniqueMatches(text, /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g, 5);
    emails = uniqueMatches(detext, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 5);
  }
  const hasPhone = Boolean(signals.phone || phones.length);
  const hasEmail = Boolean(signals.email || emails.length);
  const hasAddress = Boolean(signals.address);
  const hasStrongCta = Boolean(signals.strongCta);
  const score = Math.min(100,
    (hasPhone ? 35 : 0) +
    (hasEmail ? 35 : 0) +
    (hasAddress ? 15 : 0) +
    (hasStrongCta ? 15 : 0)
  );
  const bestChannel = hasEmail ? 'email' : (hasPhone ? 'phone' : 'research_needed');
  return {
    score,
    hasPhone,
    hasEmail,
    hasAddress,
    hasStrongCta,
    phones,
    emails,
    bestChannel
  };
}

/**
 * Merge multiple raw contact lookups into a single dedup'd result.
 * Used when discovery fetches /, /contact, and /about for one candidate.
 */
function mergeContacts(...lookups) {
  const phones = new Set();
  const emails = new Set();
  let hasAddress = false;
  for (const lookup of lookups) {
    if (!lookup) continue;
    (lookup.phones || []).forEach((p) => phones.add(p));
    (lookup.emails || []).forEach((e) => emails.add(e.toLowerCase()));
    if (lookup.hasAddress) hasAddress = true;
  }
  const phoneList = Array.from(phones).slice(0, 6);
  const emailList = Array.from(emails).slice(0, 6);
  const hasPhone = phoneList.length > 0;
  const hasEmail = emailList.length > 0;
  const score = Math.min(100,
    (hasPhone ? 35 : 0) +
    (hasEmail ? 35 : 0) +
    (hasAddress ? 15 : 0) +
    (hasPhone || hasEmail ? 15 : 0)
  );
  return {
    score,
    hasPhone,
    hasEmail,
    hasAddress,
    hasStrongCta: hasPhone || hasEmail,
    phones: phoneList,
    emails: emailList,
    bestChannel: hasEmail ? 'email' : (hasPhone ? 'phone' : 'research_needed')
  };
}

function scoreLeadOpportunity({ candidate = {}, scores = {}, contactInfo = {}, seoProvider = {} } = {}) {
  const overall = Number(scores.overall ?? scores.visibilityScore ?? 0) || 0;
  const seo = Number(scores.seo || 0) || 0;
  const ai = Number(scores.ai || scores.aiVisibility || 0) || 0;
  const geo = Number(scores.geo || scores.localPresence || 0) || 0;
  const reasons = [];
  let score = 0;

  if (overall && overall < 50) {
    score += 34;
    reasons.push(`Weak audit score (${overall}/100).`);
  } else if (overall && overall < 70) {
    score += 22;
    reasons.push(`Mid audit score (${overall}/100) with room to improve.`);
  } else if (overall) {
    score += 6;
    reasons.push(`Strong site (${overall}/100), harder sell.`);
  } else {
    score += 12;
    reasons.push('Audit score unavailable; review manually.');
  }

  const weakPillars = [
    seo && seo < 60 ? `SEO ${seo}` : '',
    ai && ai < 60 ? `AI ${ai}` : '',
    geo && geo < 60 ? `GEO ${geo}` : ''
  ].filter(Boolean);
  if (weakPillars.length) {
    score += Math.min(20, weakPillars.length * 8);
    reasons.push(`Weak pillars: ${weakPillars.join(', ')}.`);
  }

  const rank = Number(candidate.sourceRank || 0);
  if (rank > 0 && rank <= 5) {
    score += 12;
    reasons.push(`Already visible at rank ${rank}, easier to sell improvement.`);
  } else if (rank > 10) {
    score += 5;
    reasons.push(`Lower visibility at rank ${rank}.`);
  }

  const contactScore = Number(contactInfo.score || 0);
  if (contactScore >= 70) {
    score += 16;
    reasons.push('Contact path is ready.');
  } else if (contactScore >= 35) {
    score += 8;
    reasons.push('Partial contact path found.');
  } else {
    reasons.push('Contact info needs research.');
  }

  // Owner-type bias: easier sales when there's no agency contract in the way.
  const ownerType = seoProvider.classification || 'unknown';
  if (ownerType === 'diy_self' || ownerType === 'unknown') {
    score += 16;
    reasons.push('No strong agency footprint detected — owner likely controls the site.');
  } else if (ownerType === 'diy_with_help') {
    score += 12;
    reasons.push('DIY site with light help — owner can authorize changes quickly.');
  } else if (ownerType === 'local_marketer') {
    score += 6;
    reasons.push('Local freelancer footprint — owner often pays per-project, easy to displace.');
  } else if (ownerType === 'boutique_agency') {
    score -= 4;
    reasons.push('Boutique agency footprint — contract likely, target the gaps they aren\u2019t covering.');
  } else if (ownerType === 'national_agency') {
    score -= 14;
    reasons.push('National agency vendor footprint — tougher replacement sale, focus on AI-search gap.');
  } else if (ownerType === 'inhouse_team') {
    score -= 10;
    reasons.push('In-house team / enterprise CMS — pitch as a vendor for the AI/GEO layer they don\u2019t cover.');
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tier = clamped >= 72 ? 'hot' : (clamped >= 48 ? 'warm' : 'cold');
  return { score: clamped, tier, reasons: reasons.slice(0, 6) };
}

function buildOutreachPlan({ candidate = {}, scores = {}, leadScore = {}, seoProvider = {}, contactInfo = {} } = {}) {
  const business = normalizeString(candidate.businessName || candidate.domain || 'your business');
  const industry = normalizeString(candidate.industry || 'your market');
  const location = [candidate.city, candidate.state].filter(Boolean).join(', ') || 'your area';
  const overall = Number(scores.overall || 0) || 'unknown';
  const seoLabel = seoProvider.classification
    ? seoProvider.classification.replace(/_/g, ' ')
    : 'unknown';
  const emailSubject = `${business}: quick ${location} visibility audit note`;
  const emailOpening = `I ran a GeoNeo scan for ${business} in ${location}. Your visibility score came back ${overall}/100, and the strongest sales angle is: ${(leadScore.reasons || [])[0] || 'there are visible search gaps competitors can exploit.'}`;
  const offer = `I can send the exact fixes that would help a ${industry} business show up better in Google, Maps, and AI answers.`;
  const callReadiness = contactInfo.hasPhone
    ? 'ready_for_ai_call'
    : (contactInfo.hasEmail ? 'email_first' : 'research_needed');
  const nextBestAction = callReadiness === 'ready_for_ai_call'
    ? 'Email first, then route replies to AI appointment-setting call.'
    : (callReadiness === 'email_first' ? 'Send email and request best phone number for scheduling.' : 'Research contact info before outreach.');
  return {
    emailSubject,
    emailOpening,
    offer,
    callReadiness,
    nextBestAction,
    seoAngle: `SEO footprint appears: ${seoLabel}.`
  };
}

const ALL_PARTY_RECORDING_STATES = new Set(['CA', 'CT', 'DE', 'FL', 'IL', 'MD', 'MA', 'MT', 'NV', 'NH', 'PA', 'WA']);
const EXTRA_AI_DISCLOSURE_STATES = new Set(['CA', 'CO', 'CT', 'IL', 'MD', 'MA', 'NY', 'PA', 'TX', 'UT', 'WA']);

function getAiCallComplianceForState(stateInput) {
  const state = normalizeString(stateInput).toUpperCase();
  const recordingConsent = ALL_PARTY_RECORDING_STATES.has(state) ? 'all_party' : 'one_party';
  const needsAiDisclosure = EXTRA_AI_DISCLOSURE_STATES.has(state);
  const aiCallRisk = recordingConsent === 'all_party' || needsAiDisclosure ? 'high' : 'medium';
  const requirements = [
    'TCPA: do not use artificial/prerecorded voice or autodialed marketing calls without proper prior express consent.',
    'Honor federal and state Do Not Call rules and internal suppression lists.',
    'Email reply or explicit opt-in should be captured before routing a prospect to AI appointment-setting calls.',
    recordingConsent === 'all_party'
      ? 'Call recording/transcription: all-party consent state. Disclose recording/transcription and get consent before proceeding.'
      : 'Call recording/transcription: one-party consent state, but disclosure is still recommended for AI-assisted calls.',
    needsAiDisclosure
      ? 'AI disclosure recommended/required risk flag: clearly disclose that an automated/AI assistant may participate.'
      : 'AI disclosure still recommended even where state-specific AI-call law is unclear.'
  ];
  return {
    state: state || 'UNKNOWN',
    recordingConsent,
    needsAiDisclosure,
    aiCallRisk,
    requirements,
    disclaimer: 'Operational guidance only, not legal advice. Confirm campaign rules with counsel before live dialing.'
  };
}

/** All USPS state codes + DC for admin Prospect Hunter dropdowns. */
const US_STATES_AND_DC = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['DC', 'District of Columbia'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming']
];

/**
 * Prospect Hunter UI: per-state tiering for modeled AI-assisted sales-call friction
 * (mirrors aiCallRisk — not a claim that outreach is "legal" without TCPA consent).
 * favorable = aiCallRisk medium; caution = high (all-party recording and/or AI-disclosure flag set).
 */
function listUsStatesForLeadGenUi() {
  return US_STATES_AND_DC.map(([code, name]) => {
    const compliance = getAiCallComplianceForState(code);
    const workflowTier = compliance.aiCallRisk === 'high' ? 'caution' : 'favorable';
    return {
      code,
      name,
      workflowTier,
      aiCallRisk: compliance.aiCallRisk,
      recordingConsent: compliance.recordingConsent,
      needsAiDisclosure: compliance.needsAiDisclosure,
      uiHint:
        workflowTier === 'favorable'
          ? 'Modeled lower state friction (one-party recording; no extra GeoNeo AI-disclosure flag). Federal TCPA/consent and DNC rules still apply.'
          : 'Modeled higher friction (all-party recording and/or extra AI-disclosure flag). Plan recording/transcript consent and counsel review.'
    };
  }).sort((a, b) => {
    if (a.workflowTier !== b.workflowTier) return a.workflowTier === 'favorable' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const INDUSTRY_VALUE = {
  attorney: 180,
  lawyer: 180,
  roofing: 120,
  dentist: 95,
  hvac: 90,
  plumber: 80,
  plumbing: 80,
  electrician: 75,
  restoration: 140,
  hotel: 55,
  restaurant: 35,
  towing: 65,
  default: 60
};

function estimateOpportunityValue(industry, leadScore = {}) {
  const key = normalizeString(industry).toLowerCase();
  const base = INDUSTRY_VALUE[key] || INDUSTRY_VALUE.default;
  const multiplier = leadScore.tier === 'hot' ? 18 : (leadScore.tier === 'warm' ? 10 : 5);
  const mid = Math.round(base * multiplier);
  return {
    low: Math.round(mid * 0.55),
    high: Math.round(mid * 1.45),
    basis: `Estimated from ${key || 'default'} value proxy and ${leadScore.tier || 'unscored'} lead tier.`
  };
}

function getAhrefsIntegrationStatus(env = process.env) {
  return ahrefsStatus(env);
}

/**
 * Estimate monthly SEO budget based on signals:
 * - Domain Rating (authority investment)
 * - Organic keyword count (SEO program scale)
 * - Paid keyword count (PPC + SEO correlation)
 * - Backlink profile (link building investment)
 * - Referring domains (outreach effort)
 */
function estimateSeoBudget(ahrefs = {}, seoProvider = {}, audit = {}) {
  const dr = Number(ahrefs.domainRating) || 0;
  const organicKws = Number(ahrefs.organicKeywords) || 0;
  const paidKws = Number(ahrefs.paidKeywords) || 0;
  const refDomains = Number(ahrefs.refdomains) || 0;
  const backlinks = Number(ahrefs.backlinks) || 0;
  const traffic = Number(ahrefs.organicTraffic) || 0;
  
  // Base indicators of SEO investment
  let signals = [];
  let score = 0;
  
  // Domain Rating tiers (suggests historical link building)
  if (dr >= 70) { score += 40; signals.push('High DR (70+) indicates significant authority building'); }
  else if (dr >= 50) { score += 25; signals.push('Medium-High DR (50-69) suggests consistent SEO'); }
  else if (dr >= 30) { score += 15; signals.push('Moderate DR (30-49) shows some link effort'); }
  else if (dr > 0) { score += 5; signals.push('Low DR indicates minimal authority work'); }
  
  // Organic keyword portfolio size
  if (organicKws >= 1000) { score += 35; signals.push('Large organic portfolio (1000+ keywords)'); }
  else if (organicKws >= 500) { score += 25; signals.push('Medium organic portfolio (500-999 keywords)'); }
  else if (organicKws >= 100) { score += 15; signals.push('Small organic portfolio (100-499 keywords)'); }
  else if (organicKws > 0) { score += 5; signals.push('Minimal organic presence (<100 keywords)'); }
  
  // Paid keywords correlation (businesses running PPC often invest in SEO)
  if (paidKws >= 50) { score += 20; signals.push('Active paid search program (50+ keywords)'); }
  else if (paidKws >= 20) { score += 12; signals.push('Moderate PPC presence (20-49 keywords)'); }
  else if (paidKws > 0) { score += 5; signals.push('Small PPC presence (<20 keywords)'); }
  
  // Referring domains (active link building)
  if (refDomains >= 500) { score += 25; signals.push('Strong backlink profile (500+ domains)'); }
  else if (refDomains >= 100) { score += 15; signals.push('Good backlink profile (100-499 domains)'); }
  else if (refDomains >= 50) { score += 8; signals.push('Growing backlink profile (50-99 domains)'); }
  else if (refDomains > 0) { score += 3; signals.push('Basic backlink profile (<50 domains)'); }
  
  // Content/technical signals from audit
  const seoGrade = Number(audit?.googleGrades?.seo) || 0;
  const schemaCount = Number(audit?.siteProfile?.seoSignals?.schemaCount) || 0;
  const hasCanonical = Boolean(audit?.siteProfile?.seoSignals?.canonical);
  const hasSitemap = Boolean(audit?.siteProfile?.seoSignals?.sitemap);
  
  if (seoGrade >= 80) { score += 15; signals.push('Strong technical SEO foundation'); }
  else if (seoGrade >= 60) { score += 8; signals.push('Decent technical SEO'); }
  
  if (schemaCount > 0) { score += 5; signals.push('Structured data implementation'); }
  if (hasCanonical && hasSitemap) { score += 5; signals.push('Technical SEO basics in place'); }
  
  // Provider classification adjustment — uses 7-bucket owner type.
  const providerTier = seoProvider.classification || 'unknown';
  if (providerTier === 'national_agency') { score += 25; signals.push('National agency vendor footprint (managed program, $5k+/mo typical)'); }
  else if (providerTier === 'inhouse_team') { score += 22; signals.push('In-house team / enterprise CMS (large internal budget)'); }
  else if (providerTier === 'boutique_agency') { score += 15; signals.push('Boutique agency footprint (managed program, $1.5-5k/mo typical)'); }
  else if (providerTier === 'local_marketer') { score += 8; signals.push('Local freelancer footprint (project-based or $300-1500/mo)'); }
  else if (providerTier === 'diy_with_help') { score += 4; signals.push('DIY platform with one SEO plugin (minimal active management)'); }
  else if (providerTier === 'diy_self') { score += 1; signals.push('Pure DIY site (no professional investment)'); }
  
  // Calculate estimated budget range
  // Score 0-20: $0-500 (minimal/no SEO)
  // Score 21-50: $500-2000 (basic DIY or low-end agency)
  // Score 51-80: $2000-5000 (professional program)
  // Score 81-120: $5000-10000 (aggressive program)
  // Score 120+: $10000+ (enterprise level)
  
  let estimatedMonthlyLow, estimatedMonthlyHigh, confidence;
  
  if (score >= 120) {
    estimatedMonthlyLow = 10000; estimatedMonthlyHigh = 25000; confidence = 'high';
  } else if (score >= 80) {
    estimatedMonthlyLow = 5000; estimatedMonthlyHigh = 10000; confidence = 'high';
  } else if (score >= 50) {
    estimatedMonthlyLow = 2000; estimatedMonthlyHigh = 5000; confidence = 'medium';
  } else if (score >= 20) {
    estimatedMonthlyLow = 500; estimatedMonthlyHigh = 2000; confidence = 'medium';
  } else {
    estimatedMonthlyLow = 0; estimatedMonthlyHigh = 500; confidence = 'low';
  }
  
  // Override if we have strong contradictory signals
  if (dr === 0 && organicKws === 0 && providerTier === 'unknown') {
    estimatedMonthlyLow = 0; estimatedMonthlyHigh = 0; confidence = 'none';
    signals.push('No measurable SEO signals detected');
  }
  
  return {
    estimatedMonthlyLow,
    estimatedMonthlyHigh,
    confidence,
    score,
    signals: signals.slice(0, 6),
    hasActiveProgram: estimatedMonthlyLow >= 500,
    isMeasurable: dr > 0 || organicKws > 0 || refDomains > 0
  };
}

/**
 * Predict SEO quality/maturity based on measurable signals
 * Returns a quality score and classification
 */
function predictSeoQuality(ahrefs = {}, audit = {}, seoProvider = {}) {
  const dr = Number(ahrefs.domainRating) || 0;
  const organicKws = Number(ahrefs.organicKeywords) || 0;
  const paidKws = Number(ahrefs.paidKeywords) || 0;
  const refDomains = Number(ahrefs.refdomains) || 0;
  const traffic = Number(ahrefs.organicTraffic) || 0;
  const seoGrade = Number(audit?.googleGrades?.seo) || 0;
  
  // Quality dimensions
  const authorityScore = Math.min(100, dr * 1.5); // DR 0-100 scaled
  const visibilityScore = Math.min(100, organicKws / 10); // 1000 keywords = 100 score
  const technicalScore = seoGrade || (audit?.siteProfile?.seoSignals?.canonical ? 60 : 30);
  const backlinkScore = Math.min(100, refDomains / 5); // 500 domains = 100 score
  
  // Overall quality score (weighted)
  const overallQuality = Math.round(
    (authorityScore * 0.25) +
    (visibilityScore * 0.30) +
    (technicalScore * 0.20) +
    (backlinkScore * 0.25)
  );
  
  // Classification
  let classification, description;
  if (overallQuality >= 75) {
    classification = 'sophisticated';
    description = 'Mature SEO program with strong authority and visibility';
  } else if (overallQuality >= 55) {
    classification = 'competent';
    description = 'Active SEO program with decent fundamentals';
  } else if (overallQuality >= 35) {
    classification = 'basic';
    description = 'Basic SEO presence, room for significant improvement';
  } else if (overallQuality >= 15) {
    classification = 'minimal';
    description = 'Minimal SEO effort detected';
  } else {
    classification = 'none';
    description = 'No measurable SEO program';
  }
  
  // Is the SEO measurable/trackable?
  const isMeasurable = dr > 0 || organicKws > 0 || traffic > 0;
  const managedClassifications = new Set(['national_agency', 'boutique_agency', 'inhouse_team', 'local_marketer']);
  const isActivelyManaged = managedClassifications.has(seoProvider.classification) || organicKws > 200;
  const hasRoomForImprovement = overallQuality < 70;
  
  return {
    overallQuality,
    classification,
    description,
    isMeasurable,
    isActivelyManaged,
    hasRoomForImprovement,
    dimensions: {
      authority: Math.round(authorityScore),
      visibility: Math.round(visibilityScore),
      technical: Math.round(technicalScore),
      backlinks: Math.round(backlinkScore)
    },
    metrics: {
      domainRating: dr,
      organicKeywords: organicKws,
      paidKeywords: paidKws,
      referringDomains: refDomains,
      organicTraffic: traffic
    }
  };
}

function buildAdvancedLeadInsights({ candidate = {}, scores = {}, leadScore = {}, contactInfo = {}, seoProvider = {}, ahrefs = {} } = {}) {
  const aiCallCompliance = getAiCallComplianceForState(candidate.state);
  const estimatedOpportunity = estimateOpportunityValue(candidate.industry, leadScore);
  const estimatedSeoBudget = estimateSeoBudget(ahrefs, seoProvider, { googleGrades: scores, siteProfile: candidate.siteProfile });
  const seoQuality = predictSeoQuality(ahrefs, { googleGrades: scores, siteProfile: candidate.siteProfile }, seoProvider);
  const canEmail = Boolean(contactInfo.hasEmail);
  const canCall = Boolean(contactInfo.hasPhone);
  const pipelineStage = leadScore.tier === 'hot' && canEmail && canCall
    ? 'email_then_ai_call_candidate'
    : (canEmail ? 'email_nurture' : (canCall ? 'manual_phone_research' : 'research_contact_info'));
  
  // Generate contextual ideas based on SEO quality
  const ideas = [];
  if (seoQuality.classification === 'none' || seoQuality.classification === 'minimal') {
    ideas.push('No active SEO detected - emphasize first-mover advantage in local search.');
  } else if (seoQuality.classification === 'basic') {
    ideas.push('Basic SEO present - highlight gaps in their current strategy.');
  } else if (seoQuality.classification === 'competent') {
    ideas.push('Active SEO program - focus on AI visibility and advanced optimizations they may be missing.');
  } else {
    ideas.push('Sophisticated SEO - focus on AI search and next-gen visibility gaps.');
  }
  
  if (estimatedSeoBudget.hasActiveProgram) {
    ideas.push(`Estimated ${estimatedSeoBudget.estimatedMonthlyLow > 0 ? '$' + estimatedSeoBudget.estimatedMonthlyLow + '/mo' : 'minimal'} SEO spend - use ROI framing.`);
  } else {
    ideas.push('No measurable SEO investment - emphasize opportunity cost.');
  }
  
  ideas.push(
    'Send a short audit-result email first; only route replies/opt-ins to AI appointment-setting calls.',
    'Use owner name and years-in-business fields to personalize first-line copy.',
    'Review all-party consent states before AI calls or recording/transcription.'
  );
  
  return {
    aiCallCompliance,
    estimatedOpportunity,
    estimatedSeoBudget,
    seoQuality,
    pipelineStage,
    ideas,
    ahrefs: getAhrefsIntegrationStatus(),
    riskFlags: [
      aiCallCompliance.aiCallRisk === 'high' ? 'High call compliance risk: require explicit consent and disclosure.' : '',
      seoProvider.classification === 'national_agency' ? 'National agency vendor: harder close, target the AI/GEO gap they don\u2019t cover.' : '',
      seoProvider.classification === 'boutique_agency' ? 'Boutique agency: contract likely, position as complementary AI-search layer.' : '',
      seoProvider.classification === 'inhouse_team' ? 'In-house team: pitch as a vendor for the AI-search layer they don\u2019t own.' : '',
      !canEmail && !canCall ? 'No direct contact path found.' : '',
      Number(scores.overall || 0) > 80 ? 'Strong audit score: lower pain angle.' : '',
      seoQuality.isActivelyManaged && seoQuality.overallQuality > 70 ? 'Well-managed SEO: needs sophisticated pitch angle.' : '',
      !seoQuality.isMeasurable ? 'No measurable SEO data: focus on opportunity framing.' : ''
    ].filter(Boolean)
  };
}

async function loadStore() {
  try {
    const raw = await fs.readFile(leadGenPath(), 'utf8');
    if (!raw.trim()) return { runs: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { runs: parsed };
    return { runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
  } catch {
    return { runs: [] };
  }
}

async function saveStore(store) {
  const file = leadGenPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ runs: store.runs || [] }, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

let storeWriteChain = Promise.resolve();

/** Serialize lead-gen JSON mutations so concurrent API handlers cannot interleave read-modify-write. */
function withStoreLock(fn) {
  const next = storeWriteChain.then(() => fn());
  storeWriteChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function normalizeCandidate(candidate, context) {
  const domain = candidateKey(candidate);
  return {
    ...candidate,
    id: domain,
    domain,
    website: normalizeUrl(candidate.website || candidate.url || domain),
    businessName: normalizeString(candidate.businessName || candidate.companyName || candidate.name || domain),
    industry: normalizeString(candidate.industry || context.industry),
    city: normalizeString(candidate.city || context.city),
    state: normalizeString(candidate.state || context.state),
    zip: normalizeString(candidate.zip || context.zip),
    status: candidate.status || 'pending',
    decision: candidate.decision || {
      keep: false,
      tags: [],
      notes: '',
      ownerName: '',
      yearsInBusiness: '',
      phone: '',
      seoProviderOverride: ''
    }
  };
}

async function createLeadGenRun(input = {}) {
  const now = new Date().toISOString();
  const quantity = normalizeLeadGenQuantity(input.quantity);
  const context = {
    industry: normalizeString(input.industry),
    city: normalizeString(input.city),
    state: normalizeString(input.state),
    zip: normalizeString(input.zip)
  };
  const candidates = (Array.isArray(input.candidates) ? input.candidates : [])
    .map((candidate) => normalizeCandidate(candidate, context))
    .filter((candidate) => candidate.domain)
    .slice(0, quantity);
  const run = {
    id: input.id || `leadgen_${now.replace(/[-:.TZ]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    status: input.status || 'queued',
    quantity,
    useAhrefs: Boolean(input.useAhrefs),
    ahrefs: {
      requested: Boolean(input.useAhrefs),
      ...getAhrefsIntegrationStatus()
    },
    ...context,
    candidates,
    summary: {
      total: candidates.length,
      completed: 0,
      failed: 0,
      kept: 0
    }
  };
  return withStoreLock(async () => {
    const store = await loadStore();
    store.runs.unshift(run);
    store.runs = store.runs.slice(0, 100);
    await saveStore(store);
    return run;
  });
}

async function getLeadGenRun(runId) {
  const store = await loadStore();
  return store.runs.find((run) => run.id === runId) || null;
}

async function updateLeadGenRun(runId, updater) {
  return withStoreLock(async () => {
    const store = await loadStore();
    const index = store.runs.findIndex((run) => run.id === runId);
    if (index === -1) return null;
    const next = updater({ ...store.runs[index] });
    next.updatedAt = new Date().toISOString();
    next.summary = summarizeRun(next);
    store.runs[index] = next;
    await saveStore(store);
    return next;
  });
}

function summarizeRun(run) {
  const candidates = Array.isArray(run.candidates) ? run.candidates : [];
  return {
    total: candidates.length,
    completed: candidates.filter((c) => c.status === 'complete').length,
    failed: candidates.filter((c) => c.status === 'failed').length,
    kept: candidates.filter((c) => c.decision && c.decision.keep).length,
    hot: candidates.filter((c) => c.leadScore && c.leadScore.tier === 'hot').length,
    warm: candidates.filter((c) => c.leadScore && c.leadScore.tier === 'warm').length,
    readyForCall: candidates.filter((c) => c.outreachPlan && c.outreachPlan.callReadiness === 'ready_for_ai_call').length
  };
}

async function updateCandidateResult(runId, domain, patch) {
  const key = normalizeDomainToken(domain);
  return updateLeadGenRun(runId, (run) => {
    run.candidates = (run.candidates || []).map((candidate) => (
      normalizeDomainToken(candidate.domain) === key ? { ...candidate, ...patch } : candidate
    ));
    return run;
  });
}

async function saveLeadGenDecision(runId, domain, decision = {}) {
  const key = normalizeDomainToken(domain);
  let updatedDecision = null;
  await updateLeadGenRun(runId, (run) => {
    run.candidates = (run.candidates || []).map((candidate) => {
      if (normalizeDomainToken(candidate.domain) !== key) return candidate;
      updatedDecision = {
        keep: Boolean(decision.keep),
        tags: Array.isArray(decision.tags)
          ? decision.tags.map(normalizeString).filter(Boolean).slice(0, 20)
          : [],
        notes: normalizeString(decision.notes).slice(0, 5000),
        ownerName: normalizeString(decision.ownerName).slice(0, 200),
        yearsInBusiness: normalizeString(decision.yearsInBusiness).slice(0, 40),
        phone: normalizeString(decision.phone).slice(0, 30),
        seoProviderOverride: normalizeString(decision.seoProviderOverride).slice(0, 80),
        updatedAt: new Date().toISOString()
      };
      return { ...candidate, decision: updatedDecision };
    });
    return run;
  });
  return updatedDecision;
}

module.exports = {
  MAX_LEAD_GEN_QUANTITY,
  DEFAULT_LEAD_GEN_QUANTITY,
  normalizeLeadGenQuantity,
  normalizeDomainToken,
  extractLeadGenCandidates,
  assessSeoProvider,
  extractContactInfo,
  extractContactsFromHtml,
  mergeContacts,
  deobfuscateEmails,
  classifyCandidateQuality,
  isBlockedAggregator,
  looksLikeListicleTitle,
  looksLikeArticlePath,
  scoreLeadOpportunity,
  buildOutreachPlan,
  getAiCallComplianceForState,
  listUsStatesForLeadGenUi,
  buildAdvancedLeadInsights,
  getAhrefsIntegrationStatus,
  estimateSeoBudget,
  predictSeoQuality,
  createLeadGenRun,
  getLeadGenRun,
  updateLeadGenRun,
  updateCandidateResult,
  saveLeadGenDecision,
  summarizeRun
};
