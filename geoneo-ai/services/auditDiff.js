/**
 * Audit diff — compares two audit history entries and returns a structured
 * "what changed" object. Used by:
 *   - Maintenance weekly brief (Monday emails)
 *   - Customer dashboard "what moved this week" widget
 *   - Score-drop alert emails (already exist; this gives them more context)
 *
 * Inputs are two history-entry shapes (each has .audit.{overallScore,
 * sectionScores, findings[]}) — newer first, older second. Output:
 *
 *   {
 *     scoreDelta: -3,                        // negative = dropped
 *     pillarDeltas: { schema: +5, eeat: -2, ... },
 *     fixedFindings: [{key, title, severity}],   // present in older, gone from newer
 *     newFindings: [{key, title, severity}],     // present in newer, not in older
 *     changedFindings: [{key, oldSeverity, newSeverity}],
 *     summary: { totalFixed, totalNew, totalChanged, biggestPillarMove }
 *   }
 *
 * No LLM. Pure structural diff.
 */

function buildAuditDiff(newEntry, oldEntry) {
  if (!newEntry || !newEntry.audit) return null;
  const oldAudit = oldEntry && oldEntry.audit;
  const newAudit = newEntry.audit;

  const scoreDelta = oldAudit && typeof newAudit.overallScore === 'number' && typeof oldAudit.overallScore === 'number'
    ? newAudit.overallScore - oldAudit.overallScore
    : 0;

  const pillarDeltas = {};
  if (oldAudit && oldAudit.sectionScores && newAudit.sectionScores) {
    for (const k of Object.keys(newAudit.sectionScores)) {
      const a = newAudit.sectionScores[k];
      const b = oldAudit.sectionScores[k];
      if (typeof a === 'number' && typeof b === 'number') {
        pillarDeltas[k] = a - b;
      }
    }
  }

  const newFindings = Array.isArray(newAudit.findings) ? newAudit.findings : [];
  const oldFindings = Array.isArray(oldAudit && oldAudit.findings) ? oldAudit.findings : [];
  const newKeys = new Map(newFindings.map((f) => [f.key, f]));
  const oldKeys = new Map(oldFindings.map((f) => [f.key, f]));

  // Fixed = was in old, not in new
  const fixed = [];
  for (const [key, f] of oldKeys) {
    if (!newKeys.has(key)) {
      fixed.push({ key, title: f.title, severity: f.severity, dollarImpact: f.dollarImpact || null });
    }
  }
  // New = is in new, was not in old
  const added = [];
  for (const [key, f] of newKeys) {
    if (!oldKeys.has(key)) {
      added.push({ key, title: f.title, severity: f.severity, dollarImpact: f.dollarImpact || null });
    }
  }
  // Changed severity
  const changed = [];
  for (const [key, f] of newKeys) {
    const oldF = oldKeys.get(key);
    if (oldF && oldF.severity !== f.severity) {
      changed.push({
        key,
        title: f.title,
        oldSeverity: oldF.severity,
        newSeverity: f.severity,
        worsened: severityRank(f.severity) > severityRank(oldF.severity)
      });
    }
  }

  // Biggest pillar move (by abs delta), for headline
  let biggestPillarMove = null;
  for (const [k, d] of Object.entries(pillarDeltas)) {
    if (!biggestPillarMove || Math.abs(d) > Math.abs(biggestPillarMove.delta)) {
      biggestPillarMove = { pillar: k, delta: d };
    }
  }

  return {
    scoreDelta,
    pillarDeltas,
    fixedFindings: fixed,
    newFindings: added,
    changedFindings: changed,
    summary: {
      totalFixed: fixed.length,
      totalNew: added.length,
      totalChanged: changed.length,
      biggestPillarMove,
      direction: scoreDelta > 0 ? 'improved' : (scoreDelta < 0 ? 'declined' : 'flat')
    }
  };
}

function severityRank(sev) {
  return ({ high: 3, medium: 2, low: 1 }[String(sev || '').toLowerCase()]) || 0;
}

/**
 * Given a domain history (newest-first), pick the entry closest to N days
 * ago (e.g., for a "last week" comparison). Returns null if no usable entry.
 */
function entryNDaysAgo(history, daysAgo) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const target = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  let bestEntry = null;
  let bestDelta = Infinity;
  for (const h of history.slice(1)) { // skip newest (=current)
    const ts = new Date(h.audit?.generatedAt || h.generatedAt || h.auditedAt || 0).getTime();
    if (!ts) continue;
    const delta = Math.abs(ts - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestEntry = h;
    }
  }
  return bestEntry;
}

/**
 * Convenience: diff vs entry from N days ago. Returns the diff +
 * the actual age-in-days of the comparison entry (since it may not be
 * exactly N).
 */
function diffVsNDaysAgo(history, daysAgo = 7) {
  if (!history || history.length < 2) return null;
  const newest = history[0];
  const old = entryNDaysAgo(history, daysAgo);
  if (!old) return null;
  const oldTs = new Date(old.audit?.generatedAt || old.generatedAt || 0).getTime();
  const actualDays = Math.round((Date.now() - oldTs) / (24 * 60 * 60 * 1000));
  return {
    ...buildAuditDiff(newest, old),
    comparedAgainst: { generatedAt: old.audit?.generatedAt || old.generatedAt, actualDaysAgo: actualDays }
  };
}

module.exports = {
  buildAuditDiff,
  diffVsNDaysAgo,
  entryNDaysAgo,
  severityRank
};
