const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRobotsDisallows,
  isDisallowedByRobots,
  normalizeCrawlUrl,
  extractSameOriginLinks
} = require('../services/siteCrawl');

test('parseRobotsDisallows collects User-agent: * disallow rules', () => {
  const txt = `
# Hello
User-agent: Googlebot
Disallow: /private

User-agent: *
Disallow: /admin
Disallow: /api/

User-agent: Other
Disallow: /x
`;
  const rules = parseRobotsDisallows(txt);
  assert.deepEqual(rules, ['/admin', '/api/']);
});

test('isDisallowedByRobots prefix match', () => {
  const rules = ['/admin', '/secret'];
  assert.equal(isDisallowedByRobots('/admin/edit', rules), true);
  assert.equal(isDisallowedByRobots('/public', rules), false);
});

test('normalizeCrawlUrl strips hash', () => {
  assert.equal(
    normalizeCrawlUrl('https://example.com/path?q=1#frag'),
    'https://example.com/path?q=1'
  );
});

test('extractSameOriginLinks resolves relative and filters off-origin', () => {
  const html = `
    <a href="/about">About</a>
    <a href="https://evil.com/x">X</a>
    <a href="mailto:a@b.com">M</a>
    <a href="page.html">P</a>
  `;
  const links = extractSameOriginLinks(html, 'https://example.com/', 'https://example.com');
  assert.ok(links.includes('https://example.com/about'));
  assert.ok(links.includes('https://example.com/page.html'));
  assert.equal(links.some((u) => u.includes('evil.com')), false);
});
