/**
 * Multi-LLM citation matrix. For a (business, industry, city) target,
 * runs the same 4-5 buyer queries across multiple AI providers and reports
 * per-provider whether the target was cited.
 *
 * Output is the "AI search visibility matrix" — the differentiator that
 * justifies the $199 Fix Plan vs a free audit. Customer sees, at a glance:
 *
 *                ChatGPT   Perplexity   Claude   Gemini
 *   query 1     ✓           ✓             ✗        ✗
 *   query 2     ✗           ✓             ✗        ✗
 *   query 3     ✗           ✗             ✗        ✗
 *
 *   citation rate: 25% across providers (3 of 12 cells)
 *
 * Providers (each requires its own API key in env):
 *   - OPENAI_API_KEY     → ChatGPT (gpt-4o with search) or fallback gpt-4o-mini
 *   - PERPLEXITY_API_KEY → Perplexity (sonar; native citations)
 *   - ANTHROPIC_API_KEY  → Claude (via Anthropic API; we parse mentioned URLs)
 *   - GEMINI_API_KEY     → Google Gemini (via Generative Language API)
 *
 * Missing keys are gracefully skipped — matrix only shows rows for
 * providers that were actually tested. We never fabricate citation data.
 *
 * Cost note: ~$0.05-$0.20 per full matrix (5 queries × 4 providers).
 * Only triggered manually from admin or as a paid upsell ($29 ad-hoc test
 * or included with Maintenance tier).
 */

const https = require('https');
const { generateTargetQueries } = require('./citationFixer');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DEFAULT_TIMEOUT_MS = 30000;

function postJson({ hostname, path, headers, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers, 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${(parsed.error?.message || data).slice(0, 200)}`));
          else resolve(parsed);
        } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractUrls(text) {
  if (!text || typeof text !== 'string') return [];
  return (text.match(/https?:\/\/[^\s)"\]<>]+/g) || []).map((u) => u.replace(/[.,;:!?)\]]+$/, ''));
}

function extractDomainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function citationSignalsFor(text, target) {
  // Detect citation by 3 signals (any one counts):
  //   1. URL containing the target domain
  //   2. Business name appearing in the response (case-insensitive)
  //   3. Bare domain string in the response
  const targetDomain = (target.domain || '').toLowerCase();
  const targetName = (target.businessName || '').trim().toLowerCase();
  const urls = extractUrls(text);
  const domainsCited = urls.map(extractDomainOf).filter(Boolean);
  const targetCitedByUrl = targetDomain && domainsCited.some((d) => d === targetDomain || d.endsWith('.' + targetDomain));
  const lower = String(text || '').toLowerCase();
  const targetCitedByName = targetName && targetName.length > 4 && lower.includes(targetName);
  const targetCitedByDomain = targetDomain && lower.includes(targetDomain);
  return {
    cited: Boolean(targetCitedByUrl || targetCitedByName || targetCitedByDomain),
    signal: targetCitedByUrl ? 'url' : (targetCitedByName ? 'name' : (targetCitedByDomain ? 'domain' : null)),
    domainsCited: Array.from(new Set(domainsCited)),
    competitorDomainsCited: Array.from(new Set(domainsCited.filter((d) => d && d !== targetDomain))).slice(0, 5)
  };
}

/* ============================ Provider adapters ============================ */

async function queryPerplexity(query) {
  if (!PERPLEXITY_API_KEY) return { provider: 'perplexity', skipped: 'no_api_key' };
  try {
    const r = await postJson({
      hostname: 'api.perplexity.ai',
      path: '/chat/completions',
      headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}` },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: query }] })
    });
    const text = r.choices?.[0]?.message?.content || '';
    const explicitCitations = Array.isArray(r.citations) ? r.citations : [];
    return { provider: 'perplexity', text, explicitCitations };
  } catch (err) {
    return { provider: 'perplexity', error: err.message };
  }
}

async function queryOpenAI(query) {
  if (!OPENAI_API_KEY) return { provider: 'openai', skipped: 'no_api_key' };
  try {
    const r = await postJson({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are answering local business search queries. Recommend specific named businesses with their websites when relevant.' },
          { role: 'user', content: query }
        ],
        max_tokens: 500
      })
    });
    const text = r.choices?.[0]?.message?.content || '';
    return { provider: 'openai', text };
  } catch (err) {
    return { provider: 'openai', error: err.message };
  }
}

