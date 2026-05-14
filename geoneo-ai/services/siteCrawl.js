/**
 * Same-origin limited BFS crawl for website audits (static HTML fetch only).
 * Respects max pages, max depth, total time budget, and basic robots.txt Disallow rules for User-agent: *.
 */

const DEFAULT_MAX_PAGES = 30;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_TOTAL_BUDGET_MS = 45000;
const DEFAULT_PER_FETCH_MS = 12000;

const BINARY_OR_NON_PAGE_EXT = /\.(?:pdf|zip|rar|7z|tar|gz|jpg|jpeg|png|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|eot|mp4|webm|mp3|wav|xml|json|txt|docx?|xlsx?)(?:\?|#|$)/i;

function normalizeInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseBoolean(val, fallback) {
  if (val == null) return fallback;
  const s = String(val).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(s)) return true;
  if (['false', '0', 'no'].includes(s)) return false;
  return fallback;
}

function crawlConfigFromEnv(env = process.env) {
  return {
    enabled: parseBoolean(env.GEONEO_SITE_CRAWL_ENABLED, true),
    maxPages: normalizeInt(env.GEONEO_SITE_CRAWL_MAX_PAGES, DEFAULT_MAX_PAGES),
    maxDepth: normalizeInt(env.GEONEO_SITE_CRAWL_MAX_DEPTH, DEFAULT_MAX_DEPTH),
    totalBudgetMs: normalizeInt(env.GEONEO_SITE_CRAWL_BUDGET_MS, DEFAULT_TOTAL_BUDGET_MS),
    perFetchMs: normalizeInt(env.GEONEO_SITE_CRAWL_PER_FETCH_MS, DEFAULT_PER_FETCH_MS)
  };
}

function normalizeCrawlUrl(input) {
  try {
    const u = new URL(input);
    u.hash = '';
    return u.href;
  } catch {
    return '';
  }
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Parse Disallow rules under User-agent: * */
function parseRobotsDisallows(robotsText) {
  const lines = String(robotsText || '').split(/\r?\n/);
  const disallows = [];
  let inStarBlock = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const ua = line.match(/^user-agent:\s*(.+)$/i);
    if (ua) {
      inStarBlock = ua[1].trim().toLowerCase() === '*';
      continue;
    }

    const dis = line.match(/^disallow:\s*(.*)$/i);
    if (dis && inStarBlock) {
      const p = dis[1].trim();
      if (p) disallows.push(p);
    }
  }

  return disallows;
}

function isDisallowedByRobots(pathname, disallows) {
  const path = pathname || '/';
  for (const rule of disallows) {
    if (!rule) continue;
    if (path.startsWith(rule)) return true;
  }
  return false;
}

function extractTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function countWords(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** Minimal HTML stripping for word count (reuse server htmlToText would be circular). */
function htmlToPlainText(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldSkipHrefForQueue(href, baseUrl) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
    return true;
  }
  try {
    const resolved = new URL(href, baseUrl);
    const path = (resolved.pathname || '/').replace(/\/+$/, '') || '/';
    return BINARY_OR_NON_PAGE_EXT.test(path);
  } catch {
    return true;
  }
}

function extractSameOriginLinks(html, pageUrl, origin) {
  const out = [];
  const seen = new Set();
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match = anchorRegex.exec(String(html || ''));
  while (match) {
    const rawHref = match[1] ? match[1].trim() : '';
    if (shouldSkipHrefForQueue(rawHref, pageUrl)) {
      match = anchorRegex.exec(String(html || ''));
      continue;
    }
    try {
      const resolved = new URL(rawHref, pageUrl);
      if (resolved.origin !== origin) {
        match = anchorRegex.exec(String(html || ''));
        continue;
      }
      resolved.hash = '';
      const next = normalizeCrawlUrl(resolved.href);
      if (next && !seen.has(next)) {
        seen.add(next);
        out.push(next);
      }
    } catch {
      // ignore
    }
    match = anchorRegex.exec(String(html || ''));
  }
  return out;
}

