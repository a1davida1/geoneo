/**
 * NAP Checker — Name / Address / Phone consistency analyzer.
 *
 * Phase 1 (this file): on-page NAP detection + internal consistency check.
 * Extracts NAP from JSON-LD schema, footer text, contact pages, and
 * compares for consistency. Flags missing pieces.
 *
 * Phase 2 (future): cross-platform fetch (Google Maps, Bing Places, Yelp,
 * Yellowpages, Apple Maps) and compare. Requires DataForSEO or similar
 * paid API for reliable scraping. Stub interface included.
 */

function extractNapFromHtml(html = '') {
  const found = { names: new Set(), addresses: new Set(), phones: new Set(), sources: [] };
  if (!html) return found;

  // From JSON-LD
  const jsonLdRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRe.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1].trim());
      walkSchema(obj, found, 'json-ld');
    } catch { /* ignore parse errors */ }
  }

  // Phone numbers in tel: links — normalize to E.164 like text path
  const telRe = /href=["']tel:([^"']+)["']/gi;
  while ((m = telRe.exec(html)) !== null) {
    const e164 = toE164UsPhone(m[1]);
    if (e164) { found.phones.add(e164); found.sources.push({ type: 'tel-link', value: e164 }); }
  }

  // Phone numbers in text (US format)
  const phoneTextRe = /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g;
  const textMatches = html.match(phoneTextRe) || [];
  textMatches.forEach(p => {
    const e164 = toE164UsPhone(p);
    if (e164) { found.phones.add(e164); }
  });

  // US street address pattern
  const addrRe = /(\d{1,6}\s+[A-Z][\w\s.]*(?:St|Ave|Rd|Blvd|Dr|Ln|Way|Court|Ct|Pl|Hwy|Highway|Street|Avenue|Road|Boulevard|Drive|Lane)\.?)\s*,?\s*([\w\s]+)?,?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/gi;
  while ((m = addrRe.exec(html)) !== null) {
    const norm = `${m[1].trim()}, ${(m[2] || '').trim()}, ${m[3]} ${m[4]}`.replace(/\s+/g, ' ').trim();
    found.addresses.add(norm);
    found.sources.push({ type: 'visible-text', value: norm });
  }

  return found;
}

function walkSchema(node, found, source) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach(n => walkSchema(n, found, source)); return; }
  if (typeof node !== 'object') return;
  if (node['@graph']) walkSchema(node['@graph'], found, source);
  if (node.name && typeof node.name === 'string') { found.names.add(node.name.trim()); found.sources.push({ type: source, field: 'name', value: node.name.trim() }); }
  if (node.telephone && typeof node.telephone === 'string') {
    const cleaned = node.telephone.replace(/[^\d+]/g, '');
    if (cleaned.length >= 7) { found.phones.add(cleaned); found.sources.push({ type: source, field: 'telephone', value: cleaned }); }
  }
  if (node.address && typeof node.address === 'object') {
    const a = node.address;
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(', ');
    if (parts) { found.addresses.add(parts); found.sources.push({ type: source, field: 'address', value: parts }); }
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') walkSchema(v, found, source);
  }
}

// Convert raw phone (tel: link, text, anything) to canonical E.164 US form.
// Returns null if not a recognizable US-shaped number.
function toE164UsPhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Already E.164
  if (/^\+\d{8,15}$/.test(s.replace(/[\s().\-]/g, ''))) {
    const cleaned = s.replace(/[\s().\-]/g, '');
    if (cleaned.length >= 8) return cleaned;
  }
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length >= 7 && digits.length <= 15) return '+' + digits;
  return null;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d]/g, '').replace(/^1/, '');
}

function normalizeAddress(addr) {
  return String(addr || '').toLowerCase()
    // Street type abbreviations (word-boundary anchored)
    .replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave')
    .replace(/\broad\b/g, 'rd').replace(/\bboulevard\b/g, 'blvd')
    .replace(/\bdrive\b/g, 'dr').replace(/\blane\b/g, 'ln')
    .replace(/\bhighway\b/g, 'hwy').replace(/\bplace\b/g, 'pl')
    .replace(/\bcourt\b/g, 'ct').replace(/\bparkway\b/g, 'pkwy')
    .replace(/\bterrace\b/g, 'ter').replace(/\bcircle\b/g, 'cir')
    .replace(/\btrail\b/g, 'trl')
    // Unit / suite designators
    .replace(/\bsuite\b/g, 'ste').replace(/\bapartment\b/g, 'apt')
    .replace(/\bbuilding\b/g, 'bldg').replace(/\bfloor\b/g, 'fl')
    .replace(/\bunit\b/g, 'u')
    // Directional words
    .replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's')
    .replace(/\beast\b/g, 'e').replace(/\bwest\b/g, 'w')
    .replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

