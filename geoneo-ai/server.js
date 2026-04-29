require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const {
  runLocalSearchVisibilityAudit,
  filterLocalSearchVisibilityByPackage
} = require('./services/localSearchVisibility');
const { createSerpProvider, extractRootDomain } = require('./services/serpProvider');

const PORT = process.env.PORT || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const PAGESPEED_CACHE_TTL_MS = 10 * 60 * 1000;
const PAGESPEED_TIMEOUT_MS = 20000;
const COMPETITOR_FETCH_TIMEOUT_MS = 6000;
const PAGESPEED_429_MESSAGE = 'Google snapshot temporarily unavailable due to API rate limits. Core audit results are still valid.';
const PAGESPEED_400_MESSAGE = 'Google snapshot unavailable for this URL right now. Core audit results are still valid.';
const PAGESPEED_TIMEOUT_MESSAGE = 'Google snapshot timed out. Core audit results are still valid.';
const PAGESPEED_DNS_MESSAGE = 'Google snapshot failed due to DNS lookup issues for this URL. Core audit results are still valid.';
const PAGESPEED_TLS_MESSAGE = 'Google snapshot could not verify TLS for this URL. Core audit results are still valid.';
const PAGESPEED_CONNECTION_MESSAGE = 'Google snapshot could not connect to this URL. Core audit results are still valid.';
const PAGESPEED_GENERIC_MESSAGE = 'Google snapshot is temporarily unavailable. Core audit results are still valid.';
const pageSpeedCache = new Map();
const FETCH_TLS_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
]);
const PACKAGE_PRICES = {
  free: 0,
  silver: 199,
  gold: 399,
  admin: 0
};
const NEO_CLUB_PREVIEW_BENEFITS = [
  'Stay ahead of your competitors with weekly strategy drops.',
  'Keep your visibility growing with short, execution-ready playbooks.',
  'Know what to do before others do with tactical market alerts.'
];
const NEO_CLUB_CONTENT = {
  updatedAt: '2026-04-10',
  contentVersion: 1,
  futureModel: {
    supportsSubscriptions: true,
    supportsAdditionalContentTypes: true,
    supportsRollingUpdates: true
  },
  neoClub: {
    weeklyStrategies: [
      {
        id: 'ws-2026-15',
        title: 'City + Service Page Momentum Loop',
        summary: 'Refresh city pages with proof blocks and answer snippets to win both local and AI visibility.',
        actionablePoints: [
          'Update the top three service pages with one city-specific proof paragraph each.',
          'Add one FAQ answer block per page for high-intent buyer questions.',
          'Align page title and H1 with service + city phrasing.',
          'Re-check rankings and AI citations within 7 days.'
        ]
      },
      {
        id: 'ws-2026-14',
        title: 'Review Velocity Recovery Sprint',
        summary: 'Increase recent review count without asking for long-form responses.',
        actionablePoints: [
          'Send a two-sentence review request after each completed job.',
          'Reply to every new review within 24 hours with service keywords naturally included.',
          'Highlight three new reviews on service pages this week.'
        ]
      }
    ],
    expertTopics: [
      {
        id: 'local-seo',
        category: 'Local SEO',
        guides: [
          {
            title: 'Service + City Cluster',
            summary: 'Build one parent service page and supporting city pages with clear internal linking.',
            actions: [
              'Pick one primary service and 3 nearby cities.',
              'Create internal links both ways between parent and city pages.',
              'Add local proof on every city page.'
            ]
          }
        ]
      },
      {
        id: 'gbp',
        category: 'Google Business Profile',
        guides: [
          {
            title: 'GBP Post Rhythm',
            summary: 'Publish short weekly posts that mirror high-intent services and markets.',
            actions: [
              'Publish one offer or project update every 7 days.',
              'Use service + city wording in the first sentence.',
              'Match post message with landing page CTA.'
            ]
          }
        ]
      },
      {
        id: 'ai-visibility',
        category: 'AI Search Visibility',
        guides: [
          {
            title: 'Citation-Ready Answers',
            summary: 'Ship concise answer blocks that are easy for AI systems to quote.',
            actions: [
              'Add direct Q&A sections to key service pages.',
              'Keep answers factual, short, and specific.',
              'Reference verifiable outcomes or policies.'
            ]
          }
        ]
      },
      {
        id: 'reviews-reputation',
        category: 'Reviews and Reputation',
        guides: [
          {
            title: 'Response Framework',
            summary: 'Use a repeatable response style that reinforces trust and relevance.',
            actions: [
              'Thank + restate service delivered.',
              'Mention location naturally once.',
              'Invite next-step action for readers.'
            ]
          }
        ]
      },
      {
        id: 'conversion-optimization',
        category: 'Conversion Optimization',
        guides: [
          {
            title: 'Trust Block Upgrade',
            summary: 'Turn traffic into leads with stronger proof and clearer next steps.',
            actions: [
              'Place testimonials above the fold on top pages.',
              'Add one clear CTA per section.',
              'Reduce form fields on primary conversion path.'
            ]
          }
        ]
      },
      {
        id: 'competitor-strategies',
        category: 'Competitor Strategies',
        guides: [
          {
            title: 'Gap Clone + Improve',
            summary: 'Reverse-engineer competitor winning pages and produce a stronger version.',
            actions: [
              'List top three competitor pages for one target query.',
              'Map missing sections and trust assets in your page.',
              'Publish an improved page with clearer proof and structure.'
            ]
          }
        ]
      }
    ],
    podcastEpisodes: [
      {
        id: 'nvb-021',
        title: 'Neo Visibility Brief: Beat Fast-Moving Local Competitors',
        description: 'A short tactical breakdown of weekly moves that protect rankings and improve lead quality.',
        duration: '14 min',
        audioUrl: '',
        isPlaceholder: true
      },
      {
        id: 'nvb-020',
        title: 'Neo Visibility Brief: AI Citation Signals That Matter',
        description: 'How to make your pages easier to cite in AI search answers.',
        duration: '12 min',
        audioUrl: '',
        isPlaceholder: true
      }
    ],
    knowledgeBase: [
      {
        id: 'kb-local-proof',
        category: 'Local SEO',
        title: 'Local Proof Blocks That Lift Trust',
        summary: 'Add concrete local evidence blocks to improve both confidence and rankings.'
      },
      {
        id: 'kb-gbp-photo-plan',
        category: 'Google Business Profile',
        title: 'GBP Photo Cadence Checklist',
        summary: 'A weekly image update process that keeps your profile active and credible.'
      },
      {
        id: 'kb-ai-faq',
        category: 'AI Search Visibility',
        title: 'FAQ Formatting for AI Discovery',
        summary: 'Structure FAQ content to be easier for AI systems to interpret and cite.'
      },
      {
        id: 'kb-review-velocity',
        category: 'Reviews and Reputation',
        title: 'Review Velocity Playbook',
        summary: 'Create a steady review flow without adding operational friction.'
      },
      {
        id: 'kb-cro-layout',
        category: 'Conversion Optimization',
        title: 'High-Converting Service Page Layout',
        summary: 'A simple section order that increases clarity and conversion intent.'
      },
      {
        id: 'kb-competitor-map',
        category: 'Competitor Strategies',
        title: 'Competitor Visibility Mapping',
        summary: 'Track who appears before you and what they are doing differently.'
      }
    ]
  }
};
const QUICK_WIN_IMPACT = {
  h1: 2,
  'meta-description': 2,
  canonical: 1,
  'robots-meta': 1,
  'og-tags': 2,
  'structured-data': 2,
  'image-alt': 1,
  sitemap: 2,
  'robots-txt': 1,
  'faq-citation': 2,
  grammar: 2
};
const SERVICE_KEYWORD_PATTERNS = [
  'roofing',
  'roof repair',
  'plumber',
  'plumbing',
  'hvac',
  'heating',
  'cooling',
  'electrician',
  'electrical',
  'dental',
  'dentist',
  'legal',
  'law firm',
  'attorney',
  'landscaping',
  'tree service',
  'painting',
  'construction',
  'remodel',
  'contractor',
  'garage door',
  'pest control',
  'cleaning',
  'restoration',
  'home services',
  'marketing',
  'seo',
  'ai search',
  'local seo'
];
const US_STATE_CODES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';
const ISSUE_SOLUTION_LIBRARY = {
  title: {
    title: 'Improve title structure',
    solution: 'Rewrite the title to reflect service intent and target market in 20-60 characters.',
    steps: [
      'Write one primary keyword + service + location title draft.',
      'Keep title length between 20 and 60 characters.',
      'Deploy and re-run the audit to confirm this issue clears.'
    ]
  },
  'meta-description': {
    title: 'Refine meta description',
    solution: 'Add a benefit-driven meta description with local intent and a call to action.',
    steps: [
      'Write one 120-160 character summary with service + city context.',
      'Include a clear action phrase (call, book, request quote).',
      'Publish and check snippet quality in SERP preview.'
    ]
  },
  h1: {
    title: 'Use one clear H1',
    solution: 'Keep exactly one H1 that mirrors your core service intent.',
    steps: [
      'Remove duplicate H1 tags from template blocks.',
      'Set one page-level H1 aligned with title and primary service.',
      'Validate H1 count after deployment.'
    ]
  },
  canonical: {
    title: 'Add canonical signal',
    solution: 'Set a canonical URL to avoid duplicate indexing conflicts.',
    steps: [
      'Determine the preferred canonical URL for the page.',
      'Add the canonical link element in page head.',
      'Verify canonical renders in page source.'
    ]
  },
  'robots-meta': {
    title: 'Set robots meta directives',
    solution: 'Add a valid robots meta tag so crawl/index intent is explicit.',
    steps: [
      'Add robots meta to page head.',
      'Confirm it does not block intended indexing.',
      'Re-crawl and verify index eligibility.'
    ]
  },
  'og-tags': {
    title: 'Complete Open Graph tags',
    solution: 'Add og:title and og:description for stronger cross-channel previews and trust.',
    steps: [
      'Set og:title aligned with page intent.',
      'Set og:description aligned with value proposition.',
      'Validate OG output in page source.'
    ]
  },
  'structured-data': {
    title: 'Implement structured data',
    solution: 'Add JSON-LD schema for organization/service/FAQ signals.',
    steps: [
      'Choose applicable schema types for the page.',
      'Publish JSON-LD in page head/body.',
      'Validate schema syntax and entity fields.'
    ]
  },
  'image-alt': {
    title: 'Fix image alt coverage',
    solution: 'Add descriptive alt text for images to improve accessibility and relevance signals.',
    steps: [
      'List images missing alt attributes.',
      'Add concise descriptive alt text where needed.',
      'Re-audit to confirm zero missing-alt images.'
    ]
  },
  sitemap: {
    title: 'Publish sitemap.xml',
    solution: 'Generate and serve a current sitemap.xml for crawl coverage.',
    steps: [
      'Generate sitemap with current canonical URLs.',
      'Expose sitemap.xml at site root.',
      'Submit sitemap in search console tooling.'
    ]
  },
  'robots-txt': {
    title: 'Publish robots.txt',
    solution: 'Provide robots.txt to define crawl rules and sitemap location.',
    steps: [
      'Create robots.txt at site root.',
      'Allow critical sections and disallow irrelevant paths.',
      'Add sitemap reference line.'
    ]
  },
  'local-geo': {
    title: 'Strengthen local GEO signals',
    solution: 'Add location evidence (city/state/address/service area) throughout key pages.',
    steps: [
      'Add city/state + service area references to core pages.',
      'Include address/contact consistency blocks.',
      'Align GBP and site location wording.'
    ]
  },
  'thin-content': {
    title: 'Increase page depth',
    solution: 'Expand thin pages with intent-matched service detail and trust proof.',
    steps: [
      'Add service scope, process, and FAQ detail.',
      'Add proof elements (reviews, outcomes, guarantees).',
      'Ensure page depth exceeds thin-content threshold.'
    ]
  },
  'paragraph-depth': {
    title: 'Improve paragraph clarity',
    solution: 'Increase paragraph depth to communicate expertise and conversion value.',
    steps: [
      'Expand short blocks into complete explanatory paragraphs.',
      'Add examples, outcomes, and trust evidence.',
      'Review average paragraph word depth.'
    ]
  },
  'repetitive-content': {
    title: 'Reduce repetitive language',
    solution: 'Rewrite repeated copy to improve quality perception and semantic variety.',
    steps: [
      'Identify repeated phrases across key sections.',
      'Rewrite with varied, specific wording.',
      'Re-check content quality in next audit.'
    ]
  },
  'trust-signals': {
    title: 'Add trust conversion signals',
    solution: 'Increase visible proof of credibility to improve conversion confidence.',
    steps: [
      'Add testimonials, guarantees, and clear contact anchors.',
      'Add team/company credibility and policy links.',
      'Improve visual hierarchy for trust blocks.'
    ]
  },
  'faq-citation': {
    title: 'Add citation-ready FAQ blocks',
    solution: 'Create direct Q&A blocks that AI systems can quote and users can scan.',
    steps: [
      'Add high-intent FAQ questions with direct answers.',
      'Place FAQ near service decision sections.',
      'Add FAQ schema where applicable.'
    ]
  },
  grammar: {
    title: 'Fix grammar and clarity',
    solution: 'Correct grammar and tighten language for trust and professionalism.',
    steps: [
      'Correct flagged grammar issues in primary pages.',
      'Simplify long or unclear sentences.',
      'Run language checks before publish.'
    ]
  },
  'google-seo': {
    title: 'Improve Google audit grade',
    solution: 'Address technical and on-page items impacting the Google snapshot score.',
    steps: [
      'Prioritize technical blockers from this audit.',
      'Deploy performance and metadata fixes.',
      'Re-run PageSpeed and compare score delta.'
    ]
  }
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function safeUrl(input) {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed.');
  }
  return parsed;
}

function textBetween(text, startPattern, endPattern) {
  const start = text.search(startPattern);
  if (start === -1) {
    return '';
  }
  const slice = text.slice(start);
  const end = slice.search(endPattern);
  if (end === -1) {
    return '';
  }
  return slice.slice(0, end);
}

function detectStatus(ok, goodMessage, badMessage) {
  return {
    status: ok ? 'PASS' : 'FIX',
    message: ok ? goodMessage : badMessage
  };
}

function buildCheck(key, ok, goodMessage, badMessage) {
  return {
    key,
    status: ok ? 'PASS' : 'FIX',
    message: ok ? goodMessage : badMessage
  };
}

function normalizeString(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeBool(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function normalizeCompetitorInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean).slice(0, 3);
  }
  return String(value || '')
    .split(/\r?\n|,/)
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .slice(0, 3);
}

function normalizePackageLevel(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return 'free';
  }
  if (normalized === 'audit') {
    return 'free';
  }
  if (normalized === 'internal') {
    return 'admin';
  }
  if (normalized === 'free' || normalized === 'silver' || normalized === 'gold' || normalized === 'admin') {
    return normalized;
  }
  return 'free';
}

function normalizeAuditMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'competitor-example' || normalized === 'competitor_example' || normalized === 'competitor') {
    return 'competitor-example';
  }
  return 'business';
}

function resolveAmountPaid(amountPaidInput, purchasedPackage) {
  if (amountPaidInput === null || amountPaidInput === undefined || String(amountPaidInput).trim() === '') {
    return PACKAGE_PRICES[purchasedPackage] || 0;
  }
  const numeric = Number(amountPaidInput);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.round(numeric * 100) / 100;
  }
  return PACKAGE_PRICES[purchasedPackage] || 0;
}

function buildUpgradeCreditAvailable(purchasedPackage, amountPaid) {
  if (purchasedPackage === 'silver') {
    return {
      towardPackage: 'gold',
      amount: amountPaid
    };
  }
  if (purchasedPackage === 'gold') {
    return {
      towardPackage: 'platinum',
      amount: amountPaid
    };
  }
  return {
    towardPackage: null,
    amount: 0
  };
}

function buildReportLinks(auditId) {
  const safeId = normalizeString(auditId);
  return {
    reportPath: `/api/audit-report?id=${encodeURIComponent(safeId)}`,
    downloadPath: `/api/audit-report/download?id=${encodeURIComponent(safeId)}`
  };
}

function isNeoClubMember(packageLevel) {
  const normalized = normalizePackageLevel(packageLevel);
  return normalized === 'gold' || normalized === 'admin';
}

function buildNeoClubPayload({ packageLevel, auditId = '', source = 'session' }) {
  const normalizedLevel = normalizePackageLevel(packageLevel);
  const member = isNeoClubMember(normalizedLevel);
  const full = NEO_CLUB_CONTENT.neoClub;
  const preview = {
    weeklyStrategies: full.weeklyStrategies.slice(0, 1).map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      actionablePoints: item.actionablePoints.slice(0, 1)
    })),
    expertTopics: full.expertTopics.map((topic) => ({
      id: topic.id,
      category: topic.category,
      guides: topic.guides.slice(0, 1).map((guide) => ({
        title: guide.title,
        summary: guide.summary,
        actions: guide.actions.slice(0, 1)
      }))
    })),
    podcastEpisodes: full.podcastEpisodes.slice(0, 1),
    knowledgeBase: full.knowledgeBase.slice(0, 3)
  };

  return {
    clubName: 'Neo Club',
    membership: {
      requiredPackage: 'gold',
      packageLevel: normalizedLevel,
      isMember: member,
      source,
      auditId: normalizeString(auditId) || null
    },
    messaging: {
      headline: 'Stay ahead of your competitors',
      secondary: 'Keep your visibility growing',
      tertiary: 'Know what to do before others do'
    },
    lockedPreview: {
      title: 'Unlock Neo Club',
      benefits: NEO_CLUB_PREVIEW_BENEFITS,
      ctaLabel: 'Upgrade to Gold ($199)',
      ctaHref: '/#purchase'
    },
    contentModel: {
      updatedAt: NEO_CLUB_CONTENT.updatedAt,
      contentVersion: NEO_CLUB_CONTENT.contentVersion,
      futureModel: NEO_CLUB_CONTENT.futureModel
    },
    neoClub: member ? full : preview
  };
}

function inferBusinessName({ explicitName, h1, title, hostname }) {
  const normalizedExplicit = normalizeString(explicitName);
  if (normalizedExplicit) {
    return normalizedExplicit;
  }

  const normalizedH1 = normalizeString(h1);
  if (normalizedH1) {
    return normalizedH1.slice(0, 90);
  }

  const normalizedTitle = normalizeString(title);
  if (normalizedTitle) {
    const candidate = normalizedTitle.split(/[\-|:|•]/)[0];
    if (normalizeString(candidate)) {
      return normalizeString(candidate).slice(0, 90);
    }
  }

  const domain = normalizeString(hostname).replace(/^www\./i, '');
  if (!domain) {
    return '';
  }
  const label = domain.split('.')[0].replace(/[-_]+/g, ' ');
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .slice(0, 90);
}

function extractVisibleServiceKeywords({ visibleText, title, h1 }) {
  const pool = normalizeLabel(`${visibleText || ''} ${title || ''} ${h1 || ''}`);
  if (!pool) {
    return [];
  }

  return SERVICE_KEYWORD_PATTERNS
    .filter((term) => pool.includes(normalizeLabel(term)))
    .slice(0, 12);
}

function extractLocationMentions({ visibleText, market }) {
  const mentions = new Set();
  const text = String(visibleText || '');
  const cityStateRegex = new RegExp(`\\b([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,2}),\\s*(${US_STATE_CODES})\\b`, 'g');
  let match = cityStateRegex.exec(text);
  while (match) {
    mentions.add(`${match[1]}, ${match[2]}`);
    match = cityStateRegex.exec(text);
  }

  const zipMatches = text.match(/\b\d{5}(?:-\d{4})?\b/g) || [];
  zipMatches.slice(0, 4).forEach((zip) => mentions.add(zip));

  const normalizedMarket = normalizeString(market);
  if (normalizedMarket) {
    mentions.add(normalizedMarket);
  }
  return Array.from(mentions).slice(0, 8);
}

function detectContactSignals({ html, visibleText }) {
  const sourceHtml = String(html || '');
  const sourceText = String(visibleText || '');
  const phone = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/.test(sourceText);
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(sourceText);
  const address = /\b\d{1,5}\s+[A-Za-z0-9.\s]+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|suite|ste)\b/i.test(sourceText);
  const contactPageLink = /<a\b[^>]*href=["'][^"']*contact[^"']*["']/i.test(sourceHtml);
  const hasForm = /<form\b/i.test(sourceHtml);

  return {
    phone,
    email,
    address,
    contactPageLink,
    hasForm
  };
}

function extractInternalLinks({ html, finalUrl }) {
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  const sample = [];
  const seen = new Set();
  let count = 0;
  let match = anchorRegex.exec(String(html || ''));
  while (match) {
    const href = normalizeString(match[1]);
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      match = anchorRegex.exec(String(html || ''));
      continue;
    }
    try {
      const resolved = new URL(href, finalUrl);
      const target = new URL(finalUrl);
      if (resolved.origin === target.origin) {
        count += 1;
        const sampleValue = `${resolved.pathname}${resolved.search || ''}`;
        if (sample.length < 8 && !seen.has(sampleValue)) {
          seen.add(sampleValue);
          sample.push(sampleValue);
        }
      }
    } catch {
      // ignore malformed links
    }
    match = anchorRegex.exec(String(html || ''));
  }
  return { count, sample };
}

function countQuickWins(checks) {
  if (!Array.isArray(checks)) {
    return 0;
  }
  return checks.filter((check) => (
    check
    && check.status === 'FIX'
    && Object.prototype.hasOwnProperty.call(QUICK_WIN_IMPACT, check.key)
  )).length;
}

function estimateShortTermLift(checks) {
  if (!Array.isArray(checks)) {
    return { min: 0, max: 0 };
  }

  const potential = checks.reduce((total, check) => {
    if (!check || check.status !== 'FIX') {
      return total;
    }
    return total + (QUICK_WIN_IMPACT[check.key] || 0);
  }, 0);

  if (potential <= 0) {
    return { min: 0, max: 0 };
  }

  return {
    min: Math.max(1, Math.round(potential * 0.5)),
    max: Math.max(1, Math.round(potential))
  };
}

function buildIssueSolutions(checks) {
  if (!Array.isArray(checks)) {
    return [];
  }
  return checks
    .filter((check) => check && check.status === 'FIX')
    .map((check) => {
      const template = ISSUE_SOLUTION_LIBRARY[check.key] || {
        title: 'Resolve audit finding',
        solution: 'Address the identified issue and re-audit to confirm improvement.',
        steps: [
          'Review the failing condition.',
          'Implement a direct fix in page/template logic.',
          'Re-run the audit and validate score movement.'
        ]
      };
      return {
        key: check.key,
        issue: check.message,
        solutionTitle: template.title,
        solution: template.solution,
        steps: template.steps
      };
    });
}

function buildImplementationRoadmap(issueSolutions) {
  if (!Array.isArray(issueSolutions) || issueSolutions.length === 0) {
    return [];
  }

  return issueSolutions.slice(0, 8).map((item, index) => ({
    step: index + 1,
    phase: index < 3 ? 'Day 1-2' : (index < 6 ? 'Week 1' : 'Week 2'),
    title: item.solutionTitle,
    action: item.solution,
    checklist: item.steps
  }));
}

function buildPrioritizedActionPlan(issueSolutions) {
  if (!Array.isArray(issueSolutions) || issueSolutions.length === 0) {
    return [];
  }
  return issueSolutions.slice(0, 5).map((item, index) => ({
    priority: index + 1,
    key: item.key,
    action: item.solutionTitle,
    outcome: item.solution
  }));
}

function normalizeQueryType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'market' ? 'market' : 'website';
}

function normalizeDashboardPackage(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'score_only' || normalized === 'score-only' || normalized === 'free') return 'score_only';
  if (normalized === 'scores_issues' || normalized === 'scores+issues' || normalized === 'silver') return 'scores_issues';
  if (normalized === 'full_data' || normalized === 'full-data' || normalized === 'gold' || normalized === 'admin') return 'full_data';
  return 'full_data';
}

function seededInt(seedInput, min, max) {
  const seed = normalizeString(seedInput || 'seed');
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  const range = Math.max(1, (max - min + 1));
  const val = Math.abs(hash) % range;
  return min + val;
}

function toCategoryFromCheckKey(key) {
  const normalized = normalizeString(key).toLowerCase();
  if (['title', 'meta-description', 'og-tags', 'google-seo'].includes(normalized)) return 'seo';
  if (['h1', 'canonical', 'robots-meta', 'structured-data', 'sitemap', 'robots-txt', 'image-alt'].includes(normalized)) return 'technical';
  if (['faq-citation'].includes(normalized)) return 'aiVisibility';
  if (['local-geo'].includes(normalized)) return 'localPresence';
  if (['trust-signals', 'grammar'].includes(normalized)) return 'reputation';
  if (['thin-content', 'paragraph-depth', 'repetitive-content'].includes(normalized)) return 'conversionUx';
  return 'technical';
}

