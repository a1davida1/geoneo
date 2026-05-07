# GeoNeo AI - CEO Technical Brief (AI-Ready)

> **Positioning source of truth:** see [`POSITIONING.md`](./POSITIONING.md).
> This brief covers implementation. `POSITIONING.md` covers who we serve
> and what we promise. If this doc disagrees with `POSITIONING.md`,
> `POSITIONING.md` wins and this doc needs to be updated.

## 1) What This Company Product Is

GeoNeo AI is the AI-search visibility tool for Ozarks-area home-service
contractors (plumbing, HVAC, roofing, electrical, pest control, tree
service, garage door, restoration). It evaluates each business across:

- SEO (traditional Google search performance)
- GEO (local/geographic relevance: Google Maps, map pack, local directories)
- AI-search visibility (citation/recommendation readiness in ChatGPT,
  Perplexity, Google AI Overviews, Gemini)

The platform is designed to:
1. Capture qualified contractor leads via a free instant scan.
2. Deliver immediate, owner-readable audit output (not a marketer's dashboard).
3. Convert free-scan users into Starter ($99/mo) and upgrade them to
   Growth ($249) / Multi-market ($499) as they expand.
4. Support internal follow-up with saved records and a local leads dashboard.

## 2) Current Product Behavior (Live Model)

### Audit Flow
1. User submits intake form + website URL.
2. Backend runs audit checks and scoring.
3. Backend filters output by package tier.
4. Full internal record is saved regardless of customer-visible tier.
5. User receives filtered response and report reference.

### Tier Visibility
- `free`: currently restricted output (only total score / `overall` exposed).
- `silver`: adds issue list + trust/design + visibility + competitor snapshot + recommendation.
- `gold`: adds diagnosis + per-issue solutions + roadmap + prioritized action plan.
- `admin`: full output.

### Free Intake Rule (Current)
For Free, required fields are:
- `contactName`
- `businessName`
- `businessEmail`
- `industry`
- `market` (main markets)
- `url`

## 3) System Architecture

### Stack
- Frontend: plain `index.html`, `styles.css`, `script.js`
- Backend: single Node HTTP server (`server.js`)
- Persistence: JSON file (`data/audits.json`)
- Tests: Node test runner (`test/server.test.js`)

### Key Endpoints
- `GET /api/audit`
- `GET /api/audit-report?id=<auditId>`
- `GET /api/audit-report/download?id=<auditId>`
- `GET /admin/leads` (local-only internal view)

### Local URLs
- App: `http://localhost:4173/`
- Leads view: `http://localhost:4173/admin/leads`

## 4) What Gets Saved Per Lead/Audit

Each record stores both business lead data and audit outputs.

### Lead/Business Fields
- `contactName`
- `businessName`
- `businessEmail`
- `phone`
- `industry`
- `streetAddress`
- `city`
- `state`
- `market`
- `competitorsInput` (user-entered top competitors)
- `bestContactTime`
- `followupConsent`
- `followupStatus`

### Audit Metadata
- `auditId` / `id`
- `createdAt`
- `website`, `finalUrl`
- `scores`
- `recommendation`
- `reportLink`, `reportDownloadLink`

### Commercial/Tier Fields
- `purchasedPackage`
- `amountPaid`
- `upgradeCreditAvailable`

### Result Layers
- `customerResult` (tier-filtered)
- `fullAuditResult` (internal full diagnostic)

## 5) Revenue/Upgrade Logic

Upgrade credit model is implemented in data:
- Silver payment credits toward Gold.
- Gold payment credits toward Platinum.

Stored as `upgradeCreditAvailable` so sales ops can apply credits during conversion.

## 6) Internal Operations View

`/admin/leads` renders a local-only HTML table including:
- date
- business/contact/email/phone/industry/location
- website
- overall score
- recommended package
- audit ID
- report link

Purpose: manual triage and follow-up prioritization without external CRM dependency.

## 7) AI and Delivery Readiness

The record schema is prepared for future automation:
- outbound email summaries
- webhook dispatch to CRM
- pipeline stage updates

No full sending engine is hard-wired yet (by design).

## 8) Reliability + Operational Notes

- Google snapshot metrics can occasionally timeout; core audit still returns.
- PageSpeed timeout has been increased (20s) to reduce transient failures.
- Frontend caching can mask changes; hard refresh (`Ctrl+Shift+R`) after deployments.

## 9) Immediate CEO-Level Priorities

1. Land first 5 paying Starter customers ($99/mo) in SW Missouri by end of
   Month 1 (see `POSITIONING.md` success indicators).
2. Define follow-up SLA by tier (response time + owner).
3. Set conversion KPIs:
   - Free → Starter ($99)
   - Starter → Growth ($249)
   - Growth → Multi-market ($499)
   - Lead → closed revenue
4. Choose first integration target (CRM or webhook receiver).
5. Ship industry-specific landing pages under `/ozarks/<industry>.html`
   (done) and drive first targeted traffic to them.

## 10) AI Context Pack (Copy/Paste)

Use this block when briefing an AI assistant:

```yaml
project: GeoNeo AI
purpose: AI-search visibility audit for Ozarks home-service contractors
positioning_doc: docs/POSITIONING.md
target_verticals:
  - plumbing
  - hvac
  - roofing
  - electrical
  - pest_control
  - tree_service
  - garage_door
  - restoration
target_geography_year1:
  - Springfield, MO
  - Branson, MO
  - Ozark, MO
  - Nixa, MO
  - Joplin, MO
  - Fayetteville, AR
  - Rogers, AR
  - Bentonville, AR
  - Little Rock, AR
stack:
  frontend: html/css/js
  backend: node_http_server
  storage: json_file_data_audits
key_endpoints:
  - GET /api/audit
  - GET /api/audit-report?id=<auditId>
  - GET /api/audit-report/download?id=<auditId>
  - GET /admin/leads
package_tiers:
  free:
    output: overall_score_only
    required_fields:
      - contactName
      - businessName
      - businessEmail
      - industry
      - market
      - url
  silver:
    output:
      - free_level
      - issue_list
      - trust_design
      - visibility
      - competitor_snapshot
      - recommendation
  gold:
    output:
      - silver_level
      - full_diagnosis
      - issue_solutions
      - implementation_roadmap
      - prioritized_action_plan
  admin:
    output: full_internal
saved_record_core_fields:
  - auditId
  - createdAt
  - contactName
  - businessName
  - businessEmail
  - phone
  - industry
  - streetAddress
  - city
  - state
  - market
  - competitorsInput
  - followupConsent
  - followupStatus
  - purchasedPackage
  - amountPaid
  - upgradeCreditAvailable
  - scores
  - recommendation
  - reportLink
  - customerResult
  - fullAuditResult
commercial_logic:
  silver_credit_toward: gold
  gold_credit_toward: platinum
internal_ops:
  leads_view: /admin/leads
  access: local_only
```
