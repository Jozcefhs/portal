import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffSession, readStaffSession, verifyDesktopPassword } from '../functions/lib/staff-auth.js';
import { assertSchoolPasswordOwner, enrollSchoolSetupPassword, schoolSetupEnrollmentRequired } from '../functions/lib/school-setup-password.js';
import { wholeRestorePathAllowed, isOrganizationResetProtectedPath } from '../functions/lib/organization-backup.js';
import { requireSetupAdministrator } from '../functions/lib/setup-auth.js';
import { onRequestGet, onRequestPost } from '../functions/api/settings.js';

const env = { DYNAMAX_WORKSPACE_ID: 'school-demo', ORGANISATION_EDITION: 'school',
  STAFF_SESSION_SECRET: 'test-fixture-signing-key', ADMIN_WEB_PASSWORD: 'test-fixture-setup-password' };
const url = 'https://school.example/api/settings';
test('a valid signed Super Admin session cannot open school settings without the setup password', async () => {
  const token = await createStaffSession(env, { username: 'school-admin', role: 'Super Admin' });
  for (const password of ['', 'incorrect']) {
    const request = new Request(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify({ action: 'load', password }) });
    assert.equal((await readStaffSession(env, request)).role, 'Super Admin');
    const res = await onRequestPost({ env, request });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.match(data.message, /setup password/i);
    assert.equal(data.profile, undefined);
  }
});
test('the configured setup password still unlocks a fresh school page', async () => {
  const actor = await requireSetupAdministrator(env, new Request(url), env.ADMIN_WEB_PASSWORD);
  assert.equal(actor.source, 'setup-password');
});
test('the public unlock policy uses the deployment edition and returns only the policy', async () => {
  for (const edition of ['school','faith','organization']) {
    const res = await onRequestGet({ env: { ...env, ORGANISATION_EDITION: edition },
      request: new Request(url+'?unlockPolicy=1&edition=organization') });
    assert.deepEqual(await res.json(), { edition, requireSetupPassword: edition === 'school', enrollmentRequired: false });
  }
});
test('only an unrestricted school Super Administrator can create the first credential', () => {
  for (const actor of [{role:'Teacher'}, {role:'Super Admin', branchAccess:'selected', assignedBranchIds:['main']},
    { role:'Super Admin', schoolSectionAccess:'Primary' }]) {
    assert.throws(() => assertSchoolPasswordOwner(actor), { status: 403 });
  }
});
test('first setup requires current staff password and creates one school-scoped salted verifier under concurrent retries', async () => {
  const school = { ...env, ADMIN_WEB_PASSWORD:'' };
  const request = new Request(url, {headers:{Origin:new URL(url).origin}});
  const actor = { role:'Super Admin', branchAccess:'all', username:'owner', schoolSectionAccess:'All' };
  const auth = { requireStaffSession:async()=>actor, verifyStaffApprovalPassword:async (_env,user,pw)=>user==='owner' && pw==='staff-only',
    checkStaffLoginAllowed:async()=>({allowed:true}), recordStaffLoginFailure:async()=>{} };
  const docs = new Map();
  const db = { getDocument:async (_env,col,id)=>docs.get(col+'/'+id),
    createDocumentIfAbsent:async (_env,col,id,data)=>{
      if (docs.has(col+'/'+id)) return { created:false };
      docs.set(col+'/'+id,data); return { created:true };
    } };
  const body = {staffPassword:'staff-only', newPassword:'private setup credential'};
  const enroll = input => enrollSchoolSetupPassword(school,request,input,db,auth);
  assert.equal(await schoolSetupEnrollmentRequired(school,db),true);
  await assert.rejects(enroll({...body,staffPassword:'incorrect'}),{status:403});
  await assert.rejects(enrollSchoolSetupPassword(env,request,body,db,auth),{status:409});
  assert.equal(docs.size,0);
  const attempts=await Promise.allSettled([enroll(body),enroll(body)]);
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(attempts.find(r=>r.status==='rejected').reason.status,409);
  assert.equal(await schoolSetupEnrollmentRequired(school,db),false);
  const saved=docs.get('schoolSetupCredentials/school-demo');
  assert.equal(await verifyDesktopPassword(saved,body.newPassword),true);
  assert.equal(await verifyDesktopPassword(saved,'staff-only'),false);
  assert.ok(!JSON.stringify(saved).includes(body.newPassword));
  assert.equal(wholeRestorePathAllowed('schoolSetupCredentials',{edition:'school'}),false);
  assert.equal(isOrganizationResetProtectedPath('schoolSetupCredentials'),true);
});
