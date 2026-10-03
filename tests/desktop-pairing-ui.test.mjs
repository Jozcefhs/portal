import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const portalRoot = new URL('../', import.meta.url);

test('desktop setup presents remote approval as the primary pairing workflow', async () => {
  const html = await readFile(new URL('admin.html', portalRoot), 'utf8');

  assert.match(html, /id="staffDesktopRequests"/);
  assert.match(html, /choose the branch that computer is allowed to use/i);
  assert.match(html, /connects automatically[^<]*revocable[^<]*branch-bound credential/i);
  assert.match(html, /Legacy one-time code for older desktop builds/);
});

test('desktop setup lists branch scopes and can approve or reject pending requests', async () => {
  const javascript = await readFile(new URL('js/admin.js', portalRoot), 'utf8');

  assert.match(javascript, /renderDesktopPairingRequests\(data\.requests \|\| \[\], branches\)/);
  assert.match(javascript, /Choose an authorised scope/);
  assert.match(javascript, /value="__organisation_wide__"[^>]*>Organisation-wide \(all branches\)<\/option>/);
  assert.match(javascript, /if \(approving && !selectedScope\)/);
  assert.match(javascript, /const organisationWide = selectedScope === '__organisation_wide__'/);
  assert.match(javascript, /organisationWide \? \{ organisationWide: true \} : \{ branchId \}/);
  assert.doesNotMatch(javascript, /branchId:\s*branchId \|\| null/);
  assert.match(javascript, /desktopPairingRequest\(approving \? 'approve' : 'reject'/);
  assert.match(javascript, /Reference: <code>/);
  assert.match(javascript, /Scope: \$\{escapeHtml\(branchLabel\)\}/);
});

test('pending desktop requests refresh while the dialog is open and stop when it closes', async () => {
  const javascript = await readFile(new URL('js/admin.js', portalRoot), 'utf8');

  assert.match(javascript, /window\.setInterval\(async \(\) =>/);
  assert.match(javascript, /if \(!desktopSetupDialog\.open \|\| desktopSetupRefreshBusy\) return/);
  assert.match(javascript, /desktopSetupDialog\.addEventListener\('close', stopDesktopSetupRefresh\)/);
  assert.match(javascript, /selectedScopes/);
});

test('automatic desktop refresh pauses for hidden pages and stops when the staff session is gone', async () => {
  const source = await readFile(new URL('js/admin.js', portalRoot), 'utf8');
  let refresh;
  let loads = 0;
  let stopped = 0;
  const context = vm.createContext({
    desktopSetupRefreshTimer: 0, desktopSetupRefreshBusy: false,
    desktopSetupDialog: { open: true }, currentUser: { role: 'Super Admin' },
    document: { hidden: false, getElementById: () => ({ contains: () => false }) },
    canManageOrganisationSettings: (user) => user.role === 'Super Admin',
    loadDesktopDevices: async () => { loads += 1; },
    window: { setInterval: (callback) => { refresh = callback; return 1; }, clearInterval: () => { stopped += 1; } }
  });
  vm.runInContext(source.slice(source.indexOf('function stopDesktopSetupRefresh('), source.indexOf('async function openDesktopSetup(')), context);
  vm.runInContext('startDesktopSetupRefresh()', context);
  context.document.hidden = true;
  await refresh();
  assert.equal(loads, 0);
  context.document.hidden = false;
  await refresh();
  assert.equal(loads, 1);
  context.currentUser = null;
  await refresh();
  assert.equal(loads, 1);
  assert.equal(stopped, 1);
  assert.equal(context.desktopSetupRefreshTimer, 0);
});

test('unauthorized desktop refresh closes the dialog and stops retries on the first response', async () => {
  const source = await readFile(new URL('js/admin.js', portalRoot), 'utf8');
  for (const status of [401, 403]) {
    let stopped = 0;
    let signedOut = 0;
    const dialog = { open: true, close() { this.open = false; } };
    const context = vm.createContext({
      staffFetch: async () => ({ status, ok: false, json: async () => ({ ok: false, message: 'Access expired' }) }),
      stopDesktopSetupRefresh: () => { stopped += 1; }, desktopSetupDialog: dialog,
      showLogin: () => { signedOut += 1; }
    });
    vm.runInContext(source.slice(source.indexOf('async function desktopPairingRequest('), source.indexOf('function normalizeDesktopPairingBranches(')), context);
    await assert.rejects(vm.runInContext("desktopPairingRequest('list')", context), /Access expired/);
    assert.equal(stopped, 1);
    assert.equal(dialog.open, false);
    assert.equal(signedOut, status === 401 ? 1 : 0);
  }
});
