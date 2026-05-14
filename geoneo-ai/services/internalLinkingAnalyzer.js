/**
 * Internal linking analyzer. Looks at the homepage HTML and detects:
 *
 *   - Outbound internal link count (signal of overall site connectedness)
 *   - Orphan signals: too few unique internal links from homepage
 *   - Important pages missing from homepage navigation (services, contact, about)
 *   - Broken internal links (best-effort sample of 10 — full crawl is too slow
 *     for the audit window; sampling catches major issues)
 *   - Excessive link depth signals (page links pointing 3+ deep into the site)
 *
 * Doesn't crawl deeply — runs against the already-fetched homepage HTML and
 * a small probe of up to 10 internal URLs. Safe for the 8s audit budget.
 */

const { standardize } = require('./analyzerShape');
const { fetchWithRetry } = require('./httpRetry');
const log = require('./logger').forModule('internalLinkingAnalyzer');

function safeUrl(s, base) { try { return new URL(s, base); } catch { return null; } }

const IMPORTANT_PAGE_PATTERNS = [
  { id: 'contact', regex: /\/contact|\/get-in-touch|\/reach-us/i, label: 'Contact' },
  { id: 'about', regex: /\/about|\/our-story|\/who-we-are/i, label: 'About' },
  { id: 'services', regex: /\/services|\/what-we-do|\/solutions|\/products/i, label: 'Services' },
  { id: 'reviews', regex: /\/reviews|\/testimonials|\/case-studies/i, label: 'Reviews/Testimonials' }
];

function extractInternalLinks(html, baseUrl) {
  if (!html) return [];
  const baseHost = (() => { try { return new URL(baseUrl).hostname.replace(/^www\./, ''); } catch { return null; } })();
  if (!baseHost) return [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;
    const u = safeUrl(raw, baseUrl);
    if (!u) continue;
    const host = u.hostname.replace(/^www\./, '');
    if (host !== baseHost) continue; // external
    const key = u.pathname + u.search;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u.href);
  }
  return out;
}

/**
 * Sample HEAD-check up to N internal links. Returns broken ones (4xx/5xx).
 * Bounded total time at 8s wall-clock so we don't blow the audit budget.
 */
async function probeForBrokenLinks(links, { sample = 10, wallClockMs = 8000 } = {}) {
  if (!links.length) return [];
  const sampled = links.slice(0, sample);
  const broken = [];
  const start = Date.now();
  await Promise.all(sampled.map(async (u) => {
    if (Date.now() - start > wallClockMs) return;
    try {
      const res = await fetchWithRetry(u, { method: 'HEAD', redirect: 'follow' }, { timeoutMs: 4000, maxRetries: 0, label: 'internal-links' });
      if (res.status >= 400) broken.push({ url: u, status: res.status });
    } catch {
      // network failure — count as broken candidate but don't be alarmist
      broken.push({ url: u, status: 'unreachable' });
    }
  }));
  return broken;
}

async function analyzeInternalLinking({ url, html = '', skipProbe = false } = {}) {
  const findings = [];
  const warnings = [];
  let score = 100;
  if (!html) {
    return {
      score: 0,
      findings: [{ id: 'links-no-html', severity: 'critical', title: 'No HTML to analyze' }]
    };
  }
  const links = extractInternalLinks(html, url);
  // 1. Total internal link count
  if (links.length < 5) {
    findings.push({
      id: 'links-too-few-internal',
      severity: 'major',
      title: `Only ${links.length} internal link(s) on homepage`,
      detail: 'Healthy small-business sites have 15-50 internal links from the homepage (nav, footer, in-content). Too few = orphan pages and weak crawl-depth signal.'
    });
    score -= 25;
  } else if (links.length < 10) {
    findings.push({
      id: 'links-low-internal',
      severity: 'minor',
      title: `Low internal link count (${links.length})`,
      detail: 'Add a footer with links to your top services + contact, or a quick-links sidebar. Helps both visitors and crawlers.'
    });
    score -= 10;
  }

  // 2. Important pages missing
  for (const pattern of IMPORTANT_PAGE_PATTERNS) {
    const found = links.some((u) => pattern.regex.test(u));
    if (!found) {
      findings.push({
        id: `links-missing-${pattern.id}`,
        severity: pattern.id === 'contact' ? 'major' : 'minor',
        title: `No link to a "${pattern.label}" page from homepage`,
        detail: `Add a clear ${pattern.label.toLowerCase()} link in your top nav or footer. Both visitors and AI crawlers expect this on a real business site.`
      });
      score -= pattern.id === 'contact' ? 12 : 5;
    }
  }

  // 3. Broken-link sample probe (skippable for batch mode)
  let broken = [];
  if (!skipProbe && links.length) {
    try {
      broken = await probeForBrokenLinks(links);
      if (broken.length) {
        findings.push({
          id: 'links-broken-detected',
          severity: 'major',
          title: `${broken.length} broken internal link(s) detected (sampled)`,
          detail: `Of ${Math.min(10, links.length)} sampled internal links, ${broken.length} returned errors. Broken links erode trust + crawler equity. Examples: ${broken.slice(0, 3).map((b) => `${new URL(b.url).pathname} → ${b.status}`).join(', ')}`,
          metadata: { broken }
        });
        score -= Math.min(20, broken.length * 4);
      }
    } catch (err) {
      warnings.push({ message: 'broken-link probe failed', error: err.message });
      log.warn('probe failed', { error: err.message });
    }
  }

  // 4. Excessive depth signals (links with 3+ path segments suggest deep architecture)
  const deepLinks = links.filter((u) => {
    try { return new URL(u).pathname.split('/').filter(Boolean).length >= 3; } catch { return false; }
  });
  if (deepLinks.length > 5) {
    findings.push({
      id: 'links-deep-architecture',
      severity: 'minor',
      title: `${deepLinks.length} links point 3+ levels deep`,
      detail: 'Flatter site architecture (max 2-3 clicks from homepage to any page) ranks better. Consider lifting your most important deep pages to top-level URLs.'
    });
    score -= 5;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    findings,
    warnings,
    metrics: {
      totalInternalLinks: links.length,
      brokenSampled: broken.length,
      deepLinks: deepLinks.length
    }
  };
}

module.exports = {
  analyze: standardize('internal_linking', analyzeInternalLinking),
  analyzeInternalLinking,
  extractInternalLinks,
  probeForBrokenLinks
};
