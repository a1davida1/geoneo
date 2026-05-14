/**
 * Provider-agnostic AI call dispatcher. Adapter pattern lets us plug in
 * Bland / Vapi / Retell / any future provider with a 30-min adapter.
 *
 * Active provider is selected by AI_CALL_PROVIDER env:
 *   - 'stub' (default): logs the call + simulates events for local dev
 *   - 'bland': Bland.ai (https://docs.bland.ai)
 *   - 'vapi':  Vapi (https://docs.vapi.ai)
 *   - 'retell': Retell AI (https://docs.retellai.com)
 *
 * Each adapter implements:
 *   { name, hasCredentials(), dispatchCall(call, callbackUrl) →
 *     { providerCallId, accepted: bool, error?: string } }
 *
 * Dispatch flow:
 *   1. dispatch(call) picks the active adapter
 *   2. Adapter sends the request to the provider
 *   3. Queue marked 'dialing' with the providerCallId
 *   4. Provider POSTs webhook events to /api/ai-call/webhook
 *   5. webhook normalizes + updates queue + triggers post-call routing
 *
 * Cost tracking: each adapter populates `providerCost` in the call record
 * when the provider returns it (Bland reports per-call cost; Vapi sends
 * via the call.ended webhook; Retell ditto).
 */

const aiCallQueue = require('./aiCallQueue');

