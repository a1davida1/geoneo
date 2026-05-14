/**
 * Qualifier — interactive 5-question funnel that double-acts as:
 *   1. Lead-bucketing for sales (HOT / WARM / COLD with persona attached)
 *   2. Real-time positioning (each answer changes what the page says next)
 *
 * The questions are deliberately calibrated so the answers feed an
 * 8-bucket scoring model that maps cleanly to our existing 8 closer-sheet
 * personas + 5-tier pricing ladder. Server-side scoring only — never trust
 * the browser.
 *
 * Tokens: HMAC-SHA256 signed payloads with embedded TTL. Each email-blast
 * recipient gets a unique token so submissions can't be spoofed and we can
 * track which prospect responded. Tokens are URL-safe (base64url).
 *
 * Idempotency: multiple submits with the same token edit the same record
 * within EDIT_WINDOW_MS (24h). After that, submits are accepted as
 * follow-ups but flagged.
 *
 * Storage: data/qualifier-responses.json keyed by token. Plus archive
 * side-channel mark via auditArchive.recordQualifierCompleted.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const STORE_PATH = path.join(__dirname, '..', 'data', 'qualifier-responses.json');
const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;    // 24h

// Secret comes from env. In dev, fall back to a stable per-machine string so
// dev tokens survive restarts. Prod MUST set GEONEO_QUALIFIER_SECRET.
function getSecret() {
  return process.env.GEONEO_QUALIFIER_SECRET || process.env.GEONEO_INTERNAL_API_SECRET || 'geoneo-dev-qualifier-secret-rotate-in-prod';
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  const pad = str.length % 4 === 0 ? 0 : 4 - (str.length % 4);
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad), 'base64');
}

/**
 * Sign a payload (domain + runId + expiresAt) so the qualifier link can be
 * embedded in an email and verified server-side without lookup.
 */
function signQualifierToken({ domain, runId = null, ttlMs = TOKEN_TTL_MS }) {
  const payload = {
    d: String(domain).toLowerCase(),
    r: runId || null,
    e: Date.now() + ttlMs
  };
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', getSecret()).update(json).digest();
  return `${base64url(json)}.${base64url(sig)}`;
}

function verifyQualifierToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, error: 'malformed' };
  }
  const [payloadB64, sigB64] = token.split('.');
  let payload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString('utf8'));
  } catch {
    return { valid: false, error: 'payload_parse' };
  }
  const expectedSig = crypto.createHmac('sha256', getSecret()).update(JSON.stringify(payload)).digest();
  let providedSig;
  try {
    providedSig = fromBase64url(sigB64);
  } catch {
    return { valid: false, error: 'sig_parse' };
  }
  if (expectedSig.length !== providedSig.length || !crypto.timingSafeEqual(expectedSig, providedSig)) {
    return { valid: false, error: 'bad_signature' };
  }
  if (typeof payload.e !== 'number' || payload.e < Date.now()) {
    return { valid: false, error: 'expired' };
  }
  return {
    valid: true,
    domain: payload.d,
    runId: payload.r,
    expiresAt: payload.e
  };
}

/**
 * Question definitions. Server is authoritative — keep these here so the UI
 * can be regenerated at any time without needing a separate config.
 */