function severityFromMessage(message) {
  const text = normalizeString(message).toLowerCase();
  if (text.includes('missing') || text.includes('not visible') || text.includes('thin') || text.includes('low')) {
    return 'high';
  }
  if (text.includes('should') || text.includes('improve') || text.includes('add')) {
    return 'medium';
  }
  return 'low';
}

function mapSummaryScoresFromAudit(result) {
  const checks = Array.isArray(result && result.checks) ? result.checks : [];
  const technicalChecks = checks.filter((item) => toCategoryFromCheckKey(item.key) === 'technical');
  const techFixes = technicalChecks.filter((item) => item.status === 'FIX').length;
  const techScore = technicalChecks.length
    ? Math.max(0, Math.round(((technicalChecks.length - techFixes) / technicalChecks.length) * 100))
    : Number(result && result.scores && result.scores.seo) || 0;
  const trustLevel = normalizeString(result && result.trustDesign && result.trustDesign.level).toLowerCase();
  const reputationScore = trustLevel === 'strong' ? 84 : (trustLevel === 'moderate' ? 64 : 42);
  const conversionBase = Number(result && result.scores && result.scores.overall) || 0;
  const conversionPenalty = checks.filter((item) => ['thin-content', 'paragraph-depth', 'repetitive-content'].includes(item.key) && item.status === 'FIX').length * 8;
  const localVisibilityScore = Number(result?.localSearchVisibility?.summary?.visibilityScore);
  const localPresenceScore = Number.isFinite(localVisibilityScore)
    ? Math.max(0, Math.round((Number(result?.scores?.geo) + localVisibilityScore) / 2))
    : Number(result?.scores?.geo) || 0;
  return {
    seo: Number(result?.scores?.seo) || 0,
    technical: techScore,
    aiVisibility: Number(result?.scores?.ai) || 0,
    localPresence: localPresenceScore,
    reputation: reputationScore,
    conversionUx: Math.max(0, Math.min(100, conversionBase - conversionPenalty))
  };
}

function buildIssuesFromAudit(result) {
  const checks = Array.isArray(result && result.checks) ? result.checks : [];
  return checks
    .filter((check) => check && check.status === 'FIX')
    .map((check) => ({
      category: toCategoryFromCheckKey(check.key),
      title: normalizeString(check.key).replace(/-/g, ' ') || 'issue',
      severity: severityFromMessage(check.message),
      description: normalizeString(check.message)
    }));
}

function buildFixesFromAudit(result) {
  const solutions = Array.isArray(result && result.issueSolutions) ? result.issueSolutions : [];
  if (solutions.length) {
    return solutions.map((item) => ({
      category: toCategoryFromCheckKey(item.key),
      title: normalizeString(item.solutionTitle) || 'Recommended fix',
      description: normalizeString(item.solution || item.issue),
      priority: severityFromMessage(item.issue || item.solution || '')
    }));
  }
  const topFixes = Array.isArray(result && result.topFixes) ? result.topFixes : [];
  return topFixes.map((text, index) => ({
    category: 'technical',
    title: `Fix ${index + 1}`,
    description: normalizeString(text),
    priority: index < 2 ? 'high' : 'medium'
  }));
}

function summarizeCompetitorScores(domainSeed) {
  return {
    seo: seededInt(`${domainSeed}:seo`, 45, 92),
    authority: seededInt(`${domainSeed}:authority`, 40, 90),
    local: seededInt(`${domainSeed}:local`, 50, 96)
  };
}

function buildCompetitorsFromAudit(result, input) {
  const market = normalizeString(input.market || [input.city, input.state].filter(Boolean).join(', '));
  const searchCompetitors = Array.isArray(result?.searchSnapshot?.competitors) ? result.searchSnapshot.competitors : [];
  const recurring = Array.isArray(result?.localSearchVisibility?.topRecurringCompetitors)
    ? result.localSearchVisibility.topRecurringCompetitors
    : [];
  const map = new Map();
  searchCompetitors.forEach((entry) => {
    const domain = extractRootDomain(entry.url || entry.name || '') || normalizeString(entry.name).toLowerCase().replace(/\s+/g, '-');
    if (!domain || map.has(domain)) return;
    map.set(domain, {
      name: normalizeString(entry.name) || domain,
      website: normalizeString(entry.url) || `https://${domain}`,
      city: market || normalizeString(input.city) || 'Unknown',
      category: normalizeString(input.industry) || 'Local Service',
      notes: 'Derived from website audit competitor snapshot.',
      strengths: ['High visibility for target query', 'Stronger SERP position'],
      weaknesses: ['Unknown conversion quality'],
      scoreSummary: summarizeCompetitorScores(domain),
      source: 'audit_snapshot'
    });
  });
  recurring.forEach((entry) => {
    const domain = extractRootDomain(entry.domain || '');
    if (!domain || map.has(domain)) return;
    map.set(domain, {
      name: domain,
      website: `https://${domain}`,
      city: market || normalizeString(input.city) || 'Unknown',
      category: normalizeString(input.industry) || 'Local Service',
      notes: `Recurring in ${entry.count || 0} sampled searches.`,
      strengths: ['Appears repeatedly in local searches'],
      weaknesses: ['No on-site quality detail captured'],
      scoreSummary: summarizeCompetitorScores(domain),
      source: 'local_visibility'
    });
  });
  return Array.from(map.values()).slice(0, 10);
}

function createSampleMarketCompetitors(input) {
  const industry = normalizeString(input.industry) || 'local service';
  const city = normalizeString(input.city) || 'Target City';
  const state = normalizeString(input.state) || 'State';
  const base = [
    `${city} ${industry} pros`,
    `${city} elite ${industry}`,
    `${city} rapid ${industry}`,
    `${city} trusted ${industry}`,
    `${city} prime ${industry}`
  ];
  return base.map((name, index) => {
    const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
      website: `https://${safe}.example.com`,
      city: `${city}, ${state}`,
      category: industry,
      notes: 'Sample/dev fallback competitor.',
      strengths: ['Consistent local naming', 'Strong service keyword coverage'],
      weaknesses: ['Limited trust proof detail'],
      scoreSummary: summarizeCompetitorScores(`${safe}:${index}`),
      source: 'sample_fallback'
    };
  });
}

function strengthLabelFromScore(score) {
  if (score >= 76) return 'High';
  if (score >= 52) return 'Medium';
  return 'Low';
}

function normalizeDifficultyLevel(score) {
  if (score <= 4) return 'easy';
  if (score <= 7) return 'moderate';
  return 'hard';
}

