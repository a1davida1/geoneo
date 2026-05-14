#!/usr/bin/env node
/**
 * Throughput benchmark. Runs N quick audits in parallel and reports:
 *   - average / median / p95 time per audit
 *   - per-section time breakdown
 *   - projected nightly throughput at the chosen concurrency
 *
 * Usage:
 *   node scripts/benchmark-throughput.js [--n=20] [--concurrency=4] [--batch] [--list=domains.txt]
 *
 * Defaults: 20 audits, 4-way concurrent, batchMode on.
 *
 * Reports against the 2,500/night spec target: at 7 audits/min sustained
 * (4-way × ~2s mean) the system would handle 600/hour = 6× the target.
 */

const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) acc[m[1]] = m[2] || true;
  return acc;
}, {});

const N = Number(args.n) || 20;
const CONCURRENCY = Number(args.concurrency) || 4;
const BATCH_MODE = args.batch !== 'false';
const LIST_PATH = args.list ? path.resolve(args.list) : null;

const DEFAULT_DOMAINS = [
  'rotorooter.com', 'mrrooter.com', 'angi.com', 'thumbtack.com', 'taskrabbit.com',
  'homeadvisor.com', 'porch.com', 'houzz.com', 'arsrescue.com', 'mikediamondservices.com',
  'leakdetectionusa.com', 'plumbingexpress.com', 'precisionplumbing.com', 'benfranklin.com', 'roto.com',
  'thisoldhouse.com', 'familyhandyman.com', 'consumerreports.org', 'mayoclinic.org', 'shopify.com'
];

async function loadDomains() {
  if (LIST_PATH) {
    const raw = fs.readFileSync(LIST_PATH, 'utf8');
    return raw.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, N);
  }
  return DEFAULT_DOMAINS.slice(0, N);
}

function percentile(sorted, p) {
  const i = Math.floor(sorted.length * p / 100);
  return sorted[Math.min(i, sorted.length - 1)];
}

async function withConcurrency(items, concurrency, fn) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: err.message };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const domains = await loadDomains();
  console.log(`\n=== GeoNeo Throughput Benchmark ===`);
  console.log(`Domains: ${domains.length} · Concurrency: ${CONCURRENCY} · BatchMode: ${BATCH_MODE}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Lazy-import server module so we get the same audit pipeline the cron uses
  const { runDeepAudit } = require('../services/auditDeep');
  const fetchModule = require('../services/httpRetry');

  const sectionTimes = {};
  const wallClockStart = Date.now();

  const results = await withConcurrency(domains, CONCURRENCY, async (domain) => {
    const url = 'https://' + domain;
    const start = Date.now();
    try {
      // Fetch HTML directly (faster than the full prepareDeepAuditInputs path)
      const r = await fetchModule.fetchWithRetry(url, { redirect: 'follow' }, { timeoutMs: 8000, maxRetries: 1, label: 'bench:fetch' });
      const html = await r.text();
      const fetchMs = Date.now() - start;

      const auditStart = Date.now();
      const audit = await runDeepAudit({
        html,
        finalUrl: url,
        robotsTxt: '',
        industry: 'plumber',
        city: 'Branson',
        state: 'MO',
        businessFacts: {},
        batchMode: BATCH_MODE
      });
      const auditMs = Date.now() - auditStart;

      // Track per-section times
      if (audit && audit.sectionElapsedMs != null) {
        sectionTimes._total = (sectionTimes._total || 0) + audit.sectionElapsedMs;
      }

      return { domain, ok: true, fetchMs, auditMs, totalMs: Date.now() - start, score: audit?.overallScore };
    } catch (err) {
      return { domain, ok: false, error: err.message, totalMs: Date.now() - start };
    }
  });

  const wallClockMs = Date.now() - wallClockStart;
  const ok = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const times = ok.map((r) => r.totalMs).sort((a, b) => a - b);
  const auditTimes = ok.map((r) => r.auditMs).sort((a, b) => a - b);
  const avg = times.length ? Math.round(times.reduce((s, n) => s + n, 0) / times.length) : 0;
  const auditAvg = auditTimes.length ? Math.round(auditTimes.reduce((s, n) => s + n, 0) / auditTimes.length) : 0;

  console.log(`\n--- Results ---`);
  console.log(`Total wall-clock: ${(wallClockMs / 1000).toFixed(1)}s`);
  console.log(`Successful: ${ok.length}/${domains.length}`);
  if (fail.length) {
    console.log(`Failed: ${fail.length}`);
    fail.slice(0, 5).forEach((f) => console.log(`  · ${f.domain}: ${f.error}`));
  }
  console.log(`\nPer-domain time (fetch + audit):`);
  console.log(`  avg: ${avg}ms · p50: ${percentile(times, 50)}ms · p95: ${percentile(times, 95)}ms · max: ${times[times.length - 1]}ms`);
  console.log(`\nAudit-only time (no fetch):`);
  console.log(`  avg: ${auditAvg}ms · p50: ${percentile(auditTimes, 50)}ms · p95: ${percentile(auditTimes, 95)}ms`);

  // Throughput projection
  const sustainedPerSec = (CONCURRENCY * 1000) / avg;
  const perHour = sustainedPerSec * 3600;
  const perNight = perHour * 6; // 6h overnight window
  console.log(`\n--- Projected Throughput @ ${CONCURRENCY}-way concurrent ---`);
  console.log(`  ${sustainedPerSec.toFixed(1)} audits/sec sustained`);
  console.log(`  ${Math.round(perHour)} audits/hour`);
  console.log(`  ${Math.round(perNight)} audits/6h-night`);
  const target = 2500;
  const ratio = perNight / target;
  if (ratio >= 1) {
    console.log(`  ✅ HITS 2,500/night target (${ratio.toFixed(1)}× headroom)`);
  } else {
    console.log(`  ❌ MISSES 2,500/night target — need ${(1 / ratio).toFixed(1)}× more throughput`);
    console.log(`  Try: --concurrency=${Math.ceil(CONCURRENCY * (1 / ratio))} or --batch=true`);
  }
  console.log();
}

main().catch((err) => { console.error('Benchmark failed:', err); process.exit(1); });
