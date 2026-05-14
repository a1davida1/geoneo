/**
 * Standardized sub-analyzer return shape + normalizer.
 *
 * Per spec, every audit sub-analyzer must return:
 *
 *   {
 *     section: "schema",            // machine key
 *     label: "Schema Markup",       // human label
 *     score: 35,                    // 0-100
 *     maxScore: 100,                // always 100
 *     grade: "F",                   // A-F derived from score
 *     status: "fail",               // pass | warn | fail
 *     findings: [
 *       {
 *         id: "schema-missing-local-business",  // kebab-case unique
 *         severity: "critical",                  // critical | major | minor | info
 *         title: "Missing LocalBusiness Schema",
 *         detail: "...non-technical owner-readable...",
 *         impact: "high",                        // high | medium | low
 *         fixDifficulty: "easy",                 // easy | moderate | hard
 *         fixEstimate: "15 minutes",
 *         dollarLift: null                       // populated by dollarLiftEngine
 *       }
 *     ],
 *     warnings: [],                              // non-fatal issues during analysis
 *     metadata: {}                               // section-specific raw data for downstream
 *   }
 *
 * The `normalize()` function adapts any legacy analyzer output (which often
 * uses different field names: overallScore, fixes[], severity 'high'/'low')
 * to this shape WITHOUT touching the analyzer internals. New analyzers
 * should produce the standard shape directly.
 */

const SECTION_LABELS = {
  schema: 'Schema Markup',
  eeat: 'E-E-A-T (Trust)',
  geo: 'AI-Search Readiness (GEO)',
  sitemap: 'Sitemap.xml',
  nap: 'NAP Consistency',
  images: 'Image Audit',
  performance: 'Page Performance',
  content: 'Content Quality',
  ssl: 'SSL & Security',
  crawlability: 'Crawlability',
  internal_linking: 'Internal Linking',
  mobile: 'Mobile Usability',
  hreflang: 'hreflang / Multilingual'
};

// Severity normalization. Legacy analyzers use 'high/medium/low' (severity of
// the issue itself). Spec uses 'critical/major/minor/info' (urgency for fixing).
const SEVERITY_MAP = {
  high: 'critical',
  critical: 'critical',
  medium: 'major',
  major: 'major',
  low: 'minor',
  minor: 'minor',
  info: 'info'
};

// Impact derived from severity if not explicitly set
const IMPACT_FROM_SEVERITY = {
  critical: 'high',
  major: 'high',
  minor: 'medium',
  info: 'low'
};

function gradeFor(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (s >= 90) return 'A';
  if (s >= 80) return 'B';
  if (s >= 70) return 'C';
  if (s >= 60) return 'D';
  return 'F';
}

function statusFor(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'unknown';
  if (s >= 75) return 'pass';
  if (s >= 50) return 'warn';
  return 'fail';
}

function normalizeSeverity(raw) {
  return SEVERITY_MAP[String(raw || '').toLowerCase()] || 'minor';
}

/**
 * Normalize a single finding to the spec shape. Preserves any extra fields
 * (like `key`, `dollarImpact`) that downstream code uses, but adds the
 * required spec fields with sensible defaults.
 */
function normalizeFinding(raw, sectionKey) {
  if (!raw || typeof raw !== 'object') return null;
  const severity = normalizeSeverity(raw.severity);
  const id = raw.id || raw.key || `${sectionKey}-${slugify(raw.title || 'finding')}`;
  const impact = raw.impact || IMPACT_FROM_SEVERITY[severity] || 'medium';
  const out = {
    ...raw,
    id,
    key: id, // back-compat alias
    severity,
    title: raw.title || 'Finding',
    detail: raw.detail || raw.description || '',
    impact,
    fixDifficulty: raw.fixDifficulty || raw.difficulty || guessDifficulty(severity),
    fixEstimate: raw.fixEstimate || raw.effortMinutes ? (raw.effortMinutes ? `${raw.effortMinutes} minutes` : null) : guessFixEstimate(severity),
    dollarLift: raw.dollarLift || raw.dollarImpact?.monthly?.high || null
  };
  return out;
}

function guessDifficulty(severity) {
  if (severity === 'critical') return 'moderate';
  if (severity === 'major') return 'easy';
  return 'easy';
}

function guessFixEstimate(severity) {
  if (severity === 'critical') return '30-60 minutes';
  if (severity === 'major') return '15-30 minutes';
  return '5-15 minutes';
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

/**
 * Take any analyzer output (legacy or new) and produce a standard-shape result.
 * Preserves the analyzer's full payload as `metadata` so downstream code that
 * reads e.g. `result.passageCitability.score` still works.
 *
 * Resolves these legacy field name variants:
 *   - score: from `overallScore` | `score`
 *   - findings: from `findings` | `fixes` | `issues`
 *   - warnings: from `warnings` | `errors` (non-fatal)
 */
function normalize(rawResult, sectionKey) {
  if (!rawResult || typeof rawResult !== 'object') {
    return {
      section: sectionKey,
      label: SECTION_LABELS[sectionKey] || sectionKey,
      score: 0,
      maxScore: 100,
      grade: 'F',
      status: 'fail',
      findings: [],
      warnings: [{ message: 'analyzer returned no data', severity: 'error' }],
      metadata: {}
    };
  }
  const score = Number(rawResult.overallScore ?? rawResult.score ?? 0);
  const findingsSource = Array.isArray(rawResult.findings) ? rawResult.findings
    : Array.isArray(rawResult.fixes) ? rawResult.fixes
    : Array.isArray(rawResult.issues) ? rawResult.issues
    : [];
  const warnings = Array.isArray(rawResult.warnings) ? rawResult.warnings : [];
  return {
    section: sectionKey,
    label: SECTION_LABELS[sectionKey] || sectionKey,
    score: Math.round(Math.max(0, Math.min(100, score))),
    maxScore: 100,
    grade: gradeFor(score),
    status: statusFor(score),
    findings: findingsSource.map((f) => normalizeFinding(f, sectionKey)).filter(Boolean),
    warnings,
    metadata: rawResult // preserve the full payload for back-compat consumers
  };
}

/**
 * Higher-order wrapper. Use when implementing a NEW analyzer to produce the
 * standard shape directly without manual normalization.
 *
 *   module.exports = { run: standardize('schema', async (input) => {
 *     return { score: 47, findings: [...], warnings: [] };
 *   })};
 */
function standardize(sectionKey, fn) {
  return async (...args) => {
    try {
      const raw = await fn(...args);
      return normalize(raw || {}, sectionKey);
    } catch (err) {
      return {
        section: sectionKey,
        label: SECTION_LABELS[sectionKey] || sectionKey,
        score: 0,
        maxScore: 100,
        grade: 'F',
        status: 'fail',
        findings: [],
        warnings: [{ message: 'analyzer threw: ' + (err.message || 'unknown'), severity: 'error' }],
        metadata: { error: err.message }
      };
    }
  };
}

module.exports = {
  normalize,
  normalizeFinding,
  normalizeSeverity,
  standardize,
  gradeFor,
  statusFor,
  SECTION_LABELS,
  SEVERITY_MAP
};
