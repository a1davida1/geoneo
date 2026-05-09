const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const { authorizeInternalApi, isLoopbackRequest, bearerMatches } = require('../services/apiAccess');
const { analyzeTechnicalSeoDeep } = require('../services/technicalSeoDeep');
const { buildWeeklyRecommendations } = require('../services/memberBrief');
const { enqueueOutboxEntry, stableIdempotencyKey } = require('../services/emailOutbox');
const { isEligibleForWeeklyScore } = require('../services/weeklyScoreScheduler');

function bust(...relPaths) {
  for (const rel of relPaths) {
    delete require.cache[require.resolve(rel)];
  }
}

test('authorizeInternalApi allows loopback without secret', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  assert.equal(authorizeInternalApi(req), true);
});

test('isLoopbackRequest does not trust empty remote address', () => {
  const req = { socket: { remoteAddress: '' }, headers: {} };
  assert.equal(isLoopbackRequest(req), false);
});

test('bearerMatches requires case-insensitive scheme and exact token', () => {
  assert.equal(bearerMatches({ headers: { authorization: 'Bearer abc' } }, 'abc'), true);
  assert.equal(bearerMatches({ headers: { authorization: 'bearer abc' } }, 'abc'), true);
  assert.equal(bearerMatches({ headers: { authorization: 'Bearer abc' } }, 'ab'), false);
});

test('authorizeInternalApi denies non-local without secret', () => {
  const prev = process.env.GEONEO_INTERNAL_API_SECRET;
  delete process.env.GEONEO_INTERNAL_API_SECRET;
  try {
    const req = { socket: { remoteAddress: '10.0.0.5' }, headers: {} };
    assert.equal(authorizeInternalApi(req), false);
  } finally {
    if (prev !== undefined) process.env.GEONEO_INTERNAL_API_SECRET = prev;
  }
});

test('authorizeInternalApi allows bearer when secret set', () => {
  const prev = process.env.GEONEO_INTERNAL_API_SECRET;
  process.env.GEONEO_INTERNAL_API_SECRET = 'test-secret-enterprise';
  try {
    const req = {
      socket: { remoteAddress: '10.0.0.5' },
      headers: { authorization: 'Bearer test-secret-enterprise' }
    };
    assert.equal(authorizeInternalApi(req), true);
  } finally {
    if (prev !== undefined) process.env.GEONEO_INTERNAL_API_SECRET = prev;
    else delete process.env.GEONEO_INTERNAL_API_SECRET;
  }
});

test('fixTracker rejects invalid status', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-fix-'));
  const prev = process.env.GEONEO_FIX_TRACKER_PATH;
  process.env.GEONEO_FIX_TRACKER_PATH = path.join(dir, 'fixTracker.json');
  bust('../services/fixTracker');
  const { upsertItem } = require('../services/fixTracker');
  try {
    await assert.rejects(
      () => upsertItem('example.com', { title: 'A', status: 'bogus' }),
      /fix_tracker_validation/
    );
  } finally {
    if (prev !== undefined) process.env.GEONEO_FIX_TRACKER_PATH = prev;
    else delete process.env.GEONEO_FIX_TRACKER_PATH;
    bust('../services/fixTracker');
  }
});

test('emailOutbox dedupes completed idempotency keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-mail-'));
  const prev = process.env.GEONEO_EMAIL_OUTBOX_PATH;
  process.env.GEONEO_EMAIL_OUTBOX_PATH = path.join(dir, 'outbox.json');
  bust('../services/emailOutbox');
  const { enqueueOutboxEntry: enqueue } = require('../services/emailOutbox');
  try {
    const key = stableIdempotencyKey(['t', 'a', 'b', 'c']);
    const r1 = await enqueue({ idempotencyKey: key, type: 'x', state: 'sent', sent: true });
    const r2 = await enqueue({ idempotencyKey: key, type: 'x', state: 'queued' });
    assert.equal(r1.duplicate, false);
    assert.equal(r2.duplicate, true);
  } finally {
    if (prev !== undefined) process.env.GEONEO_EMAIL_OUTBOX_PATH = prev;
    else delete process.env.GEONEO_EMAIL_OUTBOX_PATH;
    bust('../services/emailOutbox');
  }
});

test('scoreHistory normalizes equivalent domain keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-scores-'));
  const prev = process.env.GEONEO_SCORES_PATH;
  process.env.GEONEO_SCORES_PATH = path.join(dir, 'scores.json');
  bust('../services/scoreHistory');
  const { recordScore, getHistoryForDomain, getLatestScore } = require('../services/scoreHistory');
  try {
    await recordScore('https://www.Example.com/path', { overall: 71 });
    const history = await getHistoryForDomain('example.com');
    const latest = await getLatestScore('WWW.EXAMPLE.COM');

    assert.equal(history.length, 1);
    assert.equal(history[0].domain, 'example.com');
    assert.equal(latest.overall, 71);
  } finally {
    if (prev !== undefined) process.env.GEONEO_SCORES_PATH = prev;
    else delete process.env.GEONEO_SCORES_PATH;
    bust('../services/scoreHistory');
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('isEligibleForWeeklyScore treats admin package as operator eligible', () => {
  assert.equal(isEligibleForWeeklyScore({ purchasedPackage: 'admin', amountPaid: 0 }), true);
});

test('competitor movement uses audit-backed history only', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-comp-'));
  process.env.GEONEO_COMPETITORS_PATH = path.join(dir, 'competitors.json');
  bust('../services/competitorTracking');
  const ct = require('../services/competitorTracking');
  try {
    await ct.setTrackedCompetitors('owner.com', [{
      domain: 'other.com',
      name: 'Other',
      history: [
        { date: '2026-01-01T00:00:00.000Z', score: 50, source: 'estimate' },
        { date: '2026-01-02T00:00:00.000Z', score: 62, source: 'audit' },
        { date: '2026-01-03T00:00:00.000Z', score: 65, source: 'audit' }
      ]
    }]);
    const m = await ct.getCompetitorMovement('owner.com', 'other.com');
    assert.equal(m.change, 3);
    assert.equal(m.latestScore, 65);
  } finally {
    delete process.env.GEONEO_COMPETITORS_PATH;
    bust('../services/competitorTracking');
  }
});

