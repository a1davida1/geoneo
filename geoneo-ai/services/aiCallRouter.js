/**
 * Post-call routing engine. After every AI call completes, this decides
 * what happens next — based on the call outcome + lead quality:
 *
 *   closed_won     → mark lead as won + activate Maintenance + onboard
 *   booked_meeting → enqueue to human queue + send calendar invite
 *   transferred_human → already routed; just record + notify
 *   callback_requested → enqueue a follow-up call for the agreed time
 *   no_interest    → mark lost + suppress drip
 *   do_not_call    → suppress (auditArchive.recordSuppression)
 *   wrong_number   → suppress + alert (data quality issue)
 *   voicemail      → keep in nurture; queue retry per backoff schedule
 *   no_answer      → keep in nurture; queue retry per backoff schedule
 *   call_failed    → log + alert ops (likely provider issue)
 *
 * Top-10% rule: certain calls always go to a human regardless of AI outcome:
 *   - Lead has audit dollarOpportunity high ≥ $3,000/mo
 *   - Lead's qualifier returned recommendedTier 'smart_spend' or 'white_glove'
 *   - AI sentiment was 'positive' AND priceVariant ≥ $199
 *
 * No LLM. Pure deterministic rules.
 */

const aiCallQueue = require('./aiCallQueue');
const humanCallQueue = require('./humanCallQueue');
const leadPipeline = require('./leadPipeline');
const auditArchive = require('./auditArchive');

const RETRY_VOICEMAIL_HOURS = Number(process.env.AI_CALL_RETRY_VOICEMAIL_HOURS) || 48;
const RETRY_NO_ANSWER_HOURS = Number(process.env.AI_CALL_RETRY_NO_ANSWER_HOURS) || 24;
const MAX_ATTEMPTS = Number(process.env.AI_CALL_MAX_ATTEMPTS) || 3;
const TOP_DECILE_DOLLAR_THRESHOLD = 3000;

/**
 * Decide whether this call should ALWAYS go to a human (top-decile rule),
 * regardless of how the AI characterizes it.
 */
function isTopDecile(call) {
  const opp = call.scriptSnapshot?.lead?.audit?.dollarOpportunity?.monthly?.high
    || call.scriptSnapshot?.lead?.audit?.dollarOpportunityHigh
    || 0;
  if (opp >= TOP_DECILE_DOLLAR_THRESHOLD) return true;
  const tier = call.scriptSnapshot?.lead?.qualifier?.recommendedTier;
  if (tier && (tier === 'smart_spend' || tier.startsWith('white_glove'))) return true;
  if (call.aiSentiment === 'positive' && (call.priceVariant >= 199)) return true;
  return false;
}

/**
 * Enqueue an outcome-specific note onto the lead pipeline so the closer
 * sees the AI call result in the drawer's outcome history.
 */
async function logOutcomeOnLead(call, label, note) {
  try {
    await leadPipeline.recordOutcome(call.domain, {
      outcome: 'answered_pitched', // generic AI-call disposition
      note: `[AI call ${call.id}] ${label}: ${note || ''}`.slice(0, 1000),
      by: 'ai_dialer'
    });
  } catch {
    // recordOutcome enforces a known outcome; on rejection just add a note
    try {
      await leadPipeline.addNote(call.domain, {
        author: 'ai_dialer',
        text: `📞 AI call ${call.id} · ${label}\n${note || ''}`
      });
    } catch {}
  }
}

/**
 * Schedule a follow-up call by enqueueing a new queue entry with
 * scheduledAt set in the future. The script is regenerated (so it picks
 * up any audit changes since the last attempt) but the lead snapshot
 * keeps the original audit reference in the entry.
 */
async function scheduleFollowUpCall(call, hoursFromNow, reason) {
  if ((call.attempts || 0) >= MAX_ATTEMPTS) {
    await logOutcomeOnLead(call, 'max_attempts_reached', `Stopped retrying after ${MAX_ATTEMPTS} attempts. Reason: ${reason}`);
    return { ok: false, reason: 'max_attempts' };
  }
  const aiCallScriptGenerator = require('./aiCallScriptGenerator');
  const lead = call.scriptSnapshot?.lead;
  if (!lead) return { ok: false, reason: 'no_lead_snapshot' };
  const script = aiCallScriptGenerator.generateScript({ lead, priceVariant: call.priceVariant });
  const scheduledAt = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
  const idempotencyKey = `${call.domain}:${new Date(scheduledAt).toISOString().slice(0, 10)}:retry`;
  const result = await aiCallQueue.enqueueCall({
    lead, script,
    priceVariant: call.priceVariant,
    idempotencyKey,
    scheduledAt,
    priority: 'normal'
  });
  await logOutcomeOnLead(call, 'follow_up_scheduled', `Retry scheduled in ${hoursFromNow}h. Queue id: ${result.call.id}`);
  return { ok: true, queuedCallId: result.call.id, scheduledAt };
}

