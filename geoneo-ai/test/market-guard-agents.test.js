const test = require('node:test');
const assert = require('node:assert/strict');

const { runMarketOnlyAudit } = require('../server');

const MARKET_SCENARIOS = [
  {
    key: 'towing',
    industry: 'towing',
    queryTokens: ['towing', 'tow truck', 'roadside assistance', 'car lockout', 'flat tire'],
    city: 'Branson',
    state: 'MO',
    zip: '65616',
    expectedBusinessDomains: [
      'crawfordsautomotiveandtowing.com',
      'daveysautobody.com',
      'alltimetowing.com',
      'risingtowing.com'
    ],
    expectedAssetDomains: ['yelp.com', 'mapquest.com', 'bbb.org']
  },
  {
    key: 'dentist',
    industry: 'dentist',
    queryTokens: ['dentist', 'dental'],
    city: 'Branson',
    state: 'MO',
    zip: '65616',
    expectedBusinessDomains: [
      'bransondentalcenter.com',
      'silvercreekdental.com',
      'smilebranson.com',
      'bransonfamilydental.com'
    ],
    expectedAssetDomains: ['yelp.com', 'bbb.org', 'facebook.com']
  },
  {
    key: 'hotel',
    industry: 'hotel',
    queryTokens: ['hotel'],
    city: 'Branson',
    state: 'MO',
    zip: '65616',
    expectedBusinessDomains: [
      'lakesidebransonhotel.com',
      'ozarkviewinn.com',
      'grandbransonstay.com',
      'bransonlandinghotel.com'
    ],
    expectedAssetDomains: ['tripadvisor.com', 'bbb.org', 'facebook.com']
  },
  {
    key: 'body shop',
    industry: 'body shop',
    queryTokens: ['body shop', 'collision', 'auto body'],
    city: 'Branson',
    state: 'MO',
    zip: '65616',
    expectedBusinessDomains: [
      'daveysautobody.com',
      'bransoncollisioncenter.com',
      'ozarkbodyrepair.com',
      'precisionautobodybranson.com'
    ],
    expectedAssetDomains: ['yelp.com', 'bbb.org', 'facebook.com']
  }
];

function buildFixtureForScenario(scenario) {
  const [businessA, businessB, businessC, businessD] = scenario.expectedBusinessDomains;
  const [assetA, assetB, assetC] = scenario.expectedAssetDomains;
  const titlePrefix = scenario.industry === 'hotel'
    ? 'Hotel'
    : (scenario.industry === 'dentist' ? 'Dentist' : scenario.industry);

  return {
    search_metadata: { created_at: '2026-04-29', raw_html_file: '' },
    search_parameters: {
      q: `${scenario.industry} ${scenario.city} ${scenario.state} ${scenario.zip}`,
      location: `${scenario.city}, Missouri, United States`
    },
    organic_results: [
      {
        position: 1,
        title: `${titlePrefix} leader in ${scenario.city}`,
        link: `https://${businessA}/service`,
        displayed_link: businessA,
        snippet: `${scenario.industry} service in ${scenario.city} ${scenario.state}`
      },
      {
        position: 2,
        title: `Best ${scenario.industry} near ${scenario.city}`,
        link: `https://www.${assetA}/search?q=${encodeURIComponent(`${scenario.industry} ${scenario.city}`)}`,
        displayed_link: assetA,
        snippet: `Top rated ${scenario.industry} listings in ${scenario.city}`
      },
      {
        position: 3,
        title: `${titlePrefix} experts in ${scenario.city}`,
        link: `https://${businessB}/`,
        displayed_link: businessB,
        snippet: `Trusted ${scenario.industry} company in ${scenario.city} ${scenario.state}`
      },
      {
        position: 4,
        title: `${scenario.industry} listings in ${scenario.city}`,
        link: `https://www.${assetB}/result/${scenario.key.replace(/\s+/g, '-')}`,
        displayed_link: assetB,
        snippet: `${scenario.industry} reviews and local listings for ${scenario.city}`
      },
      {
        position: 5,
        title: `${titlePrefix} trusted across ${scenario.city}`,
        link: `https://${businessC}/`,
        displayed_link: businessC,
        snippet: `${scenario.industry} specialists serving ${scenario.city} ${scenario.state}`
      },
      {
        position: 6,
        title: `${scenario.city} ${scenario.industry} reviews`,
        link: `https://www.${assetC}/local/${scenario.key.replace(/\s+/g, '-')}`,
        displayed_link: assetC,
        snippet: `${scenario.industry} customer reviews in ${scenario.city}`
      },
      {
        position: 7,
        title: `${titlePrefix} provider in ${scenario.city}`,
        link: `https://${businessD}/`,
        displayed_link: businessD,
        snippet: `${scenario.industry} company in ${scenario.city} ${scenario.state}`
      }
    ],
    local_results: {
      places: [
        {
          position: 1,
          title: `${titlePrefix} One`,
          website: `https://${businessA}`,
          rating: 4.7,
          reviews: 63,
          address: `${scenario.city}, ${scenario.state}`,
          phone: '(417) 555-0101'
        },
        {
          position: 2,
          title: `${titlePrefix} Two`,
          website: `https://${businessC}`,
          rating: 4.5,
          reviews: 38,
          address: `${scenario.city}, ${scenario.state}`,
          phone: '(417) 555-0102'
        },
        {
          position: 3,
          title: `${titlePrefix} Three`,
          website: `https://${businessD}`,
          rating: 4.2,
          reviews: 17,
          address: `${scenario.city}, ${scenario.state}`,
          phone: '(417) 555-0103'
        }
      ]
    }
  };
}

