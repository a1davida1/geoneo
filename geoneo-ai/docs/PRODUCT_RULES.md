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

## Product Model (Two Commercial Paths)

GeoNeo offers two distinct paid products:

1. **One-Time Full Fix Plan** ($79 one-time)
   - Unlocks the complete prioritized "three fixes this week" implementation guide.
   - Full Gold-level depth: diagnosis, solutions, roadmap, action plan.
   - No recurring obligation.

2. **Neo Club Membership** (recurring)
   - Starter ($99/mo), Growth ($199/mo), Multi-market ($399/mo).
   - Includes weekly strategy content, expert guides, and direct access to Matt.
   - One-time audit payment is credited in full toward membership.

Free scans always capture lead data and show visibility summary + high-level issues. The deep actionable fix path requires either the one-time purchase or membership.

## Package Visibility Rules (Legacy Tier Mapping)

The legacy `silver` / `gold` tiers map to the new products:
- Free → basic visibility summary only.
- One-time or Gold-equivalent → full implementation roadmap + prioritized actions.
- Admin/Internal → always full data.

### Free (Basic)
Show:
- Real World Search visibility summary (outcome)
- Limited technical summary (underlying causes)

Hide:
- Full rankings table
- Deep issue breakdown and strategy plan

### One-Time / Gold
Show everything in Free, plus:
- Full competitor intelligence (local + regional + national)
- Complete issue list with E-E-A-T and AI-citation analysis
- Exactly three prioritized "this week" fixes with time estimates and expected impact
- Step-by-step implementation roadmap
- Recommendation and upgrade path to Neo Club

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
