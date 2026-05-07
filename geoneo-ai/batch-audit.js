#!/usr/bin/env node
// Batch audit 50 Branson businesses across 6 industries
const http = require('http');
const PORT = 4199;
const DELAY_MS = 3000; // 3s between audits to respect API limits

const businesses = [
  // === TOWING & RECOVERY (8) ===
  { url: 'chrisstowingrecovery.com', industry: 'towing', city: 'Branson', state: 'MO' },
  { url: 'schraderstowingmo.com', industry: 'towing', city: 'Branson', state: 'MO' },
  { url: 'daveysautobody.com', industry: 'towing', city: 'Branson', state: 'MO' },
  { url: 'crawfordsautomotiveandtowing.com', industry: 'towing', city: 'Branson', state: 'MO' },
  { url: 'anchorroadside.com', industry: 'towing', city: 'Branson', state: 'MO' },
  { url: 'rpmrecovery.com', industry: 'towing', city: 'Branson', state: 'MO' },
  { url: 'servicewisetowing.com', industry: 'towing', city: 'Branson', state: 'MO' },
  { url: 'mohneystowinginc.net', industry: 'towing', city: 'Branson', state: 'MO' },

  // === HOTELS & LODGING (10) ===
  { url: 'thebransonhotel.com', industry: 'hotel', city: 'Branson', state: 'MO' },
  { url: 'thebradford.net', industry: 'hotel', city: 'Branson', state: 'MO' },
  { url: 'theozarkerlodge.com', industry: 'hotel', city: 'Branson', state: 'MO' },
  { url: 'grottoresort.com', industry: 'hotel', city: 'Branson', state: 'MO' },
  { url: 'bransoncarriagehouseinn.com', industry: 'hotel', city: 'Branson', state: 'MO' },
  { url: 'greengablesinnbranson.com', industry: 'hotel', city: 'Branson', state: 'MO' },
  { url: 'bransonsbest.com', industry: 'hotel', city: 'Branson', state: 'MO' },
  { url: 'myerhospitality.com', industry: 'hotel', city: 'Branson', state: 'MO' },
  { url: 'angelinnbranson.com', industry: 'hotel', city: 'Branson', state: 'MO' },
  { url: 'gazeboinn.com', industry: 'hotel', city: 'Branson', state: 'MO' },

  // === RESTAURANTS (10) ===
  { url: 'bransonuptown.com', industry: 'restaurant', city: 'Branson', state: 'MO' },
  { url: 'localflavorbranson.com', industry: 'restaurant', city: 'Branson', state: 'MO' },
  { url: 'billygailsrestaurant.com', industry: 'restaurant', city: 'Branson', state: 'MO' },
  { url: 'blackoakgrill.com', industry: 'restaurant', city: 'Branson', state: 'MO' },
  { url: 'ssdockside.com', industry: 'restaurant', city: 'Branson', state: 'MO' },
  { url: 'guysbranson.com', industry: 'restaurant', city: 'Branson', state: 'MO' },
  { url: 'branson.landsharkbarandgrill.com', industry: 'restaurant', city: 'Branson', state: 'MO' },
  { url: 'bransonsbestrestaurants.com', industry: 'restaurant', city: 'Branson', state: 'MO' },
  { url: 'dinebranson.com', industry: 'restaurant', city: 'Branson', state: 'MO' },
  { url: 'farmhouserestaurantbranson.com', industry: 'restaurant', city: 'Branson', state: 'MO' },

  // === SHOWS & ATTRACTIONS (8) ===
  { url: 'sight-sound.com', industry: 'entertainment', city: 'Branson', state: 'MO' },
  { url: 'claycoopertheatre.com', industry: 'entertainment', city: 'Branson', state: 'MO' },
  { url: 'themansiontheatre.com', industry: 'entertainment', city: 'Branson', state: 'MO' },
  { url: 'bransonshowtickets.com', industry: 'entertainment', city: 'Branson', state: 'MO' },
  { url: 'bransonshows.com', industry: 'entertainment', city: 'Branson', state: 'MO' },
  { url: 'allaccessbranson.com', industry: 'entertainment', city: 'Branson', state: 'MO' },
  { url: 'explorebranson.com', industry: 'entertainment', city: 'Branson', state: 'MO' },
  { url: 'bransontourismcenter.com', industry: 'entertainment', city: 'Branson', state: 'MO' },

  // === OUTDOOR & RECREATION (8) ===
  { url: 'breakingbassguideservice.com', industry: 'fishing guide', city: 'Branson', state: 'MO' },
  { url: 'bransonfishingadventures.com', industry: 'fishing guide', city: 'Branson', state: 'MO' },
  { url: 'bransonguidedfishingtrips.com', industry: 'fishing guide', city: 'Branson', state: 'MO' },
  { url: 'ericseliteguideservice.com', industry: 'fishing guide', city: 'Branson', state: 'MO' },
  { url: 'strikebass.com', industry: 'fishing guide', city: 'Branson', state: 'MO' },
  { url: 'tablerocklakefishing.com', industry: 'fishing guide', city: 'Branson', state: 'MO' },
  { url: 'catchmofish.com', industry: 'fishing guide', city: 'Branson', state: 'MO' },
  { url: 'dodsonguideservice.com', industry: 'fishing guide', city: 'Branson', state: 'MO' },

  // === HOME SERVICES (6) ===
  { url: 'dsfplumbing.com', industry: 'plumber', city: 'Branson', state: 'MO' },
  { url: 'allseasonscomfortsystems.com', industry: 'hvac', city: 'Branson', state: 'MO' },
  { url: 'lorenzphac.com', industry: 'hvac', city: 'Branson', state: 'MO' },
  { url: 'patriotmo.com', industry: 'hvac', city: 'Branson', state: 'MO' },
  { url: 'delongplumbing.com', industry: 'plumber', city: 'Branson', state: 'MO' },
  { url: 'reedsplumbing.com', industry: 'plumber', city: 'Branson', state: 'MO' },
];

