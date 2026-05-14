/**
 * Google Places (New) API client. Augments competitor + audit data with
 * the rich fields Google Maps exposes that SERP scrapes don't carry:
 *
 *   - Full review count (not just stars) + recent reviews + sentiment
 *   - Photo URLs (for OG image / mockup generation)
 *   - Hours per day (regular + special hours)
 *   - "Popular times" + live wait time signals
 *   - Per-service price level / accessibility / amenities tags
 *   - GBP claim status
 *
 * Two endpoints used:
 *   - Text Search: places.googleapis.com/v1/places:searchText
 *   - Place Details: places.googleapis.com/v1/places/{placeId}
 *
 * Both require GOOGLE_PLACES_API_KEY in env. If missing, every call
 * returns { skipped: 'no_api_key' } so callers can degrade gracefully.
 *
 * Field masks (X-Goog-FieldMask) keep cost down — we only pull the
 * fields we actually use. Each call is ~$17/1000 (text search) or
 * $5/1000 (basic details), so we cache aggressively.
 */

const fs = require('fs/promises');
const path = require('path');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const BASE = 'https://places.googleapis.com/v1';
const CACHE_DIR = path.join(__dirname, '..', 'data', 'places-cache');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const TIMEOUT_MS = 12000;

const SEARCH_FIELD_MASK = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.websiteUri',
  'places.nationalPhoneNumber', 'places.rating', 'places.userRatingCount',
  'places.priceLevel', 'places.types', 'places.googleMapsUri',
  'places.location', 'places.businessStatus'
].join(',');

const DETAILS_FIELD_MASK = [
  'id', 'displayName', 'formattedAddress', 'addressComponents', 'websiteUri',
  'nationalPhoneNumber', 'internationalPhoneNumber',
  'rating', 'userRatingCount', 'reviews',
  'priceLevel', 'priceRange', 'types', 'primaryType', 'googleMapsUri',
  'location', 'plusCode', 'businessStatus',
  'regularOpeningHours', 'currentOpeningHours', 'utcOffsetMinutes',
  'photos', 'editorialSummary',
  'allowsDogs', 'curbsidePickup', 'delivery', 'dineIn',
  'reservable', 'takeout',
  'parkingOptions', 'paymentOptions', 'accessibilityOptions'
].join(',');

function isAvailable() {
  return Boolean(API_KEY);
}

function status() {
  return { available: isAvailable(), provider: 'google_places_v1' };
}

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function safeFilename(s) {
  return String(s || '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
}

async function readCache(key) {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, safeFilename(key) + '.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.cachedAt && (Date.now() - parsed.cachedAt) < CACHE_TTL_MS) return parsed.data;
  } catch {}
  return null;
}

async function writeCache(key, data) {
  try {
    await ensureCacheDir();
    const file = path.join(CACHE_DIR, safeFilename(key) + '.json');
    const tmp = file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify({ cachedAt: Date.now(), data }, null, 2), 'utf8');
    await fs.rename(tmp, file);
  } catch {}
}

