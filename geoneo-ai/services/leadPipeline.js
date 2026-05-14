/**
 * Lead Pipeline — unified, queryable view of every prospect across the funnel.
 *
 * Joins data from four upstream stores into one Lead record per domain:
 *   1. auditArchive    — every audit ever run (with side-channel marks for
 *                        emailSent / qualifierCompleted / suppression)
 *   2. qualifier       — full qualifier responses (bucket, persona, answers)
 *   3. emailBlast jobs — sent recipients + skipped reasons
 *   4. lead-gen runs   — kept candidates from Prospect Hunter (notes, owner,
 *                        years-in-business, manual phone)
 *
 * Pipeline stage is tracked per-domain via the archive's per-domain JSON
 * file (under `pipeline.status` + `pipeline.notes[]`), so it survives every
 * other store change. Atomic writes via auditArchive's lock pattern.
 *
 * Stages (kanban columns):
 *   new        — created/discovered, not yet contacted
 *   contacted  — emailed at least once
 *   replied    — qualifier completed OR explicit manual reply mark
 *   booked     — call/meeting scheduled
 *   won        — paying customer
 *   lost       — passed / wrong fit / unresponsive after follow-ups
 *
 * Stage transitions are mostly automatic (email sent → contacted; qualifier
 * complete → replied), but the closer can override at any point. Every
 * change is appended to a stageHistory[] for audit.
 */

const fs = require('fs/promises');
const path = require('path');
const archive = require('./auditArchive');

const VALID_STAGES = ['new', 'contacted', 'replied', 'booked', 'won', 'lost'];

/**
 * Stage transition table — enforces sane forward flow. Rules:
 *   - new → contacted, lost  (not directly to booked/won — must be touched first)
 *   - contacted → replied, booked, won, lost  (skip-ahead allowed if AI closes)
 *   - replied → booked, won, lost
 *   - booked → won, lost, contacted (re-nurture if no-show)
 *   - won → lost (churned), contacted (re-engage post-cancel)
 *   - lost → contacted (re-engage), new (re-scan)
 *
 * Override allowed for admins via `force: true` — useful for data fixes or
 * exceptional flows (e.g. a customer who walked into the office and bought).
 */
const STAGE_TRANSITIONS = {
  new:        new Set(['contacted', 'lost', 'new']),
  contacted:  new Set(['replied', 'booked', 'won', 'lost', 'contacted']),
  replied:    new Set(['booked', 'won', 'lost', 'contacted', 'replied']),
  booked:     new Set(['won', 'lost', 'contacted', 'booked']),
  won:        new Set(['lost', 'contacted', 'won']),
  lost:       new Set(['contacted', 'new', 'lost'])
};

function isValidTransition(fromStage, toStage) {
  if (!fromStage) return true; // first stage assignment always allowed
  if (fromStage === toStage) return true; // idempotent
  const allowed = STAGE_TRANSITIONS[fromStage];
  return allowed ? allowed.has(toStage) : true;
}
const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'audit-archive');
const LEAD_GEN_RUNS_PATH = path.join(__dirname, '..', 'data', 'lead-gen-runs.json');
const QUALIFIER_PATH = path.join(__dirname, '..', 'data', 'qualifier-responses.json');

/* ============================ Loaders ============================ */

