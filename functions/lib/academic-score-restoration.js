import { academicAssessmentScheme, calculateAcademicStudentScore } from './academic-scorebook.js';
import { academicComponentReviews } from './academic-component-review.js';

const text = value => String(value ?? '').trim();
const lower = value => text(value).toLowerCase();
const recorded = cell => cell && ['Numeric', 'Absent', 'Exempt'].includes(cell.State);
const fail = message => { throw new Error(message); };
const valueOf = cell => ({ State: cell.State, RawScore: cell.State === 'Numeric' ? cell.RawScore : null, MaximumScore: cell.MaximumScore ?? null });
const cellOf = (scores, id) => {
  const [componentId, partId] = id.split(':');
  const components = scores.filter(row => row.ComponentId === componentId);
  if (components.length !== 1) return null;
  if (!partId) return components[0].Parts?.length ? null : components[0];
  const parts = (components[0].Parts || []).filter(row => row.PartId === partId);
  return parts.length === 1 ? parts[0] : null;
};
const equal = (a, b) => JSON.stringify(valueOf(a)) === JSON.stringify(valueOf(b));

// Offline maintenance planner. The caller must retain a verified backup, guard
// both source and destination revisions, and commit the score/audit/review changes
// atomically. It never chooses which source is correct or writes to a database.
export function planFormerArmScoreRestoration({ source, target, membership, sheet, cellIds, actor }) {
  for (const field of ['repairId', 'timestamp', 'reason', 'name', 'username']) {
    if (!text(actor?.[field])) fail(`Restoration ${field} is required.`);
  }
  const scope = ['BranchId', 'SchoolSection', 'SessionId', 'TermId', 'ClassId', 'StudentRef'];
  if (!source || !target || !membership || scope.some(field => !text(target[field])
      || lower(source[field]) !== lower(target[field]) || lower(membership[field]) !== lower(target[field]))
      || source.SubjectId !== target.SubjectId || source.ScoreId === target.ScoreId
      || !text(source.ArmId) || !text(target.ArmId) || source.ArmId === target.ArmId
      || membership.ArmId !== target.ArmId || lower(membership.Status) !== 'active'
      || !text(source.__updateTime) || !text(target.__updateTime)) fail('The earlier and current records do not have a safe matching student scope.');
  if (sheet?.SheetId !== target.SheetId || sheet.ArmId !== target.ArmId || sheet.SubjectId !== target.SubjectId
      || scope.filter(field => field !== 'StudentRef').some(field => lower(sheet[field]) !== lower(target[field]))
      || sheet.Status !== 'Draft') fail('Restore working marks only into the matching Draft sheet.');
  if (!Array.isArray(cellIds) || !cellIds.length || new Set(cellIds).size !== cellIds.length) fail('Choose distinct test cells to restore.');
  const history = target.ScoreRestorationHistory || [];
  if (history.some(event => event.RepairId === actor.repairId)) {
    if (cellIds.every(id => recorded(cellOf(source.ComponentScores, id))
        && recorded(cellOf(target.ComponentScores, id))
        && equal(cellOf(source.ComponentScores, id), cellOf(target.ComponentScores, id)))) return null;
    fail('This restoration was already applied and its working marks have since changed. Do not replay it.');
  }
  const components = structuredClone(target.ComponentScores || []), changes = [];
  for (const id of cellIds) {
    const earlier = cellOf(source.ComponentScores || [], id), current = cellOf(components, id);
    if (!recorded(earlier) || !recorded(current) || !Number.isFinite(earlier.MaximumScore)
        || earlier.MaximumScore !== current.MaximumScore) fail('Both saved cells must have comparable recorded marks and the same maximum.');
    if (equal(earlier, current)) continue;
    changes.push({ CellId: id, Before: valueOf(current), After: valueOf(earlier),
      SourceScoreId: source.ScoreId, SourceSheetId: source.SheetId, SourceArmId: source.ArmId,
      SourceUpdateTime: source.__updateTime });
    Object.assign(current, { State: earlier.State, RawScore: earlier.RawScore ?? null });
  }
  if (!changes.length) return null;
  const scheme = academicAssessmentScheme({ Assessment: { Components: sheet.AssessmentComponents, GradeBands: sheet.GradeBands } }, { RevisionId: sheet.AssessmentRevisionId });
  const calculated = calculateAcademicStudentScore(scheme, components);
  for (const component of target.ComponentScores || []) {
    for (const cell of component.Parts?.length ? component.Parts : [component]) {
      const id = `${component.ComponentId}${component.Parts?.length ? `:${cell.PartId}` : ''}`;
      const after = cellOf(calculated.ComponentScores, id), expected = cellIds.includes(id) ? cellOf(source.ComponentScores, id) : cell;
      if (!after || !expected || !equal(after, expected)) fail('The destination assessment layout cannot preserve all selected and unrelated cells exactly.');
    }
  }
  const event = { RepairId: actor.repairId, RestoredAt: actor.timestamp, RestoredBy: actor.name,
    RestoredByUsername: actor.username, Reason: actor.reason, Cells: changes };
  const corrections = changes.map(change => ({ ...change, Reason: actor.reason, AuthorisedBy: actor.username,
    AuthorisedAt: actor.timestamp, CorrectedAt: actor.timestamp, CorrectedBy: actor.name, CorrectedByUsername: actor.username }));
  return { changes, data: { ...calculated,
    SourceType: 'ManualCorrection', SourceId: actor.repairId,
    ManualScoreCorrections: [...(target.ManualScoreCorrections || []), ...corrections],
    ScoreRestorationHistory: [...history, event],
    UpdatedAt: actor.timestamp, UpdatedBy: actor.name, UpdatedByUsername: actor.username } };
}

// A restoration is a correction, not a new approval. Keep valid reviews for
// classmates, while identifying only restored students as awaiting review.
export async function planRestoredScoreReviews(sheet, roster, beforeScores, afterScores, restorations) {
  const before = await academicComponentReviews(sheet, roster, beforeScores);
  const after = await academicComponentReviews(sheet, roster, afterScores);
  const componentReviews = structuredClone(sheet.ComponentReviews || {});
  for (const review of after) {
    const changedRefs = restorations.filter(row => row.changes.some(cell => cell.CellId.split(':')[0] === review.ComponentId))
      .map(row => lower(row.StudentRef));
    if (!changedRefs.length) continue;
    const old = before.find(row => row.ComponentId === review.ComponentId);
    if (!old || old.Stale || old.Status === 'Draft' || !componentReviews[review.ComponentId]) continue;
    const pending = [...new Set([...(componentReviews[review.ComponentId].PendingStudentRefs || []).map(lower),
      ...review.MissingStudentRefs, ...changedRefs])];
    componentReviews[review.ComponentId] = { ...componentReviews[review.ComponentId],
      ScoreDigest: review.ScoreDigest, CompleteCount: review.CompleteCount, RosterCount: review.RosterCount,
      AllowPendingStudents: pending.length > 0, PendingStudentRefs: pending };
  }
  return componentReviews;
}
