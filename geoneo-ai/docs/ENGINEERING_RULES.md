# Engineering Rules

## Scope Control

1. Keep edits scoped to requested behavior.
2. Do not modify unrelated scoring logic unless required.
3. Prefer additive changes with clear helper functions.

## Data Integrity

1. Never drop existing audit records during writes.
2. Keep full internal result preserved even when customer view is filtered.
3. Maintain deterministic package filtering.

## Product Consistency

1. UI copy must match actual package behavior.
2. Form required fields must match business rule requirements.
3. Upgrade messaging must align with credit model.

## Maintainability

1. Update tests with each behavior change.
2. Keep endpoint contract explicit and stable.
3. Keep docs aligned with implementation in same change.

## Operational Readiness

1. Records should be usable for manual follow-up immediately.
2. Keep schema ready for future email/webhook integration.