class ScenarioSerpProvider {
  get name() {
    return 'serpapi';
  }

  async getSearchResults(query) {
    const queryText = String(query || '').toLowerCase();
    const scenario = MARKET_SCENARIOS.find((entry) => (entry.queryTokens || [entry.industry]).some((token) => queryText.includes(token)));
    if (!scenario) {
      throw new Error(`No fixture configured for query: ${query}`);
    }
    return buildFixtureForScenario(scenario);
  }

  normalizeResults(raw, context = {}) {
    return {
      query: context.query || '',
      location: context.location || '',
      organicResults: (raw.organic_results || []).map((row) => ({
        position: row.position,
        title: row.title,
        domain: row.displayed_link,
        url: row.link
      })),
      localPackResults: ((raw.local_results && raw.local_results.places) || []).map((row) => ({
        position: row.position,
        title: row.title,
        domain: row.website || '',
        url: row.website || '',
        rating: row.rating,
        reviews: row.reviews,
        address: row.address
      })),
      screenshotUrl: ''
    };
  }
}

async function runScenario(scenario, provider) {
  return runMarketOnlyAudit({
    industry: scenario.industry,
    city: scenario.city,
    state: scenario.state,
    zip: scenario.zip
  }, {
    provider
  });
}

test('agent: business competitor output stays populated for hotels, dentists, tow trucks, and body shops', async () => {
  const provider = new ScenarioSerpProvider();
  for (const scenario of MARKET_SCENARIOS) {
    const result = await runScenario(scenario, provider);
    const ordered = result.industryAnalysis?.overview?.orderedResults || [];
    const orderedDomains = ordered.map((row) => row.domain);

    assert.match(result.sourceNote, /SERP API|SerpAPI/i, `${scenario.key}: source should be SerpAPI`);
    assert.equal(result.dataQuality, 'real', `${scenario.key}: dataQuality should be real`);
    assert.ok(ordered.length > 0, `${scenario.key}: should have business competitors`);
    assert.ok(
      scenario.expectedBusinessDomains.some((domain) => orderedDomains.includes(domain)),
      `${scenario.key}: expected at least one business domain in orderedResults`
    );

    const leakedAsset = orderedDomains.find((domain) => scenario.expectedAssetDomains.includes(domain));
    assert.equal(leakedAsset, undefined, `${scenario.key}: directories/social/review assets must not leak into orderedResults`);
  }
});

test('agent: market asset separation stays intact for hotels, dentists, tow trucks, and body shops', async () => {
  const provider = new ScenarioSerpProvider();
  for (const scenario of MARKET_SCENARIOS) {
    const result = await runScenario(scenario, provider);
    const overview = result.industryAnalysis?.overview || {};
    const assets = result.marketAssets || overview.directorySignals || [];
    const assetDomains = assets.map((row) => row.domain);
    const scores = result.summaryScores || {};
    const totalVisible = (overview.orderedResults || []).length + assets.length;

    assert.ok(assets.length > 0, `${scenario.key}: should capture market assets`);
    assert.ok(totalVisible > 0, `${scenario.key}: should never collapse to zero rows`);
    assert.ok(
      scenario.expectedAssetDomains.some((domain) => assetDomains.includes(domain)),
      `${scenario.key}: expected at least one asset domain in directorySignals`
    );
    assert.notEqual(
      overview.warning,
      'Search returned no results.',
      `${scenario.key}: should not show zero-results warning when SerpAPI returned non-junk data`
    );
    assert.ok(Number(scores.marketActivity || 0) > 0, `${scenario.key}: marketActivity should be non-zero`);
    assert.ok(Number(scores.opportunityScore || 0) > 0, `${scenario.key}: opportunityScore should be non-zero`);
    assert.ok(Number(scores.leadPotential || 0) > 0, `${scenario.key}: leadPotential should be non-zero`);
  }
});
