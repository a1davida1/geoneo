const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Readable, Writable } = require('node:stream');

const {
  requestHandler,
  safeUrl,
  htmlToText,
  calculateOverallScore,
  assessTrustDesign,
  generateRecommendation,
  buildCompetitorQuery,
  sanitizeCompetitorResults,
  interpretVisibility,
  searchCompetitors,
  getCompetitorSnapshot,
  buildAuditRecord,
  normalizePackageLevel,
  resolveAmountPaid,
  buildUpgradeCreditAvailable,
  normalizeCompetitorInput,
  buildReportLinks,
  countQuickWins,
  estimateShortTermLift,
  filterAuditResultByPackage,
  saveAuditRecord,
  loadAuditRecords,
  getAuditRecordById,
  buildAuditReportHtml,
  isNeoClubMember,
  buildNeoClubPayload,
  runAudit,
  runMarketOnlyAudit
} = require('../server');
const {
  generateLocalIntentQueries,
  filterLocalSearchVisibilityByPackage
} = require('../services/localSearchVisibility');

const SERPAPI_FIXTURE = {
  search_metadata: { created_at: '2026-04-29', raw_html_file: '' },
  search_parameters: { q: 'tow truck Branson MO 65616', location: 'Branson, Missouri, United States' },
  organic_results: [
    { position: 1, title: "Crawford's Automotive & Towing", link: 'https://www.crawfordsautomotiveandtowing.com/auto-towing', displayed_link: 'crawfordsautomotiveandtowing.com', snippet: 'Tow service in Branson MO' },
    { position: 2, title: 'THE BEST 10 TOWING near BRANSON, MO 65616', link: 'https://www.yelp.com/search?cflt=towing&find_loc=Branson+MO', displayed_link: 'yelp.com', snippet: 'Top towing near Branson' },
    { position: 3, title: "Davey's Auto Body - Heavy Towing Branson MO", link: 'https://daveysautobody.com/heavy-towing-branson-mo.php', displayed_link: 'daveysautobody.com', snippet: 'Heavy duty towing in Branson' },
    { position: 4, title: "Kinsley's Towing & Recovery - Branson", link: 'https://www.mapquest.com/us/missouri/kinsleys-towing-recovery-791937833', displayed_link: 'mapquest.com', snippet: 'Towing recovery Branson' },
    { position: 5, title: 'Towing Company near Branson, MO - BBB', link: 'https://www.bbb.org/us/mo/branson/category/towing-company', displayed_link: 'bbb.org', snippet: 'BBB towing Branson' },
    { position: 6, title: 'All Time Towing - Branson MO', link: 'https://alltimetowing.com', displayed_link: 'alltimetowing.com', snippet: '24 hour towing Branson' },
    { position: 7, title: 'Rising Towing & Roadside Services', link: 'https://risingtowing.com', displayed_link: 'risingtowing.com', snippet: 'Roadside assistance Branson MO' }
  ],
  local_results: {
    places: [
      { position: 1, title: "Crawford's Towing", rating: 4.2, reviews: 56, address: 'Branson, MO', phone: '(417) 555-0101' },
      { position: 2, title: 'All Time Towing', rating: 5, reviews: 58, address: 'Branson, MO', phone: '(417) 555-0102' },
      { position: 3, title: 'Rising Towing & Roadside Services', rating: 3, reviews: 4, address: 'Branson, MO', phone: '(417) 555-0103' }
    ]
  }
};

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

class FakeSerpProvider {
  get name() {
    return 'serpapi';
  }

  async getSearchResults() {
    return SERPAPI_FIXTURE;
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
        rating: row.rating,
        reviews: row.reviews,
        address: row.address
      })),
      screenshotUrl: ''
    };
  }
}

async function withSerpApiDisabled(callback) {
  const previousProvider = process.env.SERP_PROVIDER;
  const previousKey = process.env.SERP_API_KEY;
  delete process.env.SERP_PROVIDER;
  delete process.env.SERP_API_KEY;
  try {
    return await callback();
  } finally {
    if (previousProvider === undefined) delete process.env.SERP_PROVIDER;
    else process.env.SERP_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.SERP_API_KEY;
    else process.env.SERP_API_KEY = previousKey;
  }
}

test('safeUrl adds https when protocol is missing', () => {
  const result = safeUrl('example.com');
  assert.equal(result.protocol, 'https:');
  assert.equal(result.hostname, 'example.com');
});

test('safeUrl keeps existing http/https protocols', () => {
  const httpsResult = safeUrl('https://example.com/path');
  const httpResult = safeUrl('http://example.com/path');

  assert.equal(httpsResult.protocol, 'https:');
  assert.equal(httpResult.protocol, 'http:');
  assert.equal(httpsResult.pathname, '/path');
  assert.equal(httpResult.pathname, '/path');
});

test('safeUrl rejects non-http protocols', () => {
  assert.throws(
    () => safeUrl('javascript:alert(1)'),
    /(Only http and https URLs are allowed\.|Invalid URL)/
  );
});

test('htmlToText strips tags/scripts/styles and normalizes whitespace', () => {
  const html = `
    <html>
      <head>
        <style>.x { color: red; }</style>
        <script>console.log('hidden');</script>
      </head>
      <body>
        <h1>Hello&nbsp;World</h1>
        <p>GeoNeo &amp; AI   visibility</p>
      </body>
    </html>
  `;

  const text = htmlToText(html);
  assert.equal(text, 'Hello World GeoNeo & AI visibility');
});

test('calculateOverallScore applies missing H1 penalty', () => {
  const score = calculateOverallScore({
    h1Count: 0,
    grammarErrorCount: 0,
    hasLocalSignals: true,
    fixCount: 0,
    googleGrades: { seo: 90, performance: 90 },
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: false
  });
  assert.equal(score, 85);
});

test('calculateOverallScore applies heavy grammar penalty when > 20', () => {
  const score = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 21,
    hasLocalSignals: true,
    fixCount: 0,
    googleGrades: { seo: 90, performance: 90 },
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: false
  });
  assert.equal(score, 75);
});

test('calculateOverallScore applies moderate grammar penalty when > 5', () => {
  const score = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 8,
    hasLocalSignals: true,
    fixCount: 0,
    googleGrades: { seo: 90, performance: 90 },
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: false
  });
  assert.equal(score, 90);
});

test('calculateOverallScore applies missing local GEO penalty', () => {
  const score = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 0,
    hasLocalSignals: false,
    fixCount: 0,
    googleGrades: { seo: 90, performance: 90 },
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: false
  });
  assert.equal(score, 90);
});

test('calculateOverallScore applies 5+ fix items penalty', () => {
  const score = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 0,
    hasLocalSignals: true,
    fixCount: 5,
    googleGrades: { seo: 90, performance: 90 },
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: false
  });
  assert.equal(score, 85);
});