function analyzeNap({ html, expectedBusinessName = '', expectedPhone = '', expectedAddress = '' }) {
  const extracted = extractNapFromHtml(html || '');
  const phones = Array.from(extracted.phones);
  const addresses = Array.from(extracted.addresses);
  const names = Array.from(extracted.names);

  const phoneVariants = new Set(phones.map(normalizePhone));
  const addressVariants = new Set(addresses.map(normalizeAddress));

  const issues = [];
  let score = 100;

  if (names.length === 0) {
    score -= 25;
    issues.push({ severity: 'high', issue: 'No business name detected on the page' });
  }
  if (phones.length === 0) {
    score -= 30;
    issues.push({ severity: 'high', issue: 'No phone number detected — calls cannot reach you from search snippets' });
  } else if (phoneVariants.size > 1) {
    score -= 15;
    issues.push({ severity: 'medium', issue: `${phoneVariants.size} different phone numbers detected on the page — pick one canonical number`, evidence: phones });
  }

  if (addresses.length === 0) {
    score -= 20;
    issues.push({ severity: 'high', issue: 'No physical address detected — local SEO requires NAP visible on site' });
  } else if (addressVariants.size > 1) {
    score -= 10;
    issues.push({ severity: 'medium', issue: `${addressVariants.size} different address formats detected — normalize to one canonical version`, evidence: addresses });
  }

  if (expectedPhone && phoneVariants.size > 0 && !phoneVariants.has(normalizePhone(expectedPhone))) {
    score -= 10;
    issues.push({ severity: 'medium', issue: `Expected phone "${expectedPhone}" not found on the page (found: ${phones.join(', ')})` });
  }

  if (expectedAddress && addressVariants.size > 0 && !addressVariants.has(normalizeAddress(expectedAddress))) {
    score -= 10;
    issues.push({ severity: 'low', issue: `Expected address "${expectedAddress}" doesn\u2019t match what's on the page` });
  }

  const fixes = [];
  if (phoneVariants.size === 0) {
    fixes.push({
      key: 'nap-add-phone',
      severity: 'high',
      title: 'Add a clickable phone number to every page',
      detail: 'Use <a href="tel:+1XXXXXXXXXX">(XXX) XXX-XXXX</a> in the header so it\u2019s tappable on mobile.',
      copyPasteReady: false,
      effortMinutes: 5
    });
  }
  if (phoneVariants.size > 1) {
    fixes.push({
      key: 'nap-phone-inconsistent',
      severity: 'medium',
      title: 'Pick one canonical phone number',
      detail: `Currently ${phoneVariants.size} different numbers on the page. Search engines and customers get confused.`,
      effortMinutes: 15
    });
  }
  if (addressVariants.size === 0) {
    fixes.push({
      key: 'nap-add-address',
      severity: 'high',
      title: 'Add your physical address in the footer',
      detail: 'Required for Google Business Profile parity and local-pack ranking.',
      effortMinutes: 5
    });
  }
  if (addressVariants.size > 1) {
    fixes.push({
      key: 'nap-address-inconsistent',
      severity: 'medium',
      title: 'Normalize your address to one format everywhere',
      detail: 'Pick one canonical version (matching what\u2019s on Google Business Profile) and use it identically across all pages.',
      effortMinutes: 30
    });
  }

  return {
    overallScore: Math.max(0, Math.min(100, score)),
    status: score >= 75 ? 'pass' : score >= 50 ? 'warn' : 'fail',
    extracted: { names, phones, addresses, sources: extracted.sources.slice(0, 20) },
    consistency: {
      phoneVariants: phoneVariants.size,
      addressVariants: addressVariants.size,
      nameVariants: names.length
    },
    issues,
    fixes,
    note: 'Phase 1 — on-page NAP only. Phase 2 (cross-platform: Google Maps, Bing Places, Yelp, Apple Maps) requires DataForSEO API key.'
  };
}

module.exports = { analyzeNap, extractNapFromHtml, normalizePhone, normalizeAddress };
