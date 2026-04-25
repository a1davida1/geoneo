# Architecture Overview

## Stack

- Frontend: plain HTML/CSS/JS
- Backend: Node.js HTTP server (`server.js`)
- Storage: JSON file (`data/audits.json`)

## Major Runtime Paths

1. `GET /api/audit`
- Validates request
- Runs site audit
- Computes scores + findings
- Filters output by package
- Saves lead + full audit record
- Returns package-scoped response

2. `GET /api/audit-report`
- Returns inline HTML report for an audit id

3. `GET /api/audit-report/download`
- Returns downloadable HTML report

4. `GET /admin/leads`
- Local-only internal lead dashboard
- Lists saved records with key sales fields

## Data Model Layers

1. Full internal audit result (`fullAuditResult`)
2. Customer-filtered result (`customerResult`)
3. Lead/business metadata for follow-up
4. Upgrade-credit metadata for package progression

## Security/Access (Current)

- Internal leads view is local-only guard.
- No full auth system in MVP.

## Extensibility

Saved record shape is designed for future:
- Email delivery
- Webhook dispatch
- CRM sync
