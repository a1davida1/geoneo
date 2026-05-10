# Programming Guide

## Backend Guidelines

1. Keep scoring/audit engine logic separate from package filtering.
2. Add new helper functions for behavior that needs testing.
3. Preserve backward-safe defaults for optional fields.
4. Keep all persistence writes atomic (`tmp` then rename pattern).

## Frontend Guidelines

1. Keep form submission logic in one flow (`runLiveAudit`).
2. Do not duplicate package gating logic in multiple places.
3. Show clear, business-facing summaries and upgrade CTAs.
4. Avoid exposing internal-only detail in Free output.

## Testing Guidelines

Maintain coverage for:
- package-level filtering
- quick-win counting
- estimated short-term lift
- lead record shape
- upgrade credit fields

`GET /api/audit` with default `package=free` requires `contactName`, `businessName`, and `businessEmail` plus a website or industry/location, or the handler returns **400**. Integration tests that only exercise market SERP fallback (Google/DuckDuckGo/Bing) should pass a non-free `package` value (for example `package=gold`) so the scenario under test is lead validation, not SERP parsing.

For `runAudit`, local search visibility issues additional Google queries after competitor discovery; tests that assert on Google SERP URLs should collect all `google.com/search` requests (or filter by query) instead of overwriting a single capture.

Run tests:

```bash
cd geoneo-ai
npm test
```

## Deployment/Runtime Notes

- Default app URL: `http://localhost:4173`
- Internal admin shell: `http://localhost:4173/admin/` (redirects from `/admin`). Requires the same internal API access as `/admin/leads`. Aggregated JSON: `GET /api/admin/summary` (internal auth).
- Internal leads page: `http://localhost:4173/admin/leads`
- Required env for Google snapshot:
  - `PAGESPEED_API_KEY`
- Weekly visibility score scheduler runs every Monday at 03:00 in the server process timezone. For production consistency set `TZ=America/Chicago` (or equivalent) so the 03:00 slot aligns with Ozarks time. The scheduler starts automatically on `npm start`.
- Optional weekly score email: set `RESEND_API_KEY` and `RESEND_FROM` (e.g. `GeoNeo <reports@yourdomain.com>`). Without a key, outbound messages are written to `data/email-outbox.json` via the outbox helper (idempotency keys, `state`, `attempts`, `lastError`, `providerMessageId` when sent).

### Internal API authentication

- **`GEONEO_INTERNAL_API_SECRET`**: When set, non-loopback clients may call protected routes with header `Authorization: Bearer <same value>`. If unset, only loopback clients (127.0.0.1 / ::1 / empty remote) may access those routes.
- Loopback is always trusted; configure the secret for remote dashboards, CI, or workers.

### Member eligibility (latest audit row)

These member routes require **both** internal API access (above) **and** `isEligibleForWeeklyScore(latestAudit)` on the newest `audits.json` row for the requested domain:

- `GET /api/score`, `/api/score/history`, `/api/member/brief`, `/api/member/technical`, `/api/competitors/dashboard`, `/api/fix-tracker` (GET and POST).

Eligible records: `productType === 'membership'`, or gold/admin with `amountPaid >= 99`, or one-time with `amountPaid >= 197` within 30 days of `createdAt`. Others receive **403** with `{ error: 'membership_required' }`.

`GET /api/score/health` stays unauthenticated for lightweight ops checks.

### Data overrides (tests / multi-tenant)

- `GEONEO_AUDITS_PATH` — alternate `audits.json` path (see `services/auditLookup.js`).
- `GEONEO_COMPETITORS_PATH` — alternate competitor tracking file.
- `GEONEO_FIX_TRACKER_PATH` — alternate fix tracker JSON.
- `GEONEO_EMAIL_OUTBOX_PATH` — alternate email outbox file.

### Fix tracker validation

POST bodies are validated: `status` must be one of `not_started`, `in_progress`, `done`, `blocked`, `cancelled`; title/notes length limits; max **250** open items per domain; writes retry on contention (`fix_tracker_write_conflict` if exhausted).

### Competitor intelligence

Competitor cards use `scoreSource: 'audit' | 'pending'`. There are **no** seeded numeric estimates. Pending rows omit scores until a GeoNeo audit exists for that competitor domain. Movement/trend uses history entries with `source: 'audit'` only (legacy rows without `source` are still counted).

## Member / club HTTP API

Protected routes use **`authorizeInternalApi`** (loopback **or** bearer secret). Member payloads additionally require **eligible** latest audit per domain.

Admin and pipeline routes use the same internal API auth as below.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/score?domain=&persist=0|1` | Visibility score; use `persist=0` for dashboard views, `1` to append history |
| GET | `/api/score/history?domain=` | Score history rows |
| GET | `/api/score/run-weekly?dryRun=1` | Manual weekly job (internal auth) |
| GET | `/api/score/health` | Last scheduler run summary (no auth) |
| GET | `/api/member/brief?domain=` | Three weekly actions + AI citation brief |
| GET | `/api/member/technical?domain=` | Deeper technical SEO summary from last audit |
| GET | `/api/competitors/dashboard?domain=` | Competitor cards + movement (audit-backed scores only) |
| GET / POST | `/api/fix-tracker` | GET list; POST JSON `{ domain, title, status, scoreBefore, scoreAfter, notes?, source? }` or `{ action:'delete', id }` |
| GET | `/admin/` | Operator shell (overview, embedded leads, weekly dry/live run, API probes) |
| GET | `/api/admin/summary` | JSON snapshot: audit counts, pipeline, outbox, weekly eligibility, file paths |
| GET | `/admin/leads` | Leads / pipeline HTML (also embedded from `/admin/`) |
| POST | `/api/pipeline/:domain` | Pipeline stage update |
