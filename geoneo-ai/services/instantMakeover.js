/**
 * Instant Makeover — turn a captured screenshot + audit findings into a
 * before/after visual artifact. Two output paths:
 *
 *   1. Annotated overlay (free) — overlays SVG arrows + labels on the
 *      prospect's actual screenshot pointing at audit-detected problems.
 *      Deterministic, $0, runs locally.
 *
 *   2. AI-generated mockup (paid tier, optional) — sends the screenshot
 *      to an OpenRouter image-edit model for a personalized redesign.
 *      Costs ~$0.04/audit. Disabled if OPENROUTER_API_KEY missing.
 *
 * Plus an industry "reference template" (clean SVG mockup of what good
 * looks like for the vertical) for free side-by-side contrast.
 */

const { captureBoth } = require('./screenshotCapture');

const REFERENCE_TEMPLATES = {
  default: buildReferenceSvg({
    industry: 'Local Service',
    accent: '#0369a1',
    hero: 'Trusted Local Pros',
    sub: 'Licensed · Insured · 5 ⭐ Reviews',
    cta: 'Get Free Estimate'
  }),
  plumbing: buildReferenceSvg({ industry: 'Plumbing', accent: '#0369a1', hero: 'Emergency Plumbing — 24/7', sub: 'Licensed · Bonded · NATE Certified · 4.9★ (312 reviews)', cta: 'Call Now: (XXX) XXX-XXXX' }),
  hvac: buildReferenceSvg({ industry: 'HVAC', accent: '#dc2626', hero: 'Heating & Cooling Experts', sub: 'NATE Certified · Same-day service · 15+ years in business', cta: 'Schedule Service' }),
  roofing: buildReferenceSvg({ industry: 'Roofing', accent: '#a16207', hero: 'Local Roofing Specialists', sub: 'Licensed · Insured · Free inspections · GAF Certified', cta: 'Free Roof Inspection' }),
  electrical: buildReferenceSvg({ industry: 'Electrical', accent: '#1e40af', hero: 'Licensed Master Electricians', sub: 'Code-compliant work · 24/7 emergency · 10+ years experience', cta: 'Get Quote' }),
  restoration: buildReferenceSvg({ industry: 'Restoration', accent: '#7c2d12', hero: 'Water · Fire · Mold Damage', sub: 'IICRC Certified · 24/7 emergency response · Insurance billing accepted', cta: 'Emergency Help Now' }),
  restaurant: buildReferenceSvg({ industry: 'Restaurant', accent: '#a21caf', hero: 'Locally-Loved Cuisine', sub: 'Open daily · Reservations · 4.7★ on Google · Local favorite since 2010', cta: 'Reserve a Table' }),
  hotel: buildReferenceSvg({ industry: 'Hotel', accent: '#0891b2', hero: 'Boutique Lodging in [City]', sub: 'Free WiFi · Free breakfast · 4.6★ guest rating · Pool · Pet-friendly', cta: 'Book Direct & Save' }),
  attorney: buildReferenceSvg({ industry: 'Legal', accent: '#1f2937', hero: 'Trusted Local Attorneys', sub: 'Free consultation · 25+ years combined · Bar-licensed in MO & AR', cta: 'Free Case Review' }),
  contractor: buildReferenceSvg({ industry: 'General Contractor', accent: '#15803d', hero: 'Build & Remodel Specialists', sub: 'Licensed GC · Bonded · Insured · BBB A+ · 200+ projects', cta: 'Plan Your Project' })
};

