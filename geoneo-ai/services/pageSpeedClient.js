/**
 * PageSpeed Insights client.
 *
 * Returns Lighthouse SEO/performance/best-practices/accessibility scores +
 * the three Core Web Vitals (LCP, CLS, INP) for one URL. Used by the deep
 * audit's "performance" pillar.
 *
 * Two paths:
 *   - PAGESPEED_API_KEY in env → authenticated tier, higher quota
 *   - no key → unauthenticated tier (works, but heavily rate-limited)
 *
 * Caching: 10-min in-memory cache keyed by URL + strategy. Repeated audits
 * during a closer-sheet refresh / discovery loop never re-hit the API for
 * the same URL.
 *
 * Failure modes:
 *   - Timeout (15s) → return null, mark reason
 *   - HTTP 4xx/5xx → return null, mark reason
 *   - No categories in payload → return null
 *   Caller treats null as "performance signal unavailable" and degrades
 *   gracefully (the analyzer still runs, just with empty fields).
 */

const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const STATIC_MESSAGES = {
  http_429: 'Google PageSpeed temporarily rate-limited. Performance pillar will use estimated values.',
  http_400: 'Google PageSpeed could not score this URL. Performance pillar will use estimated values.',
  timeout: 'Google PageSpeed timed out. Performance pillar will use estimated values.',
  network: 'Google PageSpeed network error. Performance pillar will use estimated values.',
  no_categories: 'Google PageSpeed returned no Lighthouse categories.'
};

function cacheKey(url, strategy) {
  return `${strategy}|${url}`;
}

function getFromCache(url, strategy) {
  const entry = cache.get(cacheKey(url, strategy));
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(cacheKey(url, strategy));
    return null;
  }
  return entry.value;
}

function setInCache(url, strategy, value) {
  cache.set(cacheKey(url, strategy), { at: Date.now(), value });
}

/**
 * Pull the three Core Web Vitals out of a Lighthouse audit payload.
 * Lighthouse exposes these as audits with `numericValue` (raw) + `displayValue`.
 */
function extractCwv(audits) {
  if (!audits) return { lcp: null, cls: null, inp: null };
  const get = (key) => {
    const a = audits[key];
    if (!a) return null;
    return {
      raw: typeof a.numericValue === 'number' ? a.numericValue : null,
      display: a.displayValue || null,
      score: typeof a.score === 'number' ? Math.round(a.score * 100) : null
    };
  };
  return {
    lcp: get('largest-contentful-paint'),
    cls: get('cumulative-layout-shift'),
    inp: get('interaction-to-next-paint') || get('experimental-interaction-to-next-paint')
  };
}

/**
 * Convert Lighthouse 0-1 category scores into our 0-100 pillar values.
 */
function lighthouseToPillar(categories) {
  if (!categories) return null;
  const round = (key) => {
    const c = categories[key];
    if (!c || typeof c.score !== 'number') return null;
    return Math.round(c.score * 100);
  };
  return {
    performance: round('performance'),
    seo: round('seo'),
    bestPractices: round('best-practices'),
    accessibility: round('accessibility')
  };
}

