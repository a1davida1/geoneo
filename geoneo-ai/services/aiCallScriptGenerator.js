/**
 * AI call script generator. Builds the per-lead, per-price-variant script
 * the AI dialer reads from. Output is a structured object — providers
 * (Bland/Vapi/Retell) consume it and convert to their own prompt format.
 *
 * Designed for the cold-outbound-contractor funnel where:
 *   - Customer has never heard of GeoNeo
 *   - Customer doesn't know SEO benchmark prices
 *   - Customer's anchor IS the dollar opportunity we showed in the audit
 *   - AI must be brief, dollar-first, and exit gracefully on disinterest
 *
 * The output object is provider-agnostic. Per provider:
 *   - Bland: pass `aggregatedPrompt` to the `prompt` field
 *   - Vapi: pass `assistantPrompt` to assistant config + `firstMessage`
 *   - Retell: pass `agentPrompt` + state machine for objection branches
 *
 * Price variants supported:
 *   - 79  → "Maintenance" — low-friction solo close
 *   - 129 → "Visibility Plan" — solo close with dollar math
 *   - 199 → "AI Search Intelligence" — book the call (don't solo close)
 *   - 499 → "Smart Spend" — qualify only, hand off to human
 *
 * No LLM calls — all script blocks are template substitutions from real
 * audit + lead data. The AI provider's LLM does the actual conversation
 * inside the rails this script sets.
 */

const { detectPersona, buildMicroscripts, recommendTier, PERSONAS, TIER_DEFINITIONS } = require('./closerSheet');

// Price-variant configs. Drives close mode + objection lines.
const PRICE_VARIANTS = {
  79: {
    label: 'Maintenance',
    closeMode: 'solo_close',           // AI tries to close on call
    pitchOneLine: 'It\u2019s $79 a month — less than your phone bill — for weekly re-audits, a brief every Monday, and a dashboard you can log into anytime.',
    minOpportunityDollar: 0,
    paymentMethod: 'card_on_call_or_link', // collect on call OR send Stripe link
    objectionsScript: 'soft'            // very low pressure
  },
  129: {
    label: 'Visibility Plan',
    closeMode: 'solo_close',
    pitchOneLine: 'It\u2019s $129 a month for weekly re-audits, AI-search visibility tracking across ChatGPT and Perplexity, competitor watch on three competitors, and dashboard access.',
    minOpportunityDollar: 700,
    paymentMethod: 'card_on_call_or_link',
    objectionsScript: 'firm'            // moderate dollar-math pressure
  },
  199: {
    label: 'AI Search Intelligence',
    closeMode: 'book_call',             // AI books a follow-up, doesn't solo close
    pitchOneLine: 'It\u2019s $199 a month and includes everything we just discussed plus a quarterly strategy call with our team. I won\u2019t close that on this call — let\u2019s book a 15-minute walkthrough so you can see the dashboard.',
    minOpportunityDollar: 1500,
    paymentMethod: 'human_followup',
    objectionsScript: 'firm'
  },
  499: {
    label: 'Smart Spend',
    closeMode: 'handoff_human',         // AI qualifies + transfers
    pitchOneLine: 'You\u2019re a fit for our Smart Spend tier — $499/month with ad-budget oversight and a dedicated point person. Let me hand you to our team for a quick conversation, or book a time tomorrow morning.',
    minOpportunityDollar: 3000,
    paymentMethod: 'human_only',
    objectionsScript: 'qualify_only'    // don't solo close
  }
};

/**
 * Pick the right price variant for a lead. If qualifier already ran, use
 * the recommended tier. Otherwise default to $129 (the funnel-math best
 * for cold outbound).
 */
