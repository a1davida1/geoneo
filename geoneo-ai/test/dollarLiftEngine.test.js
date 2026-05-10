const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cplFor,
  citySizeBucketFor,
  ctrAtPosition,
  estimateQueryLift,
  estimateSpecificLoss,
  estimateGeneralContext,
  estimateForFinding
} = require('../services/dollarLiftEngine');

test('cplFor: known industry returns benchmark', () => {
  assert.equal(cplFor('roofing'), 85);
  assert.equal(cplFor('attorney'), 120);
  assert.equal(cplFor('personal injury'), 250);
  assert.equal(cplFor('plumbing'), 65);
});

test('cplFor: substring match falls back to longest matching key', () => {
  assert.equal(cplFor('emergency plumber'), 95);
  assert.equal(cplFor('residential plumbing services'), 65);
});

test('cplFor: unknown industry returns default', () => {
  assert.equal(cplFor('something exotic'), 50);
  assert.equal(cplFor(''), 50);
});

test('citySizeBucketFor: known city returns correct bucket', () => {
  assert.equal(citySizeBucketFor('Branson').popMax, 25000);
  assert.equal(citySizeBucketFor('Springfield').popMax, 250000);
  assert.equal(citySizeBucketFor('Bentonville').popMax, 75000);
});

test('citySizeBucketFor: unknown city defaults to small', () => {
  assert.equal(citySizeBucketFor('NotARealCity').popMax, 75000);
});

test('ctrAtPosition: organic curve', () => {
  assert.equal(ctrAtPosition('organic', 1), 0.31);
  assert.equal(ctrAtPosition('organic', 3), 0.15);
  assert.equal(ctrAtPosition('organic', 99), 0.001);
});

test('ctrAtPosition: local pack curve drops fast after 3', () => {
  assert.equal(ctrAtPosition('localPack', 1), 0.45);
  assert.equal(ctrAtPosition('localPack', 4), 0);
});

test('estimateQueryLift: moving from #10 to #1 yields positive dollar lift', () => {
  const r = estimateQueryLift({ industry: 'plumbing', monthlyVolume: 1000, currentPosition: 10, targetPosition: 1 });
  assert.ok(r.monthlyDollarLift.high > 0);
  assert.ok(r.monthlyDollarLift.high > r.monthlyDollarLift.low);
  assert.equal(r.inputs.industry_cpl, 65);
  assert.ok(r.inputs.ctr_gain > 0);
});

test('estimateQueryLift: already at #1 yields zero lift', () => {
  const r = estimateQueryLift({ industry: 'plumbing', monthlyVolume: 1000, currentPosition: 1, targetPosition: 1 });
  assert.equal(r.monthlyDollarLift.high, 0);
});

test('estimateSpecificLoss: high-CPL vertical missing from many queries → big loss', () => {
  const r = estimateSpecificLoss({ industry: 'attorney', city: 'Springfield', missingFromQueries: 7, totalQueriesTested: 8, currentAvgPosition: 99 });
  assert.ok(r.monthlyDollarLoss.high > 1000, `expected >$1000/mo for attorney in Springfield missing 7/8, got $${r.monthlyDollarLoss.high}`);
  assert.ok(r.annualDollarLoss.high === r.monthlyDollarLoss.high * 12);
});

test('estimateSpecificLoss: low-CPL vertical small market → modest loss', () => {
  const r = estimateSpecificLoss({ industry: 'restaurant', city: 'Branson', missingFromQueries: 4, totalQueriesTested: 8, currentAvgPosition: 99 });
  assert.ok(r.monthlyDollarLoss.high > 0);
  assert.ok(r.monthlyDollarLoss.high < 800, `expected <$800/mo for restaurant in Branson, got $${r.monthlyDollarLoss.high}`);
});

test('estimateSpecificLoss: inputs are exposed for explainability', () => {
  const r = estimateSpecificLoss({ industry: 'roofing', city: 'Branson', missingFromQueries: 5, totalQueriesTested: 8, currentAvgPosition: 99 });
  assert.equal(r.inputs.industry, 'roofing');
  assert.equal(r.inputs.industry_cpl, 85);
  assert.equal(r.inputs.missing_from_queries, 5);
  assert.equal(r.inputs.total_queries_tested, 8);
  assert.ok(r.inputs.method.includes('cpl'));
});

test('estimateGeneralContext: capability factors produce reasonable bands', () => {
  const r = estimateGeneralContext({ industry: 'plumbing', city: 'Springfield', capability: 'schema_localBusiness' });
  assert.ok(r.monthlyDollarLoss.high > 0);
  assert.ok(r.framing.includes('plumbing'));
  assert.ok(r.framing.includes('LocalBusiness'));
  assert.ok(r.inputs.capability_impact_factor === 0.15);
});

test('estimateGeneralContext: unknown capability defaults sensibly', () => {
  const r = estimateGeneralContext({ industry: 'plumbing', city: 'Branson', capability: 'unknown_thing' });
  assert.ok(r.monthlyDollarLoss.high > 0);
});

test('estimateForFinding: produces both general and specific estimates', () => {
  const r = estimateForFinding({
    findingKey: 'geo-add-qa-blocks',
    industry: 'plumbing',
    city: 'Branson',
    missingFromQueries: 5,
    totalQueriesTested: 8,
    currentAvgPosition: 99
  });
  assert.ok(r.general.monthlyDollarLoss.high > 0);
  assert.ok(r.specific.monthlyDollarLoss.high > 0);
  assert.ok(r.headlineText.includes('Industry baseline'));
  assert.ok(r.headlineText.includes('Your specific'));
  assert.ok(r.headlineText.includes('5/8'));
});

test('estimateForFinding: high-stakes (attorney + Springfield + 7/8 miss) >$2K/mo', () => {
  const r = estimateForFinding({
    findingKey: 'eeat-expertise-credentials',
    industry: 'attorney',
    city: 'Springfield',
    missingFromQueries: 7,
    totalQueriesTested: 8,
    currentAvgPosition: 99
  });
  assert.ok(r.specific.monthlyDollarLoss.high > 2000, `expected >$2000, got $${r.specific.monthlyDollarLoss.high}`);
});