test('buildCompetitorIntelligencePayload marks pending without competitor audit', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-ci-'));
  process.env.GEONEO_AUDITS_PATH = path.join(dir, 'audits.json');
  process.env.GEONEO_COMPETITORS_PATH = path.join(dir, 'competitors.json');
  bust('../services/auditLookup', '../services/competitorTracking', '../services/competitorIntelligence');
  const { buildCompetitorIntelligencePayload } = require('../services/competitorIntelligence');
  try {
    const ownerAudit = {
      website: 'https://owner.com',
      createdAt: '2026-05-01T00:00:00.000Z',
      purchasedPackage: 'gold',
      amountPaid: 399,
      productType: 'membership',
      fullAuditResult: { searchSnapshot: { competitors: [{ domain: 'rival.com', name: 'Rival' }] } }
    };
    await fs.writeFile(process.env.GEONEO_AUDITS_PATH, JSON.stringify([ownerAudit]), 'utf8');
    await fs.writeFile(process.env.GEONEO_COMPETITORS_PATH, '{}', 'utf8');

    const payload = await buildCompetitorIntelligencePayload('owner.com');
    assert.equal(payload.ok, true);
    assert.equal(payload.competitors.length, 1);
    assert.equal(payload.competitors[0].scoreSource, 'pending');
    assert.equal(payload.competitors[0].currentScore, null);
  } finally {
    delete process.env.GEONEO_AUDITS_PATH;
    delete process.env.GEONEO_COMPETITORS_PATH;
    bust('../services/auditLookup', '../services/competitorTracking', '../services/competitorIntelligence');
  }
});

test('buildCompetitorIntelligencePayload uses audit for scored competitor', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-ci2-'));
  process.env.GEONEO_AUDITS_PATH = path.join(dir, 'audits.json');
  process.env.GEONEO_COMPETITORS_PATH = path.join(dir, 'competitors.json');
  bust('../services/auditLookup', '../services/competitorTracking', '../services/competitorIntelligence');
  const { buildCompetitorIntelligencePayload } = require('../services/competitorIntelligence');
  try {
    const ownerAudit = {
      website: 'https://owner.com',
      createdAt: '2026-05-01T00:00:00.000Z',
      purchasedPackage: 'gold',
      amountPaid: 399,
      productType: 'membership',
      fullAuditResult: { searchSnapshot: { competitors: [{ domain: 'rival.com', name: 'Rival' }] } }
    };
    const rivalAudit = {
      website: 'https://rival.com',
      createdAt: '2026-05-02T00:00:00.000Z',
      purchasedPackage: 'silver',
      amountPaid: 199,
      fullAuditResult: { checks: [] }
    };
    await fs.writeFile(process.env.GEONEO_AUDITS_PATH, JSON.stringify([ownerAudit, rivalAudit]), 'utf8');
    await fs.writeFile(process.env.GEONEO_COMPETITORS_PATH, '{}', 'utf8');

    const payload = await buildCompetitorIntelligencePayload('owner.com');
    assert.equal(payload.ok, true);
    assert.equal(payload.competitors.length, 1);
    assert.equal(payload.competitors[0].scoreSource, 'audit');
    assert.ok(typeof payload.competitors[0].currentScore === 'number');
  } finally {
    delete process.env.GEONEO_AUDITS_PATH;
    delete process.env.GEONEO_COMPETITORS_PATH;
    bust('../services/auditLookup', '../services/competitorTracking', '../services/competitorIntelligence');
  }
});

test('analyzeTechnicalSeoDeep returns structured summary', () => {
  const deep = analyzeTechnicalSeoDeep({
    fullAuditResult: {
      checks: [{ key: 'sitemap', status: 'FIX', message: 'Add sitemap' }],
      googleGrades: { seo: 80 }
    }
  });
  assert.ok(typeof deep.summaryScore === 'number');
  assert.ok(Array.isArray(deep.findings));
});

test('buildWeeklyRecommendations returns array from audit shape', () => {
  const actions = buildWeeklyRecommendations({
    fullAuditResult: {
      prioritizedActionPlan: [
        { action: 'Do X', solution: 'Win Y', timeEstimate: '1h', lift: '+3 pts' }
      ]
    }
  });
  assert.ok(Array.isArray(actions));
  assert.ok(actions.length >= 1);
});

test('isEligibleForWeeklyScore gates member APIs consistently', () => {
  assert.equal(isEligibleForWeeklyScore({ productType: 'membership' }), true);
  assert.equal(
    isEligibleForWeeklyScore({ purchasedPackage: 'gold', amountPaid: 99 }),
    true
  );
  assert.equal(isEligibleForWeeklyScore({ purchasedPackage: 'free', amountPaid: 0 }), false);
});