async function loadAllArchiveRecords() {
  let files;
  try {
    files = await fs.readdir(ARCHIVE_DIR);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const records = [];
  for (const f of files) {
    if (!f.endsWith('.json') || f.endsWith('.tmp')) continue;
    try {
      const raw = await fs.readFile(path.join(ARCHIVE_DIR, f), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.domain) records.push(parsed);
    } catch {
      // skip corrupt
    }
  }
  return records;
}

async function loadQualifierResponses() {
  try {
    const raw = await fs.readFile(QUALIFIER_PATH, 'utf8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return (parsed && parsed.responses) || {};
  } catch {
    return {};
  }
}

async function loadLeadGenKept() {
  // From the Prospect Hunter runs file, surface every candidate marked
  // `decision.keep === true` with their notes/owner/years/manual-phone so
  // those flags appear on the unified Lead.
  try {
    const raw = await fs.readFile(LEAD_GEN_RUNS_PATH, 'utf8');
    if (!raw.trim()) return new Map();
    const parsed = JSON.parse(raw);
    const runs = Array.isArray(parsed.runs) ? parsed.runs : (Array.isArray(parsed) ? parsed : []);
    const byDomain = new Map();
    for (const run of runs) {
      for (const c of (run.candidates || [])) {
        if (!c || !c.domain) continue;
        if (!c.decision || !c.decision.keep) continue;
        const existing = byDomain.get(c.domain) || { domain: c.domain, runs: [] };
        existing.businessName = existing.businessName || c.businessName;
        existing.industry = existing.industry || c.industry;
        existing.city = existing.city || c.city;
        existing.state = existing.state || c.state;
        existing.runs.push({
          runId: run.id,
          runCreatedAt: run.createdAt,
          decision: c.decision,
          source: c.source,
          sourceRank: c.sourceRank
        });
        byDomain.set(c.domain, existing);
      }
    }
    return byDomain;
  } catch {
    return new Map();
  }
}

/* ============================ Stage helpers ============================ */

function inferAutoStage(record, qualifierResponses) {
  // Stage inference rules (override-able by manual setStage):
  //   1. won/lost are sticky — set manually only
  //   2. if pipeline.status was set manually within the last 90 days, respect it
  //   3. else if any qualifier response on file → replied
  //   4. else if emailSentAt → contacted
  //   5. else → new
  const manual = record.pipeline && record.pipeline.status;
  const manualSetAt = record.pipeline && record.pipeline.statusSetAt;
  if (manual && (manual === 'won' || manual === 'lost')) return manual;
  if (manual && manualSetAt) {
    const days = (Date.now() - new Date(manualSetAt).getTime()) / (1000 * 60 * 60 * 24);
    if (days < 90) return manual;
  }
  // Qualifier-completed beats email-sent
  const hasQualifierByDomain = Boolean(record.qualifierCompletedAt);
  const hasQualifierByLookup = Object.values(qualifierResponses).some((r) => r.domain === record.domain);
  if (hasQualifierByDomain || hasQualifierByLookup) return 'replied';
  if (record.emailSentAt) return 'contacted';
  return 'new';
}

function pickEmail(record) {
  const latest = record.history && record.history[0];
  const emails = latest?.contactInfo?.emails || [];
  return emails[0] || null;
}

function pickPhone(record) {
  const latest = record.history && record.history[0];
  const phones = latest?.contactInfo?.phones || [];
  return phones[0] || null;
}

function findQualifierForDomain(qualifierResponses, domain) {
  return Object.values(qualifierResponses).find((r) => r.domain === domain) || null;
}

/**
 * Build one Lead view from a per-domain archive record + side data.
 * This is the canonical Lead shape consumed by the UI + endpoints.
 */
function buildLead(record, qualifierResponses, leadGenKeptMap) {
  const latest = record.history && record.history[0];
  const audit = latest && latest.audit;
  const qualifier = findQualifierForDomain(qualifierResponses, record.domain);
  const kept = leadGenKeptMap.get(record.domain);
  const stage = inferAutoStage(record, qualifierResponses);
  const businessName = latest?.sourceMeta?.businessName
    || kept?.businessName
    || record.domain;
  const lastEmail = record.lastEmail || (record.emailSentAt ? { at: record.emailSentAt } : null);
  // Daysince calculations for staleness display
  const daysSinceLastTouch = record.emailSentAt
    ? Math.floor((Date.now() - new Date(record.emailSentAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return {
    domain: record.domain,
    businessName,
    industry: latest?.industry || kept?.industry || null,
    city: latest?.city || kept?.city || null,
    state: latest?.state || kept?.state || null,
    stage,
    autoStageHint: stage,
    manualStage: record.pipeline && record.pipeline.status || null,
    audit: audit ? {
      overallScore: audit.overallScore,
      grade: audit.grade,
      status: audit.status,
      sectionScores: audit.sectionScores || null,
      dollarOpportunity: audit.dollarOpportunity || null,
      findingsCount: Array.isArray(audit.findings) ? audit.findings.length : 0,
      generatedAt: audit.generatedAt,
      prospectFit: audit.prospectFit || null,
      authority: audit.deepIntegrations?.ahrefs ? {
        domainRating: audit.deepIntegrations.ahrefs.domainRating ?? null,
        organicTraffic: audit.deepIntegrations.ahrefs.organicTraffic ?? null,
        organicKeywords: audit.deepIntegrations.ahrefs.organicKeywords ?? null,
        investingInAds: audit.deepIntegrations.ahrefs.investingInAds ?? null
      } : null
    } : null,
    qualifier: qualifier ? {
      bucket: qualifier.scoring?.bucket,
      persona: qualifier.scoring?.persona,
      recommendedTier: qualifier.scoring?.recommendedTier,
      priority: qualifier.scoring?.closerPriority,
      numericScore: qualifier.scoring?.numericScore,
      submittedAt: qualifier.firstSubmittedAt,
      answers: qualifier.answers,
      isFollowUp: Boolean(qualifier.isFollowUp)
    } : null,
    contactInfo: {
      primaryEmail: pickEmail(record),
      primaryPhone: pickPhone(record),
      allEmails: latest?.contactInfo?.emails || [],
      allPhones: latest?.contactInfo?.phones || []
    },
    seoOwner: latest?.seoProvider ? {
      classification: latest.seoProvider.classification,
      label: latest.seoProvider.label,
      confidence: latest.seoProvider.confidence
    } : null,
    ahrefs: latest?.audit?.ahrefs ? {
      domainRating: latest.audit.ahrefs.domainRating,
      refdomains: latest.audit.ahrefs.refdomains,
      organicKeywords: latest.audit.ahrefs.organicKeywords,
      organicTraffic: latest.audit.ahrefs.organicTraffic
    } : null,
    leadScore: latest?.leadScore ? {
      score: latest.leadScore.score,
      tier: latest.leadScore.tier,
      reasons: latest.leadScore.reasons || []
    } : null,
    advancedInsights: latest?.advancedInsights ? {
      estimatedOpportunity: latest.advancedInsights.estimatedOpportunity,
      estimatedSeoBudget: latest.advancedInsights.estimatedSeoBudget,
      ideas: latest.advancedInsights.ideas || []
    } : null,
    pipeline: record.pipeline || { status: null, notes: [], stageHistory: [], outcomes: [] },
    activity: {
      firstSeenAt: record.firstSeenAt,
      lastAuditedAt: record.lastAuditedAt,
      emailSentAt: record.emailSentAt,
      emailSentCount: record.emailSentCount || 0,
      qualifierCompletedAt: record.qualifierCompletedAt,
      lastEmailRecipient: lastEmail?.recipient || null,
      daysSinceLastTouch,
      keptInRunIds: kept ? kept.runs.map((r) => r.runId) : [],
      keptDecision: kept ? kept.runs[0].decision : null
    },
    suppressed: Boolean(record.suppressedReason),
    suppressedReason: record.suppressedReason || null,
    tags: Array.isArray(record.tags) ? record.tags : [],
    maintenanceCustomer: record.maintenanceCustomer === true,
    maintenanceStartedAt: record.maintenanceStartedAt || null,
    maintenanceEndedAt: record.maintenanceEndedAt || null,
    maintenancePlan: record.maintenancePlan || null,
    historyLength: Array.isArray(record.history) ? record.history.length : 0
  };
}

/* ============================ Public API ============================ */

/**
 * List leads with composable filters.
 *
 * Filters: stage, bucket, persona, state, industry, scoreMax, scoreMin,
 * hasEmail, hasPhone, hasQualified, search (matches domain/businessName),
 * suppressed (true/false), tier (recommendedTier).
 *
 * Returns also stage counts so the kanban can show per-column totals
 * regardless of the active filter.
 */
async function listLeads(filter = {}) {
  const [archiveRecords, qualifierResponses, leadGenKeptMap] = await Promise.all([
    loadAllArchiveRecords(),
    loadQualifierResponses(),
    loadLeadGenKept()
  ]);
  // Org-scoped filter (per-record orgId; treat missing as 'default' for backwards compat)
  const orgFilter = filter.orgId || null;
  const orgScoped = orgFilter
    ? archiveRecords.filter((r) => (r.orgId || 'default') === orgFilter)
    : archiveRecords;
  const allLeads = orgScoped.map((r) => buildLead(r, qualifierResponses, leadGenKeptMap));

  // Compute stage counts BEFORE filtering so the kanban tabs show the full
  // population, even when the user has filtered to one bucket.
  const stageCounts = VALID_STAGES.reduce((acc, s) => { acc[s] = 0; return acc; }, {});
  for (const l of allLeads) stageCounts[l.stage] = (stageCounts[l.stage] || 0) + 1;

  const norm = (s) => String(s || '').trim().toLowerCase();
  const search = norm(filter.search);
  const stateFilter = norm(filter.state);
  const industryFilter = norm(filter.industry);
  const bucketFilter = norm(filter.bucket);
  const personaFilter = norm(filter.persona);
  const stageFilter = norm(filter.stage);
  const tierFilter = norm(filter.tier);

  const filtered = allLeads.filter((l) => {
    if (stageFilter && l.stage !== stageFilter) return false;
    if (bucketFilter && l.qualifier?.bucket !== bucketFilter) return false;
    if (personaFilter && l.qualifier?.persona !== personaFilter) return false;
    if (tierFilter && l.qualifier?.recommendedTier !== tierFilter) return false;
    if (stateFilter && norm(l.state) !== stateFilter) return false;
    if (industryFilter && norm(l.industry) !== industryFilter) return false;
    if (filter.scoreMax != null && (l.audit?.overallScore == null || l.audit.overallScore > filter.scoreMax)) return false;
    if (filter.scoreMin != null && (l.audit?.overallScore == null || l.audit.overallScore < filter.scoreMin)) return false;
    if (filter.prospectFitMin != null && (l.audit?.prospectFit?.score == null || l.audit.prospectFit.score < filter.prospectFitMin)) return false;
    if (filter.prospectFitTier && l.audit?.prospectFit?.tier !== filter.prospectFitTier) return false;
    if (filter.maxDomainRating != null && l.audit?.authority?.domainRating != null && l.audit.authority.domainRating > filter.maxDomainRating) return false;
    if (filter.maxOrganicTraffic != null && l.audit?.authority?.organicTraffic != null && l.audit.authority.organicTraffic > filter.maxOrganicTraffic) return false;
    if (filter.investingInAds === true && !l.audit?.authority?.investingInAds) return false;
    if (filter.hasEmail === true && !l.contactInfo.primaryEmail) return false;
    if (filter.hasPhone === true && !l.contactInfo.primaryPhone) return false;
    if (filter.hasQualified === true && !l.qualifier) return false;
    if (filter.suppressed === false && l.suppressed) return false;
    if (filter.suppressed === true && !l.suppressed) return false;
    if (filter.tag) {
      const t = String(filter.tag).trim().toLowerCase();
      if (!t || !Array.isArray(l.tags) || !l.tags.includes(t)) return false;
    }
    if (search) {
      const blob = `${l.domain} ${l.businessName} ${l.city} ${l.state} ${l.industry}`.toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });

  // Sort: prospectFit DESC first (best targets at top), then HOT priority,
  // then worst audit score (most fixable issues), then most recent.
  const priorityRank = { p1: 4, p2: 3, p3: 2, p4: 1, suppress: 0 };
  const sortMode = filter.sortBy || 'prospect_fit';
  filtered.sort((a, b) => {
    if (sortMode === 'prospect_fit') {
      const af = a.audit?.prospectFit?.score ?? -1;
      const bf = b.audit?.prospectFit?.score ?? -1;
      if (af !== bf) return bf - af;
    }
    const ap = priorityRank[a.qualifier?.priority] || 0;
    const bp = priorityRank[b.qualifier?.priority] || 0;
    if (ap !== bp) return bp - ap;
    const as = a.audit?.overallScore ?? 999;
    const bs = b.audit?.overallScore ?? 999;
    if (as !== bs) return as - bs;
    return new Date(b.activity.lastAuditedAt || 0) - new Date(a.activity.lastAuditedAt || 0);
  });

  const limit = Math.max(1, Math.min(2000, Number(filter.limit) || 200));
  return {
    leads: filtered.slice(0, limit),
    totalMatched: filtered.length,
    totalLeads: allLeads.length,
    stageCounts,
    bucketCounts: countBy(allLeads, (l) => l.qualifier?.bucket),
    qualifiedToday: allLeads.filter((l) => l.qualifier?.submittedAt && isToday(l.qualifier.submittedAt)).length,
    repliedThisWeek: allLeads.filter((l) => l.qualifier?.submittedAt && isWithinDays(l.qualifier.submittedAt, 7)).length,
    emailedThisWeek: allLeads.filter((l) => l.activity.emailSentAt && isWithinDays(l.activity.emailSentAt, 7)).length,
    suppressedCount: allLeads.filter((l) => l.suppressed).length
  };
}

function countBy(arr, fn) {
  const out = {};
  for (const item of arr) {
    const k = fn(item);
    if (!k) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isWithinDays(iso, days) {
  if (!iso) return false;
  return (Date.now() - new Date(iso).getTime()) < days * 24 * 60 * 60 * 1000;
}

/**
 * Get one lead's full record (for the right-side detail drawer).
 * Returns the unified Lead shape PLUS the full archive history + full
 * qualifier response (with all answers) for deep inspection.
 */
async function getLead(domain) {
  const [record, qualifierResponses, leadGenKeptMap] = await Promise.all([
    archive.getDomainHistory(domain),
    loadQualifierResponses(),
    loadLeadGenKept()
  ]);
  if (!record) return null;
  const lead = buildLead(record, qualifierResponses, leadGenKeptMap);
  return {
    ...lead,
    fullHistory: record.history || [],
    fullQualifier: findQualifierForDomain(qualifierResponses, domain)
  };
}

/**
 * Manually set a lead's stage. Stamps stageSetAt + appends to stageHistory.
 * Persists to the archive's per-domain file via a private update — caller
 * doesn't need to know about the archive structure.
 */
async function setStage(domain, newStage, { setBy = 'admin', note = null, force = false } = {}) {
  if (!VALID_STAGES.includes(newStage)) throw new Error(`invalid stage: ${newStage}`);
  const recordPath = path.join(ARCHIVE_DIR, `${archive.domainHash(domain)}.json`);
  let record;
  try {
    record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('lead not found in archive');
    throw err;
  }
  record.pipeline = record.pipeline || { status: null, notes: [], stageHistory: [] };
  const previous = record.pipeline.status;
  // Enforce valid transitions unless force=true (admin override)
  if (!force && !isValidTransition(previous, newStage)) {
    const err = new Error(`invalid_transition: cannot move from "${previous}" to "${newStage}". Use force:true to override.`);
    err.code = 'INVALID_TRANSITION';
    err.fromStage = previous;
    err.toStage = newStage;
    throw err;
  }
  record.pipeline.status = newStage;
  record.pipeline.statusSetAt = new Date().toISOString();
  record.pipeline.statusSetBy = setBy;
  record.pipeline.stageHistory = record.pipeline.stageHistory || [];
  record.pipeline.stageHistory.push({
    at: record.pipeline.statusSetAt,
    fromStage: previous,
    toStage: newStage,
    setBy,
    note: note || null
  });
  // Cap history length so files don't grow unbounded
  if (record.pipeline.stageHistory.length > 50) {
    record.pipeline.stageHistory = record.pipeline.stageHistory.slice(-50);
  }
  // Atomic write
  const tmp = recordPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
  await fs.rename(tmp, recordPath);
  return record.pipeline;
}

/**
 * Closer outcome catalog. Each outcome maps to:
 *   - label: display text in UI
 *   - autoStage: optional stage transition this outcome implies
 *   - terminal: true if outcome ends the active funnel for this lead
 *
 * Outcomes are call dispositions a closer logs in real time. They sit
 * alongside notes + stageHistory; a single outcome can also trigger an
 * automatic stage move (e.g. "booked" → stage:booked).
 */
const OUTCOMES = {
  booked:           { label: 'Booked meeting',     autoStage: 'booked', terminal: false },
  answered_pitched: { label: 'Answered + pitched', autoStage: null,     terminal: false },
  callback:         { label: 'Asked for callback', autoStage: 'contacted', terminal: false },
  voicemail:        { label: 'Left voicemail',     autoStage: 'contacted', terminal: false },
  no_answer:        { label: 'No answer',          autoStage: null,     terminal: false },
  not_interested:   { label: 'Not interested',     autoStage: 'lost',   terminal: true },
  wrong_number:     { label: 'Wrong number',       autoStage: 'lost',   terminal: true },
  do_not_call:      { label: 'Do not call',        autoStage: 'lost',   terminal: true },
  won:              { label: 'Closed won',         autoStage: 'won',    terminal: true }
};

/**
 * Log a call/outreach outcome for this lead. Appends to pipeline.outcomes[]
 * and (if the outcome implies a stage transition) automatically updates
 * pipeline.status — calling setStage so the stageHistory captures it too.
 *
 * Returns the new outcome record.
 */
async function recordOutcome(domain, { outcome, note = null, by = 'admin' } = {}) {
  if (!OUTCOMES[outcome]) throw new Error(`unknown outcome: ${outcome}`);
  const recordPath = path.join(ARCHIVE_DIR, `${archive.domainHash(domain)}.json`);
  let record;
  try {
    record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('lead not found in archive');
    throw err;
  }
  record.pipeline = record.pipeline || { status: null, notes: [], stageHistory: [], outcomes: [] };
  record.pipeline.outcomes = record.pipeline.outcomes || [];
  const def = OUTCOMES[outcome];
  const entry = {
    at: new Date().toISOString(),
    by,
    outcome,
    label: def.label,
    note: note ? String(note).trim().slice(0, 1000) : null,
    autoStage: def.autoStage || null
  };
  record.pipeline.outcomes.unshift(entry);
  if (record.pipeline.outcomes.length > 100) record.pipeline.outcomes = record.pipeline.outcomes.slice(0, 100);
  // Atomic write before stage transition (so the outcome lands even if setStage fails)
  const tmp = recordPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
  await fs.rename(tmp, recordPath);
  // Trigger stage transition if outcome implies one (and it's a forward move)
  if (def.autoStage) {
    try {
      await setStage(domain, def.autoStage, {
        setBy: `outcome:${outcome}`,
        note: note ? `Outcome "${def.label}": ${note}` : `Outcome "${def.label}"`
      });
    } catch {
      // Outcome already logged; stage failure is non-fatal
    }
  }
  return entry;
}

/**
 * Add a tag to a lead's record. Tags are top-level on the archive record
 * (not inside pipeline) so they survive every audit save. Idempotent —
 * adding the same tag twice is a no-op. Tags are normalized: lowercase,
 * spaces → hyphens, max 40 chars.
 */
async function addTag(domain, { tag, by = 'admin' } = {}) {
  if (!tag || !String(tag).trim()) throw new Error('tag required');
  const normalized = String(tag).trim().toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, '-').slice(0, 40);
  if (!normalized) throw new Error('tag normalizes to empty');
  const recordPath = path.join(ARCHIVE_DIR, `${archive.domainHash(domain)}.json`);
  let record;
  try {
    record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('lead not found in archive');
    throw err;
  }
  record.tags = Array.isArray(record.tags) ? record.tags : [];
  if (!record.tags.includes(normalized)) {
    record.tags.push(normalized);
    record.tagsUpdatedAt = new Date().toISOString();
    record.tagsUpdatedBy = by;
    const tmp = recordPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
    await fs.rename(tmp, recordPath);
  }
  return { tags: record.tags, added: normalized };
}

async function removeTag(domain, { tag } = {}) {
  if (!tag) throw new Error('tag required');
  const normalized = String(tag).trim().toLowerCase();
  const recordPath = path.join(ARCHIVE_DIR, `${archive.domainHash(domain)}.json`);
  let record;
  try {
    record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('lead not found in archive');
    throw err;
  }
  record.tags = Array.isArray(record.tags) ? record.tags.filter((t) => t !== normalized) : [];
  record.tagsUpdatedAt = new Date().toISOString();
  const tmp = recordPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
  await fs.rename(tmp, recordPath);
  return { tags: record.tags, removed: normalized };
}

async function addNote(domain, { text, author = 'admin' }) {
  if (!text || !String(text).trim()) throw new Error('note text required');
  const recordPath = path.join(ARCHIVE_DIR, `${archive.domainHash(domain)}.json`);
  let record;
  try {
    record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('lead not found in archive');
    throw err;
  }
  record.pipeline = record.pipeline || { status: null, notes: [], stageHistory: [] };
  record.pipeline.notes = record.pipeline.notes || [];
  record.pipeline.notes.unshift({
    at: new Date().toISOString(),
    by: author,
    text: String(text).trim().slice(0, 4000)
  });
  if (record.pipeline.notes.length > 200) record.pipeline.notes = record.pipeline.notes.slice(0, 200);
  const tmp = recordPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
  await fs.rename(tmp, recordPath);
  return record.pipeline.notes[0];
}

/**
 * Build a CSV string of the filtered lead set. Includes everything a closer
 * or a CRM import would want: contact, score, qualifier bucket/persona,
 * recommended tier, last email date, days since last touch, audit grade,
 * dollar opportunity, owner classification, ahrefs metrics, pipeline stage.
 */
function leadsToCsv(leads) {
  const cols = [
    'domain', 'businessName', 'industry', 'city', 'state', 'stage',
    'auditScore', 'auditGrade', 'dollarOppLow', 'dollarOppHigh', 'findingsCount',
    'qualifierBucket', 'qualifierPersona', 'recommendedTier', 'priority', 'qualifiedAt',
    'primaryEmail', 'primaryPhone', 'seoOwner', 'seoOwnerConfidence',
    'ahrefsDR', 'ahrefsRefDomains', 'ahrefsOrgKW', 'ahrefsOrgTraffic',
    'leadScoreTier', 'leadScoreNumeric',
    'emailSentAt', 'emailSentCount', 'daysSinceLastTouch',
    'firstSeenAt', 'lastAuditedAt', 'suppressed'
  ];
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const rows = [cols.join(',')];
  for (const l of leads) {
    rows.push([
      l.domain,
      l.businessName,
      l.industry || '',
      l.city || '',
      l.state || '',
      l.stage,
      l.audit?.overallScore ?? '',
      l.audit?.grade ?? '',
      l.audit?.dollarOpportunity?.monthly?.low ?? '',
      l.audit?.dollarOpportunity?.monthly?.high ?? '',
      l.audit?.findingsCount ?? '',
      l.qualifier?.bucket ?? '',
      l.qualifier?.persona ?? '',
      l.qualifier?.recommendedTier ?? '',
      l.qualifier?.priority ?? '',
      l.qualifier?.submittedAt ?? '',
      l.contactInfo.primaryEmail ?? '',
      l.contactInfo.primaryPhone ?? '',
      l.seoOwner?.classification ?? '',
      l.seoOwner?.confidence ?? '',
      l.ahrefs?.domainRating ?? '',
      l.ahrefs?.refdomains ?? '',
      l.ahrefs?.organicKeywords ?? '',
      l.ahrefs?.organicTraffic ?? '',
      l.leadScore?.tier ?? '',
      l.leadScore?.score ?? '',
      l.activity.emailSentAt ?? '',
      l.activity.emailSentCount,
      l.activity.daysSinceLastTouch ?? '',
      l.activity.firstSeenAt ?? '',
      l.activity.lastAuditedAt ?? '',
      l.suppressed ? 'true' : 'false'
    ].map(escape).join(','));
  }
  return rows.join('\n');
}

/**
 * Mark/unmark a domain as a paying $79/mo Maintenance customer.
 *
 * Sets `maintenanceCustomer: true|false` + `maintenanceStartedAt` (set on
 * first activation) + `maintenanceEndedAt` (set on deactivation). The
 * weekly brief scheduler + 7-day re-audit cohort use these flags to
 * decide who gets ongoing service.
 *
 * Side effect: when activated, also flips `monitored: true` (legacy field
 * the older reAuditScheduler reads). When deactivated, leaves `monitored`
 * untouched so other monitoring rules (won/booked) still apply.
 */
async function setMaintenanceCustomer(domain, { active, by = 'admin', plan = 'maintenance_79' } = {}) {
  const recordPath = path.join(ARCHIVE_DIR, `${archive.domainHash(domain)}.json`);
  let record;
  try {
    record = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') throw new Error('lead not found in archive');
    throw err;
  }
  const now = new Date().toISOString();
  if (active) {
    if (!record.maintenanceStartedAt) record.maintenanceStartedAt = now;
    record.maintenanceCustomer = true;
    record.maintenanceEndedAt = null;
    record.maintenancePlan = plan;
    record.maintenanceStatusBy = by;
    record.maintenanceStatusAt = now;
    record.monitored = true; // legacy compat
  } else {
    record.maintenanceCustomer = false;
    record.maintenanceEndedAt = now;
    record.maintenanceStatusBy = by;
    record.maintenanceStatusAt = now;
    // Don't unset monitored — won/booked stages still trigger re-audits
  }
  const tmp = recordPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
  await fs.rename(tmp, recordPath);
  // Append an index mark so queryArchive sees the maintenance flag immediately
  try {
    const indexPath = path.join(__dirname, '..', 'data', 'audit-archive-index.ndjson');
    const fs2 = require('fs/promises');
    const line = JSON.stringify({
      schemaVersion: 'audit-archive/1.0',
      type: 'maintenance_mark',
      domain: archive.normalizeDomain(domain),
      domainHash: archive.domainHash(domain),
      maintenanceCustomer: record.maintenanceCustomer,
      maintenanceStartedAt: record.maintenanceStartedAt,
      maintenanceEndedAt: record.maintenanceEndedAt,
      maintenancePlan: record.maintenancePlan,
      markedAt: now
    }) + '\n';
    await fs2.appendFile(indexPath, line, 'utf8');
  } catch {}
  return {
    maintenanceCustomer: record.maintenanceCustomer,
    maintenanceStartedAt: record.maintenanceStartedAt,
    maintenanceEndedAt: record.maintenanceEndedAt,
    maintenancePlan: record.maintenancePlan
  };
}

/**
 * List every active maintenance customer (the audience for the weekly
 * brief). Sorted by maintenanceStartedAt desc (newest first).
 */
async function listMaintenanceCustomers() {
  const records = await loadAllArchiveRecords();
  const active = records.filter((r) => r.maintenanceCustomer === true);
  active.sort((a, b) => new Date(b.maintenanceStartedAt || 0) - new Date(a.maintenanceStartedAt || 0));
  return active.map((r) => {
    const latest = r.history && r.history[0];
    return {
      domain: r.domain,
      businessName: latest?.sourceMeta?.businessName || r.domain,
      industry: latest?.industry || null,
      city: latest?.city || null,
      state: latest?.state || null,
      maintenanceStartedAt: r.maintenanceStartedAt,
      maintenanceStatusAt: r.maintenanceStatusAt,
      plan: r.maintenancePlan || 'maintenance_79',
      contactEmail: latest?.contactInfo?.emails?.[0] || null,
      latestScore: latest?.audit?.overallScore ?? null
    };
  });
}

/**
 * List every domain currently suppressed (via auditArchive). Returns
 * a small projection for the UI: domain, businessName, reason, suppressedAt,
 * and primaryEmail so the operator can verify which contact is being shielded.
 *
 * Sorted newest-suppressed first.
 */
async function listSuppressed() {
  const records = await loadAllArchiveRecords();
  const suppressed = records.filter((r) => r.suppressedReason);
  suppressed.sort((a, b) => new Date(b.suppressedAt || 0) - new Date(a.suppressedAt || 0));
  return suppressed.map((r) => {
    const latest = r.history && r.history[0];
    return {
      domain: r.domain,
      businessName: latest?.sourceMeta?.businessName || r.domain,
      industry: latest?.industry || null,
      city: latest?.city || null,
      state: latest?.state || null,
      reason: r.suppressedReason,
      suppressedAt: r.suppressedAt,
      primaryEmail: latest?.contactInfo?.emails?.[0] || null,
      primaryPhone: latest?.contactInfo?.phones?.[0] || null,
      auditScore: latest?.audit?.overallScore ?? null
    };
  });
}

/**
 * Reverse suppression for one or more domains. Returns count of successful
 * unsuppress operations. Each is delegated to auditArchive.clearSuppression
 * which writes an unsuppression_mark into the index (append-only).
 */
async function unsuppressDomains(domains, { by = 'admin' } = {}) {
  let cleared = 0;
  const failed = [];
  for (const d of domains || []) {
    try {
      const result = await archive.clearSuppression(d, { by });
      if (result) cleared++;
    } catch (err) {
      failed.push({ domain: d, error: err && err.message });
    }
  }
  return { clearedCount: cleared, failedCount: failed.length, failed };
}

module.exports = {
  listLeads,
  getLead,
  setStage,
  addNote,
  addTag,
  removeTag,
  recordOutcome,
  listSuppressed,
  unsuppressDomains,
  setMaintenanceCustomer,
  listMaintenanceCustomers,
  leadsToCsv,
  isValidTransition,
  VALID_STAGES,
  STAGE_TRANSITIONS,
  OUTCOMES
};