function sanitizeAreaLabel(value) {
  return normalizeString(value)
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createAreaLabel({ city, state, zip, area }) {
  const explicitArea = sanitizeAreaLabel(area);
  if (explicitArea) {
    return explicitArea;
  }
  return sanitizeAreaLabel([city, state, zip].filter(Boolean).join(' '));
}

function normalizeIndustrySeed(value) {
  return normalizeString(value)
    .replace(/[|/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferIndustryIntentTerms(industry) {
  const normalized = normalizeIndustrySeed(industry).toLowerCase();
  const terms = [];

  if (/tow|roadside/.test(normalized)) {
    terms.push('tow truck', 'towing company', '24 hour towing', 'roadside assistance', 'car lockout', 'flat tire help', 'emergency towing', 'best towing');
  } else if (/locksmith|lock out|lockout/.test(normalized)) {
    terms.push('locksmith', 'emergency locksmith', 'car lockout', '24 hour locksmith', 'mobile locksmith', 'locksmith service', 'best locksmith');
  } else if (/tree/.test(normalized)) {
    terms.push('tree service', 'tree removal', 'stump grinding', 'emergency tree service', 'tree trimming', 'best tree service');
  } else if (/roof/.test(normalized)) {
    terms.push('roof repair', 'roofing company', 'emergency roofing', 'roof replacement', 'best roofer');
  } else if (/plumb/.test(normalized)) {
    terms.push('plumber', 'emergency plumber', 'drain cleaning', 'water heater repair', 'best plumber');
  } else if (/hvac|air conditioning|heating|cooling/.test(normalized)) {
    terms.push('hvac repair', 'ac repair', 'heating repair', 'furnace repair', 'best hvac company');
  } else {
    const seed = normalized || 'local service';
    terms.push(seed, `${seed} company`, `best ${seed}`, `emergency ${seed}`, `${seed} service`);
  }

  return [...new Set(terms.map((item) => normalizeString(item)).filter(Boolean))];
}

function generateLocalBuyerQueries(industry, area) {
  const cleanIndustry = normalizeIndustrySeed(industry);
  const cleanArea = sanitizeAreaLabel(area);
  if (!cleanIndustry || !cleanArea) {
    return [];
  }

  const areaTokens = cleanArea.split(' ').filter(Boolean);
  if (areaTokens.length < 2) {
    return [];
  }

  const intentTerms = inferIndustryIntentTerms(cleanIndustry);
  const exactIndustry = cleanIndustry.toLowerCase();
  const candidateQueries = [
    ...intentTerms.map((term) => `${term} ${cleanArea}`),
    `${cleanIndustry} near ${cleanArea}`,
    /\bservice\b/i.test(cleanIndustry) ? '' : `${cleanIndustry} service ${cleanArea}`,
    `best ${cleanIndustry} ${cleanArea}`,
    `emergency ${cleanIndustry} ${cleanArea}`
  ];

  return candidateQueries
    .map((query) => normalizeString(query))
    .filter((query) => {
      const lower = query.toLowerCase();
      if (!lower || !lower.includes(cleanArea.toLowerCase())) {
        return false;
      }
      if (lower === `${exactIndustry} ${cleanArea.toLowerCase()}` && areaTokens.length < 2) {
        return false;
      }
      return true;
    })
    .filter((query, index, list) => list.findIndex((item) => item.toLowerCase() === query.toLowerCase()) === index)
    .slice(0, 8);
}

function unwrapSearchRedirectUrl(url) {
  const original = normalizeString(url);
  if (!original) {
    return '';
  }

  try {
    const parsed = new URL(original);
    const host = parsed.hostname.toLowerCase();

    if (host.includes('bing.com')) {
      const encoded = parsed.searchParams.get('u') || parsed.searchParams.get('url') || '';
      if (encoded) {
        const cleaned = encoded.replace(/^a1/i, '');
        return safeDecodeUri(cleaned);
      }
    }

    if (host.includes('google.com')) {
      const encoded = parsed.searchParams.get('q') || parsed.searchParams.get('url') || '';
      if (encoded) {
        return safeDecodeUri(encoded);
      }
    }

    if (host.includes('duckduckgo.com')) {
      const encoded = parsed.searchParams.get('uddg') || parsed.searchParams.get('rut') || '';
      if (encoded) {
        return safeDecodeUri(encoded);
      }
    }

    return original;
  } catch {
    return original;
  }
}

function looksLikeBusinessName(value) {
  const text = normalizeString(value);
  if (!text) {
    return false;
  }
  if (text.length < 3 || text.length > 120) {
    return false;
  }
  if (/[^\x00-\x7F]/.test(text) && !/[&'().-]/.test(text)) {
    return false;
  }
  return /\b(llc|inc|co|company|service|services|repair|towing|locksmith|tree|recovery|transport|garage|auto|truck|roadside)\b/i.test(text)
    || /^[a-z0-9&'().,\- ]+$/i.test(text);
}

function hasDirectoryHost(host) {
  const normalized = normalizeString(host).toLowerCase();
  if (!normalized) {
    return false;
  }
  return [
    'yelp.com',
    'angi.com',
    'thumbtack.com',
    'mapquest.com',
    'yellowpages.com',
    'superpages.com',
    'tripadvisor.com'
  ].some((blocked) => normalized === blocked || normalized.endsWith(`.${blocked}`));
}

function isSocialHost(host) {
  const normalized = normalizeString(host).toLowerCase();
  if (!normalized) {
    return false;
  }
  return [
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'x.com',
    'twitter.com',
    'tiktok.com'
  ].some((blocked) => normalized === blocked || normalized.endsWith(`.${blocked}`));
}

function isReviewHost(host) {
  const normalized = normalizeString(host).toLowerCase();
  if (!normalized) {
    return false;
  }
  return [
    'yelp.com',
    'bbb.org',
    'tripadvisor.com',
    'birdeye.com'
  ].some((blocked) => normalized === blocked || normalized.endsWith(`.${blocked}`));
}

function isJunkMarketResult(result) {
  const host = normalizeString(result && result.host).toLowerCase();
  const title = normalizeString(result && (result.title || result.name));
  const url = normalizeString(result && result.url).toLowerCase();
  if (!title && !url) {
    return true;
  }
  if (!url || /^javascript:|^data:|^about:|^#/.test(url)) {
    return true;
  }
  if ((host === 'google.com' || host.endsWith('.google.com')) && /\/(search|url|aclk|ads|maps|imgres|policies)\b/.test(url)) {
    return true;
  }
  if ((host === 'bing.com' || host.endsWith('.bing.com')) && /\/(search|ck\/a|aclick)\b/.test(url)) {
    return true;
  }
  if ((host === 'duckduckgo.com' || host.endsWith('.duckduckgo.com')) && /\/(html|lite)\b/.test(url) && !/[?&](uddg|rut)=/.test(url)) {
    return true;
  }
  if (/doubleclick\.net|googleadservices\.com|adurl=|utm_(source|medium|campaign)=|gclid=|fbclid=/.test(url)) {
    return true;
  }
  return false;
}

function evaluateMarketResult(entry, context = {}) {
  const url = unwrapSearchRedirectUrl(entry && entry.url);
  const host = extractHostFromUrl(url);
  const title = normalizeString(entry && (entry.title || entry.name));
  const snippet = normalizeString(entry && entry.snippet);
  const area = sanitizeAreaLabel(context.area);
  const industry = normalizeIndustrySeed(context.industry).toLowerCase();
  const text = `${title} ${snippet}`.toLowerCase();
  const isDirectory = hasDirectoryHost(host);
  const isSocial = isSocialHost(host);
  const isReviewSite = isReviewHost(host);
  const resultType = isSocial
    ? 'social'
    : (isReviewSite ? 'review' : (isDirectory ? 'directory' : (host.includes('google.') ? 'google' : (looksLikeBusinessName(title) ? 'local_business' : 'unknown'))));
  const businessSignals = {
    serviceKeyword: Boolean(industry && text.includes(industry)),
    intentKeyword: /\b(tow|towing|tow truck|roadside|lockout|locksmith|tree|stump|emergency|24 hour|repair|service|company)\b/i.test(text),
    areaMention: Boolean(area && text.includes(area.toLowerCase())),
    nearbyMention: Boolean(area && area.split(' ').some((token) => token.length >= 3 && text.includes(token.toLowerCase()))),
    businessName: looksLikeBusinessName(title),
    websiteDomain: Boolean(host && !isJunkMarketResult({ host, title, snippet, url })),
    reviews: Number.isFinite(Number(entry && entry.reviewCount)) || Number.isFinite(Number(entry && entry.reviews)),
    localSignals: /\b(call|open|24 hour|hours|directions|review|reviews|address|phone|roadside|service area)\b/i.test(text)
  };

  const matchedSignals = Object.values(businessSignals).filter(Boolean).length;
  const junk = isJunkMarketResult({ host, title, snippet, url });
  const warnings = [];
  if (!businessSignals.serviceKeyword && !businessSignals.intentKeyword) {
    warnings.push('No direct service-keyword match in title/snippet.');
  }
  if (!businessSignals.areaMention && !businessSignals.nearbyMention) {
    warnings.push('No exact area match detected.');
  }
  if (isDirectory) warnings.push('Directory listing, not a standalone business website.');
  if (isSocial) warnings.push('Social profile, not a standalone website.');
  if (isReviewSite) warnings.push('Review or reputation profile.');

  let confidence = 40;
  if (businessSignals.businessName) confidence += 12;
  if (businessSignals.websiteDomain) confidence += 8;
  if (businessSignals.serviceKeyword) confidence += 12;
  if (businessSignals.intentKeyword) confidence += 8;
  if (businessSignals.areaMention) confidence += 10;
  if (businessSignals.nearbyMention) confidence += 6;
  if (businessSignals.localSignals) confidence += 8;
  if (businessSignals.reviews) confidence += 6;
  if (isDirectory || isReviewSite) confidence -= 6;
  if (isSocial) confidence -= 10;
  confidence = clampScore(confidence, 25, 95);

  const isLikelyLocalBusiness = !junk && !isDirectory && !isSocial && !isReviewSite
    && (businessSignals.businessName || businessSignals.websiteDomain || businessSignals.localSignals);
  const inclusionReason = junk
    ? 'Dropped as true junk or unusable result.'
    : (isLikelyLocalBusiness
      ? 'Visible result with business-like signals.'
      : (isDirectory || isReviewSite || isSocial
        ? 'Visible market asset occupying search results.'
        : 'Visible organic result with limited structured business signals.'));

  return {
    url,
    host,
    title,
    snippet,
    junk,
    resultType,
    confidence,
    inclusionReason,
    warnings,
    isLikelyLocalBusiness,
    isDirectory,
    isSocial,
    isReviewSite,
    businessSignals,
    signalCount: matchedSignals
  };
}

function hasLiveSerpCredentials() {
  const provider = normalizeString(process.env.SERP_PROVIDER || 'serpapi').toLowerCase();
  if (provider === 'dataforseo') {
    return Boolean(normalizeString(process.env.SERP_API_LOGIN) && normalizeString(process.env.SERP_API_KEY));
  }
  return Boolean(normalizeString(process.env.SERP_API_KEY));
}

function makeSampleIndustryCompanies({ industry, city, state, count = 20 }) {
  const service = normalizeString(industry) || 'service';
  const marketCity = normalizeString(city) || 'Target City';
  const marketState = normalizeString(state) || 'State';
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const token = `${service}-${marketCity}-${marketState}-${i + 1}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const domain = `${token}.example.com`;
    const searchAppearances = seededInt(`${domain}:search`, 1, 3);
    const mapPackAppearances = seededInt(`${domain}:map`, 0, 2);
    const averagePosition = Number((seededInt(`${domain}:avg`, 2, 18) + (i < 5 ? 0 : 2)).toFixed(1));
    const authorityIndicator = seededInt(`${domain}:authority`, 2, 9);
    const contentSignal = seededInt(`${domain}:content`, 2, 9);
    const hasStructuredData = seededInt(`${domain}:schema`, 0, 10) >= 5;
    const strengthScore = clampScore(Math.round((searchAppearances * 20) + (mapPackAppearances * 10) + (authorityIndicator * 4) + (contentSignal * 3) - averagePosition), 20, 95);
    rows.push({
      companyName: `${marketCity} ${service} ${i + 1}`.replace(/\b\w/g, (c) => c.toUpperCase()),
      domain,
      website: `https://${domain}`,
      searchAppearances,
      mapPackAppearances,
      averagePosition,
      authorityIndicator,
      contentSignal,
      hasStructuredData,
      strengthScore
    });
  }
  return rows;
}

function buildIndustryAnalysis({
  companies,
  industry,
  city,
  state,
  screenshots,
  queryCount
}) {
  const sorted = (Array.isArray(companies) ? companies : [])
    .slice()
    .sort((a, b) => {
      const scoreDelta = Number(b.strengthScore || 0) - Number(a.strengthScore || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return Number(a.averagePosition || 99) - Number(b.averagePosition || 99);
    })
    .slice(0, 20);

  const totalStrength = sorted.reduce((sum, item) => sum + Number(item.strengthScore || 0), 0) || 1;
  const enriched = sorted.map((item, index) => {
    const visibilityPct = Number((((Number(item.strengthScore || 0) / totalStrength) * 100)).toFixed(1));
    const aiCitationScore = clampScore(
      Math.round((Number(item.contentSignal || 0) * 5.2) + (Number(item.authorityIndicator || 0) * 3.6) + (item.hasStructuredData ? 14 : 4)),
      20,
      100
    );
    return {
      rank: index + 1,
      companyName: item.companyName,
      domain: item.domain,
      website: item.website,
      resultType: item.resultType || 'unknown',
      confidence: Number(item.confidence || 0),
      inclusionReason: item.inclusionReason || '',
      warnings: Array.isArray(item.warnings) ? item.warnings : [],
      queriesAppearedIn: item.queriesAppearedIn || [],
      firstObservedRank: Number(item.firstObservedRank || item.averagePosition || 99),
      totalAppearances: Number(item.totalAppearances || (Number(item.searchAppearances || 0) + Number(item.mapPackAppearances || 0))),
      source: item.source || '',
      searchAppearances: Number(item.searchAppearances || 0),
      mapPackAppearances: Number(item.mapPackAppearances || 0),
      averagePosition: Number(item.averagePosition || 99),
      strengthLabel: strengthLabelFromScore(Number(item.strengthScore || 0)),
      strengthScore: Number(item.strengthScore || 0),
      authorityIndicator: Number(item.authorityIndicator || 0),
      contentSignal: Number(item.contentSignal || 0),
      hasStructuredData: Boolean(item.hasStructuredData),
      rating: Number.isFinite(Number(item.rating)) ? Number(item.rating) : null,
      reviews: Number.isFinite(Number(item.reviews)) ? Number(item.reviews) : null,
      reputationScore: item.reputationScore === null ? null : Number(item.reputationScore || 0),
      websiteStrength: Number(item.websiteStrength || 0),
      localPresence: Number(item.localPresence || 0),
      conversionUx: Number(item.conversionUx || 0),
      visibilityControlPct: visibilityPct,
      aiCitationScore,
      aiVisibility: Number(item.aiVisibility || aiCitationScore),
      consistencyCount: Number(item.searchAppearances || 0) + Number(item.mapPackAppearances || 0),
      consistencyLabel: `Appeared in ${Number(item.searchAppearances || 0) + Number(item.mapPackAppearances || 0)} of ${Number(queryCount || 0)} searches`
    };
  });

  const top3 = enriched.slice(0, 3);
  const top3VisibilityControl = Number(top3.reduce((sum, item) => sum + Number(item.visibilityControlPct || 0), 0).toFixed(1));
  const dominantPlayers = enriched.filter((item) => item.strengthLabel === 'High' || item.visibilityControlPct >= 12).length;
  const rankingStability = top3VisibilityControl >= 55 ? 'High' : (top3VisibilityControl >= 40 ? 'Medium' : 'Low');
  const marketStrength = top3VisibilityControl >= 58 ? 'High' : (top3VisibilityControl >= 42 ? 'Medium' : 'Low');

  const mapPackLeaders = enriched
    .filter((item) => item.mapPackAppearances > 0)
    .sort((a, b) => b.mapPackAppearances - a.mapPackAppearances || a.rank - b.rank)
    .slice(0, 3);
  const totalMapPackPresence = enriched.reduce((sum, item) => sum + item.mapPackAppearances, 0) || 1;
  const mapPackDominators = mapPackLeaders.map((item) => ({
    companyName: item.companyName,
    domain: item.domain,
    mapPackAppearances: item.mapPackAppearances,
    mapPackControlPct: Number(((item.mapPackAppearances / totalMapPackPresence) * 100).toFixed(1))
  }));

  const avgTopStrength = top3.length ? (top3.reduce((sum, item) => sum + item.strengthScore, 0) / top3.length) : 0;
  const avgTopAuthority = top3.length ? (top3.reduce((sum, item) => sum + item.authorityIndicator, 0) / top3.length) : 0;
  const mapControlRatio = mapPackDominators.length
    ? (mapPackDominators.reduce((sum, item) => sum + item.mapPackControlPct, 0) / 100)
    : 0.15;
  const consistencyFactor = rankingStability === 'High' ? 2.6 : (rankingStability === 'Medium' ? 1.8 : 1.0);
  const difficultyScore = clampScore(
    Math.round(
      ((avgTopStrength / 100) * 4.2)
      + ((avgTopAuthority / 10) * 2.3)
      + (mapControlRatio * 2.1)
      + consistencyFactor
    ),
    1,
    10
  );
  const difficultyLevel = normalizeDifficultyLevel(difficultyScore);

  const weakCompetitorsInTop10 = enriched
    .filter((item) => item.rank <= 10 && (item.strengthLabel === 'Low' || item.authorityIndicator <= 4))
    .map((item) => `${item.companyName} (${item.domain})`);
  const lowAuthoritySitesRanking = enriched
    .filter((item) => item.rank <= 10 && item.authorityIndicator <= 4)
    .map((item) => `${item.companyName} (authority indicator ${item.authorityIndicator}/10)`);
  const underOptimizedResults = enriched
    .filter((item) => item.rank <= 10 && !item.hasStructuredData)
    .map((item) => `${item.companyName} (${item.domain})`);
  const rankingGaps = [
    weakCompetitorsInTop10.length
      ? `Positions 7-10 include ${weakCompetitorsInTop10.length} weaker competitors that are beatable with stronger market positioning.`
      : 'Top 10 is mostly strong, so entry requires sharper differentiation.',
    top3VisibilityControl >= 60
      ? 'Top 3 controls most visibility, so focus first on taking positions 7-10 before challenging leaders.'
      : 'Visibility is distributed, which creates room to move into the Top 5 faster.'
  ];

  const aiCandidates = enriched
    .slice()
    .sort((a, b) => b.aiCitationScore - a.aiCitationScore || a.rank - b.rank)
    .slice(0, 5)
    .map((item) => ({
      companyName: item.companyName,
      domain: item.domain,
      citationLikelihood: item.aiCitationScore >= 75 ? 'High' : (item.aiCitationScore >= 58 ? 'Medium' : 'Low'),
      hasStructuredData: item.hasStructuredData,
      contentStrength: item.contentSignal >= 7 ? 'Strong' : (item.contentSignal >= 5 ? 'Moderate' : 'Weak')
    }));

  const marketLabel = [normalizeString(city), normalizeString(state)].filter(Boolean).join(', ') || 'your target market';
  const serviceLabel = normalizeString(industry) || 'service';
  const strategyBreakIn = [
    {
      priority: 1,
      focusArea: 'Market Positioning',
      action: `Launch one high-conversion offer for "${serviceLabel}" in ${marketLabel} with clear differentiation from current Top 10 messaging.`,
      expectedImpact: 'Improves click-through intent against weaker positions 7-10.'
    },
    {
      priority: 2,
      focusArea: 'Local Visibility Momentum',
      action: 'Build search momentum by targeting recurring competitor queries where map-pack control is weakest.',
      expectedImpact: 'Creates a faster path into first-page visibility.'
    },
    {
      priority: 3,
      focusArea: 'Proof and Authority',
      action: 'Out-position low-authority competitors with stronger proof assets and clearer buyer outcomes.',
      expectedImpact: 'Raises trust and win-rate once you enter Top 10.'
    },
    {
      priority: 4,
      focusArea: 'AI Citation Readiness',
      action: 'Publish concise answer-led service content in the same intent clusters that current citation leaders cover.',
      expectedImpact: 'Increases visibility in AI answer surfaces.'
    }
  ];
  const strategyDominate = [
    {
      priority: 1,
      focusArea: 'Query Coverage',
      action: 'Expand into all high-intent local variations where dominant competitors repeatedly appear.',
      expectedImpact: 'Reduces leader control across search appearances.'
    },
    {
      priority: 2,
      focusArea: 'Map Pack Control',
      action: 'Run an aggressive local-proof and review acquisition cadence to capture more map-pack impressions.',
      expectedImpact: 'Improves map-pack share against current dominators.'
    },
    {
      priority: 3,
      focusArea: 'Brand Recall',
      action: 'Synchronize SERP messaging and offer hierarchy so users repeatedly see a clear reason to choose you.',
      expectedImpact: 'Improves conversion from improved rankings.'
    },
    {
      priority: 4,
      focusArea: 'Defensive Growth',
      action: 'Track recurring competitor movement weekly and respond with rapid content and offer updates.',
      expectedImpact: 'Prevents ranking regression after initial gains.'
    }
  ];
  const summaryNarrative = weakCompetitorsInTop10.length
    ? `This market has visible competitors, but many appear to rely mostly on Google Business Profile strength instead of strong websites. Several sites lack clear service pages, emergency-call messaging, structured data, and AI-citable business information. A focused local SEO/GEO campaign could target high-intent ${serviceLabel} searches in ${marketLabel} and win more calls.`
    : `This market is active and competitive. Stronger local proof, clearer service pages, and AI-citable business information can still separate a better-positioned ${serviceLabel} company in ${marketLabel}.`;

  return {
    overview: {
      totalCompetitorsAnalyzed: enriched.length,
      marketStrength,
      dominantPlayers,
      rankingStability,
      querySampleCount: Number(queryCount || 0),
      screenshots: Array.isArray(screenshots) ? screenshots : []
    },
    competitors: enriched.map((item) => ({
      rank: item.rank,
      companyName: item.companyName,
      domain: item.domain,
      website: item.website,
      queriesAppearedIn: item.queriesAppearedIn || [],
      firstObservedRank: Number(item.firstObservedRank || item.rank),
      totalAppearances: Number(item.totalAppearances || item.consistencyCount || 0),
      source: item.source || '',
      searchAppearances: item.searchAppearances,
      mapPackAppearances: item.mapPackAppearances,
      averagePosition: Number(item.averagePosition.toFixed(1)),
      strengthLabel: item.strengthLabel,
      strengthScore: item.strengthScore,
      visibilityControlPct: item.visibilityControlPct,
      hasStructuredData: item.hasStructuredData,
      rating: Number.isFinite(Number(item.rating)) ? Number(item.rating) : null,
      reviews: Number.isFinite(Number(item.reviews)) ? Number(item.reviews) : null,
      reputationScore: item.reputationScore === null ? null : Number(item.reputationScore || 0),
      websiteStrength: Number(item.websiteStrength || 0),
      localPresence: Number(item.localPresence || 0),
      conversionUx: Number(item.conversionUx || 0),
      aiVisibility: Number(item.aiVisibility || 0),
      consistencyCount: item.consistencyCount,
      consistencyLabel: item.consistencyLabel
    })),
    dominance: {
      topRecurringCompetitors: top3.map((item) => ({
        companyName: item.companyName,
        domain: item.domain,
        visibilityControlPct: item.visibilityControlPct
      })),
      visibilityControlledByTop3: top3VisibilityControl,
      mapPackDominators,
      mapPackLeader: mapPackDominators.length ? mapPackDominators[0].companyName : 'No clear map-pack leader'
    },
    difficulty: {
      score: difficultyScore,
      level: difficultyLevel,
      rationale: [
        `Top competitor strength average: ${Math.round(avgTopStrength)}/100.`,
        `Ranking stability is ${rankingStability.toLowerCase()}, which affects entry speed.`,
        `Map pack control concentration is ${Math.round(mapControlRatio * 100)}%.`
      ]
    },
    opportunities: {
      weakCompetitorsInTop10,
      rankingGaps,
      lowAuthoritySitesRanking,
      underOptimizedResults,
      keyOpportunities: [
        weakCompetitorsInTop10.length
          ? `Positions 7-10 are currently beatable in ${marketLabel}.`
          : `Top 10 is strong, so compete with sharper positioning and offer clarity.`,
        underOptimizedResults.length
          ? `${underOptimizedResults.length} ranking results show lower optimization signals.`
          : 'Most ranking results appear well optimized, requiring stronger strategic differentiation.',
        mapPackDominators.length <= 1
          ? 'Map pack is not fully locked by multiple players, creating local entry opportunities.'
          : `This market is dominated by ${mapPackDominators.length} map-pack leaders.`
      ],
      aiCitationPotential: {
        topCandidates: aiCandidates,
        summary: aiCandidates.length
          ? `${aiCandidates[0].companyName} and peers are most likely to be cited by AI in this market.`
          : 'No strong AI citation leaders identified.'
      }
    },
    strategy: {
      howToBreakIntoTop10: strategyBreakIn,
      howToDominateThisMarket: strategyDominate,
      focusAreas: [
        'Market Positioning',
        'Local Visibility Momentum',
        'Map Pack Control',
        'AI Citation Readiness',
        'Defensive Growth'
      ]
    },
    summaryNarrative
  };
}

function buildMarketQueries({ industry, city, state, zip }) {
  const area = createAreaLabel({ city, state, zip });
  return generateLocalBuyerQueries(industry, area);
}

function buildDedupedMarketRankingRows(orderedResults, competitorStatsByKey) {
  const deduped = [];
  const seenKeys = new Set();

  (Array.isArray(orderedResults) ? orderedResults : []).forEach((item) => {
    const key = normalizeString(item && (item.businessKey || item.domain || item.companyName)).toLowerCase();
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    const stats = competitorStatsByKey.get(key) || {};
    const domain = normalizeString(item && item.domain).toLowerCase() || normalizeString(stats.domain).toLowerCase();
    const queriesAppearedIn = Array.isArray(stats.queriesAppearedIn) ? stats.queriesAppearedIn : [];
    const titlesSeen = Array.isArray(stats.titlesSeen) ? stats.titlesSeen : [];
    const consistencyCount = Number(stats.searchAppearances || 0) + Number(stats.mapPackAppearances || 0);
    deduped.push({
      rank: deduped.length + 1,
      page: Math.floor(deduped.length / 10) + 1,
      companyName: item.companyName || stats.companyName || '-',
      domain,
      website: item.website || stats.website || (domain ? `https://${domain}` : ''),
      resultType: item.resultType || stats.resultType || 'unknown',
      confidence: Number(item.confidence || stats.confidence || 0),
      inclusionReason: item.inclusionReason || stats.inclusionReason || '',
      warnings: Array.isArray(item.warnings) ? item.warnings : (Array.isArray(stats.warnings) ? stats.warnings : []),
      observedRank: Number(item.rank || deduped.length + 1),
      observedQuery: item.query || '',
      queriesAppearedIn,
      firstObservedRank: Number(stats.firstObservedRank || item.rank || deduped.length + 1),
      averagePosition: Number(stats.averagePosition || item.rank || 0),
      searchAppearances: Number(stats.searchAppearances || 0),
      mapPackAppearances: Number(stats.mapPackAppearances || 0),
      totalAppearances: Number(stats.totalAppearances || consistencyCount),
      consistencyCount,
      consistencyLabel: consistencyCount > 0 ? `Appeared in ${consistencyCount} searches` : '',
      source: stats.source || item.source || '',
      titlesSeen,
      whyRank: [
        Number.isFinite(Number(stats.firstObservedRank || item.rank)) ? `Observed first at #${Number(stats.firstObservedRank || item.rank)}` : '',
        queriesAppearedIn.length ? `Queries: ${queriesAppearedIn.join(' | ')}` : (item.query ? `From "${item.query}"` : ''),
        Number.isFinite(Number(stats.averagePosition)) ? `Avg position ${Number(stats.averagePosition).toFixed(1)}` : '',
        Number(stats.totalAppearances || 0) > 0 ? `Total appearances ${Number(stats.totalAppearances || 0)}` : '',
        Number(stats.searchAppearances || 0) > 0 ? `Organic appearances ${Number(stats.searchAppearances || 0)}` : '',
        Number(stats.mapPackAppearances || 0) > 0 ? `Map pack appearances ${Number(stats.mapPackAppearances || 0)}` : ''
      ].filter(Boolean).join(' | ')
    });
  });

  return deduped.slice(0, 10);
}

function createBusinessKey({ domain, companyName }) {
  const safeDomain = normalizeString(domain).toLowerCase();
  if (safeDomain) {
    return safeDomain;
  }
  return normalizeString(companyName).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function estimateWebsiteStrength({ domain, website }) {
  if (!domain && !website) return 20;
  if (hasDirectoryHost(domain)) return 25;
  return 78;
}

function estimateLocalPresence({ signalCount, reviews, areaMatch }) {
  const reviewBoost = Number.isFinite(Number(reviews)) ? Math.min(15, Math.round(Math.log10(Number(reviews) + 1) * 8)) : 0;
  return clampScore((signalCount * 12) + (areaMatch ? 14 : 0) + reviewBoost, 15, 95);
}

function estimateConversionUx({ title, snippet }) {
  const text = `${normalizeString(title)} ${normalizeString(snippet)}`.toLowerCase();
  let score = 35;
  if (/\b24 hour\b|\bemergency\b/.test(text)) score += 18;
  if (/\bcall\b|\bphone\b|\bcontact\b/.test(text)) score += 14;
  if (/\broadside\b|\blockout\b|\btire\b|\btow truck\b|\btree removal\b/.test(text)) score += 12;
  return clampScore(score, 20, 95);
}

function estimateAiVisibility({ hasStructuredData, contentSignal, signalCount }) {
  return clampScore((hasStructuredData ? 30 : 12) + (Number(contentSignal || 0) * 5) + (signalCount * 4), 20, 95);
}

function estimateReputation({ rating, reviews }) {
  if (!Number.isFinite(Number(rating)) && !Number.isFinite(Number(reviews))) {
    return null;
  }
  const ratingScore = Number.isFinite(Number(rating)) ? Math.round((Number(rating) / 5) * 70) : 35;
  const reviewScore = Number.isFinite(Number(reviews)) ? Math.min(30, Math.round(Math.log10(Number(reviews) + 1) * 12)) : 0;
  return clampScore(ratingScore + reviewScore, 20, 98);
}

function upsertMarketCompetitor({
  competitorMap,
  orderedResults,
  directorySignals,
  entry,
  query,
  source,
  marketContext,
  isMapResult = false
}) {
  const evaluation = evaluateMarketResult(entry, marketContext);
  const domain = extractRootDomain(evaluation.host || evaluation.url || '');
  const companyName = evaluation.title || domain || 'Unknown business';
  const website = normalizeString(evaluation.url) || (domain ? `https://${domain}` : '');
  const businessKey = createBusinessKey({ domain, companyName });
  const rating = Number.isFinite(Number(entry.rating)) ? Number(entry.rating) : null;
  const reviews = Number.isFinite(Number(entry.reviews)) ? Number(entry.reviews) : (Number.isFinite(Number(entry.reviewCount)) ? Number(entry.reviewCount) : null);

  if (evaluation.isDirectory || evaluation.isReviewSite) {
    directorySignals.push({
      companyName,
      domain,
      website,
      query,
      source,
      resultType: evaluation.resultType,
      confidence: evaluation.confidence
    });
    return { accepted: false, reason: 'directory' };
  }

  if (evaluation.junk) {
    return { accepted: false, reason: 'junk' };
  }

  const row = competitorMap.get(businessKey) || {
    businessKey,
    companyName,
    domain,
    website,
    queriesAppearedIn: [],
    titlesSeen: [],
    snippetsSeen: [],
    searchAppearances: 0,
    mapPackAppearances: 0,
    positions: [],
    firstObservedRank: null,
    source,
    authorityIndicator: seededInt(`${businessKey}:authority`, 3, 10),
    contentSignal: seededInt(`${businessKey}:content`, 3, 10),
    hasStructuredData: seededInt(`${businessKey}:schema`, 0, 10) >= 5,
    rating: null,
    reviews: null,
    localSignalCount: 0,
    areaMatch: false,
    websiteStrength: 0,
    conversionUx: 0,
    aiVisibility: 0,
    reputationScore: null,
    resultType: evaluation.resultType,
    confidence: evaluation.confidence,
    inclusionReason: evaluation.inclusionReason,
    warnings: [],
    isLikelyLocalBusiness: evaluation.isLikelyLocalBusiness,
    isDirectory: evaluation.isDirectory,
    isSocial: evaluation.isSocial,
    isReviewSite: evaluation.isReviewSite
  };

  row.companyName = row.companyName || companyName;
  row.domain = row.domain || domain;
  row.website = row.website || website;
  row.source = row.source || source;
  row.queriesAppearedIn = [...new Set(row.queriesAppearedIn.concat(query))];
  row.titlesSeen = [...new Set(row.titlesSeen.concat(companyName))].slice(0, 6);
  row.snippetsSeen = [...new Set(row.snippetsSeen.concat(normalizeString(entry.snippet)))].filter(Boolean).slice(0, 6);
  row.localSignalCount = Math.max(row.localSignalCount, evaluation.signalCount);
  row.areaMatch = row.areaMatch || evaluation.businessSignals.areaMention || evaluation.businessSignals.nearbyMention;
  row.websiteStrength = Math.max(row.websiteStrength, estimateWebsiteStrength({ domain, website }));
  row.conversionUx = Math.max(row.conversionUx, estimateConversionUx({ title: companyName, snippet: entry.snippet }));
  row.aiVisibility = Math.max(row.aiVisibility, estimateAiVisibility({
    hasStructuredData: row.hasStructuredData,
    contentSignal: row.contentSignal,
    signalCount: evaluation.signalCount
  }));
  row.reputationScore = estimateReputation({ rating, reviews }) ?? row.reputationScore;
  row.resultType = row.resultType === 'local_business' ? row.resultType : evaluation.resultType;
  row.confidence = Math.max(Number(row.confidence || 0), Number(evaluation.confidence || 0));
  row.inclusionReason = row.inclusionReason || evaluation.inclusionReason;
  row.warnings = [...new Set((Array.isArray(row.warnings) ? row.warnings : []).concat(Array.isArray(evaluation.warnings) ? evaluation.warnings : []))].slice(0, 4);
  row.isLikelyLocalBusiness = row.isLikelyLocalBusiness || evaluation.isLikelyLocalBusiness;
  row.isDirectory = row.isDirectory || evaluation.isDirectory;
  row.isSocial = row.isSocial || evaluation.isSocial;
  row.isReviewSite = row.isReviewSite || evaluation.isReviewSite;
  if (rating !== null) row.rating = rating;
  if (reviews !== null) row.reviews = reviews;

  if (isMapResult) {
    row.mapPackAppearances += 1;
  } else {
    row.searchAppearances += 1;
  }
  if (Number.isFinite(Number(entry.position))) {
    row.positions.push(Number(entry.position));
    row.firstObservedRank = row.firstObservedRank === null
      ? Number(entry.position)
      : Math.min(row.firstObservedRank, Number(entry.position));
  }
  row.totalAppearances = Number(row.searchAppearances || 0) + Number(row.mapPackAppearances || 0);
  row.localPresence = estimateLocalPresence({
    signalCount: row.localSignalCount,
    reviews: row.reviews,
    areaMatch: row.areaMatch
  });

  competitorMap.set(businessKey, row);
  orderedResults.push({
    businessKey,
    rank: Number(entry.position) || row.firstObservedRank || 99,
    page: Math.floor(((Number(entry.position) || row.firstObservedRank || 99) - 1) / 10) + 1,
    companyName: row.companyName,
    domain: row.domain,
    website: row.website,
    query,
    source,
    resultType: evaluation.resultType,
    confidence: evaluation.confidence,
    inclusionReason: evaluation.inclusionReason,
    warnings: evaluation.warnings
  });

  return { accepted: true, key: businessKey };
}

function hasBraveSearchCredentials() {
  return Boolean(normalizeString(process.env.BRAVE_SEARCH_API_KEY));
}

async function fetchBraveSearchResults(query, market, options = {}) {
  const apiKey = normalizeString(process.env.BRAVE_SEARCH_API_KEY);
  if (!apiKey) {
    throw new Error('BRAVE_SEARCH_API_KEY is required for Brave Search.');
  }
  const endpoint = new URL('https://api.search.brave.com/res/v1/web/search');
  endpoint.searchParams.set('q', `${query} ${market}`.trim());
  endpoint.searchParams.set('count', String(Math.max(10, Number(options.num) || 20)));
  endpoint.searchParams.set('search_lang', 'en');
  endpoint.searchParams.set('country', 'us');
  endpoint.searchParams.set('safesearch', 'moderate');

  const response = await fetch(endpoint.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey
    }
  });
  if (!response.ok) {
    throw new Error(`Brave Search request failed with status ${response.status}`);
  }
  const payload = await response.json();
  const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  return results.map((entry, index) => ({
    position: index + 1,
    title: normalizeString(entry.title),
    url: normalizeString(entry.url),
    host: extractHostFromUrl(entry.url),
    snippet: normalizeString(entry.description),
    reviewCount: null
  }));
}

async function getLocalCompetitors({ industry, market, queries, locationOverride = '' }) {
  const location = normalizeString(locationOverride) || market || 'United States';
  const results = [];

  if (hasLiveSerpCredentials()) {
    const provider = createSerpProvider();
    try {
      for (const query of queries) {
        const raw = await provider.getSearchResults(query, location, { num: 10 });
        const normalized = provider.normalizeResults(raw, {
          query,
          location
        });
        const combinedResults = [
          ...safeArray(normalized.localPackResults).map((row) => ({ ...row, sourceType: 'local_pack' })),
          ...safeArray(normalized.organicResults).map((row) => ({ ...row, sourceType: 'organic' }))
        ];
        console.log('[market-search] provider:', provider.name);
        console.log('[market-search] query:', query);
        console.log('[market-search] organic:', safeArray(normalized.organicResults).length);
        console.log('[market-search] localPack:', safeArray(normalized.localPackResults).length);
        results.push({
          query,
          source: provider.name,
          confidence: 'high',
          raw,
          normalized: {
            ...normalized,
            combinedResults
          }
        });
      }
      return {
        provider: provider.name,
        confidence: 'high',
        sourceNote: 'SerpAPI',
        results
      };
    } catch (error) {
      console.log('[market-search] serp provider failed:', normalizeString(error && error.message) || 'unknown error');
    }
  }

  if (hasBraveSearchCredentials()) {
    for (const query of queries) {
      const braveRows = await fetchBraveSearchResults(query, location, { num: 20 });
      results.push({
        query,
        source: 'brave search api',
        confidence: 'medium',
        raw: { braveRows },
        normalized: {
          query,
          location,
          organicResults: braveRows.map((entry) => ({
            position: entry.position,
            title: entry.title,
            domain: extractRootDomain(entry.host || entry.url),
            url: unwrapSearchRedirectUrl(entry.url)
          })),
          localPackResults: [],
          screenshotUrl: ''
        }
      });
    }
    return {
      provider: 'brave search api',
      confidence: 'medium',
      sourceNote: 'Brave Search API',
      results
    };
  }

  if (!queries.length) {
    return { provider: 'none', confidence: 'low', sourceNote: 'No search provider is configured.', results };
  }

  for (const query of queries) {
    const crawl = await searchCompetitorsWithFallback(query, { pages: 3 });
    results.push({
      query,
      source: crawl.source,
      confidence: 'low',
      raw: crawl,
      normalized: {
        query,
        location,
        organicResults: Array.isArray(crawl.results) ? crawl.results.map((entry) => ({
          position: Number(entry.position) || 0,
          title: normalizeString(entry.title || entry.name),
          domain: extractRootDomain(unwrapSearchRedirectUrl(entry.url || entry.host || '')),
          url: unwrapSearchRedirectUrl(entry.url || '')
        })) : [],
        localPackResults: [],
        screenshotUrl: ''
      }
    });
  }
  const lastSource = results[results.length - 1]?.source || 'fallback crawler';
  return {
    provider: lastSource,
    confidence: 'low',
    sourceNote: lastSource.includes('bing')
      ? 'Bing fallback (lower confidence)'
      : (lastSource.includes('duckduckgo') ? 'DuckDuckGo fallback (lower confidence)' : 'Google fallback (lower confidence)'),
    results
  };
}

async function runMarketOnlyAudit(input) {
  const industry = normalizeString(input.industry);
  const city = normalizeString(input.city);
  const state = normalizeString(input.state);
  const zip = normalizeString(input.zip);
  const market = createAreaLabel({ city, state, zip });
  const serpLocation = normalizeString(process.env.SERP_LOCATION) || [city, state, 'United States'].filter(Boolean).join(', ') || 'United States';
  const primaryQuery = `${industry} ${market}`.trim();
  const queries = buildMarketQueries({ industry, city, state, zip });

  const competitorMap = new Map();
  const screenshotRows = [];
  const orderedResults = [];
  const rawVisibleResults = [];
  const localPackRows = [];
  const directorySignals = [];
  let queryCount = 0;
  let dataQuality = 'unavailable';
  let sourceNote = 'no live provider data returned';
  let sourceConfidence = 'low';

  try {
    const providerResults = await getLocalCompetitors({ industry, market, queries, locationOverride: serpLocation });
    sourceNote = providerResults.sourceNote;
    sourceConfidence = providerResults.confidence || 'low';

    for (const resultSet of providerResults.results) {
      const query = resultSet.query;
      const normalized = resultSet.normalized || {};
      const source = resultSet.source || providerResults.provider || 'unknown';
      queryCount += 1;

      if (normalizeString(normalized.screenshotUrl)) {
        screenshotRows.push({
          query,
          type: 'first_page',
          screenshotUrl: normalizeString(normalized.screenshotUrl)
        });
      }

      const mapRows = Array.isArray(normalized.localPackResults) ? normalized.localPackResults : [];
      mapRows.forEach((entry, index) => {
        const normalizedEntry = {
          ...entry,
          url: unwrapSearchRedirectUrl(entry.url)
        };
        const evaluation = evaluateMarketResult(normalizedEntry, { industry, area: market });
        if (!evaluation.junk) {
          rawVisibleResults.push({
            rank: Number(normalizedEntry.position) || (index + 1),
            query,
            source,
            title: evaluation.title,
            domain: extractRootDomain(normalizedEntry.domain || evaluation.url || ''),
            url: evaluation.url,
            resultType: evaluation.resultType,
            confidence: evaluation.confidence,
            inclusionReason: evaluation.inclusionReason,
            warnings: evaluation.warnings
          });
        }
        localPackRows.push({
          rank: Number(entry.position) || (index + 1),
          companyName: normalizeString(entry.title) || extractRootDomain(entry.domain || entry.url || '') || 'Unknown business',
          domain: extractRootDomain(entry.domain || entry.url || ''),
          website: normalizeString(unwrapSearchRedirectUrl(entry.url)) || '',
          rating: Number.isFinite(Number(entry.rating)) ? Number(entry.rating) : null,
          reviews: Number.isFinite(Number(entry.reviews)) ? Number(entry.reviews) : null,
          query
        });
        upsertMarketCompetitor({
          competitorMap,
          orderedResults,
          directorySignals,
          entry: normalizedEntry,
          query,
          source,
          marketContext: { industry, area: market },
          isMapResult: true
        });
      });

      const organicRows = Array.isArray(normalized.organicResults) ? normalized.organicResults : [];
      organicRows.forEach((entry) => {
        const normalizedEntry = {
          ...entry,
          url: unwrapSearchRedirectUrl(entry.url)
        };
        const evaluation = evaluateMarketResult(normalizedEntry, { industry, area: market });
        if (!evaluation.junk) {
          rawVisibleResults.push({
            rank: Number(normalizedEntry.position) || 0,
            query,
            source,
            title: evaluation.title,
            domain: extractRootDomain(normalizedEntry.domain || evaluation.url || ''),
            url: evaluation.url,
            resultType: evaluation.resultType,
            confidence: evaluation.confidence,
            inclusionReason: evaluation.inclusionReason,
            warnings: evaluation.warnings
          });
        }
        upsertMarketCompetitor({
          competitorMap,
          orderedResults,
          directorySignals,
          entry: normalizedEntry,
          query,
          source,
          marketContext: { industry, area: market },
          isMapResult: false
        });
      });
    }

    if (rawVisibleResults.length > 0) {
      dataQuality = sourceConfidence === 'high' ? 'real' : 'estimated';
    } else {
      sourceNote = providerResults.provider === 'none'
        ? 'No live or fallback search provider returned visible results.'
        : `${providerResults.sourceNote}. Search returned no visible usable rows.`;
    }
  } catch (error) {
    dataQuality = 'estimated';
    sourceNote = `provider unavailable (${normalizeString(error && error.message) || 'unknown error'})`;
  }

  const competitors = Array.from(competitorMap.values()).map((item) => {
    const avgPosition = item.positions && item.positions.length
      ? (item.positions.reduce((sum, val) => sum + val, 0) / item.positions.length)
      : Number(item.averagePosition || 12);
    const strengthScore = clampScore(
      Math.round((Number(item.searchAppearances || 0) * 6) + (Number(item.mapPackAppearances || 0) * 8) + (Number(item.authorityIndicator || 0) * 4) + (Number(item.contentSignal || 0) * 3) + (Number.isFinite(Number(item.rating)) ? Number(item.rating) * 4 : 0) + (Number.isFinite(Number(item.reviews)) ? Math.min(15, Math.round(Math.log10(Number(item.reviews) + 1) * 6)) : 0) - (avgPosition * 2)),
      20,
      95
    );
    return {
      companyName: item.companyName || item.name || item.domain,
      domain: item.domain,
      website: item.website || `https://${item.domain}`,
      queriesAppearedIn: item.queriesAppearedIn || [],
      firstObservedRank: Number(item.firstObservedRank || avgPosition || 99),
      totalAppearances: Number(item.totalAppearances || 0),
      source: item.source || '',
      titlesSeen: item.titlesSeen || [],
      snippetsSeen: item.snippetsSeen || [],
      searchAppearances: Number(item.searchAppearances || 0),
      mapPackAppearances: Number(item.mapPackAppearances || 0),
      averagePosition: Number(avgPosition.toFixed(1)),
      authorityIndicator: Number(item.authorityIndicator || 0),
      contentSignal: Number(item.contentSignal || 0),
      hasStructuredData: Boolean(item.hasStructuredData),
      rating: Number.isFinite(Number(item.rating)) ? Number(item.rating) : null,
      reviews: Number.isFinite(Number(item.reviews)) ? Number(item.reviews) : null,
      reputationScore: item.reputationScore === null ? null : Number(item.reputationScore || 0),
      websiteStrength: Number(item.websiteStrength || 0),
      localPresence: Number(item.localPresence || 0),
      conversionUx: Number(item.conversionUx || 0),
      aiVisibility: Number(item.aiVisibility || 0),
      strengthScore
    };
  });
  const competitorStatsByKey = new Map(
    competitors
      .filter((item) => createBusinessKey(item))
      .map((item) => [createBusinessKey(item), item])
  );

  const uniqueScreenshots = [];
  const seenScreenshotKey = new Set();
  screenshotRows.forEach((row) => {
    const key = `${row.query}|${row.type}|${row.screenshotUrl}`;
    if (!row.screenshotUrl || seenScreenshotKey.has(key)) {
      return;
    }
    seenScreenshotKey.add(key);
    uniqueScreenshots.push(row);
  });
  const industryAnalysis = buildIndustryAnalysis({
    companies: competitors,
    industry,
    city,
    state,
    screenshots: uniqueScreenshots,
    queryCount
  });
  const dedupedOrderedResults = buildDedupedMarketRankingRows(orderedResults, competitorStatsByKey);
  const hasVisibleResults = rawVisibleResults.length > 0;
  const hasLiveCompetitors = competitors.length > 0;
  const directoryOrReviewCount = dedupedOrderedResults.filter((row) => row.resultType === 'directory' || row.resultType === 'review').length;
  const localBusinessCount = dedupedOrderedResults.filter((row) => row.resultType === 'local_business').length;
  const socialCount = dedupedOrderedResults.filter((row) => row.resultType === 'social').length;
  const limitedWarning = hasVisibleResults && (sourceConfidence !== 'high' || localBusinessCount < 3)
    ? 'Search returned limited structured business data, so GeoNeo is showing visible market results with confidence labels.'
    : '';
  const difficultyScore = Number(industryAnalysis.difficulty && industryAnalysis.difficulty.score) || 0;
  const avgReputation = competitors
    .map((item) => item.reputationScore)
    .filter((value) => Number.isFinite(Number(value)));
  const avgWebsiteStrength = competitors.length
    ? Math.round(competitors.reduce((sum, item) => sum + Number(item.websiteStrength || 0), 0) / competitors.length)
    : 0;
  const avgLocalPresence = competitors.length
    ? Math.round(competitors.reduce((sum, item) => sum + Number(item.localPresence || 0), 0) / competitors.length)
    : 0;
  const avgConversionUx = competitors.length
    ? Math.round(competitors.reduce((sum, item) => sum + Number(item.conversionUx || 0), 0) / competitors.length)
    : 0;
  const avgAiVisibility = competitors.length
    ? Math.round(competitors.reduce((sum, item) => sum + Number(item.aiVisibility || 0), 0) / competitors.length)
    : 0;
  const competitionLevel = hasLiveCompetitors ? clampScore(Math.round(difficultyScore * 10), 20, 95) : 0;
  const directoryDominance = hasVisibleResults ? clampScore(Math.round(((directoryOrReviewCount + socialCount) / Math.max(dedupedOrderedResults.length, 1)) * 100), 0, 100) : 0;
  const localBusinessVisibility = hasVisibleResults ? clampScore(Math.round((localBusinessCount / Math.max(dedupedOrderedResults.length, 1)) * 100), 0, 100) : 0;
  const marketActivity = hasVisibleResults ? clampScore(Math.round((Math.min(rawVisibleResults.length, 30) / 30) * 100), 20, 100) : 0;
  const opportunityScore = hasVisibleResults ? clampScore(Math.round((100 - competitionLevel) * 0.45 + directoryDominance * 0.35 + (100 - localBusinessVisibility) * 0.2), 10, 95) : 0;
  const leadPotential = hasVisibleResults ? clampScore(Math.round((marketActivity * 0.45) + (opportunityScore * 0.55)), 10, 95) : 0;
  const summaryScores = {
    marketActivity,
    competitionLevel,
    directoryDominance,
    localBusinessVisibility,
    opportunityScore,
    leadPotential
  };
  const issues = hasVisibleResults ? [
    {
      category: 'market',
      title: 'Competitive landscape',
      severity: industryAnalysis.overview.marketStrength === 'High' ? 'high' : 'medium',
      description: `This market is ${industryAnalysis.overview.marketStrength.toLowerCase()} strength with ${industryAnalysis.overview.dominantPlayers} dominant players.`
    },
    {
      category: 'dominance',
      title: 'Visibility concentration',
      severity: industryAnalysis.dominance.visibilityControlledByTop3 >= 55 ? 'high' : 'medium',
      description: `Top 3 competitors control ${industryAnalysis.dominance.visibilityControlledByTop3}% of observed visibility in this run.`
    },
    {
      category: 'opportunity',
      title: 'Entry opportunity',
      severity: industryAnalysis.opportunities.weakCompetitorsInTop10.length ? 'low' : 'medium',
      description: industryAnalysis.opportunities.keyOpportunities[0] || 'No clear easy entry positions were detected.'
    },
    {
      category: 'quality',
      title: 'Weak competitor websites still rank',
      severity: 'medium',
      description: industryAnalysis.summaryNarrative || 'Several visible competitors still depend more on local presence than strong websites.'
    },
    ...(limitedWarning ? [{
      category: 'quality',
      title: 'Structured local business signals are limited',
      severity: 'medium',
      description: limitedWarning
    }] : [])
  ] : [
    {
      category: 'market',
      title: 'Live market data unavailable',
      severity: 'high',
      description: 'Search returned no results for this market query set.'
    }
  ];
  const fixes = hasLiveCompetitors ? (industryAnalysis.strategy.howToBreakIntoTop10 || []).map((step) => ({
    category: 'strategy',
    title: step.focusArea,
    description: step.action,
    priority: step.priority <= 2 ? 'high' : 'medium'
  })) : [];

  return {
    queryType: 'market',
    input: {
      industry,
      city,
      state,
      zip
    },
    dataQuality,
    sourceNote,
    summaryScores,
    industryAnalysis: {
      ...industryAnalysis,
      overview: {
        ...industryAnalysis.overview,
        primaryQuery,
        executedQueries: queries,
        orderedResults: dedupedOrderedResults,
        rawVisibleResults,
        rawOrderedResults: orderedResults,
        localPackResults: localPackRows,
        directorySignals,
        warning: hasVisibleResults ? limitedWarning : 'Search returned no results.',
        sourceConfidence,
        sourceLabel: sourceNote
      }
    },
    issues,
    fixes,
    competitors: industryAnalysis.competitors,
    screenshots: uniqueScreenshots
  };
}

function formatRankLabel(rank) {
  const numeric = Number(rank);
  return Number.isFinite(numeric) && numeric > 0 ? `#${numeric}` : 'Not in Top 10';
}

function buildQueryEngineRows(row) {
  const googleRank = Number.isFinite(Number(row?.clientOrganicRank))
    ? Number(row.clientOrganicRank)
    : (Number.isFinite(Number(row?.clientLocalPackRank)) ? Number(row.clientLocalPackRank) : null);
  const googleType = Number.isFinite(Number(row?.clientOrganicRank))
    ? 'Organic'
    : (Number.isFinite(Number(row?.clientLocalPackRank)) ? 'Map Pack' : 'Not visible');
  return [
    {
      engine: 'Google',
      rankLabel: formatRankLabel(googleRank),
      resultType: googleType,
      status: row?.error ? 'partial' : 'live',
      note: row?.error
        ? 'Google result unavailable for this query in this run.'
        : (row?.takeaway || 'Google ranking checked live for this query.')
    },
    {
      engine: 'Bing',
      rankLabel: 'Unavailable',
      resultType: 'No live connector',
      status: 'unavailable',
      note: 'Bing engine tracking is not connected in this build yet.'
    },
    {
      engine: 'DuckDuckGo',
      rankLabel: 'Unavailable',
      resultType: 'No live connector',
      status: 'unavailable',
      note: 'DuckDuckGo engine tracking is not connected in this build yet.'
    },
    {
      engine: 'Yahoo',
      rankLabel: 'Unavailable',
      resultType: 'No live connector',
      status: 'unavailable',
      note: 'Yahoo engine tracking is not connected in this build yet.'
    }
  ];
}

function buildWebsiteSearchPositioning(result, input) {
  const local = result?.localSearchVisibility || {};
  const rows = Array.isArray(local.results) ? local.results.slice(0, 3) : [];
  const summary = local.summary || {};
  const inputCity = normalizeString(input?.city);
  const inputState = normalizeString(input?.state);
  const inputIndustry = normalizeString(input?.industry) || 'your industry';
  const marketLabel = [inputCity, inputState].filter(Boolean).join(', ') || 'your market';
  return {
    title: 'The way people search for services and products has changed.',
    subtitle: 'The way a business is positioned and ranked has also changed.',
    message: 'You do not have to post and pray. Most businesses still do. That leaves room to move far ahead of competitors who still do not understand what it now takes to become and remain the obvious choice.',
    auditLead: `Every audit starts by checking the top three ${inputIndustry} queries in ${marketLabel} and showing where the business ranks first.`,
    summary: normalizeString(summary.interpretation) || 'Customers are seeing your competitors before they see you.',
    queryCount: rows.length,
    queries: rows.map((row, index) => {
      const topCompetitorDomains = Array.isArray(row?.topCompetitorDomains) ? row.topCompetitorDomains.slice(0, 3) : [];
      return {
        rank: index + 1,
        query: normalizeString(row?.query),
        location: normalizeString(row?.location) || marketLabel,
        takeaway: normalizeString(row?.takeaway),
        topCompetitors: topCompetitorDomains,
        engines: buildQueryEngineRows(row)
      };
    })
  };
}

function averageMetric(items, selector) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => Number(selector(item)))
    .filter((value) => Number.isFinite(value));
  if (!values.length) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function scoreFromPassRate(passed, total) {
  if (!total) return 0;
  return clampPercent((passed / total) * 100);
}

function matrixStatus(yourScore, competitorAverage) {
  const avg = Number(competitorAverage);
  if (!Number.isFinite(avg)) {
    return yourScore >= 70 ? 'strong' : (yourScore >= 50 ? 'average' : 'weak');
  }
  if (yourScore >= avg + 8) return 'strong';
  if (yourScore <= avg - 8) return 'weak';
  return 'average';
}

function buildMatrixRow({
  label,
  matrix,
  judgedBy,
  yourScore,
  competitorAverage,
  note
}) {
  return {
    label,
    matrix,
    judgedBy,
    yourScore: clampPercent(yourScore),
    competitorAverage: Number.isFinite(Number(competitorAverage)) ? clampPercent(competitorAverage) : null,
    status: matrixStatus(clampPercent(yourScore), competitorAverage),
    note: normalizeString(note)
  };
}

function buildGoogleRankingMatrix(result, competitors) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const byKey = new Map(checks.map((item) => [normalizeString(item?.key), item]));
  const userScores = mapSummaryScoresFromAudit(result);
  const competitorRows = Array.isArray(competitors) ? competitors : [];
  const avgSeo = averageMetric(competitorRows, (item) => item?.scoreSummary?.seo);
  const avgAuthority = averageMetric(competitorRows, (item) => item?.scoreSummary?.authority);
  const avgLocal = averageMetric(competitorRows, (item) => item?.scoreSummary?.local);
  const googleGrade = Number(result?.googleGrades?.seo);
  const trustLevel = normalizeString(result?.trustDesign?.level).toLowerCase();
  const trustScore = trustLevel === 'strong' ? 88 : (trustLevel === 'moderate' ? 64 : 38);

  const relevanceKeys = ['title', 'meta-description', 'h1'];
  const relevancePassed = relevanceKeys.filter((key) => byKey.get(key)?.status === 'PASS').length;
  const crawlKeys = ['canonical', 'robots-meta', 'sitemap', 'robots-txt', 'structured-data', 'image-alt'];
  const crawlPassed = crawlKeys.filter((key) => byKey.get(key)?.status === 'PASS').length;
  const contentKeys = ['thin-content', 'paragraph-depth', 'repetitive-content'];
  const contentPassed = contentKeys.filter((key) => byKey.get(key)?.status === 'PASS').length;

  return {
    title: 'Google Ranking Matrix',
    intro: 'After the live Google query breakdown, show the factors that decide positioning, how each factor is judged, and how your site compares with the average competitor signal.',
    rows: [
      buildMatrixRow({
        label: 'Search Relevance',
        matrix: 'How well the page matches service + location intent in title, meta description, and H1.',
        judgedBy: 'Title, meta description, and single-H1 alignment.',
        yourScore: scoreFromPassRate(relevancePassed, relevanceKeys.length),
        competitorAverage: avgSeo,
        note: 'This is the first relevance layer Google uses to decide whether the page directly answers the query.'
      }),
      buildMatrixRow({
        label: 'Technical Foundation',
        matrix: 'Whether the page can be crawled, understood, and trusted technically.',
        judgedBy: 'Canonical, robots meta, sitemap, robots.txt, schema, image alt, and Google SEO grade.',
        yourScore: Math.round((scoreFromPassRate(crawlPassed, crawlKeys.length) + (Number.isFinite(googleGrade) ? googleGrade : userScores.technical)) / 2),
        competitorAverage: avgSeo,
        note: 'Weak technical hygiene makes it harder for Google to trust and rank the page consistently.'
      }),
      buildMatrixRow({
        label: 'Local Intent Coverage',
        matrix: 'How clearly the page proves it serves the target city, state, and service area.',
        judgedBy: 'Local GEO signals and live appearance across high-intent local queries.',
        yourScore: userScores.localPresence,
        competitorAverage: avgLocal,
        note: 'This is where map-pack and local organic competitors often separate from generic pages.'
      }),
      buildMatrixRow({
        label: 'Trust and Authority',
        matrix: 'Whether the page and brand feel credible enough to win clicks and conversions.',
        judgedBy: 'Trust design signals, proof, reviews, credentials, and authority indicators.',
        yourScore: trustScore,
        competitorAverage: avgAuthority,
        note: 'When competitors are close on relevance, authority and trust signals often decide who holds the stronger position.'
      }),
      buildMatrixRow({
        label: 'Content Depth and UX',
        matrix: 'How well the page answers the buyer, supports confidence, and avoids thin or repetitive content.',
        judgedBy: 'Content depth, paragraph quality, repetition checks, and overall conversion/UX score.',
        yourScore: Math.round((scoreFromPassRate(contentPassed, contentKeys.length) + userScores.conversionUx) / 2),
        competitorAverage: avgSeo,
        note: 'Google increasingly rewards pages that satisfy intent and keep users engaged instead of shallow pages that only target keywords.'
      }),
      buildMatrixRow({
        label: 'AI and Citation Readiness',
        matrix: 'How easily the page can be understood, quoted, and reused in AI-driven search journeys.',
        judgedBy: 'FAQ/Q&A blocks, structured data, and clear answer-style content.',
        yourScore: userScores.aiVisibility,
        competitorAverage: avgSeo,
        note: 'This matters because buyers are no longer only discovering businesses through classic blue-link searches.'
      })
    ]
  };
}

function buildFallbackSearchPositioning(input) {
  const industry = normalizeString(input?.industry) || 'target industry';
  const city = normalizeString(input?.city) || 'target city';
  const state = normalizeString(input?.state) || 'target state';
  const location = [city, state].filter(Boolean).join(', ');
  return {
    title: 'The way people search for services and products has changed.',
    subtitle: 'The way a business is positioned and ranked has also changed.',
    message: 'You do not have to post and pray. Most businesses still do. That leaves room to move far ahead of competitors who still do not understand what it now takes to become and remain the obvious choice.',
    auditLead: `Every audit starts by checking the top three ${industry} queries in ${location} and showing where the business ranks first.`,
    summary: 'Live ranking collection was unavailable in this run.',
    queryCount: 0,
    queries: []
  };
}

function buildFallbackGoogleRankingMatrix() {
  return {
    title: 'Google Ranking Matrix',
    intro: 'This matrix explains the factors Google uses to rank a business page. Score comparison stays empty when live audit data is unavailable.',
    rows: []
  };
}

function buildUnifiedModelFromWebsiteAudit(result, input) {
  const summaryScores = mapSummaryScoresFromAudit(result);
  const issues = buildIssuesFromAudit(result);
  const fixes = buildFixesFromAudit(result);
  const competitors = buildCompetitorsFromAudit(result, input);
  const searchPositioning = buildWebsiteSearchPositioning(result, input);
  const googleRankingMatrix = buildGoogleRankingMatrix(result, competitors);
  const localStatus = normalizeString(result?.localSearchVisibility?.status).toLowerCase();
  const dataQuality = localStatus === 'ok' && result?.googleGradesSource === 'live_pagespeed'
    ? 'real'
    : (localStatus === 'partial' ? 'estimated' : 'estimated');
  return {
    queryType: 'website',
    input: {
      website: normalizeString(input.website),
      industry: normalizeString(input.industry),
      city: normalizeString(input.city),
      state: normalizeString(input.state)
    },
    dataQuality,
    sourceNote: dataQuality === 'real'
      ? 'live website + search signals'
      : 'partial signals with estimated components',
    summaryScores,
    searchPositioning,
    googleRankingMatrix,
    issues,
    fixes,
    competitors
  };
}

function buildWebsiteFallbackModel(input, reason) {
  const website = normalizeString(input.website);
  const industry = normalizeString(input.industry) || 'local service';
  const city = normalizeString(input.city) || 'target city';
  const state = normalizeString(input.state) || 'state';
  const summaryScores = {
    seo: 0,
    technical: 0,
    aiVisibility: 0,
    localPresence: 0,
    reputation: 0,
    conversionUx: 0
  };
  const issues = [
    {
      category: 'technical',
      title: 'Live technical scan unavailable',
      severity: 'high',
      description: 'Website could not be fully scanned in this environment. No substitute scores are being shown.'
    },
    {
      category: 'seo',
      title: 'Core metadata coverage uncertain',
      severity: 'medium',
      description: 'Title/meta/schema status could not be verified live; run a full scan when live fetch is available.'
    },
    {
      category: 'localPresence',
      title: 'Local market visibility likely inconsistent',
      severity: 'medium',
      description: `Use city + service pages and review signals for ${city} to improve visibility.`
    }
  ];
  const fixes = [
    {
      category: 'technical',
      title: 'Run full live crawl when available',
      description: 'Retry website scan with live network access to populate this report with real diagnostics.',
      priority: 'high'
    },
    {
      category: 'seo',
      title: 'Standardize core SEO tags',
      description: 'Ensure title, meta description, H1, canonical, and schema are present on top pages.',
      priority: 'high'
    },
    {
      category: 'localPresence',
      title: 'Publish city + service proof pages',
      description: `Add stronger ${industry} content with local proof for ${city}, ${state}.`,
      priority: 'medium'
    }
  ];
  return {
    queryType: 'website',
    input: {
      website,
      industry,
      city,
      state
    },
    dataQuality: 'estimated',
    sourceNote: `live website audit unavailable (${normalizeString(reason) || 'unknown reason'})`,
    summaryScores,
    searchPositioning: buildFallbackSearchPositioning({
      website,
      industry,
      city,
      state
    }),
    googleRankingMatrix: buildFallbackGoogleRankingMatrix(),
    issues,
    fixes,
    competitors: []
  };
}

function buildDashboardPackageViews(model) {
  const safe = model || {};
  const summaryScores = safe.summaryScores || {};
  const base = {
    queryType: safe.queryType || 'website',
    input: safe.input || {},
    dataQuality: safe.dataQuality || 'sample',
    sourceNote: safe.sourceNote || '',
    summaryScores,
    searchPositioning: safe.searchPositioning || null,
    googleRankingMatrix: safe.googleRankingMatrix || null
  };

  if (safe.queryType === 'market') {
    const analysis = safe.industryAnalysis || {
      overview: {},
      competitors: [],
      dominance: {},
      difficulty: {},
      opportunities: {},
      strategy: {}
    };
    const allCompetitors = Array.isArray(analysis.competitors) ? analysis.competitors : [];
    const withCompetitorSlice = (limit) => ({
      ...analysis,
      competitors: limit ? allCompetitors.slice(0, limit) : allCompetitors
    });
    return {
      score_only: {
        ...base,
        industryAnalysis: withCompetitorSlice(5),
        issues: [],
        fixes: [],
        competitors: allCompetitors.slice(0, 5),
        screenshots: Array.isArray(safe.screenshots) ? safe.screenshots.slice(0, 2) : []
      },
      scores_issues: {
        ...base,
        industryAnalysis: withCompetitorSlice(10),
        issues: [],
        fixes: [],
        competitors: allCompetitors.slice(0, 10),
        screenshots: Array.isArray(safe.screenshots) ? safe.screenshots.slice(0, 4) : []
      },
      full_data: {
        ...base,
        industryAnalysis: withCompetitorSlice(0),
        issues: [],
        fixes: [],
        competitors: allCompetitors,
        screenshots: Array.isArray(safe.screenshots) ? safe.screenshots : []
      }
    };
  }

  const issues = Array.isArray(safe.issues) ? safe.issues : [];
  const fixes = Array.isArray(safe.fixes) ? safe.fixes : [];
  const competitors = Array.isArray(safe.competitors) ? safe.competitors : [];
  return {
    score_only: {
      ...base,
      issues: [],
      fixes: [],
      competitors: []
    },
    scores_issues: {
      ...base,
      issues,
      fixes: [],
      competitors: competitors.slice(0, 5)
    },
    full_data: {
      ...base,
      issues,
      fixes,
      competitors
    }
  };
}

function filterAuditResultByPackage(fullResult, packageLevel) {
  const result = fullResult || {};
  const level = normalizePackageLevel(packageLevel);
  const localSearchVisibility = filterLocalSearchVisibilityByPackage(result.localSearchVisibility || null, level);
  const allChecks = Array.isArray(result.checks) ? result.checks : [];
  const limitedChecks = allChecks.slice(0, 8);
  const base = {
    packageLevel: level,
    finalUrl: result.finalUrl || '',
    summary: result.summary || '',
    auditMode: result.auditMode || 'business',
    scores: result.scores || {},
    siteProfile: result.siteProfile || {},
    googleGrades: result.googleGrades || null,
    googleGradesSource: result.googleGradesSource || null,
    googleGradesDebug: result.googleGradesDebug || null,
    googleGradesMessage: result.googleGradesMessage || null,
    competitiveSections: result.competitiveSections || null,
    issueCount: Number.isFinite(result.issueCount) ? result.issueCount : 0,
    quickWinCount: Number.isFinite(result.quickWinCount) ? result.quickWinCount : 0,
    estimatedShortTermLift: result.estimatedShortTermLift || { min: 0, max: 0 },
    localSearchVisibility,
    visibility: result.visibility || {}
  };

  if (level === 'free') {
    return {
      ...base,
      checks: limitedChecks,
      trustDesign: result.trustDesign || {},
      searchSnapshot: {
        query: result.searchSnapshot && result.searchSnapshot.query ? result.searchSnapshot.query : '',
        rankStatus: result.searchSnapshot && result.searchSnapshot.rankStatus ? result.searchSnapshot.rankStatus : 'unknown'
      }
    };
  }

  const silver = {
    ...base,
    checks: allChecks,
    trustDesign: result.trustDesign || {},
    visibility: result.visibility || {},
    searchSnapshot: result.searchSnapshot || {},
    recommendation: result.recommendation || {}
  };

  if (level === 'silver') {
    return silver;
  }

  if (level === 'gold') {
    return {
      ...silver,
      topFixes: Array.isArray(result.topFixes) ? result.topFixes : [],
      fullDiagnosis: Array.isArray(result.fullDiagnosis) ? result.fullDiagnosis : [],
      issueSolutions: Array.isArray(result.issueSolutions) ? result.issueSolutions : [],
      implementationRoadmap: Array.isArray(result.implementationRoadmap) ? result.implementationRoadmap : [],
      prioritizedActionPlan: Array.isArray(result.prioritizedActionPlan) ? result.prioritizedActionPlan : []
    };
  }

  return {
    ...result,
    ...base,
    packageLevel: 'admin'
  };
}

function makeAuditId({ company, website, createdAt }) {
  const source = `${normalizeString(company)}|${normalizeString(website)}|${createdAt}`;
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return `aud_${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}_${hash.toString(36).slice(0, 8)}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAuditRecord({
  contactName,
  businessName,
  businessEmail,
  phone,
  industry,
  streetAddress,
  city,
  state,
  competitorsInput,
  bestContactTime,
  followupConsent,
  competitorUrl,
  competitorNotes,
  searchQuery,
  businessCategory,
  auditMode,
  company,
  email,
  website,
  market,
  createdAt,
  auditId,
  auditResult,
  purchasedPackage,
  amountPaid,
  customerResult
}) {
  const effectiveCreatedAt = normalizeString(createdAt) || new Date().toISOString();
  const normalizedBusinessName = normalizeString(businessName || company);
  const normalizedBusinessEmail = normalizeString(businessEmail || email).toLowerCase();
  const normalizedContactName = normalizeString(contactName);
  const normalizedPhone = normalizeString(phone);
  const normalizedIndustry = normalizeString(industry);
  const normalizedStreetAddress = normalizeString(streetAddress);
  const normalizedCity = normalizeString(city);
  const normalizedState = normalizeString(state);
  const normalizedCompetitorsInput = normalizeCompetitorInput(competitorsInput);
  const normalizedBestContactTime = normalizeString(bestContactTime);
  const normalizedFollowupConsent = normalizeBool(followupConsent);
  const normalizedCompetitorUrl = normalizeString(competitorUrl);
  const normalizedCompetitorNotes = normalizeString(competitorNotes);
  const normalizedSearchQuery = normalizeString(searchQuery);
  const normalizedBusinessCategory = normalizeString(businessCategory);
  const normalizedAuditMode = normalizeAuditMode(auditMode);
  const normalizedWebsite = normalizeString(website);
  const normalizedMarket = normalizeString(market || [normalizedCity, normalizedState].filter(Boolean).join(', '));
  const normalizedPackage = normalizePackageLevel(purchasedPackage);
  const normalizedAmountPaid = resolveAmountPaid(amountPaid, normalizedPackage);
  const upgradeCreditAvailable = buildUpgradeCreditAvailable(normalizedPackage, normalizedAmountPaid);
  const result = auditResult || {};
  const filteredForCustomer = customerResult || filterAuditResultByPackage(result, normalizedPackage);
  const effectiveAuditId = normalizeString(auditId) || makeAuditId({
    company: normalizedBusinessName,
    website: normalizedWebsite,
    createdAt: effectiveCreatedAt
  });
  const reportLinks = buildReportLinks(effectiveAuditId);

  return {
    id: effectiveAuditId,
    auditId: effectiveAuditId,
    createdAt: effectiveCreatedAt,
    contactName: normalizedContactName,
    businessName: normalizedBusinessName,
    businessEmail: normalizedBusinessEmail,
    phone: normalizedPhone,
    industry: normalizedIndustry,
    businessCategory: normalizedBusinessCategory,
    streetAddress: normalizedStreetAddress,
    city: normalizedCity,
    state: normalizedState,
    competitorsInput: normalizedCompetitorsInput,
    competitorUrl: normalizedCompetitorUrl,
    competitorNotes: normalizedCompetitorNotes,
    searchQuery: normalizedSearchQuery,
    auditMode: normalizedAuditMode,
    isCompetitorExample: normalizedAuditMode === 'competitor-example',
    bestContactTime: normalizedBestContactTime,
    followupConsent: normalizedFollowupConsent,
    followupStatus: normalizedFollowupConsent ? 'pending' : 'consent_not_granted',
    company: normalizedBusinessName,
    email: normalizedBusinessEmail,
    website: normalizedWebsite,
    market: normalizedMarket,
    finalUrl: normalizeString(result.finalUrl),
    scores: result.scores || {},
    visibility: result.visibility || {},
    trustDesign: result.trustDesign || {},
    recommendation: result.recommendation || {},
    searchSnapshot: result.searchSnapshot || {},
    localSearchVisibility: result.localSearchVisibility || {},
    topFixes: Array.isArray(result.topFixes) ? result.topFixes : [],
    summary: normalizeString(result.summary),
    purchasedPackage: normalizedPackage,
    amountPaid: normalizedAmountPaid,
    upgradeCreditAvailable,
    reportLink: reportLinks.reportPath,
    reportDownloadLink: reportLinks.downloadPath,
    customerResult: filteredForCustomer,
    fullAuditResult: result
  };
}

async function saveAuditRecord(record, opts = {}) {
  const filePath = opts.filePath || path.join(ROOT, 'data', 'audits.json');
  const fsApi = opts.fsApi || fs.promises;
  const auditId = normalizeString(record && record.id);
  const tempPath = `${filePath}.tmp`;

  try {
    await fsApi.mkdir(path.dirname(filePath), { recursive: true });

    let existing = [];
    try {
      const raw = await fsApi.readFile(filePath, 'utf8');
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          return {
            saved: false,
            auditId,
            error: 'Existing audits file is not a JSON array.'
          };
        }
        existing = parsed;
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        return {
          saved: false,
          auditId,
          error: error && error.message ? error.message : 'Unable to read existing audit records.'
        };
      }
    }

    existing.push(record);
    const payload = JSON.stringify(existing, null, 2);
    await fsApi.writeFile(tempPath, payload, 'utf8');
    await fsApi.rename(tempPath, filePath);
    return { saved: true, auditId };
  } catch (error) {
    try {
      await fsApi.unlink(tempPath);
    } catch {
      // no-op cleanup
    }
    return {
      saved: false,
      auditId,
      error: error && error.message ? error.message : 'Unable to save audit record.'
    };
  }
}

async function loadAuditRecords(opts = {}) {
  const filePath = opts.filePath || path.join(ROOT, 'data', 'audits.json');
  const fsApi = opts.fsApi || fs.promises;

  try {
    const raw = await fsApi.readFile(filePath, 'utf8');
    if (!raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function getAuditRecordById(id, opts = {}) {
  const normalizedId = normalizeString(id);
  if (!normalizedId) {
    return null;
  }

  const records = await loadAuditRecords(opts);
  return records.find((record) => normalizeString(record && record.id) === normalizedId) || null;
}

function buildAuditReportHtml(record) {
  const safeRecord = record || {};
  const company = normalizeString(safeRecord.company) || 'Business';
  const website = normalizeString(safeRecord.website);
  const market = normalizeString(safeRecord.market) || 'Not specified';
  const createdAt = normalizeString(safeRecord.createdAt);
  const referenceId = normalizeString(safeRecord.id);
  const summary = normalizeString(safeRecord.summary) || 'No summary available.';
  const scores = safeRecord.scores || {};
  const reportPackageLevel = normalizePackageLevel(
    safeRecord.purchasedPackage
      || safeRecord.packageLevel
      || (safeRecord.customerResult && safeRecord.customerResult.packageLevel)
      || 'free'
  );
  const customerResult = safeRecord.customerResult || {};
  const fullAuditResult = safeRecord.fullAuditResult || {};
  const reportResult = reportPackageLevel === 'admin'
    ? ((fullAuditResult && Object.keys(fullAuditResult).length) ? fullAuditResult : customerResult)
    : customerResult;
  const visibility = reportResult.visibility || safeRecord.visibility || {};
  const trustDesign = reportResult.trustDesign || safeRecord.trustDesign || {};
  const recommendation = reportResult.recommendation || safeRecord.recommendation || {};
  const searchSnapshot = reportResult.searchSnapshot || safeRecord.searchSnapshot || {};
  const customerLocalVisibility = safeRecord.customerResult && safeRecord.customerResult.localSearchVisibility
    ? safeRecord.customerResult.localSearchVisibility
    : null;
  const localSearchVisibility = filterLocalSearchVisibilityByPackage(
    customerLocalVisibility || safeRecord.localSearchVisibility || {},
    reportPackageLevel
  );
  const localSummary = localSearchVisibility.summary || {};
  const localRows = Array.isArray(localSearchVisibility.results) ? localSearchVisibility.results : [];
  const topFixes = Array.isArray(reportResult.topFixes) ? reportResult.topFixes : [];
  const checks = Array.isArray(reportResult.checks) ? reportResult.checks : [];
  const implementationRoadmap = Array.isArray(reportResult.implementationRoadmap) ? reportResult.implementationRoadmap : [];
  const prioritizedActionPlan = Array.isArray(reportResult.prioritizedActionPlan) ? reportResult.prioritizedActionPlan : [];
  const competitors = Array.isArray(searchSnapshot.competitors) ? searchSnapshot.competitors : [];

  const scoreCell = (label, value) => `<div><strong>${label}</strong><br/>${escapeHtml(String(value || 'N/A'))}</div>`;
  const competitorRows = competitors.length
    ? competitors.map((entry) => `<li>${escapeHtml(String(entry.position || '-'))}. ${escapeHtml(entry.name || '')}</li>`).join('')
    : '<li>No reliable competitor snapshot captured in this audit.</li>';
  const topFixRows = topFixes.length
    ? topFixes.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
    : '<li>No high-priority fixes were detected in this run.</li>';
  const totalQueries = Number(localSummary.totalQueries) || 5;
  const foundInTopTen = Number(localSummary.foundInOrganicCount) || 0;
  const missingFromTopTen = Number(localSummary.missingCount) || 0;
  const appearedInMapPack = Number(localSummary.foundInLocalPackCount) || 0;
  const topCompetitorAppearanceCount = Number(localSummary.topCompetitorAppearanceCount) || 0;
  const interpretationLine = normalizeString(localSummary.interpretation)
    || 'Customers are seeing your competitors before they see you.';
  const showPerQueryBreakdown = reportPackageLevel !== 'free';
  const showScreenshots = reportPackageLevel === 'gold' || reportPackageLevel === 'admin';
  const showSolutions = reportPackageLevel === 'gold' || reportPackageLevel === 'admin';
  const failedChecks = checks.filter((item) => item && item.status === 'FIX');

  const localRowsHtml = localRows.length
    ? localRows.map((row) => {
      const topCompetitorDomains = Array.isArray(row.topCompetitorDomains) ? row.topCompetitorDomains : [];
      const topCompetitors = topCompetitorDomains.length ? topCompetitorDomains.slice(0, 3) : [];
      const hasOrganicRank = row.clientFoundOrganic && Number.isFinite(Number(row.clientOrganicRank));
      const hasMapPackRank = row.clientFoundLocalPack && Number.isFinite(Number(row.clientLocalPackRank));
      const yourRankLabel = hasOrganicRank
        ? `#${escapeHtml(String(row.clientOrganicRank))}`
        : (hasMapPackRank ? `#${escapeHtml(String(row.clientLocalPackRank))}` : 'Not in Top 10');
      const positionType = hasOrganicRank ? 'Organic' : (hasMapPackRank ? 'Map Pack' : 'Not visible');
      const competitorsAbove = hasOrganicRank && Array.isArray(row.organicResults)
        ? row.organicResults
          .filter((entry) => Number(entry.position) < Number(row.clientOrganicRank))
          .map((entry) => normalizeString(entry.domain))
          .filter(Boolean)
          .slice(0, 3)
        : [];
      const competitorsAboveLabel = competitorsAbove.length
        ? competitorsAbove.join(', ')
        : (topCompetitors.join(', ') || 'No clear competitors identified.');
      const screenshotLine = row.screenshotUrl
        ? `<a href="${escapeHtml(row.screenshotUrl)}" target="_blank" rel="noreferrer">View Screenshot</a>`
        : (row.screenshotPath ? escapeHtml(row.screenshotPath) : 'Screenshot unavailable');
      return `<tr>
        <td>${escapeHtml(row.query || 'N/A')}</td>
        <td>${yourRankLabel}</td>
        <td>${escapeHtml(positionType)}</td>
        <td>${escapeHtml(topCompetitors.join(', ') || 'No clear competitors identified.')}</td>
        <td>${escapeHtml(competitorsAboveLabel)}</td>
        ${showScreenshots ? `<td>${screenshotLine}</td>` : ''}
      </tr>`;
    }).join('')
    : `<tr><td colspan="${showScreenshots ? '6' : '5'}">Local ranking data is unavailable for this audit.</td></tr>`;
  const recurringCompetitors = Array.isArray(localSearchVisibility.topRecurringCompetitors)
    ? localSearchVisibility.topRecurringCompetitors
    : [];
  const recurringCompetitorText = recurringCompetitors.length
    ? recurringCompetitors.map((item) => `${item.domain} (${item.count})`).join(', ')
    : 'No recurring competitors identified.';
  const localSectionTitle = market !== 'Not specified' && safeRecord.industry
    ? `Your Visibility in ${market} for ${safeRecord.industry}`
    : 'Where You Rank in Your Area';
  const localRankingFixes = topFixes.slice(0, 3);
  const issueCategoryFromKey = (key) => {
    const normalized = normalizeString(key).toLowerCase();
    if (['title', 'meta-description', 'og-tags', 'google-seo'].includes(normalized)) return 'SEO';
    if (['h1', 'canonical', 'robots-meta', 'structured-data', 'sitemap', 'robots-txt', 'image-alt'].includes(normalized)) return 'Technical';
    if (['trust-signals', 'grammar'].includes(normalized)) return 'Trust';
    if (['thin-content', 'paragraph-depth', 'repetitive-content', 'faq-citation'].includes(normalized)) return 'Content';
    if (['local-geo'].includes(normalized)) return 'Local GEO';
    return 'Other';
  };
  const categoryMap = failedChecks.reduce((acc, issue) => {
    const category = issueCategoryFromKey(issue.key);
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(issue);
    return acc;
  }, {});
  const categoryRows = Object.keys(categoryMap).length
    ? Object.keys(categoryMap)
      .sort((a, b) => categoryMap[b].length - categoryMap[a].length || a.localeCompare(b))
      .map((category) => `<li><strong>${escapeHtml(category)}:</strong> ${escapeHtml(String(categoryMap[category].length))} issue(s)</li>`)
      .join('')
    : '<li>No major technical issues detected in current package output.</li>';
  const structuralRows = failedChecks
    .filter((issue) => ['Technical', 'Local GEO'].includes(issueCategoryFromKey(issue.key)))
    .slice(0, 6)
    .map((issue) => `<li>${escapeHtml(issue.message || '')}</li>`)
    .join('') || '<li>No major structural issues detected.</li>';
  const seoRows = failedChecks
    .filter((issue) => issueCategoryFromKey(issue.key) === 'SEO')
    .slice(0, 6)
    .map((issue) => `<li>${escapeHtml(issue.message || '')}</li>`)
    .join('') || '<li>No major SEO issues detected.</li>';
  const failedIssueRows = failedChecks.length
    ? failedChecks.slice(0, 12).map((issue) => `<li><strong>${escapeHtml(issueCategoryFromKey(issue.key))}</strong>: ${escapeHtml(issue.message || '')}</li>`).join('')
    : '<li>No failing checks found.</li>';
  const roadmapRows = implementationRoadmap.length
    ? implementationRoadmap.slice(0, 8).map((item) => `<li>Step ${escapeHtml(String(item.step || ''))}: ${escapeHtml(item.title || '')} (${escapeHtml(item.phase || '')})</li>`).join('')
    : '<li>No implementation roadmap available in this package.</li>';
  const actionPlanRows = prioritizedActionPlan.length
    ? prioritizedActionPlan.slice(0, 8).map((item) => `<li>${escapeHtml(String(item.priority || '-'))}. ${escapeHtml(item.action || '')}</li>`).join('')
    : '<li>No prioritized action plan available in this package.</li>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>GeoNeo AI Audit Report - ${escapeHtml(company)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #1a1a1a; line-height: 1.5; }
    .wrap { max-width: 900px; margin: 0 auto; }
    h1, h2, h3 { margin: 0 0 8px; }
    .meta, .card { border: 1px solid #ddd; border-radius: 10px; padding: 14px; margin: 12px 0; }
    .scores { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #e5e5e5; padding: 8px; text-align: left; vertical-align: top; font-size: 13px; }
    th { background: #fafafa; }
    ul { margin: 8px 0 0 18px; }
    .small { color: #555; font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>GeoNeo AI Audit Report</h1>
    <p class="small">Reference ID: ${escapeHtml(referenceId)}</p>
    <div class="meta">
      <div><strong>Company:</strong> ${escapeHtml(company)}</div>
      <div><strong>Website:</strong> ${escapeHtml(website || 'N/A')}</div>
      <div><strong>Market:</strong> ${escapeHtml(market)}</div>
      <div><strong>Created:</strong> ${escapeHtml(createdAt || 'N/A')}</div>
    </div>

    <div class="card">
      <h2>Executive Summary</h2>
      <p>${escapeHtml(summary)}</p>
    </div>

    <div class="card">
      <h2>Scores</h2>
      <div class="scores">
        ${scoreCell('Overall', `${scores.overall || 'N/A'}/100`)}
        ${scoreCell('SEO', `${scores.seo || 'N/A'}/100`)}
        ${scoreCell('AI', `${scores.ai || 'N/A'}/100`)}
        ${scoreCell('GEO', `${scores.geo || 'N/A'}/100`)}
      </div>
    </div>

    <div class="card">
      <h2>Real World Search Audit</h2>
      <h3>Where You Rank in Your Area</h3>
      <p class="small"><strong>Search Audit = real-world outcome.</strong></p>
      <p><strong>${escapeHtml(localSectionTitle)}</strong></p>
      <p><strong>Found in Top 10:</strong> ${escapeHtml(String(foundInTopTen))} / ${escapeHtml(String(totalQueries))}</p>
      <p><strong>Missing from Top 10:</strong> ${escapeHtml(String(missingFromTopTen))} / ${escapeHtml(String(totalQueries))}</p>
      <p><strong>Appeared in Map Pack:</strong> ${escapeHtml(String(appearedInMapPack))} / ${escapeHtml(String(totalQueries))}</p>
      <p><strong>Top Competitor Appears:</strong> ${escapeHtml(String(topCompetitorAppearanceCount))} / ${escapeHtml(String(totalQueries))}</p>
      <p><strong>Visibility summary:</strong> ${escapeHtml(localSearchVisibility.visibilitySummary || 'No local visibility summary available.')}</p>
      <p><strong>${escapeHtml(visibility.level || 'unknown')}</strong></p>
      <p>${escapeHtml(visibility.message || 'No visibility insight available.')}</p>
      <p><strong>Customers are seeing your competitors before you.</strong></p>
      <p><strong>Query:</strong> ${escapeHtml(searchSnapshot.query || 'N/A')}</p>
      <p><strong>Rank Status:</strong> ${escapeHtml(searchSnapshot.rankStatus || 'unknown')}</p>
      <h3>Top Competitors</h3>
      <ul>${competitorRows}</ul>
      <p><strong>What this means:</strong> ${escapeHtml(interpretationLine)}</p>
      ${showPerQueryBreakdown ? `
      <h3>Rankings</h3>
      <table>
        <thead>
          <tr>
            <th>Search</th>
            <th>Your Rank</th>
            <th>Position Type</th>
            <th>Top 3 Competitors</th>
            <th>Competitors Above You</th>
            ${showScreenshots ? '<th>Screenshot</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${localRowsHtml}
        </tbody>
      </table>
      ` : '<p class="small">Basic package shows visibility summary only. Upgrade to Silver to unlock rankings and competitor-by-query detail.</p>'}
      ${showScreenshots ? `
      <p><strong>Screenshots (Gold):</strong> Search-result screenshot links are included in the rankings table above.</p>
      <p><strong>Deeper competitor pattern:</strong> ${escapeHtml(recurringCompetitorText)}</p>
      <p><strong>Recommended visibility fixes:</strong> ${escapeHtml(localRankingFixes.length ? localRankingFixes.join(' | ') : 'No specific local fixes captured yet.')}</p>
      ` : ''}
    </div>

    <div class="card">
      <p><strong>Your visibility results above are directly impacted by the issues below.</strong></p>
    </div>

    <div class="card">
      <h2>Technical Audit</h2>
      <h3>What's Holding Your Website Back</h3>
      <p class="small"><strong>Technical Audit = underlying cause.</strong></p>
      <h3>Structural Issues</h3>
      <ul>${structuralRows}</ul>
      <h3>SEO Problems</h3>
      <ul>${seoRows}</ul>
      <h3>Issue Categories</h3>
      <ul>${categoryRows}</ul>
      ${reportPackageLevel === 'free'
        ? '<p class="small">Basic package includes a limited technical summary. Upgrade to Silver for full issue list and rankings context.</p>'
        : `<h3>Issue Details</h3><ul>${failedIssueRows}</ul>`}
      <h3>Trust / Design Insight</h3>
      <p><strong>${escapeHtml(trustDesign.level || 'unknown')}</strong></p>
      <ul>${(Array.isArray(trustDesign.reasons) && trustDesign.reasons.length ? trustDesign.reasons : ['No trust/design details available.']).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>
      <h3>Recommended Plan</h3>
      <p><strong>${escapeHtml(recommendation.recommendedPlan || 'Audit')}</strong></p>
      <p>${escapeHtml(recommendation.message || '')}</p>
      <p class="small">${escapeHtml(recommendation.projection || '')}</p>
    </div>

    ${showSolutions ? `
    <div class="card">
      <h2>Solution Plan</h2>
      <p><strong>Gold includes fixes and strategy.</strong></p>
      <h3>Top Fixes</h3>
      <ul>${topFixRows}</ul>
      <h3>Implementation Roadmap</h3>
      <ul>${roadmapRows}</ul>
      <h3>Prioritized Action Plan</h3>
      <ul>${actionPlanRows}</ul>
      <h3>Neo Club</h3>
      <p>Gold members get ongoing strategy updates, expert guides, and private briefings.</p>
      <p><a href="/neo-club.html?auditId=${encodeURIComponent(referenceId)}">Access Neo Club</a></p>
    </div>
    ` : ''}

    <div class="card">
      <h2>Next Step</h2>
      <p>This report now flows from problem to explanation to solution. Reply with your reference ID to request implementation timeline support.</p>
    </div>
  </div>
</body>
</html>`;
}

function clampScore(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function countWords(text) {
  if (!text) {
    return 0;
  }
  return text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean).length;
}

function getParagraphStats(html) {
  const paragraphMatches = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
  if (!paragraphMatches.length) {
    return { count: 0, avgWords: 0 };
  }

  const wordCounts = paragraphMatches.map((paragraphHtml) => {
    const normalized = paragraphHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return countWords(normalized);
  });

  const totalWords = wordCounts.reduce((sum, value) => sum + value, 0);
  return {
    count: paragraphMatches.length,
    avgWords: Math.round(totalWords / paragraphMatches.length)
  };
}

function looksRepetitive(text) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ').filter(Boolean);
  if (words.length < 80) {
    return false;
  }

  const uniqueWords = new Set(words);
  const lexicalDiversity = uniqueWords.size / words.length;

  const sentenceCandidates = normalized
    .split(/[.!?]/)
    .map((s) => s.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((s) => {
      const wc = countWords(s);
      return wc >= 3 && wc <= 16;
    });

  const frequency = new Map();
  sentenceCandidates.forEach((sentence) => {
    frequency.set(sentence, (frequency.get(sentence) || 0) + 1);
  });

  const repeatedLines = [...frequency.values()].filter((count) => count > 1).length;
  const repetitionRatio = sentenceCandidates.length
    ? repeatedLines / sentenceCandidates.length
    : 0;

  return lexicalDiversity < 0.32 || repetitionRatio > 0.25;
}

function getTrustSignalCount(html, text) {
  const source = `${html}\n${text}`.toLowerCase();
  const checks = [
    /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, // phone
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/, // email
    /\b(testimonial|testimonials|review|reviews|trusted)\b/,
    /\b(insured|licensed|locally owned|family owned|years of experience|serving)\b/,
    /\b(address|location|service area|serving|missouri|branson|mo)\b/,
    /\b(contact us|call now|request a quote|get an estimate|book now)\b/
  ];

  return checks.reduce((count, pattern) => count + (pattern.test(source) ? 1 : 0), 0);
}

function assessTrustDesign({ html, visibleText, trustSignalCount, headingCount, imageCount, wordCount }) {
  const source = `${html}\n${visibleText}`.toLowerCase();
  const reasons = [];

  const hasPhone = /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(source);
  const hasEmail = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/.test(source);
  const hasContactClarity = /\b(contact us|call now|get in touch|request a quote|get an estimate)\b/.test(source);
  const hasProof = /\b(testimonial|testimonials|review|reviews|trusted|case study)\b/.test(source);
  const hasCredentials = /\b(licensed|insured|locally owned|family owned|years of experience|serving)\b/.test(source);
  const hasStrongCta = /\b(call now|request a quote|get an estimate|book now|schedule)\b/.test(source);
  const fillerHeavy = /\b(lorem ipsum|best in the world|one stop shop|quality service guaranteed)\b/.test(source);

  if (!hasPhone || !hasEmail || !hasContactClarity) {
    reasons.push('Contact and credibility signals are incomplete.');
  }
  if (!hasStrongCta) {
    reasons.push('Calls to action are weak, which can reduce lead conversion.');
  }
  if (!hasProof) {
    reasons.push('Proof elements like testimonials or reviews are missing.');
  }
  if (!hasCredentials) {
    reasons.push('Credential language is limited (licensed, insured, years of experience, local ownership).');
  }
  if (headingCount < 3) {
    reasons.push('Content structure is light and may feel less trustworthy to visitors.');
  }
  if (imageCount < 2 && wordCount > 200) {
    reasons.push('Visual proof is limited for a service-oriented page.');
  }
  if (fillerHeavy) {
    reasons.push('Generic filler wording can make the page feel templated.');
  }

  let level = 'strong';
  if (reasons.length >= 4) {
    level = 'weak';
  } else if (reasons.length >= 2) {
    level = 'moderate';
  }

  return { level, reasons };
}

function generateRecommendation({ overallScore, rankStatus, trustDesignLevel, failCount }) {
  if (overallScore >= 85 && trustDesignLevel === 'strong' && (rankStatus === 'top' || rankStatus === 'mid') && failCount <= 3) {
    return {
      recommendedPlan: 'Platinum',
      projection: 'Protect and defend current visibility while compounding trust and conversion performance.',
      message: 'Your baseline is strong. A managed growth loop can protect current positions and improve lead quality over time.'
    };
  }

  if (overallScore < 55 || rankStatus === 'low' || rankStatus === 'not_found' || trustDesignLevel === 'weak' || failCount >= 8) {
    return {
      recommendedPlan: 'Gold',
      projection: 'Increase visibility and trust with a structured implementation roadmap.',
      message: 'You need a deeper fix plan to improve into stronger positions and convert search traffic more reliably.'
    };
  }

  if (overallScore < 80 || rankStatus === 'mid' || trustDesignLevel === 'moderate') {
    return {
      recommendedPlan: 'Silver',
      projection: 'Improve core gaps and move toward stronger local search performance.',
      message: 'You have momentum, but key issues are still limiting growth. A focused improvement plan is recommended.'
    };
  }

  return {
    recommendedPlan: 'Audit',
    projection: 'Clarify priorities before heavier investment.',
    message: 'Start with a targeted audit to confirm the highest-impact next actions.'
  };
}

function calculateOverallScore({
  h1Count,
  grammarErrorCount,
  hasLocalSignals,
  fixCount,
  googleGrades,
  thinContent,
  repetitiveContent,
  weakTrustSignals,
  trustDesignLevel
}) {
  let score = 100;

  if (h1Count !== 1) {
    score -= 15;
  }

  if (typeof grammarErrorCount === 'number') {
    if (grammarErrorCount > 20) {
      score -= 25;
    } else if (grammarErrorCount > 5) {
      score -= 10;
    }
  }

  if (!hasLocalSignals) {
    score -= 10;
  }

  if (thinContent) {
    score -= 15;
  }

  if (repetitiveContent) {
    score -= 10;
  }

  const inferredTrustLevel = trustDesignLevel || (weakTrustSignals ? 'weak' : 'strong');
  if (inferredTrustLevel === 'weak') {
    score -= 15;
  } else if (inferredTrustLevel === 'moderate') {
    score -= 5;
  }

  if (fixCount >= 5) {
    score -= 15;
  }

  if (googleGrades && googleGrades.performance < 50) {
    score = Math.min(score, 65);
  }

  if (googleGrades && googleGrades.seo < 60) {
    score = Math.min(score, 70);
  }

  if (thinContent && inferredTrustLevel === 'weak') {
    score = Math.min(score, 60);
  }

  return clampScore(score, 20, 100);
}

function fixPriority(check) {
  const key = check.key || '';

  if (key === 'h1') {
    return 1;
  }
  if (key === 'grammar') {
    return 2;
  }
  if (key === 'thin-content' || key === 'paragraph-depth') {
    return 3;
  }
  if (key === 'trust-signals') {
    return 4;
  }
  if (key === 'local-geo') {
    return 5;
  }
  if (key === 'google-seo') {
    return 6;
  }
  if (['title', 'meta-description', 'canonical', 'robots-meta', 'og-tags'].includes(key)) {
    return 7;
  }
  if (key === 'structured-data') {
    return 8;
  }
  if (key === 'repetitive-content') {
    return 9;
  }
  return 99;
}

function prioritizeTopFixes(checks) {
  return checks
    .filter((check) => check.status === 'FIX')
    .sort((a, b) => fixPriority(a) - fixPriority(b))
    .slice(0, 5)
    .map((check) => check.message);
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function runLanguageCheck(text) {
  const payload = new URLSearchParams({
    language: 'en-US',
    text: text.slice(0, 4000)
  });

  try {
    const response = await fetch('https://api.languagetool.org/v2/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: payload
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      count: Array.isArray(data.matches) ? data.matches.length : 0
    };
  } catch {
    return null;
  }
}

async function runGoogleGrades(url, debugRef = null) {
  const cached = pageSpeedCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    if (debugRef && typeof debugRef === 'object') {
      debugRef.reason = cached.reason || null;
      debugRef.message = cached.message || null;
    }
    return cached.grades;
  }

  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', 'mobile');
  endpoint.searchParams.append('category', 'seo');
  endpoint.searchParams.append('category', 'performance');
  endpoint.searchParams.append('category', 'best-practices');
  endpoint.searchParams.append('category', 'accessibility');

  if (process.env.PAGESPEED_API_KEY) {
    endpoint.searchParams.set('key', process.env.PAGESPEED_API_KEY);
  }

  if (debugRef && typeof debugRef === 'object') {
    debugRef.reason = null;
    debugRef.message = null;
  }

  const requestUrl = endpoint.toString();

  let timeout = null;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), PAGESPEED_TIMEOUT_MS);
    const response = await fetch(requestUrl, { signal: controller.signal });
    clearTimeout(timeout);
    timeout = null;
    if (!response.ok) {
      const reason = `pagespeed_http_${response.status}`;
      if (debugRef && typeof debugRef === 'object') {
        debugRef.reason = reason;
        if (response.status === 429) {
          debugRef.message = PAGESPEED_429_MESSAGE;
        } else if (response.status === 400) {
          debugRef.message = PAGESPEED_400_MESSAGE;
        } else {
          debugRef.message = null;
        }
      }
      console.error('[runGoogleGrades] request failed', {
        requestUrl,
        status: response.status,
        message: reason
      });
      if (response.status === 429) {
        pageSpeedCache.set(url, {
          grades: null,
          reason,
          message: PAGESPEED_429_MESSAGE,
          expiresAt: Date.now() + PAGESPEED_CACHE_TTL_MS
        });
      } else if (response.status === 400) {
        pageSpeedCache.set(url, {
          grades: null,
          reason,
          message: PAGESPEED_400_MESSAGE,
          expiresAt: Date.now() + PAGESPEED_CACHE_TTL_MS
        });
      }
      return null;
    }

    const data = await response.json();
    const categories = data?.lighthouseResult?.categories;
    if (!categories) {
      const reason = 'pagespeed_no_categories';
      if (debugRef && typeof debugRef === 'object') {
        debugRef.reason = reason;
      }
      console.error('[runGoogleGrades] missing categories', {
        requestUrl,
        status: response.status,
        message: reason
      });
      return null;
    }

    const grades = {
      seo: Math.round((categories.seo?.score || 0) * 100),
      performance: Math.round((categories.performance?.score || 0) * 100),
      bestPractices: Math.round((categories['best-practices']?.score || 0) * 100),
      accessibility: Math.round((categories.accessibility?.score || 0) * 100)
    };
    pageSpeedCache.set(url, {
      grades,
      reason: null,
      message: null,
      expiresAt: Date.now() + PAGESPEED_CACHE_TTL_MS
    });
    return grades;
  } catch (error) {
    const code = (error && error.cause && error.cause.code) || (error && error.code) || null;
    let reason = 'pagespeed_fetch_failed';
    let message = PAGESPEED_GENERIC_MESSAGE;
    if (error && error.name === 'AbortError') {
      reason = 'pagespeed_timeout';
      message = PAGESPEED_TIMEOUT_MESSAGE;
    } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      reason = 'pagespeed_dns_failed';
      message = PAGESPEED_DNS_MESSAGE;
    } else if (FETCH_TLS_CODES.has(code)) {
      reason = 'pagespeed_tls_failed';
      message = PAGESPEED_TLS_MESSAGE;
    } else if (code === 'ECONNREFUSED') {
      reason = 'pagespeed_connection_refused';
      message = PAGESPEED_CONNECTION_MESSAGE;
    } else if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      reason = 'pagespeed_timeout';
      message = PAGESPEED_TIMEOUT_MESSAGE;
    }
    if (debugRef && typeof debugRef === 'object') {
      debugRef.reason = reason;
      debugRef.message = message;
    }
    console.error('[runGoogleGrades] fetch failed', {
      requestUrl,
      status: null,
      message: error && error.message ? error.message : reason,
      causeCode: code
    });
    return null;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function buildEstimatedGoogleGrades({
  title,
  metaDescription,
  h1Count,
  canonical,
  robotsMeta,
  ogTitle,
  ogDesc,
  schemaCount,
  imgWithoutAlt,
  imageCount,
  headingCount,
  hasLocalSignals,
  sitemapOk,
  robotsOk,
  thinContent,
  repetitiveContent,
  grammarErrorCount,
  trustDesignLevel,
  fetchMs
}) {
  let seo = 48;
  if (title.length >= 20 && title.length <= 60) seo += 8;
  if (metaDescription.length >= 120 && metaDescription.length <= 170) seo += 8;
  if (h1Count === 1) seo += 8;
  if (canonical) seo += 5;
  if (robotsMeta) seo += 5;
  if (ogTitle && ogDesc) seo += 4;
  if (schemaCount > 0) seo += 6;
  if (sitemapOk) seo += 4;
  if (robotsOk) seo += 3;
  if (hasLocalSignals) seo += 7;
  if (thinContent) seo -= 8;
  if (repetitiveContent) seo -= 5;

  let performance = 74;
  if (typeof fetchMs === 'number') {
    if (fetchMs > 8000) performance -= 16;
    else if (fetchMs > 5000) performance -= 10;
    else if (fetchMs > 2500) performance -= 6;
    else if (fetchMs < 1200) performance += 4;
  }
  if (imageCount > 30) performance -= 8;
  else if (imageCount > 18) performance -= 4;
  if (imgWithoutAlt > 0) performance -= 3;

  let bestPractices = 66;
  if (canonical) bestPractices += 5;
  if (robotsMeta) bestPractices += 5;
  if (ogTitle && ogDesc) bestPractices += 4;
  if (schemaCount > 0) bestPractices += 5;
  if (repetitiveContent) bestPractices -= 4;
  if (trustDesignLevel === 'strong') bestPractices += 4;
  else if (trustDesignLevel === 'weak') bestPractices -= 6;

  let accessibility = 70;
  if (imageCount === 0 || imgWithoutAlt === 0) accessibility += 8;
  else if (imgWithoutAlt > 0) accessibility -= Math.min(10, imgWithoutAlt);
  if (headingCount >= 3) accessibility += 4;
  if (typeof grammarErrorCount === 'number') {
    if (grammarErrorCount <= 5) accessibility += 4;
    else if (grammarErrorCount > 20) accessibility -= 8;
    else accessibility -= 3;
  }

  return {
    seo: clampScore(Math.round(seo), 20, 100),
    performance: clampScore(Math.round(performance), 20, 100),
    bestPractices: clampScore(Math.round(bestPractices), 20, 100),
    accessibility: clampScore(Math.round(accessibility), 20, 100)
  };
}

function buildFetchFailureMessage(code) {
  if (!code) {
    return 'Unable to fetch target website right now. Please try again.';
  }

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'The website domain could not be resolved. Check the URL spelling and confirm DNS is live.';
  }

  if (FETCH_TLS_CODES.has(code)) {
    return 'The website TLS certificate chain could not be verified from this environment.';
  }

  if (code === 'ECONNREFUSED') {
    return 'The target website refused the connection.';
  }

  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'The target website timed out during connection.';
  }

  return 'Unable to fetch target website right now. Please try again.';
}

async function existsUrl(url) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    return res.ok;
  } catch {
    return false;
  }
}

function insecureFetchWithHttps(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const visited = new Set();
    const maxRedirects = typeof options.maxRedirects === 'number' ? options.maxRedirects : 5;
    const headers = options.headers || {};

    function requestUrl(currentUrl, redirectCount) {
      if (visited.has(currentUrl)) {
        reject(new Error('Redirect loop detected.'));
        return;
      }
      visited.add(currentUrl);

      const parsedUrl = new URL(currentUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;
      const requestOptions = {
        method: 'GET',
        headers
      };
      if (parsedUrl.protocol === 'https:') {
        requestOptions.rejectUnauthorized = false;
      }

      const req = transport.request(parsedUrl, requestOptions, (res) => {
        const status = typeof res.statusCode === 'number' ? res.statusCode : 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && redirectCount < maxRedirects) {
          const nextUrl = new URL(location, parsedUrl).toString();
          res.resume();
          requestUrl(nextUrl, redirectCount + 1);
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            ok: status >= 200 && status < 300,
            status,
            url: parsedUrl.toString(),
            text: async () => Buffer.concat(chunks).toString('utf8')
          });
        });
      });

      req.on('error', reject);
      req.end();
    }

    requestUrl(targetUrl, 0);
  });
}

function extractDomainToken(hostname) {
  const base = hostname.replace(/^www\./i, '');
  const parts = base.split('.').filter(Boolean);
  return (parts[0] || '').toLowerCase();
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeLabel(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isIrrelevantMarketResult(entry) {
  const cleanUrl = unwrapSearchRedirectUrl(entry && entry.url);
  return isJunkMarketResult({
    ...entry,
    url: cleanUrl,
    host: extractHostFromUrl(cleanUrl) || entry?.host
  });
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, ' ')
    .replace(/&nbsp;/g, ' ');
}

function safeDecodeUri(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return String(value || '');
  }
}

function extractHostFromUrl(url) {
  try {
    return new URL(unwrapSearchRedirectUrl(url)).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function parseReviewCount(text) {
  const normalized = normalizeString(text).replace(/,/g, '');
  const explicit = normalized.match(/(\d{1,7})\s+reviews?\b/i);
  if (explicit) {
    const value = Number(explicit[1]);
    return Number.isFinite(value) ? value : null;
  }
  const rated = normalized.match(/\b\d(\.\d)?\s*\((\d{1,7})\)/);
  if (rated) {
    const value = Number(rated[2]);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function tokenizeKeywords(text) {
  const stop = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'our', 'are', 'was', 'were', 'have',
    'has', 'had', 'about', 'into', 'over', 'under', 'near', 'best', 'top', 'local', 'service', 'services',
    'company', 'business', 'home', 'page', 'official', 'inc', 'llc', 'co', 'us'
  ]);
  return normalizeLabel(text)
    .split(' ')
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function countKeywords(items) {
  const counts = new Map();
  (items || []).forEach((item) => {
    const current = counts.get(item) || 0;
    counts.set(item, current + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term, count]) => ({ term, count }));
}

function getLocationTokens(location) {
  return normalizeLabel(location)
    .split(' ')
    .filter((token) => token.length >= 3);
}

function hasLocationPageSignal(url, locationTokens) {
  const normalizedUrl = normalizeString(url).toLowerCase();
  if (!normalizedUrl) {
    return false;
  }
  if (/\/(locations?|service-areas?|areas-served|cities|city)\b/.test(normalizedUrl)) {
    return true;
  }
  return locationTokens.some((token) => normalizedUrl.includes(`/${token}`) || normalizedUrl.includes(`-${token}`));
}

async function fetchHtmlWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'GeoNeo-CompetitorBot/1.0 (+https://geoneo.ai)'
      }
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeCompetitorPages(competitors, locationTokens) {
  const targets = (competitors || []).filter((item) => item.url).slice(0, 5);
  const analyses = await Promise.all(targets.map(async (item) => {
    const html = await fetchHtmlWithTimeout(item.url, COMPETITOR_FETCH_TIMEOUT_MS);
    if (!html) {
      return {
        ...item,
        headingCount: null,
        hasFaq: null,
        hasSchema: null,
        wordCount: null,
        hasLocationPage: hasLocationPageSignal(item.url, locationTokens)
      };
    }
    const visible = htmlToText(html);
    return {
      ...item,
      headingCount: (html.match(/<h[1-3]\b/gi) || []).length,
      hasFaq: /faq|frequently asked questions|questions/i.test(html),
      hasSchema: /application\/ld\+json/i.test(html),
      wordCount: countWords(visible),
      hasLocationPage: hasLocationPageSignal(item.url, locationTokens)
    };
  }));

  const byUrl = new Map(analyses.map((entry) => [entry.url, entry]));
  return (competitors || []).map((item) => {
    const enriched = byUrl.get(item.url);
    if (!enriched) {
      return {
        ...item,
        headingCount: null,
        hasFaq: null,
        hasSchema: null,
        wordCount: null,
        hasLocationPage: hasLocationPageSignal(item.url, locationTokens)
      };
    }
    return enriched;
  });
}

function buildCompetitorQuery({ market, industry, title, h1Text, domainToken }) {
  const normalizedIndustry = normalizeLabel(industry || '');
  const normalizedMarket = (market || '')
    .replace(/[^\w\s,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalizedIndustry && normalizedMarket) {
    return `${normalizedIndustry} ${normalizedMarket}`.trim();
  }

  const source = `${h1Text || ''} ${title || ''}`.toLowerCase();
  const servicePatterns = [
    { pattern: /roof/i, term: 'roofing' },
    { pattern: /plumb/i, term: 'plumber' },
    { pattern: /tree/i, term: 'tree service' },
    { pattern: /electri/i, term: 'electrician' },
    { pattern: /hvac|heating|cooling|air conditioning/i, term: 'hvac' },
    { pattern: /tow|roadside|breakdown|truck repair/i, term: 'roadside assistance' },
    { pattern: /landscap|lawn/i, term: 'landscaping' },
    { pattern: /clean/i, term: 'cleaning service' }
  ];

  let inferredService = 'local services';
  for (const entry of servicePatterns) {
    if (entry.pattern.test(source)) {
      inferredService = entry.term;
      break;
    }
  }

  if (normalizedMarket) {
    return `${inferredService} ${normalizedMarket}`.trim();
  }
  if (domainToken) {
    return `${inferredService} ${domainToken}`.trim();
  }
  return inferredService;
}

function parseGoogleSearchHtml(html, startOffset = 0) {
  const unreliablePage = /unusual traffic|consent\.google|our systems have detected|enable javascript/i.test(html);
  if (unreliablePage) {
    return [];
  }

  const normalizeGoogleHref = (href) => {
    const rawHref = normalizeString(href);
    if (!rawHref) return '';
    if (/^https?:\/\//i.test(rawHref)) {
      return rawHref;
    }
    if (!rawHref.startsWith('/')) {
      return '';
    }
    try {
      const parsed = new URL(`https://www.google.com${rawHref}`);
      const redirected = parsed.searchParams.get('q') || parsed.searchParams.get('url') || '';
      return redirected || '';
    } catch {
      return '';
    }
  };

  const decodeAnchorTitle = (anchorHtml) => {
    const h3Match = anchorHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (h3Match) {
      return stripHtml(decodeHtmlEntities(h3Match[1] || ''));
    }
    const ariaMatch = anchorHtml.match(/\baria-label="([^"]+)"/i);
    if (ariaMatch) {
      return decodeHtmlEntities(ariaMatch[1] || '');
    }
    return stripHtml(decodeHtmlEntities(anchorHtml || ''));
  };

  const isLikelyResultTitle = (title) => {
    const normalized = normalizeString(title);
    if (!normalized || normalized.length < 4) return false;
    if (/^cached$/i.test(normalized)) return false;
    if (/^translate this page$/i.test(normalized)) return false;
    if (/^about this result$/i.test(normalized)) return false;
    if (/^more results$/i.test(normalized)) return false;
    if (/^people also ask$/i.test(normalized)) return false;
    return true;
  };

  const snippetMatches = [...html.matchAll(/<div class="VwiC3b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)]
    .map((match) => stripHtml(decodeHtmlEntities(match[1] || '')));
  const seenHost = new Set();

  const anchorMatches = [...html.matchAll(/<a\b[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const results = anchorMatches
    .map((match, index) => {
      const rawUrl = safeDecodeUri(normalizeGoogleHref(match[1] || ''));
      const host = extractHostFromUrl(rawUrl);
      if (!host || /(^|\.)google\./i.test(host)) {
        return null;
      }
      if (seenHost.has(host)) {
        return null;
      }
      const title = decodeAnchorTitle(match[2] || '');
      if (!isLikelyResultTitle(title)) {
        return null;
      }
      const snippet = snippetMatches[index] || '';
      seenHost.add(host);
      return {
        name: title || host,
        title,
        url: rawUrl,
        host,
        snippet,
        reviewCount: parseReviewCount(`${title} ${snippet}`)
      };
    })
    .filter(Boolean)
    .slice(0, 10)
    .map((entry, index) => ({
      ...entry,
      position: startOffset + index + 1
    }));

  if (results.length >= 3) {
    return results;
  }

  const h3Matches = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)];
  const legacyResults = h3Matches
    .map((match) => stripHtml(decodeHtmlEntities(match[1] || '')))
    .filter((name) => name.length > 0)
    .slice(0, 10)
    .map((name, index) => ({
      name,
      title: name,
      url: '',
      host: '',
      snippet: '',
      reviewCount: null,
      position: startOffset + index + 1
    }));

  return legacyResults.length >= 3 ? legacyResults : [];
}

async function searchCompetitors(query, options = {}) {
  try {
    const pages = Math.max(1, Math.min(3, Number(options.pages) || 1));
    const combined = [];
    const seenHostGlobal = new Set();

    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      const start = pageIndex * 10;
      const searchUrls = [
        `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10&start=${start}`,
        `https://www.google.com/search?gbv=1&q=${encodeURIComponent(query)}&num=10&start=${start}`
      ];
      let pageResults = [];
      for (const searchUrl of searchUrls) {
        const res = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0'
          }
        });
        const html = await res.text();
        pageResults = parseGoogleSearchHtml(html, start)
          .filter((entry) => !isIrrelevantMarketResult(entry))
          .filter((entry) => {
            const host = normalizeString(entry.host || '').toLowerCase();
            if (!host) {
              return true;
            }
            if (seenHostGlobal.has(host)) {
              return false;
            }
            seenHostGlobal.add(host);
            return true;
          });
        if (pageResults.length) {
          break;
        }
      }
      combined.push(...pageResults);
      if (pageResults.length < 3) {
        break;
      }
    }

    return combined;
  } catch {
    return [];
  }
}

