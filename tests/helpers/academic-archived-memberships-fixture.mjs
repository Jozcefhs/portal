import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { extractFunction } from './academic-register-fixture.mjs';

const dependencies = await Promise.all(['list-sorting', 'display-time'].map(name =>
  readFile(new URL(`../../js/${name}.js`, import.meta.url), 'utf8')));
export const runtime = `${dependencies.join('\n')}
const clean = value => String(value ?? '').trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const academicManagementFilters = { section: 'secondary', sessionId: 'session', termId: 'term' };
const activeSection = 'academicManagement';
const { modes: ADMIN_LIST_SORT_MODES, createdFields: ADMIN_LIST_CREATED_FIELDS,
  modifiedFields: ADMIN_LIST_MODIFIED_FIELDS, nameValue: adminListNameValue,
  timestamp: adminListTimestamp, sortEntries: sortAdminListEntries } = DynamaxListSorting;
${['academicRecordId', 'academicFind', 'academicLabel', 'academicLearnerTerms', 'academicCurrentRows',
  'academicArchivedMembershipRows', 'academicArchivedMembershipWorkspace', 'academicCurrentMembershipRegisterRows',
  'adminListStorageKey', 'savedAdminListSort', 'table'].map(extractFunction).join('\n')}`;

export function fixture() {
  const scope = { BranchId: 'main', SchoolSection: 'secondary', SessionId: 'session', TermId: 'term' };
  const members = [
    { ...scope, MembershipId: 'old-a', StudentRef: 'TEST/001', ClassId: 'grade-10', ArmId: 'reserved',
      Status: 'Archived', SupersededByMembershipId: 'kept-a', SupersededAt: '2026-10-23T10:15:00Z', SupersededReason: 'Duplicate removed after confirmed arm transfer. Scores and records preserved.' },
    { ...scope, MembershipId: 'kept-a', StudentRef: 'TEST/001', ClassId: 'grade-10', ArmId: 'perfection', Status: 'Active' },
    { ...scope, MembershipId: 'old-b', StudentRef: 'TEST/002', ClassId: 'grade-10', ArmId: '',
      Status: 'Archived', SupersededByMembershipId: 'kept-b', SupersededAt: '2026-10-22T08:00:00Z', SupersededReason: 'Duplicate allocation resolved.' },
    { ...scope, MembershipId: 'kept-b', StudentRef: 'TEST/002', ClassId: 'grade-10', ArmId: 'reserved', Status: 'Withdrawn' }
  ];
  const data = {
    sections: ['secondary'], permissions: { canManageAllocations: true },
    students: [{ StudentRef: 'TEST/001', StudentName: 'Ada Test' }, { StudentRef: 'TEST/002', StudentName: 'Bayo Example' }],
    sessions: [{ SessionId: 'session', Name: '2026/2027' }], terms: [{ TermId: 'term', SessionId: 'session', Name: 'First Term' }],
    classes: [{ ClassId: 'grade-10', Name: 'Grade 10' }],
    arms: [{ ArmId: 'reserved', Name: 'Reserved' }, { ArmId: 'perfection', Name: 'Perfection' }],
    studentMemberships: members
  };
  return { data, rows: structuredClone(data) };
}

export function evaluate(expression, input = fixture()) {
  return runInNewContext(`${runtime}\n${expression}`, { ...input });
}
