'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadProspectVerticals, clearProspectVerticalsCacheForTests } = require('../services/prospectVerticals');

test('loadProspectVerticals returns validated groups', () => {
  clearProspectVerticalsCacheForTests();
  const root = path.join(__dirname, '..');
  const data = loadProspectVerticals(root);
  assert.equal(typeof data.version, 'number');
  assert.ok(Array.isArray(data.groups));
  assert.ok(data.groups.length >= 7);
  const first = data.groups[0];
  assert.ok(first.label.length > 0);
  assert.ok(first.items.every((it) => it.value && it.label));
});
