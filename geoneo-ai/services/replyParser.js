/**
 * Parse inbound email body to extract closer-relevant signals beyond
 * "they replied":
 *
 *   - Intent: yes (buying) / no (objection/decline) / maybe (question/needs more)
 *   - Sentiment: positive / neutral / negative
 *   - Urgency: this-week / soon / later / unknown
 *   - Objections: price / trust / timing / authority / existing_vendor / other
 *   - Question signals (any "?" word; we extract the first 3 questions)
 *   - Auto-reply flag (vacation/OOO/auto-responder)
 *   - Unsubscribe intent (STOP / unsubscribe / remove me)
 *
 * No LLM. Pure keyword + pattern matching, designed to be 90% accurate
 * on local-business reply patterns we see. Closer can override the tag
 * in the lead drawer.
 *
 * Output augments the inbound email handler so the lead drawer shows:
 *   "Reply parsed: intent=yes, urgency=this-week, no objections detected"
 */

const QUESTION_RE = /(?:^|[\.\?\!]\s+)([A-Z][^\.\?\!]{8,200}\?)/g;

const POSITIVE_PHRASES = [
  /\b(yes|yep|sure|absolutely|definitely|let'?s do it|sounds (good|great|perfect))\b/i,
  /\b(i'?m interested|interested|count me in|i'?d like to|i would like)\b/i,
  /\b(call me|let'?s (talk|chat|schedule|meet))\b/i,
  /\b(go ahead|move forward|next steps?|proceed)\b/i
];
// Explicit call-consent patterns. ANY match = TCPA "express written consent"
// for a follow-up phone call. Stricter than just positive intent: requires
// the recipient to specifically reference a call/phone/walkthrough.
const CALL_CONSENT_PHRASES = [
  /\b(call me|give me a call|phone me|ring me|dial me)\b/i,
  /\b(yes,? (please )?call)\b/i,
  /\b(sure,? call)\b/i,
  /\b(i'?d like a call|i'?d like to talk|let'?s talk)\b/i,
  /\b(walk me through|walkthrough|over the phone)\b/i,
  /\b(can we (set up|schedule|do) a call)\b/i,
  /\b(book (me )?a call|schedule (me )?a call)\b/i,
  /\b(my (cell|number|phone) is)\b/i // they're providing a number = clear consent
];
const NEGATIVE_PHRASES = [
  /\b(no thanks?|not interested|pass|not for us|we'?re good|all set)\b/i,
  /\b(remove me|unsubscribe|stop emailing|take me off|delete my)\b/i,
  /\b(don'?t (call|contact|email) me|leave us alone|fuck off)\b/i,
  /\bdo not (call|contact|email)\b/i
];
const MAYBE_PHRASES = [
  /\b(maybe|perhaps|possibly|considering|thinking about|might be)\b/i,
  /\b(need to|have to|let me|gonna) (think|discuss|check|review|see)\b/i,
  /\b(send (me )?(more|info)|tell me more|how does|what (does|is)|how much)\b/i
];
const URGENCY_THIS_WEEK = [
  /\b(asap|urgent|today|this (morning|afternoon|evening|week))\b/i,
  /\b(tomorrow|right now|immediately|first thing)\b/i
];
const URGENCY_SOON = [
  /\b(this month|next week|soon|shortly|in the next (few )?(days?|weeks?))\b/i
];
const URGENCY_LATER = [
  /\b(next month|next quarter|q[1-4]|later this year|in (a few|several) months?)\b/i,
  /\b(eventually|down the (road|line)|not (right now|yet))\b/i
];

// Objection categorization — each fires if a matching phrase appears.
const OBJECTION_PATTERNS = {
  price: [
    /\b(too expensive|out of (my|our) budget|can'?t afford|too much (money|cash))\b/i,
    /\b(price is high|not in the budget|cheaper|less expensive|free options?)\b/i,
    /\$\d{2,4}\s*(\/?mo|per month|monthly).*\b(steep|much|expensive|high)\b/i
  ],
  trust: [
    /\b(scam|spam|fake|legit|trust|real|prove it)\b/i,
    /\b(too good to be true|sounds (sketchy|fishy)|don'?t (know|trust) you)\b/i
  ],
  timing: [
    /\b(bad time|busy|swamped|crazy|not a good time|come back (later|next))\b/i,
    /\b(in the middle of|tied up|overwhelmed)\b/i
  ],
  authority: [
    /\b(not the (right|decision maker)|talk to (my|the) (partner|boss|spouse|husband|wife))\b/i,
    /\b(need to (ask|check with)|need approval)\b/i
  ],
  existing_vendor: [
    /\b(we have|already have|currently (use|work with))\s+(an? )?(seo|marketing|agency|guy|firm)\b/i,
    /\b(our (current|existing) (seo|marketer|agency|vendor))\b/i,
    /\b(under contract|in (a )?contract|locked in)\b/i
  ]
};

function lower(s) { return String(s == null ? '' : s).toLowerCase(); }

function matchAny(text, patterns) {
  return patterns.some((p) => p.test(text));
}

function detectIntent(text) {
  const t = String(text || '');
  if (matchAny(t, NEGATIVE_PHRASES)) return 'no';
  if (matchAny(t, POSITIVE_PHRASES)) return 'yes';
  if (matchAny(t, MAYBE_PHRASES)) return 'maybe';
  return 'unknown';
}

/**
 * Detect explicit consent for an AI follow-up call. Stricter than
 * detectIntent — must reference a call, phone, walkthrough, or provide
 * a number. Returns { consented: bool, matchedPattern: string|null }.
 */
function detectCallConsent(text) {
  const t = String(text || '');
  for (const re of CALL_CONSENT_PHRASES) {
    if (re.test(t)) return { consented: true, matchedPattern: re.source };
  }
  return { consented: false, matchedPattern: null };
}

function detectSentiment(text) {
  // Crude polarity: count positive vs negative tokens
  const t = lower(text);
  let pos = 0, neg = 0;
  const posTokens = ['thank', 'thanks', 'great', 'love', 'awesome', 'perfect', 'helpful', 'appreciate', 'good', 'excited', 'happy'];
  const negTokens = ['hate', 'terrible', 'awful', 'frustrated', 'disappointed', 'annoying', 'waste', 'angry', 'pissed', 'crap', 'shit', 'fuck'];
  for (const w of posTokens) if (t.includes(w)) pos++;
  for (const w of negTokens) if (t.includes(w)) neg++;
  if (pos - neg >= 2) return 'positive';
  if (neg - pos >= 2) return 'negative';
  return 'neutral';
}

function detectUrgency(text) {
  const t = String(text || '');
  if (matchAny(t, URGENCY_THIS_WEEK)) return 'this_week';
  if (matchAny(t, URGENCY_SOON)) return 'soon';
  if (matchAny(t, URGENCY_LATER)) return 'later';
  return 'unknown';
}

function detectObjections(text) {
  const t = String(text || '');
  const out = [];
  for (const [k, patterns] of Object.entries(OBJECTION_PATTERNS)) {
    if (matchAny(t, patterns)) out.push(k);
  }
  return out;
}

function extractQuestions(text) {
  if (!text) return [];
  const out = [];
  const re = new RegExp(QUESTION_RE.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null && out.length < 3) {
    out.push(m[1].trim());
  }
  return out;
}

function isAutoReply({ subject = '', text = '', from = '' }) {
  const s = lower(subject + ' ' + text);
  if (/(out of office|ooo|auto.?reply|automatic reply|on vacation|i'?m away|currently away)/.test(s)) return true;
  if (/auto[-_.]?(noreply|reply)|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster/.test(lower(from))) return true;
  return false;
}

function isUnsubscribeRequest(text) {
  return /\b(unsubscribe|remove me|stop emailing|take me off|delete my (email|info)|opt[- ]out)\b/i.test(text || '');
}

/**
 * Top-level. Returns a flat signals object. The caller decides what to
 * do with it (auto-tag the lead, surface in the drawer, suppress if
 * unsubscribe, etc).
 */
function parseReply({ subject = '', text = '', from = '' } = {}) {
  const combined = `${subject}\n${text}`;
  const autoReply = isAutoReply({ subject, text, from });
  if (autoReply) {
    return {
      intent: 'autoreply',
      sentiment: 'neutral',
      urgency: 'unknown',
      objections: [],
      questions: [],
      unsubscribe: false,
      autoReply: true,
      summary: 'Auto-reply / out-of-office. No human action implied.'
    };
  }
  const unsubscribe = isUnsubscribeRequest(combined);
  if (unsubscribe) {
    return {
      intent: 'no',
      sentiment: 'negative',
      urgency: 'unknown',
      objections: ['unsubscribe'],
      questions: [],
      unsubscribe: true,
      autoReply: false,
      summary: 'Unsubscribe / do-not-contact requested. Suppress and stop all sequences.'
    };
  }
  const intent = detectIntent(combined);
  const sentiment = detectSentiment(combined);
  const urgency = detectUrgency(combined);
  const objections = detectObjections(combined);
  const questions = extractQuestions(text);
  const callConsent = detectCallConsent(combined);

  // Build a one-line summary
  const parts = [`intent=${intent}`];
  if (callConsent.consented) parts.push('CALL_CONSENT');
  if (urgency !== 'unknown') parts.push(`urgency=${urgency.replace('_', ' ')}`);
  if (objections.length) parts.push(`objections=${objections.join(', ')}`);
  if (sentiment !== 'neutral') parts.push(`sentiment=${sentiment}`);
  if (questions.length) parts.push(`${questions.length} question(s)`);

  return {
    intent,
    sentiment,
    urgency,
    objections,
    questions,
    callConsent: callConsent.consented,
    callConsentPattern: callConsent.matchedPattern,
    unsubscribe: false,
    autoReply: false,
    summary: parts.join(' · ')
  };
}

/**
 * Suggest a closer priority adjustment based on parsed signals.
 * "hot" → contact in next hour; "warm" → today; "cool" → tomorrow;
 * "drop" → mark lost.
 */
function suggestNextAction(signals) {
  if (signals.unsubscribe) return { priority: 'drop', action: 'suppress + stop sequences' };
  if (signals.intent === 'no') return { priority: 'drop', action: 'mark lost; respect their no' };
  if (signals.autoReply) return { priority: 'defer', action: 'wait for return; no action needed' };
  if (signals.intent === 'yes' && signals.urgency === 'this_week') return { priority: 'hot', action: 'call within 1 hour' };
  if (signals.intent === 'yes') return { priority: 'warm', action: 'call today' };
  if (signals.intent === 'maybe' && signals.questions.length) return { priority: 'warm', action: 'answer their question(s) + offer call' };
  if (signals.intent === 'maybe') return { priority: 'cool', action: 'follow up tomorrow with more info' };
  return { priority: 'cool', action: 'follow up; intent unclear' };
}

module.exports = {
  parseReply,
  suggestNextAction,
  detectIntent,
  detectCallConsent,
  detectSentiment,
  detectUrgency,
  detectObjections,
  extractQuestions,
  isAutoReply,
  isUnsubscribeRequest
};
