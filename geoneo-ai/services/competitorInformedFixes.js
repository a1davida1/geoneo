/**
 * Competitor-informed fixes. For each audit finding, return up to N
 * peer-cohort domains who have already fixed that gap (i.e., the same
 * finding key is absent from their latest audit) AND who score well overall.
 *
 * Output augments each finding with:
 *   competitorEvidence: {
 *     peersWithFix: [
 *       { domain, overallScore, why: "Same industry, scored X/100, has Y" }
 *     ],
 *     peersTested: <int>,         // how many peers we considered
 *     industryMedianScore: <int>  // median score of all peers in this cohort
 *   }
 *
 * This is the "what 3 of your competitors do that you don't" signal.
 * Closer-friendly — opens with "Joe's Plumbing, Acme Heating, and
 * Branson Drain all have LocalBusiness schema. You don't."
 *
 * No LLM. Pure archive lookup.
 */

const fs = require('fs/promises');
const path = require('path');

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'audit-archive');
const PEER_LIMIT = 3;
const PEER_MIN_SCORE = 60; // peer must score at least this to count as a "good example"
const CACHE_TTL_MS = 5 * 60 * 1000;

let _archiveCache = null;
let _archiveCacheAt = 0;

async function loadAllLatestAudits() {
  let files;
  try {
    files = await fs.readdir(ARCHIVE_DIR);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    try {
      const raw = await fs.readFile(path.join(ARCHIVE_DIR, f), 'utf8');
      const parsed = JSON.parse(raw);
      const latest = parsed.history && parsed.history[0];
      if (!latest || !latest.audit) continue;
      out.push({
        domain: parsed.domain,
        businessName: latest.sourceMeta?.businessName || parsed.domain,
        industry: latest.industry,
        city: latest.city,
        state: latest.state,
        overallScore: latest.audit.overallScore,
        findingKeys: new Set((latest.audit.findings || []).map((f) => f.key))
      });
    } catch {}
  }
  return out;
}

async function getCachedArchive() {
  const now = Date.now();
  if (_archiveCache && (now - _archiveCacheAt) < CACHE_TTL_MS) return _archiveCache;
  _archiveCache = await loadAllLatestAudits();
  _archiveCacheAt = now;
  return _archiveCache;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Build the per-finding competitor evidence object.
 *
 * targetDomain is excluded from peer selection so we don't recommend
 * the target back to itself.
 */
async function evidenceFor(findingKey, { industry = '', excludeDomain = '', peerLimit = PEER_LIMIT } = {}) {
  if (!findingKey) return null;
  const audits = await getCachedArchive();
  const ind = String(industry || '').toLowerCase();
  const excl = String(excludeDomain || '').toLowerCase();

  // Peer cohort: same industry (if specified), exclude target, has audit data
  const peerCohort = audits.filter((a) => {
    if (a.domain === excl) return false;
    if (typeof a.overallScore !== 'number') return false;
    if (ind && (a.industry || '').toLowerCase() !== ind) return false;
    return true;
  });

  if (!peerCohort.length) {
    // Fall back to all-industries cohort if same-industry has nothing
    const generic = audits.filter((a) => a.domain !== excl && typeof a.overallScore === 'number');
    if (!generic.length) return null;
    const peersWithFix = generic.filter((a) => !a.findingKeys.has(findingKey) && a.overallScore >= PEER_MIN_SCORE);
    peersWithFix.sort((a, b) => b.overallScore - a.overallScore);
    return {
      peersWithFix: peersWithFix.slice(0, peerLimit).map((p) => ({
        domain: p.domain,
        businessName: p.businessName,
        overallScore: p.overallScore,
        industry: p.industry,
        why: `${p.industry} (cross-vertical). Scored ${p.overallScore}/100 — has already shipped this fix.`
      })),
      peersTested: generic.length,
      industryMedianScore: median(generic.map((a) => a.overallScore)),
      cohortMatch: 'cross_industry'
    };
  }

  // Peers who DON'T have this finding (i.e., they fixed it) and score well
  const peersWithFix = peerCohort
    .filter((a) => !a.findingKeys.has(findingKey) && a.overallScore >= PEER_MIN_SCORE)
    .sort((a, b) => b.overallScore - a.overallScore);

  return {
    peersWithFix: peersWithFix.slice(0, peerLimit).map((p) => ({
      domain: p.domain,
      businessName: p.businessName,
      overallScore: p.overallScore,
      industry: p.industry,
      city: p.city,
      why: `Same industry${p.city ? ` (${p.city})` : ''}. Scored ${p.overallScore}/100 — already has this fix.`
    })),
    peersTested: peerCohort.length,
    industryMedianScore: median(peerCohort.map((a) => a.overallScore)),
    cohortMatch: 'industry'
  };
}

/**
 * Attach competitorEvidence to each finding in the array. Returns the
 * same array shape with the new field present where data exists.
 */
async function attachCompetitorEvidence(findings, opts = {}) {
  if (!Array.isArray(findings) || !findings.length) return findings;
  return Promise.all(findings.map(async (f) => {
    if (!f || !f.key) return f;
    const evidence = await evidenceFor(f.key, opts);
    return evidence && evidence.peersWithFix.length ? { ...f, competitorEvidence: evidence } : f;
  }));
}

module.exports = {
  evidenceFor,
  attachCompetitorEvidence
};