console.log(`\n🚀 Branson Batch Audit — ${businesses.length} businesses across 6 industries\n`);

const results = [];
let completed = 0;
let failed = 0;

function auditOne(biz) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      url: `https://${biz.url}`,
      industry: biz.industry,
      city: biz.city,
      state: biz.state,
      package: 'admin'
    });
    const reqUrl = `/api/audit?${params.toString()}`;
    const req = http.get({ hostname: '127.0.0.1', port: PORT, path: reqUrl, timeout: 60000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const scores = data.scores || {};
          results.push({
            url: biz.url,
            industry: biz.industry,
            overall: scores.overall || 0,
            seo: scores.seo || 0,
            ai: scores.ai || 0,
            geo: scores.geo || 0,
            status: 'ok'
          });
          completed++;
          console.log(`✅ [${completed}/${businesses.length}] ${biz.url} — Overall: ${scores.overall || '?'} | SEO: ${scores.seo || '?'} | AI: ${scores.ai || '?'}`);
        } catch (e) {
          failed++;
          completed++;
          results.push({ url: biz.url, industry: biz.industry, status: 'parse_error' });
          console.log(`⚠️  [${completed}/${businesses.length}] ${biz.url} — Parse error`);
        }
        resolve();
      });
    });
    req.on('error', (e) => {
      failed++;
      completed++;
      results.push({ url: biz.url, industry: biz.industry, status: 'error', error: e.message });
      console.log(`❌ [${completed}/${businesses.length}] ${biz.url} — ${e.message}`);
      resolve();
    });
    req.on('timeout', () => {
      req.destroy();
      failed++;
      completed++;
      results.push({ url: biz.url, industry: biz.industry, status: 'timeout' });
      console.log(`⏱️  [${completed}/${businesses.length}] ${biz.url} — Timeout`);
      resolve();
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const start = Date.now();
  for (const biz of businesses) {
    await auditOne(biz);
    if (completed < businesses.length) await sleep(DELAY_MS);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`DONE — ${completed} audits in ${elapsed}s (${failed} failed)\n`);

  // Summary by industry
  const industries = [...new Set(businesses.map(b => b.industry))];
  for (const ind of industries) {
    const group = results.filter(r => r.industry === ind && r.status === 'ok');
    if (!group.length) { console.log(`${ind}: no successful audits`); continue; }
    const avg = (key) => Math.round(group.reduce((s, r) => s + (r[key] || 0), 0) / group.length);
    console.log(`${ind.toUpperCase()} (${group.length} businesses) — Avg Overall: ${avg('overall')} | SEO: ${avg('seo')} | AI: ${avg('ai')} | GEO: ${avg('geo')}`);
  }

  // Save results
  const fs = require('fs');
  const outPath = require('path').join(__dirname, 'data', 'batch-audit-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), total: businesses.length, completed, failed, results }, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

run().catch(console.error);