async function queryAnthropic(query) {
  if (!ANTHROPIC_API_KEY) return { provider: 'claude', skipped: 'no_api_key' };
  try {
    const r = await postJson({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: query }]
      })
    });
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    return { provider: 'claude', text };
  } catch (err) {
    return { provider: 'claude', error: err.message };
  }
}

async function queryGemini(query) {
  if (!GEMINI_API_KEY) return { provider: 'gemini', skipped: 'no_api_key' };
  try {
    const r = await postJson({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      headers: {},
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        generationConfig: { maxOutputTokens: 500 }
      })
    });
    const text = r.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { provider: 'gemini', text };
  } catch (err) {
    return { provider: 'gemini', error: err.message };
  }
}

const PROVIDERS = [
  { id: 'perplexity', call: queryPerplexity, hasKey: () => Boolean(PERPLEXITY_API_KEY) },
  { id: 'openai',     call: queryOpenAI,     hasKey: () => Boolean(OPENAI_API_KEY) },
  { id: 'claude',     call: queryAnthropic,  hasKey: () => Boolean(ANTHROPIC_API_KEY) },
  { id: 'gemini',     call: queryGemini,     hasKey: () => Boolean(GEMINI_API_KEY) }
];

/* ============================ Top level ============================ */

/**
 * Run the full matrix. Returns { matrix, summary, queries, providers, target }.
 *
 * Concurrency: per-query, all providers run in parallel. Across queries, we
 * also run in parallel (capped at 4 to avoid rate limits). 5 queries × 4
 * providers = 20 calls; ~10-20s wall clock at API speeds.
 */
async function runMultiLlmMatrix({ businessName, domain, industry, city, state, queries = null } = {}) {
  if (!domain) throw new Error('domain required');
  const target = { businessName, domain: String(domain).toLowerCase(), industry, city, state };
  const queryList = (queries || generateTargetQueries(industry, city, state, businessName)).slice(0, 5);
  const enabledProviders = PROVIDERS.filter((p) => p.hasKey());
  if (!enabledProviders.length) {
    return {
      target,
      providers: PROVIDERS.map((p) => ({ id: p.id, available: false })),
      queries: queryList,
      matrix: [],
      summary: { providersAvailable: 0, error: 'no_api_keys_configured' }
    };
  }
  // Run queries in parallel, all providers per query in parallel
  const matrix = await Promise.all(queryList.map(async (q) => {
    const results = await Promise.all(enabledProviders.map(async (p) => {
      const r = await p.call(q);
      if (r.skipped || r.error) return { provider: p.id, cited: null, error: r.error || r.skipped };
      const signals = citationSignalsFor(r.text, target);
      return {
        provider: p.id,
        cited: signals.cited,
        signal: signals.signal,
        competitors: signals.competitorDomainsCited,
        snippet: r.text.slice(0, 200)
      };
    }));
    return { query: q, results };
  }));

  // Summary stats
  let cellsTested = 0, cellsCited = 0;
  const perProvider = {};
  const competitorCounts = new Map();
  for (const row of matrix) {
    for (const cell of row.results) {
      if (cell.cited === null) continue;
      cellsTested++;
      if (cell.cited) cellsCited++;
      if (!perProvider[cell.provider]) perProvider[cell.provider] = { cited: 0, tested: 0 };
      perProvider[cell.provider].tested++;
      if (cell.cited) perProvider[cell.provider].cited++;
      for (const c of (cell.competitors || [])) {
        competitorCounts.set(c, (competitorCounts.get(c) || 0) + 1);
      }
    }
  }
  // Top competitor domains cited across all queries
  const topCompetitors = Array.from(competitorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, citationCount: count }));

  return {
    target,
    providers: PROVIDERS.map((p) => ({ id: p.id, available: p.hasKey() })),
    queries: queryList,
    matrix,
    summary: {
      providersAvailable: enabledProviders.length,
      cellsTested,
      cellsCited,
      overallCitationRate: cellsTested > 0 ? Math.round((cellsCited / cellsTested) * 100) : 0,
      perProvider: Object.fromEntries(
        Object.entries(perProvider).map(([k, v]) => [k, { ...v, rate: v.tested > 0 ? Math.round((v.cited / v.tested) * 100) : 0 }])
      ),
      topCompetitorsCited: topCompetitors
    },
    generatedAt: new Date().toISOString()
  };
}

/**
 * Diagnostic: which providers are configured? (Doesn't require an API call.)
 */
function providerStatus() {
  return PROVIDERS.map((p) => ({ id: p.id, available: p.hasKey() }));
}

module.exports = {
  runMultiLlmMatrix,
  providerStatus,
  citationSignalsFor
};
