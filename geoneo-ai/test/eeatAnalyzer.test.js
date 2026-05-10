const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeEeat, stripHtmlToText } = require('../services/eeatAnalyzer');

const RICH_PAGE = `
  <html><body>
    <h1>Acme Plumbing — Branson, MO</h1>
    <p>Serving Branson since 2010. Licensed and insured. NATE certified, EPA RRP, MO License #PL-12345.</p>
    <a href="tel:+14175550100">(417) 555-0100</a>
    <address>123 Main St, Branson, MO 65616</address>
    <a href="/about">About Us</a><a href="/contact">Contact</a>
    <p>1,200+ jobs completed. 4.9 out of 5 across 312 reviews. Best of Branson 2024.</p>
    <p>BBB accredited A+ rating. Fully insured and bonded.</p>
    <footer>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      Last updated January 2026
      Acme Plumbing LLC | EIN: 12-3456789
    </footer>
  </body></html>
`;

const BARE_PAGE = '<html><body><h1>Some Page</h1><p>plumber</p></body></html>';

test('analyzeEeat: rich page scores well, returns all 8 dimensions', () => {
  const r = analyzeEeat({ html: RICH_PAGE, finalUrl: 'https://acme.com' });
  assert.ok(r.overallScore > 50, `expected >50, got ${r.overallScore}`);
  assert.equal(typeof r.dimensions.experience.score, 'number');
  assert.equal(typeof r.dimensions.expertise.score, 'number');
  assert.equal(typeof r.dimensions.authoritativeness.score, 'number');
  assert.equal(typeof r.dimensions.trust.score, 'number');
  assert.equal(typeof r.dimensions.freshness.score, 'number');
  assert.equal(typeof r.dimensions.attribution.score, 'number');
  assert.equal(typeof r.dimensions.identity.score, 'number');
  assert.equal(typeof r.dimensions.contactAccessibility.score, 'number');
});

test('analyzeEeat: bare page scores poorly with multiple fixes', () => {
  const r = analyzeEeat({ html: BARE_PAGE, finalUrl: 'http://example.com' });
  assert.ok(r.overallScore < 30, `expected <30, got ${r.overallScore}`);
  assert.equal(r.status, 'fail');
  assert.ok(r.fixes.length >= 3);
});

test('analyzeEeat: HTTPS detection works', () => {
  const r1 = analyzeEeat({ html: BARE_PAGE, finalUrl: 'https://example.com' });
  const r2 = analyzeEeat({ html: BARE_PAGE, finalUrl: 'http://example.com' });
  assert.ok(r1.dimensions.trust.score > r2.dimensions.trust.score);
  assert.ok(r1.dimensions.trust.score > 0);
});

test('analyzeEeat: tel: link detection works', () => {
  const withTel = '<html><body><a href="tel:+14175550100">Call us</a></body></html>';
  const r = analyzeEeat({ html: withTel, finalUrl: 'https://acme.com' });
  assert.ok(r.dimensions.contactAccessibility.hits.includes('tel_link'));
});

test('analyzeEeat: BBB accreditation pattern matches A+ rating phrasing', () => {
  const html = '<p>BBB accredited business with A+ rating since 2018.</p>';
  const r = analyzeEeat({ html, finalUrl: 'https://acme.com' });
  assert.ok(r.dimensions.authoritativeness.hits.includes('bbb_accredited'));
});

test('analyzeEeat: Best of [City] pattern works for any city', () => {
  const html = '<p>Best of Springfield 2024 winner.</p>';
  const r = analyzeEeat({ html, finalUrl: 'https://acme.com' });
  assert.ok(r.dimensions.authoritativeness.hits.includes('best_of_city'));
});

test('analyzeEeat: license number patterns catch common formats', () => {
  const formats = [
    'License #PL-12345',
    'Lic. # 87654',
    'LIC #ABC123',
    'License No. MO-44556',
    'Reg #12345'
  ];
  formats.forEach(format => {
    const html = `<p>Acme Plumbing. ${format}</p>`;
    const r = analyzeEeat({ html, finalUrl: 'https://acme.com' });
    assert.ok(
      r.dimensions.identity.hits.includes('license_number_shown'),
      `Failed for: "${format}"`
    );
  });
});

test('analyzeEeat: fixes do NOT contain invented placeholder numbers', () => {
  const r = analyzeEeat({ html: BARE_PAGE, finalUrl: 'https://acme.com' });
  r.fixes.forEach(fix => {
    // Reject any fix that uses fake "12 yrs / 1,400 jobs / 5★ across 200 reviews"
    assert.ok(
      !/12 yrs|1,400.*jobs|5★ across 200/.test(fix.detail || ''),
      `Fix "${fix.title}" still contains invented placeholder numbers`
    );
  });
});

test('analyzeEeat: weights sum to 1.0', () => {
  const r = analyzeEeat({ html: BARE_PAGE, finalUrl: 'https://acme.com' });
  const sum = Object.values(r.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.001, `weights sum to ${sum}, expected 1.0`);
});

test('stripHtmlToText: strips script and style content', () => {
  const html = '<html><script>var x = "secret";</script><style>.a{color:red}</style><p>visible</p></html>';
  const text = stripHtmlToText(html);
  assert.ok(!text.includes('secret'));
  assert.ok(!text.includes('color:red'));
  assert.ok(text.includes('visible'));
});

test('stripHtmlToText: decodes common entities', () => {
  const html = '<p>Smith&amp;Sons &nbsp; &quot;Best&quot;</p>';
  const text = stripHtmlToText(html);
  assert.ok(text.includes('Smith&Sons'));
  assert.ok(text.includes('"Best"'));
});
