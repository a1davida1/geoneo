/**
 * Score History Manager
 * Stores and retrieves historical visibility scores for club members.
 */

const fs = require('fs/promises');
const path = require('path');
const { extractRootDomain, normalizeDomain } = require('./serpProvider');

const ROOT = path.join(__dirname, '..');

let writeLock = Promise.resolve();

function withLock(fn) {
  const previous = writeLock;
  let release;
  writeLock = new Promise((resolve) => { release = resolve; });
  return previous.then(() => fn().finally(release));
}

function scoresFilePath() {
  return process.env.GEONEO_SCORES_PATH
    ? path.resolve(process.env.GEONEO_SCORES_PATH)
    : path.join(ROOT, 'data', 'scores.json');
}

function normalizeScoreDomain(domain) {
  return extractRootDomain(normalizeDomain(domain));
}

async function loadScores() {
  try {
    const raw = await fs.readFile(scoresFilePath(), 'utf8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveScores(scores) {
  const filePath = scoresFilePath();
  const tmp = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(scores, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}

/**
 * Record a new score for a domain
 */
async function recordScore(domain, scoreData) {
  return withLock(async () => {
    const normalizedDomain = normalizeScoreDomain(domain);
    const scores = await loadScores();

    scores.push({
      domain: normalizedDomain,
      ...scoreData,
      recordedAt: new Date().toISOString()
    });

    await saveScores(scores);
    return true;
  });
}

/**
 * Get historical scores for a domain (most recent first)
 */
async function getHistoryForDomain(domain, limit = 12) {
  const normalizedDomain = normalizeScoreDomain(domain);
  const scores = await loadScores();
  return scores
    .filter(s => normalizeScoreDomain(s.domain) === normalizedDomain)
    .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))
    .slice(0, limit);
}

/**
 * Get latest score for a domain
 */
async function getLatestScore(domain) {
  const history = await getHistoryForDomain(domain, 1);
  return history[0] || null;
}

module.exports = {
  recordScore,
  getHistoryForDomain,
  getLatestScore,
  normalizeScoreDomain
};