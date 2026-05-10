/**
 * Sitemap Validator — parses sitemap.xml + sitemap_index.xml, validates
 * URL structure, counts entries, checks lastmod freshness, detects common
 * configuration mistakes. NO LLM.
 */

function parseSitemapXml(xml = '') {
  if (!xml) return { type: 'none', urls: [], sitemaps: [], parseError: null };
  if (!/<\?xml|<urlset|<sitemapindex/i.test(xml)) {
    return { type: 'invalid', urls: [], sitemaps: [], parseError: 'No XML or sitemap markers found' };
  }
  const isIndex = /<sitemapindex/i.test(xml);
  const result = { type: isIndex ? 'index' : 'urlset', urls: [], sitemaps: [], parseError: null };

  if (isIndex) {
    const re = /<sitemap[^>]*>([\s\S]*?)<\/sitemap>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];
      const loc = block.match(/<loc>([^<]+)<\/loc>/i);
      const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/i);
      if (loc) result.sitemaps.push({ loc: loc[1].trim(), lastmod: lastmod ? lastmod[1].trim() : null });
    }
  } else {
    const re = /<url[^>]*>([\s\S]*?)<\/url>/gi;
    let m;
    while ((m = re.exec(xml)) !== null) {
      const block = m[1];
      const loc = block.match(/<loc>([^<]+)<\/loc>/i);
      const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/i);
      const changefreq = block.match(/<changefreq>([^<]+)<\/changefreq>/i);
      const priority = block.match(/<priority>([^<]+)<\/priority>/i);
      if (loc) result.urls.push({
        loc: loc[1].trim(),
        lastmod: lastmod ? lastmod[1].trim() : null,
        changefreq: changefreq ? changefreq[1].trim() : null,
        priority: priority ? Number(priority[1]) : null
      });
    }
  }
  return result;
}

function validateSitemapUrls(urls = []) {
  const issues = [];
  const seenLocs = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;
  let staleCount = 0;
  let httpCount = 0;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

  urls.forEach(u => {
    let valid = true;
    try { new URL(u.loc); } catch { valid = false; invalidCount++; issues.push({ url: u.loc, issue: 'invalid URL syntax' }); }
    if (!valid) return;
    if (u.loc.startsWith('http://')) { httpCount++; }
    if (seenLocs.has(u.loc)) { duplicateCount++; }
    seenLocs.add(u.loc);
    if (u.lastmod) {
      const t = Date.parse(u.lastmod);
      if (Number.isFinite(t) && t < oneYearAgo) staleCount++;
    }
  });

  return { invalidCount, duplicateCount, staleCount, httpCount, totalUnique: seenLocs.size, issues };
}

function analyzeSitemap({ sitemapXml, sitemapUrl, robotsTxt = '' }) {
  const parsed = parseSitemapXml(sitemapXml || '');
  const validation = validateSitemapUrls(parsed.urls);
  const robotsHasSitemapDirective = /sitemap\s*:/i.test(robotsTxt);

  let score = 100;
  const fixes = [];

  if (parsed.type === 'none' || (parsed.urls.length === 0 && parsed.sitemaps.length === 0)) {
    score = 0;
    fixes.push({
      key: 'sitemap-missing',
      severity: 'high',
      title: 'No sitemap.xml found',
      detail: 'Search engines crawl more thoroughly when given a sitemap. Generate one (most CMS platforms have plugins) and submit to Google Search Console.',
      effortMinutes: 20
    });
  }

  if (parsed.parseError) {
    score = Math.min(score, 30);
    fixes.push({
      key: 'sitemap-parse-error',
      severity: 'high',
      title: 'Sitemap XML is malformed',
      detail: parsed.parseError,
      effortMinutes: 15
    });
  }

  if (validation.invalidCount > 0) {
    score -= Math.min(20, validation.invalidCount * 4);
    fixes.push({
      key: 'sitemap-invalid-urls',
      severity: 'medium',
      title: `${validation.invalidCount} sitemap URL${validation.invalidCount > 1 ? 's are' : ' is'} malformed`,
      detail: 'Invalid URLs in sitemap waste crawl budget and signal quality issues. Fix or remove.',
      effortMinutes: 10
    });
  }

  if (validation.httpCount > 0) {
    score -= 10;
    fixes.push({
      key: 'sitemap-http-urls',
      severity: 'medium',
      title: `${validation.httpCount} URL${validation.httpCount > 1 ? 's use' : ' uses'} http:// instead of https://`,
      detail: 'Mixed-protocol sitemaps confuse search engines and signal incomplete HTTPS migration.',
      effortMinutes: 10
    });
  }

  if (validation.duplicateCount > 0) {
    score -= 5;
    fixes.push({
      key: 'sitemap-duplicates',
      severity: 'low',
      title: `${validation.duplicateCount} duplicate URL${validation.duplicateCount > 1 ? 's' : ''} in sitemap`,
      detail: 'Duplicates dilute crawl signal. Deduplicate the sitemap.',
      effortMinutes: 10
    });
  }

  if (validation.staleCount > parsed.urls.length * 0.5 && parsed.urls.length > 0) {
    score -= 8;
    fixes.push({
      key: 'sitemap-stale',
      severity: 'low',
      title: 'Most sitemap URLs have lastmod >1 year old',
      detail: 'Stale lastmod tells search engines content is dormant. Update lastmod when pages actually change.',
      effortMinutes: 15
    });
  }

  if (parsed.urls.length > 0 && !robotsHasSitemapDirective) {
    score -= 5;
    fixes.push({
      key: 'sitemap-not-in-robots',
      severity: 'low',
      title: 'robots.txt does not reference your sitemap',
      detail: `Add "Sitemap: ${sitemapUrl || 'https://yourdomain.com/sitemap.xml'}" to robots.txt so all crawlers find it.`,
      copyPasteReady: true,
      snippet: `Sitemap: ${sitemapUrl || 'https://yourdomain.com/sitemap.xml'}`,
      effortMinutes: 2
    });
  }

  return {
    overallScore: Math.max(0, Math.min(100, score)),
    status: score >= 75 ? 'pass' : score >= 50 ? 'warn' : 'fail',
    type: parsed.type,
    urlCount: parsed.urls.length,
    sitemapCount: parsed.sitemaps.length,
    validation,
    robotsHasSitemapDirective,
    fixes,
    sampleUrls: parsed.urls.slice(0, 5).map(u => u.loc)
  };
}

module.exports = { analyzeSitemap, parseSitemapXml, validateSitemapUrls };