function pickPriceVariantForLead(lead) {
  // If qualifier completed, respect recommendedTier mapping
  const tierKey = lead?.qualifier?.recommendedTier;
  if (tierKey === 'fix_plan' || tierKey === 'maintenance') return 79;
  if (tierKey === 'smart_spend') return 499;
  if (tierKey === 'white_glove' || tierKey === 'white_glove_low' || tierKey === 'white_glove_high') return 499; // route to Smart Spend convo first
  // No qualifier yet — pick by audit dollar opportunity
  const oppHigh = lead?.audit?.dollarOpportunity?.monthly?.high
    || lead?.audit?.dollarOpportunityHigh
    || 0;
  if (oppHigh >= 3000) return 199;
  if (oppHigh >= 1000) return 129;
  return 79;
}

/**
 * AI-friendly opening — designed to NOT sound like a salesperson but to
 * earn 30 seconds. Variants by whether the customer already saw the audit
 * email (we know from emailSentAt).
 */
function buildOpener(lead, consentSource = null) {
  const biz = lead.businessName || lead.domain;
  const firstName = lead.contactName || lead.firstName || '';
  const greet = firstName ? `Hi ${firstName}, ` : 'Hi there, ';
  // Always consent-based — the dialer enforces this. Reference the email
  // reply they sent so the opener feels warm, not cold.
  if (consentSource === 'email_reply') {
    return {
      lines: [
        `${greet}it's the team from GeoNeo following up on ${biz}'s audit — you replied wanting a quick call. Got 60 seconds?`
      ],
      tone: 'warm, returning-their-interest, human',
      durationSec: 10,
      branches: { yes: 'painValidation', confused: 'reExplainContext', bad_timing: 'collectMeetingTime', cancel: 'softGoodbye' }
    };
  }
  if (consentSource === 'admin_override') {
    return {
      lines: [
        `${greet}it's the team from GeoNeo — returning your call about ${biz}. Got 60 seconds?`
      ],
      tone: 'warm, returning-your-call, human',
      durationSec: 10,
      branches: { yes: 'painValidation', confused: 'reExplainContext', cancel: 'softGoodbye' }
    };
  }
  // Fallback (should never fire with consent gating in place)
  return {
    lines: [
      `${greet}it's the team from GeoNeo following up on the audit we ran for ${biz}. You asked for a quick walkthrough — got 60 seconds?`
    ],
    tone: 'warm, human',
    durationSec: 10,
    branches: { yes: 'painValidation', confused: 'reExplainContext', cancel: 'softGoodbye' }
  };
}

function buildPainValidation(lead) {
  const biz = lead.businessName || lead.domain;
  const oppLow = lead.audit?.dollarOpportunity?.monthly?.low || lead.audit?.dollarOpportunityLow || 0;
  const oppHigh = lead.audit?.dollarOpportunity?.monthly?.high || lead.audit?.dollarOpportunityHigh || 0;
  const score = lead.audit?.overallScore;
  const grade = lead.audit?.grade;
  const city = lead.city || 'your area';
  const industry = lead.industry || 'your services';
  const dollarLine = oppHigh
    ? `Your audit scored ${score}/100 — that's a ${grade}. The math says you're missing roughly $${oppLow.toLocaleString()} to $${oppHigh.toLocaleString()} a month in unconverted local search demand for ${industry} in ${city}.`
    : `Your audit scored ${score}/100 — that's a ${grade}. Your visibility's costing you in local search.`;
  return {
    lines: [
      dollarLine,
      `Want me to walk through the top three things driving that gap, or would the dashboard be more useful for you?`
    ],
    tone: 'specific, math-first, no pressure',
    durationSec: 25,
    branches: {
      walk_through: 'topThreeFindings',
      send_dashboard: 'pitch',
      objection: 'objectionHandler',
      not_interested: 'softGoodbye'
    }
  };
}

