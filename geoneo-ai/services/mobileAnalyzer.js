/**
 * Mobile usability analyzer. PageSpeed gives mobile performance scores;
 * this checks structural mobile-friendliness (viewport, tap targets, font
 * sizes, horizontal-scroll triggers, responsive CSS).
 *
 * Reads:
 *   - HTML inline + <style> block CSS via regex
 *   - First 2 external stylesheets (best-effort fetch, 5s timeout, 200KB cap)
 *
 * That's enough to find the structural problems. Layout-rendering issues
 * (actual on-screen overflow) need a real headless browser — out of scope
 * for the structural pass; PageSpeed mobile score covers that.
 */

const { standardize } = require('./analyzerShape');

const CSS_FETCH_TIMEOUT_MS = 5000;
const MAX_CSS_BYTES = 200 * 1024; // 200KB per stylesheet
const MAX_STYLESHEETS = 2;

async function fetchCss(url, signal) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), CSS_FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: signal || ac.signal, redirect: 'follow' });
    clearTimeout(t);
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return await res.text();
    let received = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_CSS_BYTES) {
        try { reader.cancel(); } catch {}
        chunks.push(value);
        break;
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks);
    return buf.toString('utf8').slice(0, MAX_CSS_BYTES);
  } catch {
    return null;
  }
}