test('calculateOverallScore caps at 65 when Google performance < 50', () => {
  const score = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 0,
    hasLocalSignals: true,
    fixCount: 0,
    googleGrades: { seo: 95, performance: 40 },
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: false
  });
  assert.equal(score, 65);
});

test('calculateOverallScore caps at 70 when Google SEO < 60', () => {
  const score = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 0,
    hasLocalSignals: true,
    fixCount: 0,
    googleGrades: { seo: 50, performance: 95 },
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: false
  });
  assert.equal(score, 70);
});

test('calculateOverallScore clamps between 20 and 100', () => {
  const lowScore = calculateOverallScore({
    h1Count: 0,
    grammarErrorCount: 100,
    hasLocalSignals: false,
    fixCount: 10,
    googleGrades: { seo: 30, performance: 20 },
    thinContent: true,
    repetitiveContent: true,
    weakTrustSignals: true
  });
  assert.equal(lowScore, 20);

  const highScore = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 0,
    hasLocalSignals: true,
    fixCount: 0,
    googleGrades: null,
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: false
  });
  assert.equal(highScore, 100);
});

test('calculateOverallScore applies moderate trust/design penalty', () => {
  const score = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 0,
    hasLocalSignals: true,
    fixCount: 0,
    googleGrades: { seo: 90, performance: 90 },
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: false,
    trustDesignLevel: 'moderate'
  });
  assert.equal(score, 95);
});

test('calculateOverallScore applies weak trust/design penalty and thin+weak cap', () => {
  const score = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 0,
    hasLocalSignals: true,
    fixCount: 0,
    googleGrades: { seo: 95, performance: 95 },
    thinContent: true,
    repetitiveContent: false,
    weakTrustSignals: true,
    trustDesignLevel: 'weak'
  });
  assert.equal(score, 60);
});

test('assessTrustDesign returns weak level with multiple trust/design gaps', () => {
  const assessment = assessTrustDesign({
    html: '<html><body><h1>Services</h1><p>We are the best in the world.</p></body></html>',
    visibleText: 'We are the best in the world quality service guaranteed',
    trustSignalCount: 0,
    headingCount: 1,
    imageCount: 0,
    wordCount: 250
  });

  assert.equal(assessment.level, 'weak');
  assert.ok(Array.isArray(assessment.reasons));
  assert.ok(assessment.reasons.length >= 4);
});

test('assessTrustDesign returns stronger level when trust signals and structure exist', () => {
  const assessment = assessTrustDesign({
    html: '<html><body><h1>Roofing</h1><h2>Testimonials</h2><h2>Contact Us</h2><p>Licensed and insured team serving Branson.</p><p>Call now (417) 555-0100</p><p>Email info@example.com</p></body></html>',
    visibleText: 'Licensed insured years of experience serving Branson testimonials reviews call now request a quote',
    trustSignalCount: 5,
    headingCount: 4,
    imageCount: 3,
    wordCount: 420
  });

  assert.ok(['strong', 'moderate'].includes(assessment.level));
});

test('generateRecommendation returns Gold for weak conditions', () => {
  const recommendation = generateRecommendation({
    overallScore: 52,
    rankStatus: 'low',
    trustDesignLevel: 'weak',
    failCount: 9
  });
  assert.equal(recommendation.recommendedPlan, 'Gold');
});

test('generateRecommendation returns Silver for mid-tier conditions', () => {
  const recommendation = generateRecommendation({
    overallScore: 72,
    rankStatus: 'mid',
    trustDesignLevel: 'moderate',
    failCount: 5
  });
  assert.equal(recommendation.recommendedPlan, 'Silver');
});

test('generateRecommendation returns Platinum for strong baseline', () => {
  const recommendation = generateRecommendation({
    overallScore: 90,
    rankStatus: 'top',
    trustDesignLevel: 'strong',
    failCount: 2
  });
  assert.equal(recommendation.recommendedPlan, 'Platinum');
});

test('buildCompetitorQuery is deterministic for same inputs', () => {
  const input = {
    market: 'Branson MO',
    title: 'Best Roofing Company',
    h1Text: 'Residential Roofing Services',
    domainToken: 'acmeroofing'
  };
  assert.equal(buildCompetitorQuery(input), buildCompetitorQuery(input));
});

test('buildCompetitorQuery uses market when provided', () => {
  const query = buildCompetitorQuery({
    market: 'Branson MO',
    title: 'Expert Roofing Service',
    h1Text: '',
    domainToken: 'acme'
  });
  assert.equal(query, 'roofing Branson MO');
});

test('buildCompetitorQuery falls back to domain token when market missing', () => {
  const query = buildCompetitorQuery({
    market: '',
    title: 'Reliable Tree Removal',
    h1Text: '',
    domainToken: 'hollister'
  });
  assert.equal(query, 'tree service hollister');
});

test('buildCompetitorQuery returns non-empty query string with available data', () => {
  const query = buildCompetitorQuery({
    market: '',
    title: '',
    h1Text: 'General Services',
    domainToken: 'mybiz'
  });
  assert.ok(typeof query === 'string' && query.length > 0);
});

test('sanitizeCompetitorResults removes blanks, duplicates, and self matches', () => {
  const results = [
    { name: '  Acme Roofing  ', position: 1 },
    { name: 'Acme Roofing', position: 2 },
    { name: 'Trusted Roof Co', position: 3 },
    { name: ' ', position: 4 },
    { name: 'Branson Roofers LLC', position: 5 }
  ];

  const sanitized = sanitizeCompetitorResults(results, {
    domainToken: 'acme',
    businessHints: ['Acme Roofing', 'Acme Roofing Branson']
  });

  assert.deepEqual(sanitized, [
    { name: 'Trusted Roof Co', position: 1 },
    { name: 'Branson Roofers LLC', position: 2 }
  ]);
});

test('interpretVisibility maps top/mid/low/not_found and unknown fallback', () => {
  const top = interpretVisibility({ rankStatus: 'top' }, 90);
  const mid = interpretVisibility({ rankStatus: 'mid' }, 75);
  const low = interpretVisibility({ rankStatus: 'low' }, 80);
  const notFound = interpretVisibility({ rankStatus: 'not_found' }, 80);
  const unknownWeak = interpretVisibility({ rankStatus: 'unknown' }, 60);
  const unknownBetter = interpretVisibility({ rankStatus: 'unknown' }, 80);

  assert.equal(top.level, 'strong');
  assert.equal(mid.level, 'moderate');
  assert.equal(low.level, 'weak');
  assert.equal(notFound.level, 'weak');
  assert.equal(unknownWeak.level, 'weak');
  assert.equal(unknownBetter.level, 'unknown');
});

