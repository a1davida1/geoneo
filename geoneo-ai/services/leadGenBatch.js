const fs = require('fs/promises');
const path = require('path');
const { extractRootDomain } = require('./serpProvider');
const { ahrefsStatus } = require('./ahrefsClient');

const MAX_LEAD_GEN_QUANTITY = 250;
const DEFAULT_LEAD_GEN_QUANTITY = 100;

function leadGenPath() {
  return process.env.GEONEO_LEAD_GEN_PATH
    ? path.resolve(process.env.GEONEO_LEAD_GEN_PATH)
    : path.join(__dirname, '..', 'data', 'lead-gen-runs.json');
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeLeadGenQuantity(value, fallback = DEFAULT_LEAD_GEN_QUANTITY) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < 1) return 1;
  if (n > MAX_LEAD_GEN_QUANTITY) return MAX_LEAD_GEN_QUANTITY;
  return n;
}

function normalizeUrl(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizeDomainToken(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    return extractRootDomain(normalizeUrl(raw));
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function candidateKey(candidate) {
  return normalizeDomainToken(candidate.domain || candidate.website || candidate.url || candidate.companyName || candidate.businessName);
}

function isBusinessCandidate(row) {
  const resultType = normalizeString(row.resultType).toLowerCase();
  const category = normalizeString(row.category).toLowerCase();
  if (resultType && !['local_business', 'business', 'organic_business', 'website'].includes(resultType)) return false;
  if (category && category !== 'business') return false;
  const domain = normalizeDomainToken(row.domain || row.website || row.url);
  if (!domain) return false;
  const blocked = ['yelp.com', 'tripadvisor.com', 'facebook.com', 'bbb.org', 'angi.com', 'homeadvisor.com', 'mapquest.com'];
  return !blocked.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`));
}

function rowToCandidate(row, opts = {}, source = 'market') {
  const domain = normalizeDomainToken(row.domain || row.website || row.url);
  const website = normalizeUrl(row.website || row.url || domain);
  return {
    id: domain,
    domain,
    website,
    businessName: normalizeString(row.businessName || row.companyName || row.name || row.title || domain),
    industry: normalizeString(opts.industry),
    city: normalizeString(opts.city),
    state: normalizeString(opts.state),
    zip: normalizeString(opts.zip),
    source,
    sourceRank: Number(row.rank || row.position || row.firstObservedRank || 0) || null,
    sourceQuery: normalizeString(row.query || row.primaryQuery),
    confidence: Number(row.confidence || row.sourceConfidence || 0) || null,
    resultType: normalizeString(row.resultType || row.category || 'business'),
    notes: normalizeString(row.inclusionReason || row.whyRank || row.notes)
  };
}

function extractLeadGenCandidates(marketModel, opts = {}) {
  const quantity = normalizeLeadGenQuantity(opts.quantity);
  const overview = marketModel?.industryAnalysis?.overview || {};
  const rows = [
    ...(Array.isArray(overview.orderedResults) ? overview.orderedResults : []),
    ...(Array.isArray(overview.rawVisibleResults) ? overview.rawVisibleResults : []),
    ...(Array.isArray(marketModel?.competitors) ? marketModel.competitors : [])
  ];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row || !isBusinessCandidate(row)) continue;
    const candidate = rowToCandidate(row, opts);
    const key = candidateKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= quantity) break;
  }
  return out;
}

function assessSeoProvider(input = {}) {
  const html = normalizeString(input.html || input.visibleText || input.auditText).toLowerCase();
  const title = normalizeString(input.pageTitle || input.title).toLowerCase();
  const audit = input.auditResult || {};
  const seoSignals = audit?.siteProfile?.seoSignals || {};
  const googleSeo = Number(audit?.googleGrades?.seo);
  const signals = [];

  const agencyPatterns = [
    /website (?:by|design(?:ed)? by|powered by) [a-z0-9 .,&-]*(agency|marketing|media|seo|web)/i,
    /(digital marketing|seo agency|web design agency|marketing agency)/i,
    /(brightlocal|scorpion|thryv|hennessey|rankings\.io|blue corona|revlocal|webfx)/i
  ];
  const proPatterns = [
    /(yoast seo|rank math|all in one seo|semrush|schema\.org|localbusiness)/i,
    /(google tag manager|gtm-|google analytics|dataLayer)/i,
    /(wordpress|wp-content|elementor|divi|webflow|squarespace)/i
  ];
  const diyPatterns = [
    /<title>\s*(home|welcome)\s*<\/title>/i,
    /(wixsite|godaddysites|weebly|sites\.google\.com)/i
  ];

  for (const pattern of agencyPatterns) {
    if (pattern.test(html) || pattern.test(title)) signals.push({ type: 'agency', evidence: pattern.toString() });
  }
  for (const pattern of proPatterns) {
    if (pattern.test(html) || pattern.test(title)) signals.push({ type: 'pro', evidence: pattern.toString() });
  }
  for (const pattern of diyPatterns) {
    if (pattern.test(html) || pattern.test(title)) signals.push({ type: 'diy', evidence: pattern.toString() });
  }
  if (Number(seoSignals.schemaCount || 0) > 0 && (seoSignals.canonical || seoSignals.robotsMeta || seoSignals.sitemap)) {
    signals.push({ type: 'pro', evidence: 'Structured data plus canonical/robots/sitemap signals present.' });
  }
  if (Number.isFinite(googleSeo) && googleSeo >= 85) {
    signals.push({ type: 'pro', evidence: `Google SEO grade is strong (${googleSeo}/100).` });
  }
  if (Number.isFinite(googleSeo) && googleSeo < 55 && Number(seoSignals.schemaCount || 0) === 0 && !seoSignals.canonical) {
    signals.push({ type: 'diy', evidence: `Low SEO grade (${googleSeo}/100) with missing core technical SEO signals.` });
  }

  if (signals.some((s) => s.type === 'agency')) {
    return { classification: 'agency', confidence: 'high', evidence: signals.filter((s) => s.type === 'agency').map((s) => s.evidence).slice(0, 4) };
  }
  if (signals.some((s) => s.type === 'pro')) {
    return { classification: 'pro', confidence: 'medium', evidence: signals.filter((s) => s.type === 'pro').map((s) => s.evidence).slice(0, 4) };
  }
  if (signals.some((s) => s.type === 'diy')) {
    return { classification: 'diy_local', confidence: 'medium', evidence: signals.filter((s) => s.type === 'diy').map((s) => s.evidence).slice(0, 4) };
  }
  if (!html && !title) {
    return { classification: 'unknown', confidence: 'low', evidence: ['No page HTML/title available for attribution.'] };
  }
  return { classification: 'unknown', confidence: 'low', evidence: ['No clear SEO provider footprint detected.'] };
}

function uniqueMatches(text, regex, limit = 5) {
  const seen = new Set();
  const out = [];
  let match = regex.exec(text);
  while (match && out.length < limit) {
    const value = normalizeString(match[0]);
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push(value);
    }
    match = regex.exec(text);
  }
  return out;
}

function extractContactInfo(input = {}) {
  const text = normalizeString(input.text || input.html || input.visibleText);
  const signals = input?.auditResult?.siteProfile?.contactSignals || {};
  const phones = uniqueMatches(text, /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g, 5);
  const emails = uniqueMatches(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 5);
  const hasPhone = Boolean(signals.phone || phones.length);
  const hasEmail = Boolean(signals.email || emails.length);
  const hasAddress = Boolean(signals.address);
  const hasStrongCta = Boolean(signals.strongCta);
  const score = Math.min(100,
    (hasPhone ? 35 : 0) +
    (hasEmail ? 35 : 0) +
    (hasAddress ? 15 : 0) +
    (hasStrongCta ? 15 : 0)
  );
  const bestChannel = hasEmail ? 'email' : (hasPhone ? 'phone' : 'research_needed');
  return {
    score,
    hasPhone,
    hasEmail,
    hasAddress,
    hasStrongCta,
    phones,
    emails,
    bestChannel
  };
}

function scoreLeadOpportunity({ candidate = {}, scores = {}, contactInfo = {}, seoProvider = {} } = {}) {
  const overall = Number(scores.overall ?? scores.visibilityScore ?? 0) || 0;
  const seo = Number(scores.seo || 0) || 0;
  const ai = Number(scores.ai || scores.aiVisibility || 0) || 0;
  const geo = Number(scores.geo || scores.localPresence || 0) || 0;
  const reasons = [];
  let score = 0;

  if (overall && overall < 50) {
    score += 34;
    reasons.push(`Weak audit score (${overall}/100).`);
  } else if (overall && overall < 70) {
    score += 22;
    reasons.push(`Mid audit score (${overall}/100) with room to improve.`);
  } else if (overall) {
    score += 6;
    reasons.push(`Strong site (${overall}/100), harder sell.`);
  } else {
    score += 12;
    reasons.push('Audit score unavailable; review manually.');
  }

  const weakPillars = [
    seo && seo < 60 ? `SEO ${seo}` : '',
    ai && ai < 60 ? `AI ${ai}` : '',
    geo && geo < 60 ? `GEO ${geo}` : ''
  ].filter(Boolean);
  if (weakPillars.length) {
    score += Math.min(20, weakPillars.length * 8);
    reasons.push(`Weak pillars: ${weakPillars.join(', ')}.`);
  }

  const rank = Number(candidate.sourceRank || 0);
  if (rank > 0 && rank <= 5) {
    score += 12;
    reasons.push(`Already visible at rank ${rank}, easier to sell improvement.`);
  } else if (rank > 10) {
    score += 5;
    reasons.push(`Lower visibility at rank ${rank}.`);
  }

  const contactScore = Number(contactInfo.score || 0);
  if (contactScore >= 70) {
    score += 16;
    reasons.push('Contact path is ready.');
  } else if (contactScore >= 35) {
    score += 8;
    reasons.push('Partial contact path found.');
  } else {
    reasons.push('Contact info needs research.');
  }

  if (seoProvider.classification === 'diy_local' || seoProvider.classification === 'unknown') {
    score += 14;
    reasons.push('No strong agency footprint detected.');
  } else if (seoProvider.classification === 'pro') {
    score += 6;
    reasons.push('Some SEO tooling present, but not clearly agency-managed.');
  } else if (seoProvider.classification === 'agency') {
    score -= 12;
    reasons.push('Agency footprint detected; tougher replacement sale.');
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tier = clamped >= 72 ? 'hot' : (clamped >= 48 ? 'warm' : 'cold');
  return { score: clamped, tier, reasons: reasons.slice(0, 6) };
}

function buildOutreachPlan({ candidate = {}, scores = {}, leadScore = {}, seoProvider = {}, contactInfo = {} } = {}) {
  const business = normalizeString(candidate.businessName || candidate.domain || 'your business');
  const industry = normalizeString(candidate.industry || 'your market');
  const location = [candidate.city, candidate.state].filter(Boolean).join(', ') || 'your area';
  const overall = Number(scores.overall || 0) || 'unknown';
  const seoLabel = seoProvider.classification
    ? seoProvider.classification.replace(/_/g, ' ')
    : 'unknown';
  const emailSubject = `${business}: quick ${location} visibility audit note`;
  const emailOpening = `I ran a GeoNeo scan for ${business} in ${location}. Your visibility score came back ${overall}/100, and the strongest sales angle is: ${(leadScore.reasons || [])[0] || 'there are visible search gaps competitors can exploit.'}`;
  const offer = `I can send the exact fixes that would help a ${industry} business show up better in Google, Maps, and AI answers.`;
  const callReadiness = contactInfo.hasPhone
    ? 'ready_for_ai_call'
    : (contactInfo.hasEmail ? 'email_first' : 'research_needed');
  const nextBestAction = callReadiness === 'ready_for_ai_call'
    ? 'Email first, then route replies to AI appointment-setting call.'
    : (callReadiness === 'email_first' ? 'Send email and request best phone number for scheduling.' : 'Research contact info before outreach.');
  return {
    emailSubject,
    emailOpening,
    offer,
    callReadiness,
    nextBestAction,
    seoAngle: `SEO footprint appears: ${seoLabel}.`
  };
}

const ALL_PARTY_RECORDING_STATES = new Set(['CA', 'CT', 'DE', 'FL', 'IL', 'MD', 'MA', 'MT', 'NV', 'NH', 'PA', 'WA']);
const EXTRA_AI_DISCLOSURE_STATES = new Set(['CA', 'CO', 'CT', 'IL', 'MD', 'MA', 'NY', 'PA', 'TX', 'UT', 'WA']);

function getAiCallComplianceForState(stateInput) {
  const state = normalizeString(stateInput).toUpperCase();
  const recordingConsent = ALL_PARTY_RECORDING_STATES.has(state) ? 'all_party' : 'one_party';
  const needsAiDisclosure = EXTRA_AI_DISCLOSURE_STATES.has(state);
  const aiCallRisk = recordingConsent === 'all_party' || needsAiDisclosure ? 'high' : 'medium';
  const requirements = [
    'TCPA: do not use artificial/prerecorded voice or autodialed marketing calls without proper prior express consent.',
    'Honor federal and state Do Not Call rules and internal suppression lists.',
    'Email reply or explicit opt-in should be captured before routing a prospect to AI appointment-setting calls.',
    recordingConsent === 'all_party'
      ? 'Call recording/transcription: all-party consent state. Disclose recording/transcription and get consent before proceeding.'
      : 'Call recording/transcription: one-party consent state, but disclosure is still recommended for AI-assisted calls.',
    needsAiDisclosure
      ? 'AI disclosure recommended/required risk flag: clearly disclose that an automated/AI assistant may participate.'
      : 'AI disclosure still recommended even where state-specific AI-call law is unclear.'
  ];
  return {
    state: state || 'UNKNOWN',
    recordingConsent,
    needsAiDisclosure,
    aiCallRisk,
    requirements,
    disclaimer: 'Operational guidance only, not legal advice. Confirm campaign rules with counsel before live dialing.'
  };
}

const INDUSTRY_VALUE = {
  attorney: 180,
  lawyer: 180,
  roofing: 120,
  dentist: 95,
  hvac: 90,
  plumber: 80,
  plumbing: 80,
  electrician: 75,
  restoration: 140,
  hotel: 55,
  restaurant: 35,
  towing: 65,
  default: 60
};

function estimateOpportunityValue(industry, leadScore = {}) {
  const key = normalizeString(industry).toLowerCase();
  const base = INDUSTRY_VALUE[key] || INDUSTRY_VALUE.default;
  const multiplier = leadScore.tier === 'hot' ? 18 : (leadScore.tier === 'warm' ? 10 : 5);
  const mid = Math.round(base * multiplier);
  return {
    low: Math.round(mid * 0.55),
    high: Math.round(mid * 1.45),
    basis: `Estimated from ${key || 'default'} value proxy and ${leadScore.tier || 'unscored'} lead tier.`
  };
}

function getAhrefsIntegrationStatus(env = process.env) {
  return ahrefsStatus(env);
}

function buildAdvancedLeadInsights({ candidate = {}, scores = {}, leadScore = {}, contactInfo = {}, seoProvider = {} } = {}) {
  const aiCallCompliance = getAiCallComplianceForState(candidate.state);
  const estimatedOpportunity = estimateOpportunityValue(candidate.industry, leadScore);
  const canEmail = Boolean(contactInfo.hasEmail);
  const canCall = Boolean(contactInfo.hasPhone);
  const pipelineStage = leadScore.tier === 'hot' && canEmail && canCall
    ? 'email_then_ai_call_candidate'
    : (canEmail ? 'email_nurture' : (canCall ? 'manual_phone_research' : 'research_contact_info'));
  const ideas = [
    'Prioritize hot leads with weak audit scores, visible rankings, and no agency footprint.',
    'Send a short audit-result email first; only route replies/opt-ins to AI appointment-setting calls.',
    'Use contact readiness to split email-first, call-ready, and research-needed queues.',
    'Suppress agency-managed sites unless the audit score is weak enough to justify a replacement pitch.',
    'Export hot/ready rows to your outbound platform and keep cold rows for retargeting.',
    'Use owner name and years-in-business fields to personalize first-line copy.',
    'Review all-party consent states before AI calls or recording/transcription.'
  ];
  return {
    aiCallCompliance,
    estimatedOpportunity,
    pipelineStage,
    ideas,
    ahrefs: getAhrefsIntegrationStatus(),
    riskFlags: [
      aiCallCompliance.aiCallRisk === 'high' ? 'High call compliance risk: require explicit consent and disclosure.' : '',
      seoProvider.classification === 'agency' ? 'Agency footprint detected: harder close.' : '',
      !canEmail && !canCall ? 'No direct contact path found.' : '',
      Number(scores.overall || 0) > 80 ? 'Strong audit score: lower pain angle.' : ''
    ].filter(Boolean)
  };
}

async function loadStore() {
  try {
    const raw = await fs.readFile(leadGenPath(), 'utf8');
    if (!raw.trim()) return { runs: [] };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { runs: parsed };
    return { runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
  } catch {
    return { runs: [] };
  }
}

async function saveStore(store) {
  const file = leadGenPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ runs: store.runs || [] }, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

function normalizeCandidate(candidate, context) {
  const domain = candidateKey(candidate);
  return {
    ...candidate,
    id: domain,
    domain,
    website: normalizeUrl(candidate.website || candidate.url || domain),
    businessName: normalizeString(candidate.businessName || candidate.companyName || candidate.name || domain),
    industry: normalizeString(candidate.industry || context.industry),
    city: normalizeString(candidate.city || context.city),
    state: normalizeString(candidate.state || context.state),
    zip: normalizeString(candidate.zip || context.zip),
    status: candidate.status || 'pending',
    decision: candidate.decision || {
      keep: false,
      tags: [],
      notes: '',
      ownerName: '',
      yearsInBusiness: '',
      seoProviderOverride: ''
    }
  };
}

async function createLeadGenRun(input = {}) {
  const now = new Date().toISOString();
  const quantity = normalizeLeadGenQuantity(input.quantity);
  const context = {
    industry: normalizeString(input.industry),
    city: normalizeString(input.city),
    state: normalizeString(input.state),
    zip: normalizeString(input.zip)
  };
  const candidates = (Array.isArray(input.candidates) ? input.candidates : [])
    .map((candidate) => normalizeCandidate(candidate, context))
    .filter((candidate) => candidate.domain)
    .slice(0, quantity);
  const run = {
    id: input.id || `leadgen_${now.replace(/[-:.TZ]/g, '').slice(0, 14)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    status: input.status || 'queued',
    quantity,
    useAhrefs: Boolean(input.useAhrefs),
    ahrefs: {
      requested: Boolean(input.useAhrefs),
      ...getAhrefsIntegrationStatus()
    },
    ...context,
    candidates,
    summary: {
      total: candidates.length,
      completed: 0,
      failed: 0,
      kept: 0
    }
  };
  const store = await loadStore();
  store.runs.unshift(run);
  store.runs = store.runs.slice(0, 100);
  await saveStore(store);
  return run;
}

async function getLeadGenRun(runId) {
  const store = await loadStore();
  return store.runs.find((run) => run.id === runId) || null;
}

async function updateLeadGenRun(runId, updater) {
  const store = await loadStore();
  const index = store.runs.findIndex((run) => run.id === runId);
  if (index === -1) return null;
  const next = updater({ ...store.runs[index] });
  next.updatedAt = new Date().toISOString();
  next.summary = summarizeRun(next);
  store.runs[index] = next;
  await saveStore(store);
  return next;
}

function summarizeRun(run) {
  const candidates = Array.isArray(run.candidates) ? run.candidates : [];
  return {
    total: candidates.length,
    completed: candidates.filter((c) => c.status === 'complete').length,
    failed: candidates.filter((c) => c.status === 'failed').length,
    kept: candidates.filter((c) => c.decision && c.decision.keep).length,
    hot: candidates.filter((c) => c.leadScore && c.leadScore.tier === 'hot').length,
    warm: candidates.filter((c) => c.leadScore && c.leadScore.tier === 'warm').length,
    readyForCall: candidates.filter((c) => c.outreachPlan && c.outreachPlan.callReadiness === 'ready_for_ai_call').length
  };
}

async function updateCandidateResult(runId, domain, patch) {
  const key = normalizeDomainToken(domain);
  return updateLeadGenRun(runId, (run) => {
    run.candidates = (run.candidates || []).map((candidate) => (
      normalizeDomainToken(candidate.domain) === key ? { ...candidate, ...patch } : candidate
    ));
    return run;
  });
}

async function saveLeadGenDecision(runId, domain, decision = {}) {
  const key = normalizeDomainToken(domain);
  let updatedDecision = null;
  await updateLeadGenRun(runId, (run) => {
    run.candidates = (run.candidates || []).map((candidate) => {
      if (normalizeDomainToken(candidate.domain) !== key) return candidate;
      updatedDecision = {
        keep: Boolean(decision.keep),
        tags: Array.isArray(decision.tags)
          ? decision.tags.map(normalizeString).filter(Boolean).slice(0, 20)
          : [],
        notes: normalizeString(decision.notes).slice(0, 5000),
        ownerName: normalizeString(decision.ownerName).slice(0, 200),
        yearsInBusiness: normalizeString(decision.yearsInBusiness).slice(0, 40),
        seoProviderOverride: normalizeString(decision.seoProviderOverride).slice(0, 80),
        updatedAt: new Date().toISOString()
      };
      return { ...candidate, decision: updatedDecision };
    });
    return run;
  });
  return updatedDecision;
}

module.exports = {
  MAX_LEAD_GEN_QUANTITY,
  DEFAULT_LEAD_GEN_QUANTITY,
  normalizeLeadGenQuantity,
  normalizeDomainToken,
  extractLeadGenCandidates,
  assessSeoProvider,
  extractContactInfo,
  scoreLeadOpportunity,
  buildOutreachPlan,
  getAiCallComplianceForState,
  buildAdvancedLeadInsights,
  getAhrefsIntegrationStatus,
  createLeadGenRun,
  getLeadGenRun,
  updateLeadGenRun,
  updateCandidateResult,
  saveLeadGenDecision,
  summarizeRun
};
