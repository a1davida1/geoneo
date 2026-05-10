/**
 * Deep Audit Orchestrator — fans out parallel calls to every sub-analyzer,
 * stamps dollar lift onto every finding, and consolidates into one
 * canonical audit response.
 *
 * The audit response shape is the single source of truth — Free tier UI,
 * paid tier UI, closer sheet, member dashboard, and email composer all read
 * from this same shape (with tier filtering applied to fixes only, never
 * findings).
 *
 * NO LLM in the orchestrator. Sub-analyzers may use measurement-only LLM
 * calls (multi-LLM citation matrix) but never generation.
 */

const { analyzeSchemas, generateSchemaForType } = require('./schemaAnalyzer');
const { analyzeEeat } = require('./eeatAnalyzer');
const { analyzeGeo, generateLlmsTxt } = require('./geoAnalyzer');
const { analyzeSitemap } = require('./sitemapValidator');
const { analyzeNap } = require('./napChecker');
const { analyzeImages } = require('./imageAuditor');
const { estimateForFinding, estimateSpecificLoss } = require('./dollarLiftEngine');

const SECTION_TIMEOUT_MS = 8000;

async function withTimeout(promise, ms, label) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]).catch(err => ({ status: 'error', error: err.message }));
}

/**
 * Run the full deep audit on a fetched HTML page.
 * Inputs already-fetched HTML, robots.txt, llms.txt — orchestrator doesn't fetch.
 */
async function runDeepAudit(input = {}) {
  const {
    html = '',
    finalUrl = '',
    robotsTxt = '',
    llmsTxtContent = null,
    llmsFullTxtContent = null,
    industry = '',
    city = '',
    state = '',
    businessFacts = {},
    serpContext = null,
    sitemapXml = null
  } = input;

  const sectionStart = Date.now();
  const [schemaResult, eeatResult, geoResult, sitemapResult, napResult, imagesResult] = await Promise.all([
    withTimeout(Promise.resolve(analyzeSchemas({ html, industry, businessFacts })), SECTION_TIMEOUT_MS, 'schema'),
    withTimeout(Promise.resolve(analyzeEeat({ html, finalUrl, businessFacts })), SECTION_TIMEOUT_MS, 'eeat'),
    withTimeout(Promise.resolve(analyzeGeo({ html, robotsTxt, llmsTxtContent, llmsFullTxtContent, businessFacts })), SECTION_TIMEOUT_MS, 'geo'),
    withTimeout(Promise.resolve(analyzeSitemap({ sitemapXml, sitemapUrl: businessFacts.sitemapUrl, robotsTxt })), SECTION_TIMEOUT_MS, 'sitemap'),
    withTimeout(Promise.resolve(analyzeNap({ html, expectedBusinessName: businessFacts.businessName, expectedPhone: businessFacts.phone, expectedAddress: businessFacts.address })), SECTION_TIMEOUT_MS, 'nap'),
    withTimeout(Promise.resolve(analyzeImages({ html })), SECTION_TIMEOUT_MS, 'images')
  ]);

  const sectionMs = Date.now() - sectionStart;

  // Pull SERP context for dollar math: how many queries did the prospect
  // appear in vs total tested
  const missingFromQueries = serpContext?.missingCount || 0;
  const totalQueriesTested = serpContext?.totalQueries || 8;
  const currentAvgPosition = serpContext?.avgPosition || 99;

  // Stamp $$ onto every finding from each section
  const allFindings = [];
  const sectionMap = { schema: schemaResult, eeat: eeatResult, geo: geoResult, sitemap: sitemapResult, nap: napResult, images: imagesResult };
  Object.entries(sectionMap).forEach(([sectionName, result]) => {
    if (!result || result.status === 'error') return;
    const fixes = result.fixes || [];
    fixes.forEach(fix => {
      const dollarImpact = estimateForFinding({
        findingKey: fix.key,
        industry, city,
        missingFromQueries, totalQueriesTested, currentAvgPosition
      });
      allFindings.push({
        ...fix,
        section: sectionName,
        dollarImpact: {
          monthly: dollarImpact.specific?.monthlyDollarLoss || { low: 0, high: 0 },
          general: dollarImpact.general?.monthlyDollarLoss || { low: 0, high: 0 },
          headlineText: dollarImpact.headlineText
        }
      });
    });
  });

  // Compute weighted overall score across 6 pillars (tunable per business type)
  const sectionScores = {
    schema: schemaResult?.overallScore || 0,
    eeat: eeatResult?.overallScore || 0,
    geo: geoResult?.overallScore || 0,
    sitemap: sitemapResult?.overallScore || 0,
    nap: napResult?.overallScore || 0,
    images: imagesResult?.overallScore || 0
  };
  const overallScore = Math.round(
    (sectionScores.eeat * 0.28) +
    (sectionScores.schema * 0.20) +
    (sectionScores.geo * 0.20) +
    (sectionScores.nap * 0.16) +
    (sectionScores.sitemap * 0.08) +
    (sectionScores.images * 0.08)
  );

  // Total dollar opportunity (top 5 cap × 80% to avoid additive overstatement)
  const sortedByImpact = allFindings.slice().sort(
    (a, b) => (b.dollarImpact.monthly.high || 0) - (a.dollarImpact.monthly.high || 0)
  );
  const top5 = sortedByImpact.slice(0, 5);
  const totalLow = Math.round(top5.reduce((s, f) => s + f.dollarImpact.monthly.low, 0) * 0.8);
  const totalHigh = Math.round(top5.reduce((s, f) => s + f.dollarImpact.monthly.high, 0) * 0.8);

  // Build "what's gated" notice for free tier
  const gatedFootnote = 'Implementation roadmap, exact code-paste blocks, schema generators, llms.txt generator, and weekly monitoring are in the $199 Fix Plan.';

  return {
    schemaVersion: 'audit-deep/1.0',
    generatedAt: new Date().toISOString(),
    finalUrl,
    industry, city, state,
    sectionElapsedMs: sectionMs,

    overallScore,
    grade: overallScore >= 80 ? 'B+' : overallScore >= 70 ? 'B' : overallScore >= 60 ? 'C+' : overallScore >= 50 ? 'C' : overallScore >= 40 ? 'D' : 'F',
    status: overallScore >= 75 ? 'pass' : overallScore >= 50 ? 'warn' : 'fail',

    sections: {
      schema: schemaResult,
      eeat: eeatResult,
      geo: geoResult,
      sitemap: sitemapResult,
      nap: napResult,
      images: imagesResult
    },

    sectionScores,

    findings: allFindings, // ALL findings visible to all tiers (free included)
    topFiveFindings: top5,

    dollarOpportunity: {
      monthly: { low: totalLow, high: totalHigh },
      annual: { low: totalLow * 12, high: totalHigh * 12 },
      method: 'Sum of top 5 finding-level $$ impacts × 0.8 (to avoid additive overstatement)'
    },

    serpContext: {
      missingFromQueries,
      totalQueriesTested,
      currentAvgPosition,
      provided: !!serpContext
    },

    gatedFootnote,

    // Ready-to-paste assets — generated deterministically from real facts.
    // Tier-filter REMOVES these for free; included for paid tiers.
    generatedAssets: {
      localBusinessSchema: generateSchemaForType('LocalBusiness', industry, businessFacts),
      websiteSchema: generateSchemaForType('WebSite', industry, businessFacts),
      breadcrumbSchema: generateSchemaForType('BreadcrumbList', industry, businessFacts),
      organizationSchema: generateSchemaForType('Organization', industry, businessFacts),
      llmsTxt: generateLlmsTxt({
        businessName: businessFacts.businessName,
        description: businessFacts.description,
        url: finalUrl || businessFacts.url,
        industry, city, state,
        primaryServices: businessFacts.primaryServices || [],
        sitemapUrls: businessFacts.sitemapUrls || []
      })
    }
  };
}