test('searchCompetitors returns safe empty array on provider failure', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('network down');
  };

  try {
    const results = await searchCompetitors('roofing branson mo');
    assert.deepEqual(results, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test('searchCompetitors returns safe empty array on unreliable scrape page', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    text: async () => '<html><body>Our systems have detected unusual traffic</body></html>'
  });

  try {
    const results = await searchCompetitors('roofing branson mo');
    assert.deepEqual(results, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test('searchCompetitors parses Google redirect result links', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    text: async () => `
      <html><body>
        <a href="/url?q=https%3A%2F%2Fexample-towing.com%2F&sa=U&ved=2ah">
          <h3>Example Towing</h3>
        </a>
        <a href="/url?q=https%3A%2F%2Fbranson-recovery.com%2F&sa=U&ved=2ah">
          <h3>Branson Recovery</h3>
        </a>
        <a href="/url?q=https%3A%2F%2Fozarktow.net%2F&sa=U&ved=2ah">
          <h3>Ozark Tow</h3>
        </a>
      </body></html>
    `
  });

  try {
    const results = await searchCompetitors('towing branson mo');
    assert.deepEqual(results.map((item) => ({
      name: item.name,
      host: item.host,
      position: item.position
    })), [
      { name: 'Example Towing', host: 'example-towing.com', position: 1 },
      { name: 'Branson Recovery', host: 'branson-recovery.com', position: 2 },
      { name: 'Ozark Tow', host: 'ozarktow.net', position: 3 }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('searchCompetitors keeps usable business rows even with dictionary-style result noise', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    text: async () => `
      <html><body>
        <a href="/url?q=https%3A%2F%2Fwww.iciba.com%2Fword%3Fw%3Dtowing&sa=U&ved=2ah">
          <h3>towing definition and meaning</h3>
        </a>
        <a href="/url?q=https%3A%2F%2Fexample-towing.com%2F&sa=U&ved=2ah">
          <h3>Example Towing</h3>
        </a>
        <a href="/url?q=https%3A%2F%2Fbranson-recovery.com%2F&sa=U&ved=2ah">
          <h3>Branson Recovery</h3>
        </a>
        <a href="/url?q=https%3A%2F%2Fozarktow.net%2F&sa=U&ved=2ah">
          <h3>Ozark Tow</h3>
        </a>
      </body></html>
    `
  });

  try {
    const results = await searchCompetitors('towing branson mo');
    assert.ok(results.some((item) => /example-towing\.com/i.test(item.host)));
    assert.ok(results.some((item) => /branson-recovery\.com/i.test(item.host)));
    assert.ok(results.some((item) => /ozarktow\.net/i.test(item.host)));
    assert.ok(results.length >= 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('searchCompetitors falls back to direct href result links', async () => {
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return { text: async () => '<html><body><div>No parsed results</div></body></html>' };
    }
    return {
      text: async () => `
        <html><body>
          <a href="https://first-towing.com/"><h3>First Towing</h3></a>
          <a href="https://second-towing.com/"><h3>Second Towing</h3></a>
          <a href="https://third-towing.com/"><h3>Third Towing</h3></a>
        </body></html>
      `
    };
  };

  try {
    const results = await searchCompetitors('towing branson mo');
    assert.deepEqual(results.map((item) => item.host), [
      'first-towing.com',
      'second-towing.com',
      'third-towing.com'
    ]);
    assert.equal(callCount, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('market audit falls back when google crawl returns no usable rows', async () => {
  await withSerpApiDisabled(async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const value = String(url || '');
      if (value.includes('google.com/search')) {
        return { text: async () => '<html><body>enable javascript</body></html>' };
      }
      if (value.includes('html.duckduckgo.com')) {
        return {
          text: async () => `
            <html><body>
              <a class="result__a" href="https://fallback-towing.com/">Fallback Towing</a>
              <a class="result__a" href="https://branson-wrecker.com/">Branson Wrecker</a>
              <a class="result__a" href="https://ozark-roadside.com/">Ozark Roadside</a>
            </body></html>
          `
        };
      }
      throw new Error(`Unexpected fetch: ${value}`);
    };

    try {
      const req = new Readable({ read() {} });
      req.url = '/api/audit?queryType=market&industry=Towing&city=Branson&state=MO&packageView=full_data';
      req.method = 'GET';
      req.headers = { host: '127.0.0.1' };

      let body = '';
      const res = new Writable({
        write(chunk, enc, cb) {
          body += chunk.toString();
          cb();
        }
      });
      res.writeHead = function (statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      };
      const completed = new Promise((resolve) => {
        res.end = function (chunk) {
          if (chunk) body += chunk.toString();
          resolve({
            statusCode: this.statusCode,
            headers: this.headers,
            body
          });
        };
      });

      await requestHandler(req, res);
      const response = await completed;
      const parsed = JSON.parse(response.body);
      const overview = parsed.dashboard.resultModel.industryAnalysis.overview;

      assert.equal(response.statusCode, 200);
      assert.equal(parsed.dashboard.dataQuality, 'estimated');
      assert.equal(parsed.dashboard.sourceNote, 'DuckDuckGo fallback (lower confidence)');
      assert.equal(overview.orderedResults.length, 3);
      assert.deepEqual(
        overview.orderedResults.map((item) => item.companyName).sort(),
        ['Branson Wrecker', 'Fallback Towing', 'Ozark Roadside'].sort()
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('market audit falls back to bing when google and duckduckgo fail', async () => {
  await withSerpApiDisabled(async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const value = String(url || '');
      if (value.includes('google.com/search')) {
        return { text: async () => '<html><body>enable javascript</body></html>' };
      }
      if (value.includes('html.duckduckgo.com')) {
        return { text: async () => '<html><body>enable javascript</body></html>' };
      }
      if (value.includes('bing.com/search')) {
        return {
          text: async () => `
            <html><body>
              <li class="b_algo"><h2><a href="https://bing-towing.com/">Bing Towing</a></h2></li>
              <li class="b_algo"><h2><a href="https://branson-bing-wrecker.com/">Branson Bing Wrecker</a></h2></li>
              <li class="b_algo"><h2><a href="https://ozark-bing-roadside.com/">Ozark Bing Roadside</a></h2></li>
            </body></html>
          `
        };
      }
      throw new Error(`Unexpected fetch: ${value}`);
    };

    try {
      const req = new Readable({ read() {} });
      req.url = '/api/audit?queryType=market&industry=Towing&city=Branson&state=MO&packageView=full_data';
      req.method = 'GET';
      req.headers = { host: '127.0.0.1' };

      let body = '';
      const res = new Writable({
        write(chunk, enc, cb) {
          body += chunk.toString();
          cb();
        }
      });
      res.writeHead = function (statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      };
      const completed = new Promise((resolve) => {
        res.end = function (chunk) {
          if (chunk) body += chunk.toString();
          resolve({
            statusCode: this.statusCode,
            headers: this.headers,
            body
          });
        };
      });

      await requestHandler(req, res);
      const response = await completed;
      const parsed = JSON.parse(response.body);
      const overview = parsed.dashboard.resultModel.industryAnalysis.overview;

      assert.equal(response.statusCode, 200);
      assert.equal(parsed.dashboard.dataQuality, 'estimated');
      assert.equal(parsed.dashboard.sourceNote, 'Bing fallback (lower confidence)');
      assert.equal(overview.orderedResults.length, 3);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('market audit request returns ranking rows when Google results are parsed', async () => {
  await withSerpApiDisabled(async () => {
    const originalFetch = global.fetch;
    const seenQueries = [];
    global.fetch = async (url) => {
      const value = String(url || '');
      if (value.includes('google.com/search')) {
        const parsed = new URL(value);
        seenQueries.push(parsed.searchParams.get('q'));
        return {
          text: async () => `
            <html><body>
              <a href="/url?q=https%3A%2F%2Fexample-towing.com%2F&sa=U"><h3>Example Towing</h3></a>
              <a href="/url?q=https%3A%2F%2Fbranson-recovery.com%2F&sa=U"><h3>Branson Recovery</h3></a>
              <a href="/url?q=https%3A%2F%2Fozarktow.net%2F&sa=U"><h3>Ozark Tow</h3></a>
            </body></html>
          `
        };
      }
      throw new Error(`Unexpected fetch: ${value}`);
    };

    try {
      const req = new Readable({ read() {} });
      req.url = '/api/audit?queryType=market&industry=Towing&city=Branson&state=MO&zip=65616&packageView=full_data';
      req.method = 'GET';
      req.headers = { host: '127.0.0.1' };

      let body = '';
      const res = new Writable({
        write(chunk, enc, cb) {
          body += chunk.toString();
          cb();
        }
      });
      res.writeHead = function (statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      };
      const completed = new Promise((resolve) => {
        res.end = function (chunk) {
          if (chunk) body += chunk.toString();
          resolve({
            statusCode: this.statusCode,
            headers: this.headers,
            body
          });
        };
      });

      await requestHandler(req, res);
      const response = await completed;
      const parsed = JSON.parse(response.body);
      const overview = parsed.dashboard.resultModel.industryAnalysis.overview;
      const orderedResults = overview.orderedResults;
      const rawOrderedResults = overview.rawOrderedResults;

      assert.equal(response.statusCode, 200);
      assert.equal(parsed.dashboard.dataQuality, 'estimated');
      assert.equal(parsed.dashboard.sourceNote, 'Google fallback (lower confidence)');
      assert.equal(parsed.dashboard.resultModel.input.zip, '65616');
      assert.ok(overview.querySampleCount >= 5);
      assert.equal(orderedResults.length, 3);
      assert.ok(rawOrderedResults.length >= orderedResults.length);
      assert.deepEqual(orderedResults.map((item) => item.rank), [1, 2, 3]);
      assert.equal(orderedResults[0].companyName, 'Example Towing');
      assert.equal(orderedResults[0].observedRank, 1);
      assert.match(orderedResults[0].observedQuery, /tow/i);
      assert.ok(orderedResults[0].consistencyCount >= 1);
      assert.match(orderedResults[0].whyRank, /Observed first at #1/);
      assert.ok(seenQueries.length >= 2);
      assert.ok(seenQueries.some((query) => /Towing Branson MO/i.test(query || '')));
      assert.ok(seenQueries.some((query) => /65616/i.test(query || '')));
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('market audit with SerpAPI returns Source SerpAPI and rows > 0', async () => {
  const fakeProvider = new FakeSerpProvider();
  const result = await runMarketOnlyAudit({
    industry: 'towing',
    city: 'Branson',
    state: 'MO',
    zip: '65616'
  }, {
    provider: fakeProvider
  });

  assert.match(result.sourceNote, /SerpAPI/i);
  assert.equal(result.dataQuality, 'real');

  const competitors = result.competitors || [];
  assert.ok(competitors.length > 0);

  const assets = result.marketAssets || [];
  assert.ok(assets.length > 0);

  const dirDomains = ['yelp.com', 'mapquest.com', 'bbb.org'];
  const leakedToCompetitors = competitors.filter((row) => dirDomains.includes(row.domain));
  assert.equal(leakedToCompetitors.length, 0);

  const capturedAsAssets = assets.filter((row) => dirDomains.includes(row.domain));
  assert.ok(capturedAsAssets.length > 0);

  const hasCrawfords = competitors.some((row) => row.domain === 'crawfordsautomotiveandtowing.com');
  assert.ok(hasCrawfords);

  const ordered = result.industryAnalysis?.overview?.orderedResults || [];
  const totalVisible = ordered.length + assets.length;
  assert.ok(totalVisible > 0);
});

test('getCompetitorSnapshot returns safe structure on malformed/unreliable source', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    text: async () => '<html><body>consent.google.com</body></html>'
  });

  try {
    const snapshot = await getCompetitorSnapshot('roofing branson mo', {
      domainToken: 'acme',
      businessHints: ['Acme Roofing']
    });
    assert.deepEqual(snapshot, {
      query: 'roofing branson mo',
      rankStatus: 'unknown',
      competitors: []
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('calculateOverallScore keeps backward compatibility via weakTrustSignals fallback', () => {
  const score = calculateOverallScore({
    h1Count: 1,
    grammarErrorCount: 0,
    hasLocalSignals: true,
    fixCount: 0,
    googleGrades: { seo: 90, performance: 90 },
    thinContent: false,
    repetitiveContent: false,
    weakTrustSignals: true
  });
  assert.equal(score, 85);
});

test('buildCompetitorQuery infers service type from title/h1 text', () => {
  const roofing = buildCompetitorQuery({
    market: 'Hollister MO',
    title: 'Emergency Roof Repair',
    h1Text: '',
    domainToken: 'acme'
  });
  const plumbing = buildCompetitorQuery({
    market: 'Springfield MO',
    title: '',
    h1Text: '24/7 Plumbing Services',
    domainToken: 'acme'
  });

  assert.equal(roofing, 'roofing Hollister MO');
  assert.equal(plumbing, 'plumber Springfield MO');
});

test('sanitizeCompetitorResults trims names and reindexes positions', () => {
  const sanitized = sanitizeCompetitorResults(
    [
      { name: '  First Competitor  ', position: 8 },
      { name: 'Second Competitor', position: 10 },
      { name: 'Third Competitor', position: 11 }
    ],
    { domainToken: 'notmatching', businessHints: [] }
  );

  assert.deepEqual(sanitized, [
    { name: 'First Competitor', position: 1 },
    { name: 'Second Competitor', position: 2 },
    { name: 'Third Competitor', position: 3 }
  ]);
});

test('getCompetitorSnapshot returns structured competitors with position', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    text: async () => `
      <html><body>
        <a href="/url?q=https%3A%2F%2Facme-roofing.com%2F&sa=U"><h3>Acme Roofing</h3></a>
        <a href="/url?q=https%3A%2F%2Ftrustedroofco.com%2F&sa=U"><h3>Trusted Roof Co</h3></a>
        <a href="/url?q=https%3A%2F%2Fbransonroofersllc.com%2F&sa=U"><h3>Branson Roofers LLC</h3></a>
        <a href="/url?q=https%3A%2F%2Ftrustedroofco.com%2F&sa=U"><h3>Trusted Roof Co</h3></a>
      </body></html>
    `
  });

  try {
    const snapshot = await getCompetitorSnapshot('roofing branson mo', {
      domainToken: 'acme',
      businessHints: ['Acme Roofing']
    });

    assert.equal(snapshot.query, 'roofing branson mo');
    assert.equal(snapshot.rankStatus, 'top');
    assert.deepEqual(snapshot.competitors, [
      { name: 'Trusted Roof Co', position: 1 },
      { name: 'Branson Roofers LLC', position: 2 }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('getCompetitorSnapshot returns unknown rankStatus when self listing cannot be inferred', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    text: async () => `
      <html><body>
        <a href="/url?q=https%3A%2F%2Ftrustedroofco.com%2F&sa=U"><h3>Trusted Roof Co</h3></a>
        <a href="/url?q=https%3A%2F%2Fbransonroofersllc.com%2F&sa=U"><h3>Branson Roofers LLC</h3></a>
        <a href="/url?q=https%3A%2F%2Fozarkroofing.com%2F&sa=U"><h3>Ozark Roofing</h3></a>
      </body></html>
    `
  });

  try {
    const snapshot = await getCompetitorSnapshot('roofing branson mo', {
      domainToken: 'acme',
      businessHints: ['Acme Roofing']
    });
    assert.equal(snapshot.rankStatus, 'unknown');
    assert.equal(snapshot.competitors.length, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('buildAuditRecord returns normalized shape with key fields', () => {
  const record = buildAuditRecord({
    contactName: '  Jane Smith ',
    businessName: '  Acme Services  ',
    businessEmail: ' SALES@ACME.COM ',
    phone: ' (555) 555-1212 ',
    industry: ' Roofing ',
    streetAddress: ' 123 Main St ',
    city: ' Branson ',
    state: ' MO ',
    competitorsInput: 'Competitor One\nCompetitor Two',
    bestContactTime: ' Afternoons ',
    followupConsent: 'true',
    website: ' https://acme.example ',
    market: '',
    auditResult: {
      finalUrl: 'https://acme.example/home',
      scores: { overall: 71, seo: 70, ai: 68, geo: 75 },
      visibility: { level: 'moderate', message: 'Some visibility.' },
      trustDesign: { level: 'moderate', reasons: ['Missing proof language.'] },
      recommendation: { recommendedPlan: 'Silver', projection: 'Improve core gaps.', message: 'Action needed.' },
      searchSnapshot: { query: 'roofing Branson MO', rankStatus: 'mid', competitors: [{ name: 'X', position: 1 }] },
      topFixes: ['Fix H1'],
      summary: '  Missing leads due to trust issues.  '
    },
    purchasedPackage: 'silver',
    amountPaid: 199
  });

  assert.ok(record.id.startsWith('aud_'));
  assert.equal(record.auditId, record.id);
  assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(record.contactName, 'Jane Smith');
  assert.equal(record.businessName, 'Acme Services');
  assert.equal(record.businessEmail, 'sales@acme.com');
  assert.equal(record.phone, '(555) 555-1212');
  assert.equal(record.industry, 'Roofing');
  assert.equal(record.streetAddress, '123 Main St');
  assert.equal(record.city, 'Branson');
  assert.equal(record.state, 'MO');
  assert.deepEqual(record.competitorsInput, ['Competitor One', 'Competitor Two']);
  assert.equal(record.bestContactTime, 'Afternoons');
  assert.equal(record.followupConsent, true);
  assert.equal(record.followupStatus, 'pending');
  assert.equal(record.company, 'Acme Services');
  assert.equal(record.email, 'sales@acme.com');
  assert.equal(record.website, 'https://acme.example');
  assert.equal(record.market, 'Branson, MO');
  assert.equal(record.finalUrl, 'https://acme.example/home');
  assert.deepEqual(record.scores, { overall: 71, seo: 70, ai: 68, geo: 75 });
  assert.deepEqual(record.topFixes, ['Fix H1']);
  assert.equal(record.summary, 'Missing leads due to trust issues.');
  assert.equal(record.visibility.level, 'moderate');
  assert.equal(record.trustDesign.level, 'moderate');
  assert.equal(record.recommendation.recommendedPlan, 'Silver');
  assert.equal(record.searchSnapshot.rankStatus, 'mid');
  assert.equal(record.purchasedPackage, 'silver');
  assert.equal(record.amountPaid, 199);
  assert.deepEqual(record.upgradeCreditAvailable, { towardPackage: 'gold', amount: 199 });
  assert.match(record.reportLink, /\/api\/audit-report\?id=/);
  assert.match(record.reportDownloadLink, /\/api\/audit-report\/download\?id=/);
  assert.ok(record.customerResult && typeof record.customerResult === 'object');
  assert.ok(record.fullAuditResult && typeof record.fullAuditResult === 'object');
});

test('normalizePackageLevel maps known values and defaults to free', () => {
  assert.equal(normalizePackageLevel('free'), 'free');
  assert.equal(normalizePackageLevel('silver'), 'silver');
  assert.equal(normalizePackageLevel('gold'), 'gold');
  assert.equal(normalizePackageLevel('admin'), 'admin');
  assert.equal(normalizePackageLevel('audit'), 'free');
  assert.equal(normalizePackageLevel('unknown'), 'free');
});

test('resolveAmountPaid uses provided amount or package default', () => {
  assert.equal(resolveAmountPaid('123.45', 'silver'), 123.45);
  assert.equal(resolveAmountPaid('', 'silver'), 199);
  assert.equal(resolveAmountPaid(null, 'gold'), 399);
  assert.equal(resolveAmountPaid(undefined, 'free'), 0);
});

test('buildUpgradeCreditAvailable returns tiered credit model', () => {
  assert.deepEqual(buildUpgradeCreditAvailable('silver', 199), { towardPackage: 'gold', amount: 199 });
  assert.deepEqual(buildUpgradeCreditAvailable('gold', 399), { towardPackage: 'platinum', amount: 399 });
  assert.deepEqual(buildUpgradeCreditAvailable('free', 0), { towardPackage: null, amount: 0 });
});

test('normalizeCompetitorInput parses and caps competitor entries', () => {
  assert.deepEqual(
    normalizeCompetitorInput('Comp A, Comp B\nComp C\nComp D'),
    ['Comp A', 'Comp B', 'Comp C']
  );
});

test('buildReportLinks generates report and download paths', () => {
  const links = buildReportLinks('aud_123');
  assert.equal(links.reportPath, '/api/audit-report?id=aud_123');
  assert.equal(links.downloadPath, '/api/audit-report/download?id=aud_123');
});

test('countQuickWins counts one-day fix opportunities', () => {
  const checks = [
    { key: 'h1', status: 'FIX' },
    { key: 'meta-description', status: 'FIX' },
    { key: 'thin-content', status: 'FIX' },
    { key: 'sitemap', status: 'PASS' },
    { key: 'faq-citation', status: 'FIX' }
  ];
  assert.equal(countQuickWins(checks), 3);
});

test('estimateShortTermLift estimates range from easy fixes only', () => {
  const checks = [
    { key: 'h1', status: 'FIX' },
    { key: 'meta-description', status: 'FIX' },
    { key: 'og-tags', status: 'FIX' },
    { key: 'faq-citation', status: 'FIX' },
    { key: 'thin-content', status: 'FIX' }
  ];
  assert.deepEqual(estimateShortTermLift(checks), { min: 4, max: 8 });
});

test('filterAuditResultByPackage enforces free/silver/gold/admin visibility', () => {
  const full = {
    finalUrl: 'https://acme.example',
    summary: 'summary',
    scores: { overall: 70, seo: 65, ai: 66, geo: 68 },
    googleGrades: { seo: 70, performance: 50, bestPractices: 80, accessibility: 75 },
    googleGradesDebug: null,
    googleGradesMessage: null,
    issueCount: 7,
    quickWinCount: 4,
    estimatedShortTermLift: { min: 6, max: 12 },
    checks: [{ key: 'h1', status: 'FIX', message: 'Use one H1' }],
    trustDesign: { level: 'moderate' },
    visibility: { level: 'moderate', message: 'ok' },
    searchSnapshot: { query: 'roofing branson', competitors: [] },
    recommendation: { recommendedPlan: 'Silver' },
    topFixes: ['Fix H1'],
    fullDiagnosis: [{ key: 'h1', diagnosis: 'issue' }],
    issueSolutions: [{ key: 'h1', solution: 'fix' }],
    implementationRoadmap: [{ step: 1, title: 'Do thing' }],
    prioritizedActionPlan: [{ priority: 1, action: 'Do thing' }]
  };

  const free = filterAuditResultByPackage(full, 'free');
  assert.equal(free.packageLevel, 'free');
  assert.equal(Array.isArray(free.checks), true);
  assert.equal(free.checks.length, 1);
  assert.equal(free.summary, 'summary');

  const silver = filterAuditResultByPackage(full, 'silver');
  assert.equal(silver.packageLevel, 'silver');
  assert.equal(Array.isArray(silver.checks), true);
  assert.equal(Array.isArray(silver.implementationRoadmap), false);
  assert.equal(silver.recommendation.recommendedPlan, 'Silver');

  const gold = filterAuditResultByPackage(full, 'gold');
  assert.equal(gold.packageLevel, 'gold');
  assert.equal(Array.isArray(gold.implementationRoadmap), true);
  assert.equal(Array.isArray(gold.prioritizedActionPlan), true);
  assert.deepEqual(gold.estimatedShortTermLift, { min: 6, max: 12 });

  const admin = filterAuditResultByPackage(full, 'admin');
  assert.equal(admin.packageLevel, 'admin');
  assert.equal(Array.isArray(admin.checks), true);
  assert.equal(Array.isArray(admin.implementationRoadmap), true);
});

test('runAudit supports quick URL-only flow and returns auto-detected site profile', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith('https://example.com')) {
      return {
        ok: true,
        status: 200,
        url: 'https://example.com/',
        text: async () => `
          <html>
            <head>
              <title>Acme Roofing | Roof Repair in Dallas, TX</title>
              <meta name="description" content="Trusted roofing and roof repair services in Dallas, TX. Call today." />
              <meta property="og:title" content="Acme Roofing" />
              <meta property="og:description" content="Roof repair and replacement." />
              <link rel="canonical" href="https://example.com/" />
            </head>
            <body>
              <h1>Acme Roofing</h1>
              <p>Roofing services and roof repair across Dallas, TX.</p>
              <p>Call (214) 555-1212 or email info@example.com.</p>
              <a href="/contact">Contact</a>
              <a href="/services">Services</a>
            </body>
          </html>
        `
      };
    }
    if (target.includes('google.com/search')) {
      return {
        ok: true,
        status: 200,
        text: async () => '<html><body>consent.google.com</body></html>'
      };
    }
    if (target.includes('languagetool.org')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ matches: [] })
      };
    }
    if (target.includes('pagespeedonline')) {
      return {
        ok: false,
        status: 429,
        json: async () => ({})
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ matches: [] })
    };
  };

  try {
    const result = await runAudit('example.com');
    assert.equal(result.auditMode, 'business');
    assert.equal(result.searchSnapshot.querySource, 'auto');
    assert.ok(result.siteProfile);
    assert.equal(result.siteProfile.businessName, 'Acme Roofing');
    assert.equal(result.siteProfile.h1, 'Acme Roofing');
    assert.equal(result.siteProfile.contactSignals.phone, true);
    assert.equal(result.siteProfile.contactSignals.email, true);
    assert.ok(Array.isArray(result.siteProfile.visibleServiceKeywords));
    assert.ok(result.siteProfile.visibleServiceKeywords.includes('roofing'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('runAudit uses manual search query override for competitor discovery', async () => {
  const originalFetch = global.fetch;
  let capturedSearchUrl = '';
  global.fetch = async (url) => {
    const target = String(url);
    if (target.startsWith('https://example.com')) {
      return {
        ok: true,
        status: 200,
        url: 'https://example.com/',
        text: async () => '<html><head><title>Example</title></head><body><h1>Example</h1></body></html>'
      };
    }
    if (target.includes('google.com/search')) {
      capturedSearchUrl = target;
      return {
        ok: true,
        status: 200,
        text: async () => '<html><body>consent.google.com</body></html>'
      };
    }
    if (target.includes('languagetool.org')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ matches: [] })
      };
    }
    if (target.includes('pagespeedonline')) {
      return {
        ok: false,
        status: 429,
        json: async () => ({})
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ matches: [] })
    };
  };

  try {
    const result = await runAudit('example.com', { searchQuery: 'best roofing contractor dallas tx' });
    assert.equal(result.searchSnapshot.query, 'best roofing contractor dallas tx');
    assert.equal(result.searchSnapshot.querySource, 'manual');
    assert.match(capturedSearchUrl, /best%20roofing%20contractor%20dallas%20tx/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('generateLocalIntentQueries returns localized high-intent queries', () => {
  const queries = generateLocalIntentQueries({
    industry: 'plumber',
    city: 'Branson',
    state: 'MO',
    businessCategory: '',
    businessName: 'Acme Plumbing',
    market: '',
    siteProfile: {}
  });
  assert.equal(queries.length, 3);
  assert.ok(queries.some((q) => /branson/i.test(q)));
  assert.ok(queries.every((q) => /plumb|drain|water heater/i.test(q)));
});

test('filterLocalSearchVisibilityByPackage enforces free/silver/gold exposure', () => {
  const local = {
    status: 'ok',
    generatedQueries: ['q1', 'q2', 'q3', 'q4', 'q5'],
    results: [{
      query: 'q1',
      location: 'Branson, MO',
      timestamp: '2026-01-01T00:00:00.000Z',
      organicResults: [{ position: 1, title: 'A', domain: 'a.com', url: 'https://a.com' }],
      localPackResults: [{ position: 2, title: 'B', domain: 'b.com', url: 'https://b.com' }],
      clientFoundOrganic: true,
      clientOrganicRank: 3,
      clientFoundLocalPack: false,
      clientLocalPackRank: null,
      screenshotUrl: 'https://example.com/s.png',
      screenshotPath: '/tmp/s.png',
      topCompetitorDomains: ['a.com', 'b.com'],
      takeaway: 'x'
    }],
    competitorsByFrequency: [{ domain: 'a.com', count: 3 }],
    topRecurringCompetitors: [{ domain: 'a.com', count: 3 }],
    competitorAppearanceMatrix: { 'a.com': { 'query-1': 1 } },
    summary: {
      foundInOrganicCount: 1,
      foundInLocalPackCount: 0,
      missingCount: 4,
      recurringCompetitors: [{ domain: 'a.com', count: 3 }],
      visibilityScore: 42
    }
  };
  const free = filterLocalSearchVisibilityByPackage(local, 'free');
  assert.equal(Array.isArray(free.results), false);
  assert.equal(free.summary.visibilityScore, 42);

  const silver = filterLocalSearchVisibilityByPackage(local, 'silver');
  assert.equal(Array.isArray(silver.results), true);
  assert.equal(silver.results[0].screenshotUrl, undefined);
  assert.equal(Array.isArray(silver.topRecurringCompetitors), true);

  const gold = filterLocalSearchVisibilityByPackage(local, 'gold');
  assert.equal(Array.isArray(gold.results), true);
  assert.equal(gold.results[0].screenshotUrl, 'https://example.com/s.png');
  assert.equal(Array.isArray(gold.competitorsByFrequency), true);
});

test('saveAuditRecord creates file when missing and saves first record', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-audit-'));
  const filePath = path.join(tmpRoot, 'data', 'audits.json');
  const record = {
    id: 'aud_test_1',
    createdAt: '2026-03-31T00:00:00.000Z',
    company: 'Acme',
    email: 'a@acme.com',
    website: 'https://acme.com',
    market: 'Branson MO',
    finalUrl: 'https://acme.com',
    scores: { overall: 70 },
    visibility: { level: 'unknown', message: 'Unknown' },
    trustDesign: { level: 'moderate', reasons: [] },
    recommendation: { recommendedPlan: 'Silver', projection: 'Improve', message: 'Improve' },
    searchSnapshot: { query: 'q', rankStatus: 'unknown', competitors: [] },
    topFixes: [],
    summary: 'Summary'
  };

  try {
    const result = await saveAuditRecord(record, { filePath });
    assert.deepEqual(result, { saved: true, auditId: 'aud_test_1' });

    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'aud_test_1');
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('saveAuditRecord appends records safely', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-audit-'));
  const filePath = path.join(tmpRoot, 'audits.json');
  const first = { id: 'aud_test_a' };
  const second = { id: 'aud_test_b' };

  try {
    const firstResult = await saveAuditRecord(first, { filePath });
    const secondResult = await saveAuditRecord(second, { filePath });

    assert.deepEqual(firstResult, { saved: true, auditId: 'aud_test_a' });
    assert.deepEqual(secondResult, { saved: true, auditId: 'aud_test_b' });

    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].id, 'aud_test_a');
    assert.equal(parsed[1].id, 'aud_test_b');
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('saveAuditRecord persists package purchase and upgrade credit fields', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-audit-'));
  const filePath = path.join(tmpRoot, 'audits.json');
  const record = {
    id: 'aud_pkg_1',
    purchasedPackage: 'gold',
    amountPaid: 399,
    upgradeCreditAvailable: { towardPackage: 'platinum', amount: 399 }
  };

  try {
    const result = await saveAuditRecord(record, { filePath });
    assert.deepEqual(result, { saved: true, auditId: 'aud_pkg_1' });

    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].purchasedPackage, 'gold');
    assert.equal(parsed[0].amountPaid, 399);
    assert.deepEqual(parsed[0].upgradeCreditAvailable, { towardPackage: 'platinum', amount: 399 });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('saveAuditRecord persists full lead intake shape for follow-up', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-audit-'));
  const filePath = path.join(tmpRoot, 'audits.json');
  const record = {
    id: 'aud_lead_1',
    auditId: 'aud_lead_1',
    contactName: 'Jane',
    businessName: 'Acme',
    businessEmail: 'jane@acme.com',
    phone: '555-1212',
    industry: 'Roofing',
    streetAddress: '123 Main',
    city: 'Branson',
    state: 'MO',
    competitorsInput: ['Comp A', 'Comp B'],
    followupConsent: true,
    followupStatus: 'pending',
    reportLink: '/api/audit-report?id=aud_lead_1',
    reportDownloadLink: '/api/audit-report/download?id=aud_lead_1',
    recommendation: { recommendedPlan: 'Gold' },
    scores: { overall: 72 },
    fullAuditResult: { summary: 'full' }
  };

  try {
    const result = await saveAuditRecord(record, { filePath });
    assert.deepEqual(result, { saved: true, auditId: 'aud_lead_1' });
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(parsed[0].contactName, 'Jane');
    assert.equal(parsed[0].businessName, 'Acme');
    assert.equal(parsed[0].businessEmail, 'jane@acme.com');
    assert.equal(parsed[0].city, 'Branson');
    assert.equal(parsed[0].state, 'MO');
    assert.equal(parsed[0].reportLink, '/api/audit-report?id=aud_lead_1');
    assert.equal(parsed[0].recommendation.recommendedPlan, 'Gold');
    assert.equal(parsed[0].scores.overall, 72);
    assert.equal(parsed[0].fullAuditResult.summary, 'full');
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('saveAuditRecord fails gracefully on write error', async () => {
  const fsApi = {
    mkdir: async () => {},
    readFile: async () => {
      const err = new Error('missing');
      err.code = 'ENOENT';
      throw err;
    },
    writeFile: async () => {
      throw new Error('disk full');
    },
    rename: async () => {},
    unlink: async () => {}
  };

  const result = await saveAuditRecord({ id: 'aud_fail_1' }, {
    filePath: '/tmp/does-not-matter/audits.json',
    fsApi
  });

  assert.equal(result.saved, false);
  assert.equal(result.auditId, 'aud_fail_1');
  assert.match(result.error, /disk full/i);
});

test('buildAuditReportHtml includes key audit sections and fields', () => {
  const html = buildAuditReportHtml({
    id: 'aud_123',
    createdAt: '2026-03-31T12:00:00.000Z',
    company: 'Acme Services',
    website: 'https://acme.example',
    market: 'Branson, MO',
    summary: 'You are likely missing leads due to visibility and trust issues.',
    scores: { overall: 67, seo: 62, ai: 70, geo: 65 },
    visibility: { level: 'moderate', message: 'Some visibility exists.' },
    trustDesign: { level: 'weak', reasons: ['Proof elements are missing.'] },
    recommendation: { recommendedPlan: 'Gold', message: 'Use a deeper plan.', projection: 'Increase trust and visibility.' },
    searchSnapshot: {
      query: 'roofing Branson MO',
      rankStatus: 'mid',
      competitors: [{ name: 'Trusted Roof Co', position: 1 }]
    },
    topFixes: ['Use a single clear H1'],
    purchasedPackage: 'gold',
    localSearchVisibility: {
      summary: {
        foundInOrganicCount: 2,
        foundInLocalPackCount: 1,
        missingCount: 2,
        totalQueries: 5,
        topCompetitorAppearanceCount: 4,
        interpretation: 'Customers are seeing your competitors before they see you.'
      },
      results: [{
        query: 'roofer in Branson MO',
        clientFoundOrganic: true,
        clientOrganicRank: 4,
        clientFoundLocalPack: false,
        clientLocalPackRank: null,
        topCompetitorDomains: ['a.com', 'b.com', 'c.com'],
        organicResults: [{ position: 1, domain: 'a.com' }, { position: 2, domain: 'b.com' }, { position: 3, domain: 'c.com' }],
        screenshotUrl: 'https://example.com/local.png'
      }],
      topRecurringCompetitors: [{ domain: 'a.com', count: 4 }]
    }
  });

  assert.match(html, /GeoNeo AI Audit Report/i);
  assert.match(html, /Reference ID:\s*aud_123/i);
  assert.match(html, /Acme Services/);
  assert.match(html, /https:\/\/acme\.example/);
  assert.match(html, /Branson, MO/);
  assert.match(html, /Overall/);
  assert.match(html, /67\/100/);
  assert.match(html, /Real World Search Audit/);
  assert.match(html, /Recommended Plan/);
  assert.match(html, /Top Competitors/);
  assert.match(html, /Where You Rank in Your Area|Your Visibility in Branson, MO/);
  assert.match(html, /Found in Top 10:[\s\S]*2\s*\/\s*5/i);
  assert.match(html, /Rankings/i);
  assert.match(html, /View Screenshot/i);
  assert.match(html, /No high-priority fixes were detected in this run.|Use a single clear H1/);
});

test('buildAuditReportHtml local ranking section only shows summary for basic package', () => {
  const html = buildAuditReportHtml({
    id: 'aud_124',
    createdAt: '2026-03-31T12:00:00.000Z',
    company: 'Acme Services',
    website: 'https://acme.example',
    market: 'Branson, MO',
    purchasedPackage: 'free',
    localSearchVisibility: {
      summary: {
        foundInOrganicCount: 1,
        foundInLocalPackCount: 0,
        missingCount: 4,
        totalQueries: 5,
        topCompetitorAppearanceCount: 4
      },
      results: [{
        query: 'roofing branson',
        clientFoundOrganic: false,
        topCompetitorDomains: ['x.com', 'y.com']
      }]
    },
    topFixes: []
  });

  assert.match(html, /Found in Top 10:[\s\S]*1\s*\/\s*5/i);
  assert.match(html, /Upgrade to Silver to unlock rankings and competitor-by-query detail/i);
  assert.doesNotMatch(html, /Per-Search Breakdown/i);
});

test('getAuditRecordById returns matching record from saved audits', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-record-'));
  const filePath = path.join(tmpRoot, 'audits.json');

  try {
    await fs.writeFile(filePath, JSON.stringify([
      { id: 'aud_a', company: 'A' },
      { id: 'aud_b', company: 'B' }
    ]), 'utf8');

    const record = await getAuditRecordById('aud_b', { filePath });
    assert.deepEqual(record, { id: 'aud_b', company: 'B' });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('getAuditRecordById handles not-found safely', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-record-'));
  const filePath = path.join(tmpRoot, 'audits.json');

  try {
    await fs.writeFile(filePath, JSON.stringify([{ id: 'aud_x', company: 'X' }]), 'utf8');

    const missing = await getAuditRecordById('aud_missing', { filePath });
    assert.equal(missing, null);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('loadAuditRecords returns empty array when file is missing', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geoneo-record-'));
  const filePath = path.join(tmpRoot, 'does-not-exist.json');

  try {
    const records = await loadAuditRecords({ filePath });
    assert.deepEqual(records, []);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('isNeoClubMember only grants access for gold and admin', () => {
  assert.equal(isNeoClubMember('gold'), true);
  assert.equal(isNeoClubMember('admin'), true);
  assert.equal(isNeoClubMember('silver'), false);
  assert.equal(isNeoClubMember('free'), false);
});

test('buildNeoClubPayload returns locked preview for non-gold package', () => {
  const payload = buildNeoClubPayload({ packageLevel: 'silver', source: 'session' });

  assert.equal(payload.membership.isMember, false);
  assert.equal(payload.membership.packageLevel, 'silver');
  assert.equal(payload.membership.requiredPackage, 'gold');
  assert.ok(Array.isArray(payload.lockedPreview.benefits));
  assert.equal(payload.lockedPreview.ctaLabel, 'Upgrade to Gold ($199)');
  assert.ok(payload.neoClub.weeklyStrategies.length <= 1);
});

test('buildNeoClubPayload returns full content for gold package', () => {
  const payload = buildNeoClubPayload({ packageLevel: 'gold', auditId: 'aud_neo' });

  assert.equal(payload.membership.isMember, true);
  assert.equal(payload.membership.auditId, 'aud_neo');
  assert.ok(Array.isArray(payload.neoClub.weeklyStrategies));
  assert.ok(payload.neoClub.weeklyStrategies.length >= 2);
  assert.ok(Array.isArray(payload.neoClub.expertTopics));
  assert.ok(payload.neoClub.expertTopics.length >= 6);
});