function parseDuckDuckGoSearchHtml(html, startOffset = 0) {
  const unreliablePage = /captcha|detected unusual traffic|enable javascript/i.test(html);
  if (unreliablePage) {
    return [];
  }

  const seenHost = new Set();
  return [...html.matchAll(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const rawUrl = unwrapSearchRedirectUrl(safeDecodeUri(decodeHtmlEntities(match[1] || '')));
      const host = extractHostFromUrl(rawUrl);
      if (!host || seenHost.has(host)) {
        return null;
      }
      seenHost.add(host);
      const title = stripHtml(decodeHtmlEntities(match[2] || ''));
      return {
        name: title || host,
        title: title || host,
        url: rawUrl,
        host,
        snippet: '',
        reviewCount: null
      };
    })
    .filter(Boolean)
    .slice(0, 10)
    .map((entry, index) => ({
      ...entry,
      position: startOffset + index + 1
    }));
}

function parseBingSearchHtml(html, startOffset = 0) {
  const unreliablePage = /captcha|detected unusual traffic|enable javascript/i.test(html);
  if (unreliablePage) {
    return [];
  }

  const seenHost = new Set();
  return [...html.matchAll(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/gi)]
    .map((match) => {
      const rawUrl = unwrapSearchRedirectUrl(safeDecodeUri(decodeHtmlEntities(match[1] || '')));
      const host = extractHostFromUrl(rawUrl);
      if (!host || seenHost.has(host)) {
        return null;
      }
      seenHost.add(host);
      const title = stripHtml(decodeHtmlEntities(match[2] || ''));
      return {
        name: title || host,
        title: title || host,
        url: rawUrl,
        host,
        snippet: '',
        reviewCount: null
      };
    })
    .filter(Boolean)
    .slice(0, 10)
    .map((entry, index) => ({
      ...entry,
      position: startOffset + index + 1
    }));
}

