/**
 * GEO / AI-Search Analyzer — deterministic scoring of how well a page is
 * structured for citation by AI engines (ChatGPT, Claude, Perplexity,
 * Google AI Overviews, Gemini).
 *
 * NO LLM at runtime. All scoring is structural pattern analysis.
 * The only LLM usage in the broader pipeline is MEASUREMENT
 * (multi-LLM presence matrix) and lives in a separate module.
 *
 * Three primary signals AI engines weight when deciding what to cite:
 *  1. llms.txt / llms-full.txt presence — the emerging standard for
 *     "this is what this site is about, in machine-readable form"
 *  2. Passage citability — Q&A blocks, definition blocks, factual claims
 *     with attribution, single-paragraph answers AI engines can lift
 *  3. Authority + identity signals — same as E-E-A-T (handled separately)
 */

// All `[\s\S]*?` quantifiers BOUNDED to {0,N} to prevent catastrophic
// backtracking on large pages (500KB+ dealer/CMS pages). Without bounds,
// these regexes spin at 99% CPU for minutes when the closing tag doesn't
// appear within reasonable distance — observed on reliablechevy.com.
const PASSAGE_PATTERNS = {
  // Q&A blocks score highest — exactly what AI engines lift verbatim
  qa_blocks: {
    weight: 25,
    detectors: [
      { name: 'faq_schema', re: /<script[^>]+ld\+json[^>]*>[\s\S]{0,3000}?"FAQPage"[\s\S]{0,3000}?<\/script>/i },
      { name: 'details_summary', re: /<details[^>]*>[\s\S]{0,2000}?<summary[^>]*>[\s\S]{0,500}?<\/summary>[\s\S]{0,2000}?<\/details>/i },
      { name: 'h_question', re: /<h[2-4][^>]*>[\s\S]{0,300}?\?[\s\S]{0,300}?<\/h[2-4]>/i }
    ],
    minToPass: 1
  },
  // Definition / glossary blocks — AI engines cite these for "what is X"
  definition_blocks: {
    weight: 15,
    detectors: [
      { name: 'dl_dt_dd', re: /<dl[^>]*>[\s\S]{0,500}?<dt[^>]*>[\s\S]{0,300}?<\/dt>[\s\S]{0,300}?<dd[^>]*>[\s\S]{0,500}?<\/dd>[\s\S]{0,500}?<\/dl>/i },
      { name: 'definition_phrase', re: /\b(?:[A-Z][a-z]+(?:\s+[a-z]+){0,4})\s+is\s+(?:a|an|the)\s+\w+/i },
      { name: 'what_is_heading', re: /<h[2-4][^>]*>\s*(?:what\s+is|what\s+does|how\s+does|how\s+to)/i }
    ],
    minToPass: 1
  },
  // List / how-to blocks — easy to cite as steps
  list_blocks: {
    weight: 12,
    detectors: [
      // Bounded inner quantifier {0,500}? prevents nested-backtracking blowup
      { name: 'ordered_list', re: /<ol[^>]*>(?:\s*<li[^>]*>[\s\S]{0,500}?<\/li>\s*){2,5}<\/ol>/i },
      { name: 'numbered_steps', re: /\b(?:step\s*\d+|first[,.]?\s|second[,.]?\s|then[,.]?\s|finally[,.]?\s)/i },
      { name: 'howto_schema', re: /"@type":\s*"HowTo"/i }
    ],
    minToPass: 1
  },
  // Concrete data / numbers / specifics — AI engines prefer specific over vague
  specifics: {
    weight: 10,
    detectors: [
      { name: 'tables', re: /<table[\s\S]{0,500}<\/table>/i },
      { name: 'specific_dollar', re: /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/ },
      { name: 'specific_percentage', re: /\b\d{1,3}(?:\.\d+)?%/ },
      { name: 'specific_year_count', re: /\b\d+\s*(?:years?|yrs?)\b/ }
    ],
    minToPass: 2
  },
  // Citations / external authority links — AI engines prefer cited claims
  citations: {
    weight: 8,
    detectors: [
      { name: 'authority_link', re: /<a[^>]+href=["']https?:\/\/(?:www\.)?(?:[a-z0-9-]+\.)?(?:gov|edu|epa\.gov|cdc\.gov|energy\.gov|nfpa\.org|consumerreports\.org|wikipedia\.org)/i },
      { name: 'source_attribution', re: /\b(?:according\s+to|per\s+the|source[s]?:|cited\s+(?:by|in)|reference[s]?:)\b/i }
    ],
    minToPass: 1
  },
  // Single-paragraph answers — AI engines lift the first 2-3 sentences after a question
  paragraph_answers: {
    weight: 10,
    detectors: [
      // Use lazy + bounded so giant pages don't trigger backtracking
      { name: 'short_paragraph_after_h', re: /<h[2-4][^>]*>[\s\S]{1,200}?<\/h[2-4]>\s*<p[^>]*>[\s\S]{40,400}?<\/p>/i },
      { name: 'tldr_marker', re: /\b(?:TL;DR|tldr|in\s+short|the\s+short\s+answer|bottom\s+line)\b/i }
    ],
    minToPass: 1
  },
  // Tables of contents / anchored sections — improve passage extraction
  navigation: {
    weight: 5,
    detectors: [
      { name: 'toc_links', re: /<a[^>]+href=["']#[a-zA-Z]/i },
      { name: 'nav_landmark', re: /<nav[^>]*>[\s\S]{0,5000}?<\/nav>/i }
    ],
    minToPass: 1
  },
  // Last-updated date — AI engines weight freshness
  freshness_visible: {
    weight: 8,
    detectors: [
      { name: 'visible_date', re: /\b(?:last\s+updated|updated|reviewed|posted)\s*[:\-]?\s*[A-Za-z]+\s+\d{1,2},?\s+(?:19|20)\d{2}/i },
      { name: 'datetime_attr', re: /<(?:time|article)[^>]+datetime=["'](?:19|20)\d{2}/i }
    ],
    minToPass: 1
  }
};

const AI_CRAWLERS_TO_CHECK = [
  { name: 'GPTBot', userAgent: 'GPTBot' },
  { name: 'ClaudeBot', userAgent: 'ClaudeBot' },
  { name: 'PerplexityBot', userAgent: 'PerplexityBot' },
  { name: 'Google-Extended', userAgent: 'Google-Extended' },
  { name: 'Applebot-Extended', userAgent: 'Applebot-Extended' },
  { name: 'CCBot', userAgent: 'CCBot' }
];

/**
 * Score passage citability — how lift-friendly the page is for AI engines.
 * Returns score 0-100 + per-block findings.
 */
function scorePassageCitability(html = '') {
  const blockResults = {};
  let totalWeight = 0;
  let scoredWeight = 0;

  for (const [name, block] of Object.entries(PASSAGE_PATTERNS)) {
    totalWeight += block.weight;
    let detectorHits = 0;
    const matchedDetectors = [];
    for (const d of block.detectors) {
      if (d.re.test(html)) {
        detectorHits++;
        matchedDetectors.push(d.name);
      }
    }
    const passed = detectorHits >= (block.minToPass || 1);
    if (passed) scoredWeight += block.weight;
    blockResults[name] = {
      weight: block.weight,
      passed,
      detectorHits,
      detectorsMatched: matchedDetectors,
      detectorsAvailable: block.detectors.length
    };
  }

  const score = totalWeight > 0 ? Math.round((scoredWeight / totalWeight) * 100) : 0;
  return { score, blocks: blockResults, scoredWeight, totalWeight };
}

/**
 * Parse robots.txt to determine which AI crawlers are allowed/blocked.
 * Returns per-crawler status object.
 */
function analyzeAiCrawlerAccess(robotsTxt = '') {
  const lines = String(robotsTxt || '').split(/\r?\n/);
  const groups = []; // { agents: [...], disallows: [...], allows: [...] }
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) { current = null; continue; }
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const directive = m[1].toLowerCase();
    const value = m[2].trim();
    if (directive === 'user-agent') {
      if (!current) { current = { agents: [], disallows: [], allows: [] }; groups.push(current); }
      current.agents.push(value);
    } else if (directive === 'disallow' && current) {
      current.disallows.push(value);
    } else if (directive === 'allow' && current) {
      current.allows.push(value);
    } else if (directive === 'user-agent' === false && current && (directive === 'crawl-delay' || directive === 'sitemap')) {
      // ignore
    }
  }

  function statusForAgent(agentName) {
    // Find groups that match this agent (exact, then *)
    let matched = groups.find(g => g.agents.some(a => a.toLowerCase() === agentName.toLowerCase()));
    if (!matched) matched = groups.find(g => g.agents.includes('*'));
    if (!matched) return { allowed: true, source: 'no-rule' };
    const blanket = matched.disallows.includes('/');
    if (blanket) return { allowed: false, source: 'disallow:/', group: matched.agents.join(',') };
    return { allowed: true, source: matched.agents.join(','), partialBlocks: matched.disallows.filter(Boolean) };
  }

  const result = {};
  AI_CRAWLERS_TO_CHECK.forEach(c => { result[c.name] = statusForAgent(c.userAgent); });
  return result;
}

/**
 * Analyze llms.txt content (if present). Returns presence + size + sections.
 * Caller is responsible for fetching the URL — we just analyze the text.
 */
function analyzeLlmsTxt(llmsTxtContent = null, llmsFullTxtContent = null) {
  const llmsTxt = {
    present: !!llmsTxtContent && llmsTxtContent.length > 0,
    bytes: llmsTxtContent ? Buffer.byteLength(llmsTxtContent, 'utf8') : 0,
    headerCount: 0,
    linkCount: 0,
    sectionCount: 0
  };
  const llmsFullTxt = {
    present: !!llmsFullTxtContent && llmsFullTxtContent.length > 0,
    bytes: llmsFullTxtContent ? Buffer.byteLength(llmsFullTxtContent, 'utf8') : 0
  };
  if (llmsTxt.present) {
    llmsTxt.headerCount = (llmsTxtContent.match(/^#+\s/gm) || []).length;
    llmsTxt.linkCount = (llmsTxtContent.match(/^\s*-\s*\[.*?\]\(.*?\)/gm) || []).length;
    llmsTxt.sectionCount = (llmsTxtContent.match(/^##\s/gm) || []).length;
  }
  return { llmsTxt, llmsFullTxt };
}

/**
 * Generate a deterministic llms.txt from sitemap URLs + page facts.
 * NO LLM. Pure structural assembly.
 */
function generateLlmsTxt({ businessName, description, url, industry, city, state, primaryServices = [], sitemapUrls = [] }) {
  if (!businessName || !url) return null;
  const lines = [];
  lines.push(`# ${businessName}`);
  lines.push('');
  lines.push(`> ${description || `${businessName} provides ${industry || 'local services'} in ${city || 'the local area'}${state ? ', ' + state : ''}.`}`);
  lines.push('');

  if (primaryServices.length) {
    lines.push('## Services');
    lines.push('');
    primaryServices.forEach(s => {
      const linkUrl = s.url || url;
      lines.push(`- [${s.name}](${linkUrl})${s.description ? ': ' + s.description : ''}`);
    });
    lines.push('');
  }

  if (city || state) {
    lines.push('## Service Area');
    lines.push('');
    lines.push(`- ${city || ''}${city && state ? ', ' : ''}${state || ''}`);
    lines.push('');
  }

  if (sitemapUrls.length) {
    lines.push('## Pages');
    lines.push('');
    sitemapUrls.slice(0, 50).forEach(u => {
      const slug = (u.split('/').pop() || u).replace(/\.html?$/, '').replace(/[-_]+/g, ' ');
      const title = slug.charAt(0).toUpperCase() + slug.slice(1);
      lines.push(`- [${title}](${u})`);
    });
    lines.push('');
  }

  lines.push('## Optional');
  lines.push('');
  lines.push(`- [Contact](${url.replace(/\/$/, '')}/contact): how to reach us`);

  return lines.join('\n') + '\n';
}

/**
 * Top-level GEO audit. Returns score, sub-section results, fixes.
 */
function analyzeGeo({ html, robotsTxt, llmsTxtContent, llmsFullTxtContent, businessFacts = {}, url = '' }) {
  const passage = scorePassageCitability(html || '');
  const crawlers = analyzeAiCrawlerAccess(robotsTxt || '');
  const llms = analyzeLlmsTxt(llmsTxtContent, llmsFullTxtContent);

  const blockedCrawlers = Object.entries(crawlers).filter(([, v]) => !v.allowed).map(([k]) => k);
  const crawlersScore = Math.round(((Object.keys(crawlers).length - blockedCrawlers.length) / Object.keys(crawlers).length) * 100);
  const llmsTxtScore = llms.llmsTxt.present ? 100 : 0;

  // Hreflang sub-check (free, no extra fetch). Score=100 (not-applicable)
  // for sites without hreflang so single-region sites aren't penalized.
  let hreflang = null;
  try {
    const { checkHreflang } = require('./hreflangChecker');
    hreflang = checkHreflang({ html: html || '', url });
  } catch {}
  const hreflangScore = hreflang ? hreflang.score : 100;
  const hreflangFindings = hreflang ? hreflang.findings : [];

  // Weighted overall: passage 45%, crawlers 25%, llms.txt 15%, hreflang 15%
  // (only meaningful when applicable; otherwise contributes 100% baseline).
  const overall = Math.round(
    passage.score * 0.45 + crawlersScore * 0.25 + llmsTxtScore * 0.15 + hreflangScore * 0.15
  );
  const status = overall >= 75 ? 'pass' : overall >= 50 ? 'warn' : 'fail';

  const fixes = buildGeoFixes({
    passage,
    crawlers,
    llmsTxtPresent: llms.llmsTxt.present,
    blockedCrawlers,
    businessFacts
  });
  // Merge hreflang findings into the geo fixes array
  for (const hf of hreflangFindings) {
    fixes.push({
      key: hf.key,
      severity: hf.severity,
      title: hf.title,
      detail: hf.detail
    });
  }

  return {
    overallScore: overall,
    status,
    passageCitability: passage,
    aiCrawlerAccess: crawlers,
    blockedCrawlers,
    crawlerAccessScore: crawlersScore,
    llmsTxt: llms.llmsTxt,
    llmsFullTxt: llms.llmsFullTxt,
    llmsTxtScore,
    hreflang,
    hreflangScore,
    weights: { passage: 0.45, crawlers: 0.25, llmsTxt: 0.15, hreflang: 0.15 },
    fixes,
    note: 'GEO scoring: passage extractability, crawler access (GPTBot/ClaudeBot/PerplexityBot/etc), llms.txt standard, hreflang validity. No runtime LLM calls.'
  };
}

function buildGeoFixes({ passage, crawlers, llmsTxtPresent, blockedCrawlers, businessFacts }) {
  const fixes = [];

  if (blockedCrawlers.length > 0) {
    fixes.push({
      key: 'geo-unblock-ai-crawlers',
      severity: 'high',
      title: `${blockedCrawlers.length} AI crawler${blockedCrawlers.length > 1 ? 's are' : ' is'} blocked from your site`,
      detail: `Your robots.txt blocks: ${blockedCrawlers.join(', ')}. AI engines can\u2019t cite content they can\u2019t crawl. Either explicitly allow these user-agents or remove the blanket Disallow that catches them.`,
      copyPasteReady: true,
      snippet: blockedCrawlers.map(name => `User-agent: ${name}\nAllow: /\n`).join('\n'),
      effortMinutes: 5
    });
  }

  if (!llmsTxtPresent) {
    fixes.push({
      key: 'geo-add-llms-txt',
      severity: 'medium',
      title: 'Add an llms.txt file to declare your site to AI engines',
      detail: 'The llms.txt standard (proposed by Anthropic 2024) is the AI-engine equivalent of robots.txt + sitemap.xml. Place at /llms.txt — declares what your site is about, key pages, and how AI engines should reference it. Adoption is rapid; early movers get cited more.',
      copyPasteReady: false,
      effortMinutes: 15,
      generator: 'See /api/generate/llms-txt endpoint for an auto-generated draft from your sitemap + business facts.'
    });
  }

  // Per-block passage fixes
  if (!passage.blocks.qa_blocks.passed) {
    fixes.push({
      key: 'geo-add-qa-blocks',
      severity: 'high',
      title: 'Add Q&A blocks (with FAQ schema) — AI engines lift these verbatim',
      detail: 'Pages with question-answer structure get cited dramatically more often by ChatGPT, Perplexity, and Claude. Use <h3>Question?</h3><p>Answer.</p> structure or HTML <details><summary> blocks. Wrap with FAQPage schema to amplify.',
      copyPasteReady: false,
      effortMinutes: 30
    });
  }
  if (!passage.blocks.definition_blocks.passed) {
    fixes.push({
      key: 'geo-add-definition-blocks',
      severity: 'medium',
      title: 'Add a glossary or "what is X" section',
      detail: 'AI engines cite definition-style content for "what is" and "what does X mean" queries. Add a short glossary section using <dl><dt><dd> markup, or H2 headings shaped as "What is [term]?".',
      copyPasteReady: false,
      effortMinutes: 20
    });
  }
  if (!passage.blocks.list_blocks.passed) {
    fixes.push({
      key: 'geo-add-numbered-lists',
      severity: 'medium',
      title: 'Convert process descriptions into numbered lists',
      detail: 'How-to and step-by-step content shaped as <ol><li> with HowTo schema gets cited as instructions by AI engines. Identify any "first... then... finally" prose on your service pages and reformat.',
      copyPasteReady: false,
      effortMinutes: 25
    });
  }
  if (!passage.blocks.citations.passed) {
    fixes.push({
      key: 'geo-add-citations',
      severity: 'low',
      title: 'Cite authority sources for factual claims',
      detail: 'AI engines weight content with sourced claims. When you state a fact (energy savings, code requirements, statistics), link to a .gov / .edu / industry-authority source.',
      copyPasteReady: false,
      effortMinutes: 30
    });
  }

  return fixes;
}

module.exports = {
  analyzeGeo,
  scorePassageCitability,
  analyzeAiCrawlerAccess,
  analyzeLlmsTxt,
  generateLlmsTxt,
  PASSAGE_PATTERNS,
  AI_CRAWLERS_TO_CHECK
};
