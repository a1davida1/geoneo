const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeSchemas,
  extractJsonLdBlocks,
  flattenSchemaNodes,
  validateNode,
  generateSchemaForType,
  industryTypeFor
} = require('../services/schemaAnalyzer');

const SAMPLE_HTML_NO_SCHEMA = '<html><body><h1>Acme</h1></body></html>';
const SAMPLE_HTML_BAD_JSON = '<script type="application/ld+json">{ "bad" "json" }</script>';
const SAMPLE_LOCALBUSINESS = (extras = '') => `
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Plumber",
    "name": "Branson Plumbing Pros",
    "telephone": "+14175550100",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "123 Main St",
      "addressLocality": "Branson",
      "addressRegion": "MO",
      "postalCode": "65616"
    },
    "geo": { "@type": "GeoCoordinates", "latitude": 36.6437, "longitude": -93.2185 }
    ${extras}
  }
  </script>
`;

test('extractJsonLdBlocks finds zero blocks on empty page', () => {
  assert.equal(extractJsonLdBlocks(SAMPLE_HTML_NO_SCHEMA).length, 0);
});

test('extractJsonLdBlocks records parse errors without throwing', () => {
  const blocks = extractJsonLdBlocks(SAMPLE_HTML_BAD_JSON);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].parsed, null);
  assert.ok(blocks[0].parseError);
});

test('flattenSchemaNodes unwraps @graph arrays', () => {
  const obj = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'LocalBusiness', name: 'A' },
      { '@type': 'WebSite', name: 'B' }
    ]
  };
  const nodes = flattenSchemaNodes(obj);
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]['@type'], 'LocalBusiness');
});

test('analyzeSchemas: empty page → score 0, fail status, lists missing types for vertical', () => {
  const r = analyzeSchemas({ html: SAMPLE_HTML_NO_SCHEMA, industry: 'plumbing' });
  assert.equal(r.overallScore, 0);
  assert.equal(r.status, 'fail');
  assert.ok(r.missingTypes.includes('LocalBusiness'));
  assert.ok(r.missingTypes.includes('WebSite'));
});

test('analyzeSchemas: parse error surfaces as a fix', () => {
  const r = analyzeSchemas({ html: SAMPLE_HTML_BAD_JSON, industry: 'plumbing' });
  assert.equal(r.parseErrors.length, 1);
  assert.ok(r.fixes.some(f => f.key === 'schema-parse-error'));
});

test('analyzeSchemas: valid LocalBusiness scores higher than minimal', () => {
  const r = analyzeSchemas({ html: SAMPLE_LOCALBUSINESS(), industry: 'plumbing' });
  assert.ok(r.overallScore > 30);
  assert.ok(r.presentTypes.includes('LocalBusiness'));
});

test('validateNode: nested address must contain locality+region+street, not just be present', () => {
  const goodNode = {
    '@type': 'LocalBusiness',
    name: 'A',
    address: { '@type': 'PostalAddress', streetAddress: '1 Main', addressLocality: 'Branson', addressRegion: 'MO' }
  };
  const badNode = { '@type': 'LocalBusiness', name: 'A', address: { '@type': 'PostalAddress' } };
  assert.equal(validateNode(goodNode).requiredMissing.length, 0);
  assert.ok(validateNode(badNode).requiredMissing.includes('address'));
});

test('validateNode: invalid telephone scalar (placeholder text) is rejected', () => {
  const node = { '@type': 'LocalBusiness', name: 'A', address: { '@type': 'PostalAddress', streetAddress: '1 Main', addressLocality: 'B', addressRegion: 'MO' }, telephone: 'asdf' };
  const v = validateNode(node);
  assert.ok(v.recommendedMissing.includes('telephone'));
});

test('validateNode: lat/lng out of range fails', () => {
  const node = { '@type': 'LocalBusiness', name: 'A', address: { '@type': 'PostalAddress', streetAddress: '1', addressLocality: 'B', addressRegion: 'MO' }, geo: { '@type': 'GeoCoordinates', latitude: 999, longitude: 0 } };
  const v = validateNode(node);
  assert.ok(v.recommendedMissing.includes('geo'));
});

test('industryTypeFor: handles 30+ verticals correctly', () => {
  assert.equal(industryTypeFor('plumber'), 'Plumber');
  assert.equal(industryTypeFor('hvac'), 'HVACBusiness');
  assert.equal(industryTypeFor('roofing'), 'RoofingContractor');
  assert.equal(industryTypeFor('attorney'), 'Attorney');
  assert.equal(industryTypeFor('dentist'), 'Dentist');
  assert.equal(industryTypeFor('hotel'), 'Hotel');
  assert.equal(industryTypeFor('restaurant'), 'Restaurant');
  assert.equal(industryTypeFor('auto body'), 'AutoBodyShop'); // more specific wins
  assert.equal(industryTypeFor('beauty salon'), 'BeautySalon');
  assert.equal(industryTypeFor('moving company'), 'MovingCompany');
  assert.equal(industryTypeFor('pest control'), 'PestControlBusiness');
  assert.equal(industryTypeFor('unknown vertical'), 'LocalBusiness');
});

test('generateSchemaForType: LocalBusiness with full facts produces valid Schema.org', () => {
  const schema = generateSchemaForType('LocalBusiness', 'plumbing', {
    businessName: 'Acme Plumbing',
    url: 'https://acme.com',
    phone: '(417) 555-0100',
    streetAddress: '123 Main',
    city: 'Branson',
    state: 'MO',
    zip: '65616',
    lat: 36.64,
    lng: -93.22
  });
  assert.equal(schema['@type'], 'Plumber');
  assert.equal(schema['@context'], 'https://schema.org');
  assert.equal(schema.address['@type'], 'PostalAddress');
  assert.equal(schema.address.addressLocality, 'Branson');
  assert.equal(schema.geo.latitude, 36.64);
});

test('generateSchemaForType: FAQPage REFUSES to generate without real FAQs (no Mad Libs)', () => {
  const schema = generateSchemaForType('FAQPage', 'plumbing', { businessName: 'Acme', city: 'Branson' });
  assert.equal(schema, null, 'FAQPage must return null when no real FAQs supplied — no templated junk');
});

test('generateSchemaForType: FAQPage works when real FAQs supplied', () => {
  const faqs = [{ question: 'Do you offer 24/7 service?', answer: 'Yes, our emergency line is staffed 24 hours.' }];
  const schema = generateSchemaForType('FAQPage', 'plumbing', { faqs });
  assert.equal(schema['@type'], 'FAQPage');
  assert.equal(schema.mainEntity.length, 1);
  assert.equal(schema.mainEntity[0].name, 'Do you offer 24/7 service?');
});

test('analyzeSchemas: detects microdata types alongside JSON-LD', () => {
  const html = '<div itemscope itemtype="https://schema.org/LocalBusiness"><span itemprop="name">A</span></div>';
  const r = analyzeSchemas({ html, industry: 'plumbing' });
  assert.ok(r.microdataTypes.includes('LocalBusiness'));
});

test('analyzeSchemas: detects Open Graph tags', () => {
  const html = '<meta property="og:title" content="Acme"><meta property="og:type" content="website">';
  const r = analyzeSchemas({ html, industry: 'plumbing' });
  assert.equal(r.openGraph.ogPresent, true);
  assert.equal(r.openGraph.og.title, 'Acme');
});