async function searchCompetitorsWithFallback(query, options = {}) {
  const googleResults = await searchCompetitors(query, options);
  if (googleResults.length) {
    return {
      source: 'google crawl',
      results: googleResults
    };
  }

  try {
    const pages = Math.max(1, Math.min(3, Number(options.pages) || 1));
    const combined = [];
    const seenHostGlobal = new Set();

    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      const start = pageIndex * 10;
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${start}`;
      const res = await fetch(ddgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });
      const html = await res.text();
      const pageResults = parseDuckDuckGoSearchHtml(html, start)
        .filter((entry) => !isIrrelevantMarketResult(entry))
        .filter((entry) => {
          const host = normalizeString(entry.host || '').toLowerCase();
          if (!host) {
            return true;
          }
          if (seenHostGlobal.has(host)) {
            return false;
          }
          seenHostGlobal.add(host);
          return true;
        });
      combined.push(...pageResults);
      if (pageResults.length < 3) {
        break;
      }
    }

    if (combined.length) {
      return {
        source: 'duckduckgo crawl fallback',
        results: combined
      };
    }
  } catch {
    // no-op
  }

  try {
    const pages = Math.max(1, Math.min(3, Number(options.pages) || 1));
    const combined = [];
    const seenHostGlobal = new Set();

    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      const start = pageIndex * 10 + 1;
      const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${start}`;
      const res = await fetch(bingUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });
      const html = await res.text();
      const pageResults = parseBingSearchHtml(html, pageIndex * 10)
        .filter((entry) => !isIrrelevantMarketResult(entry))
        .filter((entry) => {
          const host = normalizeString(entry.host || '').toLowerCase();
          if (!host) {
            return true;
          }
          if (seenHostGlobal.has(host)) {
            return false;
          }
          seenHostGlobal.add(host);
          return true;
        });
      combined.push(...pageResults);
      if (pageResults.length < 3) {
        break;
      }
    }

    if (combined.length) {
      return {
        source: 'bing crawl fallback',
        results: combined
      };
    }
  } catch {
    // no-op
  }

  return {
    source: 'no usable crawl rows',
    results: []
  };
}

