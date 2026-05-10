const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function bust() {
  delete require.cache[require.resolve('../services/leadGenBatch')];
}

test('normalizeLeadGenQuantity clamps requested batch size to 1..250', () => {
  const { normalizeLeadGenQuantity } = require('../services/leadGenBatch');

  assert.equal(normalizeLeadGenQuantity(0), 1);
  assert.equal(normalizeLeadGenQuantity('7'), 7);
  assert.equal(normalizeLeadGenQuantity(500), 250);
  assert.equal(normalizeLeadGenQuantity('not-a-number'), 100);
});

test('extractLeadGenCandidates dedupes market rows and limits to requested quantity', () => {
  const { extractLeadGenCandidates } = require('../services/leadGenBatch');
  const marketModel = {
    industryAnalysis: {
      overview: {
        orderedResults: [
          { companyName: 'A Plumbing', website: 'https://aplumbing.com/page', domain: 'aplumbing.com', rank: 1, resultType: 'local_business', confidence: 92 },
          { companyName: 'A Plumbing duplicate', website: 'https://www.aplumbing.com/other', domain: 'aplumbing.com', rank: 2, resultType: 'local_business', confidence: 88 },
          { companyName: 'Directory', website: 'https://yelp.com/search', domain: 'yelp.com', rank: 3, resultType: 'directory', confidence: 70 },
          { companyName: 'B Plumbing', website: 'https://bplumbing.com', domain: 'bplumbing.com', rank: 4, resultType: 'local_business', confidence: 81 }
        ]
      }
    }
  };

  const candidates = extractLeadGenCandidates(marketModel, {
    quantity: 2,
    industry: 'plumber',
    city: 'Branson',
    state: 'MO'
  });

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((c) => c.domain), ['aplumbing.com', 'bplumbing.com']);
  assert.equal(candidates[0].industry, 'plumber');
  assert.equal(candidates[0].city, 'Branson');
  assert.equal(candidates[0].state, 'MO');
});

test('extractLeadGenCandidates filters out unknown and non-business resultTypes', () => {
  const { extractLeadGenCandidates } = require('../services/leadGenBatch');
  const marketModel = {
    industryAnalysis: {
      overview: {
        orderedResults: [
          { companyName: 'Good Business', domain: 'good.com', rank: 1, resultType: 'local_business', category: 'business' },
          { companyName: 'Unknown Type', domain: 'unknown.com', rank: 2, resultType: 'unknown', category: 'business' },
          { companyName: 'Directory Site', domain: 'dir.com', rank: 3, resultType: 'directory', category: 'directory' },
          { companyName: 'Organic Business', domain: 'organic.com', rank: 4, resultType: 'organic_business', category: 'business' },
          { companyName: 'Website Type', domain: 'website.com', rank: 5, resultType: 'website', category: 'business' }
        ]
      }
    }
  };

  const candidates = extractLeadGenCandidates(marketModel, { quantity: 10 });
  // Should only include: local_business, organic_business, website
  // Should exclude: unknown (bug caused this to return 0 candidates), directory
  assert.equal(candidates.length, 3);
  assert.deepEqual(candidates.map((c) => c.domain), ['good.com', 'organic.com', 'website.com']);
});

test('assessSeoProvider classifies agency, pro, diy, and unknown from evidence', () => {
  const { assessSeoProvider } = require('../services/leadGenBatch');

  assert.equal(assessSeoProvider({ html: 'Website by BrightLocal Agency', pageTitle: 'Home' }).classification, 'agency');
  assert.equal(assessSeoProvider({ html: '<meta name="generator" content="Yoast SEO">', pageTitle: 'Local Plumber' }).classification, 'pro');
  assert.equal(
    assessSeoProvider({ html: '<script src="https://x.com/wp-content/themes/t/foo.js"></script>', pageTitle: 'Local Shop', visibleText: 'We fix roofs' }).classification,
    'pro',
    'HTML-only stack signals (e.g. wp-content) must match when raw HTML is supplied'
  );
  assert.equal(assessSeoProvider({ html: '<title>Home</title><h1>Welcome</h1>', pageTitle: 'Home' }).classification, 'diy_local');
  assert.equal(
    assessSeoProvider({ visibleText: 'Serving the Ozarks since 1999', pageTitle: 'Home' }).classification,
    'diy_local',
    'visibleText + pageTitle without raw HTML — generic Home title still classifies as DIY'
  );
  assert.equal(assessSeoProvider({ visibleText: 'Family owned repair shop', pageTitle: 'Welcome' }).classification, 'diy_local');
  assert.equal(assessSeoProvider({ html: '', pageTitle: '' }).classification, 'unknown');
});

