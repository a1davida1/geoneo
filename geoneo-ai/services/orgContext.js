/**
 * Multi-tenant scaffold. Records get an `orgId` field so multiple
 * workspaces can share the same backend. Until real customers need
 * isolation, every record gets `orgId: 'default'`.
 *
 * Resolution order on a request:
 *   1. `X-Geoneo-Org` header
 *   2. `?org=<id>` query param
 *   3. `geoneo_org` cookie
 *   4. process.env.GEONEO_DEFAULT_ORG
 *   5. literal 'default'
 *
 * Org IDs are validated against ORG_ID_PATTERN — only lowercase
 * alphanumerics + hyphens, 1-40 chars. Invalid IDs fall through to default.
 *
 * NOT a permission boundary on its own. To make org enforcement real:
 *   - Pair this with admin auth (which already exists via authorizeInternalApi)
 *   - Filter every storage read by orgId BEFORE returning to caller
 *   - Pass orgId on every storage write so backwards-compat reads still work
 *
 * The module is intentionally tiny: it's a seam, not a migration. Storage
 * layers (auditArchive, scheduler, leadPipeline) accept an orgId arg and
 * default to 'default' so existing data doesn't break.
 */

const DEFAULT_ORG_ID = process.env.GEONEO_DEFAULT_ORG || 'default';
const ORG_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

function isValidOrgId(id) {
  return typeof id === 'string' && ORG_ID_PATTERN.test(id);
}

function normalizeOrgId(id) {
  if (!id) return DEFAULT_ORG_ID;
  const v = String(id).trim().toLowerCase();
  return isValidOrgId(v) ? v : DEFAULT_ORG_ID;
}

/**
 * Pull the org ID for an http.IncomingMessage. Order: header > query >
 * cookie > env default. Always returns a valid ID (falls back to default).
 */
function resolveOrgFromRequest(req) {
  if (!req) return DEFAULT_ORG_ID;
  // 1. Header
  const headerVal = req.headers && (req.headers['x-geoneo-org'] || req.headers['X-Geoneo-Org']);
  if (headerVal && isValidOrgId(String(headerVal).toLowerCase())) {
    return String(headerVal).toLowerCase();
  }
  // 2. Query (try parsing once)
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const q = u.searchParams.get('org');
    if (q && isValidOrgId(q.toLowerCase())) return q.toLowerCase();
  } catch {}
  // 3. Cookie
  const cookie = req.headers && req.headers.cookie;
  if (cookie) {
    const match = String(cookie).match(/(?:^|;\s*)geoneo_org=([^;]+)/);
    if (match) {
      const v = decodeURIComponent(match[1]).toLowerCase();
      if (isValidOrgId(v)) return v;
    }
  }
  return DEFAULT_ORG_ID;
}

/**
 * Build a per-org subdirectory path (e.g. data/orgs/<id>/<slug>). Use this
 * when storage code wants per-org isolation. Today most storage uses
 * per-record orgId fields instead (so a single global file/dir works
 * with row-level filtering); this helper is for callers that want
 * physical isolation later.
 */
function orgDataPath(orgId, ...parts) {
  const safe = normalizeOrgId(orgId);
  if (safe === 'default') {
    // For the default org, write to legacy data/ paths so existing
    // records remain in place. Only non-default orgs go under data/orgs/<id>/.
    return parts.join('/');
  }
  return `orgs/${safe}/${parts.join('/')}`;
}

/**
 * Test that an orgId on a record matches the requesting org. If the
 * record predates multi-tenancy (no orgId), treat it as the default org.
 */
function recordBelongsTo(record, requestingOrgId) {
  const recordOrg = (record && record.orgId) || DEFAULT_ORG_ID;
  const requesting = normalizeOrgId(requestingOrgId);
  return recordOrg === requesting;
}

module.exports = {
  DEFAULT_ORG_ID,
  isValidOrgId,
  normalizeOrgId,
  resolveOrgFromRequest,
  orgDataPath,
  recordBelongsTo
};
