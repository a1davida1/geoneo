/**
 * Rendered HTML fetcher. For JS-rendered SPAs (Wix, Squarespace, Webflow,
 * React/Angular/Vue apps) the server-side HTML is a near-empty shell. The
 * audit pipeline reads HTML and analyzes it — so on these sites we'd flag
 * everything as "missing" when actually it's all there post-render.
 *
 * Strategy:
 *   1. Fetch raw HTML cheap (curl/fetch).
 *   2. Run a `looksLikeJsSpa()` heuristic — text/script ratio, framework
 *      markers (wix-logo, __NEXT_DATA__, ng-version, data-react, etc).
 *   3. If SPA-detected, render with Puppeteer (system Chrome, headless)
 *      and return the post-render `document.documentElement.outerHTML`.
 *   4. Otherwise return the raw HTML — no overhead.
 *
 * Caches rendered DOM for 24h per URL since rendering is slow (~3-5s).
 *
 * Falls back to raw HTML gracefully if Chrome isn't available, render
 * fails, or it times out.
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('./logger').forModule('renderedHtmlFetch');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'rendered-html-cache');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS) || 25000;
const RENDER_SETTLE_MS = Number(process.env.RENDER_SETTLE_MS) || 2500;

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

let _chromePath = null;
function findChrome() {
  if (_chromePath !== null) return _chromePath;
  for (const c of CHROME_CANDIDATES) {
    try { fsSync.accessSync(c); _chromePath = c; return c; } catch {}
  }
  _chromePath = '';
  return '';
}

/**
 * Heuristic: is this raw HTML a JS-rendered SPA shell?
 *
 * Signals (any 2+ = likely SPA):
 *   - text-to-script ratio < 0.05 (very script-heavy, very text-light)
 *   - text content < 500 chars after stripping tags/scripts/styles
 *   - framework markers present (Wix, Squarespace, Webflow, Next.js,
 *     React, Angular, Vue, GoDaddy, Hostinger Builder)
 *   - <noscript> tag with "enable javascript" message
 *   - viewport with width=1024 (Wix's signature)
 */
function looksLikeJsSpa(html) {
  if (!html || html.length < 200) return { spa: false, signals: [] };
  const signals = [];

  // 1. text/script ratio
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const scriptBytes = (html.match(/<script[\s\S]*?<\/script>/gi) || []).reduce((s, x) => s + x.length, 0);
  const ratio = text.length / Math.max(1, scriptBytes);
  if (ratio < 0.08) signals.push(`low_text_to_script_ratio (${ratio.toFixed(3)})`);
  if (text.length < 500) signals.push(`tiny_text_body (${text.length} chars)`);

  // 2. framework markers
  const markers = [
    { name: 'wix', re: /wix\.com|wixstatic\.com|wzsitethumbnails|x-wix-/i },
    { name: 'squarespace', re: /squarespace|sqsp\.cdn|static1\.squarespace/i },
    { name: 'webflow', re: /webflow|wf-page|data-wf-page/i },
    { name: 'next_js', re: /__NEXT_DATA__|_next\/static/i },
    { name: 'react', re: /data-reactroot|react-root|__react/i },
    { name: 'angular', re: /ng-version|ng-app|data-ng-/i },
    { name: 'vue', re: /v-cloak|data-v-[a-f0-9]{8}|vue-app/i },
    { name: 'godaddy_builder', re: /websites-builder|godaddy.*websites/i },
    { name: 'hostinger', re: /hostinger.*builder|builder\.hostinger/i },
    { name: 'shopify_app', re: /shopify-app|cdn\.shopify\.com\/app/i }
  ];
  for (const m of markers) {
    if (m.re.test(html)) signals.push(`framework:${m.name}`);
  }

  // 3. enable-javascript noscript
  if (/<noscript>[\s\S]{0,500}(?:enable javascript|javascript is required|requires javascript)/i.test(html)) {
    signals.push('noscript_enable_js');
  }

  // 4. wix signature: viewport width=1024
  if (/<meta[^>]+name=["']viewport["'][^>]+content=["'][^"']*width=1024/i.test(html)) {
    signals.push('wix_viewport_signature');
  }

  // Decision: 2+ signals = SPA
  return { spa: signals.length >= 2, signals, textLength: text.length, scriptBytes };
}

function urlToCacheKey(url) {
  return crypto.createHash('sha256').update(String(url || '')).digest('hex').slice(0, 32);
}

async function readCache(url) {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, urlToCacheKey(url) + '.html'), 'utf8');
    const meta = await fs.stat(path.join(CACHE_DIR, urlToCacheKey(url) + '.html'));
    if ((Date.now() - meta.mtimeMs) < CACHE_TTL_MS) return raw;
  } catch {}
  return null;
}

async function writeCache(url, html) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, urlToCacheKey(url) + '.html');
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, html, 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    log.warn('cache write failed', { url, error: err.message });
  }
}

/**
 * Render the URL with headless Chrome and return the post-render
 * outerHTML. Bounded by RENDER_TIMEOUT_MS. Returns null on failure.
 */
async function renderWithChrome(url) {
  const chromePath = findChrome();
  if (!chromePath) { log.warn('no_chrome_path'); return null; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch { log.warn('puppeteer-core not installed'); return null; }
  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions']
    });
    const page = await browser.newPage();
    // Use a real browser UA so Wix/Squarespace don't serve a placeholder.
    // Bot UAs trigger noscript fallbacks that defeat the whole point of rendering.
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });
    // domcontentloaded fires once the parser finishes — much faster + more
    // reliable than networkidle0 (which Wix sites with constant analytics
    // pings never reach). We then wait RENDER_SETTLE_MS for client mount.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });
    await new Promise((r) => setTimeout(r, RENDER_SETTLE_MS));
    const html = await page.content();
    return html;
  } catch (err) {
    log.warn('render failed', { url, error: err.message });
    return null;
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
  }
}

/**
 * Top-level: fetch + render-if-needed. Returns:
 *   { html, source: 'raw' | 'rendered' | 'cached', spaInfo }
 *
 * `forceRender: true` skips the SPA detection and always renders.
 */
async function fetchPossiblyRendered(url, rawHtml, { forceRender = false } = {}) {
  if (!url || !rawHtml) {
    return { html: rawHtml || '', source: 'raw', spaInfo: { spa: false, signals: [] } };
  }
  const spaInfo = looksLikeJsSpa(rawHtml);
  if (!forceRender && !spaInfo.spa) {
    return { html: rawHtml, source: 'raw', spaInfo };
  }
  // Cache check
  const cached = await readCache(url);
  if (cached) {
    log.debug('cache hit', { url });
    return { html: cached, source: 'cached', spaInfo };
  }
  log.info('rendering SPA', { url, signals: spaInfo.signals });
  const rendered = await renderWithChrome(url);
  if (!rendered) {
    return { html: rawHtml, source: 'raw_render_failed', spaInfo };
  }
  await writeCache(url, rendered);
  return { html: rendered, source: 'rendered', spaInfo };
}

module.exports = {
  fetchPossiblyRendered,
  looksLikeJsSpa,
  renderWithChrome,
  findChrome
};
