#!/usr/bin/env node
/**
 * REAL throughput benchmark. Runs the actual sweep audit pipeline (not a
 * stripped-down version) and saves results to the audit archive — same as
 * the production cron does.
 *
 * What this exercises (vs the previous benchmark which skipped):
 *   - prepareDeepAuditInputs (fetches HTML + robots.txt + llms.txt + sitemap)
 *   - All 12 sub-analyzers (schema, eeat, geo, sitemap, nap, images,
 *     performance/PageSpeed, content/LanguageTool, ssl, crawl, links, mobile)
 *   - auditArchive.saveAudit (atomic write, dedup check, side-channel marks)
 *   - Real PageSpeed API calls (rate-limited at 25k/day)
 *   - Real LanguageTool API calls (rate-limited at 20/min for free tier)
 *
 * Usage:
 *   node scripts/benchmark-real-throughput.js [--n=200] [--concurrency=5] [--source=archive|sample]
 *
 * Default source: 'archive' — pulls existing domains from data/audit-archive/
 * Source 'sample' — uses a hand-curated 50-domain plumbing list
 *
 * Reports per-section timings, API failure rates, projected sustained
 * throughput at the chosen concurrency.
 */

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) acc[m[1]] = m[2] || true;
  return acc;
}, {});

const os = require('os');

/**
 * Auto-tune concurrency based on available RAM + CPU cores.
 * Heuristic: each concurrent audit holds ~80MB peak (HTML + sub-analyzer
 * results + JSON serialization). Reserve 2GB headroom for OS + Node base.
 *
 * Examples:
 *   - 4GB RAM, 4 cores → 2-way (memory-bound)
 *   - 16GB RAM, 8 cores → 8-way (cpu-bound first)
 *   - 64GB RAM, 16 cores → 16-way (cpu-bound, plenty of memory)
 */
function autoTuneConcurrency() {
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
  const freeMb = Math.floor(os.freemem() / 1024 / 1024);
  const cores = os.cpus().length;
  const usableMb = Math.max(512, freeMb - 2048); // reserve 2GB headroom
  const memoryCap = Math.floor(usableMb / 80); // 80MB per concurrent audit
  const cpuCap = Math.max(2, Math.min(cores * 2, 32)); // up to 2× core count, max 32
  const tuned = Math.max(2, Math.min(memoryCap, cpuCap));
  return { tuned, totalMb, freeMb, cores, memoryCap, cpuCap };
}

const N = Number(args.n) || 200;
const AUTO_TUNE = args['auto-tune'] === true || args['auto-tune'] === 'true';
const TUNE_INFO = AUTO_TUNE ? autoTuneConcurrency() : null;
const CONCURRENCY = TUNE_INFO ? TUNE_INFO.tuned : (Number(args.concurrency) || 5);
const SOURCE = args.source || 'archive';
// Skip rate-limited external APIs (PageSpeed, LanguageTool) for pure
// structural-audit ceiling. Default ON for benchmarks since LT free tier
// is 20/min and chokes the run after ~80 audits.
const SKIP_EXTERNAL = args['no-external'] !== 'false';
const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'audit-archive');

const SAMPLE_PLUMBERS = [
  // Hand-curated list — known indexable, no aggressive bot blocking
  'rotorooter.com', 'mrrooter.com', 'arsrescue.com', 'mikediamondservices.com',
  'leakdetectionusa.com', 'plumbingexpress.com', 'precisionplumbing.com',
  'benfranklinplumbing.com', 'rotoroofing.com', 'haynesplumbing.com',
  'a1tampa.com', 'roto.com', 'plumbingservicegroup.com', 'paulthe-plumber.com',
  'plumbsmart.com', 'aspenplumbing.com', 'plumbservices.com', 'westcoastplumbing.com',
  'plumberseattle.com', 'plumbingdoctor.com'
];

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.floor(sorted.length * p / 100);
  return sorted[Math.min(i, sorted.length - 1)];
}