function sanitizeCompetitorResultsDetailed(results, { domainToken, businessHints }) {
  if (!Array.isArray(results) || !results.length) {
    return [];
  }

  const seen = new Set();
  const hints = (businessHints || [])
    .map((item) => normalizeLabel(item))
    .filter((item) => item.length >= 4);

  return results
    .map((entry) => ({
      name: stripHtml(entry.name || ''),
      title: stripHtml(entry.title || entry.name || ''),
      url: normalizeString(entry.url || ''),
      host: normalizeString(entry.host || ''),
      snippet: stripHtml(entry.snippet || ''),
      reviewCount: Number.isFinite(entry.reviewCount) ? entry.reviewCount : null,
      position: entry.position
    }))
    .filter((entry) => entry.name)
    .filter((entry) => {
      const normalized = normalizeLabel(entry.name);
      if (!normalized) {
        return false;
      }

      const isSelf = (domainToken && normalized.includes(domainToken))
        || hints.some((hint) => normalized.includes(hint));
      if (isSelf) {
        return false;
      }

      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    })
    .slice(0, 10)
    .map((entry, index) => ({
      name: entry.name.trim(),
      title: entry.title,
      url: entry.url,
      host: entry.host,
      snippet: entry.snippet,
      reviewCount: entry.reviewCount,
      position: index + 1
    }));
}

