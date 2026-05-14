/**
 * Centralized logger. Single format across the entire codebase:
 *
 *   [ISO_TIMESTAMP] [MODULE_NAME] [LEVEL] message {contextObject}
 *
 * Levels (numeric for easy comparison):
 *   ERROR (50) — broken; user-facing failure or data corruption risk
 *   WARN  (40) — degraded; partial result returned, retry recommended
 *   INFO  (30) — normal lifecycle (audit complete, batch dispatched, etc.)
 *   DEBUG (20) — verbose; gated behind LOG_LEVEL=debug env
 *
 * LOG_LEVEL env controls the minimum level emitted (default: info).
 * In production set LOG_LEVEL=warn to silence info-chatter.
 *
 * Usage:
 *   const log = require('./logger').forModule('auditDeep');
 *   log.info('audit complete', { domain, score, durationMs });
 *   log.warn('partial result', { domain, missingSection: 'pagespeed' });
 *   log.error('save failed', { domain, error: err.message, stack: err.stack });
 *
 * Why not winston/pino? Because the codebase is already shipped, this is
 * a drop-in replacement for `console.log` with structured fields. No new
 * dependency, no transport config, just better discipline.
 */

const LEVELS = { ERROR: 50, WARN: 40, INFO: 30, DEBUG: 20 };
const LEVEL_NAMES = { 50: 'ERROR', 40: 'WARN', 30: 'INFO', 20: 'DEBUG' };

function envLevel() {
  const raw = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  if (raw === 'debug') return LEVELS.DEBUG;
  if (raw === 'warn') return LEVELS.WARN;
  if (raw === 'error') return LEVELS.ERROR;
  return LEVELS.INFO;
}

let MIN_LEVEL = envLevel();

/**
 * ANSI color codes for human-readable terminal output. Stripped when not
 * a TTY (so log files don't get polluted with escape sequences).
 */
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  dim: '\x1b[2m'
};

function colorize(text, color) {
  if (!process.stdout.isTTY) return text;
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

function levelColor(levelNum) {
  if (levelNum >= 50) return 'red';
  if (levelNum >= 40) return 'yellow';
  if (levelNum >= 30) return 'cyan';
  return 'gray';
}

/**
 * Serialize a context object safely. Handles Error instances (extracts
 * message + stack), circular refs, and oversized payloads.
 */
function serializeContext(ctx) {
  if (ctx == null) return '';
  if (typeof ctx !== 'object') return ` ${String(ctx).slice(0, 500)}`;
  const out = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v instanceof Error) {
      out[k] = { message: v.message, stack: v.stack ? v.stack.split('\n').slice(0, 5).join('\n') : null };
    } else if (typeof v === 'function') {
      out[k] = '[Function]';
    } else if (typeof v === 'object' && v !== null) {
      try {
        const json = JSON.stringify(v);
        out[k] = json.length > 600 ? json.slice(0, 600) + '…' : v;
      } catch {
        out[k] = '[Unserializable]';
      }
    } else {
      out[k] = v;
    }
  }
  try {
    const s = JSON.stringify(out);
    return s === '{}' ? '' : ` ${s}`;
  } catch {
    return '';
  }
}

function emit(moduleName, levelNum, message, ctx) {
  if (levelNum < MIN_LEVEL) return;
  const ts = new Date().toISOString();
  const lvl = LEVEL_NAMES[levelNum] || 'INFO';
  const lvlPadded = lvl.padEnd(5);
  const modPadded = String(moduleName || 'unknown').padEnd(20);
  const ctxStr = serializeContext(ctx);
  const line = `${colorize(ts, 'gray')} ${colorize('[' + modPadded + ']', 'dim')} ${colorize('[' + lvlPadded + ']', levelColor(levelNum))} ${message}${colorize(ctxStr, 'gray')}`;
  // ERROR + WARN go to stderr, INFO + DEBUG go to stdout (so JSON logs
  // can be split if pipe-redirected).
  if (levelNum >= LEVELS.WARN) console.error(line);
  else console.log(line);
}

/**
 * Returns a per-module logger object. Pre-binds the module name.
 */
function forModule(moduleName) {
  return {
    error: (msg, ctx) => emit(moduleName, LEVELS.ERROR, msg, ctx),
    warn:  (msg, ctx) => emit(moduleName, LEVELS.WARN, msg, ctx),
    info:  (msg, ctx) => emit(moduleName, LEVELS.INFO, msg, ctx),
    debug: (msg, ctx) => emit(moduleName, LEVELS.DEBUG, msg, ctx),
    /** Return a child logger with a sub-name (e.g. forModule('audit').child('schema')). */
    child: (subName) => forModule(`${moduleName}/${subName}`)
  };
}

/**
 * Runtime level adjustment (admin endpoint can call this without restart).
 */
function setLevel(name) {
  const map = { error: LEVELS.ERROR, warn: LEVELS.WARN, info: LEVELS.INFO, debug: LEVELS.DEBUG };
  const next = map[String(name || '').toLowerCase()];
  if (next == null) throw new Error('invalid level: ' + name);
  MIN_LEVEL = next;
  emit('logger', LEVELS.INFO, 'log level set', { level: name });
  return MIN_LEVEL;
}

function getLevel() {
  return Object.entries(LEVELS).find(([, v]) => v === MIN_LEVEL)?.[0] || 'INFO';
}

module.exports = {
  forModule,
  setLevel,
  getLevel,
  LEVELS
};
