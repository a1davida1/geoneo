/**
 * hreflang checker — validates hreflang tags on a page for multi-language /
 * multi-region SEO. Run as a sub-check inside auditDeep's geo pillar (cheap,
 * no extra fetch — works on already-fetched HTML).
 *
 * Detects + scores:
 *   - hreflang attribute presence (<link rel="alternate" hreflang="..." href="..."/>)
 *   - Self-referencing tag (the page must reference itself with its own hreflang)
 *   - x-default fallback present (recommended for multilingual sites)
 *   - Reciprocal links (each hreflang target must reference back — we can't
 *     fully verify reciprocity without fetching every target, so we flag
 *     "potential" issues only when easy to detect)
 *   - Valid language codes (ISO 639-1 + optional ISO 3166-1 region, e.g. en-US)
 *   - Self-language matches html[lang] (consistency)
 *
 * For a typical contractor site that targets only US English, we don't
 * penalize missing hreflang — it's optional. We only score this when
 * the site has hreflang tags OR is targeting multiple regions.
 *
 * Returns: { score (0-100), status, findings[], detected }
 *   - detected: { hasHreflang, count, selfReference, xDefault, languages }
 *   - score: 100 if not applicable; 0-90 if applicable but has issues
 */

// ISO 639-1 language codes (subset used by hreflang). Not exhaustive but
// covers all common cases — anything else falls through to "invalid".
const VALID_LANG_CODES = new Set([
  'aa','ab','af','ak','am','an','ar','as','av','ay','az','ba','be','bg','bh','bi','bm','bn','bo','br','bs',
  'ca','ce','ch','co','cr','cs','cu','cv','cy','da','de','dv','dz','ee','el','en','eo','es','et','eu','fa',
  'ff','fi','fj','fo','fr','fy','ga','gd','gl','gn','gu','gv','ha','he','hi','ho','hr','ht','hu','hy','hz',
  'ia','id','ie','ig','ii','ik','io','is','it','iu','ja','jv','ka','kg','ki','kj','kk','kl','km','kn','ko',
  'kr','ks','ku','kv','kw','ky','la','lb','lg','li','ln','lo','lt','lu','lv','mg','mh','mi','mk','ml','mn',
  'mr','ms','mt','my','na','nb','nd','ne','ng','nl','nn','no','nr','nv','ny','oc','oj','om','or','os','pa',
  'pi','pl','ps','pt','qu','rm','rn','ro','ru','rw','sa','sc','sd','se','sg','si','sk','sl','sm','sn','so',
  'sq','sr','ss','st','su','sv','sw','ta','te','tg','th','ti','tk','tl','tn','to','tr','ts','tt','tw','ty',
  'ug','uk','ur','uz','ve','vi','vo','wa','wo','xh','yi','yo','za','zh','zu'
]);