function sanitizeCompetitorResults(results, { domainToken, businessHints }) {
  return sanitizeCompetitorResultsDetailed(results, { domainToken, businessHints })
    .map((entry, index) => ({
      name: entry.name,
      position: index + 1
    }));
}

function getRankStatus(rawResults, domainToken) {
  if (!Array.isArray(rawResults) || rawResults.length === 0) {
    return 'unknown';
  }

  if (!domainToken || domainToken.length < 4) {
    return 'unknown';
  }

  const selfResult = rawResults.find((item) => normalizeLabel(item.name || '').includes(domainToken));
  if (!selfResult) {
    return 'unknown';
  }

  if (selfResult.position <= 3) {
    return 'top';
  }
  if (selfResult.position <= 6) {
    return 'mid';
  }
  if (selfResult.position <= 10) {
    return 'low';
  }
  return 'unknown';
}

function interpretVisibility(searchSnapshot, score) {
  const status = searchSnapshot?.rankStatus || 'unknown';

  if (status === 'top') {
    return {
      level: 'strong',
      message: 'You appear to have strong visibility in this market, but competitors can still overtake you.'
    };
  }

  if (status === 'mid') {
    return {
      level: 'moderate',
      message: 'You have some visibility, but competitors are likely capturing more clicks and calls.'
    };
  }

  if (status === 'low' || status === 'not_found') {
    return {
      level: 'weak',
      message: 'You are likely missing local search traffic while competitors capture those leads.'
    };
  }

  if (score < 65) {
    return {
      level: 'weak',
      message: 'Your visibility is likely limited based on site quality and signals.'
    };
  }

  return {
    level: 'unknown',
    message: 'We could not confidently determine ranking, but there are signs of missed opportunity.'
  };
}

async function getCompetitorSnapshot(query, { domainToken, businessHints }) {
  const rawResults = await searchCompetitors(query);
  if (!rawResults.length) {
    return {
      query,
      rankStatus: 'unknown',
      competitors: []
    };
  }

  const competitors = sanitizeCompetitorResults(rawResults, { domainToken, businessHints });
  if (!competitors.length) {
    return {
      query,
      rankStatus: 'unknown',
      competitors: []
    };
  }

  return {
    query,
    rankStatus: getRankStatus(rawResults, domainToken),
    competitors
  };
}

function buildCompetitiveInsights({
  query,
  competitors,
  userSignals,
  location
}) {
  const competitorCount = competitors.length;
  const competitorTitles = competitors.map((item) => item.title || item.name);
  const competitorSnippets = competitors.map((item) => item.snippet || '');
  const competitorKeywords = countKeywords(
    tokenizeKeywords(`${competitorTitles.join(' ')} ${competitorSnippets.join(' ')}`)
  );
  const topKeywords = competitorKeywords.slice(0, 12).map((entry) => entry.term);
  const competitorReviews = competitors
    .map((item) => item.reviewCount)
    .filter((value) => Number.isFinite(value));
  const avgReviews = competitorReviews.length
    ? Math.round(competitorReviews.reduce((sum, value) => sum + value, 0) / competitorReviews.length)
    : null;
  const locationPageCount = competitors.filter((item) => item.hasLocationPage).length;
  const faqCount = competitors.filter((item) => item.hasFaq === true).length;
  const schemaCount = competitors.filter((item) => item.hasSchema === true).length;
  const wordCounts = competitors.map((item) => item.wordCount).filter((value) => Number.isFinite(value));
  const avgCompetitorWords = wordCounts.length
    ? Math.round(wordCounts.reduce((sum, value) => sum + value, 0) / wordCounts.length)
    : null;

  const userKeywordSet = new Set(tokenizeKeywords(`${userSignals.title} ${userSignals.h1} ${userSignals.metaDescription}`));
  const missingKeywords = topKeywords.filter((term) => !userKeywordSet.has(term)).slice(0, 8);

  const strengths = [];
  const weaknesses = [];

  if (avgCompetitorWords !== null) {
    if (userSignals.wordCount >= avgCompetitorWords) {
      strengths.push(`Your page depth (${userSignals.wordCount} words) meets/exceeds competitor average (${avgCompetitorWords}).`);
    } else {
      weaknesses.push(`Your content depth (${userSignals.wordCount} words) is below competitor average (${avgCompetitorWords}).`);
    }
  }

  if (schemaCount > 0) {
    if (userSignals.hasSchema) {
      strengths.push(`Your site has schema markup while ${schemaCount}/${competitorCount} top competitors also use it.`);
    } else {
      weaknesses.push(`Schema is missing on your page while ${schemaCount}/${competitorCount} top competitors include schema.`);
    }
  }

  if (locationPageCount > 0 && !userSignals.hasLocalSignals) {
    weaknesses.push(`${locationPageCount}/${competitorCount} top competitors show location-page signals for ${location}, while your page lacks strong location evidence.`);
  } else if (locationPageCount > 0 && userSignals.hasLocalSignals) {
    strengths.push(`Your page has local location signals aligned with ${locationPageCount}/${competitorCount} ranking competitors.`);
  }

  if (faqCount > 0 && !userSignals.hasFaqSignals) {
    weaknesses.push(`${faqCount}/${competitorCount} competitors use FAQ/Q&A structures, but your page currently does not.`);
  } else if (faqCount > 0 && userSignals.hasFaqSignals) {
    strengths.push(`Your page includes FAQ/Q&A content matching competitors that rank for ${query}.`);
  }

  const authorityGaps = [];
  if (avgReviews !== null && avgReviews > 0) {
    authorityGaps.push(`Competitor SERP snippets show ~${avgReviews} average reviews where available; strengthen review velocity and review markup signals.`);
  }
  if (!userSignals.hasTrustStrong) {
    authorityGaps.push('Trust signals are weaker than high-ranking competitors (testimonials, credentials, proof).');
  }
  if (!userSignals.sitemapOk || !userSignals.robotsOk) {
    authorityGaps.push('Technical authority signals are incomplete (sitemap/robots missing) while ranking competitors generally satisfy crawl hygiene.');
  }

  const missingContent = [];
  if (avgCompetitorWords !== null && userSignals.wordCount < avgCompetitorWords) {
    missingContent.push(`Expand core service/location content to close a ${avgCompetitorWords - userSignals.wordCount} word gap vs competitor average.`);
  }
  if (!userSignals.hasFaqSignals && faqCount > 0) {
    missingContent.push(`Add FAQ blocks modeled on top-result patterns (${faqCount}/${competitorCount} competitors use FAQ-like structures).`);
  }
  if (!userSignals.hasLocalSignals && locationPageCount > 0) {
    missingContent.push(`Add dedicated location sections/pages matching how ${locationPageCount}/${competitorCount} ranking competitors target location intent.`);
  }

  const fixPlan = [];
  if (missingKeywords.length) {
    fixPlan.push(`Update title/H1/meta to include these competitor terms: ${missingKeywords.slice(0, 5).join(', ')}.`);
  }
  if (missingContent.length) {
    fixPlan.push(missingContent[0]);
  }
  if (authorityGaps.length) {
    fixPlan.push(authorityGaps[0]);
  }
  fixPlan.push(`Build/expand one location landing page for ${location} with internal links from homepage and primary service pages.`);
  fixPlan.push(`Benchmark the top 3 results in "${query}" weekly and track ranking movement after each published change.`);

  const topCompetitors = competitors.slice(0, 10).map((item) => ({
    position: item.position,
    name: item.name,
    title: item.title,
    url: item.url,
    reviewCount: item.reviewCount
  }));

  return {
    section1: {
      heading: 'What Google Shows',
      topCompetitors,
      patterns: [
        `Query used: "${query}"`,
        competitorCount
          ? `Competitors sampled from Google results: ${competitorCount}.`
          : 'No reliable Google competitor sample was available in this run.',
        topKeywords.length ? `Recurring title/snippet terms: ${topKeywords.slice(0, 8).join(', ')}.` : 'Keyword pattern extraction unavailable from current SERP.',
        avgReviews !== null
          ? `Review signals are present in top results (average visible count: ${avgReviews}).`
          : 'Review counts were not reliably exposed in current SERP snippets.',
        competitorCount
          ? `${locationPageCount}/${competitorCount} top competitors show location-page URL signals.`
          : 'Location-page pattern unavailable without competitor sample.',
        competitorCount
          ? `${faqCount}/${competitorCount} top competitors show FAQ-style structures.`
          : 'FAQ/content-structure pattern unavailable without competitor sample.'
      ]
    },
    section2: {
      heading: 'Your Position',
      strengths: strengths.length ? strengths : ['No clear strength detected against current competitor snapshot.'],
      weaknesses: weaknesses.length ? weaknesses : ['No major weaknesses detected against current competitor snapshot.']
    },
    section3: {
      heading: 'Competitive Gaps',
      missingKeywords: missingKeywords.length ? missingKeywords : ['No obvious keyword gaps detected from current SERP sample.'],
      missingContent: missingContent.length ? missingContent : ['No major content-structure gaps detected from sampled competitors.'],
      missingAuthoritySignals: authorityGaps.length ? authorityGaps : ['No major authority gaps detected from current data sample.']
    },
    section4: {
      heading: 'Fix Plan',
      exactSteps: fixPlan.slice(0, 6)
    }
  };
}