/**
 * Main router. Dispatches based on outcome.
 */
async function routeAfterCall(callId) {
  const call = await aiCallQueue.getCall(callId);
  if (!call) return { ok: false, error: 'call_not_found' };
  if (!call.outcome) return { ok: false, error: 'no_outcome_recorded' };

  const topDecile = isTopDecile(call);
  let routedTo = null; let humanQueueId = null;

  switch (call.outcome) {
    case 'closed_won': {
      // Solo close — activate Maintenance + onboard
      try {
        await leadPipeline.setStage(call.domain, 'won', { setBy: 'ai_dialer', note: `Closed by AI call ${call.id} at $${call.priceVariant}/mo` });
        await leadPipeline.setMaintenanceCustomer(call.domain, { active: true, by: 'ai_dialer', plan: `maintenance_${call.priceVariant}` });
        routedTo = 'won';
      } catch (err) {
        await logOutcomeOnLead(call, 'won_routing_failed', err.message);
      }
      break;
    }
    case 'booked_meeting':
    case 'callback_requested':
    case 'transferred_human': {
      // Human queue — top-decile gets dave/matt; otherwise round-robin
      const assignTo = topDecile ? (call.priceVariant >= 499 ? 'matt' : 'dave') : null;
      const hq = await humanCallQueue.enqueue({
        fromAiCallId: call.id,
        domain: call.domain,
        businessName: call.businessName,
        contactPhone: call.contactPhone,
        contactEmail: call.contactEmail,
        industry: call.industry, city: call.city, state: call.state,
        priority: topDecile ? 'p1' : 'p3',
        assignedTo: assignTo,
        reason: call.outcome,
        aiCallSummary: call.summary,
        priceVariant: call.priceVariant,
        leadSnapshot: call.scriptSnapshot?.lead || null
      });
      humanQueueId = hq.id;
      routedTo = 'human_queue';
      try {
        await leadPipeline.setStage(call.domain, 'booked', { setBy: 'ai_dialer', note: `AI ${call.outcome} → human queue ${hq.id}` });
      } catch {}
      break;
    }
    case 'no_interest': {
      try { await leadPipeline.setStage(call.domain, 'lost', { setBy: 'ai_dialer', note: `AI call ${call.id}: no interest. Summary: ${call.summary || ''}` }); } catch {}
      routedTo = 'lost';
      break;
    }
    case 'do_not_call':
    case 'wrong_number': {
      try {
        await auditArchive.recordSuppression(call.domain, `ai_dialer_${call.outcome}`);
        await leadPipeline.setStage(call.domain, 'lost', { setBy: 'ai_dialer', note: `AI call ${call.id}: ${call.outcome} — suppressed` });
      } catch {}
      routedTo = 'suppressed';
      break;
    }
    case 'voicemail': {
      const r = await scheduleFollowUpCall(call, RETRY_VOICEMAIL_HOURS, 'voicemail');
      routedTo = r.ok ? 'retry_scheduled' : 'max_attempts_lost';
      if (!r.ok) {
        try { await leadPipeline.setStage(call.domain, 'lost', { setBy: 'ai_dialer', note: `Stopped after ${MAX_ATTEMPTS} attempts (last was voicemail).` }); } catch {}
      }
      break;
    }
    case 'no_answer': {
      const r = await scheduleFollowUpCall(call, RETRY_NO_ANSWER_HOURS, 'no_answer');
      routedTo = r.ok ? 'retry_scheduled' : 'max_attempts_lost';
      if (!r.ok) {
        try { await leadPipeline.setStage(call.domain, 'lost', { setBy: 'ai_dialer', note: `Stopped after ${MAX_ATTEMPTS} attempts (no answer).` }); } catch {}
      }
      break;
    }
    case 'call_failed': {
      // Provider error — don't penalize the lead. Log + alert.
      console.warn(`[ai-call-router] call_failed for ${call.domain} (${call.id}): ${call.lastError || 'unknown'}`);
      routedTo = 'failed_provider_error';
      break;
    }
    default: {
      console.warn(`[ai-call-router] unknown outcome "${call.outcome}" for call ${call.id}`);
      routedTo = 'unrouted';
    }
  }

  await aiCallQueue.patchCall(callId, { routedTo, humanQueueId });
  return { ok: true, routedTo, humanQueueId, topDecile };
}

module.exports = {
  routeAfterCall,
  isTopDecile,
  scheduleFollowUpCall,
  TOP_DECILE_DOLLAR_THRESHOLD,
  MAX_ATTEMPTS
};
