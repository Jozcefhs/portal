import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { withStudentDisplayName } from '../functions/lib/student-display-name.js';
import { displayNameForProfile } from '../functions/api/admin.js';
import { studentSearchCard, studentDetailProjection, recordMatches } from '../functions/lib/records-desk.js';

const scopeSource = await readFile(new URL('../functions/lib/school-scope.js', import.meta.url), 'utf8');
const recordsSource = await readFile(new URL('../functions/api/staff-records.js', import.meta.url), 'utf8');
const executiveSource = await readFile(new URL('../functions/lib/executive-correspondence.js', import.meta.url), 'utf8');
const clean = (value) => String(value ?? '').trim();
const corrected = Object.freeze({
  __id: 'DCA-26-047', __name: 'schoolBranches/main/sections/secondary/students/DCA-26-047',
  AdmissionNo: 'DCA/26/047', AccountRef: 'DCA/26/047', BranchId: 'main', SchoolSection: 'secondary',
  Surname: 'James', FirstName: 'Daniel', MiddleName: '', DisplayName: '#NAME? James Daniel',
  ApplicantName: '#NAME? James Daniel', StudentName: '#NAME? James Daniel',
  ClassName: 'Grade 7', ClassArm: 'Radiance', ParentEmail: 'parent@example.com',
  UpdatedAt: '2026-10-06T12:00:00Z', WalletPinHash: 'private', PasswordHash: 'private'
});

function functionSource(source, name, next) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end).replace('export async function', 'async function');
}

function scopedReads(profile, sources) {
  const calls = [];
  const paths = Object.keys(sources);
  const context = {
    clean, withStudentDisplayName,
    accessScope: (scope) => scope,
    schoolCollectionPaths: async () => paths,
    legacyRowAllowed: (row, scope) => (!scope.branchId || row.BranchId === scope.branchId)
      && (!scope.schoolSectionAccess || scope.schoolSectionAccess === 'All' || row.SchoolSection === scope.schoolSectionAccess),
    listCollection: async (_env, path) => { calls.push(['list', path]); return sources[path]; },
    getDocument: async (_env, collection, id) => {
      calls.push(['get', collection, id]);
      return collection === 'settings' ? profile : sources[collection].find((row) => row.__id === id) || null;
    }
  };
  const listStart = scopeSource.indexOf('export async function listSchoolCollection(');
  const listEnd = scopeSource.indexOf('export async function schoolCollectionPaths(', listStart);
  const byIdStart = scopeSource.indexOf('export async function getSchoolDocumentsById(');
  const byIdEnd = scopeSource.indexOf('export async function getSchoolDocumentById(', byIdStart);
  const source = `${scopeSource.slice(listStart, listEnd)}\n${scopeSource.slice(byIdStart, byIdEnd)}`.replaceAll('export async function', 'async function');
  const readers = runInNewContext(`${source}\n({ listSchoolCollection, getSchoolDocumentsById })`, context);
  return { ...readers, calls };
}

test('corrected profile parts replace stale imported name aliases without rewriting stored data', () => {
  const before = JSON.stringify(corrected);
  const row = withStudentDisplayName(corrected);
  assert.equal(row.DisplayName, 'James Daniel');
  assert.equal(row.ApplicantName, row.DisplayName);
  assert.equal(row.StudentName, row.DisplayName);
  for (const field of ['__id', '__name', 'AdmissionNo', 'AccountRef', 'BranchId', 'SchoolSection', 'UpdatedAt']) {
    assert.equal(row[field], corrected[field]);
  }
  assert.equal(JSON.stringify(corrected), before);
});

test('directory names agree with Students for all supported configured orders and field aliases', () => {
  for (const format of ['Surname, first name, middle name', 'Surname, middle name, first name',
    'First name, surname, middle name', 'First name, middle name, surname',
    'Middle name, surname, first name', 'Middle name, first name, surname']) {
    const profile = { NameFormat: format };
    const row = { ...corrected, MiddleName: 'Grace' };
    assert.equal(withStudentDisplayName(row, profile).DisplayName, displayNameForProfile(row, profile, row.DisplayName));
  }
  assert.equal(withStudentDisplayName({ givenName: 'Daniel', otherName: 'Grace', familyName: 'James' }).DisplayName, 'James Daniel Grace');
});

test('unsplit legacy names and legitimate punctuation are preserved, never guessed or stripped', () => {
  for (const row of [{ DisplayName: 'Dr A. James' }, { ApplicantName: 'Daniel James' }, { StudentName: 'Daniel James' }]) {
    assert.equal(withStudentDisplayName(row).DisplayName, Object.values(row)[0]);
  }
  assert.equal(withStudentDisplayName({ Surname: '#James', FirstName: 'Daniel' }).DisplayName, '#James Daniel');
  assert.deepEqual(withStudentDisplayName({ AdmissionNo: 'DCA/26/048' }), { AdmissionNo: 'DCA/26/048' });
});

