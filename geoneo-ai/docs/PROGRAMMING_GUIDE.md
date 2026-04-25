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

Run tests:

```bash
cd /home/matt/geoneo-ai
node --test test/server.test.js
```

## Deployment/Runtime Notes

- Default app URL: `http://localhost:4173`
- Internal leads page: `http://localhost:4173/admin/leads`
- Required env for Google snapshot:
  - `PAGESPEED_API_KEY`
