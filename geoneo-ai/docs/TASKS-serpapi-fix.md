# TASKS — SerpAPI Market Search Fix

## Status: READY FOR CODEX

## Summary

SerpAPI IS WORKING. Env loads correctly, provider resolves to SerpApiProvider,
live queries return 9 organic + 3 local pack results per query.
Pipeline produces 20 competitors. Source shows "SerpAPI" with high confidence.

Two remaining bugs cause bad output:

## Bug 1: Directories ranked as competitors

upsertMarketCompetitor() in server.js only rejects results where
evaluation.junk === true. But evaluateMarketResult() returns
isDirectory: true / resultType: 'review' for Yelp, MapQuest, BBB
without setting junk: true. So directory sites pass through and
get ranked as #1 competitors.

## Bug 2: All competitors score 95/95

Strength scoring formula produces near-identical scores because
SerpAPI returns high appearance counts across 8 queries. Formula
hits 95 cap for every business that appears in most queries.

---

## Task 1 — Fix directory leak in upsertMarketCompetitor

File: server.js
Function: upsertMarketCompetitor() (around line 1717)

Current code around line 1740:

    if (evaluation.isDirectory || evaluation.isReviewSite) {
        directorySignals.push({ ... });
    }
    if (evaluation.junk) {
        return { accepted: false, reason: 'junk' };
    }
    // BUG: directories continue past here into competitorMap

Fix: Add early return for directories:

    if (evaluation.isDirectory || evaluation.isReviewSite) {
        directorySignals.push({ ... });
        return { accepted: false, reason: 'directory' };
    }
    if (evaluation.junk) {
        return { accepted: false, reason: 'junk' };
    }

After fix: yelp.com, mapquest.com, bbb.org, yellowpages.com,
angi.com, thumbtack.com appear in directorySignals but NOT in
competitors or orderedResults.

---

## Task 2 — Improve strength score differentiation

File: server.js
Function: Inside runMarketOnlyAudit(), search for:
    const strengthScore = clampScore

Current formula:

    const strengthScore = clampScore(
      Math.round(
        (Number(item.searchAppearances || 0) * 16) +
        (Number(item.mapPackAppearances || 0) * 12) +
        (Number(item.authorityIndicator || 0) * 4) +
        (Number(item.contentSignal || 0) * 3) -
        avgPosition
      ), 20, 95
    );

Problem: With 8 queries, appearing in all 8 = 8*16=128 from
appearances alone, instantly hitting 95 cap. Everyone scores 95.

Fix:

    const strengthScore = clampScore(
      Math.round(
        (Number(item.searchAppearances || 0) * 6) +
        (Number(item.mapPackAppearances || 0) * 8) +
        (Number(item.authorityIndicator || 0) * 4) +
        (Number(item.contentSignal || 0) * 3) +
        (Number.isFinite(Number(item.rating)) ? Number(item.rating) * 4 : 0) +
        (Number.isFinite(Number(item.reviews)) ? Math.min(15, Math.round(Math.log10(Number(item.reviews) + 1) * 6)) : 0) -
        (avgPosition * 2)
      ), 20, 95
    );

---

## Task 3 — Verify

Restart server, hit:
http://localhost:4173/api/audit?queryType=market&industry=towing&city=Branson&state=MO&zip=65616

Must show:
- sourceNote contains "SerpAPI" not "Google fallback"
- sourceConfidence: "high"
- competitors array has real towing businesses not yelp/mapquest/bbb
- scores are varied not all 95

## Files to modify: server.js only
## Do NOT modify: serpProvider.js, localSearchVisibility.js, script.js, index.html, URL audit code
