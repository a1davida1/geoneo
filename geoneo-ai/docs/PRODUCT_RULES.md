# Product Rules

## Intake Fields

Audit intake supports:
- `contactName`
- `businessName`
- `businessEmail`
- `phone`
- `industry`
- `streetAddress`
- `city`
- `state`
- `market` (main markets)
- `competitors` (1-3, free text/textarea)
- `bestContactTime` (optional)
- `followupConsent` (checkbox)
- `url` (website)
- `package`

## Package Visibility Rules

### Free (Basic)
Show:
- Real World Search visibility summary (outcome)
- Limited technical summary (underlying causes)

Hide:
- Full rankings table
- Deep issue breakdown and strategy plan

### Silver
Show:
- Everything in Basic
- Rankings + competitor visibility detail
- Full issue list
- Categorized issue output (SEO, technical, trust, etc.)
- Recommendation

Hide:
- Gold-only implementation roadmap and strategy plan

### Gold
Show everything in Silver, plus:
- Screenshots in the real-world rankings section
- Full diagnosis
- Issue-by-issue solutions
- Step-by-step implementation roadmap
- Prioritized action plan

### Admin/Internal
Always keep full data available for internal use.

## Upgrade Credit Rules

- Silver payment amount can be credited toward Gold.
- Gold payment amount can be credited toward Platinum.
- Persist in record as:
  - `purchasedPackage`
  - `amountPaid`
  - `upgradeCreditAvailable`

## Lead Persistence Rules

Each saved record should include:
- Lead intake fields
- `auditId`, `createdAt`
- `scores`
- `recommendation`
- `reportLink`
- `fullAuditResult` (internal)
- Follow-up fields (`followupConsent`, `followupStatus`)
