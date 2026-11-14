import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,env,request,actor} from './helpers/hospital-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
import {hospitalPatientPortalAction} from '../functions/lib/hospital-patient-portal.js';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';
import {portalPassword} from '../functions/lib/hospital-portal-model.js';

import {portalEnv,password,portalFixture} from './helpers/hospital-portal-fixture.mjs';
const range={From:'2026-10-01',To:'2026-10-31'};
test('staff authorisation is scoped, deliberate, retry-safe and separate for patient/guardian',async()=>{
  const f=await portalFixture(),before=f.commits.length;
  assert.equal((await f.service.issuePatientPortalAccess(f.issue)).replayed,true);assert.equal(f.commits.length,before);
  await assert.rejects(f.service.issuePatientPortalAccess({...f.issue,RequestId:crypto.randomUUID()}),/already has an access/);
  await assert.rejects(f.service.issuePatientPortalAccess({...f.issue,ConfirmAuthority:false}),/authority/);
  await assert.rejects(f.service.patientPortalAccess(request({BranchId:'north',PatientId:f.PatientId})),/outside/);
  const cashier=createHospitalService(portalEnv,{...actor,role:'Hospital Cashier',allowedSections:['hospitalBilling']},f.db);
  await assert.rejects(cashier.patientPortalAccess(request({PatientId:f.PatientId})),/role/);
  const patientGrant=await f.service.issuePatientPortalAccess({...f.issue,Kind:'Patient',RequestId:crypto.randomUUID(),InvitationToken:'b'.repeat(64)});
  assert.notEqual(patientGrant.GrantId,f.access.GrantId);
  const listed=await f.service.patientPortalAccess(request({PatientId:f.PatientId}));assert.equal(listed.grants.length,2);
  assert.ok(!JSON.stringify(listed).includes('InvitationHash'));assert.ok(!JSON.stringify(f.rows('Operations')).includes('a'.repeat(64)));
});
test('one-use activation, hashed credentials, login retry and password verification',async()=>{
  const f=await portalFixture(),auth=await f.activate();assert.match(auth.cookieToken,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify([...f.store.values()]).includes(password));assert.ok(!JSON.stringify([...f.store.values()]).includes(auth.cookieToken));
  await assert.rejects(f.activate(),/Access is unavailable/);
  await assert.rejects(f.call({action:'login',AccessCode:f.access.AccessCode,Password:'wrong password supplied',RequestId:crypto.randomUUID()}),/Access is unavailable/);
  const login={action:'login',AccessCode:f.access.AccessCode,Password:password,RequestId:crypto.randomUUID()};
  const first=await f.call(login),events=f.rows('PortalEvents').length,sessions=f.rows('PortalSessions').length,again=await f.call(login);
  assert.equal(first.cookieToken,again.cookieToken);assert.equal(f.rows('PortalEvents').length,events);assert.equal(f.rows('PortalSessions').length,sessions);
  const c=await f.call({action:'context'},auth.cookieToken);assert.equal(c.access.Kind,'Guardian');assert.equal(f.queries.length,0);
});
test('invoices and receipts preserve finance, scope all reads, redact private fields and show allocation/refund balances',async()=>{
  const f=await portalFixture(),auth=await f.activate(),snapshot=JSON.stringify([...f.store.entries()].filter(([k])=>/hospital(Invoices|Payments|Funds)\//.test(k))),writes=f.commits.length;
  const invoices=await f.call({action:'invoices',...range},auth.cookieToken);assert.equal(invoices.rows.length,1);assert.equal(invoices.rows[0].BalanceCents,51000);
  const receipts=await f.call({action:'receipts',...range},auth.cookieToken);assert.equal(receipts.rows.length,2);assert.equal(receipts.rows[1].IsAllocation,true);
  const funds=await f.call({action:'deposits',...range},auth.cookieToken);assert.equal(funds.rows[0].AvailableCents,14000);
  const detail=await f.call({action:'document',DocumentType:'invoices',DocumentId:'invoice001'},auth.cookieToken);assert.equal(detail.document.Lines[0].Description,'Consultation');
  for(const word of ['Accounts','Coverage','ChargeId','private','MemberNumber','PatientId','BranchId'])assert.ok(!JSON.stringify(detail).includes(word),word);
  for(const doc of ['invoiceOther','invoiceNorth'])await assert.rejects(f.call({action:'document',DocumentType:'invoices',DocumentId:doc},auth.cookieToken),/not available/);
  await assert.rejects(f.call({action:'document',DocumentType:'receipts',DocumentId:'paymentHmo'},auth.cookieToken),/not available/);
  await assert.rejects(f.call({action:'invoices',...range,PatientId:'another-patient'},auth.cookieToken),/patient access/);
  assert.equal(f.commits.length,writes);assert.equal(snapshot,JSON.stringify([...f.store.entries()].filter(([k])=>/hospital(Invoices|Payments|Funds)\//.test(k))));
  for(const q of f.queries){assert.equal(q.limit,31);assert.ok(q.filters.some(x=>x.field==='PatientId'&&x.value===f.PatientId));assert.ok(q.filters.some(x=>x.field==='BranchId'&&x.value==='main'));}
});
test('date and cursor validation occurs before queries; pages are bounded and do not cross scope',async()=>{
  const f=await portalFixture(),auth=await f.activate();
  await assert.rejects(f.call({action:'invoices'},auth.cookieToken));await assert.rejects(f.call({action:'invoices',From:'2025-01-01',To:'2026-10-31'},auth.cookieToken),/93 days/);assert.equal(f.queries.length,0);
  for(let i=0;i<35;i++){const key='invoice'+String(i).padStart(4,'0');f.put('Invoices',key,{...f.invoice,InvoiceId:key});}
  const page=await f.call({action:'invoices',...range},auth.cookieToken);assert.equal(page.rows.length,30);assert.ok(page.next);
  const next=await f.call({action:'invoices',...range,Cursor:page.next},auth.cookieToken);assert.equal(next.rows.length,6);assert.equal(new Set([...page.rows,...next.rows].map(r=>r.DocumentId)).size,36);
  await assert.rejects(f.call({action:'receipts',...range,Cursor:page.next},auth.cookieToken),/first page/);
});
test('revocation/replacement ends all sessions without altering patient or finance records',async()=>{
  const f=await portalFixture(),auth=await f.activate(),person=await f.details(f.PatientId);
  const list=await f.service.patientPortalAccess(request({PatientId:f.PatientId}));
  const revoke=request({PatientId:f.PatientId,GrantId:f.access.GrantId,Revision:list.grants[0].Revision,Reason:'Guardian authority ended'});
  await f.service.revokePatientPortalAccess(revoke);const n=f.commits.length;await f.service.revokePatientPortalAccess(revoke);assert.equal(f.commits.length,n);
  await assert.rejects(f.call({action:'context'},auth.cookieToken),/Access is unavailable/);
  assert.deepEqual(await f.details(f.PatientId),person);
  const current=(await f.service.patientPortalAccess(request({PatientId:f.PatientId}))).grants[0];
  const renewed=await f.service.issuePatientPortalAccess({...f.issue,GrantId:current.GrantId,Revision:current.Revision,RequestId:crypto.randomUUID(),InvitationToken:'c'.repeat(64)});
  await assert.rejects(f.activate(),/Access is unavailable/);
  const newAuth=await f.call({action:'activate',AccessCode:renewed.AccessCode,InvitationToken:'c'.repeat(64),Password:password,RequestId:crypto.randomUUID()});
  assert.equal((await f.call({action:'context'},newAuth.cookieToken)).ok,true);await assert.rejects(f.call({action:'context'},auth.cookieToken),/Access is unavailable/);
});
test('logout, expiry, branch removal and subscription suspension fail closed',async()=>{
  const f=await portalFixture(),auth=await f.activate();await f.call({action:'logout'},auth.cookieToken);const n=f.commits.length;await f.call({action:'logout'},auth.cookieToken);assert.equal(f.commits.length,n);await assert.rejects(f.call({action:'context'},auth.cookieToken),/Access is unavailable/);
  const signed=await f.call({action:'login',AccessCode:f.access.AccessCode,Password:password,RequestId:crypto.randomUUID()});
  f.db.now=()=>new Date('2026-10-26T12:31:00Z');await assert.rejects(f.call({action:'context'},signed.cookieToken),/Access is unavailable/);
  f.db.now=()=>new Date('2026-10-26T12:00:00Z');f.db.staffAccessFor=async()=>({edition:'hospital',subscriptionActive:false});await assert.rejects(f.call({action:'context'},signed.cookieToken),/temporarily unavailable/);
  f.db.staffAccessFor=async()=>({edition:'hospital',allowedSections:['hospitalBilling']});const p=f.rows('Patients')[0];f.put('Patients',p.PatientId,{...p,AccessBranchIds:['north']});await assert.rejects(f.call({action:'context'},signed.cookieToken),/Access is unavailable/);
});
test('password change invalidates sessions; attempts are bounded; weak activation passwords rejected',async()=>{
  const f=await portalFixture();await assert.rejects(f.call({action:'activate',AccessCode:f.access.AccessCode,InvitationToken:f.issue.InvitationToken,Password:'short',RequestId:crypto.randomUUID()}),/12 to 128/);
  const auth=await f.activate();await f.call({action:'changePassword',CurrentPassword:password,Password:'A different fixture password!',RequestId:crypto.randomUUID()},auth.cookieToken);
  await assert.rejects(f.call({action:'context'},auth.cookieToken),/Access is unavailable/);
  await assert.rejects(f.call({action:'login',AccessCode:f.access.AccessCode,Password:password,RequestId:crypto.randomUUID()}),/Access is unavailable/);
  assert.ok((await f.call({action:'login',AccessCode:f.access.AccessCode,Password:'A different fixture password!',RequestId:crypto.randomUUID()})).cookieToken);
  for(let i=0;i<4;i++)await assert.rejects(f.call({action:'login',AccessCode:f.access.AccessCode,Password:'wrong fixture password!',RequestId:crypto.randomUUID()}));
  await assert.rejects(f.call({action:'login',AccessCode:f.access.AccessCode,Password:password,RequestId:crypto.randomUUID()}),/Too many/);
  const hash=await portalPassword(portalEnv,password);assert.equal(hash.PasswordVersion,1);assert.equal(hash.PasswordHash.length,64);
});
test('concurrent invitation activation has one winner and never duplicates the grant',async()=>{
  const f=await portalFixture(),out=await Promise.allSettled([f.activate(),f.activate()]);assert.equal(out.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows('PortalSessions').length,1);assert.equal(f.rows('PortalGrants').length,1);
});