async function runAudit(targetInput, marketOrContext = '') {
  const context = typeof marketOrContext === 'string'
    ? { market: marketOrContext }
    : (marketOrContext || {});
  const market = normalizeString(context.market || [context.city, context.state].filter(Boolean).join(', '));
  const industry = normalizeString(context.industry || '');
  const businessCategory = normalizeString(context.businessCategory || '');
  const businessName = normalizeString(context.businessName || '');
  const manualSearchQuery = normalizeString(context.searchQuery || '');
  const auditMode = normalizeAuditMode(context.auditMode);
  const parsed = safeUrl(targetInput);
  const started = Date.now();
  let response;
  let fetchMode = 'secure';
  try {
    response = await fetch(parsed.toString(), {
      redirect: 'follow',
      headers: {
        'User-Agent': 'GeoNeo-AuditBot/1.0 (+https://geoneo.ai)'
      }
    });
  } catch (err) {
    const causeCode = err && err.cause && err.cause.code ? err.cause.code : null;
    const causeMessage = err && err.cause && err.cause.message ? err.cause.message : null;
    const shortCode = causeCode || (err && err.code ? err.code : null);
    const canTryInsecure = process.env.ALLOW_INSECURE_FETCH === '1';
    const fetchMessage = buildFetchFailureMessage(shortCode);

    if (canTryInsecure && shortCode && FETCH_TLS_CODES.has(shortCode)) {
      try {
        response = await insecureFetchWithHttps(parsed.toString(), {
          headers: {
            'User-Agent': 'GeoNeo-AuditBot/1.0 (+https://geoneo.ai)'
          }
        });
        fetchMode = 'insecure_fallback';
        console.warn('[runAudit] insecure fetch fallback used', {
          targetUrl: parsed.toString(),
          reasonCode: shortCode
        });
      } catch (fallbackErr) {
        const fallbackMessage = fallbackErr && fallbackErr.message ? fallbackErr.message : 'insecure fallback failed';
        const fetchDebug = [
          err && err.message ? err.message : null,
          shortCode ? `cause_code:${shortCode}` : null,
          causeMessage ? `cause_message:${causeMessage}` : null,
          `fallback:${fallbackMessage}`
        ].filter(Boolean).join(' | ');

        console.error('[runAudit] target fetch failed', {
          targetUrl: parsed.toString(),
          message: err && err.message ? err.message : 'fetch failed',
          causeCode: shortCode
        });

        const fetchError = new Error('Unable to fetch target website');
        fetchError.fetchDebug = fetchDebug || 'fetch_failed';
        fetchError.fetchCode = shortCode || null;
        fetchError.fetchMessage = fetchMessage;
        throw fetchError;
      }
    } else {
      const fetchDebug = [
        err && err.message ? err.message : null,
        shortCode ? `cause_code:${shortCode}` : null,
        causeMessage ? `cause_message:${causeMessage}` : null
      ].filter(Boolean).join(' | ');

      console.error('[runAudit] target fetch failed', {
        targetUrl: parsed.toString(),
        message: err && err.message ? err.message : 'fetch failed',
        causeCode: shortCode
      });

      const fetchError = new Error('Unable to fetch target website');
      fetchError.fetchDebug = fetchDebug || 'fetch_failed';
      fetchError.fetchCode = shortCode || null;
      fetchError.fetchMessage = fetchMessage;
      throw fetchError;
    }
  }

  if (!response.ok) {
    throw new Error(`Website returned status ${response.status}.`);
  }

  const finalUrl = response.url;
  const html = await response.text();
  const ms = Date.now() - started;
  const visibleText = htmlToText(html);
  const wordCount = countWords(visibleText);
  const paragraphStats = getParagraphStats(html);
  const thinContent = wordCount < 300;
  const repetitiveContent = looksRepetitive(visibleText);

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';
  const h1Matches = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) || [];
  const firstH1Text = h1Matches.length ? stripHtml(h1Matches[0]) : '';
  const domainToken = extractDomainToken(parsed.hostname);
  const inferredQuery = buildCompetitorQuery({
    market,
    industry,
    title,
    h1Text: firstH1Text,
    domainToken
  });
  const competitorQuery = manualSearchQuery || inferredQuery;
  const querySource = manualSearchQuery ? 'manual' : 'auto';
  const rawCompetitorResults = await searchCompetitors(competitorQuery);
  const basicCompetitors = sanitizeCompetitorResults(rawCompetitorResults, {
    domainToken,
    businessHints: [firstH1Text, title, businessName]
  });
  const detailedCompetitors = sanitizeCompetitorResultsDetailed(rawCompetitorResults, {
    domainToken,
    businessHints: [firstH1Text, title, businessName]
  });
  const rankStatus = getRankStatus(rawCompetitorResults, domainToken);
  const searchSnapshot = {
    query: competitorQuery,
    querySource,
    rankStatus,
    competitors: basicCompetitors
  };
  const locationTokens = getLocationTokens(market);
  const enrichedCompetitors = await analyzeCompetitorPages(detailedCompetitors, locationTokens);
  const competitors = enrichedCompetitors.map((item) => item.name);

  const metaDescriptionMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const metaDescription = metaDescriptionMatch ? metaDescriptionMatch[1].trim() : '';

  const canonical = /<link[^>]*rel=["']canonical["'][^>]*>/i.test(html);
  const robotsMeta = /<meta[^>]*name=["']robots["'][^>]*>/i.test(html);
  const ogTitle = /<meta[^>]*property=["']og:title["'][^>]*>/i.test(html);
  const ogDesc = /<meta[^>]*property=["']og:description["'][^>]*>/i.test(html);
  const schemaScripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi) || [];

  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const imgWithoutAlt = imgTags.filter((tag) => !/\balt\s*=\s*["'][^"']*["']/i.test(tag)).length;
  const imageCount = imgTags.length;
  const headingCount = (html.match(/<h[1-3]\b/gi) || []).length;
  const normalizedVisibleText = normalizeLabel(visibleText);
  const marketTokens = getLocationTokens(market);
  const hasMarketMentions = marketTokens.length
    ? marketTokens.some((token) => normalizedVisibleText.includes(token))
    : false;
  const hasLocalSignals = hasMarketMentions || /address|phone|google business|service area/i.test(html);
  const hasFaqSignals = /faq|questions|what|how/i.test(html);
  const trustSignalCount = getTrustSignalCount(html, visibleText);
  const trustDesign = assessTrustDesign({
    html,
    visibleText,
    trustSignalCount,
    headingCount,
    imageCount,
    wordCount
  });
  const weakTrustSignals = trustDesign.level === 'weak';
  const parsedFinalUrl = safeUrl(finalUrl);
  const detectedBusinessName = inferBusinessName({
    explicitName: businessName,
    h1: firstH1Text,
    title,
    hostname: parsedFinalUrl.hostname
  });
  const serviceKeywords = extractVisibleServiceKeywords({
    visibleText,
    title,
    h1: firstH1Text
  });
  const locationMentions = extractLocationMentions({
    visibleText,
    market
  });
  const contactSignals = detectContactSignals({
    html,
    visibleText
  });
  const internalLinks = extractInternalLinks({
    html,
    finalUrl
  });

  const googleGradesDebugRef = { reason: null, message: null };
  const [sitemapOk, robotsOk, grammarCheck, googleGrades] = await Promise.all([
    existsUrl(`${parsed.origin}/sitemap.xml`),
    existsUrl(`${parsed.origin}/robots.txt`),
    runLanguageCheck(visibleText),
    runGoogleGrades(finalUrl, googleGradesDebugRef)
  ]);
  const googleGradesDebug = googleGrades ? null : (googleGradesDebugRef.reason || 'pagespeed_fetch_failed');
  const googleGradesMessage = googleGrades
    ? null
    : (googleGradesDebug === 'pagespeed_http_429'
      ? PAGESPEED_429_MESSAGE
      : (googleGradesDebug === 'pagespeed_http_400'
        ? PAGESPEED_400_MESSAGE
        : (googleGradesDebugRef.message || null)));
  const estimatedGoogleGrades = buildEstimatedGoogleGrades({
    title,
    metaDescription,
    h1Count: h1Matches.length,
    canonical,
    robotsMeta,
    ogTitle,
    ogDesc,
    schemaCount: schemaScripts.length,
    imgWithoutAlt,
    imageCount,
    headingCount,
    hasLocalSignals,
    sitemapOk,
    robotsOk,
    thinContent,
    repetitiveContent,
    grammarErrorCount: grammarCheck ? grammarCheck.count : null,
    trustDesignLevel: trustDesign.level,
    fetchMs: ms
  });
  const effectiveGoogleGrades = googleGrades || estimatedGoogleGrades;
  const googleGradesSource = googleGrades ? 'live_pagespeed' : 'estimated_fallback';

  const grammarErrorCount = grammarCheck ? grammarCheck.count : null;
  const googleSeoValue = (effectiveGoogleGrades && typeof effectiveGoogleGrades.seo === 'number')
    ? effectiveGoogleGrades.seo
    : null;

  const checks = [
    buildCheck('title', title.length >= 20 && title.length <= 60, `Title length looks good (${title.length}).`, `Title should be 20-60 characters (current: ${title.length || 0}).`),
    buildCheck('meta-description', metaDescription.length >= 120 && metaDescription.length <= 160, `Meta description length looks good (${metaDescription.length}).`, `Meta description should be 120-160 characters (current: ${metaDescription.length || 0}).`),
    buildCheck('h1', h1Matches.length === 1, 'Exactly one H1 detected.', `Use a single clear H1 (found: ${h1Matches.length}).`),
    buildCheck('canonical', canonical, 'Canonical tag found.', 'Add a canonical link tag.'),
    buildCheck('robots-meta', robotsMeta, 'Robots meta tag found.', 'Add a robots meta tag.'),
    buildCheck('og-tags', ogTitle && ogDesc, 'Open Graph title and description found.', 'Add og:title and og:description meta tags.'),
    buildCheck('structured-data', schemaScripts.length > 0, `Structured data scripts found (${schemaScripts.length}).`, 'Add JSON-LD structured data (Organization/Service/FAQ).'),
    buildCheck('image-alt', imgWithoutAlt === 0, 'All images include alt text.', `${imgWithoutAlt} image(s) are missing alt text.`),
    buildCheck('sitemap', sitemapOk, 'Sitemap.xml is accessible.', 'Add and publish sitemap.xml.'),
    buildCheck('robots-txt', robotsOk, 'Robots.txt is accessible.', 'Add and publish robots.txt.'),
    buildCheck('local-geo', hasLocalSignals, 'Local GEO signals detected.', 'Add local GEO signals (city/state, address, Google Business references).'),
    buildCheck(
      'thin-content',
      !thinContent,
      `Page content depth is reasonable (${wordCount} words).`,
      `Page content is thin (${wordCount} words). Add more useful service and trust content.`
    ),
    buildCheck(
      'paragraph-depth',
      paragraphStats.count >= 3 && paragraphStats.avgWords >= 35,
      `Paragraph depth supports trust building (${paragraphStats.count} paragraphs, avg ${paragraphStats.avgWords} words).`,
      `Paragraph content is short (${paragraphStats.count} paragraphs, avg ${paragraphStats.avgWords} words). Expand explanation and proof to build trust.`
    ),
    buildCheck(
      'repetitive-content',
      !repetitiveContent,
      'Content repetition looks natural.',
      'The wording appears repetitive, which can make the site feel templated.'
    ),
    buildCheck(
      'trust-signals',
      trustDesign.level === 'strong',
      'Your site appears to have a stronger trust foundation than many local competitors.',
      trustDesign.level === 'moderate'
        ? 'Your site has some credibility signals, but important trust elements are still missing.'
        : 'The site may not project enough trust to convert search traffic into calls.'
    ),
    buildCheck('faq-citation', hasFaqSignals, 'Q&A style content detected for AI citation.', 'Add FAQ/Q&A sections to improve AI citation readiness.'),
    buildCheck(
      'grammar',
      grammarErrorCount !== null ? grammarErrorCount <= 5 : true,
      grammarErrorCount !== null
        ? `Grammar check looks strong (${grammarErrorCount} issues found).`
        : 'Grammar check unavailable from language service.',
      `Grammar and clarity issues detected (${grammarErrorCount} issues). Rewrite key sections for professional credibility.`
    ),
    buildCheck(
      'google-seo',
      googleSeoValue !== null ? googleSeoValue >= 80 : true,
      googleSeoValue !== null ? `Google SEO grade is healthy (${googleSeoValue}/100).` : 'Google grade unavailable in this run.',
      googleSeoValue !== null
        ? `Google SEO grade is low (${googleSeoValue}/100). Prioritize technical and on-page corrections.`
        : 'Google grade unavailable in this run.'
    )
  ];

  const failCount = checks.filter((c) => c.status === 'FIX').length;
  const seoPass = checks.slice(0, 10).filter((c) => c.status === 'PASS').length;
  const aiPass = checks.slice(5, 12).filter((c) => c.status === 'PASS').length;
  const geoPass = checks.slice(8, 12).filter((c) => c.status === 'PASS').length;

  const scores = {
    seo: Math.round((seoPass / 10) * 100),
    ai: Math.round((aiPass / 7) * 100),
    geo: Math.round((geoPass / 4) * 100)
  };
  scores.overall = calculateOverallScore({
    h1Count: h1Matches.length,
    grammarErrorCount,
    hasLocalSignals,
    fixCount: failCount,
    googleGrades: effectiveGoogleGrades,
    thinContent,
    repetitiveContent,
    weakTrustSignals,
    trustDesignLevel: trustDesign.level
  });

  const topFixes = prioritizeTopFixes(checks);
  const quickWinCount = countQuickWins(checks);
  const estimatedShortTermLift = estimateShortTermLift(checks);
  const issueSolutions = buildIssueSolutions(checks);
  const implementationRoadmap = buildImplementationRoadmap(issueSolutions);
  const prioritizedActionPlan = buildPrioritizedActionPlan(issueSolutions);
  const fullDiagnosis = checks.map((check) => ({
    key: check.key,
    status: check.status,
    diagnosis: check.message
  }));

  let summary = 'You are likely losing business due to poor search visibility and site quality.';
  if (scores.overall >= 85) {
    summary = 'Strong foundation, but there is still room to improve visibility and conversions.';
  } else if (scores.overall >= 65) {
    summary = 'You are likely missing leads due to visibility and trust issues.';
  }
  const visibility = interpretVisibility(searchSnapshot, scores.overall);
  const recommendation = generateRecommendation({
    overallScore: scores.overall,
    rankStatus: searchSnapshot.rankStatus,
    trustDesignLevel: trustDesign.level,
    failCount
  });
  const competitiveSections = buildCompetitiveInsights({
    query: competitorQuery,
    competitors: enrichedCompetitors,
    userSignals: {
      title,
      h1: firstH1Text,
      metaDescription,
      wordCount,
      hasSchema: schemaScripts.length > 0,
      hasFaqSignals,
      hasLocalSignals,
      hasTrustStrong: trustDesign.level === 'strong',
      sitemapOk,
      robotsOk
    },
    location: market || 'target market'
  });
  const siteProfile = {
    businessName: detectedBusinessName,
    title,
    metaDescription,
    h1: firstH1Text,
    visibleServiceKeywords: serviceKeywords,
    locationMentions,
    contactSignals,
    internalLinks,
    trustSignals: {
      level: trustDesign.level,
      score: trustSignalCount,
      reasons: Array.isArray(trustDesign.reasons) ? trustDesign.reasons.slice(0, 5) : []
    },
    seoSignals: {
      canonical,
      robotsMeta,
      ogTitle,
      ogDescription: ogDesc,
      schemaCount: schemaScripts.length,
      sitemap: sitemapOk,
      robotsTxt: robotsOk,
      h1Count: h1Matches.length,
      missingImageAltCount: imgWithoutAlt
    }
  };
  let localSearchVisibility;
  try {
    localSearchVisibility = await runLocalSearchVisibilityAudit({
      auditId: normalizeString(context.auditId) || `temp_${Date.now()}`,
      rootDir: ROOT,
      targetUrl: parsed.toString(),
      finalUrl,
      industry,
      businessCategory,
      city: normalizeString(context.city || ''),
      state: normalizeString(context.state || ''),
      market,
      businessName: detectedBusinessName || businessName,
      siteProfile,
      title,
      h1: firstH1Text
    });
  } catch (error) {
    localSearchVisibility = {
      status: 'unavailable',
      generatedQueries: [],
      results: [],
      summary: {
        foundInOrganicCount: 0,
        foundInLocalPackCount: 0,
        missingCount: 5,
        recurringCompetitors: [],
        visibilityScore: 0
      },
      error: error && error.message ? error.message : 'local_search_visibility_failed'
    };
  }

  return {
    finalUrl,
    summary,
    fetchDebug: null,
    fetchMode,
    auditMode,
    visibility,
    trustDesign,
    recommendation,
    scores,
    issueCount: failCount,
    quickWinCount,
    estimatedShortTermLift,
    googleGrades: effectiveGoogleGrades,
    googleGradesSource,
    googleGradesDebug,
    googleGradesMessage: googleGrades
      ? null
      : (googleGradesMessage || 'Google PageSpeed snapshot unavailable. Showing estimated grades from on-page audit checks.'),
    siteProfile,
    localSearchVisibility,
    searchSnapshot: {
      ...searchSnapshot,
      competitors: enrichedCompetitors
    },
    competitiveSections,
    competitors,
    topFixes,
    fullDiagnosis,
    issueSolutions,
    implementationRoadmap,
    prioritizedActionPlan,
    checks: checks.map((check) => ({
      key: check.key,
      status: check.status,
      message: check.message
    }))
  };
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function isLocalRequest(req) {
  const remote = (req.socket && req.socket.remoteAddress) || '';
  return remote === '127.0.0.1'
    || remote === '::1'
    || remote === '::ffff:127.0.0.1'
    || remote === '';
}

function buildAdminLeadsHtml(records) {
  const safeRecords = Array.isArray(records) ? records : [];
  const rows = safeRecords
    .slice()
    .sort((a, b) => {
      const scoreA = Number(a && a.scores && a.scores.overall);
      const scoreB = Number(b && b.scores && b.scores.overall);
      const hasA = Number.isFinite(scoreA);
      const hasB = Number.isFinite(scoreB);
      if (hasA && hasB) {
        if (scoreA !== scoreB) {
          return scoreA - scoreB;
        }
        return String(b && b.createdAt || '').localeCompare(String(a && a.createdAt || ''));
      }
      if (hasA && !hasB) return -1;
      if (!hasA && hasB) return 1;
      return String(b && b.createdAt || '').localeCompare(String(a && a.createdAt || ''));
    })
    .map((record) => {
      const auditId = normalizeString(record && (record.auditId || record.id));
      const reportPath = normalizeString(record && record.reportLink) || buildReportLinks(auditId).reportPath;
      const recommendation = record && record.recommendation ? record.recommendation : {};
      const scores = record && record.scores ? record.scores : {};
      const localVisibility = record && (record.localSearchVisibility
        || (record.fullAuditResult && record.fullAuditResult.localSearchVisibility))
        ? (record.localSearchVisibility || record.fullAuditResult.localSearchVisibility)
        : {};
      const localSummary = localVisibility.summary || {};
      const localFound = `${Number(localSummary.foundInOrganicCount) || 0}/5`;
      const localCompetitors = Array.isArray(localVisibility.topRecurringCompetitors)
        ? localVisibility.topRecurringCompetitors.slice(0, 3).map((item) => item.domain).join(', ')
        : '';
      const overall = Number(scores.overall);
      const priorityClass = Number.isFinite(overall) && overall < 55 ? 'priority-high' : '';
      return `<tr>
        <td class="${priorityClass}">${priorityClass ? 'High' : 'Normal'}</td>
        <td>${escapeHtml(record && record.createdAt || '')}</td>
        <td>${escapeHtml(record && (record.businessName || record.company) || '')}</td>
        <td>${escapeHtml(record && record.contactName || '')}</td>
        <td>${escapeHtml(record && (record.businessEmail || record.email) || '')}</td>
        <td>${escapeHtml(record && record.phone || '')}</td>
        <td>${escapeHtml(record && record.industry || '')}</td>
        <td>${escapeHtml(record && record.city || '')}</td>
        <td>${escapeHtml(record && record.state || '')}</td>
        <td>${escapeHtml(record && record.website || '')}</td>
        <td>${escapeHtml(localFound)}</td>
        <td>${escapeHtml(localCompetitors || 'N/A')}</td>
        <td class="${priorityClass}">${escapeHtml(String(scores.overall || 'N/A'))}</td>
        <td>${escapeHtml(recommendation.recommendedPlan || '')}</td>
        <td>${escapeHtml(auditId)}</td>
        <td><a href="${escapeHtml(reportPath)}" target="_blank" rel="noreferrer">Open Report</a></td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GeoNeo AI - Internal Leads</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
    h1 { margin-bottom: 4px; }
    p { color: #555; margin-top: 0; }
    .table-wrap { overflow: auto; border: 1px solid #ddd; border-radius: 10px; }
    table { width: 100%; border-collapse: collapse; min-width: 1300px; }
    th, td { border-bottom: 1px solid #eee; text-align: left; padding: 10px; font-size: 14px; vertical-align: top; }
    thead th { background: #fafafa; position: sticky; top: 0; }
    .priority-high { color: #9b2d00; font-weight: 700; background: #fff2ea; }
  </style>
</head>
<body>
  <h1>GeoNeo AI Leads</h1>
  <p>Local internal view of saved audit leads.</p>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Priority</th>
          <th>Date</th>
          <th>Business</th>
          <th>Contact</th>
          <th>Email</th>
          <th>Phone</th>
          <th>Industry</th>
          <th>City</th>
          <th>State</th>
          <th>Website</th>
          <th>Found (Local Search)</th>
          <th>Top Recurring Competitors</th>
          <th>Overall</th>
          <th>Recommended</th>
          <th>Audit ID</th>
          <th>Report</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="16">No leads saved yet.</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

function serveStatic(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const filePath = path.join(ROOT, pathname);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

async function requestHandler(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === '/api/audit-report' && req.method === 'GET') {
    try {
      const auditId = reqUrl.searchParams.get('id') || '';
      if (!normalizeString(auditId)) {
        sendJson(res, 400, { error: 'Missing id query parameter.' });
        return;
      }

      const record = await getAuditRecordById(auditId);
      if (!record) {
        sendJson(res, 404, { error: 'Audit record not found.' });
        return;
      }

      const reportHtml = buildAuditReportHtml(record);
      const safeId = normalizeString(record.id || 'report').replace(/[^a-zA-Z0-9_-]/g, '');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename=\"audit-${safeId || 'report'}.html\"`
      });
      res.end(reportHtml);
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Unable to generate report.' });
    }
    return;
  }

  if (reqUrl.pathname === '/api/audit-report/download' && req.method === 'GET') {
    try {
      const auditId = reqUrl.searchParams.get('id') || '';
      if (!normalizeString(auditId)) {
        sendJson(res, 400, { error: 'Missing id query parameter.' });
        return;
      }

      const record = await getAuditRecordById(auditId);
      if (!record) {
        sendJson(res, 404, { error: 'Audit record not found.' });
        return;
      }

      const reportHtml = buildAuditReportHtml(record);
      const safeId = normalizeString(record.id || 'audit').replace(/[^a-zA-Z0-9_-]/g, '');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename=\"geoneo-audit-${safeId || 'audit'}.html\"`
      });
      res.end(reportHtml);
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Unable to generate report download.' });
    }
    return;
  }

  if (reqUrl.pathname === '/api/neo-club' && req.method === 'GET') {
    try {
      const auditId = normalizeString(reqUrl.searchParams.get('auditId') || '');
      const packageFromQuery = normalizePackageLevel(reqUrl.searchParams.get('package') || 'free');

      if (auditId) {
        const record = await getAuditRecordById(auditId);
        if (!record) {
          sendJson(res, 404, { error: 'Audit record not found for Neo Club access.' });
          return;
        }
        const recordPackage = normalizePackageLevel(
          record.purchasedPackage
            || record.packageLevel
            || (record.customerResult && record.customerResult.packageLevel)
            || 'free'
        );
        sendJson(res, 200, buildNeoClubPayload({
          packageLevel: recordPackage,
          auditId,
          source: 'audit-record'
        }));
        return;
      }

      sendJson(res, 200, buildNeoClubPayload({
        packageLevel: packageFromQuery,
        source: 'session'
      }));
    } catch (error) {
      sendJson(res, 500, {
        error: error && error.message ? error.message : 'Unable to load Neo Club content.'
      });
    }
    return;
  }

  if (reqUrl.pathname === '/api/audit' && req.method === 'GET') {
    try {
      const queryType = normalizeQueryType(reqUrl.searchParams.get('queryType') || 'website');
      const dashboardPackage = normalizeDashboardPackage(reqUrl.searchParams.get('packageView') || '');
      const internalMode = normalizeBool(reqUrl.searchParams.get('internalMode') || '');
      const targetUrl = reqUrl.searchParams.get('url');
      const contactName = reqUrl.searchParams.get('contactName') || '';
      const businessName = reqUrl.searchParams.get('businessName') || reqUrl.searchParams.get('company') || '';
      const businessEmail = reqUrl.searchParams.get('businessEmail') || reqUrl.searchParams.get('email') || '';
      const phone = reqUrl.searchParams.get('phone') || '';
      const industry = reqUrl.searchParams.get('industry') || '';
      const businessCategory = reqUrl.searchParams.get('businessCategory') || '';
      const streetAddress = reqUrl.searchParams.get('streetAddress') || '';
      const city = reqUrl.searchParams.get('city') || '';
      const state = reqUrl.searchParams.get('state') || '';
      const zip = reqUrl.searchParams.get('zip') || '';
      const competitorsInput = reqUrl.searchParams.get('competitors') || '';
      const competitorUrl = reqUrl.searchParams.get('competitorUrl') || '';
      const competitorNotes = reqUrl.searchParams.get('competitorNotes') || '';
      const searchQuery = reqUrl.searchParams.get('searchQuery') || '';
      const bestContactTime = reqUrl.searchParams.get('bestContactTime') || '';
      const followupConsent = reqUrl.searchParams.get('followupConsent') || '';
      const auditMode = normalizeAuditMode(reqUrl.searchParams.get('auditMode') || 'business');
      const market = reqUrl.searchParams.get('market') || [city, state, zip].filter(Boolean).join(', ');
      const packageLevel = normalizePackageLevel(reqUrl.searchParams.get('package') || 'free');
      const amountPaid = resolveAmountPaid(reqUrl.searchParams.get('amountPaid'), packageLevel);
      const createdAt = new Date().toISOString();

      const hasMarketInputs = Boolean(normalizeString(industry) || normalizeString(city) || normalizeString(state) || normalizeString(zip));
      const effectiveQueryType = (!targetUrl && hasMarketInputs) ? 'market' : queryType;

      if (effectiveQueryType === 'market') {
        const marketModel = await runMarketOnlyAudit({
          industry,
          city,
          state,
          zip
        });
        const packageViews = buildDashboardPackageViews(marketModel);
        const selectedPackageView = dashboardPackage || normalizeDashboardPackage(packageLevel);
        const selectedView = internalMode ? packageViews.full_data : (packageViews[selectedPackageView] || packageViews.full_data);
        sendJson(res, 200, {
          ok: true,
          mode: 'market',
          dashboard: {
            queryType: 'market',
            selectedPackageView,
            internalMode,
            dataQuality: marketModel.dataQuality,
            sourceNote: marketModel.sourceNote,
            resultModel: marketModel,
            packageViews,
            selectedView,
            internalView: packageViews.full_data
          },
          ...selectedView
        });
        return;
      }

      if (!targetUrl) {
        sendJson(res, 400, { error: 'Missing website URL. Add a URL, or switch to Industry + Location mode.' });
        return;
      }

      const plannedAuditId = makeAuditId({
        company: businessName || '',
        website: targetUrl,
        createdAt
      });
      let result = null;
      let filteredResult = null;
      let unifiedModel = null;
      let saveResult = { saved: false, auditId: plannedAuditId, error: '' };
      let fallbackReason = '';
      try {
        result = await runAudit(targetUrl, {
          auditId: plannedAuditId,
          market,
          industry,
          businessCategory,
          businessName,
          searchQuery,
          city,
          state,
          zip,
          auditMode
        });
        filteredResult = filterAuditResultByPackage(result, packageLevel);
        unifiedModel = buildUnifiedModelFromWebsiteAudit(result, {
          website: targetUrl,
          industry,
          city,
          state,
          market
        });
        const record = buildAuditRecord({
          contactName,
          businessName,
          businessEmail,
          phone,
          industry,
          businessCategory,
          streetAddress,
          city,
          state,
          zip,
          competitorsInput,
          competitorUrl,
          competitorNotes,
          searchQuery,
          bestContactTime,
          followupConsent,
          website: targetUrl,
          market,
          auditMode,
          createdAt,
          auditId: plannedAuditId,
          auditResult: result,
          purchasedPackage: packageLevel,
          amountPaid,
          customerResult: filteredResult
        });
        saveResult = await saveAuditRecord(record);
      } catch (auditError) {
        fallbackReason = normalizeString(auditError && auditError.message) || 'website_audit_failed';
        unifiedModel = buildWebsiteFallbackModel({
          website: targetUrl,
          industry,
          city,
          state
        }, fallbackReason);
        filteredResult = {
          packageLevel,
          summary: `Fallback model used: ${fallbackReason}`,
          scores: {
            seo: unifiedModel.summaryScores.seo,
            ai: unifiedModel.summaryScores.aiVisibility,
            geo: unifiedModel.summaryScores.localPresence,
            overall: Math.round(
              (unifiedModel.summaryScores.seo
              + unifiedModel.summaryScores.technical
              + unifiedModel.summaryScores.aiVisibility
              + unifiedModel.summaryScores.localPresence
              + unifiedModel.summaryScores.reputation
              + unifiedModel.summaryScores.conversionUx) / 6
            )
          }
        };
      }

      const packageViews = buildDashboardPackageViews(unifiedModel);
      const selectedPackageView = dashboardPackage || normalizeDashboardPackage(packageLevel);
      const selectedView = internalMode ? packageViews.full_data : (packageViews[selectedPackageView] || packageViews.full_data);
      sendJson(res, 200, {
        ok: true,
        mode: 'website',
        dashboard: {
          queryType: 'website',
          selectedPackageView,
          internalMode,
          dataQuality: unifiedModel.dataQuality,
          sourceNote: unifiedModel.sourceNote,
          resultModel: unifiedModel,
          packageViews,
          selectedView,
          internalView: packageViews.full_data
        },
        ...selectedView,
        ...filteredResult,
        purchasedPackage: packageLevel,
        amountPaid,
        upgradeCreditAvailable: buildUpgradeCreditAvailable(packageLevel, amountPaid),
        reportLink: buildReportLinks(saveResult.auditId || plannedAuditId).reportPath,
        saved: Boolean(saveResult.saved),
        auditId: saveResult.auditId || plannedAuditId,
        saveError: saveResult.error || '',
        fetchDebug: fallbackReason || null
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || 'Audit failed.',
        fetchDebug: error.fetchDebug || null,
        fetchCode: error.fetchCode || null,
        fetchMessage: error.fetchMessage || null
      });
    }
    return;
  }

  if (reqUrl.pathname === '/admin/leads' && req.method === 'GET') {
    if (!isLocalRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    try {
      const records = await loadAuditRecords();
      const html = buildAdminLeadsHtml(records);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Unable to load leads.' });
    }
    return;
  }

  serveStatic(req, res);
}

const server = http.createServer(requestHandler);

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`GeoNeo AI server running at http://${HOST}:${PORT}`);
  });
}

module.exports = Object.assign(requestHandler, {
  requestHandler,
  generateLocalBuyerQueries,
  unwrapSearchRedirectUrl,
  isJunkMarketResult,
  evaluateMarketResult,
  getLocalCompetitors,
  runMarketOnlyAudit,
  safeUrl,
  htmlToText,
  calculateOverallScore,
  assessTrustDesign,
  generateRecommendation,
  buildCompetitorQuery,
  sanitizeCompetitorResults,
  interpretVisibility,
  searchCompetitors,
  getCompetitorSnapshot,
  buildAuditRecord,
  normalizePackageLevel,
  resolveAmountPaid,
  buildUpgradeCreditAvailable,
  normalizeCompetitorInput,
  buildReportLinks,
  countQuickWins,
  estimateShortTermLift,
  filterAuditResultByPackage,
  saveAuditRecord,
  loadAuditRecords,
  getAuditRecordById,
  buildAuditReportHtml
  ,
  isNeoClubMember,
  buildNeoClubPayload,
  runAudit
});
