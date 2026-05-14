/**
 * E-E-A-T Analyzer — measurable signal scoring of Experience, Expertise,
 * Authoritativeness, and Trust signals on a page.
 *
 * Design: prefer MEASURABLE HTML structures (JSON-LD, links, meta tags,
 * specific format regex with extracted values) over magic-word matching.
 * Each finding is something the customer can verify against their page —
 * "you have no aggregateRating in your JSON-LD" beats "you didn't say
 * 'licensed' enough times".
 *
 * NO LLM. Pure deterministic parsing.
 */

// ---- pattern primitives ----

// Real phone format
const PHONE_RE = /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/;
// US street address (number + street + St/Ave/Rd/etc + ZIP)
const ADDRESS_RE = /\b\d{1,6}\s+[A-Z][\w\s.]*(?:St|Ave|Rd|Blvd|Dr|Ln|Way|Court|Ct|Pl|Hwy|Highway)\b[\s,]+[\w\s]+(?:,?\s+[A-Z]{2})?\s+\d{5}/;

// Specific platform awards — these are real, not just "award-winning" boilerplate
const PLATFORM_AWARD_RE = /\b(?:angie'?s?\s+list\s+super\s+service|home\s*advisor\s+(?:elite|screened\s*&\s*approved|top\s+pro)|yelp\s+(?:elite|people'?s?\s+love\s+us)|google\s+(?:guaranteed|screened|local\s+favorite)|nextdoor\s+(?:favorite|neighborhood\s+favorite)|thumbtack\s+top\s+pro|porch\s+vetted|bbb\s+(?:accredited|a\+|torch\s+award))\b/i;

// License number format: "License #ABC1234" or "Lic. #12345" or "MO License 12345"
const LICENSE_NUMBER_RE = /\b(?:licen[sc]e|lic\.?|reg\.?|registration|permit)\s*(?:no\.?|number|#|nbr\.?)?\s*[:\-]?\s*(?:[A-Z]{1,3}[\-\s]?)?[A-Z0-9\-]{4,15}\b/i;

// Legal entity suffix
const LEGAL_ENTITY_RE = /\b(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Co\.?|PLLC|P\.A\.|LLP)\b/;

// "X years" with a number we can extract
const YEARS_IN_BUSINESS_RE = /(\d{1,2})\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|in\s+(?:business|the\s+industry)|serving)/i;
// "Since YYYY" or "Established YYYY"
const SINCE_YEAR_RE = /(?:serving|in\s+business|established|founded|since)\s+(?:since\s+)?((?:19|20)\d{2})/i;
// "X jobs/projects/customers"
const JOB_COUNT_RE = /(\d{2,5})\+?\s*(?:projects?|jobs?|installations?|repairs?|customers?|clients?|homes?|properties?)\s+(?:served|completed|done|finished)/i;

// ---- JSON-LD parser (lightweight) ----
function extractJsonLdNodes(html) {
  if (!html) return [];
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch { /* malformed JSON-LD — count as parse error elsewhere, ignore here */ }
  }
  // Walk @graph
  const flat = [];
  blocks.forEach((b) => {
    if (!b) return;
    if (Array.isArray(b['@graph'])) flat.push(...b['@graph']);
    else flat.push(b);
  });
  return flat;
}

function findInJsonLd(nodes, predicate) {
  return nodes.filter(predicate);
}

// ---- dimension scorers ----