const QUESTIONS = [
  {
    id: 'need_ack',
    title: 'Looking at your audit score, do you see this is costing you customers?',
    why: 'Confirms the prospect has internalized the audit findings. "No" = they don\'t see the problem yet, qualify accordingly.',
    options: [
      { value: 'need_ack_yes_lots', label: 'Yes — and it\u2019s probably costing me a lot', score: 4 },
      { value: 'need_ack_yes_some', label: 'Yes — some impact, but I\u2019m not sure how much', score: 3 },
      { value: 'need_ack_unsure', label: 'Maybe — I\u2019d need to see more data', score: 2 },
      { value: 'need_ack_no', label: 'No — I think we\u2019re fine', score: 0, hardDisqualify: true }
    ]
  },
  {
    id: 'wtp',
    title: 'To recover even half of that monthly gap, what\u2019s a reasonable monthly investment?',
    why: 'Anchors willingness-to-pay. Cheaper-than-coffee answers self-select out of being a real prospect.',
    options: [
      { value: 'wtp_lt200', label: 'Under $200/mo', score: 1 },
      { value: 'wtp_200_500', label: '$200 – $500/mo', score: 2 },
      { value: 'wtp_500_1500', label: '$500 – $1,500/mo', score: 3 },
      { value: 'wtp_1500_plus', label: '$1,500+/mo', score: 4 },
      { value: 'wtp_zero', label: 'Nothing — not interested in paying', score: 0, hardDisqualify: true }
    ]
  },
  {
    id: 'spend',
    title: 'What do you currently spend per month on marketing or SEO?',
    why: 'Tells us if there\u2019s an existing vendor budget to displace, or if this is greenfield.',
    options: [
      { value: 'spend_0', label: 'Nothing', score: 0 },
      { value: 'spend_lt300', label: 'Under $300/mo', score: 1 },
      { value: 'spend_300_1500', label: '$300 – $1,500/mo', score: 2 },
      { value: 'spend_1500_5000', label: '$1,500 – $5,000/mo', score: 3 },
      { value: 'spend_5000_plus', label: '$5,000+/mo', score: 4 }
    ]
  },
  {
    id: 'satisfaction',
    title: 'How happy are you with what you\u2019re getting for that money?',
    why: 'Frustration is the single biggest buy signal for the Bar-Friend Victim and Escapee personas.',
    showIf: { spend: ['spend_lt300', 'spend_300_1500', 'spend_1500_5000', 'spend_5000_plus'] },
    options: [
      { value: 'sat_very_happy', label: 'Very happy — keep what works', score: 1 },
      { value: 'sat_ok', label: 'It\u2019s OK, mixed feelings', score: 2 },
      { value: 'sat_frustrated', label: 'Frustrated — not seeing results', score: 3 },
      { value: 'sat_switching', label: 'Actively looking to switch vendors', score: 4 }
    ]
  },
  {
    id: 'horizon',
    title: 'When do you want to fix this?',
    why: 'Time horizon separates buyers from researchers and tells closer when to follow up.',
    options: [
      { value: 'horizon_week', label: 'This week', score: 4 },
      { value: 'horizon_quarter', label: 'This quarter', score: 3 },
      { value: 'horizon_sometime', label: 'Sometime', score: 2 },
      { value: 'horizon_research', label: 'Just researching', score: 1 }
    ]
  },
  {
    id: 'authority',
    title: 'Who decides on marketing at your business?',
    why: 'Decision authority drives whether to push for a call or send a written proposal first.',
    options: [
      { value: 'auth_me', label: 'Just me', score: 3 },
      { value: 'auth_partner', label: 'Me + a partner', score: 2 },
      { value: 'auth_convince', label: 'I\u2019d need to convince someone', score: 1 }
    ]
  }
];

const QUESTION_INDEX = new Map(QUESTIONS.map((q) => [q.id, q]));
const VALID_OPTION_VALUES = new Map(QUESTIONS.map((q) => [q.id, new Set(q.options.map((o) => o.value))]));

/** Validate + normalize an answers object. Throws on invalid. */
function validateAnswers(answersInput) {
  if (!answersInput || typeof answersInput !== 'object') throw new Error('answers must be an object');
  const out = {};
  for (const q of QUESTIONS) {
    const provided = answersInput[q.id];
    if (provided === undefined || provided === null || provided === '') {
      // Conditional-show questions are allowed to be absent if the gate
      // condition isn't satisfied — checked below
      out[q.id] = null;
      continue;
    }
    if (!VALID_OPTION_VALUES.get(q.id).has(provided)) {
      throw new Error(`invalid value for ${q.id}: ${provided}`);
    }
    out[q.id] = provided;
  }
  // Enforce showIf gate: skipped questions are OK only when their gate fails
  for (const q of QUESTIONS) {
    if (out[q.id] !== null) continue; // answered
    if (!q.showIf) throw new Error(`missing required answer: ${q.id}`);
    const [gateKey, gateValues] = Object.entries(q.showIf)[0];
    const gateAnswer = out[gateKey];
    if (gateAnswer && gateValues.includes(gateAnswer)) {
      throw new Error(`missing required answer: ${q.id}`);
    }
    // gate not satisfied → answer legitimately missing
  }
  return out;
}

