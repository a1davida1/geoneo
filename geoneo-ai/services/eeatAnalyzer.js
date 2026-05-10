/**
 * E-E-A-T Analyzer — deterministic scoring of Experience, Expertise,
 * Authoritativeness, and Trust signals on a page. Plus four operational
 * dimensions Google's quality raters care about: identity transparency,
 * source attribution, content freshness, contact accessibility.
 *
 * NO LLM. Pure heuristic pattern matching against page HTML + visible text.
 *
 * Per Google's December 2025 quality update, E-E-A-T applies to ALL
 * competitive queries — not just YMYL. Local home services count.
 */

const EXPERIENCE_PATTERNS = [
  { name: 'years_in_business', re: /(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|in\s+(?:business|the\s+industry))/i, weight: 12 },
  { name: 'project_count', re: /(\d{2,5})\+?\s*(?:projects?|jobs?|installations?|repairs?|customers?|clients?|homes?|properties?)\s+(?:served|completed|done|finished)/i, weight: 10 },
  { name: 'served_since', re: /(?:serving|in\s+business|established|founded)\s+(?:since\s+)?(?:19|20)\d{2}/i, weight: 8 },
  { name: 'before_after', re: /\b(?:before\s*[/\-&\u2014]?\s*after|case\s*stud(?:y|ies)|portfolio|gallery)\b/i, weight: 6 },
  { name: 'photos_of_work', re: /<img[^>]+(?:alt|title)=["'][^"']*(?:job|project|installation|completed|finished|our\s+work)/i, weight: 5 }
];

const EXPERTISE_PATTERNS = [
  { name: 'author_bio', re: /\b(?:about\s+the\s+author|author\s+bio|written\s+by|reviewed\s+by)\b/i, weight: 10 },
  { name: 'credentials', re: /\b(?:licensed|certified|accredited|master\s+(?:plumber|electrician|technician)|board[- ]certified|registered)\b/i, weight: 12 },
  { name: 'specific_certifications', re: /\b(?:NATE|EPA|OSHA|RRP|HBA|IICRC|HVAC[\s-]?Excellence|Bonded|MO[- ]?License|AR[- ]?License)\b/i, weight: 10 },
  { name: 'team_page', re: /(?:our\s+team|meet\s+the\s+team|leadership|staff|crew|technicians)/i, weight: 6 },
  { name: 'expert_named', re: /\b(?:owner|founder|lead\s+(?:technician|installer|plumber|electrician))[:,\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)/, weight: 8 }
];

const AUTHORITY_PATTERNS = [
  { name: 'press_mentions', re: /\b(?:as\s+seen\s+(?:on|in)|featured\s+in|press(?:\s+coverage)?|media(?:\s+coverage)?|news\s+coverage|local\s+news|interviewed\s+(?:by|on))\b/i, weight: 8 },
  // Generic award patterns — covers most legitimate local awards across industries
  { name: 'awards_generic', re: /\b(?:award[- ]winning|award\s+winner|top[\s-]?rated|highest[\s-]rated|best[\s-]of[\s-]\w+|reader[\'\u2019]?s?\s+choice|critic[\'\u2019]?s?\s+choice|consumer[\'\u2019]?s?\s+choice|people[\'\u2019]?s?\s+choice|(?:gold|silver|bronze|platinum)\s+(?:medal|award)|(?:#1|number\s+one)\s+(?:rated|in)|(?:nominated|finalist|winner)\s+for|hall\s+of\s+fame)\b/i, weight: 10 },
  // Platform-specific awards (Angie's, HomeAdvisor, Yelp, Google, Nextdoor, Thumbtack)
  { name: 'platform_awards', re: /\b(?:angie\s*[\'\u2019]?s?\s+list\s+super\s+service|home\s*advisor\s+(?:elite|screened\s*&\s*approved|top\s+pro)|nextdoor\s+(?:favorite|neighborhood\s+favorite)|yelp\s+(?:elite|people[\'\u2019]?s?\s+love\s+us)|google\s+(?:guaranteed|screened|local\s+favorite)|thumbtack\s+top\s+pro|porch\s+vetted|trustpilot\s+(?:excellent|verified)|expertise\.com|three\s+best\s+rated|consumer\s+affairs\s+accredited)\b/i, weight: 8 },
  // BBB accreditation
  { name: 'bbb_accredited', re: /\b(?:BBB|Better\s+Business\s+Bureau)[\s\S]{0,80}(?:accredited|A\+|A\s+(?:rating|rated)|torch\s+award)/i, weight: 10 },
  // Local "Best of [City]" — captures any city
  { name: 'best_of_city', re: /\bbest\s+(?:of|in)\s+(?:[A-Za-z]+(?:\s+[A-Za-z]+)*|the\s+[A-Za-z]+s)\b/i, weight: 8 },
  { name: 'industry_membership', re: /\b(?:member\s+of|affiliated\s+with|partnered\s+with|certified\s+by|accredited\s+by|registered\s+with)\s+(?:the\s+)?[A-Z][A-Z\s&]{2,}\b/, weight: 6 },
  { name: 'review_count', re: /(\d{2,6})\+?\s*(?:verified\s+|five[- ]star\s+|5[- ]star\s+|happy\s+customer\s+)?(?:reviews?|ratings?|testimonials?|stars?)/i, weight: 8 },
  { name: 'aggregate_rating_visible', re: /(?:rated\s+)?[4-5](?:\.[5-9])?\s*(?:out\s+of\s+5|\/\s*5|\u2605)/i, weight: 6 },
  { name: 'years_award', re: /\b(?:since|established|in\s+business\s+for|serving\s+\w+\s+for)\s+(?:over\s+)?(?:1[5-9]|[2-9]\d|\d{3})\s*(?:\+\s*)?(?:years?|yrs?)/i, weight: 6 }
];

const TRUST_PATTERNS = [
  { name: 'https_present', re: null, score: (ctx) => ctx.isHttps ? 6 : 0 },
  { name: 'phone_visible', re: /(?:\b(?:tel|phone|call)\b[\s\S]{0,30})?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/i, weight: 8 },
  { name: 'physical_address', re: /\b\d{1,6}\s+[A-Z][\w\s.]*(?:St|Ave|Rd|Blvd|Dr|Ln|Way|Court|Ct|Pl|Hwy|Highway)\b[\s,]+[\w\s]+(?:,?\s+[A-Z]{2})?\s+\d{5}/i, weight: 10 },
  { name: 'about_page', re: /<a[^>]+href=["'][^"']*(?:about|company|story|who-we-are)/i, weight: 6 },
  { name: 'contact_page', re: /<a[^>]+href=["'][^"']*(?:contact|get-in-touch|book|schedule)/i, weight: 6 },
  { name: 'privacy_policy', re: /\bprivacy\s+(?:policy|notice)\b/i, weight: 4 },
  { name: 'terms_of_service', re: /\bterms\s+(?:of\s+(?:service|use)|&\s+conditions)\b/i, weight: 3 },
  { name: 'guarantee', re: /\b(?:100%\s+)?(?:satisfaction\s+)?guarantee[d]?|warrant(?:y|ies)|money[- ]back/i, weight: 8 },
  { name: 'insured_bonded', re: /\b(?:fully\s+)?insured(?:\s+and\s+bonded|\s+&\s+bonded)?|bonded\s+(?:and|&)\s+insured/i, weight: 6 }
];

const FRESHNESS_PATTERNS = [
  { name: 'updated_date', re: /\b(?:last\s+updated|updated|reviewed|posted)\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},?\s+(?:19|20)\d{2})/i, weight: 8 },
  { name: 'datetime_attr', re: /<(?:time|article)[^>]+datetime=["'](?:19|20)\d{2}[\-\/]\d{2}/i, weight: 6 },
  { name: 'current_year', re: null, score: (ctx) => ctx.text && new RegExp('\\b' + (new Date().getFullYear()) + '\\b').test(ctx.text) ? 4 : 0 },
  { name: 'last_year', re: null, score: (ctx) => ctx.text && new RegExp('\\b' + (new Date().getFullYear() - 1) + '\\b').test(ctx.text) ? 2 : 0 }
];

const ATTRIBUTION_PATTERNS = [
  { name: 'cites_sources', re: /\b(?:source[s]?:|citation[s]?:|reference[s]?:|according\s+to)\b/i, weight: 6 },
  { name: 'external_authority_links', re: /<a[^>]+href=["']https?:\/\/(?:www\.)?(?:gov|edu|epa\.gov|cdc\.gov|energy\.gov|nfpa\.org)/i, weight: 8 },
  { name: 'links_to_research', re: /<a[^>]+href=["'][^"']*(?:research|study|report|whitepaper|guide)/i, weight: 4 }
];

const IDENTITY_PATTERNS = [
  { name: 'owner_named_with_photo', re: /(?:owner|founder|president|ceo)[\s\S]{0,120}<img/i, weight: 8 },
  { name: 'business_legal_name', re: /\b(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Co\.?|Company|PLLC|P\.A\.|LLP)\b/, weight: 4 },
  // License number formats: License #, Lic. #, LIC#, Lic No., Reg #, MO License XXXXX, state-prefix patterns
  { name: 'license_number_shown', re: /\b(?:licen[sc]e|lic\.?|reg\.?|registration)\s*(?:no\.?|number|#|nbr\.?)?\s*[:\-]?\s*(?:[A-Z]{1,3}[\-\s]?)?[A-Z0-9\-]{4,15}\b/i, weight: 8 },
  { name: 'state_license_callout', re: /\b(?:MO|AR|KS|OK|TX|CA|FL|NY|MI|IL|OH|GA|NC|VA|WA|CO|AZ|TN|IN|MA|MD|MN|WI|NJ|PA|AL|LA|KY|OR|SC|UT|NV|NM|MS|IA|NE|ID|HI|AK|VT|NH|ME|RI|DE|MT|ND|SD|WV|WY|CT|DC)[- ]?(?:state[- ]?)?(?:license|licensed|certified|registered|permit)/i, weight: 6 },
  { name: 'ein_or_duns', re: /\b(?:EIN|D[\s\-]?U[\s\-]?N[\s\-]?S|tax\s+id)\s*[:\-]?\s*\d{2}[\s\-]?\d{4,}/i, weight: 4 }
];

function evalPatternBlock(text, html, patterns, ctx = {}) {
  let totalWeight = 0;
  let scored = 0;
  const hits = [];
  patterns.forEach(p => {
    totalWeight += (p.weight || 0);
    let matched = false;
    if (p.re) {
      const m = (p.re.test(html) || p.re.test(text));
      if (m) { matched = true; scored += (p.weight || 0); }
    }
    if (p.score) {
      const s = p.score({ text, html, ...ctx });
      if (s > 0) { matched = true; scored += s; totalWeight += s; }
    }
    if (matched) hits.push(p.name);
  });
  // Linear ratio undervalues rich pages that hit several strong signals but
  // miss long-tail patterns. Apply a saturating curve: ratio^0.7 lifts mid
  // range without inflating empty pages (0 stays 0).
  const ratio = totalWeight > 0 ? scored / totalWeight : 0;
  const score = Math.round(Math.pow(ratio, 0.7) * 100);
  return { score, hits, scored, totalWeight, missingPatterns: patterns.filter(p => !hits.includes(p.name)).map(p => p.name) };
}

/**
 * Top-level E-E-A-T audit.
 * Returns 8 dimension scores + overall score + fix list with evidence.
 */
function analyzeEeat({ html, visibleText, finalUrl, businessFacts = {} }) {
  const text = visibleText || stripHtmlToText(html || '');
  const safeHtml = html || '';
  const isHttps = /^https:\/\//i.test(finalUrl || '');

  const ctx = { text, html: safeHtml, isHttps };

  const trustPatterns = TRUST_PATTERNS.map(p => ({ ...p, score: p.name === 'https_present' ? () => isHttps ? 6 : 0 : p.score }));

  const dims = {
    experience: evalPatternBlock(text, safeHtml, EXPERIENCE_PATTERNS, ctx),
    expertise: evalPatternBlock(text, safeHtml, EXPERTISE_PATTERNS, ctx),
    authoritativeness: evalPatternBlock(text, safeHtml, AUTHORITY_PATTERNS, ctx),
    trust: evalPatternBlock(text, safeHtml, trustPatterns, ctx),
    freshness: evalPatternBlock(text, safeHtml, FRESHNESS_PATTERNS, ctx),
    attribution: evalPatternBlock(text, safeHtml, ATTRIBUTION_PATTERNS, ctx),
    identity: evalPatternBlock(text, safeHtml, IDENTITY_PATTERNS, ctx),
    contactAccessibility: scoreContactAccessibility(safeHtml, text)
  };

  // Weighted overall: trust + experience + expertise weight more for local services
  const overall = Math.round(
    (dims.trust.score * 0.22) +
    (dims.experience.score * 0.18) +
    (dims.expertise.score * 0.16) +
    (dims.authoritativeness.score * 0.14) +
    (dims.freshness.score * 0.10) +
    (dims.attribution.score * 0.06) +
    (dims.identity.score * 0.08) +
    (dims.contactAccessibility.score * 0.06)
  );

  const status = overall >= 75 ? 'pass' : overall >= 50 ? 'warn' : 'fail';

  const fixes = buildEeatFixes(dims, businessFacts);

  return {
    overallScore: overall,
    status,
    dimensions: dims,
    fixes,
    weights: {
      trust: 0.22, experience: 0.18, expertise: 0.16, authoritativeness: 0.14,
      freshness: 0.10, attribution: 0.06, identity: 0.08, contactAccessibility: 0.06
    },
    note: 'Per Google December 2025 quality update, E-E-A-T applies to all competitive queries, not just YMYL.'
  };
}

function scoreContactAccessibility(html, text) {
  const hits = [];
  let score = 0;
  if (/<a[^>]+href=["']tel:/i.test(html)) { score += 30; hits.push('tel_link'); }
  if (/<a[^>]+href=["']mailto:/i.test(html)) { score += 15; hits.push('mailto_link'); }
  if (/<form[\s\S]{0,500}contact|<form[\s\S]{0,500}quote|<form[\s\S]{0,500}estimate/i.test(html)) { score += 25; hits.push('contact_form'); }
  if (/(?:available\s+24\/?7|24\s+hours?\s+a\s+day|24\s*hr|emergency\s+service|same[- ]?day)/i.test(text)) { score += 15; hits.push('availability_advertised'); }
  if (/\b(?:chat|live\s+chat|message\s+us|text\s+us)\b/i.test(text)) { score += 10; hits.push('messaging_offered'); }
  if (/<a[^>]+href=["'][^"']*(?:book|schedule|appointment|calendar|calendly)/i.test(html)) { score += 10; hits.push('online_booking'); }
  return { score: Math.min(100, score), hits, missingPatterns: [] };
}

function buildEeatFixes(dims, facts) {
  const fixes = [];
  const biz = facts.businessName || 'your business';

  if (dims.trust.score < 60) {
    if (!dims.trust.hits.includes('phone_visible')) {
      const rawPhone = facts.phone != null ? String(facts.phone).trim() : '';
      const hasPhone = Boolean(rawPhone);
      fixes.push({
        key: 'eeat-trust-add-phone',
        severity: 'high',
        title: 'Display a clickable phone number prominently',
        detail: hasPhone
          ? 'Visitors who can\u2019t see a phone number above the fold often leave. Wrap the number in <a href="tel:..."> so mobile callers tap once.'
          : 'Visitors who can\u2019t see a phone number above the fold often leave. Wrap your real business number in <a href="tel:..."> so mobile callers tap once. Replace YOUR_PHONE_NUMBER placeholders in the snippet with your actual digits before publishing.',
        copyPasteReady: hasPhone,
        snippet: hasPhone
          ? `<a href="tel:+1${rawPhone.replace(/\D/g, '')}" class="phone-cta">Call ${rawPhone}</a>`
          : '<a href="tel:+1YOUR_PHONE_NUMBER" class="phone-cta">Call YOUR_PHONE_NUMBER</a>',
        effortMinutes: 5
      });
    }
    if (!dims.trust.hits.includes('physical_address')) {
      fixes.push({
        key: 'eeat-trust-add-address',
        severity: 'high',
        title: 'Display your physical service address in the footer',
        detail: 'Local businesses without a visible address appear less trustworthy to both visitors and Google\u2019s local-pack algorithm.',
        copyPasteReady: false,
        effortMinutes: 5
      });
    }
    if (!dims.trust.hits.includes('insured_bonded')) {
      fixes.push({
        key: 'eeat-trust-insured-line',
        severity: 'medium',
        title: 'Mention licensing + insurance in a trust strip',
        detail: 'Single-line trust strip near the hero or footer: "Licensed, bonded, insured \u2014 serving X since YYYY." Drives both conversion and AI-citation eligibility.',
        copyPasteReady: false,
        effortMinutes: 10
      });
    }
  }

  if (dims.experience.score < 50) {
    fixes.push({
      key: 'eeat-experience-add-years',
      severity: 'medium',
      title: 'Add a stat strip with your real years-in-business and project counts',
      detail: 'Three-stat strip near the hero with YOUR real numbers (e.g., years serving the area, total jobs completed, review count). This delivers Experience signals that Google E-E-A-T and AI citation engines explicitly weight. Use only numbers you can prove — vague claims hurt trust.',
      copyPasteReady: false,
      pattern: '<div class="trust-strip"><span>[X] years serving [city]</span><span>[Y]+ jobs completed</span><span>[Z] [average rating] across [count] reviews</span></div>',
      effortMinutes: 15
    });
  }

  if (dims.expertise.score < 50) {
    fixes.push({
      key: 'eeat-expertise-credentials',
      severity: 'medium',
      title: 'List specific certifications and licenses',
      detail: 'Replace generic "licensed and certified" with actual credentials (NATE, EPA RRP, MO License #XXXX). Specific certs are heavily weighted by both Google E-E-A-T and AI citation engines.',
      copyPasteReady: false,
      effortMinutes: 15
    });
  }

  if (dims.authoritativeness.score < 40) {
    fixes.push({
      key: 'eeat-authority-press',
      severity: 'low',
      title: 'Add an "as seen in / press" or community-affiliations strip',
      detail: 'Local media mentions, BBB accreditation, Chamber membership, or "Best of [City]" badges materially lift authority signals.',
      copyPasteReady: false,
      effortMinutes: 20
    });
  }

  if (dims.freshness.score < 30) {
    fixes.push({
      key: 'eeat-freshness-add-date',
      severity: 'low',
      title: 'Add a visible "last updated" date',
      detail: `Add "Last updated [Month YYYY]" to service pages. Fresh dates feed Google\u2019s freshness signal and reassure visitors that ${biz}\u2019s site reflects current operations.`,
      copyPasteReady: false,
      effortMinutes: 10
    });
  }

  if (dims.contactAccessibility.score < 50) {
    fixes.push({
      key: 'eeat-contact-tel-link',
      severity: 'high',
      title: 'Use real <a href="tel:"> links on every page',
      detail: 'A naked phone number (e.g., 417-555-0100) is not tappable on mobile. Wrapping in tel: link materially lifts call-conversion and accessibility scores.',
      copyPasteReady: true,
      snippet: `<a href="tel:+1${(facts.phone || '4175550100').replace(/\D/g, '')}">${facts.phone || '(417) 555-0100'}</a>`,
      effortMinutes: 5
    });
  }

  return fixes;
}

/**
 * Strip HTML tags and decode common entities to recover visible text.
 * Lightweight — does not handle all edge cases but good enough for pattern matching.
 */
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
  stripHtmlToText,
  EXPERIENCE_PATTERNS,
  EXPERTISE_PATTERNS,
  AUTHORITY_PATTERNS,
  TRUST_PATTERNS,
  FRESHNESS_PATTERNS,
  ATTRIBUTION_PATTERNS,
  IDENTITY_PATTERNS
};