function buildTopThreeFindings(lead) {
  const top = (lead.audit?.findings || lead.audit?.topFiveFindings || []).slice(0, 3);
  if (!top.length) {
    return {
      lines: [
        `Three big things: your schema markup is missing, your AI-search citation rate is low, and your contact info is inconsistent across the web. Each of those costs traffic.`,
        `Want to see the dashboard with all the details?`
      ],
      durationSec: 18,
      branches: { yes: 'pitch', objection: 'objectionHandler' }
    };
  }
  const summarize = (f) => {
    const dollar = f.dollarImpact?.monthly?.high;
    return dollar ? `${f.title} — about $${dollar} a month` : f.title;
  };
  return {
    lines: [
      `Three things: ${summarize(top[0])}. ${summarize(top[1])}. ${summarize(top[2])}.`,
      `Each fix has the exact code-paste blocks ready in your dashboard. Want to see it?`
    ],
    durationSec: 22,
    branches: { yes: 'pitch', objection: 'objectionHandler' }
  };
}

function buildPitch(lead, priceVariant) {
  const variant = PRICE_VARIANTS[priceVariant];
  return {
    lines: [
      variant.pitchOneLine,
      variant.closeMode === 'solo_close'
        ? `Want to start today? I can text you a secure payment link right now and email you the dashboard URL — bookmark it and you're set.`
        : variant.closeMode === 'book_call'
          ? `When works for a 15-minute call — tomorrow morning or afternoon?`
          : `When can our team grab you for a quick conversation — tomorrow or the next day?`
    ],
    closeMode: variant.closeMode,
    durationSec: 22,
    branches: {
      yes_close: variant.closeMode === 'solo_close' ? 'collectPayment' : 'collectMeetingTime',
      need_to_think: 'objectionHandler',
      objection: 'objectionHandler',
      not_interested: 'softGoodbye'
    }
  };
}

function buildObjectionHandler(lead, priceVariant) {
  const variant = PRICE_VARIANTS[priceVariant];
  const oppHigh = lead.audit?.dollarOpportunity?.monthly?.high || 0;
  const objections = {
    too_expensive: variant.objectionsScript === 'soft'
      ? `That's fair. It's $79/mo though — about the cost of two coffees a week. And you can cancel anytime. Want to try the first month and see if it moves the needle?`
      : `Compared to what? The audit says you're missing $${oppHigh}/mo in lost demand. The plan captures even a fraction of that — net positive in week one. If after 60 days the numbers don't move, you cancel.`,
    have_a_guy: `Cool — what does your guy say about your AI-search visibility on ChatGPT and Perplexity? Don't replace him. Hand him your audit and ask him to do what's in it. If he can't, you have your answer.`,
    need_to_think: variant.closeMode === 'solo_close'
      ? `Totally fair. What specifically do you need to think through? If it's the price, here's the math: every week you wait costs ${Math.round(oppHigh / 4)} dollars in missed demand.`
      : `Of course. Let me book you on a 15-minute walkthrough — Tuesday or Thursday work better?`,
    just_email_me: `Will do — but the audit is already in your inbox. Did you open it? Either way, I'll send the dashboard link in the next two minutes. Pop it open and call us back if anything stands out.`,
    not_real: `Fair skepticism. Two things: your audit is real data — pull up your inbox, the URL ends in geoneo.ai. And we're a Branson Missouri team — Matt or Dave can drive over and sit in your office if you want to verify in person.`,
    no_budget: `Understood. The Maintenance plan is built for that — $79/mo, no contract, cancel anytime. If a coffee a day isn't in the budget right now, we'll send you the free DIY checklist and check back in 90 days.`,
    too_busy: `One minute then: I'll text you the dashboard link and the audit summary. Take 5 minutes when you have it. Cool?`,
    do_not_call: `Understood. I'll mark you do-not-call. Thanks for your time.`
  };
  return {
    branchByObjection: objections,
    fallback: `I hear you. The audit's in your inbox — open it whenever, no pressure. Have a good day.`,
    branches: {
      resolved: 'pitch',
      stuck: 'softGoodbye',
      hostile: 'softGoodbye'
    }
  };
}

