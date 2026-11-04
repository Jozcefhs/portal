// Synthetic staff only. Every network route is blocked; no real account is changed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
const declarations = ['clean', 'lower', 'escapeHtml', 'setStatus', 'setButtonLoading', 'newIdempotencyKey', 'yes', 'canManageOrganisationSettings', 'staffMfaAccount', 'staffMfaAccountLabel', 'canResetStaffBiometrics', 'staffBiometricRecoveryAction', 'openStaffBiometricRecovery', 'openStaffUserDialog'].map(extract).join('\n');
const dialogStart = source.indexOf('<dialog id="staffUserDialog"');
const actualStaffDialog = source.slice(dialogStart, source.indexOf('</dialog>', dialogStart) + 9);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body class="staff-page"><main id="panel"></main></body>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: `${declarations}\n
      let currentUser,selectedBranchId,staffSessionAbortController,activeSection,staffUsersData,staffMfaAdminData;
      const panelEl=document.getElementById('panel');
      const staffNameFormat='First name, surname',availableRoles=['Teacher'],defaultStaffRole='Teacher',staffBranchOptions='',schoolEdition=true,staffApprovalAccounts=[],permissionTabs=[];
      function syncStaffDisplayName(){} function setStaffBranchChecks(){} function syncSchoolLeadershipRoleOptions(){} function syncRequisitionEditPermission(){} function syncExternalAuditUserForm(){}
      function setFinancialInputValue(input,value){input.value=value;}
      window.reset=async(options={})=>{
        document.getElementById('staffBiometricRecoveryDialog')?.remove();document.getElementById('staffUserDialog')?.remove();
        currentUser={username:'owner',role:'Super Admin',subscriptionActive:true};selectedBranchId='main';activeSection='staffUsers';staffSessionAbortController=new AbortController();
        staffUsersData=[{Username:'permanent-key',LoginUsername:'updated.login@example.test',DisplayName:'Test Staff',Role:'Teacher',Active:true}];
        staffMfaAdminData={accounts:[{username:'permanent-key',totpActive:true,passkeyCount:2,recoveryCodesRemaining:3},{username:'other',passkeyCount:1}]};
        window.calls=[];window.options=options;window.confirmCalls=0;
        panelEl.innerHTML='<p id="staffUsersStatus"></p><article data-staff-user-row><span class="staff-mfa-account-state">Authenticator + 2 passkeys</span><div class="staff-user-actions has-recovery-action">'+staffBiometricRecoveryAction(staffUsersData[0])+'<button data-edit-user="permanent-key">Edit</button></div></article>'+\`${actualStaffDialog}\`;
        panelEl.querySelector('[data-recover-staff-biometrics]').onclick=event=>openStaffBiometricRecovery(event.currentTarget.dataset.recoverStaffBiometrics);
      };
      window.DynamaxDialogs={confirm:async()=>{window.confirmCalls++;await new Promise(r=>setTimeout(r,30));if(window.options.changeBranch)selectedBranchId='other';return !window.options.cancel;}};
      async function mfaRequest(action,body){window.calls.push({action,...body});await new Promise(r=>setTimeout(r,50));if(window.options.fail&&window.calls.length===1)throw Error('Response lost');return {ok:true,message:'Security methods revoked and sessions signed out.',reEnrollmentRequired:true,alreadyCompleted:window.options.fail===true};}
      window.reset();` });
    const open = () => page.locator('[data-recover-staff-biometrics]').click();
    const password = page.locator('#staffBiometricRecoveryDialog [name="currentPassword"]');
    const submit = page.locator('[data-submit-staff-recovery]');
    const fill = async () => { await password.fill('synthetic-admin-password'); await page.locator('[name="identityConfirmed"]').check(); };
    await open();
    assert.equal(await page.evaluate(() => calls.length), 0, 'Opening recovery makes no security status requests');
    assert.match(await page.locator('#staffBiometricRecoveryDialog').innerText(), /updated.login@example.test/);
    await submit.click(); assert.equal(await page.evaluate(() => confirmCalls), 0, 'Password and verified identity are required');
    await fill(); await submit.click();
    await submit.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => document.querySelector('[data-submit-staff-recovery]').textContent==='Recovery completed');
    assert.equal(await page.evaluate(() => calls.length), 1, 'Double click triggers only one reset');
    assert.equal(await page.evaluate(() => calls[0].targetUsername), 'permanent-key');
    assert.equal(await password.inputValue(), '', 'Administrator password is cleared');
    assert.equal(await page.locator('.staff-recovery-actions [data-close-staff-recovery]').textContent(), 'Close');
    assert.match(await page.locator('[data-staff-recovery-instructions]').innerText(), /current password.*Two-factor protection is required/);
    assert.equal(await page.locator('.staff-mfa-account-state').textContent(), 'Two-factor not enrolled');
    assert.equal(await page.evaluate(() => staffMfaAdminData.accounts[1].passkeyCount), 1);
    const dimensions = await page.locator('#staffBiometricRecoveryDialog').evaluate(el => ({scroll:el.scrollWidth,client:el.clientWidth,width:el.getBoundingClientRect().width}));
    assert.ok(dimensions.scroll<=dimensions.client+1 && dimensions.width<=width, `Recovery layout fits ${width}px: ${JSON.stringify(dimensions)}`);
    await page.locator('[data-staff-recovery-password]').click();
    const resetPassword = page.locator('#staffUserForm [name="Password"]');
    assert.equal(await page.locator('#staffUserDialog').evaluate(el=>el.open),true);
    assert.equal(await resetPassword.isVisible(),true);
    assert.equal(await resetPassword.evaluate(el=>document.activeElement===el),true);
    const box=await resetPassword.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=900, 'Actual Security password field is scrolled into view');
    assert.equal(await page.locator('#staffUserForm').getAttribute('data-original-username'),'permanent-key');
    assert.equal(await page.evaluate(() => calls.length),1, 'Opening password editor does not reload staff/security records');
    await page.evaluate(() => reset({fail:true})); await open(); await fill(); await submit.click();
    await page.waitForFunction(() => document.querySelector('[data-submit-staff-recovery]').textContent==='Retry same recovery');
    assert.equal(await password.inputValue(),'');assert.equal(await page.locator('[name="reason"]').evaluate(el=>el.readOnly),true);
    await password.fill('synthetic-admin-password');await submit.click();
    await page.waitForFunction(() => document.querySelector('[data-submit-staff-recovery]').textContent==='Recovery completed');
    const retries=await page.evaluate(()=>calls);
    assert.equal(retries.length,2);assert.equal(retries[0].operationId,retries[1].operationId);assert.equal(retries[0].reason,retries[1].reason);
    assert.equal(await page.evaluate(()=>staffMfaAdminData.accounts[0].passkeyCount),2,'A replay must not overwrite newer method information');
    assert.match(await page.locator('.staff-mfa-account-state').innerText(),/Refresh staff accounts for current security methods/);
    assert.match(await page.locator('[data-staff-recovery-status]').innerText(),/enrolled afterwards remain unchanged/);
    assert.match(retries[0].operationId,/^[A-Za-z0-9_-]{16,128}$/);
    for(const option of [{cancel:true},{changeBranch:true}]){
      await page.evaluate(value=>reset(value),option);await open();await fill();await submit.click();
      await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>calls.length),0,'Cancelled or changed-scope recovery does not call the backend');
    }
    await page.evaluate(()=>reset());await open();await password.fill('unsent-value');
    await page.locator('.staff-recovery-actions [data-close-staff-recovery]').click();await page.locator('#staffBiometricRecoveryDialog').waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>calls.length),0);
    assert.deepEqual(errors,[]);await page.close();
    console.log(`Staff recovery ${width}px passed: explicit action, canonical identity, confirmation, single reset, replay-safe retry, no extra reads, required MFA instructions, actual password editor and mobile layout.`);
  }
}finally{await browser.close();}