const PROVIDER = (process.env.AI_CALL_PROVIDER || 'stub').toLowerCase();
const PUBLIC_BASE_URL = process.env.GEONEO_PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4173}`;
const WEBHOOK_PATH = '/api/ai-call/webhook';

/* ============================ Stub adapter ============================ */
/**
 * Stub provider — does nothing real. Used for local dev and tests.
 * Returns a fake providerCallId immediately. To simulate a call ending,
 * call simulateOutcome(callId, outcome) on this module.
 */
const stubAdapter = {
  name: 'stub',
  hasCredentials() { return true; },
  async dispatchCall(call) {
    const providerCallId = `stub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[ai-call/stub] dispatch ${call.id} → ${providerCallId} · ${call.contactPhone || 'no_phone'} · $${call.priceVariant}/mo pitch`);
    return { providerCallId, accepted: true };
  }
};

/* ============================ Bland adapter ============================ */
const blandAdapter = {
  name: 'bland',
  hasCredentials() { return Boolean(process.env.BLAND_API_KEY); },
  async dispatchCall(call) {
    if (!this.hasCredentials()) return { accepted: false, error: 'no_bland_api_key' };
    if (!call.contactPhone) return { accepted: false, error: 'no_phone_number' };
    try {
      const r = await fetch('https://api.bland.ai/v1/calls', {
        method: 'POST',
        headers: {
          authorization: process.env.BLAND_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone_number: call.contactPhone,
          task: call.scriptSnapshot.aggregatedPrompt,
          model: process.env.BLAND_MODEL || 'enhanced',
          first_sentence: call.scriptSnapshot.states?.opener?.lines?.[0] || 'Hi, this is a quick call from the GeoNeo audit team.',
          voice: process.env.BLAND_VOICE || 'maya',
          language: 'ENG',
          max_duration: 8, // minutes
          metadata: {
            geoneoCallId: call.id,
            domain: call.domain,
            priceVariant: call.priceVariant
          },
          webhook: `${PUBLIC_BASE_URL}${WEBHOOK_PATH}?provider=bland&callId=${encodeURIComponent(call.id)}`,
          record: true,
          analysis_schema: { outcome: 'string', summary: 'string', sentiment: 'string' }
        })
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return { accepted: false, error: `bland_http_${r.status}: ${text.slice(0, 200)}` };
      }
      const json = await r.json();
      return { providerCallId: json.call_id, accepted: true };
    } catch (err) {
      return { accepted: false, error: 'bland_network: ' + err.message };
    }
  }
};

/* ============================ Vapi adapter ============================ */
const vapiAdapter = {
  name: 'vapi',
  hasCredentials() { return Boolean(process.env.VAPI_API_KEY) && Boolean(process.env.VAPI_PHONE_NUMBER_ID); },
  async dispatchCall(call) {
    if (!this.hasCredentials()) return { accepted: false, error: 'no_vapi_credentials' };
    if (!call.contactPhone) return { accepted: false, error: 'no_phone_number' };
    try {
      const r = await fetch('https://api.vapi.ai/call', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.VAPI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
          customer: { number: call.contactPhone },
          assistant: {
            model: { provider: 'openai', model: 'gpt-4o-mini', messages: [{ role: 'system', content: call.scriptSnapshot.aggregatedPrompt }] },
            voice: { provider: 'eleven-labs', voiceId: process.env.VAPI_VOICE_ID || 'rachel' },
            firstMessage: call.scriptSnapshot.states?.opener?.lines?.[0] || 'Hi, quick call from the GeoNeo audit team.',
            endCallFunctionEnabled: true,
            recordingEnabled: true
          },
          metadata: { geoneoCallId: call.id, domain: call.domain, priceVariant: call.priceVariant },
          serverUrl: `${PUBLIC_BASE_URL}${WEBHOOK_PATH}?provider=vapi&callId=${encodeURIComponent(call.id)}`
        })
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return { accepted: false, error: `vapi_http_${r.status}: ${text.slice(0, 200)}` };
      }
      const json = await r.json();
      return { providerCallId: json.id, accepted: true };
    } catch (err) {
      return { accepted: false, error: 'vapi_network: ' + err.message };
    }
  }
};

/* ============================ Retell adapter ============================ */
const retellAdapter = {
  name: 'retell',
  hasCredentials() { return Boolean(process.env.RETELL_API_KEY) && Boolean(process.env.RETELL_AGENT_ID) && Boolean(process.env.RETELL_FROM_NUMBER); },
  async dispatchCall(call) {
    if (!this.hasCredentials()) return { accepted: false, error: 'no_retell_credentials' };
    if (!call.contactPhone) return { accepted: false, error: 'no_phone_number' };
    try {
      const r = await fetch('https://api.retellai.com/v2/create-phone-call', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${process.env.RETELL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from_number: process.env.RETELL_FROM_NUMBER,
          to_number: call.contactPhone,
          override_agent_id: process.env.RETELL_AGENT_ID,
          metadata: { geoneoCallId: call.id, domain: call.domain, priceVariant: call.priceVariant },
          retell_llm_dynamic_variables: {
            business_name: call.businessName,
            opportunity_high: String(call.scriptSnapshot.lead?.audit?.dollarOpportunity?.monthly?.high || 0),
            score: String(call.scriptSnapshot.lead?.audit?.overallScore ?? 'unknown'),
            price_pitch: call.scriptSnapshot.priceConfig?.pitchOneLine || '',
            full_prompt: call.scriptSnapshot.aggregatedPrompt
          }
        })
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        return { accepted: false, error: `retell_http_${r.status}: ${text.slice(0, 200)}` };
      }
      const json = await r.json();
      return { providerCallId: json.call_id, accepted: true };
    } catch (err) {
      return { accepted: false, error: 'retell_network: ' + err.message };
    }
  }
};

/* ============================ Active adapter ============================ */
const ADAPTERS = {
  stub: stubAdapter,
  bland: blandAdapter,
  vapi: vapiAdapter,
  retell: retellAdapter
};

function getActiveAdapter() {
  const adapter = ADAPTERS[PROVIDER];
  if (!adapter) {
    console.warn(`[ai-call] unknown provider "${PROVIDER}"; falling back to stub`);
    return stubAdapter;
  }
  if (!adapter.hasCredentials()) {
    console.warn(`[ai-call] provider "${PROVIDER}" missing credentials; falling back to stub`);
    return stubAdapter;
  }
  return adapter;
}

/**
 * Dispatch a single call. Updates queue state to 'dialing' on success
 * or 'failed' on hard error.
 */
async function dispatchCall(callId) {
  const call = await aiCallQueue.getCall(callId);
  if (!call) throw new Error(`call_not_found: ${callId}`);
  if (call.state !== 'queued') {
    return { ok: false, error: `call_not_queued (state=${call.state})` };
  }
  // CONSENT RE-CHECK at dispatch time. Consent could have been revoked
  // between enqueue and dial (user replied STOP after the original consent).
  if (!call.consentOverride) {
    const callConsent = require('./callConsent');
    const stillConsented = await callConsent.hasValidConsent(call.domain);
    if (!stillConsented) {
      await aiCallQueue.cancelCall(callId, 'consent_revoked_after_enqueue');
      return { ok: false, error: 'consent_revoked_after_enqueue' };
    }
  }
  const adapter = getActiveAdapter();
  const result = await adapter.dispatchCall(call);
  if (!result.accepted) {
    await aiCallQueue.markFailed(callId, result.error || 'unknown_dispatch_error');
    return { ok: false, error: result.error };
  }
  await aiCallQueue.markDispatched(callId, {
    provider: adapter.name,
    providerCallId: result.providerCallId
  });
  return { ok: true, provider: adapter.name, providerCallId: result.providerCallId };
}

/**
 * Dispatch the next batch of queued calls. Bounded by `limit` so we
 * don't blast the provider with hundreds at once. Returns counts.
 */
async function dispatchBatch({ limit = 10 } = {}) {
  const batch = await aiCallQueue.nextBatch({ limit });
  if (!batch.length) return { dispatched: 0, failed: 0, batchSize: 0 };
  let dispatched = 0; let failed = 0;
  for (const call of batch) {
    const r = await dispatchCall(call.id);
    if (r.ok) dispatched++;
    else failed++;
  }
  return { batchSize: batch.length, dispatched, failed };
}

/**
 * Diagnostic: which provider is active, and is it configured?
 */
function providerStatus() {
  const out = {};
  for (const [name, adapter] of Object.entries(ADAPTERS)) {
    out[name] = { hasCredentials: adapter.hasCredentials() };
  }
  out.active = PROVIDER;
  out.effective = getActiveAdapter().name;
  return out;
}

/**
 * Stub-only helper. Lets the admin UI simulate a finished call without
 * a real provider. Forces the call to completed with a chosen outcome.
 */
async function simulateOutcome(callId, outcome, summary = null) {
  const call = await aiCallQueue.getCall(callId);
  if (!call) throw new Error('call_not_found');
  return aiCallQueue.markCompleted(callId, {
    state: 'completed',
    outcome,
    summary: summary || `[STUB] simulated ${outcome}`,
    durationSec: 90,
    aiSentiment: outcome === 'closed_won' ? 'positive' : (outcome === 'no_interest' ? 'negative' : 'neutral')
  });
}

module.exports = {
  dispatchCall,
  dispatchBatch,
  providerStatus,
  simulateOutcome,
  getActiveAdapter,
  PROVIDER
};
