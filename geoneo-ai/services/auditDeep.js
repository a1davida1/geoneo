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
const { analyzePerformance } = require('./pageSpeedClient');
const { analyzeContent } = require('./grammarChecker');
const sslAnalyzer = require('./sslAnalyzer');
const crawlabilityAnalyzer = require('./crawlabilityAnalyzer');
const internalLinkingAnalyzer = require('./internalLinkingAnalyzer');
const mobileAnalyzer = require('./mobileAnalyzer');
const { estimateForFinding, estimateSpecificLoss } = require('./dollarLiftEngine');

const SECTION_TIMEOUT_MS = 8000;

/**
 * Authority pillar — converts Ahrefs metrics to a 0-100 score.
 * Returns { available: false } when ahrefs data is missing/errored — caller
 * renormalizes weights to skip this pillar in that case (cheap-tier audits).
 *
 * Score breakdown (max 100):
 *   - DR (0-100):              up to 30 pts (DR/100 × 30)
 *   - Organic traffic:         up to 30 pts (log10 scale, caps at ~10K/mo)
 *   - Organic keywords ranked: up to 20 pts (log10, caps at ~1K kw)
 *   - Referring domains:       up to 10 pts (log10, caps at ~1K refdomains)
 *   - Active ad spend:         up to 10 pts (paid_traffic > 0 = currently
 *                              investing in their site; high-intent prospect)
 */
function computeAuthorityScore(ahrefs) {
  if (!ahrefs || ahrefs.skipped || ahrefs.error || !ahrefs.configured) {
    return { score: 0, available: false, reason: ahrefs?.skipped || ahrefs?.error || 'no_ahrefs_data' };
  }
  const dr = Number(ahrefs.domainRating) || 0;
  const traffic = Number(ahrefs.organicTraffic) || 0;
  const keywords = Number(ahrefs.organicKeywords) || 0;
  const refdomains = Number(ahrefs.refdomains) || 0;
  const paidTraffic = Number(ahrefs.paidTraffic) || 0;
  const paidKw = Number(ahrefs.paidKeywords) || 0;

  const drPts = Math.min(30, Math.round((dr / 100) * 30));
  const trafficPts = Math.min(30, Math.round(Math.log10(traffic + 1) * 7.5));
  const kwPts = Math.min(20, Math.round(Math.log10(keywords + 1) * 6.5));
  const refdomainPts = Math.min(10, Math.round(Math.log10(refdomains + 1) * 3.5));
  const adInvestPts = (paidTraffic > 0 || paidKw > 0) ? 10 : 0;

  const score = drPts + trafficPts + kwPts + refdomainPts + adInvestPts;
  const findings = [];

  // Surface authority signals as findings so they show in the audit
  if (dr >= 30) findings.push({ key: 'authority_dr_strong', severity: 'low',
    title: `Strong domain authority — DR ${dr}`,
    description: `${refdomains} referring domains pointing to your site. This is the kind of authority Google rewards.` });
  if (traffic >= 1000) findings.push({ key: 'authority_traffic_strong', severity: 'low',
    title: `Real organic traffic — ~${traffic.toLocaleString()}/mo from search`,
    description: `Already ranking for ${keywords} keywords. The technical fixes below would compound this.` });
  if (paidTraffic > 0 || paidKw > 0) findings.push({ key: 'authority_paid_signal', severity: 'low',
    title: `Currently investing in paid search`,
    description: `${paidKw} paid keywords driving ~${paidTraffic.toLocaleString()} clicks/mo (~$${ahrefs.paidCostMonthlyUsd || '?'}/mo spend). High-intent prospect.` });
  // Friction findings — when authority is weak
  if (dr < 15) findings.push({ key: 'authority_dr_weak', severity: 'medium',
    title: `Low domain authority — DR ${dr}`,
    description: `Only ${refdomains} referring domains. Backlinks + citations from local sites would lift this.` });
  if (traffic < 100 && keywords < 50) findings.push({ key: 'authority_traffic_weak', severity: 'high',
    title: `Site barely ranking — ${traffic}/mo organic visits, ${keywords} ranked keywords`,
    description: `The site is essentially invisible in search. Foundational SEO work + content publishing required.` });

  return {
    score,
    available: true,
    breakdown: {
      domainRating: dr, drPts,
      organicTraffic: traffic, trafficPts,
      organicKeywords: keywords, kwPts,
      refdomains, refdomainPts,
      paidTraffic, paidKw, adInvestPts,
      investingInAds: ahrefs.investingInAds
    },
    findings
  };
}

