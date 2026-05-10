# Design: Continuous Visibility Scoring Engine – Weekly Automated Scheduler (node-cron)

**Date:** 2026-05-08  
**Author:** AI Assistant (with user approval on approach)  
**Status:** Proposed – awaiting user review of this spec  
**Related Upgrade:** #1 of 10 High-Impact Upgrades – Continuous Visibility Scoring Engine (Weekly automated scoring)

---

## 1. Problem Statement

GeoNeo currently has a working 8-pillar Visibility Scoring Engine (`services/visibilityScoring.js`) and history persistence (`services/scoreHistory.js`). Members can manually trigger a weekly score via the member dashboard.

The missing piece for a true “Continuous Visibility Scoring Engine” is **background automation**: the system must calculate and record fresh scores for eligible paid members every week without any human clicking a button.

This design delivers exactly that scheduler using `node-cron` inside the existing Node HTTP server process.

---

## 2. Goals & Success Criteria

**Primary Goal**  
Every Monday at 03:00 server time, eligible paid Neo Club / Visibility Club members automatically receive a new visibility score that is persisted and visible in their member dashboard history.

**Success Criteria (Definition of Done)**
- The cron job is scheduled on server startup and runs reliably while the process is alive.
- Only domains that meet the paid-member eligibility rule are scored.
- Each successful score is recorded via the existing `recordScore` function.
- A single domain failure never aborts the entire weekly run.
- Per-domain execution is bounded by a 30-second timeout.
- A machine-readable run log is appended to `data/weekly-score-runs.json` after every execution.
- A manual trigger endpoint exists for testing and ops (`/api/score/run-weekly`).
- A lightweight health endpoint reports the last run timestamp and basic stats.
- All existing tests continue to pass; new unit tests cover the scheduler module.
- The feature is fully documented in the code and this spec.