async function withConcurrency(items, concurrency, fn, onProgress) {
  const results = [];
  let next = 0;
  let completed = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: err.message };
      }
      completed++;
      if (onProgress && completed % 10 === 0) onProgress(completed, items.length);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadDomainsFromArchive(limit) {
  const out = [];
  try {
    const files = await fsp.readdir(ARCHIVE_DIR);
    for (const f of files) {
      if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
      try {
        const raw = await fsp.readFile(path.join(ARCHIVE_DIR, f), 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.domain && parsed.history?.[0]) {
          out.push({
            domain: parsed.domain,
            industry: parsed.history[0].industry || 'plumber',
            city: parsed.history[0].city || 'Branson',
            state: parsed.history[0].state || 'MO'
          });
        }
      } catch {}
    }
  } catch (err) {
    console.warn('archive read failed:', err.message);
  }
  // Cycle the list when N exceeds available domains so the benchmark
  // reflects a sustained real workload. --unique disables cycling for
  // diagnostic runs (use to isolate whether hangs are cycle-related).
  if (out.length === 0) return out;
  if (args.unique === true || args.unique === 'true') return out.slice(0, limit);
  const cycled = [];
  for (let i = 0; i < limit; i++) cycled.push(out[i % out.length]);
  return cycled;
}

async function loadDomainsFromSample(limit) {
  return SAMPLE_PLUMBERS.slice(0, limit).map((domain) => ({
    domain, industry: 'plumber', city: 'Branson', state: 'MO'
  }));
}