test('saveLeadGenDecision persists keep tags notes and enrichment fields', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-leadgen-'));
  const prev = process.env.GEONEO_LEAD_GEN_PATH;
  process.env.GEONEO_LEAD_GEN_PATH = path.join(dir, 'lead-gen-runs.json');
  bust();
  const {
    createLeadGenRun,
    saveLeadGenDecision,
    getLeadGenRun
  } = require('../services/leadGenBatch');

  try {
    const run = await createLeadGenRun({
      industry: 'hotel',
      city: 'Branson',
      state: 'MO',
      quantity: 1,
      candidates: [{ domain: 'hotel.test', website: 'https://hotel.test', businessName: 'Hotel Test' }]
    });

    const updated = await saveLeadGenDecision(run.id, 'hotel.test', {
      keep: true,
      tags: ['keeper', 'call-first'],
      notes: 'Owner answers phone.',
      ownerName: 'Jane Owner',
      yearsInBusiness: '12',
      seoProviderOverride: 'agency'
    });

    assert.equal(updated.keep, true);
    assert.deepEqual(updated.tags, ['keeper', 'call-first']);
    assert.equal(updated.ownerName, 'Jane Owner');

    const loaded = await getLeadGenRun(run.id);
    assert.equal(loaded.candidates[0].decision.keep, true);
    assert.equal(loaded.candidates[0].decision.seoProviderOverride, 'agency');
  } finally {
    if (prev !== undefined) process.env.GEONEO_LEAD_GEN_PATH = prev;
    else delete process.env.GEONEO_LEAD_GEN_PATH;
    bust();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('extractContactInfo summarizes contact readiness from audit signals and text', () => {
  const { extractContactInfo } = require('../services/leadGenBatch');

  const info = extractContactInfo({
    auditResult: {
      siteProfile: {
        contactSignals: { phone: true, email: false, address: true, strongCta: true }
      }
    },
    text: 'Call (417) 555-1212 or email owner@example.com for service.'
  });

  assert.equal(info.hasPhone, true);
  assert.equal(info.hasEmail, true);
  assert.equal(info.hasAddress, true);
  assert.equal(info.hasStrongCta, true);
  assert.equal(info.score, 100);
  assert.equal(info.phones[0], '(417) 555-1212');
  assert.equal(info.emails[0], 'owner@example.com');
});

test('estimateSeoBudget calculates spend range based on authority, keywords, and provider signals', () => {
  const { estimateSeoBudget } = require('../services/leadGenBatch');

  // Sophisticated program
  const high = estimateSeoBudget(
    { domainRating: 75, organicKeywords: 1500, paidKeywords: 80, refdomains: 600 },
    { classification: 'agency' }
  );
  assert.ok(high.estimatedMonthlyHigh >= 10000, 'High DR + many keywords + agency = enterprise budget');
  assert.equal(high.hasActiveProgram, true);
  assert.equal(high.isMeasurable, true);

  // No program
  const none = estimateSeoBudget(
    { domainRating: 0, organicKeywords: 0, paidKeywords: 0, refdomains: 0 },
    { classification: 'unknown' }
  );
  assert.equal(none.estimatedMonthlyHigh, 0);
  assert.equal(none.hasActiveProgram, false);

  // Basic DIY
  const basic = estimateSeoBudget(
    { domainRating: 25, organicKeywords: 150, paidKeywords: 0, refdomains: 30 },
    { classification: 'diy_local' }
  );
  assert.ok(basic.estimatedMonthlyHigh >= 500 && basic.estimatedMonthlyHigh <= 2000);
  assert.equal(basic.hasActiveProgram, basic.estimatedMonthlyHigh >= 500);
});

test('predictSeoQuality classifies SEO maturity from measurable signals', () => {
  const { predictSeoQuality } = require('../services/leadGenBatch');

  const sophisticated = predictSeoQuality(
    { domainRating: 80, organicKeywords: 2000, refdomains: 800, organicTraffic: 50000 },
    { googleGrades: { seo: 90 }, siteProfile: { seoSignals: { canonical: true, sitemap: true } } }
  );
  assert.equal(sophisticated.classification, 'sophisticated');
  assert.ok(sophisticated.overallQuality >= 75);
  assert.equal(sophisticated.isMeasurable, true);
  assert.equal(sophisticated.isActivelyManaged, true);
  assert.equal(sophisticated.hasRoomForImprovement, false);

  const none = predictSeoQuality(
    { domainRating: 0, organicKeywords: 0, refdomains: 0 },
    {}
  );
  assert.equal(none.classification, 'none');
  assert.equal(none.isMeasurable, false);
});

test('scoreLeadOpportunity prioritizes weak sites with contact path and no obvious agency', () => {
  const { scoreLeadOpportunity } = require('../services/leadGenBatch');

  const hot = scoreLeadOpportunity({
    candidate: { sourceRank: 2 },
    scores: { overall: 42, seo: 38, ai: 30, geo: 35 },
    contactInfo: { score: 85, hasPhone: true, hasEmail: true },
    seoProvider: { classification: 'diy_local', confidence: 'medium' }
  });
  const cold = scoreLeadOpportunity({
    candidate: { sourceRank: 20 },
    scores: { overall: 91, seo: 92, ai: 88, geo: 90 },
    contactInfo: { score: 0 },
    seoProvider: { classification: 'agency', confidence: 'high' }
  });

  assert.equal(hot.tier, 'hot');
  assert.ok(hot.score > cold.score);
  assert.ok(hot.reasons.some((reason) => reason.includes('Weak audit score')));
});

test('buildOutreachPlan produces email and call handoff copy', () => {
  const { buildOutreachPlan } = require('../services/leadGenBatch');

  const plan = buildOutreachPlan({
    candidate: { businessName: 'Ozark Plumbing', industry: 'plumber', city: 'Branson', state: 'MO' },
    scores: { overall: 48 },
    leadScore: { tier: 'hot', reasons: ['Weak audit score (48/100).'] },
    seoProvider: { classification: 'diy_local' },
    contactInfo: { hasEmail: true, hasPhone: true }
  });

  assert.match(plan.emailSubject, /Ozark Plumbing|Branson/);
  assert.match(plan.emailOpening, /48\/100/);
  assert.equal(plan.callReadiness, 'ready_for_ai_call');
  assert.ok(plan.nextBestAction);
});

test('getAiCallComplianceForState surfaces consent and AI-call risk', () => {
  const { getAiCallComplianceForState } = require('../services/leadGenBatch');

  const ca = getAiCallComplianceForState('CA');
  const mo = getAiCallComplianceForState('MO');

  assert.equal(ca.recordingConsent, 'all_party');
  assert.equal(ca.aiCallRisk, 'high');
  assert.equal(mo.recordingConsent, 'one_party');
  assert.ok(mo.requirements.some((item) => item.includes('TCPA')));
});

test('listUsStatesForLeadGenUi tiers align with getAiCallComplianceForState', () => {
  const { listUsStatesForLeadGenUi, getAiCallComplianceForState } = require('../services/leadGenBatch');

  const rows = listUsStatesForLeadGenUi();
  assert.equal(rows.length, 51);
  const mo = rows.find((r) => r.code === 'MO');
  const ca = rows.find((r) => r.code === 'CA');
  assert.ok(mo);
  assert.ok(ca);
  assert.equal(mo.workflowTier, 'favorable');
  assert.equal(ca.workflowTier, 'caution');
  assert.equal(getAiCallComplianceForState('MO').aiCallRisk, 'medium');
  assert.equal(getAiCallComplianceForState('CA').aiCallRisk, 'high');
  assert.ok(rows.every((r) => r.workflowTier === (getAiCallComplianceForState(r.code).aiCallRisk === 'high' ? 'caution' : 'favorable')));
});

test('buildAdvancedLeadInsights adds compliance, value, and routing ideas', () => {
  const { buildAdvancedLeadInsights } = require('../services/leadGenBatch');

  const insights = buildAdvancedLeadInsights({
    candidate: { industry: 'attorney', state: 'CA' },
    leadScore: { score: 82, tier: 'hot' },
    contactInfo: { hasEmail: true, hasPhone: true },
    seoProvider: { classification: 'diy_local' },
    scores: { overall: 44 }
  });

  assert.equal(insights.aiCallCompliance.state, 'CA');
  assert.equal(insights.pipelineStage, 'email_then_ai_call_candidate');
  assert.ok(insights.estimatedOpportunity.high > insights.estimatedOpportunity.low);
  assert.ok(insights.ideas.length >= 5);
});

test('getAhrefsIntegrationStatus reports configuration without exposing secrets', () => {
  const { getAhrefsIntegrationStatus } = require('../services/leadGenBatch');
  const prev = process.env.AHREFS_API_KEY;
  process.env.AHREFS_API_KEY = 'super-secret-key';
  try {
    const status = getAhrefsIntegrationStatus();
    assert.equal(status.configured, true);
    assert.equal(status.envVar, 'AHREFS_API_KEY');
    assert.equal(JSON.stringify(status).includes('super-secret-key'), false);
  } finally {
    if (prev !== undefined) process.env.AHREFS_API_KEY = prev;
    else delete process.env.AHREFS_API_KEY;
  }
});

test('ahrefsStatus mirrors AHREFS_API_KEY without exposing the key', () => {
  const { ahrefsStatus } = require('../services/ahrefsClient');
  const status = ahrefsStatus({ AHREFS_API_KEY: 'secret-value' });
  assert.equal(status.configured, true);
  assert.equal(status.secretExposed, false);
  assert.equal(JSON.stringify(status).includes('secret-value'), false);
});
