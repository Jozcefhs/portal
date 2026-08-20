import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const portalRoot = new URL('../', import.meta.url);
const [adminJs, staffApi, adminHtml] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-admission-forms.js', portalRoot), 'utf8'),
  readFile(new URL('admin.html', portalRoot), 'utf8')
]);

test('form purchases workspace exposes a reusable admission purchase QR action', () => {
  assert.match(adminJs, /id="admissionFormPurchaseQrButton"/);
  assert.match(adminJs, /staffFetch\('\/api\/staff-admission-forms'/);
  assert.match(adminJs, /showAdmissionFormPurchaseQr\(result, viewer\)/);
  assert.match(adminJs, /Open purchase form/);
});

test('staff endpoint protects and generates the canonical public purchase QR', () => {
  assert.match(staffApi, /requireStaffSession\(env, request\)/);
  assert.match(staffApi, /edition !== 'school'/);
  assert.match(staffApi, /\['admissions', 'formPurchases'\]/);
  assert.match(staffApi, /const purchaseUrl = `\$\{origin\}\/buy-form\.html`/);
  assert.match(staffApi, /QRCode\.create\(clean\(value\)/);
  assert.match(staffApi, /'Cache-Control': 'no-store'/);
});

test('admin bundle cache key includes the current payment release', () => {
  assert.match(adminHtml, /js\/admin\.js\?v=20260820-academic-cbt-low-read/);
});
