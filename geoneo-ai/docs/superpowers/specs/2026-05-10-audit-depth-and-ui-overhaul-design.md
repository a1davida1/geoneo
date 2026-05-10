# Design: Audit Depth Rebuild + Mission Control UI/UX Overhaul + 10x SEO Plugin Parity

**Date:** 2026-05-10
**Author:** Claude (Opus 4.7) with Dave
**Status:** Draft — awaiting Dave's review
**Scope:** Full UI redesign + audit pipeline depth restoration + parity-then-exceed against the SEO MCP skill suite

---

## 1. Problem Statement

The current geoneo audit pipeline returns shallow output that looks AI-generated. The admin UI looks like a developer tool, not a product. Earlier iterations had real-depth audits (E-E-A-T, schema, novel suggestions) but those layers were lost or never made it into the optimized fork. We need to:

1. Rebuild full audit depth that matches or exceeds what each individual SEO MCP skill returns
2. Redesign the entire UI surface (admin + customer pages) to feel like a $200/mo product, not a side project
3. Add 10 measurable capabilities that exceed what any single SEO tool offers today

This spec covers all three in three phases.

---

## 2. Goals & Success Criteria

### Primary Goal
A geoneo audit produces output that a paying contractor reads in under 60 seconds and acts on this week, with depth that holds up against any best-in-class single-purpose SEO tool, delivered through a UI that doesn't feel like an internal dashboard.

### Success Criteria

- Audit response includes at minimum: visibility score, technical SEO, content E-E-A-T, schema analysis, image audit, sitemap validation, hreflang check, GEO/AI-search readiness, local signals, backlink snapshot
- Every fix recommendation includes: specific change, exact code/copy to paste, expected impact in $$ or rank positions, time-to-implement
- Admin shell passes the "would I show this to a customer" test
- Customer-facing pages render in under 2 seconds, look polished on mobile and desktop
- Tier filtering still works deterministically (Free/Silver/Gold/Admin)
- All new endpoints have unit tests
- 10 differentiating capabilities are listed in `/admin/about` and verifiable in the audit response

### Non-Goals (explicitly out of scope for this iteration)
- Full CRM integration (still uses pipeline.json)
- Multi-user authentication (still single-secret bearer)
- Mobile app
- Self-serve billing (Matt handles payment manually)
- Real-time collaboration

---

## 3. Architecture Overview

Three new top-level services + three new UI surfaces + 10 differentiator features layered on top.

### New services

| File | Purpose |
|---|---|
| `services/auditDeep.js` | Orchestrator that fans out parallel calls to all sub-analyzers and consolidates results |
| `services/eeatAnalyzer.js` | E-E-A-T scoring (8 dimensions: experience, expertise, authoritativeness, trust, identity transparency, source attribution, fresh content, contact accessibility) |
| `services/schemaAnalyzer.js` | Detect, validate, score depth, generate missing JSON-LD (LocalBusiness, FAQ, Service, Review, BreadcrumbList, Organization) |
| `services/imageAuditor.js` | Alt text quality, format/size, lazy loading, CLS impact |
| `services/sitemapValidator.js` | Parse XML, validate URLs, detect orphans vs crawled set |
| `services/hreflangChecker.js` | Detect, validate language/region tags, common mistakes |
| `services/geoAnalyzer.js` | llms.txt detection, passage citability scoring, AI engine presence test (multi-LLM matrix) |
| `services/napChecker.js` | Multi-platform NAP consistency (Google/Bing/Apple Maps/Yelp/Yellowpages) |
| `services/competitorSchemaGap.js` | Compare your schemas against top-3 competitor schemas |

### New endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/audit-deep?url=&industry=&city=&state=` | Full deep audit returning all sub-analyzer results |
| GET | `/api/audit-deep/schema?url=` | Schema-only deep dive |
| GET | `/api/audit-deep/eeat?url=` | E-E-A-T-only |
| GET | `/api/audit-deep/geo?url=&industry=` | GEO/AI-search-only with multi-LLM matrix |
| POST | `/api/generate/schema?url=&industry=&city=` | Returns ready-to-paste improved JSON-LD |
| POST | `/api/generate/llms-txt?url=` | Returns ready-to-paste llms.txt |
| POST | `/api/generate/outreach?prospectId=` | Returns ready-to-send outreach email draft |

### New UI surfaces

