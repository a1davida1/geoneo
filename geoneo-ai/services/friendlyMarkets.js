/**
 * Curated "AI-call-friendly" markets.
 *
 * For each US state where modeled AI-call-friction is LOWER (one-party
 * recording consent + no separate AI-disclosure flag), we pick the top
 * 1-3 metros by population so the sweep scheduler has a sensible default.
 *
 * The friction tier comes from getAiCallComplianceForState in
 * services/leadGenBatch.js. This list adds the city dimension on top.
 *
 * Picked metros are biased toward:
 *   - Larger metro areas (more local-service businesses to find)
 *   - Markets with diverse vertical coverage (not company towns)
 *   - States in the south-east + midwest where contractor markets are denser
 *
 * Per-state metro counts:
 *   - Tier-1 large states (TX, FL, GA, NC, OH, TN, VA, AZ): 2 metros
 *   - Tier-2 mid states (AL, LA, IN, MO, OK, KY, SC, IA, MS, NM, AR, etc): 1 metro
 *   - Small states with one obvious metro: 1 metro
 *
 * NOT legal advice: even in one-party-consent states, federal TCPA + DNC
 * still apply. Disclosure of AI-assisted calls is a separate legal call
 * the operator must make per their compliance team.
 */

const { getAiCallComplianceForState } = require('./leadGenBatch');

/**
 * Top metro per state (city, state, populationHint, label).
 * Population hints are in thousands and used only for sorting suggestions.
 * Cities chosen for: density of local-service businesses (not just total pop).
 */
const STATE_METROS = {
  AL: [{ city: 'Birmingham', pop: 200 }, { city: 'Montgomery', pop: 195 }, { city: 'Mobile', pop: 184 }],
  AK: [{ city: 'Anchorage', pop: 290 }],
  AZ: [{ city: 'Phoenix', pop: 1620 }, { city: 'Tucson', pop: 545 }, { city: 'Mesa', pop: 510 }],
  AR: [{ city: 'Little Rock', pop: 200 }, { city: 'Fayetteville', pop: 95 }],
  CO: [{ city: 'Denver', pop: 715 }, { city: 'Colorado Springs', pop: 480 }],
  GA: [{ city: 'Atlanta', pop: 500 }, { city: 'Augusta', pop: 200 }, { city: 'Savannah', pop: 145 }],
  HI: [{ city: 'Honolulu', pop: 350 }],
  ID: [{ city: 'Boise', pop: 235 }],
  IN: [{ city: 'Indianapolis', pop: 880 }, { city: 'Fort Wayne', pop: 270 }],
  IA: [{ city: 'Des Moines', pop: 215 }, { city: 'Cedar Rapids', pop: 135 }],
  KS: [{ city: 'Wichita', pop: 397 }, { city: 'Overland Park', pop: 200 }],
  KY: [{ city: 'Louisville', pop: 625 }, { city: 'Lexington', pop: 322 }],
  LA: [{ city: 'New Orleans', pop: 380 }, { city: 'Baton Rouge', pop: 220 }],
  ME: [{ city: 'Portland', pop: 70 }],
  MN: [{ city: 'Minneapolis', pop: 430 }, { city: 'Saint Paul', pop: 311 }],
  MS: [{ city: 'Jackson', pop: 150 }],
  MO: [{ city: 'Kansas City', pop: 510 }, { city: 'St. Louis', pop: 300 }, { city: 'Springfield', pop: 170 }, { city: 'Branson', pop: 13 }],
  NE: [{ city: 'Omaha', pop: 490 }, { city: 'Lincoln', pop: 295 }],
  NJ: [{ city: 'Newark', pop: 305 }, { city: 'Jersey City', pop: 290 }],
  NM: [{ city: 'Albuquerque', pop: 565 }, { city: 'Santa Fe', pop: 88 }],
  NC: [{ city: 'Charlotte', pop: 875 }, { city: 'Raleigh', pop: 470 }, { city: 'Greensboro', pop: 300 }],
  ND: [{ city: 'Fargo', pop: 125 }],
  OH: [{ city: 'Columbus', pop: 905 }, { city: 'Cleveland', pop: 372 }, { city: 'Cincinnati', pop: 309 }],
  OK: [{ city: 'Oklahoma City', pop: 695 }, { city: 'Tulsa', pop: 411 }],
  RI: [{ city: 'Providence', pop: 190 }],
  SC: [{ city: 'Charleston', pop: 150 }, { city: 'Columbia', pop: 138 }, { city: 'Greenville', pop: 70 }],
  SD: [{ city: 'Sioux Falls', pop: 200 }],
  TN: [{ city: 'Nashville', pop: 695 }, { city: 'Memphis', pop: 633 }, { city: 'Knoxville', pop: 192 }],
  TX: [{ city: 'Houston', pop: 2300 }, { city: 'Dallas', pop: 1300 }, { city: 'Austin', pop: 965 }, { city: 'San Antonio', pop: 1450 }, { city: 'Fort Worth', pop: 935 }],
  UT: [{ city: 'Salt Lake City', pop: 200 }, { city: 'West Valley City', pop: 140 }],
  VT: [{ city: 'Burlington', pop: 45 }],
  VA: [{ city: 'Virginia Beach', pop: 460 }, { city: 'Richmond', pop: 230 }, { city: 'Norfolk', pop: 240 }],
  WV: [{ city: 'Charleston', pop: 47 }],
  WI: [{ city: 'Milwaukee', pop: 580 }, { city: 'Madison', pop: 270 }],
  WY: [{ city: 'Cheyenne', pop: 65 }],
  DC: [{ city: 'Washington', pop: 690 }]
};

/**
 * Return all (city, state) pairs in states whose aiCallRisk is "medium"
 * (favorable) — i.e., one-party-recording-consent AND no extra
 * AI-disclosure flag. Sorted by population descending.
 *
 * Options:
 *   metrosPerState: cap how many metros per state (default 1)
 *   includeAllMetros: if true, ignore the cap (default false)
 *
 * Returns array of { city, state, pop }.
 */
function pickFriendlyMarkets({ metrosPerState = 1, includeAllMetros = false } = {}) {
  const results = [];
  for (const [state, metros] of Object.entries(STATE_METROS)) {
    const compliance = getAiCallComplianceForState(state);
    if (compliance.aiCallRisk !== 'medium') continue;
    const sorted = metros.slice().sort((a, b) => b.pop - a.pop);
    const picks = includeAllMetros ? sorted : sorted.slice(0, metrosPerState);
    for (const m of picks) {
      results.push({ city: m.city, state, pop: m.pop });
    }
  }
  return results.sort((a, b) => b.pop - a.pop);
}

/**
 * For UI display. Returns same as pickFriendlyMarkets but also enriches
 * each entry with `riskLabel`, `recordingConsent`, etc., for the operator
 * to read in the UI.
 */
function describeFriendlyMarkets(opts = {}) {
  return pickFriendlyMarkets(opts).map((m) => {
    const c = getAiCallComplianceForState(m.state);
    return {
      ...m,
      recordingConsent: c.recordingConsent,
      aiCallRisk: c.aiCallRisk,
      needsAiDisclosure: c.needsAiDisclosure
    };
  });
}

module.exports = { pickFriendlyMarkets, describeFriendlyMarkets, STATE_METROS };
