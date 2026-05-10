const test = require('node:test');
const assert = require('node:assert/strict');
const { generateLocationServicePage, slugify, titleCase } = require('../services/pageGenerator');

test('generateLocationServicePage produces clean schema-rich output', () => {
  const page = generateLocationServicePage({
    businessName: 'Acme Plumbing',
    city: 'Branson',
    state: 'MO',
    service: 'Emergency Plumbing',
    industry: 'Plumbing',
    phone: '(417) 555-1212',
    yearsInBusiness: '18'
  });

  assert.ok(page.slug.includes('emergency-plumbing-branson'));
  assert.ok(page.title.includes('Emergency Plumbing in Branson'));
  assert.ok(page.metaDescription.includes('18 years'));
  assert.ok(page.html.includes('schema.org'));
  assert.equal(page.schema['@type'], 'LocalBusiness');
  assert.ok(page.schema.telephone.includes('417'));
});

test('slugify and titleCase are stable', () => {
  assert.equal(slugify('Emergency Plumbing in Branson, MO'), 'emergency-plumbing-in-branson-mo');
  assert.equal(titleCase('emergency plumbing'), 'Emergency Plumbing');
});