function extractStylesheetUrls(html, baseUrl) {
  const urls = [];
  const re = /<link[^>]+rel=["']stylesheet["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = (m[0].match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    try {
      const abs = baseUrl ? new URL(href, baseUrl).href : href;
      urls.push(abs);
    } catch { /* malformed href */ }
  }
  return urls.slice(0, MAX_STYLESHEETS);
}

async function analyzeMobile({ html = '', finalUrl = '' } = {}) {
  const findings = [];
  const warnings = [];
  let score = 100;
  if (!html) {
    return { score: 0, findings: [{ id: 'mobile-no-html', severity: 'critical', title: 'No HTML to analyze' }] };
  }

  // ---- Fetch external CSS so we see real styles, not just inline ----
  // The HTML alone misses external stylesheets (the modern norm).
  const stylesheetUrls = extractStylesheetUrls(html, finalUrl);
  const cssTexts = await Promise.all(stylesheetUrls.map((u) => fetchCss(u)));
  const allCss = [
    html, // inline + <style> blocks already in HTML
    ...cssTexts.filter(Boolean)
  ].join('\n');
  const externalCssBytes = cssTexts.filter(Boolean).reduce((sum, c) => sum + c.length, 0);

  // 1. Viewport meta tag
  const viewportMatch = html.match(/<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']+)["']/i);
  if (!viewportMatch) {
    findings.push({
      id: 'mobile-missing-viewport',
      severity: 'critical',
      title: 'Missing viewport meta tag',
      detail: 'Without <meta name="viewport" content="width=device-width, initial-scale=1">, mobile browsers render the desktop layout zoomed out. Visitors leave instantly. This is a 1-line fix in <head>.'
    });
    score -= 40;
  } else {
    const content = viewportMatch[1].toLowerCase();
    if (!content.includes('width=device-width')) {
      findings.push({
        id: 'mobile-viewport-bad-width',
        severity: 'major',
        title: 'Viewport meta missing width=device-width',
        detail: 'Update your viewport meta to include `width=device-width, initial-scale=1`. Without device-width, mobile browsers can\'t size the page correctly.'
      });
      score -= 18;
    }
    if (content.includes('user-scalable=no') || /maximum-scale\s*=\s*1\.?0?\b/.test(content)) {
      findings.push({
        id: 'mobile-zoom-disabled',
        severity: 'minor',
        title: 'Pinch-to-zoom disabled',
        detail: 'You\'ve disabled user zoom (user-scalable=no or maximum-scale=1). Bad for accessibility — visitors with low vision can\'t zoom in to read. Remove the restriction.'
      });
      score -= 6;
    }
  }

  // 2. Font sizes — scan the entire CSS corpus (inline + <style> + external)
  const fontSizeMatches = (allCss.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/gi) || [])
    .map((m) => Number(m.match(/([\d.]+)\s*px/i)[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  const tinyFontCount = fontSizeMatches.filter((n) => n < 12).length;
  if (tinyFontCount > 3) {
    findings.push({
      id: 'mobile-tiny-fonts',
      severity: 'minor',
      title: `${tinyFontCount} CSS rules use font-size < 12px`,
      detail: 'Text below 12px is hard to read on phones. Bump body text to 14-16px minimum. Apple\'s mobile Safari guidelines and Google\'s mobile-friendly test both flag this.'
    });
    score -= 8;
  }

  // 3. Fixed-width elements — wider than 480px = horizontal scroll on phones
  const widthMatches = (allCss.match(/(?:^|[^a-z\-])width\s*:\s*(\d+)\s*px/gi) || [])
    .map((m) => Number(m.match(/(\d+)\s*px/i)[1]))
    .filter((n) => Number.isFinite(n) && n > 480);
  if (widthMatches.length > 5) {
    // Filter: only flag fixed `width:` (not max-width, min-width). Min-width
    // > 480 IS a real overflow trigger though, so check separately.
    findings.push({
      id: 'mobile-fixed-width-overflow',
      severity: 'major',
      title: `${widthMatches.length} CSS rules use fixed width > 480px`,
      detail: `Sample widths: ${widthMatches.slice(0, 3).join('px, ')}px. Fixed widths create horizontal scroll on phones. Use max-width with percentages instead.`
    });
    score -= Math.min(20, Math.floor(widthMatches.length / 5) * 4);
  }
  const minWidthMatches = (allCss.match(/min-width\s*:\s*(\d+)\s*px/gi) || [])
    .map((m) => Number(m.match(/(\d+)\s*px/i)[1]))
    .filter((n) => Number.isFinite(n) && n > 480);
  if (minWidthMatches.length > 3) {
    findings.push({
      id: 'mobile-min-width-overflow',
      severity: 'major',
      title: `${minWidthMatches.length} CSS rules use min-width > 480px`,
      detail: `min-width forces horizontal scroll on phones below that width. Wrap inside a media query so it only applies on desktop.`
    });
    score -= Math.min(15, Math.floor(minWidthMatches.length / 3) * 4);
  }

  // 4. Responsive design — @media queries indicate intentional mobile work
  const mediaQueries = (allCss.match(/@media[^{]*\(/gi) || []).length;
  if (mediaQueries === 0 && externalCssBytes > 5000) {
    findings.push({
      id: 'mobile-no-media-queries',
      severity: 'major',
      title: 'No @media queries found in fetched CSS',
      detail: 'Without @media queries, your site uses one layout for all devices. Modern responsive design requires breakpoints (typically 768px tablet, 480px phone). Switch to a responsive theme or framework.'
    });
    score -= 12;
  }

  // 5. Mobile-hostile elements
  if (/<embed[^>]+(flash|swf)/i.test(html) || /<object[^>]+(flash|swf)/i.test(html)) {
    findings.push({
      id: 'mobile-flash-content',
      severity: 'critical',
      title: 'Flash content detected',
      detail: 'Flash hasn\'t worked on iOS since 2010 and was removed entirely from browsers in 2020. Replace with HTML5 video or remove.'
    });
    score -= 30;
  }

  // 6. Click-to-call / mailto on mobile (positive signal)
  const hasTelLink = /<a[^>]+href=["']tel:/i.test(html);
  const hasMailtoLink = /<a[^>]+href=["']mailto:/i.test(html);
  if (!hasTelLink) {
    findings.push({
      id: 'mobile-no-tel-link',
      severity: 'minor',
      title: 'No click-to-call (tel:) link',
      detail: 'Add <a href="tel:+15555551234"> to your phone number. On mobile, this triggers the dialer with one tap — major conversion lift for service businesses.'
    });
    score -= 8;
  }

  // 7. Tap target sizes from CSS (buttons, links, .btn classes)
  // Look for padding declarations on button/.btn/.button selectors. Padding
  // < 8px = likely too small to tap reliably.
  const buttonStyleBlocks = allCss.match(/(?:button|\.btn[a-z\-]*|\.button[a-z\-]*|input\[type=["']?(?:button|submit)["']?\])[^{]{0,40}\{[^}]{0,400}\}/gi) || [];
  let undersized = 0;
  buttonStyleBlocks.forEach((block) => {
    const padMatches = block.match(/padding\s*:\s*([^;{}]+)/gi) || [];
    padMatches.forEach((p) => {
      const nums = p.match(/(\d+)\s*px/g) || [];
      if (nums.length > 0 && nums.every((n) => Number(n.match(/(\d+)/)[1]) < 8)) {
        undersized += 1;
      }
    });
  });
  if (undersized > 0) {
    findings.push({
      id: 'mobile-small-tap-targets',
      severity: 'minor',
      title: `${undersized} button/link rule(s) with padding < 8px`,
      detail: 'Buttons need ≥40×40px tap targets on mobile (Apple HIG + Google guideline). Bump padding to 12-16px minimum on touch elements.'
    });
    score -= Math.min(10, undersized * 3);
  }

  // 8. Responsive image hints (srcset / sizes)
  const imgCount = (html.match(/<img\b/gi) || []).length;
  const srcsetCount = (html.match(/<img[^>]+srcset=/gi) || []).length;
  const responsiveImageRatio = imgCount > 0 ? srcsetCount / imgCount : 1;
  if (imgCount >= 5 && responsiveImageRatio < 0.2) {
    findings.push({
      id: 'mobile-no-responsive-images',
      severity: 'minor',
      title: `${imgCount - srcsetCount} of ${imgCount} images lack srcset (responsive sizing)`,
      detail: 'Add srcset to deliver smaller images to phone-size screens. Major LCP + data-cost win. Modern frameworks generate srcset automatically.'
    });
    score -= 6;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    findings,
    warnings,
    metrics: {
      hasViewport: Boolean(viewportMatch),
      stylesheetsFetched: cssTexts.filter(Boolean).length,
      externalCssBytes,
      tinyFontCount,
      wideElementCount: widthMatches.length,
      minWidthOverflowCount: minWidthMatches.length,
      mediaQueryCount: mediaQueries,
      hasTelLink,
      hasMailtoLink,
      imgCount,
      srcsetCount,
      undersizedTapTargets: undersized
    }
  };
}

module.exports = {
  analyze: standardize('mobile', analyzeMobile),
  analyzeMobile
};
