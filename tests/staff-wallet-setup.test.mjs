import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { staffWalletPayload } from '../functions/api/staff-wallet.js';

test('staff wallet setup uses the authenticated working branch and school section', () => {
  const payload = staffWalletPayload({
    action: 'save',
    AccountRef: 'DCA/33/333',
    WalletCardId: '0003796740',
    WalletCardStatus: 'active',
    WalletPin: '1234',
    WalletPinThreshold: '1000',
    WalletTxnLimit: '2500',
    WalletDailyLimit: '5000',
    StudentScopePath: 'schoolBranches/another-branch/sections/secondary/students'
  }, {
    branchId: 'lords-garden',
    schoolSectionAccess: 'Primary',
    displayName: 'Branch Administrator'
  }, { action: 'save' });

  assert.equal(payload.BranchId, 'lords-garden');
  assert.equal(payload.UserBranchId, 'lords-garden');
  assert.equal(payload.SchoolSection, 'Primary');
  assert.equal(payload.WalletCardId, '0003796740');
  assert.equal(payload.WalletCardStatus, 'Active');
  assert.equal(payload.WalletUpdatedBy, 'Branch Administrator');
  assert.equal('StudentScopePath' in payload, false);
});

test('staff wallet setup requires one explicit working branch', () => {
  assert.throws(() => staffWalletPayload({ action: 'lookup', AccountRef: 'DCA/33/333' }, {
    branchId: '', activeBranchId: 'all', schoolSectionAccess: 'All'
  }, { action: 'lookup' }), /Select one working branch/);
});

test('staff wallet setup validates PIN and spending limits before persistence', () => {
  const user = { branchId: 'main', schoolSectionAccess: 'Secondary' };
  assert.throws(() => staffWalletPayload({
    AccountRef: 'DCA/33/333', WalletCardId: '123', WalletPin: '12AB'
  }, user, { action: 'save' }), /4 to 8 digits/);
  assert.throws(() => staffWalletPayload({
    AccountRef: 'DCA/33/333', WalletCardId: '123', WalletDailyLimit: '-1'
  }, user, { action: 'save' }), /positive amount/);
});

test('web companion exposes wallet setup without a redundant NFC scan button', async () => {
  const [adminJs, walletApi] = await Promise.all([
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/staff-wallet.js', import.meta.url), 'utf8')
  ]);

  assert.match(adminJs, /key: 'wallet', label: 'Wallet setup'/);
  assert.match(adminJs, /id="accountWalletSetupForm"/);
  assert.match(adminJs, /keyboard-mode readers enter the number automatically/);
  assert.doesNotMatch(adminJs, /id="accountWalletSetupNfc"/);
  assert.match(walletApi, /allowedSections \|\| \[\]\)\.includes\('accounts'\)/);
  assert.match(walletApi, /getWalletCardAccount/);
  assert.match(walletApi, /saveWalletCard/);
});

test('wallet-card lookup applies its requested branch scope', async () => {
  const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const lookupSource = backendSource.slice(
    backendSource.indexOf('async function findStudentByWalletCard'),
    backendSource.indexOf('export const STUDENT_ACCOUNT_REFERENCE_FIELDS')
  );
  assert.match(lookupSource, /requestedScope/);
  assert.match(lookupSource, /scope: requestedScope/);
  assert.match(backendSource, /findStudentByWalletCard\(env, cardId, requestedScope\)/);
  assert.match(backendSource, /walletActivityForAccount\(env, accountRef, normalized\)/);
  assert.match(backendSource, /rowBranch === branchId/);
  assert.match(backendSource, /findStudentByAccountRef\(env, accountRef, requestedScope, body\.StudentScopePath/);
  assert.match(backendSource, /cardStatus !== 'active'/);
});
