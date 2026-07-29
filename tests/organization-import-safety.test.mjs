import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  stripFirestoreMetadata,
  validatedCsvImportRows
} from '../functions/lib/church-membership.js';

const [departmentSource, membershipSource] = await Promise.all([
  readFile(new URL('../functions/lib/organization-departments.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/church-membership.js', import.meta.url), 'utf8')
]);

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('CSV imports reject oversized files instead of silently truncating them', () => {
  const rows = Array.from({ length: 500 }, (_, index) => ({ id: index + 1 }));
  assert.throws(
    () => validatedCsvImportRows(rows, 'member'),
    (error) => error?.status === 400 && /at most 499 member rows/i.test(error.message)
  );
  assert.equal(validatedCsvImportRows(rows.slice(0, 499), 'member').length, 499);
  assert.throws(
    () => validatedCsvImportRows([], 'department'),
    /at least one department row/i
  );
});

test('existing Firestore transport metadata is removed before an imported row is merged', () => {
  const existing = {
    MemberId: 'MEM-001',
    DisplayName: 'Existing Member',
    CreatedAt: '2026-01-01T00:00:00.000Z',
    __id: 'MEM-001',
    __name: 'projects/demo/databases/(default)/documents/members/MEM-001',
    __createTime: '2026-01-01T00:00:00.000Z',
    __updateTime: '2026-01-02T00:00:00.000Z',
    __readTime: '2026-01-03T00:00:00.000Z',
    __transportEnvelope: { pageToken: 'secret' }
  };
  const sanitized = stripFirestoreMetadata(existing);

  assert.deepEqual(sanitized, {
    MemberId: 'MEM-001',
    DisplayName: 'Existing Member',
    CreatedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(existing.__id, 'MEM-001', 'sanitizing must not mutate the loaded record');
});

test('member and department imports fail closed when existing-record listing fails', () => {
  const departmentImport = between(
    departmentSource,
    'async function importDepartments',
    'async function deleteDepartment'
  );
  const memberImport = between(
    membershipSource,
    'export async function importChurchMembers',
    'export async function handleChurchMembershipAction'
  );

  assert.match(departmentImport, /await listCollection\(env, collectionPath\)/);
  assert.doesNotMatch(departmentImport, /listCollection\([^;]+\.catch\(\(\) => \[\]\)/s);
  assert.match(memberImport, /listCollection\(env, path\)/);
  assert.match(memberImport, /listCollection\(env, churchCollectionPath\(CHURCH_COLLECTIONS\.households, branchId\)\)/);
  assert.doesNotMatch(memberImport, /listCollection\([^;]+\.catch\(\(\) => \[\]\)/s);
  assert.doesNotMatch(departmentImport, /\.slice\(0,\s*499\)/);
  assert.doesNotMatch(memberImport, /\.slice\(0,\s*499\)/);
  assert.match(departmentImport, /\.\.\.stripFirestoreMetadata\(existing\)/);
  assert.match(memberImport, /\.\.\.stripFirestoreMetadata\(existing\)/);
});

test('department membership removal commits the delete and audit record atomically', () => {
  const removal = between(
    departmentSource,
    'async function removeDepartmentMember',
    'async function saveMeeting'
  );

  assert.match(removal, /await batchUpsertDocuments\(env,\s*\[/);
  assert.match(removal, /operation:\s*'delete'/);
  assert.match(removal, /auditWrite\s*\n\s*\]\)/);
  assert.doesNotMatch(removal, /await deleteDocument/);
  assert.match(removal, /existing\.__updateTime[\s\S]*updateTime:\s*existing\.__updateTime[\s\S]*exists:\s*true/);
});
