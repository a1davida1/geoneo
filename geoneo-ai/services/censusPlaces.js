/**
 * U.S. Census 2020 PL places → city names for Prospect Hunter city dropdowns.
 * Cached per process + per state to limit outbound calls.
 */

const https = require('https');

/** USPS code → 2020 Census state FIPS as two-character strings with leading zeros (e.g. AL→'01', AK→'02'). These exact string values are interpolated into the Census API URL (`in=state:${fips}`). */
const STATE_POSTAL_TO_FIPS = {
  AL: '01',
  AK: '02',
  AZ: '04',
  AR: '05',
  CA: '06',
  CO: '08',
  CT: '09',
  DE: '10',
  DC: '11',
  FL: '12',
  GA: '13',
  HI: '15',
  ID: '16',
  IL: '17',
  IN: '18',
  IA: '19',
  KS: '20',
  KY: '21',
  LA: '22',
  ME: '23',
  MD: '24',
  MA: '25',
  MI: '26',
  MN: '27',
  MS: '28',
  MO: '29',
  MT: '30',
  NE: '31',
  NV: '32',
  NH: '33',
  NJ: '34',
  NM: '35',
  NY: '36',
  NC: '37',
  ND: '38',
  OH: '39',
  OK: '40',
  OR: '41',
  PA: '42',
  RI: '44',
  SC: '45',
  SD: '46',
  TN: '47',
  TX: '48',
  UT: '49',
  VT: '50',
  VA: '51',
  WA: '53',
  WV: '54',
  WI: '55',
  WY: '56'
};

const placesCache = new Map();

function normalizePlaceName(censusName) {
  if (!censusName || typeof censusName !== 'string') return '';
  let s = censusName.split(',')[0].trim();
  /** Places where trailing " city" (or similar) is part of the legal name, not a Census suffix. */
  const suffixStripExceptions = new Set([
    'oklahoma city',
    'kansas city',
    'salt lake city',
    'jefferson city',
    'atlantic city',
    'carson city',
    'panama city',
    'iowa city',
    'traverse city',
    'rapid city',
    'texas city',
    'union city',
    'new york city'
  ]);
  const lower = s.toLowerCase();
  if (suffixStripExceptions.has(lower)) {
    return s;
  }
  s = s.replace(/\s+borough$/i, '');
  s = s.replace(/\s+municipality$/i, '');
  s = s.replace(/\s+consolidated government$/i, '');
  s = s.replace(/\s+metro government$/i, '');
  s = s.replace(/\s+unified government \([^)]+\)$/i, '');
  s = s.replace(/\s+unified government$/i, '');
  s = s.replace(/\s+city and borough$/i, '');
  s = s.replace(/\s+CDP$/i, '');
  s = s.replace(/\s+city$/i, '');
  s = s.replace(/\s+town$/i, '');
  s = s.replace(/\s+village$/i, '');
  return s.trim();
}

function httpsGetJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {import('http').ClientRequest | undefined} */
    let req;

    const finishOk = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(val);
    };
    const finishErr = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(err);
    };

    const deadline = setTimeout(() => {
      if (req && !req.destroyed) req.destroy();
      finishErr(new Error('census_timeout'));
    }, timeoutMs);

    req = https.get(
      url,
      { headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            finishErr(new Error(`census_http_${res.statusCode}`));
            return;
          }
          try {
            finishOk(JSON.parse(body));
          } catch (e) {
            finishErr(new Error('census_json_parse'));
          }
        });
        res.on('error', finishErr);
      }
    );
    req.on('error', finishErr);
  });
}

/**
 * @param {string} statePostal e.g. MO, CA
 * @returns {Promise<{ cities: string[], source: string, state: string }>}
 */
async function fetchCitiesForStatePostal(statePostal) {
  const code = String(statePostal || '').trim().toUpperCase();
  if (!STATE_POSTAL_TO_FIPS[code]) {
    throw new Error('unknown_state');
  }
  const cached = placesCache.get(code);
  if (cached) return cached;

  const fips = STATE_POSTAL_TO_FIPS[code];
  const url = `https://api.census.gov/data/2020/dec/pl?get=NAME,P1_001N&for=place:*&in=state:${fips}`;
  /** @type {any[][]} */
  const rows = await httpsGetJson(url);
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error('census_empty');
  }
  const header = rows[0];
  const nameIdx = header.indexOf('NAME');
  const popIdx = header.indexOf('P1_001N');
  if (nameIdx < 0 || popIdx < 0) {
    throw new Error('census_schema');
  }

  const scored = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawName = row[nameIdx];
    const pop = Number(row[popIdx]);
    const label = normalizePlaceName(rawName);
    if (!label) continue;
    scored.push({ label, pop: Number.isFinite(pop) ? pop : 0 });
  }

  scored.sort((a, b) => b.pop - a.pop || a.label.localeCompare(b.label));

  const seen = new Set();
  const cities = [];
  for (const { label } of scored) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cities.push(label);
  }

  const payload = { cities, source: 'census_2020_pl', state: code };
  placesCache.set(code, payload);
  return payload;
}

module.exports = {
  STATE_POSTAL_TO_FIPS,
  fetchCitiesForStatePostal,
  normalizePlaceName
};
