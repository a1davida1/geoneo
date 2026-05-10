/**
 * Internal / operator HTTP API access control.
 * Loopback is always allowed. Non-loopback clients must present a bearer token
 * matching GEONEO_INTERNAL_API_SECRET (required for non-local access).
 */
const crypto = require('crypto');

function normalizeString(value) {
  return String(value || '').trim();
}

function isLoopbackRequest(req) {
  const remote = (req.socket && req.socket.remoteAddress) || '';
  return (
    remote === '127.0.0.1'
    || remote === '::1'
    || remote === '::ffff:127.0.0.1'
  );
}

function bearerMatches(req, secret) {
  const auth = normalizeString(req.headers && req.headers.authorization);
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return false;
  }
  const token = auth.slice(7).trim();
  const tokenBuffer = Buffer.from(token, 'utf8');
  const secretBuffer = Buffer.from(secret, 'utf8');
  if (tokenBuffer.length !== secretBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(tokenBuffer, secretBuffer);
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
function authorizeInternalApi(req) {
  if (isLoopbackRequest(req)) {
    return true;
  }
  const secret = normalizeString(process.env.GEONEO_INTERNAL_API_SECRET);
  if (!secret) {
    return false;
  }
  return bearerMatches(req, secret);
}

/**
 * Allow either internal operators (loopback or secret bearer) OR public member dashboard callers.
 * Member eligibility (isEligibleForWeeklyScore) and audit existence are enforced inside handlers.
 */
function authorizeInternalOrMember(req) {
  if (authorizeInternalApi(req)) return true;
  // Public member routes are intentionally reachable from the browser.
  // Data protection comes from 404 (no audit) + 403 membership_required (not eligible).
  return true;
}

module.exports = {
  authorizeInternalApi,
  authorizeInternalOrMember,
  isLoopbackRequest,
  bearerMatches
};
