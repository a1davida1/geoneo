/**
 * Standardized HTTP fetch wrapper with timeout + retry-with-backoff.
 *
 * Use this for EVERY external API call (PageSpeed, Ahrefs, Places,
 * LanguageTool, Resend, Bland/Vapi/Retell, etc). Single retry policy
 * across the codebase = predictable behavior under flaky network.
 *
 * Behavior:
 *   - AbortController timeout (default 15s, configurable per call)
 *   - Up to 3 retries (4 total attempts) on retryable errors
 *   - Exponential backoff: 500ms, 2000ms, 8000ms (with ±20% jitter)
 *   - Retryable: 408, 425, 429, 500, 502, 503, 504, network errors, timeouts
 *   - NOT retryable: 4xx other than above (would just fail again)
 *   - Structured error logging via shared logger
 *   - Returns the Response object on success — caller .json()s it as usual
 *
 * Optional response body for non-retryable failures: caller can pass
 * `parseError: true` to have the error message include the response body
 * snippet (useful when the API returns structured error JSON).
 */

const log = require('./logger').forModule('httpRetry');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [500, 2000, 8000];
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function jitter(ms) {
  const delta = ms * 0.2;
  return Math.round(ms + (Math.random() * 2 - 1) * delta);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isRetryableError(err) {
  if (!err) return true;
  const msg = String(err.message || err);
  if (err.name === 'AbortError') return true;
  if (/network|timeout|abort|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(msg)) return true;
  return false;
}

/**
 * fetchWithRetry(url, options, { timeoutMs, maxRetries, label, parseError })
 *   - url: same as fetch()
 *   - options: same as fetch() (method, headers, body, etc)
 *   - timeoutMs: per-attempt timeout (each retry gets a fresh timer)
 *   - maxRetries: 0 = no retry; default 3
 *   - label: log tag (e.g. 'pagespeed', 'ahrefs:metrics') — appears in logs
 *   - parseError: include first 200 chars of response body in error message
 *                 on non-retryable HTTP errors
 *
 * Returns the Response (not parsed). Throws on final failure.
 */
async function fetchWithRetry(url, options = {}, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
  const maxRetries = Number.isFinite(Number(opts.maxRetries)) ? Number(opts.maxRetries) : DEFAULT_MAX_RETRIES;
  const label = opts.label || 'http';
  const parseError = Boolean(opts.parseError);
  let attempt = 0;
  let lastErr = null;
  while (attempt <= maxRetries) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const start = Date.now();
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      // Retryable HTTP status?
      if (RETRYABLE_STATUS.has(res.status)) {
        let bodyHint = '';
        if (parseError) {
          try { bodyHint = (await res.clone().text()).slice(0, 200); } catch {}
        }
        const err = new Error(`HTTP ${res.status} (retryable)${bodyHint ? ': ' + bodyHint : ''}`);
        err.status = res.status;
        err.retryable = true;
        throw err;
      }
      // Non-retryable HTTP status (e.g. 401, 403, 404, 422)?
      if (!res.ok) {
        let bodyHint = '';
        if (parseError) {
          try { bodyHint = (await res.clone().text()).slice(0, 200); } catch {}
        }
        const err = new Error(`HTTP ${res.status}${bodyHint ? ': ' + bodyHint : ''}`);
        err.status = res.status;
        err.retryable = false;
        log.warn(`${label} non-retryable failure`, { url, status: res.status, attempt: attempt + 1, durationMs: Date.now() - start });
        throw err;
      }
      // Success
      if (attempt > 0) log.info(`${label} succeeded after retry`, { url, attempt: attempt + 1, durationMs: Date.now() - start });
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const retryable = err.retryable !== false && (err.retryable === true || isRetryableError(err));
      if (!retryable || attempt >= maxRetries) {
        log.error(`${label} failed`, { url, attempt: attempt + 1, error: err.message, retryable });
        throw err;
      }
      const backoff = jitter(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
      log.warn(`${label} attempt failed, retrying`, { url, attempt: attempt + 1, error: err.message, backoffMs: backoff });
      await sleep(backoff);
      attempt++;
    }
  }
  throw lastErr || new Error('fetchWithRetry exhausted retries');
}

/**
 * Convenience: fetch + .json() with retry. Throws on failure.
 */
async function fetchJsonWithRetry(url, options = {}, opts = {}) {
  const res = await fetchWithRetry(url, options, opts);
  return res.json();
}

module.exports = {
  fetchWithRetry,
  fetchJsonWithRetry,
  isRetryableError,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  RETRYABLE_STATUS
};
