# Site Goals

> **Positioning source of truth:** see [`POSITIONING.md`](./POSITIONING.md).
> That doc defines who we serve, what we promise, and why we can win. This
> doc only lists measurable goals that flow from that positioning.

## Product Mission

GeoNeo AI is the AI-search visibility tool for Ozarks-area home-service
contractors. We tell owners, in plain English, where they rank on Google,
Google Maps, and AI assistants (ChatGPT, Perplexity, Google AI Overviews,
Gemini), who is beating them, and the 3 fixes to make this week.

See `POSITIONING.md` for the full target-vertical list and geography.

## Primary Business Goals

1. Convert free-scan visitors into Starter-tier paying customers ($99/mo).
2. Deliver a scannable, owner-readable audit that produces a "do this week"
   action list rather than a dashboard.
3. Guide Starter customers to Growth ($249) or Multi-market ($499) tiers
   as their service area grows.
4. Capture enough intake data on every lead that manual sales follow-up
   takes less than 2 minutes per lead.
5. Give internal staff a simple local leads dashboard (`/admin/leads`)
   for triage — no external CRM dependency at MVP.

## User Value Goals

1. Fast visibility score in under 60 seconds from homepage entry.
2. Clear risk/opportunity framing: what's wrong, who's beating you, what it
   costs you.
3. Practical "this week" next-step list based on purchased package.
4. Trust: owner-readable language, no jargon, show your work (what we checked
   and what we found).

## Operational Goals

1. Save complete audit + lead records for every submission, even free-tier.
2. Keep full internal audit data available regardless of customer tier.
3. Preserve compatibility for future email/webhook delivery workflows.
4. Every generated audit must be reproducible from the stored record so
   sales conversations can reference exact findings weeks later.

## Success Indicators

Revenue-tied (from `POSITIONING.md`):
- Month 1: 5 paying Starter customers in SW Missouri.
- Month 3: 20 customers, ~$3K MRR, one case study per Year-1 vertical.
- Month 6: 50 customers, ~$8K MRR, NW Arkansas opened.
- Month 12: 100 customers, $15-20K MRR, first Starter → Growth upsells.

Funnel metrics:
- Free-scan completion rate (target ≥ 70%).
- Free → Starter conversion rate (target ≥ 4% trailing 30 days).
- Starter → Growth upgrade rate (target ≥ 15% within 6 months).
- Lead → customer close rate on follow-up contact (target ≥ 20%).

Product-quality metrics:
- Audit-returns-valid-JSON rate (target ≥ 99%).
- Tier-filtering correctness (100%, test-covered).
- Local ranking data coverage (target ≥ 90% of scans have usable SERP data).
