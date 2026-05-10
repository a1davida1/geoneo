'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePlaceName } = require('../services/censusPlaces');

test('normalizePlaceName does not reduce Oklahoma city to Oklahoma', () => {
  assert.equal(normalizePlaceName('Oklahoma city, OK'), 'Oklahoma city');
});

test('normalizePlaceName normalizes Oklahoma City city to Oklahoma City', () => {
  assert.equal(normalizePlaceName('Oklahoma City city, Oklahoma'), 'Oklahoma City');
});

test('normalizePlaceName still strips generic city suffix', () => {
  assert.equal(normalizePlaceName('Springfield city, Missouri'), 'Springfield');
});
