/**
 * Competitor Tracking Service (Production-Quality Version)
 * 
 * Tracks key competitors for each domain and their visibility movement over time.
 * Supports historical scoring so we can show week-over-week changes and trends.
 */

const fs = require('fs/promises');
const path = require('path');

const COMPETITORS_FILE = process.env.GEONEO_COMPETITORS_PATH
  ? path.resolve(process.env.GEONEO_COMPETITORS_PATH)
  : path.join(__dirname, '..', 'data', 'competitors.json');

async function loadCompetitors() {
  try {
    const raw = await fs.readFile(COMPETITORS_FILE, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveCompetitors(data) {
  await fs.mkdir(path.dirname(COMPETITORS_FILE), { recursive: true });
  const tmp = `${COMPETITORS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, COMPETITORS_FILE);
}

/**
 * Set or update the list of competitors to track for a domain.
 */
async function setTrackedCompetitors(domain, competitors) {
  const data = await loadCompetitors();
  const key = domain.toLowerCase();

  data[key] = competitors.map(comp => ({
    domain: comp.domain.toLowerCase(),
    name: comp.name,
    history: comp.history || [] // [{ date, score }]
  }));

  await saveCompetitors(data);
}

/**
 * Get tracked competitors for a domain
 */
async function getTrackedCompetitors(domain) {
  const data = await loadCompetitors();
  return data[domain.toLowerCase()] || [];
}

/**
 * Record a new visibility score for a specific competitor (audit-backed only in production flows).
 * @param {{ source?: 'audit'|'estimate' }} [meta]
 */
async function recordCompetitorScore(domain, competitorDomain, score, meta = {}) {
  const source = meta.source === 'estimate' ? 'estimate' : 'audit';
  const data = await loadCompetitors();
  const key = domain.toLowerCase();
  const compKey = competitorDomain.toLowerCase();

  if (!data[key]) data[key] = [];

  const competitor = data[key].find(c => c.domain === compKey);
  if (!competitor) {
    data[key].push({
      domain: compKey,
      name: competitorDomain,
      history: [{ date: new Date().toISOString(), score, source }]
    });
  } else {
    competitor.history.push({ date: new Date().toISOString(), score, source });
    // Keep only the last 12 entries
    if (competitor.history.length > 12) {
      competitor.history = competitor.history.slice(-12);
    }
  }

  await saveCompetitors(data);
}

function auditBackedHistory(history) {
  const rows = Array.isArray(history) ? history : [];
  return rows.filter((h) => !h.source || h.source === 'audit');
}

/** @returns {Promise<object|null>} */
async function getCompetitorMovement(domain, competitorDomain) {
  const competitors = await getTrackedCompetitors(domain);
  const comp = competitors.find(c => c.domain === competitorDomain.toLowerCase());

  if (!comp || comp.history.length === 0) return null;

  const series = auditBackedHistory(comp.history);
  if (series.length === 0) return null;

  const latest = series[series.length - 1];
  const previous = series.length > 1 ? series[series.length - 2] : null;

  const change = previous ? latest.score - previous.score : 0;

  return {
    ...comp,
    latestScore: latest.score,
    change,
    trend: change > 0 ? 'up' : change < 0 ? 'down' : 'stable'
  };
}

/**
 * Get all competitors with movement data for a domain
 */
async function getAllCompetitorMovements(domain) {
  const competitors = await getTrackedCompetitors(domain);
  const results = [];

  for (const comp of competitors) {
    const movement = await getCompetitorMovement(domain, comp.domain);
    if (movement) {
      results.push(movement);
    }
  }

  return results;
}

/**
 * Batch-update competitor scores (used after audit / weekly job).
 * @param {string} domain - owner domain key
 * @param {Record<string, number>} scoresMap - competitorDomain -> score
 */
async function updateCompetitorScores(domain, scoresMap) {
  if (!scoresMap || typeof scoresMap !== 'object') return;
  for (const [competitorDomain, score] of Object.entries(scoresMap)) {
    await recordCompetitorScore(domain, competitorDomain, Number(score));
  }
}

module.exports = {
  setTrackedCompetitors,
  getTrackedCompetitors,
  recordCompetitorScore,
  getCompetitorMovement,
  getAllCompetitorMovements,
  updateCompetitorScores
};