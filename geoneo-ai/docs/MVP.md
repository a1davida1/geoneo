# MVP Definition

## MVP Scope (Current)

1. Public website with audit intake form.
2. Live audit endpoint that scores website quality and visibility signals.
3. Package-tier output filtering (`free`, `silver`, `gold`, `admin`).
4. Lead capture and record persistence.
5. Internal local-only lead listing page (`/admin/leads`).
6. Downloadable audit report link per saved audit.

## Core User Journey

1. User submits website + business lead details.
2. System runs audit and computes scores/findings.
3. Response is filtered by selected package tier.
4. User sees package-appropriate output and upgrade CTA.
5. Lead and full internal audit data are saved for follow-up.

## MVP Non-Goals

- Full CRM integration
- Guaranteed deliverability for weekly score email (optional Resend integration; outbox file fallback)
- Multi-user authentication system
- External analytics/data warehouse integration

## Post-MVP Member Surfaces (Shipped in Repo)

- Member dashboard: weekly brief, AI citation summary, technical deep pass, fix tracker, score history
- Competitor intelligence API + page (audit-backed scores, tracked history)
- Weekly scheduler + optional `RESEND_API_KEY` weekly report hook

## MVP Quality Bar

- Audit endpoint returns stable JSON.
- Tier filtering is deterministic and test-covered.
- Lead records include enough data for internal outreach.
- Internal leads page is readable and usable for manual triage.