function buildCollectPayment(lead, priceVariant) {
  return {
    lines: [
      `I'll text the secure payment link to ${lead.contactInfo?.primaryPhone || 'this number'} right now. It's a one-page Stripe form — takes 30 seconds.`,
      `Once you complete it, your dashboard link will email automatically and your first weekly brief lands next Monday. Sound good?`
    ],
    actions: ['send_payment_sms', 'send_dashboard_email_on_payment'],
    durationSec: 18,
    branches: {
      done: 'wrapUp',
      payment_failed: 'sendLinkOnly',
      need_more_time: 'sendLinkOnly'
    }
  };
}

function buildCollectMeetingTime(lead) {
  return {
    lines: [
      `Two slots open: tomorrow at 10am or Thursday at 2pm. Which is better?`,
      `I'll send a calendar invite the second we hang up. Confirm with a yes and we're set.`
    ],
    actions: ['create_calendar_event', 'route_to_human_queue'],
    durationSec: 12,
    branches: {
      morning_pick: 'wrapUp',
      afternoon_pick: 'wrapUp',
      both_bad: 'collectAlternateTime'
    }
  };
}

function buildSoftGoodbye(lead) {
  return {
    lines: [
      `Totally understood. The audit's in your inbox if you want to look later — it's a free resource regardless. Have a good one.`
    ],
    durationSec: 6,
    actions: ['mark_outcome_no_interest']
  };
}

function buildVoicemail(lead, priceVariant) {
  const variant = PRICE_VARIANTS[priceVariant];
  const biz = lead.businessName || lead.domain;
  const oppHigh = lead.audit?.dollarOpportunity?.monthly?.high || 0;
  const dollarHook = oppHigh ? ` We found about $${oppHigh}/mo in missed local search.` : '';
  return {
    lines: [
      `Hi, this is the GeoNeo audit team calling about ${biz}.${dollarHook} The full audit is already in your inbox — just open the email from us. We'll text you the dashboard link too. No pressure, but worth a look. Bye now.`
    ],
    durationSec: 22,
    actions: ['send_followup_sms', 'mark_outcome_voicemail']
  };
}

function buildWrapUp(lead) {
  return {
    lines: [
      `Perfect. You're all set. Watch for the email confirmation in the next 5 minutes. Thanks for your time.`
    ],
    durationSec: 6,
    actions: ['mark_outcome_won']
  };
}

/**
 * Aggregate everything into a single prompt blob the AI provider can read.
 * Most providers accept a single prompt + opening message; this packs the
 * full state machine into structured guidance the LLM follows.
 */
function buildAggregatedPrompt(script) {
  const out = [];
  out.push(`You are an outbound AI agent for GeoNeo, a local-business visibility audit service in Branson, Missouri. You're calling ${script.lead.businessName || script.lead.domain} (${script.lead.industry || 'local business'}, ${script.lead.city || ''}).`);
  out.push('');
  out.push(`# Behavior rules`);
  out.push(`- Speak as a member of the GeoNeo team. Casual, direct, warm. Sound like a friendly local who knows SEO.`);
  out.push(`- The customer asked for this call by replying to our audit email. Reference that they reached out.`);
  out.push(`- Never fabricate numbers or facts not in this script.`);
  out.push(`- Keep individual responses under 25 seconds. Pause for the customer to respond.`);
  out.push(`- If the customer says "do not call" or "remove me", acknowledge and end immediately.`);
  out.push(`- If the customer is hostile or confused, back off and offer to email the details instead.`);
  out.push(`- Use natural speech patterns: contractions, brief pauses, occasional "uh" or "let me" — sound human, not scripted.`);
  out.push('');
  out.push(`# Real numbers about this customer`);
  out.push(`- Visibility score: ${script.lead.audit?.overallScore ?? 'unknown'}/100 (${script.lead.audit?.grade || 'D'})`);
  out.push(`- Estimated monthly opportunity: $${script.lead.audit?.dollarOpportunity?.monthly?.low || 0}-$${script.lead.audit?.dollarOpportunity?.monthly?.high || 0}`);
  out.push(`- Industry: ${script.lead.industry || 'unknown'}`);
  out.push(`- Market: ${script.lead.city || ''}, ${script.lead.state || ''}`);
  out.push(`- Top finding: ${script.lead.audit?.findings?.[0]?.title || 'multiple gaps'}`);
  out.push('');
  out.push(`# Price variant: $${script.priceVariant}/mo (${script.priceConfig.label})`);
  out.push(`Pitch line: "${script.priceConfig.pitchOneLine}"`);
  out.push(`Close mode: ${script.priceConfig.closeMode}`);
  out.push('');
  out.push(`# State machine (follow this flow)`);
  for (const [name, block] of Object.entries(script.states)) {
    if (!block.lines) continue;
    out.push(`## ${name}`);
    block.lines.forEach((l) => out.push(`> ${l}`));
    if (block.branches) {
      out.push(`Branches: ${Object.keys(block.branches).join(', ')}`);
    }
    out.push('');
  }
  out.push(`# Objection handling (key phrases → response)`);
  for (const [k, v] of Object.entries(script.states.objectionHandler?.branchByObjection || {})) {
    out.push(`- ${k}: ${v}`);
  }
  out.push('');
  out.push(`# Voicemail script (if no answer after 4 rings)`);
  if (script.states.voicemail) {
    script.states.voicemail.lines.forEach((l) => out.push(`> ${l}`));
  }
  out.push('');
  out.push(`# End-of-call: post a structured outcome to the webhook with one of:`);
  out.push(`booked, closed_won, callback_requested, no_interest, voicemail, wrong_number, do_not_call`);
  return out.join('\n');
}