/**
 * The bucket scoring engine. Maps {answers, audit} → bucket + persona +
 * recommendedTier + nextStep + score.
 *
 * Bucket precedence (first match wins):
 *   1. cold_happy        — currently very happy with vendor → not a buyer
 *   2. cold_tire_kicker  — won't pay anything + has no current spend
 *   3. cold_no_authority — needs to convince + no other strong HOT signal
 *   4. hot_escapee       — paying $1500+ + frustrated/switching
 *   5. hot_bar_friend    — paying $300-1500 + frustrated/switching
 *   6. hot_new_high_intent — not paying, willing $500+, ready this quarter
 *   7. warm_latecomer    — not paying, willing $200-500, this quarter
 *   8. warm_researcher   — anyone else with willingness ≥ $200 + audit score < 65
 *   9. cold_unknown      — fallback
 */
function scoreAnswers(answers, audit = null) {
  const wtp = getOptionScore('wtp', answers.wtp);
  const spend = getOptionScore('spend', answers.spend);
  const sat = getOptionScore('satisfaction', answers.satisfaction);
  const horizon = getOptionScore('horizon', answers.horizon);
  const authority = getOptionScore('authority', answers.authority);
  const needAck = getOptionScore('need_ack', answers.need_ack);
  const overallScore = audit?.overallScore ?? null;
  const dollarHigh = audit?.dollarOpportunity?.monthly?.high ?? null;

  // HARD-DISQUALIFY check — any option flagged hardDisqualify short-circuits
  // the bucket logic and returns cold_tire_kicker immediately. The closer
  // never sees these; drip never re-engages them. Saves Matt + Dave's time.
  const isHardDisqualified = QUESTIONS.some((q) => {
    const provided = answers[q.id];
    if (!provided) return false;
    const opt = q.options.find((o) => o.value === provided);
    return Boolean(opt && opt.hardDisqualify);
  });
  if (isHardDisqualified) {
    return {
      bucket: 'cold_tire_kicker',
      numericScore: 0,
      persona: BUCKET_TO_PERSONA.cold_tire_kicker || 'unaware_leaker',
      recommendedTier: 'free',
      nextStep: 'no_followup',
      closerPriority: 'suppress',
      hardDisqualified: true,
      inputs: { wtp, spend, sat, horizon, authority, needAck }
    };
  }

  // Numeric composite for sorting / fine-grained ranking inside the same bucket
  const numericScore = (wtp || 0) * 12
    + (spend > 0 ? 6 : 0)
    + (sat || 0) * 8
    + (horizon || 0) * 5
    + (authority || 0) * 3
    + (needAck || 0) * 6
    + (overallScore != null && overallScore < 60 ? 14 : 0)
    + (dollarHigh != null && dollarHigh >= 1000 ? 10 : 0);

  let bucket;
  // 1. cold_happy
  if (sat === 1) bucket = 'cold_happy';
  // 2. cold_tire_kicker
  else if (wtp === 1 && spend === 0) bucket = 'cold_tire_kicker';
  // 4. hot_escapee — paying $1500+ AND frustrated/switching
  else if (spend >= 3 && sat >= 3) bucket = 'hot_escapee';
  // 5. hot_bar_friend — paying $300-1500 AND frustrated/switching
  else if (spend === 2 && sat >= 3) bucket = 'hot_bar_friend';
  // 6. hot_new_high_intent — not paying, willing $500+, this quarter
  else if (spend <= 1 && wtp >= 3 && horizon >= 3) bucket = 'hot_new_high_intent';
  // 7. warm_latecomer — not paying, willing $200-500, this quarter
  else if (spend <= 1 && wtp === 2 && horizon >= 2) bucket = 'warm_latecomer';
  // 3. cold_no_authority (only after HOT/WARM checks so a strong buyer with no authority still gets warm)
  else if (authority === 1 && wtp <= 2) bucket = 'cold_no_authority';
  // 8. warm_researcher — willing $200+ + bad audit
  else if (wtp >= 2 && (overallScore == null || overallScore < 65)) bucket = 'warm_researcher';
  else bucket = 'cold_unknown';

  return {
    bucket,
    numericScore,
    persona: BUCKET_TO_PERSONA[bucket] || 'unaware_leaker',
    recommendedTier: BUCKET_TO_TIER[bucket] || 'free',
    nextStep: BUCKET_TO_NEXT_STEP[bucket] || 'no_followup',
    closerPriority: BUCKET_TO_PRIORITY[bucket] || 'cold',
    hardDisqualified: false,
    inputs: { wtp, spend, sat, horizon, authority, needAck }
  };
}

