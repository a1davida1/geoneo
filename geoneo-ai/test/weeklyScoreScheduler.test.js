const test = require('node:test');
const assert = require('node:assert/strict');
const { isEligibleForWeeklyScore } = require('../services/weeklyScoreScheduler');

test('isEligibleForWeeklyScore returns true for membership productType', () => {
  const record = { productType: 'membership' };
  assert.equal(isEligibleForWeeklyScore(record), true);
});

test('isEligibleForWeeklyScore returns true for gold with amountPaid >= 99', () => {
  const record = { purchasedPackage: 'gold', amountPaid: 99 };
  assert.equal(isEligibleForWeeklyScore(record), true);
});

test('isEligibleForWeeklyScore returns true for admin with amountPaid >= 99', () => {
  const record = { purchasedPackage: 'admin', amountPaid: 399 };
  assert.equal(isEligibleForWeeklyScore(record), true);
});

test('isEligibleForWeeklyScore returns true for one-time within 30 days and paid >=197', () => {
  const recent = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString();
  const record = { amountPaid: 197, createdAt: recent };
  assert.equal(isEligibleForWeeklyScore(record), true);
});

test('isEligibleForWeeklyScore returns false for free scan', () => {
  const record = { productType: 'free', amountPaid: 0 };
  assert.equal(isEligibleForWeeklyScore(record), false);
});

test('isEligibleForWeeklyScore returns false for old one-time payment', () => {
  const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 40).toISOString();
  const record = { amountPaid: 197, createdAt: old };
  assert.equal(isEligibleForWeeklyScore(record), false);
});

test('isEligibleForWeeklyScore returns false when gold but underpaid', () => {
  const record = { purchasedPackage: 'gold', amountPaid: 50 };
  assert.equal(isEligibleForWeeklyScore(record), false);
});