/**
 * Top-level. Returns the full structured script + aggregated prompt.
 */
function generateScript({ lead, priceVariant = null, persona = null, consentSource = null } = {}) {
  if (!lead || !lead.domain) throw new Error('lead with .domain required');
  const variant = priceVariant || pickPriceVariantForLead(lead);
  if (!PRICE_VARIANTS[variant]) throw new Error(`unsupported price variant: ${variant}`);
  const detectedPersona = persona || detectPersona(
    {
      businessName: lead.businessName,
      domain: lead.domain,
      industry: lead.industry,
      city: lead.city,
      state: lead.state,
      yearsInBusiness: lead.yearsInBusiness,
      currentMonthlySpend: lead.qualifier?.answers?.spend ? 500 : 0,
      currentVendor: lead.qualifier?.answers?.satisfaction ? 'agency' : '',
      locationCount: 1
    },
    lead.audit || {}
  );
  const states = {
    opener: buildOpener(lead, consentSource),
    painValidation: buildPainValidation(lead),
    topThreeFindings: buildTopThreeFindings(lead),
    pitch: buildPitch(lead, variant),
    objectionHandler: buildObjectionHandler(lead, variant),
    collectPayment: buildCollectPayment(lead, variant),
    collectMeetingTime: buildCollectMeetingTime(lead),
    softGoodbye: buildSoftGoodbye(lead),
    voicemail: buildVoicemail(lead, variant),
    wrapUp: buildWrapUp(lead)
  };
  const script = {
    schemaVersion: 'ai-call-script/1.0',
    generatedAt: new Date().toISOString(),
    consentSource: consentSource || null,
    lead: {
      domain: lead.domain,
      businessName: lead.businessName,
      industry: lead.industry,
      city: lead.city,
      state: lead.state,
      contactName: lead.contactName,
      contactInfo: lead.contactInfo,
      audit: lead.audit,
      qualifier: lead.qualifier
    },
    priceVariant: variant,
    priceConfig: PRICE_VARIANTS[variant],
    persona: detectedPersona,
    personaLabel: PERSONAS[detectedPersona]?.label || null,
    states,
    estimatedDurationSec: Object.values(states).reduce((s, b) => s + (b.durationSec || 0), 0),
    estimatedCostUsd: 0.18 // ballpark for ~3min call at typical provider rates
  };
  script.aggregatedPrompt = buildAggregatedPrompt(script);
  return script;
}

module.exports = {
  generateScript,
  pickPriceVariantForLead,
  buildOpener,
  buildAggregatedPrompt,
  PRICE_VARIANTS
};
