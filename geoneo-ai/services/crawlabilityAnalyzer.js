/**
 * Crawlability analyzer. Verifies search engines + AI crawlers can actually
 * reach + understand the site:
 *
 *   - robots.txt blocks of important paths (homepage, /services, /contact)
 *   - canonical tag presence + correctness (self-canonical or accidental
 *     pointing to a different URL)
 *   - redirect chains > 2 hops (each hop loses ~10% of crawler equity)
 *   - meta robots noindex / nofollow on the homepage (death sentence)
 *   - X-Robots-Tag response header noindex
 *   - sitemap declared in robots.txt (extra signal)
 *
 * Inputs come from already-fetched HTML + headers + a small follow-redirects
 * helper for the redirect-chain check. No external API.
 */

const { standardize } = require('./analyzerShape');
const { fetchWithRetry } = require('./httpRetry');
const log = require('./logger').forModule('crawlabilityAnalyzer');

function safeUrl(s) { try { return new URL(s.startsWith('http') ? s : 'https://' + s); } catch { return null; } }

const IMPORTANT_PATHS = ['/', '/contact', '/services', '/about'];

function parseRobotsTxt(robotsTxt) {
  if (!robotsTxt || typeof robotsTxt !== 'string') return { groups: [], sitemaps: [] };
  const groups = [];
  const sitemaps = [];
  let current = null;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [k, ...rest] = line.split(':');
    if (!k || !rest.length) continue;
    const key = k.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') {
      current = { agent: val.toLowerCase(), allow: [], disallow: [] };
      groups.push(current);
    } else if (key === 'allow' && current) {
      current.allow.push(val);
    } else if (key === 'disallow' && current) {
      current.disallow.push(val);
    } else if (key === 'sitemap') {
      sitemaps.push(val);
    }
  }
  return { groups, sitemaps };
}

/**
 * Test if a path is blocked by robots for a given UA. Generic and naïve
 * (doesn't implement full Google semantics) but catches the common failure
 * mode: `Disallow: /` for `User-agent: *`.
 */
function isBlockedFor(parsed, path, agent = '*') {
  if (!parsed?.groups?.length) return false;
  // Pick the most specific group (matching agent first, then * fallback)
  const group = parsed.groups.find((g) => g.agent === agent.toLowerCase())
    || parsed.groups.find((g) => g.agent === '*');
  if (!group) return false;
  const matches = (rule) => rule === '' ? false : path.startsWith(rule.replace(/\*$/, ''));
  const allowed = group.allow.some(matches);
  const disallowed = group.disallow.some(matches);
  return disallowed && !allowed;
}

function extractCanonical(html, currentUrl) {
  if (!html) return null;
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  if (!m) return null;
  let raw = m[1].trim();
  try { return new URL(raw, currentUrl).href; } catch { return raw; }
}

function extractMetaRobots(html) {
  if (!html) return null;
  const m = html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].toLowerCase().split(',').map((s) => s.trim()) : null;
}

/**
 * Walk redirects manually with maxRedirects=10. Returns an array of URLs.
 * Each request times out at 10s. Used to detect redirect chains > 2.
 */
async function followRedirectChain(startUrl, maxRedirects = 10) {
  const chain = [startUrl];
  let url = startUrl;
  for (let i = 0; i < maxRedirects; i++) {
    try {
      const res = await fetchWithRetry(url, { method: 'HEAD', redirect: 'manual' }, { timeoutMs: 10000, maxRetries: 0, label: 'crawl:redirect' });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        url = new URL(loc, url).href;
        chain.push(url);
      } else {
        break;
      }
    } catch (err) {
      log.warn('redirect follow failed', { url, error: err.message });
      break;
    }
  }
  return chain;
}