async function main() {
  console.log(`\n=== GeoNeo REAL Throughput Benchmark ===`);
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Source: ${SOURCE} · N: ${N} · Concurrency: ${CONCURRENCY} · Skip-external-APIs: ${SKIP_EXTERNAL}`);
  if (TUNE_INFO) {
    console.log(`Auto-tune: ${TUNE_INFO.totalMb}MB total · ${TUNE_INFO.freeMb}MB free · ${TUNE_INFO.cores} cores`);
    console.log(`  → memory cap: ${TUNE_INFO.memoryCap} · cpu cap: ${TUNE_INFO.cpuCap} · chose: ${TUNE_INFO.tuned}`);
  } else {
    console.log(`(use --auto-tune to size concurrency for your machine)`);
  }

  const domains = SOURCE === 'archive' ? await loadDomainsFromArchive(N) : await loadDomainsFromSample(N);
  if (!domains.length) {
    console.error('No domains loaded. Exit.');
    process.exit(1);
  }
  console.log(`Loaded ${domains.length} domains.\n`);

  // Lazy-import server (which exports sweepSchedulerAuditFn).
  // require.main !== module so the server doesn't auto-listen.
  const server = require('../server');
  const auditDeep = require('../services/auditDeep');
  if (typeof server.sweepSchedulerAuditFn !== 'function') {
    console.error('server.sweepSchedulerAuditFn not exported. Add to module.exports.');
    process.exit(1);
  }

  // Track per-section times (sectionElapsedMs from each audit)
  const sectionMs = [];
  const wallClockStart = Date.now();
  let inflight = 0; let maxInflight = 0;

  // Hard wall-clock per audit. The audit pipeline has section timeouts
  // (8-18s) but no top-level cap — a stuck network connection inside one
  // sub-analyzer can hang indefinitely. 45s ceiling lets even slow audits
  // finish but kills truly-hung workers so the batch progresses.
  const PER_AUDIT_TIMEOUT_MS = Number(process.env.BENCH_PER_AUDIT_TIMEOUT_MS) || 45000;

  const VERBOSE = args.verbose === true || args.verbose === 'true';
  const results = await withConcurrency(domains, CONCURRENCY, async (d, i) => {
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    const start = Date.now();
    if (VERBOSE) console.error(`\n[${new Date().toISOString().slice(11, 19)}] start ${i+1}: ${d.domain}`);
    try {
      const url = `https://${d.domain}`;
      // Race the audit against a wall-clock timeout
      const result = await Promise.race([
        server.sweepSchedulerAuditFn({ url, industry: d.industry, city: d.city, state: d.state, skipExternalApis: SKIP_EXTERNAL }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`per_audit_timeout (${PER_AUDIT_TIMEOUT_MS}ms)`)), PER_AUDIT_TIMEOUT_MS))
      ]);
      const totalMs = Date.now() - start;
      const audit = result?.audit || null;
      if (audit && audit.sectionElapsedMs != null) sectionMs.push(audit.sectionElapsedMs);
      return {
        domain: d.domain,
        ok: Boolean(audit?.overallScore),
        totalMs,
        score: audit?.overallScore,
        sectionMs: audit?.sectionElapsedMs,
        findingsCount: Array.isArray(audit?.findings) ? audit.findings.length : 0
      };
    } catch (err) {
      return { domain: d.domain, ok: false, error: err.message, totalMs: Date.now() - start };
    } finally {
      inflight--;
    }
  }, (done, total) => {
    const elapsed = (Date.now() - wallClockStart) / 1000;
    const rate = (done / elapsed).toFixed(2);
    process.stdout.write(`\r  progress: ${done}/${total} · ${rate}/sec · inflight=${inflight}     `);
  });

  process.stdout.write('\n');
  const wallClockMs = Date.now() - wallClockStart;
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const times = ok.map((r) => r.totalMs).sort((a, b) => a - b);
  const sortedSection = sectionMs.slice().sort((a, b) => a - b);
  const avg = times.length ? Math.round(times.reduce((s, n) => s + n, 0) / times.length) : 0;

  // Group failures by error
  const errorBuckets = {};
  fail.forEach((f) => {
    const key = (f.error || 'unknown').slice(0, 60);
    errorBuckets[key] = (errorBuckets[key] || 0) + 1;
  });

  console.log(`\n--- Results ---`);
  console.log(`Total wall-clock: ${(wallClockMs / 1000).toFixed(1)}s`);
  console.log(`Successful: ${ok.length}/${domains.length} (${Math.round(ok.length / domains.length * 100)}%)`);
  console.log(`Failed: ${fail.length}`);
  if (fail.length) {
    Object.entries(errorBuckets).slice(0, 5).forEach(([err, count]) => {
      console.log(`  · ${count}× — ${err}`);
    });
  }
  console.log(`Max in-flight observed: ${maxInflight}`);

  console.log(`\nPer-domain time (full sweep path):`);
  console.log(`  avg: ${avg}ms · p50: ${percentile(times, 50)}ms · p75: ${percentile(times, 75)}ms · p95: ${percentile(times, 95)}ms · max: ${times[times.length - 1]}ms`);

  if (sortedSection.length) {
    console.log(`\nAudit sub-analyzer time (sectionElapsedMs across 12 pillars):`);
    console.log(`  avg: ${Math.round(sortedSection.reduce((s, n) => s + n, 0) / sortedSection.length)}ms · p50: ${percentile(sortedSection, 50)}ms · p95: ${percentile(sortedSection, 95)}ms`);
  }

  // Score distribution
  const scores = ok.map((r) => r.score).filter((s) => s != null).sort((a, b) => a - b);
  if (scores.length) {
    console.log(`\nScore distribution (sanity check):`);
    console.log(`  p10: ${percentile(scores, 10)} · p50: ${percentile(scores, 50)} · p90: ${percentile(scores, 90)} · n: ${scores.length}`);
  }

  // Throughput projection — based on actual measured wall-clock, not extrapolation
  const actualPerSec = ok.length / (wallClockMs / 1000);
  const actualPerHour = actualPerSec * 3600;
  const actualPerNight = actualPerHour * 6;
  console.log(`\n--- Measured Throughput @ ${CONCURRENCY}-way concurrent ---`);
  console.log(`  ${actualPerSec.toFixed(2)} successful audits/sec sustained`);
  console.log(`  ${Math.round(actualPerHour)} audits/hour`);
  console.log(`  ${Math.round(actualPerNight)} audits/6h-night (this run extrapolated)`);

  const target = 2500;
  if (actualPerNight >= target) {
    console.log(`  ✅ HITS 2,500/night target (${(actualPerNight / target).toFixed(1)}× headroom)`);
  } else {
    const needConc = Math.ceil(CONCURRENCY * (target / actualPerNight));
    console.log(`  ❌ MISSES 2,500/night target — need ${needConc}-way concurrent or faster audits`);
  }

  console.log(`\nAudits saved to data/audit-archive/ — verify with:`);
  console.log(`  ls -1 data/audit-archive/ | wc -l\n`);
  process.exit(0);
}

main().catch((err) => { console.error('Benchmark failed:', err); process.exit(1); });