**Non-Goals (Explicitly Out of Scope for This Increment)**
- Sending email reports or notifications (that is upgrade #9).
- Any new UI components, dashboards, or onboarding flows.
- Adding `membershipStatus`, `membershipExpiresAt`, or any new audit record fields.
- External queue / worker infrastructure (Redis, BullMQ, etc.).
- Multi-server coordination or distributed locking.
- Real-time score updates or push notifications.
- Changing the existing scoring algorithm or pillar weights.

---

## 3. Architecture Overview

**New File**
- `services/weeklyScoreScheduler.js` — contains:
  - Cron schedule definition
  - `runWeeklyScoring()` main job function
  - Member enumeration logic
  - Per-domain scoring + persistence wrapper with timeout
  - Run logging

**Modified Files**
- `server.js` — import and initialize the scheduler exactly once on startup (idempotent guard).
- `package.json` — add dependency `"node-cron": "^3.0.3"`.

**New Data Artifact**
- `data/weekly-score-runs.json` — append-only array of run summary objects (created automatically on first successful run).

**Data Flow (Weekly Cycle)**
1. `node-cron` fires at the scheduled time.
2. `runWeeklyScoring()` loads recent audits from `data/audits.json`.
3. Filters to unique domains that pass the eligibility rules (Section 4).
4. For each eligible domain:
   - Check `getLatestScore(domain)` — skip if a score already exists within the last 6 days.
   - Fetch the latest audit record for that domain.
   - Run `calculateVisibilityScore(auditData)`.
   - Call `recordScore(domain, scoreResult)`.
   - Log per-domain outcome.
5. After all domains complete (or timeout), append a summary object to `weekly-score-runs.json`.
6. Emit console log with stats and duration.

**Error & Resilience Contract**
- Any uncaught exception in a single domain handler is caught, logged with domain + error, and the job continues.
- A hard per-domain timeout (30s) prevents one slow site from stalling the run.
- The entire job is wrapped in a try/catch so a catastrophic failure still allows the server to keep serving requests.

---

## 4. Member Eligibility Logic (No New Schema Fields)

A domain is **eligible** for automated weekly scoring if its **most recent** audit record satisfies **any** of the following (checked in order):

1. `productType === 'membership'`
2. `purchasedPackage` is `'gold'` or `'admin'` **AND** `amountPaid >= 99`
3. The record’s `createdAt` is within the last 30 days **AND** `amountPaid >= 197` (one-time Full Audit + Strategy Session grace period)

**Deduplication & Latest-Wins Rule**
- Load the most recent 500 audit records (or all if fewer).
- Group by normalized domain (lowercase, no protocol).
- For each domain, keep only the single most recent record.
- Apply the eligibility rules above to that record.

**Grace Period Rationale**
The 30-day grace after a one-time $197 purchase gives the customer time to convert to membership while still receiving value from the weekly score. After 30 days the grace expires unless they have an active membership flag.

**No New Fields Decision**
We deliberately do **not** introduce `membershipStatus` or `membershipExpiresAt` in this increment. Eligibility is derived purely from data already persisted in `audits.json`. This keeps the change minimal, reversible, and free of migration work.

---

## 5. Scheduling, Timezone & Idempotency

**Cron Expression**
- Default: `'0 3 * * 1'` (Monday 03:00)
- Configurable via `process.env.WEEKLY_SCORE_CRON` (falls back to the default).

**Timezone**
- The `node-cron` job inherits the Node process timezone.
- Production deployment guideline (documented in `docs/PROGRAMMING_GUIDE.md`): set `TZ=America/Chicago` (Ozarks / Central Time) at the OS level or via `process.env.TZ = 'America/Chicago'` early in `server.js`.
- The 03:00 slot is intentionally chosen so scores are ready before most owners open their dashboards.

**Idempotency Guard**
- Before scoring any domain, call `getLatestScore(domain)`.
- If a score record exists with `calculatedAt` within the previous 6 calendar days, skip the domain for this run.
- This prevents duplicate scoring on server restarts, manual triggers, or clock skew.

**Manual Trigger (Ops & Testing)**
- `GET /api/score/run-weekly?dryRun=1` — executes the job logic immediately but does **not** persist scores or write the run log (useful for dry-run validation).
- `GET /api/score/run-weekly` (no query param) — executes for real (local-only guard, same pattern as `/admin/leads`).

---

## 6. Run Logging & Observability

Every completed weekly execution appends exactly one object to `data/weekly-score-runs.json`:

```json
{
  "runId": "2026-05-11T08:00:00.000Z",
  "startedAt": "2026-05-11T08:00:00.123Z",
  "finishedAt": "2026-05-11T08:02:47.890Z",
  "cronExpression": "0 3 * * 1",
  "domainsConsidered": 47,
  "domainsScored": 42,
  "domainsSkipped": 5,
  "failures": [
    { "domain": "slowsite.example.com", "error": "scoring timeout after 30000ms" }
  ],
  "durationMs": 167890
}
```

**Health Endpoint**
- `GET /api/score/health` returns:
  ```json
  {
    "ok": true,
    "lastRun": "2026-05-11T08:02:47.890Z",
    "domainsInLastRun": 42,
    "failuresInLastRun": 0,
    "nextScheduledRun": "2026-05-18T08:00:00.000Z"
  }
  ```
- This endpoint is public (read-only) so status pages or uptime monitors can use it.

---

## 7. Error Handling & Resilience

**Per-Domain Isolation**
- Each domain is processed inside its own `try { ... } catch (e) { logFailure(domain, e); }`.
- A `Promise.race` with a 30-second timeout aborts any single domain that takes too long.

**Job-Level Safety**
- The entire `runWeeklyScoring` function is wrapped so an unexpected crash logs the error and exits the job cleanly; the HTTP server continues serving requests.
- If the job is already running when the cron fires again (rare clock skew), the second invocation is a no-op.

**Failure Modes & Mitigations**
- Slow or unresponsive website → 30s timeout + failure entry in run log.
- `audits.json` corrupted or missing → job logs error and exits; no partial scores written.
- `scores.json` write failure → job continues for remaining domains; the failed write is logged.
- Server process restarted mid-job → next Monday the job simply runs again (idempotency guard prevents duplicates).

---

## 8. Testing Strategy

**Unit Tests (new file `test/weeklyScoreScheduler.test.js`)**
- `runWeeklyScoring` correctly filters eligible domains using the three rules.
- Idempotency guard skips domains with recent scores.
- Per-domain timeout fires and records a failure entry.
- Run log object is written with correct shape and counts.

**Integration Tests (extend `test/server.test.js`)**
- `GET /api/score/run-weekly?dryRun=1` returns 200 and does not mutate data.
- `GET /api/score/health` returns last-run metadata after a manual trigger.
- Existing 71 tests still pass after adding the scheduler initialization.

**Manual Verification Steps**
1. `npm start`
2. Call `curl http://127.0.0.1:4173/api/score/run-weekly?dryRun=1`
3. Inspect `data/weekly-score-runs.json` (should be created or appended).
4. Check console for “Weekly scoring complete: X domains scored”.

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Long-running job blocks event loop | Medium | High | Per-domain 30s timeout + async/await everywhere |
| `audits.json` grows very large | Low | Medium | Load only last 500 records; paginate if needed later |
| Duplicate scores on restart | Low | Low | 6-day idempotency guard |
| Timezone drift in production | Low | Low | Explicit `TZ=America/Chicago` deployment note |
| Paid member definition changes later | Medium | Low | Eligibility logic is centralized in one function; easy to update |

---

## 10. Implementation Order (High-Level)

1. Add `node-cron` to `package.json` and run `npm install`.
2. Create `services/weeklyScoreScheduler.js`.
3. Add scheduler initialization (guarded) in `server.js`.
4. Add the two new API routes (`/api/score/run-weekly`, `/api/score/health`).
5. Create `data/weekly-score-runs.json` on first successful run (or pre-create empty array).
6. Write unit tests and run full test suite.
7. Update `docs/PROGRAMMING_GUIDE.md` with deployment timezone note.
8. Commit everything together with this spec.

---

## 11. Open Questions (None Remaining)

All design decisions have been reviewed and approved in the preceding conversation:
- Use `node-cron` (not external scheduler)
- Derive eligibility from existing audit fields only
- 03:00 Monday Central Time
- 30-day one-time grace + 6-day dedupe window
- Per-domain timeout + continue-on-failure

---

**End of Design Spec**

This document is the single source of truth for the implementation plan that will follow after user approval.