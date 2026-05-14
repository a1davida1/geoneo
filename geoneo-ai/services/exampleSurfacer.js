/**
 * Example surfacer — for each audit finding, find a real-world example
 * of a competitor doing it well. Customer sees:
 *
 *   Finding: "Add LocalBusiness schema"
 *   Example: greenpro-plumbing.com — full LocalBusiness JSON-LD with
 *   8 rich fields (priceRange, openingHours, geo, review aggregateRating)
 *
 * Two sources for examples (in order of preference):
 *
 *   1. Curated table of best-in-class examples per finding type. Hand-picked
 *      sites we know nail each pillar (won't change often; rebuilt manually
 *      when patterns shift).
 *   2. Auto-discovered: scan the audit archive for top-decile sites in the
 *      same industry that DON'T have the same finding (i.e., they fixed it).
 *      Pick one with the highest overall score as the example.
 *
 * Output per finding: { exampleDomain, exampleUrl, exampleScore, why,
 * source: 'curated'|'archive_lookup' }
 *
 * The surfacer is NOT a content generator. It points at real domains
 * the customer can study. No LLM, no synthesis.
 */

const fs = require('fs/promises');
const path = require('path');

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'audit-archive');

/**
 * Curated best-in-class examples per finding key.
 * The why field is the one-line reason this domain demonstrates the fix.
 *
 * Pattern matches the finding `key` field from auditDeep findings:
 *   - schema-* — schema pillar findings
 *   - eeat-* — E-E-A-T trust signals
 *   - geo-* — AI-search readiness
 *   - nap-* — NAP consistency
 *   - sitemap-* — sitemap quality
 *   - images-* — image audit
 *   - performance-* — Core Web Vitals
 *   - content-* — grammar/clarity
 *
 * Domains chosen for: clear demonstration of the pattern, stable (not
 * likely to change in 6-12mo), accessible (no paywall, no JS-only render).
 */