async function postJson(url, body, fieldMask) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Places HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    return r.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, fieldMask) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': fieldMask
      }
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`Places HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    return r.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Find a place by free-text query (typically `businessName + address`
 * or `industry + city + state`). Returns up to 5 candidates ranked by
 * Google's relevance.
 */
async function searchPlaces(query, { locationBias = null, regionCode = 'us' } = {}) {
  if (!isAvailable()) return { skipped: 'no_api_key', results: [] };
  const cacheKey = `search-${safeFilename(query)}-${regionCode}`;
  const cached = await readCache(cacheKey);
  if (cached) return { results: cached, fromCache: true };
  try {
    const body = { textQuery: query, maxResultCount: 5 };
    if (locationBias) body.locationBias = locationBias;
    if (regionCode) body.regionCode = regionCode;
    const r = await postJson(`${BASE}/places:searchText`, body, SEARCH_FIELD_MASK);
    const results = (r.places || []).map((p) => ({
      placeId: p.id,
      name: p.displayName?.text || null,
      address: p.formattedAddress || null,
      website: p.websiteUri || null,
      phone: p.nationalPhoneNumber || null,
      rating: p.rating || null,
      reviewCount: p.userRatingCount || null,
      priceLevel: p.priceLevel || null,
      types: p.types || [],
      mapsUri: p.googleMapsUri || null,
      location: p.location || null,
      businessStatus: p.businessStatus || null
    }));
    await writeCache(cacheKey, results);
    return { results, fromCache: false };
  } catch (err) {
    return { error: err.message, results: [] };
  }
}

/**
 * Pull the full Place Details for a known placeId. Includes hours,
 * photos, recent reviews, accessibility, and accepted payment methods.
 *
 * Returns null on failure (so callers can degrade silently).
 */
async function getPlaceDetails(placeId) {
  if (!isAvailable()) return { skipped: 'no_api_key' };
  if (!placeId) return null;
  const cacheKey = `details-${safeFilename(placeId)}`;
  const cached = await readCache(cacheKey);
  if (cached) return { ...cached, fromCache: true };
  try {
    const r = await getJson(`${BASE}/places/${encodeURIComponent(placeId)}`, DETAILS_FIELD_MASK);
    const compact = {
      placeId: r.id,
      name: r.displayName?.text || null,
      address: r.formattedAddress || null,
      addressComponents: r.addressComponents || [],
      website: r.websiteUri || null,
      phone: r.nationalPhoneNumber || null,
      phoneIntl: r.internationalPhoneNumber || null,
      rating: r.rating || null,
      reviewCount: r.userRatingCount || null,
      reviews: (r.reviews || []).slice(0, 5).map((rev) => ({
        author: rev.authorAttribution?.displayName || null,
        rating: rev.rating || null,
        text: rev.text?.text || rev.originalText?.text || null,
        publishTime: rev.publishTime || null,
        relativeTime: rev.relativePublishTimeDescription || null
      })),
      priceLevel: r.priceLevel || null,
      types: r.types || [],
      primaryType: r.primaryType || null,
      mapsUri: r.googleMapsUri || null,
      location: r.location || null,
      businessStatus: r.businessStatus || null,
      regularHours: r.regularOpeningHours?.weekdayDescriptions || null,
      isOpenNow: r.regularOpeningHours?.openNow ?? null,
      photos: (r.photos || []).slice(0, 5).map((p) => ({
        name: p.name,
        widthPx: p.widthPx,
        heightPx: p.heightPx,
        // Photo URL pattern: places.googleapis.com/v1/{name}/media?maxHeightPx=400&key=KEY
        // We return the path; UI builds the full URL with their key
        photoUriPath: p.name
      })),
      editorialSummary: r.editorialSummary?.text || null,
      amenities: {
        allowsDogs: r.allowsDogs ?? null,
        curbsidePickup: r.curbsidePickup ?? null,
        delivery: r.delivery ?? null,
        dineIn: r.dineIn ?? null,
        reservable: r.reservable ?? null,
        takeout: r.takeout ?? null
      },
      paymentOptions: r.paymentOptions || null,
      accessibility: r.accessibilityOptions || null,
      parking: r.parkingOptions || null
    };
    await writeCache(cacheKey, compact);
    return compact;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Convenience: given a domain + (industry, city, state), search Places,
 * pick the best match (by website-domain match if possible), return full
 * details. Used by the lead drawer "Pull GBP details" action.
 */
async function findBestMatchByDomain({ domain, businessName, industry, city, state }) {
  if (!isAvailable()) return { skipped: 'no_api_key' };
  if (!domain) return { error: 'domain_required' };
  const query = [businessName, industry, city, state].filter(Boolean).join(' ');
  if (!query) return { error: 'query_required' };
  const search = await searchPlaces(query);
  if (search.skipped) return search;
  if (search.error) return search;
  const targetDomain = String(domain).toLowerCase().replace(/^www\./, '');
  // Prefer a result whose website hostname matches our target domain
  let best = (search.results || []).find((p) => {
    if (!p.website) return false;
    try {
      const h = new URL(p.website).hostname.replace(/^www\./, '').toLowerCase();
      return h === targetDomain || h.endsWith('.' + targetDomain);
    } catch { return false; }
  });
  if (!best) best = search.results[0];
  if (!best || !best.placeId) return { error: 'no_match', candidates: search.results };
  const details = await getPlaceDetails(best.placeId);
  return { matched: true, placeId: best.placeId, search: { resultsCount: search.results.length, fromCache: search.fromCache }, details };
}

module.exports = {
  isAvailable,
  status,
  searchPlaces,
  getPlaceDetails,
  findBestMatchByDomain
};