1. **Mission Control redesign** — sidebar nav stays, panels get card-grid layout, real charts (sparklines for score history, bars for opportunity by industry), badge system, dark/light theme toggle
2. **Customer audit results page redesign** — replaces current `index.html` results modal with a proper multi-section report (hero score → executive summary → per-section deep dive → 3 prioritized fixes → next steps)
3. **`/admin/about` page** — public-facing list of the 10 differentiating capabilities for sales conversations

---

## 4. Phase 1 — UI/UX Overhaul

### 4.1 Design system

- Color tokens: keep slate dark for admin, introduce light theme for customer pages with a single accent (electric cyan #38bdf8) and warm contrast (orange #f97316 for CTAs / warnings)
- Typography: Inter for body, JetBrains Mono for code/scores, no other faces
- Spacing scale: 4/8/12/16/24/32/48/64
- Shadow scale: 1 (subtle hairline), 2 (card lift), 3 (modal)
- Border radius: 8 default, 12 cards, 999 pills
- Component library (built inline, no framework dep): Card, Badge, Stat, Sparkline, ProgressBar, Tab, Modal, Toast, EmptyState, LoadingSkeleton

### 4.2 Mission Control redesign (admin/index.html)

Each panel becomes a structured layout instead of a wall of forms:

- **Command Center**: 6-stat grid → 3 chart cards (audit volume sparkline, opportunity $ histogram, weekly scoring health) → outbox tail table → recent activity feed
- **Quick Audit**: full-page hero (URL input centered) → result renders as multi-section report inline (not modal)
- **Operator Toolbox**: tabbed sub-sections (Audit / Reports / Citation / Neo Club / Pipeline) instead of one long scroll
- **Prospect Hunter**: split-pane (filters left, results table right), real chart of opportunity by industry above the table
- **Lead Pipeline**: table with inline edit, kanban swimlane view toggle (new/contacted/qualified/won/lost)
- **Visibility Engine**: timeline of weekly runs, per-domain status grid, manual trigger card
- **Customer Surfaces**: card grid of pages with thumbnails (puppeteer screenshot job, cached)

### 4.3 Customer-facing redesign

- `index.html` (homepage): hero with rotating industry word + city, scan form below the fold (currently above), trust strip with 50+ Branson businesses ranked, three-card pricing snapshot, footer with positioning
- Audit results page: replace modal with `/audit-results?id=...` route — hero score with grade letter, executive summary (3 sentences), section accordions for each pillar, 3-fix recommendation card with copy-paste blocks, upgrade CTA matching positioning ($79 one-time + Neo Club)
- `pricing.html`: real comparison table showing Free vs $79 vs Neo Club tiers, FAQ, "what you get" bullets per tier
- `member-dashboard.html`: weekly brief card on top, score sparkline, fix tracker progress bar, competitor cards
- All pages: mobile-first responsive, sub-2s load, no layout shift

### 4.4 Estimated effort
6-8 hours of focused work. Can be done in two sessions: admin shell first (3-4h), then customer pages (3-4h).

---

## 5. Phase 2 — Audit Depth Rebuild

### 5.1 Pillars (matches SEO MCP skill suite 1:1)

| Pillar | What it analyzes | Service module | SEO skill mirrored |
|---|---|---|---|
| Technical | crawlability, robots.txt, security headers, CWV, JS rendering, IndexNow ping, mobile viewport | extends technicalSeoDeep.js | seo-technical |
| Content E-E-A-T | experience signals, expertise (author bios), authoritativeness (citations), trust (HTTPS/contact/about/policies), identity transparency, freshness | NEW eeatAnalyzer.js | seo-content |
| Schema | detect all JSON-LD blocks, validate against Schema.org, score depth, list missing recommended types | NEW schemaAnalyzer.js | seo-schema |
| Images | alt text presence + quality, file format, dimensions vs displayed, lazy loading, dimensions attributes (CLS), modern formats (webp/avif) | NEW imageAuditor.js | seo-images |
| Sitemap | parse XML, validate URLs reachable, count, detect orphan pages (compared to crawled set), lastmod freshness | NEW sitemapValidator.js | seo-sitemap |
| Hreflang | detect tags, validate language/region codes, check reciprocity, return-tag rule | NEW hreflangChecker.js | seo-hreflang |
| GEO / AI search | llms.txt presence + content, passage citability scoring (Q&A blocks, definition blocks), AI engine presence test (Claude/GPT/Gemini/Perplexity) | NEW geoAnalyzer.js | seo-geo |
| Local | GBP profile signals from public maps lookup, NAP consistency across Google/Bing/Apple/Yelp, citation count, review velocity | extends localSearchVisibility.js + NEW napChecker.js | seo-local + seo-maps |
| Backlinks | Ahrefs DR/UR/refdomains/anchor distribution + top referring domains + toxic flag heuristic | extends ahrefsClient.js | seo-backlinks |

### 5.2 Orchestration

`services/auditDeep.js` exposes one function:

```
runDeepAudit({ url, industry, city, state, useAhrefs = false, llmMatrix = false })
  → returns { sections: { technical, eeat, schema, images, sitemap, hreflang, geo, local, backlinks }, scores, fixes, fixCount, generatedAt }
```

It fans out parallel `Promise.allSettled` calls to each sub-analyzer with per-section timeouts (8s default, configurable). Each sub-analyzer returns:

```
{ score, status: 'pass' | 'warn' | 'fail', findings: [...], fixes: [...], evidence: [...] }
```

`fixes` from each section flow into the existing prioritization pipeline (`buildPrioritizedActionPlan`) which already exists in server.js — we extend it to weight by `expectedRevenueLift` (computed via CPL × position-lift × CTR curve).

### 5.3 Tier filtering of deep output

- **Free**: overall score + grade + 1-line per pillar
- **Silver**: + section findings (no fixes, no evidence)
- **Gold / $79 one-time**: + fixes with copy-paste blocks + evidence + expected lift $$
- **Admin**: + raw evidence dumps + sub-analyzer timing + cache hit info

### 5.4 Estimated effort
6-8 hours. Each sub-analyzer is 60-150 lines plus tests. Can parallelize the build by having me fan out across all sub-analyzers in one session.

---

## 6. Phase 3 — 10 Measurable Differentiators

These exceed what any single SEO tool offers today by combining signals across pillars:

| # | Capability | Measurable proof |
|---|---|---|
| 1 | **Multi-LLM citation matrix** — same query tested across Claude, GPT-4, Gemini, Perplexity per industry vertical | Audit response includes `aiPresence: { claude, gpt, gemini, perplexity }` per top-N queries |
| 2 | **Geo-grid rank tracking** — DataForSEO grid pulls actual map-pack position at 9 lat/lng points within service radius | Audit response includes `geoGrid: [{ lat, lng, position, top3 }]` |
| 3 | **Schema gap vs competitors** — diff your schemas against top-3 competitor schemas, surface what they have you don't | `schemaGap: { yours: [...], theirs: [...], missing: [...], advantageScore }` |
| 4 | **Competitor-informed fix templates** — mine the actual on-page patterns of the top-3 ranking competitors for the same query, suggest the structural moves they're making (their actual schema fields, their actual H1 patterns, their actual FAQ topics) — no LLM at runtime | Each fix has `competitorEvidence: [{ url, snippet, signal }]` showing the real-world examples being copied |
| 5 | **Auto-generated llms.txt** — ready-to-paste file Matt's customers can ship in 30 seconds | `generatedAssets.llmsTxt` returns the full file content |
| 6 | **Auto-generated improved JSON-LD** — full LocalBusiness schema with hours, services, areaServed, geo, priceRange, sameAs (deduped from competitor research) | `generatedAssets.localBusinessSchema` returns ready JSON-LD |
| 7 | **Per-fix dollar lift estimate** — CPL × estimated position lift × CTR curve → estimated monthly $$$ if implemented | Each fix has `expectedMonthlyLift: { low, high }` |
| 8 | **Weekly delta tracker** — diff this week's score vs last week per pillar with red/green badges | `/api/score/diff?domain=&from=&to=` returns per-pillar deltas |
| 9 | **Prospect outreach email composer** — deterministic template stitched with real audit findings (top fix + dollar lift + competitor name + city) — no LLM, just smart variable substitution | `POST /api/generate/outreach` returns subject + body + CTA, fully deterministic from audit data |
| 10 | **Competitor intelligence snapshots** — public-source snapshots of competitor schema, meta, hours, on-page signals stored historically for change tracking | `competitors[i].snapshot: { capturedAt, title, meta, h1s, schemas, contactInfo }` |

### 6.1 Estimated effort
6-8 hours. #1, #2, #3, #4 are the most valuable — start there.

---

## 7. Tier Mapping (How features land in the customer experience)

| Feature | Free | $79 One-Time | Neo Club |
|---|---|---|---|
| Visibility score + grade | ✅ | ✅ | ✅ |
| Per-pillar 1-liner | ✅ | ✅ | ✅ |
| Section findings | — | ✅ | ✅ |
| Fixes with copy-paste | — | ✅ | ✅ |
| AI-generated business-specific fixes | — | ✅ | ✅ |
| Generated llms.txt + schema | — | ✅ | ✅ |
| Multi-LLM citation matrix | partial (1 engine) | ✅ all 4 | ✅ all 4 |
| Geo-grid rank tracking | — | snapshot | weekly refresh |
| Schema gap vs competitors | — | ✅ | ✅ |
| Per-fix dollar lift | — | ✅ | ✅ |
| Weekly delta tracker | — | — | ✅ |
| Outreach email drafter | — | — | ✅ (member only) |
| Competitor snapshots | — | snapshot | weekly refresh |

---

## 8. Order of Operations

Recommended execution order (parallelizable across sessions):

1. **Phase 1.1** — Admin Mission Control redesign (3-4h) — biggest visual impact, gets Dave a polished console immediately
2. **Phase 2.1** — Schema analyzer + E-E-A-T analyzer + GEO analyzer (3-4h) — most valuable depth additions
3. **Phase 1.2** — Customer audit results page redesign (3-4h) — biggest customer-facing impact
4. **Phase 2.2** — Image auditor + sitemap validator + hreflang + NAP checker (2-3h) — completes parity
5. **Phase 3 bundle 1** — Differentiators #1, #4, #6 (multi-LLM matrix, AI-generated fixes, generated schema) (3-4h)
6. **Phase 3 bundle 2** — Differentiators #2, #3, #7 (geo-grid, schema gap, dollar lift) (3-4h)
7. **Phase 3 bundle 3** — Differentiators #5, #8, #9, #10 (llms.txt, weekly delta, outreach drafter, competitor snapshots) (3-4h)
8. **Phase 1.3** — Pricing + member dashboard redesign + `/admin/about` page (2-3h)

Total estimate: 22-30 hours of focused work. Realistic to ship in 3-5 sessions over a few days.

---

## 9. Tests & Validation

Each new sub-analyzer ships with unit tests covering:
- Happy path (real URL, returns valid structure)
- Empty/missing data path (graceful degradation)
- Timeout path (returns partial result with `status: 'timeout'`)
- Tier filtering (Free vs Gold vs Admin output shape)

Integration test: full `runDeepAudit` against a known URL (e.g. `branson.com`) returns all sections with non-error status.

UI smoke test: Mission Control loads, every panel renders, navigation works.

---

## 10. Risks & Trade-offs

- **API costs**: multi-LLM citation matrix is the **only** runtime LLM usage — and it's *measurement* (asking each engine "who's the best plumber in Branson?" and recording whether the audited business shows up), not generation. Cache results 24h per (industry, city, query) tuple. Disable for free tier. **No LLM is ever used to generate fix copy or audit text — all output is deterministic logic + real page data + competitor evidence.**
- **Ahrefs API cost**: keep behind explicit toggle (already done in current Prospect Hunter)
- **Audit time**: deep audit may take 30-90s. Front-end shows progressive loading (each section streams in as it completes via SSE or polling).
- **Schema generation accuracy**: generated schema is built deterministically from real page-extracted data (business name, address, hours, services, phone, geo) merged with required Schema.org fields per type — then validated against schema.org JSON-LD spec before exposing. No LLM in the loop.
- **UI redesign breaks existing tests**: keep test selectors stable, only change CSS / structure.

---

## 11. Core Product Principle (added per Dave's feedback 2026-05-10)

**No runtime AI generation in customer-facing output.** All fix copy, schema generation, llms.txt content, and outreach drafts are produced by deterministic logic operating on real extracted data — page content, competitor signals, audit findings, industry CPL benchmarks. The only runtime LLM usage is **measurement** (multi-LLM citation matrix testing whether AI engines recommend the audited business), never generation.

This means:
- Fix templates are hand-written, not AI-generated, and fill with real page data
- Schema JSON-LD is built from extracted business facts + Schema.org spec, not LLM completion
- Outreach emails are templated with real audit numbers, not LLM-written
- Competitor-informed suggestions cite real competitor URLs as evidence, not hallucinated examples

The audit must hold up to "show me the rule" inspection by an SEO-savvy customer.

---

## 12. Open Questions for Dave

1. Want me to also redesign the customer audit form pages (`industry-audit.html`, `website-audit.html`, `both-audit.html`) or keep those for a later round?
2. Pricing page redesign — keep the $79 one-time + $99/$199/$399 Neo Club tiers exactly, or open to restructuring?
3. Customer-facing color palette — happy with slate + electric cyan + orange CTA? Or do you have a brand palette?
4. The `/admin/about` page (public differentiators) — public URL or behind auth?

---

_End of design doc. Awaiting Dave's review + sign-off before execution._