async function analyzeCrawlability({ url, html = '', robotsTxt = '', responseHeaders = {}, skipRedirectChain = false } = {}) {
  const parsed = safeUrl(url);
  if (!parsed) {
    return { score: 0, findings: [{ id: 'crawl-bad-url', severity: 'critical', title: 'Invalid URL' }] };
  }
  const findings = [];
  const warnings = [];
  let score = 100;
  const headersLower = lowercaseHeaders(responseHeaders);

  // 1. robots.txt parse + check important paths
  const robots = parseRobotsTxt(robotsTxt);
  if (!robotsTxt) {
    findings.push({
      id: 'crawl-no-robots-txt',
      severity: 'minor',
      title: 'No robots.txt found',
      detail: 'A robots.txt isn\'t required, but its absence means search engines can\'t see your sitemap declaration. Add one with at minimum a Sitemap: line.'
    });
    score -= 8;
  } else {
    // Check the homepage path
    if (isBlockedFor(robots, '/')) {
      findings.push({
        id: 'crawl-homepage-blocked',
        severity: 'critical',
        title: 'Homepage blocked by robots.txt',
        detail: 'Your robots.txt has Disallow: / for User-agent: *. Search engines literally cannot index your homepage. This is a death sentence.'
      });
      score -= 60;
    }
    for (const path of IMPORTANT_PATHS.slice(1)) {
      if (isBlockedFor(robots, path)) {
        findings.push({
          id: `crawl-blocked-${path.replace(/\//g, '-').replace(/^-/, '')}`,
          severity: 'major',
          title: `${path} blocked by robots.txt`,
          detail: `Search engines can't index ${path}. Verify this is intentional.`
        });
        score -= 12;
      }
    }
    if (!robots.sitemaps.length) {
      findings.push({
        id: 'crawl-no-sitemap-decl',
        severity: 'minor',
        title: 'robots.txt doesn\'t declare a Sitemap',
        detail: 'Add `Sitemap: https://yourdomain.com/sitemap.xml` to robots.txt — minor improvement to crawler discovery.'
      });
      score -= 4;
    }
  }

  // 2. Canonical tag
  const canonical = extractCanonical(html, url);
  if (!canonical) {
    findings.push({
      id: 'crawl-missing-canonical',
      severity: 'minor',
      title: 'Missing canonical tag',
      detail: 'Add <link rel="canonical" href="..."> to every page. Prevents duplicate-content penalties when URL parameters or trailing slashes vary.'
    });
    score -= 6;
  } else {
    try {
      const canonicalParsed = new URL(canonical);
      const currentParsed = new URL(url);
      const sameHost = canonicalParsed.hostname.replace(/^www\./, '') === currentParsed.hostname.replace(/^www\./, '');
      if (!sameHost) {
        findings.push({
          id: 'crawl-canonical-cross-domain',
          severity: 'critical',
          title: 'Canonical tag points to a different domain',
          detail: `Your canonical points to ${canonicalParsed.hostname}. This tells Google to index THAT site instead of yours. Very dangerous unless intentional.`
        });
        score -= 50;
      }
    } catch {
      findings.push({
        id: 'crawl-canonical-invalid',
        severity: 'major',
        title: 'Invalid canonical URL',
        detail: `Canonical tag value isn't a valid URL: ${String(canonical).slice(0, 100)}.`
      });
      score -= 18;
    }
  }

  // 3. Meta robots noindex check
  const metaRobots = extractMetaRobots(html);
  if (metaRobots && (metaRobots.includes('noindex') || metaRobots.includes('none'))) {
    findings.push({
      id: 'crawl-noindex-on-page',
      severity: 'critical',
      title: 'Page has noindex directive',
      detail: 'Your <meta name="robots" content="noindex"> tells search engines to drop this page from results. Remove unless this is intentional (e.g. /thank-you).'
    });
    score -= 50;
  }
  // X-Robots-Tag header
  const xRobots = headersLower['x-robots-tag'];
  if (xRobots && (String(xRobots).toLowerCase().includes('noindex') || String(xRobots).toLowerCase().includes('none'))) {
    findings.push({
      id: 'crawl-noindex-header',
      severity: 'critical',
      title: 'X-Robots-Tag: noindex header',
      detail: 'Your server is sending an X-Robots-Tag: noindex header. Removes the page from search even with no on-page tag.'
    });
    score -= 50;
  }

  // 4. Redirect chain (skipped in batch mode — saves ~2-5s/audit)
  let redirectChain = null;
  if (!skipRedirectChain) {
    try {
      redirectChain = await followRedirectChain(url);
      if (redirectChain.length > 3) {
        findings.push({
          id: 'crawl-redirect-chain',
          severity: 'major',
          title: `Redirect chain has ${redirectChain.length - 1} hops`,
          detail: `Each redirect costs crawler equity. Chain: ${redirectChain.slice(0, 4).map((u) => new URL(u).pathname).join(' → ')}`,
          metadata: { chain: redirectChain }
        });
        score -= 12;
      }
    } catch (err) {
      warnings.push({ message: 'redirect chain check failed', error: err.message });
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    findings,
    warnings,
    canonical,
    metaRobots,
    redirectChain,
    robotsParsed: { sitemapCount: robots.sitemaps.length, groupCount: robots.groups.length }
  };
}

function lowercaseHeaders(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[String(k).toLowerCase()] = v;
  return out;
}

module.exports = {
  analyze: standardize('crawlability', analyzeCrawlability),
  analyzeCrawlability,
  parseRobotsTxt,
  isBlockedFor,
  extractCanonical,
  extractMetaRobots,
  followRedirectChain
};