/**
 * Prospect fit — "how likely is this site to be a customer for us?"
 * Distinct from overallScore (which measures their SEO health).
 *
 * Our ICP: small/local business with a real-but-broken website. Strong
 * positive signals: low authority (they need help and we can move the
 * needle), many fixable findings (clear value prop), has phone/address
 * (real business, has revenue), commercial intent in industry.
 * Strong negatives: very high authority (already winning, won't buy from
 * us — too expensive), totally dead site (no commercial activity).
 *
 * Returns { score, tier, reasons[] }.
 */
function computeProspectFit({ overallScore, authorityResult, findingsCount, highSeverityCount, businessFacts, napResult }) {
  let score = 50; // neutral start
  const reasons = [];

  // Authority signal — INVERSE. Low DR + low traffic = ideal prospect.
  // Skip when no Ahrefs data (cheap tier) — score stays neutral on auth.
  // Thresholds tuned for our $79-499/mo SaaS pricing — sites already pulling
  // 1K+ organic visits/mo are typically beyond our buyer profile.
  if (authorityResult?.available && authorityResult.breakdown) {
    const dr = authorityResult.breakdown.domainRating || 0;
    const traffic = authorityResult.breakdown.organicTraffic || 0;
    if (dr >= 40 || traffic >= 5000) {
      score -= 45; reasons.push('high_authority_already_winning'); // yellowstonelandscape — won't buy from us
    } else if (dr >= 20 || traffic >= 1000) {
      score -= 20; reasons.push('moderate_authority_harder_to_close');
    } else if (dr >= 5 || traffic >= 100) {
      score += 15; reasons.push('low_authority_room_to_grow'); // sweet spot
    } else {
      score += 20; reasons.push('very_low_authority_clear_need');
    }
    // Paid spend = active investor in marketing = has budget
    if (authorityResult.breakdown.paidTraffic > 0 || authorityResult.breakdown.paidKw > 0) {
      score += 15; reasons.push('actively_buying_ads_has_budget');
    }
  }

  // Audit health — moderately broken sites are perfect targets. Pristine
  // sites have nothing to sell; totally dead sites have no business.
  if (overallScore >= 80) { score -= 15; reasons.push('audit_too_clean'); }
  else if (overallScore >= 65) { score -= 5; reasons.push('audit_decent'); }
  else if (overallScore >= 35) { score += 15; reasons.push('audit_clearly_broken'); }
  else { score += 5; reasons.push('audit_severely_broken'); }

  // Many findings = many things to sell; high-severity = urgent value prop
  if (findingsCount >= 15) { score += 10; reasons.push('many_fixable_issues'); }
  if (highSeverityCount >= 3) { score += 10; reasons.push('multiple_high_severity'); }

  // Real business signals — phone + address = revenue-generating, will pay
  const napScore = napResult?.score ?? napResult?.overallScore ?? 0;
  const hasPhone = Boolean(businessFacts?.phone || (napResult?.extracted?.phones?.length));
  const hasAddress = Boolean(businessFacts?.address || (napResult?.extracted?.addresses?.length));
  if (hasPhone) { score += 8; reasons.push('has_phone_real_business'); }
  if (hasAddress) { score += 5; reasons.push('has_address'); }
  if (napScore >= 70) { score += 5; reasons.push('nap_consistent'); }

  // Bound to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tier = score >= 75 ? 'ideal' : score >= 55 ? 'good' : score >= 35 ? 'marginal' : 'skip';
  return { score, tier, reasons };
}

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
    sitemapXml = null,
    // Batch mode: skip the slow optional analyzers (broken-link probe,
    // cert fetch, redirect chain follow). Cuts ~10-20s off per-domain
    // wall-clock time at the cost of less depth on those checks.
    batchMode = false,
    // Skip rate-limited external APIs (PageSpeed: 25k/day, LanguageTool:
    // 20/min free). Used by throughput benchmarks.
    skipExternalApis = false,
    // Audit DEPTH tier — controls which expensive paid integrations fire.
    // Per-audit external-API cost ranges:
    //   cheap    — $0.00   structural only (cold-sweep default; 30k/night)
    //   standard — $0.005  + Puppeteer render + PageSpeed + LanguageTool (paid quotas, but cheap)
    //   deep     — $0.40   + Ahrefs + multi-LLM matrix + Places + CrUX (only for paid customers / hot replies)
    // Volume math: cheap × 30k = $0/night. deep × 30k = $12k/night.
    // The dispatcher MUST select cheap for cold sweeps.
    auditDepth = 'cheap'
  } = input;

  // Derive analyzer gates from auditDepth tier. Explicit batchMode/
  // skipExternalApis still respected (back-compat with benchmark scripts).
  const isCheap = auditDepth === 'cheap';
  const isStandard = auditDepth === 'standard';
  const isDeep = auditDepth === 'deep';
  const effectiveBatchMode = batchMode || isCheap; // cheap = skip slow probes
  const effectiveSkipExternalApis = skipExternalApis || isCheap; // cheap = no PageSpeed/LT
  // Deep-tier integrations (Ahrefs, multi-LLM matrix, Places, CrUX) wired
  // separately below, only when isDeep.

  const sectionStart = Date.now();
  // PageSpeed has its own 15s timeout internally; we give it a bigger
  // budget (18s) here so it can finish even when the API is slow.
  // LanguageTool runs against visible text; 12s timeout internally.
  const PERFORMANCE_TIMEOUT_MS = 18000;
  const CONTENT_TIMEOUT_MS = 14000;
  const [schemaResult, eeatResult, geoResult, sitemapResult, napResult, imagesResult, performanceResult, contentResult,
         sslResult, crawlabilityResult, internalLinkingResult, mobileResult] = await Promise.all([
    withTimeout(Promise.resolve(analyzeSchemas({ html, industry, businessFacts })), SECTION_TIMEOUT_MS, 'schema'),
    withTimeout(Promise.resolve(analyzeEeat({ html, finalUrl, businessFacts })), SECTION_TIMEOUT_MS, 'eeat'),
    withTimeout(Promise.resolve(analyzeGeo({ html, robotsTxt, llmsTxtContent, llmsFullTxtContent, businessFacts, url: finalUrl })), SECTION_TIMEOUT_MS, 'geo'),
    withTimeout(Promise.resolve(analyzeSitemap({ sitemapXml, sitemapUrl: businessFacts.sitemapUrl, robotsTxt })), SECTION_TIMEOUT_MS, 'sitemap'),
    withTimeout(Promise.resolve(analyzeNap({ html, expectedBusinessName: businessFacts.businessName, expectedPhone: businessFacts.phone, expectedAddress: businessFacts.address })), SECTION_TIMEOUT_MS, 'nap'),
    withTimeout(Promise.resolve(analyzeImages({ html })), SECTION_TIMEOUT_MS, 'images'),
    // Performance gets a structural fallback in cheap tier — never "unavailable".
    withTimeout(analyzePerformance({ finalUrl, html, skipApi: effectiveSkipExternalApis }), PERFORMANCE_TIMEOUT_MS, 'performance'),
    // Content gets a structural-only fallback in cheap tier — never "unavailable".
    withTimeout(analyzeContent({ html, skipApi: effectiveSkipExternalApis }), CONTENT_TIMEOUT_MS, 'content'),
    // 4 new analyzers — all use standardized shape via standardize() wrapper.
    // In batch/cheap mode we skip the slow probes inside SSL + crawlability +
    // internal_linking to fit the per-domain time budget.
    withTimeout(sslAnalyzer.analyze({ url: finalUrl, html, responseHeaders: input.responseHeaders, skipCertFetch: effectiveBatchMode }), SECTION_TIMEOUT_MS, 'ssl'),
    withTimeout(crawlabilityAnalyzer.analyze({ url: finalUrl, html, robotsTxt, responseHeaders: input.responseHeaders, skipRedirectChain: effectiveBatchMode }), SECTION_TIMEOUT_MS, 'crawlability'),
    withTimeout(internalLinkingAnalyzer.analyze({ url: finalUrl, html, skipProbe: effectiveBatchMode || input.skipBrokenLinkProbe }), SECTION_TIMEOUT_MS, 'internal_linking'),
    withTimeout(mobileAnalyzer.analyze({ html, finalUrl }), SECTION_TIMEOUT_MS, 'mobile')
  ]);

  // ===== DEEP-tier paid integrations =====
  // Only fire for auditDepth='deep'. Approx per-audit cost: $0.30-$0.50.
  // Run in parallel after the structural audit so they don't block scoring.
  let deepIntegrations = null;
  if (isDeep) {
    const deepStart = Date.now();
    deepIntegrations = await Promise.allSettled([
      // Multi-LLM citation matrix (~$0.20)
      (async () => {
        try {
          const matrix = require('./multiLlmMatrix');
          const target = (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();
          return await matrix.runMultiLlmMatrix({
            businessName: businessFacts.businessName, domain: target,
            industry, city, state
          });
        } catch (err) { return { error: err.message }; }
      })(),
      // Ahrefs enrichment (~$0.10) — { enabled: true } required, otherwise
      // the client returns skipped:'not_enabled_for_run' as a credit safeguard.
      (async () => {
        try {
          const ahrefs = require('./ahrefsClient');
          if (!ahrefs.ahrefsStatus().configured) return { skipped: 'no_ahrefs_key' };
          const target = (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();
          return await ahrefs.enrichDomainWithAhrefs(target, { enabled: true });
        } catch (err) { return { error: err.message }; }
      })(),
      // Google Places GBP (~$0.02)
      (async () => {
        try {
          const places = require('./placesClient');
          if (!places.isAvailable()) return { skipped: 'no_places_key' };
          const target = (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();
          return await places.findBestMatchByDomain({
            domain: target, businessName: businessFacts.businessName,
            industry, city, state
          });
        } catch (err) { return { error: err.message }; }
      })()
    ]);
    console.log(`[deep] paid integrations done in ${Date.now() - deepStart}ms`);
  }

  const sectionMs = Date.now() - sectionStart;

  // Pull SERP context for dollar math: how many queries did the prospect
  // appear in vs total tested
  const missingFromQueries = serpContext?.missingCount || 0;
  const totalQueriesTested = serpContext?.totalQueries || 8;
  const currentAvgPosition = serpContext?.avgPosition || 99;

  // Stamp $$ onto every finding from each section
  const allFindings = [];
  const sectionMap = {
    schema: schemaResult,
    eeat: eeatResult,
    geo: geoResult,
    sitemap: sitemapResult,
    nap: napResult,
    images: imagesResult,
    performance: performanceResult,
    content: contentResult,
    ssl: sslResult,
    crawlability: crawlabilityResult,
    internal_linking: internalLinkingResult,
    mobile: mobileResult
  };
  Object.entries(sectionMap).forEach(([sectionName, result]) => {
    if (!result || result.status === 'error') return;
    // Standardized analyzers use `findings`, legacy use `fixes` — accept both
    const fixes = result.findings || result.fixes || [];
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

  // ===== AUTHORITY PILLAR =====
  // Real-world search performance from Ahrefs (deep tier only). A site with
  // DR 46 + 7K traffic + 953 ranked keywords IS doing something right — pure
  // technical-checklist scoring under-credits real authority. This pillar
  // brings the score in line with reality. When Ahrefs unavailable (cheap
  // tier or API down), this pillar is skipped + renormalized out.
  const ahrefsData = deepIntegrations?.[1]?.value || null;
  const authorityResult = computeAuthorityScore(ahrefsData);

  const pickScore = (r) => r?.score ?? r?.overallScore ?? 0;
  const sectionScores = {
    schema: pickScore(schemaResult),
    eeat: pickScore(eeatResult),
    geo: pickScore(geoResult),
    sitemap: pickScore(sitemapResult),
    nap: pickScore(napResult),
    images: pickScore(imagesResult),
    performance: pickScore(performanceResult),
    content: pickScore(contentResult),
    ssl: pickScore(sslResult),
    crawlability: pickScore(crawlabilityResult),
    internal_linking: pickScore(internalLinkingResult),
    mobile: pickScore(mobileResult),
    authority: pickScore(authorityResult)
  };
  // 12-pillar weights. Total = 1.0. NOTE: authority is captured as a section
  // for visibility but excluded from the overall score — our customer base is
  // low-end sites that NEED SEO help, so high authority = bad prospect, not
  // a credit. The audit score reflects technical SEO compliance only.
  // Authority is fed into prospectFit instead (lower auth = better prospect).
  const sectionWeights = {
    eeat: 0.14,
    schema: 0.10,
    geo: 0.13,
    nap: 0.10,
    performance: 0.10,
    sitemap: 0.04,
    images: 0.04,
    content: 0.10,
    ssl: 0.05,
    crawlability: 0.10,
    internal_linking: 0.05,
    mobile: 0.05
  };
  const performanceAvailable = performanceResult?.available !== false;
  const contentAvailable = contentResult?.available !== false;
  let activeWeightSum = 0;
  let weightedTotal = 0;
  Object.entries(sectionWeights).forEach(([key, weight]) => {
    if (key === 'performance' && !performanceAvailable) return;
    if (key === 'content' && !contentAvailable) return;
    activeWeightSum += weight;
    weightedTotal += sectionScores[key] * weight;
  });
  // Re-normalize so missing pillars don't drag down the score artificially.
  const overallScore = activeWeightSum > 0
    ? Math.round(weightedTotal / activeWeightSum)
    : 0;

  // ===== PROSPECT FIT =====
  // 0-100 score for "how good a SALES PROSPECT is this site for us?"
  // High = small/struggling site with fixable issues + commercial intent.
  // Low = either too established (won't pay for help) or too dead (no business).
  // Used by lead pipeline to sort/filter — distinct from overallScore which
  // measures technical compliance.
  const prospectFit = computeProspectFit({
    overallScore,
    authorityResult,
    findingsCount: allFindings.length,
    highSeverityCount: allFindings.filter((f) => String(f.severity || '').toLowerCase() === 'high').length,
    businessFacts,
    napResult
  });

  // Total dollar opportunity (top 5 cap × 80% to avoid additive overstatement)
  const sortedByImpact = allFindings.slice().sort(
    (a, b) => (b.dollarImpact.monthly.high || 0) - (a.dollarImpact.monthly.high || 0)
  );
  const top5 = sortedByImpact.slice(0, 5);
  const totalLow = Math.round(top5.reduce((s, f) => s + f.dollarImpact.monthly.low, 0) * 0.8);
  const totalHigh = Math.round(top5.reduce((s, f) => s + f.dollarImpact.monthly.high, 0) * 0.8);

  // Build "what's gated" notice for free tier
  const gatedFootnote = 'Implementation roadmap, exact code-paste blocks, schema generators, llms.txt generator, and weekly monitoring are in the $199 Fix Plan.';

  // Pull industry baseline (peer cohort benchmark) — best-effort, never blocks
  let industryBenchmark = null;
  try {
    const ib = require('./industryBaselines');
    industryBenchmark = await ib.getBaseline({ industry, city, score: overallScore });
  } catch (err) {
    // Cache may not exist yet on first run; rebuildIfStale runs at boot
  }

  // Surface real-world examples + competitor evidence on the top-5 findings
  let top5WithExamples = top5;
  try {
    const es = require('./exampleSurfacer');
    const cif = require('./competitorInformedFixes');
    const targetDomain = (() => { try { return new URL(finalUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    top5WithExamples = await es.surfaceExamples(top5, { industry, excludeDomain: targetDomain });
    top5WithExamples = await cif.attachCompetitorEvidence(top5WithExamples, { industry, excludeDomain: targetDomain });
  } catch (err) {
    // Non-fatal
  }

  return {
    schemaVersion: 'audit-deep/1.0',
    generatedAt: new Date().toISOString(),
    finalUrl,
    industry, city, state,
    sectionElapsedMs: sectionMs,

    overallScore,
    grade: overallScore >= 80 ? 'B+' : overallScore >= 70 ? 'B' : overallScore >= 60 ? 'C+' : overallScore >= 50 ? 'C' : overallScore >= 40 ? 'D' : 'F',
    status: overallScore >= 75 ? 'pass' : overallScore >= 50 ? 'warn' : 'fail',
    auditDepth, // tier this audit ran at — for cost attribution + ui display
    prospectFit, // { score, tier, reasons } — for sales targeting (high = ideal)
    industryBenchmark,
    deepIntegrations: deepIntegrations ? {
      multiLlmMatrix: deepIntegrations[0]?.value || null,
      ahrefs: deepIntegrations[1]?.value || null,
      places: deepIntegrations[2]?.value || null
    } : null,

    sections: {
      schema: schemaResult,
      eeat: eeatResult,
      geo: geoResult,
      sitemap: sitemapResult,
      nap: napResult,
      images: imagesResult,
      performance: performanceResult,
      content: contentResult,
      ssl: sslResult,
      crawlability: crawlabilityResult,
      internal_linking: internalLinkingResult,
      mobile: mobileResult,
      authority: authorityResult
    },

    sectionScores,
    sectionWeights,

    findings: allFindings, // ALL findings visible to all tiers (free included)
    topFiveFindings: top5WithExamples,

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
