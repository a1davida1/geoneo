/**
 * Grammar / clarity / style checker via the LanguageTool public API.
 *
 * Returns an issue count + sample issues + a 0-100 quality score derived
 * from issue density. The deep audit treats this as the "content" pillar
 * (alongside the existing analyzers), and the E-E-A-T trust dimension can
 * also factor it in indirectly via the audit-level findings.
 *
 * Bounded:
 *   - Sends at most CHAR_CAP characters per call (LanguageTool free tier
 *     rejects very long bodies).
 *   - 24h disk cache keyed by SHA1(text). Same content from a re-audit
 *     within a day reuses the result.
 *   - Single attempt per call, 12s timeout. On error returns a degraded
 *     `{available: false, reason}` shape — the orchestrator treats null/
 *     unavailable as "skip this pillar" rather than failing the audit.
 *
 * Note on ranking: LanguageTool flags a wide class of issues (typos, style,
 * filler words). We don't surface every category as a fix — only the ones
 * that actually erode trust on a service business homepage (typos, wrong
 * homophones, unprofessional phrasing).
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const he = require('he');

const ENDPOINT = process.env.LANGUAGETOOL_ENDPOINT || 'https://api.languagetool.org/v2/check';
const CHAR_CAP = 4000;
const TIMEOUT_MS = 12000;
const CACHE_DIR = path.join(__dirname, '..', 'data', 'grammar-cache');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function hashText(text) {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
}

async function readCache(key) {
  try {
    const file = path.join(CACHE_DIR, `${key}.json`);
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCache(key, value) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${key}.json`);
    await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
  } catch {
    // cache writes are best-effort
  }
}

/**
 * Pull the visible text out of an HTML payload — strips script/style and
 * collapses whitespace. Trims to CHAR_CAP so we don't blow LanguageTool's
 * free-tier limit.
 */
function htmlToVisibleText(html) {
  if (!html) return '';
  const stripped = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const decoded = he.decode(stripped);
  return decoded
    .replace(/\ban\s*empty\s*text\s*line\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAR_CAP);
}

/**
 * Hit LanguageTool. Returns an array of `matches` (their schema) or null on
 * any failure. Caller never sees a thrown exception.
 */
