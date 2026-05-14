/**
 * Nightly data backup scheduler.
 *
 * Tarballs everything in data/ (excluding data/backups/ itself) into a
 * single .tar.gz file in data/backups/{YYYY-MM-DD}.tar.gz.
 *
 * Retention: keeps the last KEEP_LAST_N (default 14) backups, deletes
 * older ones. Manual override: BACKUP_RETENTION_DAYS env.
 *
 * Compression: uses native tar (universally available on Linux/macOS).
 * Falls back to skipping with warning if tar isn't found.
 *
 * Excluded from backups (regenerable / not worth backing up):
 *   - data/backups/        (recursive, would be huge)
 *   - data/grammar-cache/  (re-fetchable)
 *   - data/ahrefs-cache/   (re-fetchable)
 *   - data/screenshots/    (re-generatable, large)
 *   - data/serp-screenshots/ (large)
 *   - *.tmp                (atomic-write temp files)
 *
 * Cron: default daily at 3:30am server time (after weekly score runs at 3am
 * but before re-audit at 4am). Configurable via BACKUP_CRON env.
 */

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const cron = require('node-cron');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP_LAST_N = Number(process.env.BACKUP_KEEP_LAST) || 14;
const DEFAULT_CRON = process.env.BACKUP_CRON || '30 3 * * *'; // 3:30am daily
const EXCLUDE_PATHS = [
  'backups',
  'grammar-cache',
  'ahrefs-cache',
  'screenshots',
  'serp-screenshots'
];

let cronTask = null;

function todayStamp() {
  const now = new Date();
  return now.toISOString().slice(0, 10) + '_' + now.toISOString().slice(11, 13) + now.toISOString().slice(14, 16);
}

async function tarballExists() {
  return new Promise((resolve) => {
    const p = spawn('tar', ['--version']);
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Run `tar -czf <out> -C data/ <files...>` to create a backup. Returns
 * { ok, out, sizeBytes, durationMs }.
 */
async function makeTarball(outPath) {
  const start = Date.now();
  // Build the file list inside data/ excluding the heavy/regenerable dirs
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const include = entries
    .filter((e) => !EXCLUDE_PATHS.includes(e.name) && !e.name.endsWith('.tmp'))
    .map((e) => e.name);
  if (!include.length) {
    return { ok: false, error: 'no files to back up' };
  }
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  return new Promise((resolve) => {
    const args = ['-czf', outPath, '-C', DATA_DIR, ...include];
    const p = spawn('tar', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    p.on('error', (err) => resolve({ ok: false, error: 'tar spawn failed: ' + err.message }));
    p.on('exit', async (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: `tar exited ${code}: ${stderr.slice(0, 200)}` });
        return;
      }
      try {
        const stat = await fs.stat(outPath);
        resolve({ ok: true, out: outPath, sizeBytes: stat.size, durationMs: Date.now() - start });
      } catch (err) {
        resolve({ ok: false, error: 'tar succeeded but output missing: ' + err.message });
      }
    });
  });
}

/**
 * Delete backups older than KEEP_LAST_N. Sort by mtime so we keep the
 * newest regardless of filename.
 */
async function pruneOldBackups() {
  let entries;
  try { entries = await fs.readdir(BACKUP_DIR); } catch (err) {
    if (err && err.code === 'ENOENT') return { kept: 0, deleted: 0 };
    throw err;
  }
  const tarballs = entries.filter((e) => e.endsWith('.tar.gz'));
  if (tarballs.length <= KEEP_LAST_N) return { kept: tarballs.length, deleted: 0 };
  const stats = await Promise.all(
    tarballs.map(async (name) => ({ name, mtime: (await fs.stat(path.join(BACKUP_DIR, name))).mtimeMs }))
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  const toDelete = stats.slice(KEEP_LAST_N);
  for (const f of toDelete) {
    try { await fs.unlink(path.join(BACKUP_DIR, f.name)); } catch {}
  }
  return { kept: KEEP_LAST_N, deleted: toDelete.length };
}

async function runBackup() {
  if (!(await tarballExists())) {
    console.warn('[backup] tar not found in PATH — skipping');
    return { ok: false, error: 'tar_not_available' };
  }
  const out = path.join(BACKUP_DIR, `geoneo-data-${todayStamp()}.tar.gz`);
  const result = await makeTarball(out);
  if (!result.ok) {
    console.warn('[backup] failed:', result.error);
    return result;
  }
  const prune = await pruneOldBackups();
  console.log(`[backup] ${path.basename(result.out)} · ${(result.sizeBytes / 1024).toFixed(1)}KB · ${result.durationMs}ms · kept ${prune.kept}, pruned ${prune.deleted}`);
  return { ok: true, ...result, ...prune };
}

function startBackupScheduler() {
  if (cronTask) try { cronTask.stop(); } catch {}
  if (!cron.validate(DEFAULT_CRON)) {
    console.warn('[backup] invalid cron:', DEFAULT_CRON);
    return;
  }
  cronTask = cron.schedule(DEFAULT_CRON, () => { runBackup().catch(() => {}); });
  console.log(`[backup] scheduler started · cron=${DEFAULT_CRON} · keep=${KEEP_LAST_N}`);
}

function stopBackupScheduler() {
  if (cronTask) { try { cronTask.stop(); } catch {} cronTask = null; }
}

module.exports = { startBackupScheduler, stopBackupScheduler, runBackup };