/**
 * Apply tier filtering. ONLY fixes + generatedAssets are gated.
 * Findings, scores, dollar estimates, examples — all visible to all tiers.
 */
function filterDeepAuditByTier(deepResult, tier = 'free') {
  if (!deepResult) return deepResult;
  const out = { ...deepResult };

  if (tier === 'free') {
    // Free tier: hide the implementation specifics
    out.findings = (out.findings || []).map(f => {
      const cleaned = { ...f };
      // Strip copy-paste snippets and ready-to-use generated content
      delete cleaned.snippet;
      delete cleaned.generatedJsonLd;
      delete cleaned.copyPasteReady;
      delete cleaned.effortMinutes;
      // Keep title, severity, dollarImpact, evidence, section, key, detail
      return cleaned;
    });
    out.topFiveFindings = (out.topFiveFindings || []).map(f => {
      const cleaned = { ...f };
      delete cleaned.snippet;
      delete cleaned.generatedJsonLd;
      delete cleaned.copyPasteReady;
      delete cleaned.effortMinutes;
      return cleaned;
    });
    delete out.generatedAssets;
    out.upgradeCta = {
      tier: 'fix_plan',
      price: 199,
      includes: ['Exact copy-paste fix code', 'Generated JSON-LD ready to ship', 'Generated llms.txt ready to ship', 'Implementation roadmap by week', '2 months free Maintenance ($158 value)'],
      pitch: 'You see what\u2019s wrong above. The Fix Plan ships you exactly what to paste, in priority order, with the math on what each fix returns.'
    };
  }
  // Silver, Gold, Admin: full output as-is
  return out;
}

module.exports = {
  runDeepAudit,
  filterDeepAuditByTier
};