async function fetchRobotsDisallows(origin, userAgent, perFetchMs, signal) {
  const url = `${origin}/robots.txt`;
  let timer = null;
  try {
    let fetchSignal = signal;
    if (!signal) {
      const controller = new AbortController();
      fetchSignal = controller.signal;
      timer = setTimeout(() => controller.abort(), perFetchMs);
    }
    const res = await fetch(url, {
      redirect: 'follow',
      signal: fetchSignal,
      headers: { 'User-Agent': userAgent, Accept: 'text/plain,*/*' }
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    return parseRobotsDisallows(text);
  } catch {
    if (timer) clearTimeout(timer);
    return [];
  }
}

async function fetchHtmlPage(targetUrl, userAgent, perFetchMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), perFetchMs);
  try {
    const res = await fetch(targetUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' }
    });
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      contentType: ct,
      html: text,
      isHtml: /text\/html|application\/xhtml/i.test(ct) || /<!doctype html|<html[\s>]/i.test(text.slice(0, 400))
    };
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'fetch_timeout' : (e && e.message ? e.message : 'fetch_failed');
    return { ok: false, status: 0, contentType: '', html: '', isHtml: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeDuplicateTitles(rows) {
  const map = new Map();
  for (const row of rows) {
    const t = String(row.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t || t.length < 3) continue;
    map.set(t, (map.get(t) || 0) + 1);
  }
  let duplicateTitleCount = 0;
  const groups = [];
  for (const [title, n] of map.entries()) {
    if (n > 1) {
      duplicateTitleCount += n - 1;
      groups.push({ title, pages: n });
    }
  }
  groups.sort((a, b) => b.pages - a.pages);
  return { duplicateTitleCount, duplicateTitleGroups: groups.slice(0, 6) };
}

/**
 * @param {object} opts
 * @param {string} opts.seedUrl Final URL after redirects (must be http(s))
 * @param {string | null} [opts.initialHtml] HTML of seed page (avoids duplicate fetch)
 * @param {string} [opts.userAgent]
 * @returns {Promise<object>}
 */
async function runLimitedSiteCrawl(opts = {}) {
  const cfg = crawlConfigFromEnv();
  const started = Date.now();
  const userAgent = opts.userAgent || 'GeoNeo-AuditBot/1.0 (+https://geoneo.ai)';

  if (!cfg.enabled) {
    return {
      status: 'disabled',
      reason: 'GEONEO_SITE_CRAWL_ENABLED=false',
      pagesFetched: 0,
      pages: [],
      duplicateTitleCount: 0,
      duplicateTitleGroups: [],
      aggregateWordCount: 0,
      stoppedReason: 'disabled',
      durationMs: Date.now() - started
    };
  }

  const seedUrl = normalizeCrawlUrl(opts.seedUrl || '');
  if (!seedUrl || !/^https?:/i.test(seedUrl)) {
    return {
      status: 'failed',
      error: 'invalid_seed_url',
      pagesFetched: 0,
      pages: [],
      duplicateTitleCount: 0,
      duplicateTitleGroups: [],
      aggregateWordCount: 0,
      stoppedReason: 'invalid_seed',
      durationMs: Date.now() - started
    };
  }

  let origin;
  try {
    origin = new URL(seedUrl).origin;
  } catch {
    return {
      status: 'failed',
      error: 'invalid_seed_url',
      pagesFetched: 0,
      pages: [],
      duplicateTitleCount: 0,
      duplicateTitleGroups: [],
      aggregateWordCount: 0,
      stoppedReason: 'invalid_seed',
      durationMs: Date.now() - started
    };
  }

  const maxPages = Math.min(cfg.maxPages, 100);
  const maxDepth = Math.min(cfg.maxDepth, 6);
  const initialHtml = typeof opts.initialHtml === 'string' ? opts.initialHtml : null;

  const disallows = await fetchRobotsDisallows(origin, userAgent, cfg.perFetchMs);

  const seen = new Set();
  const enqueued = new Set([seedUrl]);
  /** @type {{ url: string, depth: number }[]} */
  const queue = [{ url: seedUrl, depth: 0 }];
  /** @type {object[]} */
  const pages = [];

  while (queue.length && pages.length < maxPages) {
    if (Date.now() - started > cfg.totalBudgetMs) {
      break;
    }

    const item = queue.shift();
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);

    let pathname = '/';
    try {
      pathname = new URL(item.url).pathname || '/';
    } catch {
      continue;
    }
    if (isDisallowedByRobots(pathname, disallows)) {
      pages.push({
        url: item.url,
        depth: item.depth,
        skipped: true,
        reason: 'robots_disallow',
        status: 0,
        wordCount: 0,
        title: ''
      });
      continue;
    }

    let html = '';
    let status = 0;
    let fetchError = '';

    if (item.depth === 0 && initialHtml !== null) {
      html = initialHtml;
      status = 200;
    } else {
      if (Date.now() - started > cfg.totalBudgetMs) break;
      const fetched = await fetchHtmlPage(item.url, userAgent, cfg.perFetchMs);
      status = fetched.status;
      if (!fetched.ok || !fetched.isHtml) {
        pages.push({
          url: item.url,
          depth: item.depth,
          status,
          error: fetched.error || (!fetched.isHtml ? 'non_html' : 'http_error'),
          wordCount: 0,
          title: ''
        });
        continue;
      }
      html = fetched.html;
    }

    const title = extractTitle(html);
    const plain = htmlToPlainText(html);
    const wordCount = countWords(plain);

    pages.push({
      url: item.url,
      depth: item.depth,
      status,
      wordCount,
      title,
      titleLength: title.length
    });

    if (item.depth >= maxDepth) {
      continue;
    }

    const children = extractSameOriginLinks(html, item.url, origin);
    for (const child of children) {
      if (enqueued.has(child)) continue;
      if (seen.has(child)) continue;
      if (queue.length + pages.length >= maxPages * 3) break;
      try {
        const childPath = new URL(child).pathname || '/';
        if (isDisallowedByRobots(childPath, disallows)) continue;
      } catch {
        continue;
      }
      enqueued.add(child);
      queue.push({ url: child, depth: item.depth + 1 });
    }
  }

  const contentPages = pages.filter((p) => !p.skipped && !p.error && p.status === 200);
  const aggregateWordCount = contentPages.reduce((s, p) => s + (Number(p.wordCount) || 0), 0);
  const { duplicateTitleCount, duplicateTitleGroups } = summarizeDuplicateTitles(contentPages);

  let stoppedReason = 'complete';
  if (Date.now() - started > cfg.totalBudgetMs) stoppedReason = 'time_budget';
  else if (pages.length >= maxPages) stoppedReason = 'page_budget';

  const status =
    pages.length === 0
      ? 'failed'
      : (stoppedReason === 'complete' && contentPages.length >= 1 ? 'ok' : 'partial');

  return {
    status,
    seedUrl,
    origin,
    maxDepth,
    maxPages,
    pagesFetched: pages.length,
    contentPagesSampled: contentPages.length,
    pages: pages.slice(0, 80),
    aggregateWordCount,
    averageWordsPerPage:
      contentPages.length > 0 ? Math.round(aggregateWordCount / contentPages.length) : null,
    duplicateTitleCount,
    duplicateTitleGroups,
    stoppedReason,
    durationMs: Date.now() - started,
    robotsDisallowRules: disallows.length
  };
}

module.exports = {
  crawlConfigFromEnv,
  normalizeCrawlUrl,
  parseRobotsDisallows,
  isDisallowedByRobots,
  extractSameOriginLinks,
  runLimitedSiteCrawl
};
