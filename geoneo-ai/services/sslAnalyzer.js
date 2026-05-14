/**
 * SSL & Security analyzer. Checks the basics any business owner expects:
 *
 *   - HTTPS enforced (HTTP redirects to HTTPS, no mixed content)
 *   - Certificate validity + expiry date (warn at <30 days, fail at expired)
 *   - Security headers (HSTS, X-Frame-Options/CSP, X-Content-Type-Options)
 *   - Mixed content detection (http:// resources in HTTPS HTML)
 *
 * No external API calls — pure HTML inspection + Node `tls` module for cert
 * details. Fast (under 2s typical) and free.
 *
 * Returns standard analyzer shape via `standardize()`.
 */

const tls = require('tls');
const { standardize } = require('./analyzerShape');
const log = require('./logger').forModule('sslAnalyzer');

const HEADER_HSTS = 'strict-transport-security';
const HEADER_XFO = 'x-frame-options';
const HEADER_CSP = 'content-security-policy';
const HEADER_XCTO = 'x-content-type-options';

function safeUrl(input) {
  try { return new URL(input.startsWith('http') ? input : 'https://' + input); }
  catch { return null; }
}

/**
 * Pull certificate details for a hostname. Resolves with { valid, daysToExpiry, issuer }
 * or null on connection error. Times out at 5s.
 */
function getCertDetails(hostname) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 5000);
    try {
      const socket = tls.connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false }, () => {
        const cert = socket.getPeerCertificate(true);
        socket.end();
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (!cert || !cert.valid_to) { resolve(null); return; }
        const expiry = new Date(cert.valid_to);
        const daysToExpiry = Math.floor((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        resolve({
          valid: socket.authorized || daysToExpiry > 0,
          daysToExpiry,
          issuer: cert.issuer?.O || cert.issuer?.CN || null,
          subject: cert.subject?.CN || hostname,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          authorizationError: socket.authorizationError || null
        });
      });
      socket.on('error', () => { if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); } });
    } catch {
      if (!resolved) { resolved = true; clearTimeout(timer); resolve(null); }
    }
  });
}

/**
 * Detect mixed-content resource references (http:// in HTTPS HTML).
 * Looks at src/href attributes; ignores data: and protocol-relative URLs.
 */
function detectMixedContent(html, baseUrl) {
  if (!html || !baseUrl) return [];
  const baseProtocol = (() => { try { return new URL(baseUrl).protocol; } catch { return 'https:'; } })();
  if (baseProtocol !== 'https:') return [];
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  const out = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    const url = match[1];
    if (url.startsWith('http://') && !url.includes('w3.org/2000/svg')) {
      out.push(url.slice(0, 200));
      if (out.length >= 10) break;
    }
  }
  return out;
}

async function analyzeSsl({ url, html = '', responseHeaders = {}, skipCertFetch = false } = {}) {
  const parsed = safeUrl(url);
  if (!parsed) {
    return { score: 0, findings: [{ id: 'ssl-bad-url', severity: 'critical', title: 'Invalid URL', detail: 'Could not parse the URL for SSL analysis.' }] };
  }
  const hostname = parsed.hostname;
  const findings = [];
  const warnings = [];
  let score = 100;
  const headers = (responseHeaders && typeof responseHeaders === 'object') ? lowercaseHeaders(responseHeaders) : {};

  // 1. HTTPS enforcement
  if (parsed.protocol !== 'https:') {
    findings.push({
      id: 'ssl-not-https',
      severity: 'critical',
      title: 'Site not served over HTTPS',
      detail: 'Visitors see browser security warnings, Google penalizes the site in rankings, and AI search engines distrust HTTP-only sources.'
    });
    score -= 60;
  }

  // 2. Certificate details (skipped in batch mode — saves ~2-5s/audit)
  let cert = null;
  if (!skipCertFetch) {
    try {
      cert = await getCertDetails(hostname);
    } catch (err) {
      warnings.push({ message: 'cert lookup failed: ' + err.message, severity: 'warn' });
      log.warn('cert lookup failed', { hostname, error: err.message });
    }
  }
  if (cert) {
    if (cert.daysToExpiry < 0) {
      findings.push({
        id: 'ssl-cert-expired',
        severity: 'critical',
        title: 'SSL certificate expired',
        detail: `Certificate expired on ${cert.validTo}. Visitors see a "Not Secure" warning that drives them away.`
      });
      score -= 50;
    } else if (cert.daysToExpiry < 14) {
      findings.push({
        id: 'ssl-cert-expiring-soon',
        severity: 'major',
        title: `SSL certificate expires in ${cert.daysToExpiry} days`,
        detail: `Renew before ${cert.validTo} to avoid a security warning that crashes traffic.`
      });
      score -= 25;
    } else if (cert.daysToExpiry < 30) {
      findings.push({
        id: 'ssl-cert-expiring',
        severity: 'minor',
        title: `SSL certificate expires in ${cert.daysToExpiry} days`,
        detail: 'Plan to renew this month. Most providers auto-renew but verify.'
      });
      score -= 10;
    }
    if (cert.authorizationError) {
      findings.push({
        id: 'ssl-cert-not-trusted',
        severity: 'critical',
        title: 'SSL certificate is not trusted',
        detail: `Browser-side error: ${cert.authorizationError}. Visitors will see scary warnings.`
      });
      score -= 40;
    }
  } else if (parsed.protocol === 'https:') {
    warnings.push({ message: 'cert details unavailable', severity: 'warn' });
  }

  // 3. Security headers
  if (parsed.protocol === 'https:') {
    if (!headers[HEADER_HSTS]) {
      findings.push({
        id: 'ssl-missing-hsts',
        severity: 'minor',
        title: 'Missing HSTS header',
        detail: 'Add Strict-Transport-Security header so browsers always force HTTPS even on first visit. Adds a layer of trust + small ranking signal.'
      });
      score -= 5;
    }
    if (!headers[HEADER_XFO] && !headers[HEADER_CSP]) {
      findings.push({
        id: 'ssl-missing-xfo',
        severity: 'minor',
        title: 'Missing X-Frame-Options or CSP',
        detail: 'Add X-Frame-Options: SAMEORIGIN or a Content-Security-Policy frame-ancestors directive to prevent clickjacking attacks on your forms.'
      });
      score -= 5;
    }
    if (!headers[HEADER_XCTO]) {
      findings.push({
        id: 'ssl-missing-xcto',
        severity: 'info',
        title: 'Missing X-Content-Type-Options header',
        detail: 'Add X-Content-Type-Options: nosniff. Prevents browsers from mis-interpreting file types — minor security hardening.'
      });
      score -= 3;
    }
  }

  // 4. Mixed content
  const mixed = detectMixedContent(html, url);
  if (mixed.length) {
    findings.push({
      id: 'ssl-mixed-content',
      severity: 'major',
      title: `${mixed.length} mixed-content resource(s) loaded over HTTP`,
      detail: `Found HTTP resources on an HTTPS page. Browsers block these or warn visitors. Examples: ${mixed.slice(0, 3).join(', ')}`,
      metadata: { resources: mixed }
    });
    score -= Math.min(20, mixed.length * 4);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    findings,
    warnings,
    cert,
    headers: Object.keys(headers)
  };
}

function lowercaseHeaders(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[String(k).toLowerCase()] = v;
  return out;
}

module.exports = {
  analyze: standardize('ssl', analyzeSsl),
  analyzeSsl,            // raw, un-normalized (for tests)
  getCertDetails,
  detectMixedContent
};
