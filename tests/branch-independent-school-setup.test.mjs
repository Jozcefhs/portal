import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('branch classes use the academic catalogue while admission settings can inherit defaults', async () => {
  const [backend, desktop] = await Promise.all([
    readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
    readFile(new URL('../../suite/main.py', import.meta.url), 'utf8')
  ]);
  assert.match(backend, /organisationBranches\/\$\{safeScopeId\(branchId\)\}\/\$\{collectionName\}/);
  assert.match(backend, /saveBranchAcademicClassSetup/);
  assert.match(backend, /getBranchClassCatalogue/);
  assert.match(backend, /AdmissionSetupMode: 'inherit'/);
  assert.match(backend, /AdmissionSetupMode'.*'independent'/s);
  assert.match(backend, /case 'resetSchoolClasses'/);
  assert.match(backend, /case 'resetAdmissionClasses'/);
  assert.match(desktop, /text="Use Organisation Defaults"/);
  assert.match(desktop, /def school_setup_scope_payload\(\)/);
});

test('public admission flow carries the selected branch from class choice to application', async () => {
  const [classesApi, buyForm, payment, verification, application] = await Promise.all([
    readFile(new URL('../functions/api/admission-classes.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/buy-form.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/init-form-payment.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/verify-form-payment.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/submit-application.js', import.meta.url), 'utf8')
  ]);
  assert.match(classesApi, /availableBranches/);
  assert.match(buyForm, /admissionBranch/);
  assert.match(payment, /BranchId: branchId/);
  assert.match(payment, /metadata:[\s\S]*branchId/);
  assert.match(verification, /BranchId: branchId/);
  assert.match(application, /BranchId: branchId/);
  assert.match(application, /getAdmissionClasses\(env, \{ BranchId: branchId \}\)/);
});