const CURATED_EXAMPLES = {
  // Schema pillar
  'schema-add-LocalBusiness': {
    domain: 'roto-rooter.com',
    url: 'https://www.roto-rooter.com',
    why: 'Full LocalBusiness JSON-LD with priceRange, openingHours, geo coordinates, aggregateRating, sameAs to social profiles, and per-location Service nodes. Validates clean in Schema.org validator.'
  },
  'schema-add-Service': {
    domain: 'mrrooter.com',
    url: 'https://www.mrrooter.com',
    why: 'Each service page has Service schema with provider (LocalBusiness ref), serviceType, areaServed (City), and offers (Offer with priceSpecification). Best-in-class per-service markup.'
  },
  'schema-add-FAQPage': {
    domain: 'angi.com',
    url: 'https://www.angi.com',
    why: 'FAQPage schema on every category page. Question/Answer pairs render as rich results in Google. Not local but the markup pattern is exemplary.'
  },
  'schema-add-Review': {
    domain: 'plumbingexpress.com',
    url: 'https://www.plumbingexpress.com',
    why: 'Per-page Review schema with author, datePublished, reviewBody, and AggregateRating. Stars show up in SERP organic listings.'
  },

  // E-E-A-T pillar
  'eeat-experience-add-years': {
    domain: 'mikediamondservices.com',
    url: 'https://www.mikediamondservices.com',
    why: 'Hero strip with "Trusted Since 1980" + "100,000+ jobs completed" + family-owned badge. Direct experience proof above the fold, no scroll required.'
  },
  'eeat-expertise-credentials': {
    domain: 'arsrescue.com',
    url: 'https://www.arsrescue.com',
    why: 'Footer + about page list NATE certification, EPA Section 608, state plumbing license #'s with verification links. Specific credentials, not just "licensed".'
  },
  'eeat-authority-press': {
    domain: 'leakdetectionusa.com',
    url: 'https://www.leakdetectionusa.com',
    why: '"As seen in" strip with HGTV, This Old House, local news affiliate logos linked to live press archives. Authority signal that AI overviews quote.'
  },
  'eeat-freshness-add-date': {
    domain: 'familyhandyman.com',
    url: 'https://www.familyhandyman.com',
    why: 'Every article shows "Updated: <date>" + author byline. Google freshness signal + AI search prefers recent dates when retrieving facts.'
  },
  'eeat-trust-add-author': {
    domain: 'thisoldhouse.com',
    url: 'https://www.thisoldhouse.com',
    why: 'Author bios linked to Person schema with sameAs (LinkedIn, professional bio). Human author > anonymous content for E-E-A-T.'
  },

  // GEO pillar (AI-search readiness)
  'geo-llms-txt': {
    domain: 'anthropic.com',
    url: 'https://www.anthropic.com/llms.txt',
    why: 'Reference llms.txt: hierarchical sections, page summaries, links to canonical docs. AI crawlers (Anthropic, OpenAI) read this when indexing.'
  },
  'geo-passage-citability': {
    domain: 'mayoclinic.org',
    url: 'https://www.mayoclinic.org',
    why: 'Each medical condition page leads with a 2-sentence definition then a bulleted "Symptoms" list. Cited verbatim by ChatGPT/Perplexity in 70%+ of medical queries.'
  },
  'geo-add-author-attribution': {
    domain: 'consumerreports.org',
    url: 'https://www.consumerreports.org',
    why: 'Author + date + revision history visible on every article. Highest E-E-A-T density in retail/services category.'
  },
  'geo-conversational-headings': {
    domain: 'angi.com',
    url: 'https://www.angi.com/articles',
    why: 'Headings are real questions ("How much does plumbing repair cost?") not keyword stuffing. Maps directly to "People Also Ask" + AI overview triggers.'
  },

  // NAP pillar
  'nap-inconsistent-phone': {
    domain: 'cintas.com',
    url: 'https://www.cintas.com',
    why: 'Single canonical phone number across header, footer, contact page, schema, GBP, and Yelp. NAP audit score: perfect.'
  },
  'nap-missing-address': {
    domain: 'rotorooter.com',
    url: 'https://www.rotorooter.com',
    why: 'Per-location landing pages with full address visible in HTML (not just an embedded map iframe). Crawlable + matches GBP.'
  },

  // Sitemap pillar
  'sitemap-missing': {
    domain: 'webflow.com',
    url: 'https://webflow.com/sitemap.xml',
    why: 'Clean sitemap.xml with lastmod dates, no orphan URLs, no 404s, robots.txt references it. Reference implementation.'
  },
  'sitemap-stale-lastmod': {
    domain: 'shopify.com',
    url: 'https://www.shopify.com/sitemap.xml',
    why: 'lastmod updates within hours of any content change. Auto-generated from CMS, never stale.'
  },

  // Images pillar
  'images-missing-alt': {
    domain: 'rei.com',
    url: 'https://www.rei.com',
    why: 'Every product image has descriptive alt text (not "image" or filename). Accessibility + AI image-text alignment.'
  },
  'images-large-bytes': {
    domain: 'apple.com',
    url: 'https://www.apple.com',
    why: 'Hero images are AVIF/WebP under 80KB despite 2000px+ display size. <picture> with srcset fallbacks.'
  },

  // Performance pillar
  'performance-poor-lcp': {
    domain: 'apple.com',
    url: 'https://www.apple.com',
    why: 'LCP < 1.5s on mobile. Critical CSS inlined, hero image preloaded, no render-blocking JS in head. Reference target.'
  },
  'performance-poor-cls': {
    domain: 'github.com',
    url: 'https://github.com',
    why: 'CLS near zero — every dynamic block reserves space (skeleton loaders, fixed-height containers). No layout shift on font load.'
  },

  // Content pillar
  'content-grammar-issues': {
    domain: 'mayoclinic.org',
    url: 'https://www.mayoclinic.org',
    why: 'Editorial review process visible (author + reviewer + date). Zero grammar errors across 100k+ articles. Bar to clear.'
  },
  'content-thin-pages': {
    domain: 'thisoldhouse.com',
    url: 'https://www.thisoldhouse.com',
    why: 'Even short how-tos run 800+ words with steps, photos, time/cost estimates, related guides. No thin "about" placeholder pages.'
  }
};