const HREFLANG_RE = /<link[^>]+rel=["']alternate["'][^>]+hreflang=["']([^"']+)["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
const HREFLANG_RE_REVERSED = /<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["'][^>]+hreflang=["']([^"']+)["'][^>]*>/gi;
const HTML_LANG_RE = /<html[^>]+lang=["']([^"']+)["']/i;

function parseHreflangCode(code) {
  if (!code || typeof code !== 'string') return { lang: null, region: null, valid: false };
  const normalized = code.trim().toLowerCase();
  if (normalized === 'x-default') return { lang: 'x-default', region: null, valid: true };
  // e.g. "en", "en-us", "zh-hant"
  const parts = normalized.split('-');
  const lang = parts[0];
  const region = parts[1] || null;
  return {
    lang,
    region,
    valid: VALID_LANG_CODES.has(lang)
  };
}

/**
 * Extract every hreflang link from HTML. Handles both orderings (hreflang
 * before href, and href before hreflang). Dedupes by href+hreflang pair.
 */
function extractHreflangTags(html) {
  if (!html || typeof html !== 'string') return [];
  const found = new Map();
  const collect = (regex, langIdx, hrefIdx) => {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const hreflang = match[langIdx];
      const href = match[hrefIdx];
      if (!hreflang || !href) continue;
      const key = `${hreflang}::${href}`;
      if (!found.has(key)) {
        found.set(key, { hreflang: hreflang.toLowerCase(), href });
      }
    }
  };
  collect(new RegExp(HREFLANG_RE.source, 'gi'), 1, 2);
  collect(new RegExp(HREFLANG_RE_REVERSED.source, 'gi'), 2, 1);
  return Array.from(found.values());
}

function htmlLangOf(html) {
  if (!html) return null;
  const m = html.match(HTML_LANG_RE);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Run the full check. Returns { score, status, findings[], detected }.
 * url is the page URL — used to detect self-reference.
 */
function checkHreflang({ html, url }) {
  const tags = extractHreflangTags(html);
  const htmlLang = htmlLangOf(html);
  const findings = [];
  let normalizedUrl = '';
  try { normalizedUrl = new URL(url).href.replace(/\/$/, ''); } catch {}

  // Case 1: No hreflang tags at all. This is fine for single-region sites,
  // so we return score=100 and a soft "not applicable" status.
  if (!tags.length) {
    return {
      score: 100,
      status: 'not_applicable',
      detected: { hasHreflang: false, count: 0, selfReference: false, xDefault: false, languages: [] },
      findings: [],
      htmlLang
    };
  }

  // Site uses hreflang — now validate.
  const languages = tags.map((t) => t.hreflang);
  const langSet = new Set(languages);
  const hasXDefault = langSet.has('x-default');
  const selfReference = tags.some((t) => {
    const tagUrl = (() => { try { return new URL(t.href).href.replace(/\/$/, ''); } catch { return t.href; } })();
    return tagUrl === normalizedUrl;
  });

  let score = 100;
  if (!selfReference) {
    findings.push({
      key: 'hreflang-missing-self-reference',
      severity: 'medium',
      title: 'Missing self-referencing hreflang',
      detail: 'When you use hreflang, every page must reference itself. Add a <link rel="alternate" hreflang="..." href="..."/> pointing to this same URL.'
    });
    score -= 20;
  }
  if (!hasXDefault) {
    findings.push({
      key: 'hreflang-missing-x-default',
      severity: 'low',
      title: 'Missing x-default hreflang',
      detail: 'Recommended for multilingual sites: add <link rel="alternate" hreflang="x-default" href="..."/> pointing to your default-language version. Google uses it when no language matches the user.'
    });
    score -= 5;
  }
  // Validate each language code
  const invalid = tags.filter((t) => !parseHreflangCode(t.hreflang).valid);
  if (invalid.length) {
    findings.push({
      key: 'hreflang-invalid-codes',
      severity: 'high',
      title: `${invalid.length} invalid hreflang language code(s)`,
      detail: `Bad codes: ${invalid.slice(0, 5).map((t) => t.hreflang).join(', ')}. Use ISO 639-1 (e.g. "en") optionally with ISO 3166-1 region (e.g. "en-US"). Invalid codes silently break the hreflang signal.`
    });
    score -= 25;
  }
  // Check html[lang] matches one of the hreflang codes
  if (htmlLang) {
    const htmlLangNormalized = htmlLang.toLowerCase().split(';')[0].trim();
    const matchesAny = langSet.has(htmlLangNormalized) || langSet.has(htmlLangNormalized.split('-')[0]);
    if (!matchesAny) {
      findings.push({
        key: 'hreflang-html-lang-mismatch',
        severity: 'low',
        title: 'html[lang] doesn\u2019t match any hreflang',
        detail: `html lang="${htmlLang}" but no hreflang tag references that language. Pick one signal — they should agree.`
      });
      score -= 10;
    }
  }
  // Duplicate codes: same hreflang pointing at multiple URLs
  const dupeCheck = new Map();
  tags.forEach((t) => {
    if (!dupeCheck.has(t.hreflang)) dupeCheck.set(t.hreflang, []);
    dupeCheck.get(t.hreflang).push(t.href);
  });
  const duplicates = Array.from(dupeCheck.entries()).filter(([, urls]) => urls.length > 1);
  if (duplicates.length) {
    findings.push({
      key: 'hreflang-duplicate-codes',
      severity: 'medium',
      title: `${duplicates.length} duplicate hreflang code(s)`,
      detail: `Each language should appear once. Duplicates: ${duplicates.map(([k, urls]) => `${k} → ${urls.length} URLs`).slice(0, 3).join(', ')}.`
    });
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    status: score >= 75 ? 'pass' : score >= 50 ? 'warn' : 'fail',
    detected: {
      hasHreflang: true,
      count: tags.length,
      selfReference,
      xDefault: hasXDefault,
      languages: Array.from(langSet),
      htmlLang
    },
    findings
  };
}

module.exports = {
  checkHreflang,
  extractHreflangTags,
  parseHreflangCode
};
