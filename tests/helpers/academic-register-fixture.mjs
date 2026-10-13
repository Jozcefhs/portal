import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

export const source = await readFile(new URL('../../js/admin.js', import.meta.url), 'utf8');
export function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing function ${name}`);
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}
const helpers = ['academicRecordId', 'academicIsActive', 'academicFind', 'academicLabel', 'academicSelectOptions', 'academicScoreStateOptions']
  .map(extractFunction).join('\n');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fixture() {
  const context = { SessionId: 'session', TermId: 'term', ClassId: 'class', ArmId: 'arm' };
  const students = [
    { StudentRef: 'TEST/10', Name: 'Zara Okafor' },
    { StudentRef: 'TEST/8', DisplayName: 'Émile Ade' },
    { StudentRef: 'TEST/3', StudentName: 'chioma Bello' },
    { StudentRef: 'TEST/2', Name: 'Alex Musa' },
    { StudentRef: 'TEST/1', Name: 'alex musa' },
    { StudentRef: 'TEST/4', Name: 'Ada & Chidi' }
  ];
  return {
    data: {
      students, staff: [],
      permissions: { canMarkAttendance: true, canEnterScores: true },
      assessmentScheme: {
        Ready: true, RevisionId: 'test', GradeBands: [],
        Components: [{ Id: 'exam', Name: 'Examination', MaximumScore: 100, WeightPercentage: 100 }]
      },
      scorebookContext: { ...context, SubjectId: 'math', TeacherUsername: 'teacher' }
    },
    rows: {
      classes: [{ ClassId: 'class', Name: 'Grade 10' }],
      arms: [{ ArmId: 'arm', ClassId: 'class', Name: 'Brilliance', IsClassroom: true }],
      subjects: [{ SubjectId: 'math', Name: 'Mathematics' }],
      teacherAllocations: [{ ...context, AllocationRole: 'Subject Teacher', SubjectId: 'math', TeacherUsername: 'teacher' }],
      studentMemberships: students.map(student => ({ ...context, StudentRef: student.StudentRef, SubjectIds: ['math'] })),
      studentAttendance: [{ ...context, StudentRef: 'TEST/3', AttendanceDate: '2026-10-13', Mode: 'Daily', Status: 'Late', MinutesLate: 12, Note: 'Bus delay' }],
      schoolCalendars: [], timetableVersions: [], timetableEntries: [], attendanceCorrections: [],
      scoreSheets: [], studentScores: [], scoreImports: []
    }
  };
}

export function renderWorkspace(kind, input = fixture(), presenceOnly = true) {
  const name = kind === 'scorebook' ? 'academicScorebookWorkspace' : 'academicAttendanceWorkspace';
  return runInNewContext(`${helpers}\n(${extractFunction(name)})(data, rows, presenceOnly)`, {
    ...input, presenceOnly, escapeHtml,
    clean: value => String(value ?? '').trim(),
    academicManagementFilters: { sessionId: 'session', termId: 'term', section: 'Secondary' },
    academicAttendanceDraft: { date: '2026-10-13' }, academicScorebookDraft: {},
    academicLocalToday: () => '2026-10-13', academicCalendarOpenOn: () => true,
    academicTermAttendanceRows: () => [], table: () => ''
  });
}