const BUCKET_TO_PERSONA = {
  hot_escapee: 'escapee',
  hot_bar_friend: 'bar_friend_victim',
  hot_new_high_intent: 'high_ltv_specialist',
  warm_latecomer: 'latecomer',
  warm_researcher: 'unaware_leaker',
  cold_happy: 'established_pro',
  cold_tire_kicker: 'diy_overconfident',
  cold_no_authority: 'unaware_leaker',
  cold_unknown: 'unaware_leaker'
};
const BUCKET_TO_TIER = {
  hot_escapee: 'white_glove',
  hot_bar_friend: 'smart_spend',
  hot_new_high_intent: 'smart_spend',
  warm_latecomer: 'fix_plan',
  warm_researcher: 'fix_plan',
  cold_happy: 'free',
  cold_tire_kicker: 'free',
  cold_no_authority: 'fix_plan',
  cold_unknown: 'fix_plan'
};
const BUCKET_TO_NEXT_STEP = {
  hot_escapee: 'book_call_priority',
  hot_bar_friend: 'book_call',
  hot_new_high_intent: 'book_call',
  warm_latecomer: 'fix_plan_buy',
  warm_researcher: 'nurture_email',
  cold_happy: 'send_diy_checklist',
  cold_tire_kicker: 'send_diy_checklist',
  cold_no_authority: 'send_proposal_pdf',
  cold_unknown: 'nurture_email'
};
const BUCKET_TO_PRIORITY = {
  hot_escapee: 'p1',
  hot_bar_friend: 'p1',
  hot_new_high_intent: 'p2',
  warm_latecomer: 'p3',
  warm_researcher: 'p4',
  cold_happy: 'suppress',
  cold_tire_kicker: 'suppress',
  cold_no_authority: 'p4',
  cold_unknown: 'p4'
};

/**
 * Resolve real action URLs from env. CTA hrefs in BUCKET_COPY are
 * placeholders that get replaced by these at response time so we never
 * ship a `#book-call` link to a real prospect.
 *
 * Env vars (any subset):
 *   GEONEO_CALENDLY_URL        — book_call CTA target
 *   GEONEO_PRIORITY_CALENDLY_URL — fast-lane Calendly link for hot leads
 *   GEONEO_PRICING_URL         — pricing page
 *   GEONEO_DIY_CHECKLIST_URL   — DIY checklist landing page
 *   GEONEO_PUBLIC_BASE_URL     — base for /api endpoints (defaults to localhost)
 */