async function callLanguageTool(text) {
  const params = new URLSearchParams({
    language: 'en-US',
    text,
    level: 'default',
    enabledOnly: 'false'
  });
  const disabled = String(process.env.LANGUAGETOOL_DISABLED_RULES || '').trim();
  if (disabled) params.append('disabledRules', disabled);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: controller.signal
    });
    if (!response.ok) return { error: `http_${response.status}` };
    const data = await response.json();
    return { matches: Array.isArray(data.matches) ? data.matches : [] };
  } catch (err) {
    return { error: err && err.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Convert raw match list into a 0-100 score + curated sample.
 * Density is per 1000 characters; 0 issues/kchar = 100, 12+/kchar = 25.
 */
function scoreAndSummarize(matches, charCount) {
  const total = matches.length;
  const perThousand = charCount > 0 ? (total / (charCount / 1000)) : 0;
  let score;
  if (perThousand <= 0) score = 100;
  else if (perThousand >= 12) score = 25;
  else score = Math.round(100 - ((perThousand / 12) * 75));

  const severityFor = (m) => {
    const cat = (m.rule?.category?.id || '').toUpperCase();
    if (['TYPOS', 'CASING', 'GRAMMAR'].includes(cat)) return 'high';
    if (['CONFUSED_WORDS', 'STYLE', 'PUNCTUATION'].includes(cat)) return 'medium';
    return 'low';
  };

  // Show up to 8 of the most material issues, prefer high severity first.
  const ranked = matches
    .map((m) => ({
      message: m.message || 'Issue detected',
      shortMessage: m.shortMessage || m.message || '',
      ruleId: m.rule?.id || null,
      category: m.rule?.category?.name || m.rule?.category?.id || 'other',
      severity: severityFor(m),
      context: m.context?.text ? m.context.text.slice(0, 120) : null,
      replacements: Array.isArray(m.replacements) ? m.replacements.slice(0, 3).map((r) => r.value) : []
    }))
    .sort((a, b) => {
      const sevRank = { high: 3, medium: 2, low: 1 };
      return sevRank[b.severity] - sevRank[a.severity];
    });

  const sampleIssues = ranked.slice(0, 8);
  const highSevCount = ranked.filter((r) => r.severity === 'high').length;
  const mediumSevCount = ranked.filter((r) => r.severity === 'medium').length;

  return {
    score,
    perThousandChars: Math.round(perThousand * 10) / 10,
    totalIssues: total,
    highSeverityCount: highSevCount,
    mediumSeverityCount: mediumSevCount,
    sampleIssues
  };
}

/**
 * Structural content analysis from raw HTML — runs free + cheaply, no API.
 * Provides a reliable score even when LanguageTool is rate-limited.
 *
 * Signals: word count, heading hierarchy, paragraph density, list usage,
 * image alt coverage, internal link density, content-to-chrome ratio.
 *
 * Returns { score (0-100), findings[] }.
 */
function scoreContentStructure(html, text) {
  const findings = [];
  const wordCount = (text.match(/\b[a-zA-Z]{2,}\b/g) || []).length;
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const h2Count = (html.match(/<h2\b/gi) || []).length;
  const h3Count = (html.match(/<h3\b/gi) || []).length;
  const paragraphCount = (html.match(/<p\b/gi) || []).length;
  const listCount = (html.match(/<(?:ul|ol)\b/gi) || []).length;
  const listItemCount = (html.match(/<li\b/gi) || []).length;
  const imgCount = (html.match(/<img\b/gi) || []).length;
  const internalLinkCount = (html.match(/<a[^>]+href=["']\/[^"'#]/gi) || []).length;

  let pts = 0;
  const max = 100;

  // Word count (25 pts) — service homepages need substance for SEO and AI citation
  if (wordCount >= 800) pts += 25;
  else if (wordCount >= 400) pts += 18;
  else if (wordCount >= 200) pts += 10;
  else if (wordCount >= 80) pts += 4;
  else findings.push({
    key: 'content-too-thin',
    severity: 'high',
    title: `Very thin content — only ${wordCount} words on the page`,
    detail: 'Pages under 200 words rarely rank for competitive queries and don\u2019t give AI engines enough to cite. Aim for 400-800 words on the homepage with real explanation of services + service area.',
    effortMinutes: 60
  });

  // Headings (15 pts) — need exactly one h1, plus h2/h3 structure
  if (h1Count === 1) pts += 8;
  else if (h1Count === 0) findings.push({
    key: 'content-no-h1',
    severity: 'high',
    title: 'No <h1> heading on the page',
    detail: 'Every page needs exactly one <h1> as the page title. Search engines and screen readers depend on it.',
    effortMinutes: 5
  });
  else if (h1Count > 1) findings.push({
    key: 'content-multiple-h1',
    severity: 'medium',
    title: `${h1Count} <h1> tags found — should be exactly 1`,
    detail: 'Multiple h1 tags dilute the page topic signal. Convert extras to h2.',
    effortMinutes: 10
  });
  if (h2Count + h3Count >= 3) pts += 7;
  else if (wordCount > 300) findings.push({
    key: 'content-no-subheadings',
    severity: 'medium',
    title: 'No subheadings (h2/h3) — content lacks structure',
    detail: 'Long-form content needs h2/h3 subheadings every 200-300 words. Helps both readers and AI search engines parse passages for citation.',
    effortMinutes: 20
  });

  // Paragraph density (10 pts)
  if (paragraphCount >= 6) pts += 10;
  else if (paragraphCount >= 3) pts += 6;
  else if (wordCount > 200) findings.push({
    key: 'content-wall-of-text',
    severity: 'medium',
    title: 'Few paragraph breaks — content reads as a wall of text',
    detail: 'Break long copy into short paragraphs (2-4 sentences each). Mobile readers in particular bounce from dense walls.',
    effortMinutes: 15
  });

  // Lists (10 pts) — services pages should use bullets/numbered lists
  if (listItemCount >= 5) pts += 10;
  else if (listItemCount >= 3) pts += 5;
  else findings.push({
    key: 'content-no-lists',
    severity: 'low',
    title: 'No bullet/numbered lists on the page',
    detail: 'Service offerings, areas served, certifications — these read better as lists than prose. Lists are also AI-citation friendly.',
    effortMinutes: 10
  });

  // FAQ section (10 pts) — major AI/SGE citation signal
  const hasFaq = /\bfrequently\s+asked|\bfaqs?\b|<details/i.test(text + html);
  if (hasFaq) pts += 10;
  else findings.push({
    key: 'content-no-faq',
    severity: 'medium',
    title: 'No FAQ section detected',
    detail: 'FAQ sections are AI-search gold — they get cited heavily by ChatGPT, Perplexity, and Google AI Overviews. Add 5-10 customer-question Q&As to your homepage or a /faq page.',
    effortMinutes: 45
  });

  // Image-to-text balance (10 pts)
  if (imgCount >= 3 && wordCount >= 200) pts += 10;
  else if (imgCount >= 1) pts += 5;
  else if (wordCount > 100) findings.push({
    key: 'content-no-images',
    severity: 'low',
    title: 'No images on the page',
    detail: 'Service pages without imagery feel low-effort. Add at least a hero photo + 2-3 work photos for credibility.',
    effortMinutes: 30
  });

  // Internal link density (10 pts)
  if (internalLinkCount >= 8) pts += 10;
  else if (internalLinkCount >= 4) pts += 6;
  else if (internalLinkCount >= 2) pts += 3;
  else findings.push({
    key: 'content-no-internal-links',
    severity: 'medium',
    title: `Only ${internalLinkCount} internal link(s) — site has no navigation depth`,
    detail: 'Internal links spread page authority and let visitors explore. Add a nav with services, about, contact, and 1-2 location pages.',
    effortMinutes: 30
  });

  // Words-per-section ratio (10 pts) — well-structured if ≥50 words per heading
  const totalHeadings = h1Count + h2Count + h3Count;
  if (totalHeadings > 0 && wordCount / totalHeadings >= 50) pts += 10;
  else if (totalHeadings > 0 && wordCount / totalHeadings >= 25) pts += 5;

  return {
    score: Math.round((pts / max) * 100),
    findings,
    metrics: { wordCount, h1Count, h2Count, h3Count, paragraphCount, listCount, listItemCount, imgCount, internalLinkCount, hasFaq }
  };
}

/**
 * Top-level "content" analyzer. Returns a real score even when the LanguageTool
 * API is rate-limited / unavailable — falls back to structural analysis.
 *
 * When both signals available: 60% structural + 40% grammar (structure matters
 * more for ranking + citation than perfect grammar).
 * When only structural: returns structural score with a note.
 */
async function analyzeContent({ html, visibleText, skipApi = false } = {}) {
  const text = htmlToVisibleText(html || '') || String(visibleText || '').slice(0, CHAR_CAP).trim();
  if (!text || text.length < 80) {
    return {
      overallScore: 0,
      status: 'unavailable',
      available: false,
      reason: 'insufficient_text',
      message: 'Page had too little text to analyze.',
      fixes: []
    };
  }

  // Always compute the structural score — it's free and fast.
  const struct = scoreContentStructure(html || '', text);

  // Skip the LanguageTool API in cheap mode — return structural-only score.
  if (skipApi) {
    return {
      overallScore: struct.score,
      status: struct.score >= 75 ? 'pass' : struct.score >= 50 ? 'warn' : 'fail',
      available: true,
      mode: 'structural_only',
      message: 'Cheap-tier audit: structural content analysis (no grammar API call).',
      structural: struct.metrics,
      fixes: struct.findings,
      findings: struct.findings
    };
  }

  const key = hashText(text);
  const cached = await readCache(key);
  if (cached) return { ...cached, fromCache: true };

  const lt = await callLanguageTool(text);
  if (lt.error) {
    // LanguageTool unavailable — fall back to structural-only instead of skip.
    return {
      overallScore: struct.score,
      status: struct.score >= 75 ? 'pass' : struct.score >= 50 ? 'warn' : 'fail',
      available: true,
      mode: 'structural_only',
      message: `LanguageTool unavailable (${lt.error}). Score uses structural signals only — re-run later for grammar pass.`,
      structural: struct.metrics,
      fixes: struct.findings,
      findings: struct.findings
    };
  }

  const summary = scoreAndSummarize(lt.matches, text.length);
  // Blend: 60% structural (matters more for ranking + AI citation), 40% grammar.
  const overall = Math.round((struct.score * 0.6) + (summary.score * 0.4));
  const status = overall >= 75 ? 'pass' : overall >= 50 ? 'warn' : 'fail';

  const fixes = [...struct.findings];
  if (summary.highSeverityCount > 0) {
    const highEvidence = summary.sampleIssues.filter((s) => s.severity === 'high').slice(0, 4);
    const nHigh = summary.highSeverityCount;
    const typoTitle = highEvidence.length > 0 && nHigh > highEvidence.length
      ? `${nHigh} typo / grammar issue${nHigh === 1 ? '' : 's'} on the page (showing ${highEvidence.length} samples)`
      : `${nHigh} typo / grammar issue${nHigh === 1 ? '' : 's'} on the page`;
    fixes.push({
      key: 'content-typos',
      severity: 'high',
      title: typoTitle,
      detail: 'Typos and grammar errors directly erode trust on a service-business homepage. Run a final proofread before publishing each page; fix the high-severity items in the sample below.',
      effortMinutes: 20,
      evidenceSampleCount: highEvidence.length,
      evidenceTotalHigh: nHigh,
      evidence: highEvidence
    });
  }
  if (summary.mediumSeverityCount >= 3) {
    const medEvidence = summary.sampleIssues.filter((s) => s.severity === 'medium').slice(0, 4);
    const nMed = summary.mediumSeverityCount;
    const styleTitle = medEvidence.length > 0 && nMed > medEvidence.length
      ? `${nMed} style / clarity issue${nMed === 1 ? '' : 's'} on the page (showing ${medEvidence.length} samples)`
      : `${nMed} style / clarity issue${nMed === 1 ? '' : 's'} on the page`;
    fixes.push({
      key: 'content-style',
      severity: 'medium',
      title: styleTitle,
      detail: 'Confused-word and punctuation issues add up. Tighten copy where flagged below.',
      effortMinutes: 30,
      evidenceSampleCount: medEvidence.length,
      evidenceTotalMedium: nMed,
      evidence: medEvidence
    });
  }
  if (summary.perThousandChars >= 6 && fixes.length === 0) {
    fixes.push({
      key: 'content-density',
      severity: 'medium',
      title: `Frequent minor issues (~${summary.perThousandChars} per 1000 chars)`,
      detail: 'No single severe issue, but density is high enough that the page can read as unedited. A pass with a grammar tool will tighten things.',
      effortMinutes: 25
    });
  }

  const result = {
    overallScore: overall,
    status,
    available: true,
    mode: 'structural_plus_grammar',
    structural: struct.metrics,
    structuralScore: struct.score,
    grammarScore: summary.score,
    charactersChecked: text.length,
    perThousandChars: summary.perThousandChars,
    totalIssues: summary.totalIssues,
    highSeverityCount: summary.highSeverityCount,
    mediumSeverityCount: summary.mediumSeverityCount,
    sampleIssues: summary.sampleIssues,
    fixes,
    findings: fixes
  };
  await writeCache(key, result);
  return result;
}

module.exports = {
  analyzeContent,
  htmlToVisibleText,
  scoreAndSummarize,
  callLanguageTool
};