function scoreTrust({ html, text, isHttps, jsonLd }) {
  const signals = [];
  const missing = [];
  let pts = 0;
  const max = 100;

  // HTTPS — 15 pts
  if (isHttps) { pts += 15; signals.push('https'); } else missing.push('https');
  // tel: link with valid format — 15 pts
  const telMatch = html.match(/<a[^>]+href=["']tel:\+?(\d[\d\s\-]{6,15})/i);
  if (telMatch) { pts += 15; signals.push('tel_link'); } else missing.push('tel_link');
  // Visible phone in text — 10 pts
  if (PHONE_RE.test(text)) { pts += 10; signals.push('phone_visible'); } else missing.push('phone_visible');
  // Physical address — 15 pts
  if (ADDRESS_RE.test(text)) { pts += 15; signals.push('address_visible'); } else missing.push('address_visible');
  // mailto — 5 pts
  if (/<a[^>]+href=["']mailto:/i.test(html)) { pts += 5; signals.push('mailto'); } else missing.push('mailto');
  // Contact page link — 10 pts
  if (/<a[^>]+href=["'][^"']*(?:contact|get-in-touch|book|schedule)/i.test(html)) {
    pts += 10; signals.push('contact_page_link');
  } else missing.push('contact_page_link');
  // About page link — 10 pts
  if (/<a[^>]+href=["'][^"']*(?:about|company|story|who-we-are)/i.test(html)) {
    pts += 10; signals.push('about_page_link');
  } else missing.push('about_page_link');
  // Privacy policy — 5 pts
  if (/\bprivacy\s+(?:policy|notice)\b/i.test(text)) { pts += 5; signals.push('privacy_policy'); } else missing.push('privacy_policy');
  // Terms of service — 3 pts
  if (/\bterms\s+(?:of\s+(?:service|use)|&\s+conditions)\b/i.test(text)) { pts += 3; signals.push('terms_of_service'); } else missing.push('terms_of_service');
  // Insured/bonded specifically (not generic "we care") — 7 pts
  if (/\b(?:fully\s+)?insured(?:\s+and\s+bonded|\s+&\s+bonded)?|bonded\s+(?:and|&)\s+insured/i.test(text)) {
    pts += 7; signals.push('insured_bonded');
  } else missing.push('insured_bonded');
  // Guarantee/warranty — 5 pts
  if (/\b(?:satisfaction\s+)?guarantee[d]?|warrant(?:y|ies)|money[- ]back/i.test(text)) {
    pts += 5; signals.push('guarantee');
  } else missing.push('guarantee');

  return { score: Math.round((pts / max) * 100), signals, missing, raw: { pts, max } };
}

function scoreAuthority({ html, text, jsonLd }) {
  const signals = [];
  const missing = [];
  let pts = 0;
  const max = 100;

  // JSON-LD AggregateRating present — 25 pts (real schema-backed reviews)
  const aggRating = findInJsonLd(jsonLd, (n) => {
    return n.aggregateRating || (n['@type'] === 'AggregateRating');
  });
  if (aggRating.length > 0) {
    pts += 25; signals.push('aggregate_rating_jsonld');
    const ar = aggRating[0].aggregateRating || aggRating[0];
    const count = Number(ar.reviewCount || ar.ratingCount || 0);
    if (count >= 50) { pts += 10; signals.push('review_count_50plus'); }
    else if (count >= 10) { pts += 5; signals.push('review_count_10plus'); }
  } else missing.push('aggregate_rating_jsonld');

  // JSON-LD Review nodes — 10 pts
  const reviews = findInJsonLd(jsonLd, (n) => n['@type'] === 'Review');
  if (reviews.length > 0) { pts += 10; signals.push('review_nodes'); } else missing.push('review_nodes');

  // Visible review count number ("X reviews", "rated 4.X by Y customers") — 8 pts
  if (/(\d{2,5})\+?\s*(?:verified\s+|five[- ]star\s+|5[- ]star\s+|happy\s+customer\s+)?(?:reviews?|ratings?|testimonials?|stars?)/i.test(text)) {
    pts += 8; signals.push('review_count_visible');
  } else missing.push('review_count_visible');

  // Visible aggregate rating ("4.8/5") — 7 pts
  if (/(?:rated\s+)?[4-5](?:\.[5-9])?\s*(?:out\s+of\s+5|\/\s*5|★|⭐)/i.test(text)) {
    pts += 7; signals.push('aggregate_rating_visible');
  } else missing.push('aggregate_rating_visible');

  // Specific platform awards — 15 pts
  if (PLATFORM_AWARD_RE.test(text)) { pts += 15; signals.push('platform_award'); } else missing.push('platform_award');

  // BBB accredited mention — 10 pts
  if (/\b(?:BBB|Better\s+Business\s+Bureau)[\s\S]{0,80}(?:accredited|A\+|A\s+(?:rating|rated)|torch\s+award)/i.test(text)) {
    pts += 10; signals.push('bbb_accredited');
  } else missing.push('bbb_accredited');

  // Press/media mention — 8 pts
  if (/\b(?:as\s+seen\s+(?:on|in)|featured\s+in|press\s+coverage|local\s+news|interviewed\s+(?:by|on))\b/i.test(text)) {
    pts += 8; signals.push('press_mention');
  } else missing.push('press_mention');

  // External authoritative links (.gov, .edu) — 7 pts
  if (/<a[^>]+href=["']https?:\/\/[^"']+\.(?:gov|edu)\b/i.test(html)) {
    pts += 7; signals.push('external_authority_links');
  } else missing.push('external_authority_links');

  return { score: Math.round((pts / max) * 100), signals, missing, raw: { pts, max } };
}

function scoreExperience({ text, html, jsonLd }) {
  const signals = [];
  const missing = [];
  let pts = 0;
  const max = 100;

  // JSON-LD foundingDate — 20 pts (best, structured)
  const founding = findInJsonLd(jsonLd, (n) => n.foundingDate);
  if (founding.length > 0) {
    pts += 20; signals.push('founding_date_jsonld');
    const year = parseInt(String(founding[0].foundingDate).slice(0, 4), 10);
    const yearsOld = (new Date().getFullYear()) - year;
    if (yearsOld >= 10) { pts += 10; signals.push('established_10plus_years'); }
    else if (yearsOld >= 5) { pts += 5; signals.push('established_5plus_years'); }
  } else missing.push('founding_date_jsonld');

  // "Since YYYY" extracted year — 15 pts
  const sinceMatch = text.match(SINCE_YEAR_RE);
  if (sinceMatch) {
    pts += 15; signals.push('since_year_text');
    const yearsOld = (new Date().getFullYear()) - parseInt(sinceMatch[1], 10);
    if (yearsOld >= 10) { pts += 5; signals.push('since_text_10plus'); }
  } else missing.push('since_year_text');

  // "X years of experience" — 15 pts (only if >= 3 years)
  const yearsMatch = text.match(YEARS_IN_BUSINESS_RE);
  if (yearsMatch && parseInt(yearsMatch[1], 10) >= 3) {
    pts += 15; signals.push(`years_in_business_${yearsMatch[1]}`);
  } else missing.push('years_in_business');

  // "X jobs/projects completed" with extracted count — 15 pts
  const jobMatch = text.match(JOB_COUNT_RE);
  if (jobMatch && parseInt(jobMatch[1], 10) >= 25) {
    pts += 15; signals.push(`job_count_${jobMatch[1]}`);
  } else missing.push('job_count');

  // Portfolio/gallery/case studies link — 10 pts
  if (/<a[^>]+href=["'][^"']*(?:portfolio|gallery|case-stud|projects|our-work)/i.test(html)) {
    pts += 10; signals.push('portfolio_link');
  } else missing.push('portfolio_link');

  // Before/after imagery (alt text or filename) — 10 pts
  if (/<img[^>]+(?:alt|title|src)=["'][^"']*(?:before[\-_\s]?after|completed|finished|our[\-_\s]?work)/i.test(html)) {
    pts += 10; signals.push('before_after_imagery');
  } else missing.push('before_after_imagery');

  // Service-area / serving copy — 5 pts (proves they know their geography)
  if (/\b(?:serving|service\s+area|we\s+serve|locally\s+owned)\b/i.test(text)) {
    pts += 5; signals.push('service_area_advertised');
  } else missing.push('service_area_advertised');

  return { score: Math.round((pts / max) * 100), signals, missing, raw: { pts, max } };
}

function scoreExpertise({ html, text, jsonLd }) {
  const signals = [];
  const missing = [];
  let pts = 0;
  const max = 100;

  // Specific certifications with names (NATE, EPA RRP, IICRC, etc.) — 25 pts
  if (/\b(?:NATE|EPA\s+RRP|EPA[- ]certified|IICRC|HBA|HVAC[\s-]?Excellence|OSHA[- ](?:10|30)|RBT|MOLD|ICC[- ]certified|NRCA|NACE|ASA)\b/i.test(text)) {
    pts += 25; signals.push('specific_industry_cert');
  } else missing.push('specific_industry_cert');

  // License number with extractable format — 20 pts
  if (LICENSE_NUMBER_RE.test(text)) { pts += 20; signals.push('license_number'); } else missing.push('license_number');

  // Author byline / credentialed expert — 15 pts
  // Sources: meta name="author", JSON-LD author field, "Reviewed by Dr. X"
  const authorMeta = /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i.exec(html);
  const jsonLdAuthor = findInJsonLd(jsonLd, (n) => n.author);
  const reviewedByText = /\b(?:written\s+by|reviewed\s+by|authored\s+by)\s+[A-Z][a-z]+\s+[A-Z][a-z]+/i.test(text);
  if (authorMeta || jsonLdAuthor.length > 0 || reviewedByText) {
    pts += 15; signals.push('author_attribution');
  } else missing.push('author_attribution');

  // Team / staff page link (real link, not just words) — 10 pts
  if (/<a[^>]+href=["'][^"']*(?:our-team|meet-the-team|team|staff|crew|technicians)/i.test(html)) {
    pts += 10; signals.push('team_page_link');
  } else missing.push('team_page_link');

  // Owner/founder named with format "Owner: First Last" — 10 pts
  if (/\b(?:owner|founder|president|ceo|principal)[:,\s]+[A-Z][a-z]+\s+[A-Z][a-z]+/i.test(text)) {
    pts += 10; signals.push('expert_named');
  } else missing.push('expert_named');

  // Service-specific expertise pages (e.g., /water-heater-repair) — 10 pts
  // Use deep links presence as proxy
  const internalLinks = (html.match(/<a[^>]+href=["']\/[a-z0-9\-_/]+/gi) || []).length;
  if (internalLinks >= 8) { pts += 10; signals.push('depth_internal_pages'); }
  else missing.push('depth_internal_pages');

  // Blog / educational content link — 10 pts
  if (/<a[^>]+href=["'][^"']*(?:blog|articles|guides?|tips|resources|learn)/i.test(html)) {
    pts += 10; signals.push('educational_content');
  } else missing.push('educational_content');

  return { score: Math.round((pts / max) * 100), signals, missing, raw: { pts, max } };
}

function scoreIdentity({ text, html, jsonLd, finalUrl }) {
  const signals = [];
  const missing = [];
  let pts = 0;
  const max = 100;

  // Legal entity (LLC, Inc, etc.) — 15 pts
  if (LEGAL_ENTITY_RE.test(text)) { pts += 15; signals.push('legal_entity'); } else missing.push('legal_entity');

  // License number — 20 pts
  if (LICENSE_NUMBER_RE.test(text)) { pts += 20; signals.push('license_number'); } else missing.push('license_number');

  // JSON-LD Organization with logo — 15 pts (clear identity)
  const org = findInJsonLd(jsonLd, (n) => /Organization|LocalBusiness/.test(n['@type'] || ''));
  if (org.length > 0 && org[0].logo) { pts += 15; signals.push('jsonld_org_with_logo'); }
  else if (org.length > 0) { pts += 8; signals.push('jsonld_org'); missing.push('jsonld_logo'); }
  else missing.push('jsonld_org');

  // Owner/founder named — 10 pts
  if (/\b(?:owner|founder|president|ceo)[:,\s]+[A-Z][a-z]+\s+[A-Z][a-z]+/i.test(text)) {
    pts += 10; signals.push('owner_named');
  } else missing.push('owner_named');

  // Photo of owner/team — 10 pts (proxy: img alt mentioning owner/team/founder)
  if (/<img[^>]+(?:alt|title)=["'][^"']*(?:owner|founder|team|staff|crew)/i.test(html)) {
    pts += 10; signals.push('owner_photo');
  } else missing.push('owner_photo');

  // Year-founded explicit — 10 pts
  if (SINCE_YEAR_RE.test(text)) { pts += 10; signals.push('year_founded'); } else missing.push('year_founded');

  // Service area mentioned — 10 pts
  if (/\b(?:serving|service\s+area|we\s+serve|areas\s+served)\b/i.test(text)) {
    pts += 10; signals.push('service_area');
  } else missing.push('service_area');

  // Domain matches business name (low spam signal) — 10 pts
  // Skip — too noisy without name normalization

  return { score: Math.round((pts / max) * 100), signals, missing, raw: { pts, max } };
}

function scoreFreshness({ text, html }) {
  const signals = [];
  const missing = [];
  let pts = 0;
  const max = 100;
  const currentYear = new Date().getFullYear();

  // "Last updated [Month YYYY]" — 25 pts
  const lastUpdate = text.match(/\b(?:last\s+updated|updated|reviewed|posted)\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},?\s+(?:19|20)\d{2})/i);
  if (lastUpdate) {
    pts += 25; signals.push('last_updated_text');
    const year = parseInt(lastUpdate[1].match(/\d{4}/)?.[0] || '0', 10);
    if (year >= currentYear - 1) { pts += 15; signals.push('last_updated_recent'); }
    else missing.push('last_updated_recent');
  } else missing.push('last_updated_text');

  // <time datetime="..."> tags — 20 pts
  const timeMatch = html.match(/<(?:time|article)[^>]+datetime=["']((?:19|20)\d{2})/i);
  if (timeMatch) {
    pts += 20; signals.push('time_datetime');
    if (parseInt(timeMatch[1], 10) >= currentYear - 1) { pts += 10; signals.push('time_recent'); }
  } else missing.push('time_datetime');

  // Current year mentioned in body — 10 pts
  if (new RegExp('\\b' + currentYear + '\\b').test(text)) { pts += 10; signals.push('current_year_in_text'); }
  else missing.push('current_year_in_text');

  // Last year mentioned (still considered "fresh-ish") — 5 pts
  if (new RegExp('\\b' + (currentYear - 1) + '\\b').test(text)) { pts += 5; signals.push('last_year_in_text'); }

  // Copyright year is current — 15 pts
  const copyright = text.match(/©\s*(?:copyright\s+)?(?:19|20)(\d{2})/i);
  if (copyright) {
    const year = 2000 + parseInt(copyright[1], 10);
    if (year >= currentYear - 1) { pts += 15; signals.push('copyright_current'); }
    else { pts += 5; signals.push('copyright_stale'); }
  } else missing.push('copyright');

  return { score: Math.round((pts / max) * 100), signals, missing, raw: { pts, max } };
}

function scoreContactAccessibility({ html, text }) {
  const signals = [];
  const missing = [];
  let pts = 0;
  const max = 100;

  // tel: link — 30 pts (most important)
  if (/<a[^>]+href=["']tel:/i.test(html)) { pts += 30; signals.push('tel_link'); }
  else missing.push('tel_link');
  // mailto link — 15 pts
  if (/<a[^>]+href=["']mailto:/i.test(html)) { pts += 15; signals.push('mailto'); }
  else missing.push('mailto');
  // Contact form — 25 pts (real form, with action or method attr)
  if (/<form[^>]*(?:action=|method=)[\s\S]{0,800}(?:contact|quote|estimate|book|schedule|call[- ]back)/i.test(html)) {
    pts += 25; signals.push('contact_form');
  } else missing.push('contact_form');
  // 24/7 / emergency / same-day mentioned — 10 pts
  if (/(?:available\s+24\/?7|24\s+hours?\s+a\s+day|24\s*hr|emergency\s+service|same[- ]?day)/i.test(text)) {
    pts += 10; signals.push('availability');
  } else missing.push('availability');
  // Online booking link — 10 pts
  if (/<a[^>]+href=["'][^"']*(?:book|schedule|appointment|calendar|calendly|setmore|squareup\.com\/appointments)/i.test(html)) {
    pts += 10; signals.push('online_booking');
  } else missing.push('online_booking');
  // Live chat / messaging — 10 pts (look for common widgets)
  if (/(?:intercom|drift\.com|tawk\.to|crisp\.chat|hubspot.*chat|livechat|olark|zendesk\.com\/chat|messenger)/i.test(html)) {
    pts += 10; signals.push('live_chat');
  } else missing.push('live_chat');

  return { score: Math.round((pts / max) * 100), signals, missing, raw: { pts, max } };
}

// ---- main ----

function analyzeEeat({ html, visibleText, finalUrl, businessFacts = {} }) {
  const text = visibleText || stripHtmlToText(html || '');
  const safeHtml = html || '';
  const isHttps = /^https:\/\//i.test(finalUrl || '');
  const jsonLd = extractJsonLdNodes(safeHtml);

  const ctx = { html: safeHtml, text, isHttps, jsonLd, finalUrl };

  const dims = {
    trust: scoreTrust(ctx),
    authoritativeness: scoreAuthority(ctx),
    experience: scoreExperience(ctx),
    expertise: scoreExpertise(ctx),
    identity: scoreIdentity(ctx),
    freshness: scoreFreshness(ctx),
    contactAccessibility: scoreContactAccessibility(ctx)
  };

  // Weighted overall — heavier on trust + contact (the things that drive
  // conversion + that customers can immediately see), lighter on freshness +
  // identity (less likely to be deal-breakers for local services).
  const weights = {
    trust: 0.22,
    authoritativeness: 0.18,
    experience: 0.15,
    expertise: 0.15,
    contactAccessibility: 0.14,
    identity: 0.10,
    freshness: 0.06
  };
  const overall = Math.round(
    Object.entries(weights).reduce((sum, [k, w]) => sum + (dims[k].score * w), 0)
  );

  const status = overall >= 75 ? 'pass' : overall >= 50 ? 'warn' : 'fail';
  const findings = buildFindings(dims, businessFacts, jsonLd);

  return {
    overallScore: overall,
    status,
    dimensions: dims,
    findings,
    fixes: findings, // back-compat — orchestrator reads either
    weights,
    note: 'E-E-A-T scored on measurable HTML signals (JSON-LD, links, format-specific regex), not magic-word matches.'
  };
}

function buildFindings(dims, facts, jsonLd) {
  const findings = [];
  const biz = facts.businessName || 'your business';

  // TRUST findings — driven by what's actually missing
  if (dims.trust.missing.includes('tel_link')) {
    const rawPhone = facts.phone != null ? String(facts.phone).trim() : '';
    const phoneDigits = rawPhone.replace(/\D/g, '');
    const validPhone = phoneDigits.length >= 7;
    findings.push({
      key: 'eeat-trust-add-tel-link',
      severity: 'high',
      title: 'No <a href="tel:"> link found — mobile callers can\u2019t tap to call',
      description: 'Wrap your phone number in a tel: link so mobile users tap once to call. Naked text numbers cost calls every day.',
      copyPasteReady: validPhone,
      snippet: validPhone
        ? `<a href="tel:+1${phoneDigits}" class="phone-cta">Call ${rawPhone}</a>`
        : '<a href="tel:+1YOUR_PHONE" class="phone-cta">Call YOUR_PHONE</a>',
      effortMinutes: 5
    });
  }
  if (dims.trust.missing.includes('address_visible')) {
    findings.push({
      key: 'eeat-trust-add-address',
      severity: 'high',
      title: 'No physical street address detected on the page',
      description: 'Local businesses need a visible street address (street + city + state + ZIP). Drives trust + Google local-pack ranking.',
      effortMinutes: 5
    });
  }
  if (dims.trust.missing.includes('https')) {
    findings.push({
      key: 'eeat-trust-https',
      severity: 'high',
      title: 'Site is not on HTTPS',
      description: 'Browsers warn visitors. Get a free Let\u2019s Encrypt cert via your host\u2019s control panel.',
      effortMinutes: 30
    });
  }
  if (dims.trust.missing.includes('insured_bonded')) {
    findings.push({
      key: 'eeat-trust-insured-line',
      severity: 'medium',
      title: 'No "licensed/insured/bonded" trust strip detected',
      description: 'A single line near the hero or footer ("Licensed, bonded, insured \u2014 serving X since YYYY") lifts conversion + AI-citation eligibility.',
      effortMinutes: 10
    });
  }

  // AUTHORITY findings
  if (dims.authoritativeness.missing.includes('aggregate_rating_jsonld')) {
    findings.push({
      key: 'eeat-authority-aggregate-rating-jsonld',
      severity: 'high',
      title: 'No AggregateRating in your JSON-LD schema',
      description: 'Google reads aggregateRating from your structured data to show stars in search results. Add an AggregateRating block under your LocalBusiness schema with reviewCount + ratingValue.',
      copyPasteReady: true,
      snippet: `"aggregateRating": {\n  "@type": "AggregateRating",\n  "ratingValue": "4.8",\n  "reviewCount": "47"\n}`,
      effortMinutes: 10
    });
  }
  if (dims.authoritativeness.missing.includes('review_count_visible') && dims.authoritativeness.missing.includes('aggregate_rating_visible')) {
    findings.push({
      key: 'eeat-authority-show-reviews',
      severity: 'medium',
      title: 'No visible review count or aggregate rating on the page',
      description: 'Show your real review count + average rating prominently (e.g., "4.8/5 from 127 Google reviews"). Customers verify before calling.',
      effortMinutes: 15
    });
  }
  if (dims.authoritativeness.missing.includes('platform_award') && dims.authoritativeness.missing.includes('bbb_accredited')) {
    findings.push({
      key: 'eeat-authority-trust-badges',
      severity: 'medium',
      title: 'No specific platform trust badges detected',
      description: 'Get verified on a platform (Google Guaranteed, Angie\u2019s List Super Service, BBB Accredited, HomeAdvisor Top Pro) and display the badge near your hero.',
      effortMinutes: 60
    });
  }

  // EXPERIENCE findings
  if (dims.experience.missing.includes('founding_date_jsonld') && dims.experience.missing.includes('since_year_text')) {
    findings.push({
      key: 'eeat-experience-add-founded',
      severity: 'medium',
      title: 'No "since YYYY" or foundingDate found',
      description: `Add "Serving [city] since YYYY" near the hero AND foundingDate in your JSON-LD Organization schema. Year-founded is one of the strongest tenure signals.`,
      effortMinutes: 10
    });
  }
  if (dims.experience.missing.includes('job_count') && dims.experience.missing.includes('years_in_business')) {
    findings.push({
      key: 'eeat-experience-add-stats',
      severity: 'medium',
      title: 'No quantified experience stats found ("X years", "Y jobs completed")',
      description: 'Add a 3-stat strip with REAL numbers (years in business, total jobs completed, review count). Vague claims hurt; specific numbers help.',
      effortMinutes: 15
    });
  }
  if (dims.experience.missing.includes('portfolio_link')) {
    findings.push({
      key: 'eeat-experience-portfolio',
      severity: 'low',
      title: 'No portfolio/gallery/case-studies link found',
      description: 'A "Recent Projects" or photo gallery page is the single fastest way to demonstrate experience to both visitors and AI search engines.',
      effortMinutes: 60
    });
  }

  // EXPERTISE findings
  if (dims.expertise.missing.includes('specific_industry_cert')) {
    findings.push({
      key: 'eeat-expertise-cert-specifics',
      severity: 'medium',
      title: 'No specific industry certifications named (NATE, EPA RRP, IICRC, etc.)',
      description: 'Replace generic "licensed and certified" with actual credential names. Specific certs are heavily weighted by Google E-E-A-T and AI citation engines.',
      effortMinutes: 15
    });
  }
  if (dims.expertise.missing.includes('license_number')) {
    findings.push({
      key: 'eeat-expertise-license-number',
      severity: 'medium',
      title: 'No license number visible on the page',
      description: 'Display "License #XXXXX" in the footer or trust strip. Required for most regulated trades and a strong trust signal everywhere.',
      effortMinutes: 5
    });
  }
  if (dims.expertise.missing.includes('author_attribution')) {
    findings.push({
      key: 'eeat-expertise-author',
      severity: 'low',
      title: 'No author/credentialed expert attributed to the content',
      description: 'Add a meta author tag, JSON-LD author field, OR a "Reviewed by [Name], [Credential]" line on key service pages. Drives Expertise signal.',
      effortMinutes: 15
    });
  }

  // IDENTITY findings
  if (dims.identity.missing.includes('legal_entity')) {
    findings.push({
      key: 'eeat-identity-legal-entity',
      severity: 'low',
      title: 'No legal entity suffix (LLC/Inc/Corp) detected on page',
      description: 'Show your full legal business name with entity suffix in the footer. Affects identity transparency.',
      effortMinutes: 2
    });
  }
  if (dims.identity.missing.includes('jsonld_org')) {
    findings.push({
      key: 'eeat-identity-jsonld-org',
      severity: 'medium',
      title: 'No Organization or LocalBusiness JSON-LD found',
      description: 'Add a LocalBusiness schema block with name, address, phone, logo, and URL. This is the single most valuable structured-data block for local SEO.',
      effortMinutes: 15
    });
  }

  // FRESHNESS findings
  if (dims.freshness.missing.includes('copyright')) {
    findings.push({
      key: 'eeat-freshness-copyright',
      severity: 'low',
      title: 'No copyright year detected in footer',
      description: 'Add a "© ${YYYY} ${biz}" line that auto-updates each January. Stale copyright dates ("© 2019") are a freshness red flag.',
      effortMinutes: 2
    });
  }
  if (dims.freshness.missing.includes('last_updated_text') && dims.freshness.missing.includes('time_datetime')) {
    findings.push({
      key: 'eeat-freshness-last-updated',
      severity: 'low',
      title: 'No "last updated" date on content pages',
      description: 'Add "Last updated [Month YYYY]" to service pages. Feeds Google\u2019s freshness signal.',
      effortMinutes: 10
    });
  }

  // CONTACT findings
  if (dims.contactAccessibility.missing.includes('contact_form')) {
    findings.push({
      key: 'eeat-contact-form',
      severity: 'medium',
      title: 'No contact / quote / estimate form detected',
      description: 'Visitors who don\u2019t want to call still convert. A simple 4-field form (name, email, phone, message) on a /contact page captures these leads.',
      effortMinutes: 30
    });
  }

  return findings;
}

function stripHtmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  analyzeEeat,
  stripHtmlToText
};
