import { getDocuments, queryCollection } from './firestore.js';
import { academicAssessmentScheme, migrateAcademicScoreLayout } from './academic-scorebook.js';
import { academicComponentReviews } from './academic-component-review.js';
import { attendanceIdentity } from './academic-attendance-identity.js';
import { academicCarriedScoreReview, academicCarriedScoreSnapshot } from './academic-carried-score-review.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const plain = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
const active = row => !['archived', 'inactive', 'withdrawn', 'expelled', 'graduated'].includes(lower(row.Status));
const fail = message => Object.assign(new Error(message), { status: 409, code: 'ACADEMIC_ARM_TRANSFER_CONFLICT' });
const same = (a, b, fields) => fields.every(field => lower(a[field]) === lower(b[field]));
const periodFields = ['BranchId', 'SchoolSection', 'SessionId', 'TermId', 'ClassId'];
const schemeFor = sheet => academicAssessmentScheme({ Assessment: { Components: sheet.AssessmentComponents || [], GradeBands: sheet.GradeBands || [] } }, { RevisionId: sheet.AssessmentRevisionId });
const rank = status => ['Draft', 'Submitted', 'Approved', 'Locked'].indexOf(status || 'Draft');

export function isAcademicArmTransfer(before, after) {
  return Boolean(before && after && clean(before.ArmId) && clean(after.ArmId)
    && lower(before.ArmId) !== lower(after.ArmId) && same(before, after, [...periodFields, 'StudentRef']));
}

// Same-class placement changes keep the student's saved curriculum. They must
// not invoke the destination department's default subject selection/reset.
export function preserveAcademicArmSubjects(before, after) {
  for (const field of ['SubjectIds', 'CoreSubjectIds', 'TradeSubjectIds', 'OptionalSubjectIds']) after[field] = [...(before[field] || [])];
  after.CurriculumStatus = before.CurriculumStatus || '';
}