async function fetchPageSpeed(url, { strategy = 'mobile', timeoutMs = TIMEOUT_MS, env = process.env } = {}) {
  if (!url) return null;
  const cached = getFromCache(url, strategy);
  if (cached) return { ...cached, fromCache: true };

  const endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', strategy);
  endpoint.searchParams.append('category', 'seo');
  endpoint.searchParams.append('category', 'performance');
  endpoint.searchParams.append('category', 'best-practices');
  endpoint.searchParams.append('category', 'accessibility');
  if (env.PAGESPEED_API_KEY) {
    endpoint.searchParams.set('key', env.PAGESPEED_API_KEY);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(endpoint.toString(), { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeout);
    const reason = err && err.name === 'AbortError' ? 'timeout' : 'network';
    return { available: false, reason, message: STATIC_MESSAGES[reason] };
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const reason = response.status === 429 ? 'http_429' : (response.status === 400 ? 'http_400' : `http_${response.status}`);
    return { available: false, reason, message: STATIC_MESSAGES[reason] || `Google PageSpeed returned ${response.status}.` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { available: false, reason: 'invalid_json', message: 'Google PageSpeed response was not valid JSON.' };
  }

  const lhResult = payload?.lighthouseResult || {};
  const pillar = lighthouseToPillar(lhResult.categories);
  if (!pillar) {
    return { available: false, reason: 'no_categories', message: STATIC_MESSAGES.no_categories };
  }

  const cwv = extractCwv(lhResult.audits || {});
  const fetchTimeMs = Number(lhResult?.timing?.total) || null;
  const result = {
    available: true,
    strategy,
    fetchedAt: new Date().toISOString(),
    pillar,
    cwv,
    fetchTimeMs,
    finalUrl: lhResult?.finalUrl || url,
    apiKeyUsed: Boolean(env.PAGESPEED_API_KEY)
  };
  setInCache(url, strategy, result);
  return result;
}

/**
 * Convert raw CWV into our 0-100 score using Google's published thresholds:
 *   LCP good ≤ 2500ms, poor ≥ 4000ms
 *   CLS good ≤ 0.1, poor ≥ 0.25
 *   INP good ≤ 200ms, poor ≥ 500ms
 * Linear interpolation between good and poor; <good → 100, >poor → 25.
 */
function scoreCwvMetric(value, goodThreshold, poorThreshold) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= goodThreshold) return 100;
  if (value >= poorThreshold) return 25;
  const span = poorThreshold - goodThreshold;
  const into = (value - goodThreshold) / span;
  return Math.round(100 - (into * 75));
}

/**
 * Top-level "performance" analyzer. Returns the same shape as the other
 * deep-audit sub-analyzers (overallScore, status, fixes, findings) so the
 * orchestrator and UI can treat it identically.
 *
 * If the API call failed, returns a degraded result rather than throwing —
 * the rest of the audit must still complete.
 */
/**
 * Cheap structural performance estimate from raw HTML.
 * Doesn't replace real CWV — but catches the worst offenders (40 unminified
 * scripts, no async/defer, render-blocking CSS) so we always have a signal
 * even when PageSpeed is rate-limited.
 */
