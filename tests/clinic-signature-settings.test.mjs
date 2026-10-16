import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
test('clinic access exposes personal signature settings without finance approval privileges', async () => {
  const snippet = admin.slice(admin.indexOf('approvalSettingsButton.hidden = !('), admin.indexOf('paymentSettingsButton.hidden', admin.indexOf('approvalSettingsButton.hidden = !(')));
  for (const [user, visible] of [
    [{ role: 'Clinic Officer', edition: 'school', allowedSections: ['clinic'] }, true],
    [{ role: 'Teacher', edition: 'school', allowedSections: ['academics'] }, false],
    [{ role: 'Teacher', edition: 'faith', allowedSections: ['clinic'] }, false],
    [{ role: 'Super Admin' }, true], [{ role: 'Accounts Officer' }, true], [{ approvalEnabled: true }, true]
  ]) {
    const context = vm.createContext({ user, isExecutiveRole: false, approvalSettingsButton: {} });
    vm.runInContext(snippet, context);
    assert.equal(context.approvalSettingsButton.hidden, !visible);
  }
  const ui = await readFile(new URL('../js/clinic-referrals.js', import.meta.url), 'utf8');
  assert.match(ui, /My signature settings/);
  assert.match(admin, /openSignatureSettings: openApprovalSettings/);
  assert.match(ui, /No saved signature applied/);
});

test('older WebP signatures convert to PNG on an explicit settings save', async () => {
  let requestedFormat;
  const context = vm.createContext({
    Image: class { width = 900; height = 300; set src(_) { this.onload(); } },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: format => {
      requestedFormat = format; return `data:${format};base64,TEST`;
    } }) }
  });
  vm.runInContext(admin.slice(admin.indexOf('async function approvalImageDataUrl('), admin.indexOf('async function profilePhotoDataUrl(')), context);
  const result = await vm.runInContext("approvalImageDataUrl('data:image/webp;base64,UklGRg==', 'image/png')", context);
  assert.equal(requestedFormat, 'image/png');
  assert.equal(result, 'data:image/png;base64,TEST');
  assert.match(admin, /approvalImageDataUrl\(file, kind === 'signature' \? 'image\/png'/);
  const save = admin.slice(admin.indexOf("approvalSettingsForm.addEventListener('submit'"), admin.indexOf("document.getElementById('financeDecisionClose')"));
  assert.match(save, /approvalImageDataUrl\(approvalAssetState.signature, 'image\/png'\)/);
  assert.ok(save.indexOf('approvalImageDataUrl') < save.indexOf("approvalProfileRequest('POST'"));
});
