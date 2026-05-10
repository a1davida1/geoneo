/**
 * Image Auditor — alt text quality, format, lazy loading, dimensions for
 * CLS prevention. Pure regex/HTML parsing, no fetching of image bytes.
 */

function extractImages(html = '') {
  const imgs = [];
  const re = /<img\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    imgs.push({
      raw: m[0],
      src: attrAt(attrs, 'src'),
      alt: attrAt(attrs, 'alt'),
      loading: attrAt(attrs, 'loading'),
      width: attrAt(attrs, 'width'),
      height: attrAt(attrs, 'height'),
      srcset: attrAt(attrs, 'srcset'),
      decoding: attrAt(attrs, 'decoding'),
      title: attrAt(attrs, 'title')
    });
  }
  return imgs;
}

function attrAt(attrs, name) {
  // Accept double-quoted, single-quoted, or unquoted attribute values
  const re = new RegExp(name + `\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = attrs.match(re);
  if (!m) return null;
  return m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : null));
}

function isModernFormat(src) {
  return /\.(webp|avif)(\?|$)/i.test(src || '');
}

function isLegacyFormat(src) {
  return /\.(jpe?g|png|gif|bmp)(\?|$)/i.test(src || '');
}

function altQuality(alt) {
  if (alt === null) return { hasAlt: false, decorative: false, quality: 'missing', reason: 'no alt attribute' };
  if (alt === '') return { hasAlt: true, decorative: true, quality: 'decorative', reason: 'explicit empty alt — decorative' };
  const len = alt.length;
  if (len < 5) return { hasAlt: true, decorative: false, quality: 'poor', reason: `too short (${len} chars)` };
  if (len > 125) return { hasAlt: true, decorative: false, quality: 'too-long', reason: `too long (${len} chars, max ~125)` };
  // Stuffing detection: too many keywords or "image of X" prefix
  if (/^(image|picture|photo|graphic)\s+of\s+/i.test(alt)) return { hasAlt: true, decorative: false, quality: 'stuffed', reason: 'starts with "image of" — redundant' };
  if (/[,]{2,}|;{2,}/.test(alt)) return { hasAlt: true, decorative: false, quality: 'stuffed', reason: 'comma-stuffed' };
  return { hasAlt: true, decorative: false, quality: 'good', reason: 'descriptive' };
}

function analyzeImages({ html }) {
  const imgs = extractImages(html || '');
  const total = imgs.length;
  if (total === 0) {
    return {
      overallScore: 70,
      status: 'warn',
      total: 0,
      note: 'No <img> tags detected on the page (could be background-image-only design).',
      fixes: []
    };
  }

  let altMissing = 0, altPoor = 0, altGood = 0, altDecorative = 0, altStuffed = 0;
  let modernFormat = 0, legacyFormat = 0;
  let hasLazyLoad = 0, missingDims = 0;

  imgs.forEach(img => {
    const aq = altQuality(img.alt);
    if (aq.quality === 'missing') altMissing++;
    else if (aq.quality === 'poor' || aq.quality === 'too-long') altPoor++;
    else if (aq.quality === 'stuffed') altStuffed++;
    else if (aq.quality === 'decorative') altDecorative++;
    else if (aq.quality === 'good') altGood++;

    if (isModernFormat(img.src)) modernFormat++;
    if (isLegacyFormat(img.src)) legacyFormat++;
    if ((img.loading || '').toLowerCase() === 'lazy') hasLazyLoad++;
    if (!img.width || !img.height) missingDims++;
  });

  let score = 100;
  const fixes = [];

  if (altMissing > 0) {
    score -= Math.min(40, (altMissing / total) * 60);
    fixes.push({
      key: 'images-missing-alt',
      severity: 'high',
      title: `${altMissing} of ${total} images have no alt attribute`,
      detail: 'Missing alt attributes hurt accessibility AND search engines can\u2019t understand the image. For decorative images use alt="" explicitly. For meaningful images, write a 5-12 word description.',
      effortMinutes: 15
    });
  }
  if (altPoor + altStuffed > 0) {
    score -= Math.min(15, ((altPoor + altStuffed) / total) * 25);
    fixes.push({
      key: 'images-poor-alt',
      severity: 'medium',
      title: `${altPoor + altStuffed} image${altPoor + altStuffed > 1 ? 's have' : ' has'} low-quality alt text`,
      detail: 'Alt text should describe what the image shows in 5-12 words. Avoid "image of", keyword-stuffing, or single-word descriptions.',
      effortMinutes: 10
    });
  }
  if (legacyFormat > 0 && modernFormat === 0) {
    score -= 10;
    fixes.push({
      key: 'images-no-modern-format',
      severity: 'medium',
      title: 'No modern image formats (WebP / AVIF) detected',
      detail: 'WebP files are 25-35% smaller than JPEG at the same quality. Use <picture> with WebP source + JPEG fallback, or convert using your CMS or a build step.',
      effortMinutes: 60
    });
  }
  if (missingDims > 0 && missingDims / total > 0.3) {
    score -= 12;
    fixes.push({
      key: 'images-missing-dims',
      severity: 'medium',
      title: `${missingDims} of ${total} images lack width/height attributes (CLS risk)`,
      detail: 'Without explicit dimensions, the browser doesn\u2019t reserve space for images, causing layout shift as they load. This is a Core Web Vitals (CLS) penalty.',
      effortMinutes: 20
    });
  }
  if (hasLazyLoad === 0 && total > 5) {
    score -= 8;
    fixes.push({
      key: 'images-no-lazy-load',
      severity: 'low',
      title: 'No images use loading="lazy"',
      detail: 'Below-the-fold images should use loading="lazy" so they only load when the user scrolls. Speeds up initial page load (LCP) and saves bandwidth.',
      effortMinutes: 10
    });
  }

  return {
    overallScore: Math.max(0, Math.min(100, Math.round(score))),
    status: score >= 75 ? 'pass' : score >= 50 ? 'warn' : 'fail',
    total,
    altQuality: { good: altGood, missing: altMissing, poor: altPoor, stuffed: altStuffed, decorative: altDecorative },
    formats: { modern: modernFormat, legacy: legacyFormat },
    lazyLoaded: hasLazyLoad,
    missingDimensions: missingDims,
    fixes
  };
}

module.exports = { analyzeImages, extractImages, altQuality, isModernFormat };