test('scoped lists and exact lookups use current names while preserving branch and section isolation', async () => {
  const otherBranch = { ...corrected, BranchId: 'other', DisplayName: 'Private branch name' };
  const primary = { ...corrected, SchoolSection: 'primary' };
  const sources = { students: [otherBranch, primary], 'schoolBranches/main/sections/secondary/students': [corrected] };
  const profile = { NameFormat: 'First name, middle name, surname' };
  const readers = scopedReads(profile, sources);
  const scope = { branchId: 'main', schoolSectionAccess: 'secondary' };
  const rows = await readers.listSchoolCollection({}, 'students', scope);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].DisplayName, 'Daniel James');
  assert.equal(rows[0].__scopePath, 'schoolBranches/main/sections/secondary/students');
  assert.equal(readers.calls.filter(([action, path]) => action === 'get' && path === 'settings').length, 1);
  const matches = await readers.getSchoolDocumentsById({}, 'students', corrected.__id, scope);
  assert.ok(matches.every((row) => row.DisplayName === 'Daniel James'));
  assert.equal(corrected.DisplayName, '#NAME? James Daniel');
});

test('the next read reflects changed profile parts or name format and does not cache formatted student names', async () => {
  const profile = { NameFormat: 'Surname, first name, middle name' };
  const sources = { students: [{ ...corrected }] };
  const readers = scopedReads(profile, sources);
  assert.equal((await readers.listSchoolCollection({}, 'students'))[0].DisplayName, 'James Daniel');
  sources.students[0].Surname = 'Corrected';
  profile.NameFormat = 'First name, middle name, surname';
  assert.equal((await readers.listSchoolCollection({}, 'students'))[0].DisplayName, 'Daniel Corrected');
});

test('non-student collections and historical invoice names are untouched and need no name-profile reads', async () => {
  const invoice = { ...corrected, Amount: 150000 };
  const readers = scopedReads({}, { invoices: [invoice] });
  const [row] = await readers.listSchoolCollection({}, 'invoices');
  assert.equal(row.DisplayName, '#NAME? James Daniel');
  assert.equal(row.Amount, 150000);
  assert.equal(readers.calls.some(([, path]) => path === 'settings'), false);
});

test('Records Desk search cards and detail headers use the corrected name without exposing credentials', () => {
  const row = withStudentDisplayName(corrected);
  const card = studentSearchCard(row);
  const detail = studentDetailProjection(row, { canViewStudentContact: true });
  assert.equal(card.title, 'James Daniel');
  assert.equal(detail.title, card.title);
  assert.equal(recordMatches(row, 'James Daniel', ['DisplayName', 'ApplicantName', 'StudentName']), true);
  assert.equal(recordMatches(row, '#NAME?', ['DisplayName', 'ApplicantName', 'StudentName']), false);
  assert.doesNotMatch(JSON.stringify({ card, detail }), /private|#NAME\?/);
  assert.match(recordsSource, /await listSchoolCollection\(env, 'students'/);
});

test('Principal Office directory results and new-document recipient tokens use corrected names', async () => {
  const readers = scopedReads({}, { students: [corrected] });
  const search = runInNewContext(`${functionSource(executiveSource, 'searchDirectory', 'async function authoritativeRecipientTokens(')}\nsearchDirectory`, {
    clean, lower: (value) => clean(value).toLowerCase(),
    listSchoolCollection: readers.listSchoolCollection,
    visibleSchoolRow: (row, scope) => row.BranchId === scope.branchId && row.SchoolSection === scope.schoolSection,
    requestedSearchTypes: () => ({ available: ['student'], selected: ['student'] }),
    searchText: (row) => Object.values(row).map(clean).join(' ').toLowerCase(),
    searchResult: (type, id, name, subtitle, email, address, row, tokenValues) => ({ type, id, name, subtitle, email, address, branchId: row.BranchId, tokenValues })
  });
  const result = await search({}, { query: 'james', type: 'student' }, { canSearchStudents: true }, { branchId: 'main', schoolSection: 'secondary' });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].name, 'James Daniel');
  assert.equal(result.results[0].tokenValues.RECIPIENT_NAME, 'James Daniel');
  assert.equal(result.results[0].tokenValues.STUDENT_NAME, 'James Daniel');
  assert.doesNotMatch(JSON.stringify(result), /private|#NAME\?/);
});