function estimatePerformanceFromHtml(html) {
  if (!html) return null;
  const findings = [];
  let score = 100;

  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const headSection = (html.match(/<head[^>]*>([\s\S]{0,30000})<\/head>/i) || [])[1] || html.slice(0, 30000);
  const scriptsInHead = headSection.match(/<script\b[^>]*>/gi) || [];
  const blockingScripts = scriptsInHead.filter((s) => !/(?:async|defer|type=["']module)/i.test(s));
  const stylesheetsInHead = headSection.match(/<link[^>]+rel=["']stylesheet[^>]*>/gi) || [];
  const inlineStyles = (html.match(/<style\b/gi) || []).length;
  const totalScripts = (html.match(/<script\b/gi) || []).length;
  const totalImages = (html.match(/<img\b/gi) || []).length;
  const lazyImages = (html.match(/<img[^>]+loading=["']lazy["']/gi) || []).length;
  const hasPreloadHints = /<link[^>]+rel=["'](?:preload|preconnect|dns-prefetch)["']/i.test(headSection);

  // HTML weight (15 pts): under 100KB = good
  if (htmlBytes > 500_000) {
    score -= 15;
    findings.push({
      key: 'perf-large-html',
      severity: 'medium',
      title: `HTML payload is ${Math.round(htmlBytes / 1024)}KB — large`,
      detail: 'Bloated HTML hurts TTFB and LCP. Common causes: too much inline CSS/JS, embedded SVG sprites, no template trimming. Aim for <200KB raw HTML.',
      effortMinutes: 60
    });
  } else if (htmlBytes > 200_000) {
    score -= 8;
    findings.push({
      key: 'perf-medium-html',
      severity: 'low',
      title: `HTML payload is ${Math.round(htmlBytes / 1024)}KB — moderately large`,
      detail: 'Trim inline CSS/JS where possible. <200KB raw HTML is the sweet spot.',
      effortMinutes: 30
    });
  }

  // Render-blocking scripts in <head> (25 pts) — the #1 LCP killer
  if (blockingScripts.length >= 5) {
    score -= 25;
    findings.push({
      key: 'perf-blocking-scripts',
      severity: 'high',
      title: `${blockingScripts.length} render-blocking <script> tags in <head>`,
      detail: 'Each blocking script delays first paint. Add async or defer to non-critical scripts, OR move them to the end of <body>.',
      effortMinutes: 30
    });
  } else if (blockingScripts.length >= 2) {
    score -= 12;
    findings.push({
      key: 'perf-blocking-scripts-some',
      severity: 'medium',
      title: `${blockingScripts.length} render-blocking <script> tags in <head>`,
      detail: 'Add async or defer to all non-critical scripts (analytics, chat widgets) to unblock first paint.',
      effortMinutes: 15
    });
  }

  // CSS in <head> (10 pts) — too many = cascading network requests
  if (stylesheetsInHead.length >= 6) {
    score -= 10;
    findings.push({
      key: 'perf-too-many-stylesheets',
      severity: 'medium',
      title: `${stylesheetsInHead.length} stylesheet <link>s in <head>`,
      detail: 'Each stylesheet adds a network round-trip before render. Bundle/minify stylesheets, defer non-critical CSS.',
      effortMinutes: 60
    });
  }

  // Image lazy-loading (15 pts)
  if (totalImages >= 8 && lazyImages / totalImages < 0.3) {
    score -= 15;
    findings.push({
      key: 'perf-no-lazy-images',
      severity: 'medium',
      title: `${totalImages - lazyImages} of ${totalImages} images not lazy-loaded`,
      detail: 'Add loading="lazy" to images below the fold. Native lazy loading saves bandwidth and improves LCP on image-heavy pages.',
      effortMinutes: 20
    });
  }

  // Preload/preconnect hints (10 pts) — modern best practice
  if (totalScripts >= 5 && !hasPreloadHints) {
    score -= 8;
    findings.push({
      key: 'perf-no-preload-hints',
      severity: 'low',
      title: 'No preload / preconnect / dns-prefetch hints in <head>',
      detail: 'Add <link rel="preconnect" href="..."> for font/CDN domains and <link rel="preload"> for the LCP image. Cuts ~200ms off first paint.',
      effortMinutes: 15
    });
  }

  // Inline style explosion (10 pts) — usually means no design system
  if (inlineStyles > 10) {
    score -= 10;
    findings.push({
      key: 'perf-too-many-inline-styles',
      severity: 'low',
      title: `${inlineStyles} <style> blocks inline in HTML`,
      detail: 'Many <style> blocks indicate no design system. Consolidate into one external stylesheet, then critical-CSS the above-the-fold portion.',
      effortMinutes: 120
    });
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    findings,
    metrics: {
      htmlBytes,
      scriptsTotal: totalScripts,
      blockingScripts: blockingScripts.length,
      stylesheetsInHead: stylesheetsInHead.length,
      inlineStyles,
      totalImages,
      lazyImages,
      hasPreloadHints
    }
  };
}

async function analyzePerformance({ finalUrl, html = '', skipApi = false, env = process.env } = {}) {
  // Cheap structural estimate first — always available, never blocks audit.
  const cheapEst = estimatePerformanceFromHtml(html);

  // Skip the PSI API in cheap mode — return structural estimate only.
  if (skipApi) {
    if (!cheapEst) {
      return { overallScore: 0, status: 'unavailable', available: false, reason: 'no_html', findings: [], fixes: [] };
    }
    return {
      overallScore: cheapEst.score,
      status: cheapEst.score >= 75 ? 'pass' : cheapEst.score >= 50 ? 'warn' : 'fail',
      available: true,
      mode: 'structural_only',
      message: 'Cheap-tier audit: structural performance estimate (no PageSpeed API call).',
      structural: cheapEst.metrics,
      fixes: cheapEst.findings,
      findings: cheapEst.findings,
      cwv: null,
      pillar: null
    };
  }

  const ps = await fetchPageSpeed(finalUrl, { env });

  if (!ps || !ps.available) {
    // PSI failed (rate-limit, timeout, etc.) — fall back to structural estimate
    // instead of returning "unavailable" so the pillar always contributes.
    if (cheapEst) {
      return {
        overallScore: cheapEst.score,
        status: cheapEst.score >= 75 ? 'pass' : cheapEst.score >= 50 ? 'warn' : 'fail',
        available: true,
        mode: 'structural_fallback',
        message: `PageSpeed unavailable (${ps?.reason || 'unknown'}). Score uses structural estimate — set PAGESPEED_API_KEY for full Core Web Vitals.`,
        structural: cheapEst.metrics,
        fixes: cheapEst.findings,
        findings: cheapEst.findings,
        cwv: null,
        pillar: null
      };
    }
    return {
      overallScore: 0,
      status: 'unavailable',
      available: false,
      reason: ps?.reason || 'unknown',
      message: ps?.message || 'PageSpeed signal unavailable.',
      cwv: null,
      pillar: null,
      findings: [],
      fixes: []
    };
  }

  const { lcp, cls, inp } = ps.cwv;
  const lcpScore = lcp?.raw != null ? scoreCwvMetric(lcp.raw, 2500, 4000) : null;
  const clsScore = cls?.raw != null ? scoreCwvMetric(cls.raw, 0.1, 0.25) : null;
  const inpScore = inp?.raw != null ? scoreCwvMetric(inp.raw, 200, 500) : null;

  // Overall = average of (Lighthouse performance) and (real CWV scores when present)
  const cwvScores = [lcpScore, clsScore, inpScore].filter((v) => v != null);
  const cwvAvg = cwvScores.length ? Math.round(cwvScores.reduce((s, v) => s + v, 0) / cwvScores.length) : null;
  const overall = cwvAvg != null
    ? Math.round((ps.pillar.performance + cwvAvg) / 2)
    : ps.pillar.performance;

  // Build fixes for any CWV that's failing (≤ 50 score).
  const fixes = [];
  if (lcpScore != null && lcpScore <= 50) {
    fixes.push({
      key: 'cwv-lcp',
      severity: lcpScore <= 30 ? 'high' : 'medium',
      title: `LCP is slow (${lcp.display})`,
      detail: 'Largest Contentful Paint is the time until the biggest above-the-fold element renders. Optimize hero images (WebP, correct dimensions, preload), defer non-critical JS, and serve from a CDN.',
      effortMinutes: 90
    });
  }
  if (clsScore != null && clsScore <= 50) {
    fixes.push({
      key: 'cwv-cls',
      severity: clsScore <= 30 ? 'high' : 'medium',
      title: `Layout shifts during load (CLS ${cls.display})`,
      detail: 'Cumulative Layout Shift means content jumps as the page loads. Set explicit width/height on images, reserve space for ads/embeds, and avoid injecting content above existing elements.',
      effortMinutes: 60
    });
  }
  if (inpScore != null && inpScore <= 50) {
    fixes.push({
      key: 'cwv-inp',
      severity: inpScore <= 30 ? 'high' : 'medium',
      title: `Slow response to interactions (INP ${inp.display})`,
      detail: 'Interaction to Next Paint measures how quickly the page responds to taps/clicks. Break up long JS tasks, debounce input handlers, and remove heavy third-party scripts from the critical path.',
      effortMinutes: 120
    });
  }
  if (ps.pillar.performance != null && ps.pillar.performance < 50) {
    fixes.push({
      key: 'lighthouse-performance',
      severity: 'medium',
      title: `Lighthouse performance score is ${ps.pillar.performance}/100`,
      detail: 'Run the full Lighthouse report and address the largest opportunities: image format/sizing, render-blocking resources, and unused JavaScript.',
      effortMinutes: 180
    });
  }

  return {
    overallScore: overall,
    status: overall >= 75 ? 'pass' : overall >= 50 ? 'warn' : 'fail',
    available: true,
    fromCache: Boolean(ps.fromCache),
    strategy: ps.strategy,
    fetchedAt: ps.fetchedAt,
    apiKeyUsed: ps.apiKeyUsed,
    pillar: ps.pillar,
    cwv: {
      lcp: lcp ? { ...lcp, score: lcpScore } : null,
      cls: cls ? { ...cls, score: clsScore } : null,
      inp: inp ? { ...inp, score: inpScore } : null
    },
    findings: fixes,
    fixes
  };
}

module.exports = {
  analyzePerformance,
  fetchPageSpeed,
  scoreCwvMetric
};
