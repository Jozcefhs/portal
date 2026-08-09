import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sanitizeBackupDocument } from '../functions/lib/organization-backup.js';

const [backupLib, backupApi, firestore, backend, admin, styles, middleware, roleAccess, staffAuth] = await Promise.all([
  readFile(new URL('../functions/lib/organization-backup.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/data-backup.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/firestore.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/role-module-access.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/staff-auth.js', import.meta.url), 'utf8')
]);

test('backup discovery covers dynamic root collections and scoped organisation records', () => {
  assert.match(firestore, /export async function listRootCollectionIds/);
  assert.match(firestore, /documents:listCollectionIds/);
  assert.match(backupLib, /SCHOOL_SCOPED_COLLECTIONS[\s\S]*studentConductCases[\s\S]*studentConductAudit/);
  assert.match(backupLib, /Object\.values\(CHURCH_COLLECTIONS\)/);
  assert.match(backupLib, /settings\/academics\/classes/);
  assert.match(backupLib, /EXCLUDED_ROOT_COLLECTIONS[\s\S]*requestIdempotency[\s\S]*staffPasskeyChallenges/);
});

test('settings secrets are excluded while stable document identities remain restorable', () => {
  assert.deepEqual(sanitizeBackupDocument('settings', {
    __id: 'schoolProfile',
    __name: 'projects/example/documents/settings/schoolProfile',
    SchoolName: 'Example School',
    BrevoApiKey: 'secret-value',
    AccessToken: 'token-value'
  }), {
    __id: 'schoolProfile',
    SchoolName: 'Example School',
    __redactedFields: ['BrevoApiKey', 'AccessToken']
  });
});

test('restore is Super-Administrator-only, identity-bound and safety-backed', () => {
  assert.match(backupApi, /requireStaffSession/);
  assert.match(backupApi, /Only a Super Administrator can back up or restore/);
  assert.match(backupLib, /BACKUP_SAFETY_REQUIRED/);
  assert.match(backupLib, /BACKUP_IDENTITY_MISMATCH/);
  assert.match(backupLib, /Firestore removes a collection from discovery when its final document is/);
  assert.match(backupLib, /schoolBranches\\\/\[a-z0-9\._-\]\+/);
  assert.match(backupLib, /path === 'staffUsers'[\s\S]*actor\.username/);
  assert.match(backupLib, /IDENTITY_SETTING_FIELDS/);
  assert.match(backupLib, /Status: 'Completed'/);
  assert.match(middleware, /'\/api\/data-backup'/);
});

test('web companion encrypts downloads and requires typed confirmation before restore', () => {
  assert.match(admin, /dataBackup.*Backup & Restore/);
  assert.match(admin, /PBKDF2/);
  assert.match(admin, /AES-GCM/);
  assert.match(admin, /pre-restore-safety-backup/);
  assert.match(admin, /Type RESTORE to continue/);
  assert.match(admin, /clear-collection/);
  assert.match(admin, /write-collection/);
  assert.match(styles, /\.data-backup-workspace/);
  assert.match(styles, /@media\(max-width:560px\)[\s\S]*\.data-backup-card/);
});

test('desktop export uses the complete shared catalogue and exposes restore transport actions', () => {
  assert.match(backend, /case 'exportBackup'[\s\S]*exportOrganizationBackupPage/);
  assert.match(backend, /case 'prepareRestoreBackup'/);
  assert.match(backend, /case 'clearRestoreCollection'/);
  assert.match(backend, /case 'writeRestoreCollection'/);
  assert.match(backend, /case 'completeRestoreBackup'/);
});

test('Backup & Restore is mandatory for Super Administrators in every edition', () => {
  assert.match(roleAccess, /key: 'dataBackup', label: 'Backup & Restore'/);
  assert.match(roleAccess, /if \(!normalized\.includes\('dataBackup'\)\) normalized\.push\('dataBackup'\)/);
  assert.match(staffAuth, /configured\.includes\('dataBackup'\)/);
});