// Prepare one atomic transfer. Existing score/result/attendance document IDs
// remain stable, so receipts, result links, corrections and CBT provenance keep
// their references. No student or score document is archived, copied or deleted.
export async function planAcademicArmDataTransfer(env, { state, before, after, evidence, sheetIdFor, actor }, dependencies = {}) {
  if (!isAcademicArmTransfer(before, after)) return { writes: [], summary: null };
  const db = { queryCollection, getDocuments, ...dependencies };
  const timestamp = actor.timestamp;
  const matches = row => row && same({ ...row, BranchId: row.BranchId || 'main',
    SchoolSection: dependencies.sectionFor ? dependencies.sectionFor(row) : row.SchoolSection || 'secondary' }, before, periodFields);
  const studentMatches = row => matches(row) && lower(row.StudentRef) === lower(before.StudentRef);
  const ref = lower(before.StudentRef);
  const scores = (evidence.studentScores || []).filter(studentMatches);
  const results = (evidence.termResults || []).filter(studentMatches);
  const writes = [], originals = [];
  const patch = (collectionPath, row, id, data) => {
    if (!clean(id) || !row.__updateTime) throw fail('A student record changed or has no revision. Reload before transferring; nothing has been moved.');
    writes.push({ collectionPath, documentId: id, updateTime: row.__updateTime, updateMask: Object.keys(data), data });
  };
  const filters = ['BranchId', 'SessionId', 'TermId', 'StudentRef'].map(field => ({ field, op: '==', value: before[field] }));
  const readStudent = async collection => {
    const rows = await db.queryCollection(env, collection, { filters, limit: 10001 });
    if (rows.length > 10000) throw fail('This student has too many records for a safe transfer. Nothing was changed.');
    return rows.filter(studentMatches);
  };
  const ids = [...new Set(scores.flatMap(score => [score.SheetId, sheetIdFor(score.SubjectId)]).filter(Boolean))];
  const [loadedSheets, attendance, corrections] = await Promise.all([
    ids.length ? db.getDocuments(env, 'academicScoreSheets', ids) : [],
    readStudent('academicStudentAttendance'), readStudent('academicAttendanceCorrections')
  ]);
  const sheets = new Map(loadedSheets.filter(Boolean).map(row => [row.SheetId, row]));
  for (const sheet of sheets.values()) if (!matches(sheet)) throw fail('A score sheet belongs to a different class or period. Nothing was moved.');
  const subjectScores = new Map();
  for (const score of scores) {
    const key = lower(score.SubjectId);
    if (subjectScores.has(key)) throw fail(`This student has more than one saved score record for ${state.subjects.find(row => row.SubjectId === score.SubjectId)?.Name || 'a subject'}. Reconcile those marks before transferring; all records remain intact.`);
    subjectScores.set(key, score);
    if (!score.SheetId || !sheets.has(score.SheetId)) throw fail('A saved score is missing its assessment sheet. Restore that link before moving this student; no marks were changed.');
  }
  const moved = scores.filter(score => clean(sheets.get(score.SheetId).ArmId) && score.SheetId !== sheetIdFor(score.SubjectId));
  const affectedIds = [...new Set(moved.flatMap(score => [score.SheetId, sheetIdFor(score.SubjectId)]))];
  const rowsBySheet = new Map();
  // Only affected subject sheets are read, never the school-wide score history.
  for (const id of affectedIds) {
    const rows = await db.queryCollection(env, 'academicStudentScores', { filters: [{ field: 'SheetId', op: '==', value: id }], limit: 2001 });
    if (rows.length > 2000 || rows.some(row => !matches(row))) throw fail('A score sheet cannot be checked safely. Nothing was moved.');
    rowsBySheet.set(id, rows);
  }
  const rosterFor = (sheet, transferred) => {
    const rows = (state.studentMemberships || []).filter(row => active(row) && matches(row)
      && lower(row.StudentRef) !== ref && row.ArmId === sheet.ArmId && (row.SubjectIds || []).includes(sheet.SubjectId));
    if (transferred && (after.SubjectIds || []).includes(sheet.SubjectId)) rows.push(after);
    return rows;
  };
  const originalReviews = new Map();
  for (const id of affectedIds) {
    const sheet = sheets.get(id);
    if (!sheet) continue;
    const oldRoster = (state.studentMemberships || []).filter(row => active(row) && matches(row)
      && row.ArmId === sheet.ArmId && (row.SubjectIds || []).includes(sheet.SubjectId));
    originalReviews.set(id, await academicComponentReviews(sheet, oldRoster, rowsBySheet.get(id)));
  }
  const sourceByDestination = new Map();
  for (const score of moved) {
    const source = sheets.get(score.SheetId), id = sheetIdFor(score.SubjectId);
    let destination = sheets.get(id);
    const existingRows = rowsBySheet.get(id);
    if (existingRows.some(row => lower(row.StudentRef) === ref)) throw fail('The destination already has scores for this student. No records were overwritten.');
    if (!destination) {
      const teacher = (state.teacherAllocations || []).find(row => active(row) && matches(row)
        && (!row.ArmId || row.ArmId === after.ArmId) && row.SubjectId === score.SubjectId && row.AllocationRole === 'Subject Teacher');
      // Copy only assessment definitions, never a source teacher's whole-sheet
      // approval. Other destination students have not been reviewed here.
      destination = { SheetId: id, RecordId: id, ...Object.fromEntries(periodFields.map(field => [field, after[field]])),
        ArmId: after.ArmId, SubjectId: score.SubjectId, TeacherUsername: teacher?.TeacherUsername || '', Status: 'Draft',
        AssessmentComponents: source.AssessmentComponents, GradeBands: source.GradeBands,
        AssessmentRevisionId: source.AssessmentRevisionId, AssessmentSourceRevisionIds: source.AssessmentSourceRevisionIds || [],
        CreatedAt: timestamp, CreatedBy: actor.name };
      sheets.set(id, destination);
    }
    const oldScheme = schemeFor(source), newScheme = schemeFor(destination);
    const definitionsMatch = JSON.stringify(oldScheme.Components) === JSON.stringify(newScheme.Components)
      && JSON.stringify(oldScheme.GradeBands) === JSON.stringify(newScheme.GradeBands);
    let recalculated = {};
    if (!definitionsMatch) {
      // The established layout migrator refuses to discard recorded components.
      // Keep the exact pre-transfer record in the movement's immutable snapshot.
      try { recalculated = migrateAcademicScoreLayout(oldScheme, newScheme, score); }
      catch (error) { throw fail(`The destination assessment layout cannot preserve these marks: ${error.message}`); }
    }
    const data = { ...recalculated, ArmId: after.ArmId, SheetId: id, AssessmentRevisionId: destination.AssessmentRevisionId,
      UpdatedAt: timestamp, UpdatedBy: actor.name };
    const carried = academicCarriedScoreReview(score, source);
    const sourcePending = (source.PendingStudentRefs || []).some(value => lower(value) === ref);
    const sourceStatus = !sourcePending && rank(source.Status) > rank(carried?.Status) ? source.Status : carried?.Status || 'Draft';
    data.ArmTransferReview = { SourceSheetId: source.SheetId, SourceArmId: source.ArmId,
      Status: definitionsMatch ? sourceStatus : 'Draft', AssessmentRevisionId: destination.AssessmentRevisionId,
      ScoreSnapshot: academicCarriedScoreSnapshot(recalculated.ComponentScores || score.ComponentScores),
      ComponentReviews: source.ComponentReviews || {}, TransferredAt: timestamp, TransferredBy: actor.name };
    originals.push(plain(score));
    patch('academicStudentScores', score, score.ScoreId || score.RecordId, data);
    rowsBySheet.set(source.SheetId, rowsBySheet.get(source.SheetId).filter(row => lower(row.StudentRef) !== ref));
    rowsBySheet.set(id, [...existingRows, { ...score, ...data }]);
    sourceByDestination.set(id, { source, score, definitionsMatch });
  }
  for (const id of affectedIds) {
    const sheet = sheets.get(id), incoming = sourceByDestination.get(id), rows = rowsBySheet.get(id);
    const roster = rosterFor(sheet, Boolean(incoming));
    const reviews = await academicComponentReviews(sheet, roster, rows), old = originalReviews.get(id) || [];
    const componentReviews = { ...(sheet.ComponentReviews || {}) };
    for (const review of reviews) {
      const previous = old.find(row => row.ComponentId === review.ComponentId);
      if (!previous || previous.Stale || previous.Status === 'Draft') continue;
      const sourceReview = incoming && originalReviews.get(incoming.source.SheetId)?.find(row => row.ComponentId === review.ComponentId);
      const eligible = !incoming || (incoming.definitionsMatch && (rank(incoming.source.Status) >= rank(previous.Status)
        || (sourceReview && !sourceReview.Stale && rank(sourceReview.Status) >= rank(previous.Status)))
        && !(incoming.source.PendingStudentRefs || []).some(value => lower(value) === ref)
        && !(incoming.source.ComponentReviews?.[review.ComponentId]?.PendingStudentRefs || []).some(value => lower(value) === ref));
      const pending = new Set((sheet.ComponentReviews?.[review.ComponentId]?.PendingStudentRefs || []).filter(value => lower(value) !== ref));
      review.MissingStudentRefs.forEach(value => pending.add(value));
      if (!eligible) pending.add(before.StudentRef);
      componentReviews[review.ComponentId] = { ...componentReviews[review.ComponentId], ScoreDigest: review.ScoreDigest,
        RosterCount: review.RosterCount, CompleteCount: review.CompleteCount, PendingStudentRefs: [...pending], AllowPendingStudents: pending.size > 0 };
    }
    const pending = new Set((sheet.PendingStudentRefs || []).filter(value => lower(value) !== ref));
    if (incoming && rank(sheet.Status) > 0 && (!incoming.definitionsMatch || rank(incoming.source.Status) < rank(sheet.Status)
      || (incoming.source.PendingStudentRefs || []).some(value => lower(value) === ref))) pending.add(before.StudentRef);
    const complete = rows.filter(row => lower(row.CompletionStatus) === 'complete').length;
    const data = { RosterCount: roster.length, EnteredCount: rows.length, CompleteCount: complete,
      IncompleteCount: Math.max(0, roster.length - complete), PendingStudentRefs: [...pending], AllowPendingStudents: pending.size > 0,
      ComponentReviews: componentReviews, UpdatedAt: timestamp, UpdatedBy: actor.name };
    if (rank(sheet.Status) >= 2) data.ApprovedStudentCount = roster.filter(row => ![...pending].some(value => lower(value) === lower(row.StudentRef))).length;
    if (sheet.__updateTime) patch('academicScoreSheets', sheet, id, data);
    else writes.push({ collectionPath: 'academicScoreSheets', documentId: id, exists: false, data: { ...sheet, ...data } });
  }
  for (const result of results.filter(row => row.ArmId !== after.ArmId)) {
    const duplicate = results.find(row => row !== result && lower(row.ResultType || 'End of Term') === lower(result.ResultType || 'End of Term'));
    if (duplicate) throw fail('This student has multiple results for this period. Reconcile them before transferring; no published result was changed.');
    patch('academicResults', result, result.ResultId, { ArmId: after.ArmId,
      ArmName: state.arms.find(row => row.ArmId === after.ArmId)?.Name || '',
      AssessedArmId: result.AssessedArmId || result.ArmId, AssessedArmName: result.AssessedArmName || result.ArmName || '',
      UpdatedAt: timestamp, UpdatedBy: actor.name });
  }
  const identities = new Set();
  for (const row of attendance) {
    const identity = attendanceIdentity({ ...row, ArmId: after.ArmId });
    if (identities.has(identity)) throw fail('This student has conflicting attendance registers for the same date. No records were changed.');
    identities.add(identity);
    if (row.ArmId !== after.ArmId) patch('academicStudentAttendance', row, row.AttendanceId || row.RecordId, { ArmId: after.ArmId,
      RecordedArmId: row.RecordedArmId || row.ArmId, UpdatedAt: timestamp, UpdatedBy: actor.name });
  }
  for (const row of corrections.filter(row => row.ArmId !== after.ArmId)) {
    const original = attendance.find(record => record.AttendanceId === row.AttendanceId);
    const updated = original && writes.find(write => write.collectionPath === 'academicStudentAttendance' && write.documentId === original.AttendanceId);
    const stillCurrent = original && (row.AttendanceRevision === original.__updateTime
      || row.AttendanceTransferState === academicCarriedScoreSnapshot(plain(original)));
    patch('academicAttendanceCorrections', row, row.CorrectionId || row.RecordId, { ArmId: after.ArmId,
      ...(stillCurrent && updated ? { AttendanceTransferState: academicCarriedScoreSnapshot({ ...plain(original), ...updated.data }) } : {}) });
  }
  return { writes, summary: { FromArmId: before.ArmId, ToArmId: after.ArmId,
    ScoresMoved: moved.length, ResultsMoved: results.filter(row => row.ArmId !== after.ArmId).length,
    AttendanceMoved: attendance.filter(row => row.ArmId !== after.ArmId).length, OriginalScoreRecords: originals } };
}
