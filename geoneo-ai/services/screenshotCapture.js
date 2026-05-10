/**
 * Screenshot Capture — uses puppeteer-core + system Chromium/Chrome.
 * No Chromium download. Falls back gracefully if no browser available.
 *
 * Captures both desktop (1440×900) and mobile (390×844) viewports.
 * Caches per URL for 24h to avoid re-capturing on every audit view.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'screenshots');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

let cachedBrowserPath = null;
let cachedPuppeteer = null;

async function findChromePath() {
  if (cachedBrowserPath !== null) return cachedBrowserPath;
  if (process.env.CHROME_PATH) {
    try { await fs.access(process.env.CHROME_PATH); cachedBrowserPath = process.env.CHROME_PATH; return cachedBrowserPath; } catch {}
  }
  for (const candidate of CHROME_CANDIDATES) {
    try { await fs.access(candidate); cachedBrowserPath = candidate; return cachedBrowserPath; } catch {}
  }
  cachedBrowserPath = false;
  return false;
}

function loadPuppeteer() {
  if (cachedPuppeteer) return cachedPuppeteer;
  try {
    cachedPuppeteer = require('puppeteer-core');
    return cachedPuppeteer;
  } catch {
    return null;
  }
}

function urlHash(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

async function readCache(url, viewport) {
  const file = path.join(CACHE_DIR, `${urlHash(url)}_${viewport}.png`);
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const buf = await fs.readFile(file);
    return { buffer: buf, cachedAt: stat.mtimeMs, file };
  } catch {
    return null;
  }
}

async function writeCache(url, viewport, buffer) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${urlHash(url)}_${viewport}.png`);
  await fs.writeFile(file, buffer);
  return file;
}

/**
 * Capture a screenshot at the requested viewport.
 * Returns { buffer, dataUrl, viewport, capturedAt, cached, file } or null on failure.
 */
async function captureScreenshot(url, viewport = 'desktop') {
  if (!url) return null;

  const cacheHit = await readCache(url, viewport);
  if (cacheHit) {
    return {
      buffer: cacheHit.buffer,
      dataUrl: 'data:image/png;base64,' + cacheHit.buffer.toString('base64'),
      viewport,
      capturedAt: cacheHit.cachedAt,
      cached: true,
      file: cacheHit.file
    };
  }

  const chromePath = await findChromePath();
  const puppeteer = loadPuppeteer();
  if (!chromePath || !puppeteer) {
    return {
      error: 'no_chrome',
      detail: chromePath ? 'puppeteer-core not installed' : 'No Chrome/Chromium found on system. Set CHROME_PATH env var.',
      viewport
    };
  }

  const dimensions = viewport === 'mobile'
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }
    : { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false };

  let browser = null;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setViewport(dimensions);
    await page.setUserAgent('Mozilla/5.0 (compatible; GeoNeoBot/1.0; +https://geoneo.ai/bot)');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
    // Wait a bit for late-loading content
    await new Promise(r => setTimeout(r, 800));
    const buffer = await page.screenshot({ type: 'png', fullPage: false, captureBeyondViewport: false });
    const file = await writeCache(url, viewport, buffer);
    return {
      buffer,
      dataUrl: 'data:image/png;base64,' + buffer.toString('base64'),
      viewport,
      capturedAt: Date.now(),
      cached: false,
      file
    };
  } catch (err) {
    return { error: 'capture_failed', detail: err.message || String(err), viewport };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function captureBoth(url) {
  const [desktop, mobile] = await Promise.all([
    captureScreenshot(url, 'desktop'),
    captureScreenshot(url, 'mobile')
  ]);
  return { desktop, mobile };
}

module.exports = {
  captureScreenshot,
  captureBoth,
  findChromePath,
  CACHE_DIR
};
