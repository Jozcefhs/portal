import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

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