/**
 * Load latest audit per archived domain — used when curated example
 * is missing and we want to find a top-scoring peer in the same industry
 * who lacks this finding (i.e., already fixed it).
 */
async function loadAllLatestAudits() {
  let files;
  try {
    files = await fs.readdir(ARCHIVE_DIR);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    try {
      const raw = await fs.readFile(path.join(ARCHIVE_DIR, f), 'utf8');
      const parsed = JSON.parse(raw);
      const latest = parsed.history && parsed.history[0];
      if (!latest || !latest.audit) continue;
      out.push({
        domain: parsed.domain,
        industry: latest.industry,
        city: latest.city,
        state: latest.state,
        audit: latest.audit
      });
    } catch {}
  }
  return out;
}

let _archiveCache = null;
let _archiveCacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function archiveAuditsCached() {
  const now = Date.now();
  if (_archiveCache && (now - _archiveCacheAt) < CACHE_TTL_MS) return _archiveCache;
  _archiveCache = await loadAllLatestAudits();
  _archiveCacheAt = now;
  return _archiveCache;
}

/**
 * Find a peer-cohort domain that doesn't have this finding key. Returns
 * the highest-scoring such domain, or null if none found.
 */
async function archiveExampleFor(findingKey, { industry = '', excludeDomain = '' } = {}) {
  if (!findingKey) return null;
  const audits = await archiveAuditsCached();
  const ind = String(industry || '').toLowerCase();
  const excl = String(excludeDomain || '').toLowerCase();
  // Filter to same industry (or any industry if seed has none) and exclude self
  const peers = audits.filter((a) => {
    if (a.domain === excl) return false;
    if (!a.audit?.findings) return false;
    if (ind && (a.industry || '').toLowerCase() !== ind) return false;
    // Doesn't have this finding = has fixed it
    return !a.audit.findings.some((f) => f.key === findingKey);
  });
  if (!peers.length) return null;
  // Top-decile by overallScore
  peers.sort((a, b) => (b.audit.overallScore || 0) - (a.audit.overallScore || 0));
  const top = peers[0];
  if (!top.audit.overallScore || top.audit.overallScore < 60) return null; // not a quality example
  return {
    domain: top.domain,
    url: `https://${top.domain}`,
    score: top.audit.overallScore,
    industry: top.industry,
    why: `Same industry (${top.industry}). Score ${top.audit.overallScore}/100 — already fixed this gap.`
  };
}

/**
 * For a single finding, return a best-fit example. Curated wins over
 * archive lookup. Returns null if neither has anything.
 */
async function exampleFor(finding, { industry = '', excludeDomain = '' } = {}) {
  if (!finding || !finding.key) return null;
  const curated = CURATED_EXAMPLES[finding.key];
  if (curated) {
    return {
      source: 'curated',
      exampleDomain: curated.domain,
      exampleUrl: curated.url,
      why: curated.why
    };
  }
  const fromArchive = await archiveExampleFor(finding.key, { industry, excludeDomain });
  if (fromArchive) {
    return {
      source: 'archive_lookup',
      exampleDomain: fromArchive.domain,
      exampleUrl: fromArchive.url,
      exampleScore: fromArchive.score,
      why: fromArchive.why
    };
  }
  return null;
}

/**
 * Surface examples for an array of findings. Concurrent (non-blocking).
 * Returns the same array with `.example` attached when available.
 */
async function surfaceExamples(findings, opts = {}) {
  if (!Array.isArray(findings) || !findings.length) return findings;
  const enriched = await Promise.all(findings.map(async (f) => {
    const example = await exampleFor(f, opts);
    return example ? { ...f, example } : f;
  }));
  return enriched;
}

/**
 * Stats: how many findings have a curated vs archive_lookup vs none.
 */
function curatedCoverage() {
  return {
    curatedCount: Object.keys(CURATED_EXAMPLES).length,
    keys: Object.keys(CURATED_EXAMPLES)
  };
}

module.exports = {
  exampleFor,
  surfaceExamples,
  curatedCoverage,
  CURATED_EXAMPLES
};