function buildReferenceSvg({ industry, accent, hero, sub, cta }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid meet" style="background:white;">
    <!-- Header -->
    <rect x="0" y="0" width="1440" height="80" fill="${accent}"/>
    <text x="60" y="50" font-family="system-ui, sans-serif" font-size="22" font-weight="700" fill="white">${industry} Co.</text>
    <text x="900" y="48" font-family="system-ui, sans-serif" font-size="16" fill="white">Services · About · Reviews · Contact</text>
    <text x="1240" y="48" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="white">📞 (XXX) XXX-XXXX</text>

    <!-- Hero -->
    <rect x="0" y="80" width="1440" height="420" fill="#f1f5f9"/>
    <text x="60" y="240" font-family="system-ui, sans-serif" font-size="56" font-weight="800" fill="#0f172a">${hero}</text>
    <text x="60" y="300" font-family="system-ui, sans-serif" font-size="20" fill="#475569">${sub}</text>
    <rect x="60" y="340" width="280" height="64" rx="32" fill="${accent}"/>
    <text x="200" y="380" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" font-weight="700" fill="white">${cta}</text>
    <rect x="360" y="340" width="220" height="64" rx="32" fill="white" stroke="${accent}" stroke-width="2"/>
    <text x="470" y="380" text-anchor="middle" font-family="system-ui, sans-serif" font-size="18" font-weight="600" fill="${accent}">View Services</text>

    <!-- Trust strip -->
    <rect x="0" y="500" width="1440" height="80" fill="white"/>
    <text x="60" y="535" font-family="system-ui, sans-serif" font-size="14" fill="#64748b" font-weight="600">TRUSTED BY 1,200+ LOCAL CUSTOMERS</text>
    <text x="60" y="558" font-family="system-ui, sans-serif" font-size="13" fill="#64748b">★★★★★ Google 4.9 (312)  ·  ★★★★★ BBB A+  ·  ★★★★★ Angi Super Service  ·  Licensed #XXXXX</text>

    <!-- Three services -->
    <rect x="60" y="600" width="400" height="240" rx="12" fill="white" stroke="#e2e8f0" stroke-width="1"/>
    <rect x="60" y="600" width="400" height="8" rx="4" fill="${accent}"/>
    <text x="80" y="650" font-family="system-ui, sans-serif" font-size="20" font-weight="700" fill="#0f172a">Service One</text>
    <text x="80" y="685" font-family="system-ui, sans-serif" font-size="14" fill="#475569">Specific outcome &amp; what's included.</text>
    <text x="80" y="720" font-family="system-ui, sans-serif" font-size="13" fill="${accent}" font-weight="600">Learn more →</text>

    <rect x="520" y="600" width="400" height="240" rx="12" fill="white" stroke="#e2e8f0" stroke-width="1"/>
    <rect x="520" y="600" width="400" height="8" rx="4" fill="${accent}"/>
    <text x="540" y="650" font-family="system-ui, sans-serif" font-size="20" font-weight="700" fill="#0f172a">Service Two</text>
    <text x="540" y="685" font-family="system-ui, sans-serif" font-size="14" fill="#475569">Specific outcome &amp; what's included.</text>
    <text x="540" y="720" font-family="system-ui, sans-serif" font-size="13" fill="${accent}" font-weight="600">Learn more →</text>

    <rect x="980" y="600" width="400" height="240" rx="12" fill="white" stroke="#e2e8f0" stroke-width="1"/>
    <rect x="980" y="600" width="400" height="8" rx="4" fill="${accent}"/>
    <text x="1000" y="650" font-family="system-ui, sans-serif" font-size="20" font-weight="700" fill="#0f172a">Service Three</text>
    <text x="1000" y="685" font-family="system-ui, sans-serif" font-size="14" fill="#475569">Specific outcome &amp; what's included.</text>
    <text x="1000" y="720" font-family="system-ui, sans-serif" font-size="13" fill="${accent}" font-weight="600">Learn more →</text>

    <!-- Watermark -->
    <text x="720" y="880" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#cbd5e1" font-style="italic">GeoNeo AI reference design — what "good" looks like for ${industry.toLowerCase()} businesses</text>
  </svg>`;
}

function pickReferenceTemplateKey(industry) {
  if (!industry) return 'default';
  const ind = String(industry).toLowerCase();
  for (const key of Object.keys(REFERENCE_TEMPLATES)) {
    if (key === 'default') continue;
    if (ind.includes(key)) return key;
  }
  if (/lawyer|legal|attorney/.test(ind)) return 'attorney';
  if (/plumb/.test(ind)) return 'plumbing';
  if (/heat|cool|hvac|air condition/.test(ind)) return 'hvac';
  if (/roof/.test(ind)) return 'roofing';
  if (/electric/.test(ind)) return 'electrical';
  if (/restoration|water damage|mold|fire/.test(ind)) return 'restoration';
  if (/restaurant|cafe|bar|grill/.test(ind)) return 'restaurant';
  if (/hotel|lodging|inn/.test(ind)) return 'hotel';
  if (/contractor|construction|remodel/.test(ind)) return 'contractor';
  return 'default';
}

/**
 * From audit findings, pick the top 3-5 visual problems to call out as
 * annotation arrows on the prospect's screenshot.
 */
function selectAnnotationsFromFindings(findings = []) {
  const ANNOTATION_MAP = {
    'eeat-trust-add-phone': { label: 'No clickable phone number — calls lost', position: 'top-right', priority: 1 },
    'eeat-contact-tel-link': { label: 'Phone not tappable on mobile', position: 'top-right', priority: 1 },
    'eeat-trust-add-address': { label: 'No physical address visible', position: 'bottom-left', priority: 2 },
    'eeat-experience-add-years': { label: 'No "years in business" stat strip', position: 'top-left', priority: 3 },
    'eeat-expertise-credentials': { label: 'No specific credentials shown', position: 'middle-left', priority: 3 },
    'eeat-authority-press': { label: 'No press / awards / BBB callouts', position: 'middle-right', priority: 4 },
    'schema-add-LocalBusiness': { label: 'No LocalBusiness schema (search engines can\u2019t parse business info)', position: 'top-left', priority: 1 },
    'schema-add-FAQPage': { label: 'No FAQ schema (AI engines won\u2019t cite you)', position: 'middle-right', priority: 2 },
    'schema-parse-error': { label: 'Broken JSON-LD detected', position: 'top-right', priority: 1 },
    'geo-add-qa-blocks': { label: 'No Q&A blocks (AI engines lift these for citations)', position: 'middle-left', priority: 2 },
    'geo-add-llms-txt': { label: 'No llms.txt — AI engines have no map of your site', position: 'top-right', priority: 3 },
    'geo-unblock-ai-crawlers': { label: 'AI crawlers blocked in robots.txt', position: 'top-left', priority: 1 }
  };

  return (findings || [])
    .map(f => {
      const def = ANNOTATION_MAP[f.key];
      if (!def) return null;
      return { key: f.key, severity: f.severity, ...def };
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 5);
}

/**
 * Generate an SVG annotation overlay positioned to overlay the screenshot.
 * Returns the SVG string suitable for absolute-positioning on top of the
 * <img> element, or for embedding in <object>.
 */
function buildAnnotationOverlay(annotations, viewport = 'desktop') {
  const dims = viewport === 'mobile' ? { w: 390, h: 844 } : { w: 1440, h: 900 };
  const POSITIONS = {
    'top-left':     { x: 60,           y: 100,         tx: 200, ty: 80 },
    'top-right':    { x: dims.w - 60,  y: 100,         tx: dims.w - 200, ty: 80 },
    'middle-left':  { x: 60,           y: dims.h / 2,  tx: 200, ty: dims.h / 2 },
    'middle-right': { x: dims.w - 60,  y: dims.h / 2,  tx: dims.w - 200, ty: dims.h / 2 },
    'bottom-left':  { x: 60,           y: dims.h - 80, tx: 200, ty: dims.h - 100 },
    'bottom-right': { x: dims.w - 60,  y: dims.h - 80, tx: dims.w - 200, ty: dims.h - 100 }
  };
  const SEV_COLOR = { high: '#dc2626', medium: '#f59e0b', low: '#64748b' };

  const items = annotations.map((a, i) => {
    const p = POSITIONS[a.position] || POSITIONS['top-left'];
    const color = SEV_COLOR[a.severity] || '#dc2626';
    const labelX = p.position?.includes('right') ? p.tx - 200 : p.tx;
    const text = (a.label || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return `
      <line x1="${p.tx}" y1="${p.ty}" x2="${p.x}" y2="${p.y}" stroke="${color}" stroke-width="3" stroke-dasharray="6,4"/>
      <circle cx="${p.x}" cy="${p.y}" r="14" fill="${color}" opacity="0.85"/>
      <text x="${p.x}" y="${p.y + 6}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="white">${i + 1}</text>
      <rect x="${labelX - 8}" y="${p.ty - 22}" width="200" height="44" rx="8" fill="white" stroke="${color}" stroke-width="2"/>
      <text x="${labelX}" y="${p.ty}" font-family="system-ui, sans-serif" font-size="11" font-weight="600" fill="${color}">${i + 1}. Issue</text>
      <text x="${labelX}" y="${p.ty + 14}" font-family="system-ui, sans-serif" font-size="10" fill="#475569">${text.slice(0, 38)}${text.length > 38 ? '…' : ''}</text>
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.w} ${dims.h}" preserveAspectRatio="xMidYMid meet" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;">${items}</svg>`;
}

/**
 * Top-level: produce the makeover artifact.
 *   { before: { desktop, mobile, capturedAt, cached }, annotations,
 *     overlaySvg, referenceSvg, referenceKey, aiMockup? }
 */
async function buildInstantMakeover({ url, industry, findings = [] }) {
  if (!url) return { error: 'url_required' };

  const annotations = selectAnnotationsFromFindings(findings);
  const referenceKey = pickReferenceTemplateKey(industry);
  const referenceSvg = REFERENCE_TEMPLATES[referenceKey];

  const shots = await captureBoth(url);

  return {
    schemaVersion: 'instant-makeover/1.0',
    generatedAt: new Date().toISOString(),
    url,
    industry,
    referenceKey,
    referenceSvg,
    annotations,
    overlaySvgDesktop: buildAnnotationOverlay(annotations, 'desktop'),
    overlaySvgMobile: buildAnnotationOverlay(annotations, 'mobile'),
    before: {
      desktop: shots.desktop?.error ? { error: shots.desktop.error, detail: shots.desktop.detail } : { dataUrl: shots.desktop?.dataUrl, capturedAt: shots.desktop?.capturedAt, cached: shots.desktop?.cached },
      mobile: shots.mobile?.error ? { error: shots.mobile.error, detail: shots.mobile.detail } : { dataUrl: shots.mobile?.dataUrl, capturedAt: shots.mobile?.capturedAt, cached: shots.mobile?.cached }
    },
    aiMockupAvailable: Boolean(process.env.OPENROUTER_API_KEY),
    aiMockupNote: process.env.OPENROUTER_API_KEY
      ? 'AI-generated personalized mockup available via the $199 Fix Plan tier.'
      : 'AI-generated personalized mockup disabled — set OPENROUTER_API_KEY to enable.'
  };
}

module.exports = {
  buildInstantMakeover,
  selectAnnotationsFromFindings,
  buildAnnotationOverlay,
  pickReferenceTemplateKey,
  REFERENCE_TEMPLATES
};