function resolveCtaTargets(domain = '', token = '') {
  const base = process.env.GEONEO_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`;
  const calendly = process.env.GEONEO_CALENDLY_URL || `${base}/book.html`;
  const priorityCalendly = process.env.GEONEO_PRIORITY_CALENDLY_URL || calendly;
  const pricing = process.env.GEONEO_PRICING_URL || `${base}/pricing.html`;
  const diy = process.env.GEONEO_DIY_CHECKLIST_URL || `${base}/diy-checklist.html?domain=${encodeURIComponent(domain)}&token=${encodeURIComponent(token)}`;
  // Action endpoints — when CTA is clicked, posts to one of these to queue
  // an email follow-up. Token validates the domain server-side.
  const sendProposal = `${base}/api/customer/send-proposal?token=${encodeURIComponent(token)}`;
  const sendFullReport = `${base}/api/customer/send-full-report?token=${encodeURIComponent(token)}`;
  const optInMonthly = `${base}/api/customer/optin-monthly?token=${encodeURIComponent(token)}`;
  return { calendly, priorityCalendly, pricing, diy, sendProposal, sendFullReport, optInMonthly };
}

/**
 * Static copy bank for the post-submit reaction. Each bucket gets a
 * headline + body + CTA. Kept here (not generated) so it's reviewable.
 *
 * CTA hrefs use placeholder tokens (e.g. {{calendly}}) that resolveBucketCopy()
 * substitutes with real URLs from env.
 */
const BUCKET_COPY = {
  hot_escapee: {
    headline: 'Stop overpaying. We can audit what your current vendor is actually delivering — free.',
    body: 'You\u2019re paying $1,500+/mo and not seeing results. That\u2019s the most common pain we hear. Book a 20-min call and we\u2019ll show you exactly what your vendor is and isn\u2019t doing, plus what we\u2019d do differently for $800-1,500/mo on the White Glove tier.',
    ctaLabel: 'Book my 20-min vendor audit',
    ctaHref: '{{priorityCalendly}}',
    secondaryCtaLabel: 'Email me the proposal',
    secondaryCtaHref: '{{sendProposal}}'
  },
  hot_bar_friend: {
    headline: 'You\u2019re in the most common trap: paying $500/mo and getting nothing measurable.',
    body: 'The Smart Spend tier ($499/mo) is built for exactly this situation. We take over your existing budget, show you a weekly report of what we touched and what moved, and you fire your current vendor. Average customer recoups the $499 in 6-9 weeks of recovered local search demand.',
    ctaLabel: 'Book a 20-min walkthrough',
    ctaHref: '{{calendly}}',
    secondaryCtaLabel: 'Show me the Smart Spend details',
    secondaryCtaHref: '{{pricing}}#smart-spend'
  },
  hot_new_high_intent: {
    headline: 'You\u2019re ready to act and you have the budget. Let\u2019s start.',
    body: 'Your audit shows real opportunity. With a $500+/mo budget and a quarter-or-less timeline, the Smart Spend tier gets you ranked + monitored. Or start with the one-time $199 Fix Plan if you want to test us first — it includes 2 free months of Maintenance.',
    ctaLabel: 'Book a 20-min strategy call',
    ctaHref: '{{calendly}}',
    secondaryCtaLabel: 'Buy the $199 Fix Plan',
    secondaryCtaHref: '{{pricing}}#fix-plan'
  },
  warm_latecomer: {
    headline: 'You\u2019re ready to start small and see results before scaling. Smart move.',
    body: 'The $199 Fix Plan ships you the exact code to paste, prioritized by dollar impact, plus 2 months of Maintenance free. Most local businesses see measurable lift within 30 days. After that, $79/mo Maintenance keeps it tight.',
    ctaLabel: 'Buy the $199 Fix Plan now',
    ctaHref: '{{pricing}}#fix-plan',
    secondaryCtaLabel: 'Have a question first?',
    secondaryCtaHref: '{{calendly}}'
  },
  warm_researcher: {
    headline: 'You\u2019re still gathering info. Here\u2019s what to read next.',
    body: 'No pressure. We\u2019ll send you the full audit details by email plus a free DIY checklist for the top 3 fixes. When you\u2019re ready to talk, our cheapest entry point is the $199 Fix Plan.',
    ctaLabel: 'Email me the full audit + checklist',
    ctaHref: '{{sendFullReport}}',
    secondaryCtaLabel: 'See pricing options',
    secondaryCtaHref: '{{pricing}}'
  },
  cold_happy: {
    headline: 'Sounds like your current vendor is doing their job. Keep them.',
    body: 'No reason to change a working setup. If something changes, our DIY checklist below covers the basics. Best of luck.',
    ctaLabel: 'Get the free DIY checklist',
    ctaHref: '{{diy}}',
    secondaryCtaLabel: null,
    secondaryCtaHref: null
  },
  cold_tire_kicker: {
    headline: 'Honest answer: at under $200/mo, no SEO program will move the needle.',
    body: 'We\u2019re not going to pretend otherwise. Here\u2019s our free DIY checklist — implement it yourself, and you\u2019ll see real improvement without paying anyone. If your situation changes, we\u2019ll be here.',
    ctaLabel: 'Get the free DIY checklist',
    ctaHref: '{{diy}}',
    secondaryCtaLabel: null,
    secondaryCtaHref: null
  },
  cold_no_authority: {
    headline: 'We\u2019ll prep a proposal you can take to whoever decides.',
    body: 'Send us the email of the decision-maker and we\u2019ll prepare a one-page proposal with the audit data + ROI math, formatted to read in 5 minutes.',
    ctaLabel: 'Email me the proposal',
    ctaHref: '{{sendProposal}}',
    secondaryCtaLabel: 'See pricing first',
    secondaryCtaHref: '{{pricing}}'
  },
  cold_unknown: {
    headline: 'We\u2019ll keep your audit in our system in case you want to come back.',
    body: 'No follow-up scheduled. Bookmark this page — we\u2019ll re-run your audit in 30 days and send an updated score if you opt in.',
    ctaLabel: 'Keep me posted (opt in)',
    ctaHref: '{{optInMonthly}}',
    secondaryCtaLabel: 'See pricing',
    secondaryCtaHref: '{{pricing}}'
  }
};

/**
 * Resolve {{token}} placeholders in a copy block to real URLs.
 * Pure — never mutates the original BUCKET_COPY entry.
 */
function resolveBucketCopy(bucket, domain, token) {
  const raw = BUCKET_COPY[bucket] || BUCKET_COPY.cold_unknown;
  const targets = resolveCtaTargets(domain, token);
  const sub = (s) => {
    if (!s) return s;
    return s.replace(/\{\{(\w+)\}\}/g, (_, key) => targets[key] || s);
  };
  return {
    ...raw,
    ctaHref: sub(raw.ctaHref),
    secondaryCtaHref: sub(raw.secondaryCtaHref)
  };
}

function getOptionScore(questionId, value) {
  const q = QUESTION_INDEX.get(questionId);
  if (!q || !value) return 0;
  const opt = q.options.find((o) => o.value === value);
  return opt ? opt.score : 0;
}

/** Live-react copy that fires AFTER each individual answer (in the UI). */
function getReactionForAnswer(questionId, value, audit = null) {
  if (!questionId || !value) return null;
  const dollarHigh = audit?.dollarOpportunity?.monthly?.high ?? null;
  if (questionId === 'wtp') {
    if (value === 'wtp_lt200') {
      return { tone: 'warn', text: 'Honest note: under $200/mo rarely produces measurable change. We\u2019ll show you the DIY route at the end.' };
    }
    if (value === 'wtp_200_500') {
      return { tone: 'good', text: dollarHigh ? `That budget against a $${dollarHigh}/mo opportunity is a strong return on capital.` : 'Solid. That budget covers a real intervention.' };
    }
    if (value === 'wtp_500_1500') {
      return { tone: 'good', text: 'Smart range. This is where local SEO actually moves leads.' };
    }
    if (value === 'wtp_1500_plus') {
      return { tone: 'good', text: 'You\u2019re in agency-tier budget. The right vendor pays for itself many times over.' };
    }
  }
  if (questionId === 'spend') {
    if (value === 'spend_300_1500') {
      return { tone: 'flag', text: 'This is the band where most "Bar Friend Victim" vendors live. We see it constantly.' };
    }
    if (value === 'spend_1500_5000' || value === 'spend_5000_plus') {
      return { tone: 'flag', text: 'At that spend, you should be seeing measurable rank/lead movement monthly. Are you?' };
    }
    if (value === 'spend_0') {
      return { tone: 'good', text: 'No vendor relationship to break. Easier to build the right thing from scratch.' };
    }
  }
  if (questionId === 'satisfaction') {
    if (value === 'sat_frustrated' || value === 'sat_switching') {
      return { tone: 'good', text: 'You\u2019re the customer we\u2019re built for. Let\u2019s make sure you\u2019re not just trading one bad vendor for another.' };
    }
    if (value === 'sat_very_happy') {
      return { tone: 'neutral', text: 'Don\u2019t change what\u2019s working. We\u2019ll only contact you if your audit score drops.' };
    }
  }
  return null;
}

/* ===== Persistence ===== */

let storeCache = null;

async function loadStore() {
  if (storeCache) return storeCache;
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf8');
    if (!raw.trim()) { storeCache = { responses: {} }; return storeCache; }
    const parsed = JSON.parse(raw);
    storeCache = { responses: (parsed && parsed.responses) || {} };
  } catch (err) {
    if (err && err.code !== 'ENOENT') console.warn('[qualifier] store read failed:', err.message);
    storeCache = { responses: {} };
  }
  return storeCache;
}

async function persistStore() {
  if (!storeCache) return;
  try {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(storeCache, null, 2), 'utf8');
    await fs.rename(tmp, STORE_PATH);
  } catch (err) {
    console.warn('[qualifier] store write failed:', err.message);
  }
}

/**
 * Submit answers under a verified token. Idempotent within EDIT_WINDOW_MS —
 * subsequent submits in that window update the same record. After the
 * window, a new submit creates a follow-up entry tagged `isFollowUp: true`.
 *
 * Returns { record, scoring, isFollowUp, isUpdate }
 */
async function submitAnswers({ token, answers, audit = null, contactInfo = null, requestMeta = null }) {
  const verified = verifyQualifierToken(token);
  if (!verified.valid) {
    const err = new Error(`token invalid: ${verified.error}`);
    err.code = 'INVALID_TOKEN';
    throw err;
  }
  const cleanAnswers = validateAnswers(answers);
  const scoring = scoreAnswers(cleanAnswers, audit);
  const store = await loadStore();
  const existing = store.responses[token];
  const now = Date.now();
  let isUpdate = false;
  let isFollowUp = false;
  let record;
  if (existing && (now - new Date(existing.firstSubmittedAt).getTime()) < EDIT_WINDOW_MS) {
    record = {
      ...existing,
      answers: cleanAnswers,
      scoring,
      lastUpdatedAt: new Date().toISOString(),
      audit: audit || existing.audit || null,
      contactInfo: contactInfo || existing.contactInfo || null,
      requestMeta: requestMeta || existing.requestMeta || null
    };
    isUpdate = true;
  } else if (existing) {
    record = {
      ...existing,
      followUps: [...(existing.followUps || []), {
        at: new Date().toISOString(),
        answers: cleanAnswers,
        scoring
      }],
      isFollowUp: true,
      lastUpdatedAt: new Date().toISOString()
    };
    isFollowUp = true;
  } else {
    record = {
      token,
      domain: verified.domain,
      runId: verified.runId,
      firstSubmittedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      answers: cleanAnswers,
      scoring,
      audit: audit || null,
      contactInfo: contactInfo || null,
      requestMeta: requestMeta || null,
      followUps: []
    };
  }
  store.responses[token] = record;
  await persistStore();
  return { record, scoring, isUpdate, isFollowUp };
}

async function getResponseByToken(token) {
  const store = await loadStore();
  return store.responses[token] || null;
}

async function listResponses({ bucket = null, sinceIso = null } = {}) {
  const store = await loadStore();
  const all = Object.values(store.responses);
  return all.filter((r) => {
    if (bucket && r.scoring?.bucket !== bucket) return false;
    if (sinceIso && new Date(r.firstSubmittedAt).getTime() < new Date(sinceIso).getTime()) return false;
    return true;
  });
}

module.exports = {
  signQualifierToken,
  verifyQualifierToken,
  validateAnswers,
  scoreAnswers,
  getReactionForAnswer,
  submitAnswers,
  getResponseByToken,
  listResponses,
  resolveBucketCopy,
  resolveCtaTargets,
  QUESTIONS,
  BUCKET_COPY,
  BUCKET_TO_PERSONA,
  BUCKET_TO_TIER,
  TOKEN_TTL_MS
};
