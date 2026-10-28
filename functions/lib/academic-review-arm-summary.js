import { getDocument, queryCollectionPages } from './firestore.js';

const clean = value => String(value ?? '').trim();
const fail = message => Object.assign(new Error(message), { status: 400, code: 'ACADEMIC_REVIEW_SCOPE_INVALID' });

// Called only after reviewer, branch and section authorisation. No marks,
// rosters, student identities, history or writes are needed for these counts.
export async function loadAcademicReviewArmSummary(env, scope, input = {}, dependencies = {}) {
  const db = { getDocument, queryCollectionPages, ...dependencies };
  const SessionId = clean(input.SessionId), TermId = clean(input.TermId);
  if (!SessionId || !TermId) throw fail('Choose the academic session and term before loading branch-wide arm counts.');
  const sectionOf = row => clean(row.SchoolSection).toLowerCase() || scope.legacySection || 'secondary';
  const [session, term] = await Promise.all([
    db.getDocument(env, 'academicSessions', SessionId), db.getDocument(env, 'academicTerms', TermId)
  ]);
  if (!session || !term || [session, term].some(row => clean(row.BranchId || 'main') !== scope.branchId || sectionOf(row) !== scope.section)
      || clean(term.SessionId) !== SessionId) throw fail('Choose a session and term belonging to this branch and school section.');
  const loadedAt = new Date().toISOString();
  const filters = [['BranchId', scope.branchId], ['SessionId', SessionId], ['TermId', TermId]].map(([field, value]) => ({ field, op: '==', value }));
  const [rows, results] = await Promise.all([db.queryCollectionPages(env, 'academicScoreSheets', {
    filters,
    select: ['SheetId', 'BranchId', 'SchoolSection', 'SessionId', 'TermId', 'ClassId', 'ArmId', 'Status', 'UpdatedAt', 'AssessmentComponents', 'ComponentReviews'],
    pageSize: 250, maxRows: 10000, readTime: loadedAt
  }), db.queryCollectionPages(env, 'academicResults', {
    filters,
    select: ['BranchId', 'SchoolSection', 'SessionId', 'TermId', 'ClassId', 'ArmId', 'Status', 'ResultType',
      'IncludedAssessmentComponentIds', 'CalculationPending', 'SubjectChangeRecalculationRequired'],
    pageSize: 250, maxRows: 20000, readTime: loadedAt
  })]);
  const publicationGroups = new Map();
  for (const row of results) {
    if (clean(row.BranchId || 'main') !== scope.branchId || sectionOf(row) !== scope.section
        || row.SessionId !== SessionId || row.TermId !== TermId || !clean(row.ClassId) || !clean(row.ArmId)) continue;
    const ComponentIds = [...new Set((row.IncludedAssessmentComponentIds || []).map(clean).filter(Boolean))].sort();
    const ResultType = clean(row.ResultType) || 'End of Term';
    const key = JSON.stringify([row.ClassId,row.ArmId,ResultType,ComponentIds]);
    const group = publicationGroups.get(key) || {ClassId:row.ClassId,ArmId:row.ArmId,ResultType,ComponentIds,Published:0,Other:0};
    if (['Published','Locked'].includes(row.Status) && !row.CalculationPending && !row.SubjectChangeRecalculationRequired) group.Published++;
    else group.Other++;
    publicationGroups.set(key,group);
  }
  const sheets = rows.filter(row => clean(row.BranchId || 'main') === scope.branchId && sectionOf(row) === scope.section
    && row.SessionId === SessionId && row.TermId === TermId).map(row => ({
    SheetId: clean(row.SheetId || row.__id), ClassId: clean(row.ClassId), ArmId: clean(row.ArmId), Status: clean(row.Status), UpdatedAt: clean(row.UpdatedAt),
    AssessmentComponents: (row.AssessmentComponents || []).map(component => ({ Id: clean(component.Id), Name: clean(component.Name) })),
    ComponentReviews: Object.fromEntries(Object.entries(row.ComponentReviews || {}).map(([key, review]) => [key, { Status: clean(review?.Status), Stale: review?.Stale === true }]))
  }));
  return { ok: true, branchReviewSummary: { BranchId: scope.branchId, SchoolSection: scope.section, SessionId, TermId, loadedAt, sheets, publications:[...publicationGroups.values()] } };
}
