import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicalPortalFixture,clinician} from './helpers/hospital-portal-clinical-fixture.mjs';
import {request,actor} from './helpers/hospital-fixture.mjs';
import {portalEnv,password} from './helpers/hospital-portal-fixture.mjs';
import {createHospitalService} from '../functions/lib/hospital-service.js';
const range={From:'2026-10-01',To:'2026-10-31'};
const originals=f=>JSON.stringify([...f.store.entries()].filter(([k])=>['Orders','ReleasedReports','Admissions','DischargeSummaries','Patients','Invoices','Payments','Funds'].some(n=>k.includes('/hospital'+n+'/'))).map(([k,r])=>[k,Object.fromEntries(Object.entries(r).filter(([n])=>!n.startsWith('__')))]));
test('clinical access is opt-in per recipient; finance-only and other recipients see no medical documents',async()=>{
 const f=await clinicalPortalFixture(),auth=await f.activate();assert.deepEqual((await f.call({action:'investigations',...range},auth.cookieToken)).rows,[]);
 const p=await f.publishing(),published=await f.doctor.publishClinicalPortalDocument(p);
 assert.equal((await f.call({action:'investigations',...range},auth.cookieToken)).rows.length,1);
 const patient=await f.service.issuePatientPortalAccess({...f.issue,Kind:'Patient',InvitationToken:'b'.repeat(64),RequestId:crypto.randomUUID()}),second=await f.call({action:'activate',AccessCode:patient.AccessCode,InvitationToken:'b'.repeat(64),Password:password,RequestId:crypto.randomUUID()});
 assert.equal((await f.call({action:'investigations',...range},second.cookieToken)).rows.length,0);
 await assert.rejects(f.call({action:'document',DocumentType:'investigations',DocumentId:published.DocumentId},second.cookieToken),/not shared/);
 await assert.rejects(f.service.publishClinicalPortalDocument(p),/role/);
 await assert.rejects(f.doctor.publishClinicalPortalDocument({...p,ConfirmConsent:false}),/authority/);
 await assert.rejects(f.doctor.clinicalPortalContext({...f.scope(),BranchId:'north'}),/outside/);
});
test('publication retries and repeated views are idempotent; originals and financial records remain identical',async()=>{
 const f=await clinicalPortalFixture(),auth=await f.activate(),before=originals(f),p=await f.publishing(),r=await f.doctor.publishClinicalPortalDocument(p),count=f.commits.length;
 assert.equal((await f.doctor.publishClinicalPortalDocument(p)).replayed,true);assert.equal(f.commits.length,count);
 assert.equal((await f.doctor.publishClinicalPortalDocument(await f.publishing())).Unchanged,true);assert.equal(f.commits.length,count);
 const body={action:'document',DocumentType:'investigations',DocumentId:r.DocumentId};let doc=await f.call(body,auth.cookieToken);
 assert.equal(doc.document.Text,'Synthetic result. <script>never run</script>');assert.ok(!('Reason' in doc.document));assert.ok(!('SpecimenSnapshot' in doc.document));
 const writes=f.commits.length;await f.call(body,auth.cookieToken);assert.equal(f.commits.length,writes);assert.equal(originals(f),before);
 assert.equal(f.rows('PortalClinicalDocuments').length,1);assert.equal(f.rows('PortalClinicalEvents').filter(r=>r.Action.startsWith('View')).length,1);
});
test('draft, unverified, pending critical reports and incomplete discharges cannot be exposed',async()=>{
 for(const change of ['draft','unverified','critical','inpatient']){
  const f=await clinicalPortalFixture(),type=change==='inpatient'?'discharges':'investigations';
  if(change==='draft')f.put('Orders','order001',{...f.rows('Orders')[0],Status:'Result draft',LatestReportId:'report002'});
  if(change==='unverified')f.put('ReleasedReports','report001',{...f.rows('ReleasedReports')[0],VerifiedBy:''});
  if(change==='critical')f.put('ReleasedReports','report001',{...f.rows('ReleasedReports')[0],Critical:true});
  if(change==='inpatient')f.put('Admissions','admit001',{...f.rows('Admissions')[0],Status:'Admitted'});
  assert.equal((await f.doctor.clinicalPortalContext(f.scope(type))).ready,false);
  await assert.rejects(f.doctor.publishClinicalPortalDocument(await f.publishing(type)),e=>e.status===409);
  assert.equal(f.rows('PortalClinicalDocuments').length,0);
 }
});
test('acknowledged critical result can be released but acknowledgement must match its patient and branch',async()=>{
 const f=await clinicalPortalFixture();f.put('ReleasedReports','report001',{...f.rows('ReleasedReports')[0],Critical:true});
 f.put('CriticalAlerts','report001',{PatientId:f.PatientId,BranchId:'north',OrderId:'order001',Status:'Acknowledged'});
 assert.equal((await f.doctor.clinicalPortalContext(f.scope())).ready,false);
 f.put('CriticalAlerts','report001',{PatientId:f.PatientId,BranchId:'main',OrderId:'order001',Status:'Acknowledged'});
 assert.equal((await f.doctor.clinicalPortalContext(f.scope())).ready,true);await f.doctor.publishClinicalPortalDocument(await f.publishing());
});
test('withdrawal and amendments stop old views; republishing changes one pointer and preserves versions',async()=>{
 const f=await clinicalPortalFixture(),auth=await f.activate(),r=await f.doctor.publishClinicalPortalDocument(await f.publishing('discharges'));
 const b={action:'document',DocumentType:'discharges',DocumentId:r.DocumentId};assert.equal((await f.call(b,auth.cookieToken)).document.Diagnosis,'Synthetic diagnosis');
 f.put('DischargeSummaries','summary002',{...f.rows('DischargeSummaries')[0],SummaryId:'summary002',PreviousSummaryId:'summary001',Type:'Post-discharge amendment',Diagnosis:'Corrected synthetic diagnosis'});
 f.put('Admissions','admit001',{...f.rows('Admissions')[0],LatestDischargeSummaryId:'summary002'});
 await assert.rejects(f.call(b,auth.cookieToken),/superseded/);await f.doctor.publishClinicalPortalDocument(await f.publishing('discharges'));
 assert.equal(f.rows('PortalClinicalDocuments').length,1);assert.equal(f.rows('DischargeSummaries').length,2);assert.equal((await f.call(b,auth.cookieToken)).document.Amendment,true);
 const sharing=await f.doctor.clinicalPortalSharing(f.scope('discharges')),withdraw={...f.scope('discharges'),Revision:sharing.publication.Revision,Reason:'Patient withdrew consent'};
 await f.doctor.withdrawClinicalPortalDocument(withdraw);await assert.rejects(f.call(b,auth.cookieToken),/not shared/);
 assert.equal((await f.call({action:'discharges',...range},auth.cookieToken)).rows.length,0);
 const n=f.commits.length;await f.doctor.withdrawClinicalPortalDocument(withdraw);assert.equal(f.commits.length,n);
});
test('password changes retain consent, reissued access does not inherit clinical permission',async()=>{
 const f=await clinicalPortalFixture(),auth=await f.activate();await f.doctor.publishClinicalPortalDocument(await f.publishing());
 await f.call({action:'changePassword',CurrentPassword:password,Password:password+' new',RequestId:crypto.randomUUID()},auth.cookieToken);
 const login=await f.call({action:'login',AccessCode:f.access.AccessCode,Password:password+' new',RequestId:crypto.randomUUID()});
 assert.equal((await f.call({action:'investigations',...range},login.cookieToken)).rows.length,1);
 const g=f.rows('PortalGrants')[0];await f.service.issuePatientPortalAccess({...f.issue,GrantId:g.GrantId,Revision:g.__updateTime,InvitationToken:'c'.repeat(64),RequestId:crypto.randomUUID()});
 const next=await f.call({action:'activate',AccessCode:f.access.AccessCode,InvitationToken:'c'.repeat(64),Password:password,RequestId:crypto.randomUUID()});
 assert.equal((await f.call({action:'investigations',...range},next.cookieToken)).rows.length,0);
});
test('clinical lists are bounded, scoped, date requested, read-only and use authenticated cursor scope',async()=>{
 const f=await clinicalPortalFixture(),auth=await f.activate();await f.doctor.publishClinicalPortalDocument(await f.publishing());
 const r=f.rows('PortalClinicalDocuments')[0];for(let n=0;n<35;n++){const DocumentId='published'+String(n).padStart(3,'0');f.put('PortalClinicalDocuments',DocumentId,{...r,DocumentId});}
 const commits=f.commits.length,first=await f.call({action:'investigations',...range},auth.cookieToken);assert.equal(first.rows.length,30);assert.ok(first.next);
 const next=await f.call({action:'investigations',...range,Cursor:first.next},auth.cookieToken);assert.equal(next.rows.length,6);assert.equal(new Set([...first.rows,...next.rows].map(r=>r.DocumentId)).size,36);assert.equal(f.commits.length,commits);
 const q=f.queries.at(-1);assert.equal(q.limit,31);assert.ok(q.filters.some(f=>f.field==='GrantId'));assert.ok(q.filters.some(f=>f.field==='PublishedAt'));
 const count=f.queries.length;await assert.rejects(f.call({action:'discharges',...range,Cursor:first.next},auth.cookieToken),/first page/);await assert.rejects(f.call({action:'investigations',From:'2026-01-01',To:'2026-10-31'},auth.cookieToken),/93 days/);assert.equal(f.queries.length,count);
});
test('stale review and concurrent publication fail safely without duplicate documents or history',async()=>{
 const f=await clinicalPortalFixture(),p=await f.publishing();f.put('Orders','order001',{...f.rows('Orders')[0],Status:'Result draft'});
 await assert.rejects(f.doctor.publishClinicalPortalDocument(p),e=>e.status===409);assert.equal(f.rows('PortalClinicalDocuments').length,0);
 f.put('Orders','order001',{...f.rows('Orders')[0],Status:'Released'});const fresh=await f.publishing();
 const results=await Promise.allSettled([f.doctor.publishClinicalPortalDocument(fresh),f.doctor.publishClinicalPortalDocument({...fresh,RequestId:crypto.randomUUID()})]);
 assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(f.rows('PortalClinicalDocuments').length,1);assert.equal(f.rows('PortalClinicalEvents').filter(r=>r.Action==='Publish clinical portal document').length,1);
});
