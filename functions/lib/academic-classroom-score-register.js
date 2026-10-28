import { queryCollectionPages, getDocuments } from './firestore.js';
import { academicAuditRecordLabels } from './academic-audit-log.js';
import { buildAcademicClassScoreRegister } from './academic-class-score-register.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const active = row => !['inactive', 'archived', 'withdrawn', 'transferred', 'graduated', 'expelled'].includes(lower(row.Status));
const forbidden = () => Object.assign(new Error('Choose a classroom assigned to you as class teacher or assistant for this session and term.'),
  { status: 403, code: 'ACADEMIC_CLASSROOM_REGISTER_FORBIDDEN' });

// Exact classroom assignments only. Subject allocations and historic ownership
// never confer access to another teacher's entire classroom.
export function academicTeacherScoreClassrooms(state, username, input = {}) {
  const assignments = (state.teacherAllocations || []).filter(row => active(row)
    && lower(row.TeacherUsername) === lower(username) && ['form teacher', 'assistant teacher'].includes(lower(row.AllocationRole))
    && row.SessionId === input.SessionId && row.TermId === input.TermId && clean(row.ArmId));
  return (state.arms || []).filter(arm => active(arm) && assignments.some(row =>
    row.ArmId === arm.ArmId && row.ClassId === arm.ClassId));
}

// Called only by the web-only capability/branch/section checked handler. No
// writes, broad student directory loads or history scans are needed for a report.
export async function loadAcademicClassroomScoreRegister(env, scope, state, username, input, dependencies = {}) {
  const db = { queryCollectionPages, getDocuments, academicAuditRecordLabels, ...dependencies };
  // This permission is supplied by the authenticated handler, never by request input.
  const classrooms = dependencies.canViewAllClassrooms === true
    ? (state.arms || []).filter(active) : academicTeacherScoreClassrooms(state, username, input);
  const arm = classrooms.find(row =>
    row.ArmId === input.ArmId && row.ClassId === input.ClassId);
  const session = (state.sessions || []).find(row => row.SessionId === input.SessionId);
  const term = (state.terms || []).find(row => row.TermId === input.TermId && row.SessionId === input.SessionId);
  if (!arm || !session || !term || !(state.classes || []).some(row => row.ClassId === input.ClassId)) {
    if (dependencies.canViewAllClassrooms === true) throw Object.assign(new Error('Choose a permitted classroom, academic session and term.'),
      { status: 403, code: 'ACADEMIC_CLASSROOM_REGISTER_FORBIDDEN' });
    throw forbidden();
  }
  const sections = [...new Set((scope.structure?.Sections || []).map(lower).filter(value => ['primary', 'secondary'].includes(value)))];
  const legacySection = sections.length === 1 ? sections[0] : 'secondary';
  const matches = row => row && lower(row.BranchId || 'main') === lower(scope.branchId)
    && (['primary', 'secondary'].includes(lower(row.SchoolSection)) ? lower(row.SchoolSection) : legacySection) === lower(scope.section)
    && row.SessionId === input.SessionId && row.TermId === input.TermId && row.ClassId === input.ClassId;
  const filters = ['SessionId', 'TermId', 'ClassId'].map(field => ({ field, op: '==', value: input[field] }));
  const roster = (await db.queryCollectionPages(env, 'academicStudentMemberships', {
    filters: [...filters, { field: 'ArmId', op: '==', value: input.ArmId }], pageSize: 250, maxRows: 2000
  })).filter(row => matches(row) && row.ArmId === input.ArmId && active(row));
  const refs = [...new Set(roster.map(row => clean(row.StudentRef)).filter(Boolean))];
  const scores = [];
  // Keep marks saved before a transfer (and class-wide subject sheets), but
  // fetch only the students in this classroom, in the selected class and term.
  for (let offset = 0; offset < refs.length; offset += 20) {
    scores.push(...(await db.queryCollectionPages(env, 'academicStudentScores', {
      filters: [...filters, { field: 'StudentRef', op: 'in', value: refs.slice(offset, offset + 20) }],
      pageSize: 250, maxRows: 10000
    })).filter(row => matches(row) && refs.includes(clean(row.StudentRef))));
  }
  const sheetIds = [...new Set(scores.map(row => clean(row.SheetId)).filter(Boolean))];
  const [sheets, labels, scheme] = await Promise.all([
    sheetIds.length ? db.getDocuments(env, 'academicScoreSheets', sheetIds) : [],
    refs.length ? db.academicAuditRecordLabels(env, scope, refs.map(StudentRef => ({ StudentRef }))) : [],
    refs.length && dependencies.assessmentScheme ? dependencies.assessmentScheme(session, term) : { Components: [] }
  ]);
  const report = buildAcademicClassScoreRegister({ ...state, assessmentScheme: scheme,
    studentMemberships: roster, studentScores: scores, scoreSheets: sheets.filter(matches),
    students: labels.map(row => ({ StudentRef: row.StudentRef, StudentName: row.RecordLabel })) }, input);
  return { ...report, ArmId: arm.ArmId, ArmName: clean(arm.Name),
    ClassroomName: `${report.ClassName} / ${clean(arm.Name)}`, ReadOnly: true };
}
