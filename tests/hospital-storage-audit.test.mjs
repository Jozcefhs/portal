import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { HOSPITAL_COLLECTIONS, hospitalCollectionPath } from '../functions/lib/hospital-storage.js';
import { requiredDeploymentIdentity } from '../functions/lib/deployment-identity.js';
import { STAFF_ATTENDANCE_COLLECTIONS, canonicalStaffAttendanceCollectionPath, legacyStaffAttendanceCollectionPath } from '../functions/lib/staff-attendance-storage.js';
import { auditWords, auditSentence, auditNarrative, auditActionContext } from '../functions/lib/audit-language.js';
import { fixture, env, request } from './helpers/hospital-fixture.mjs';

const read = path => readFile(new URL(`../functions/${path}`,import.meta.url),'utf8');
const unmodule = source => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm,'').replace(/^export /gm,'');
const backupSource = await read('lib/organization-backup.js'), auditSource = await read('lib/security-audit.js'), routeSource = await read('api/staff-hospital.js');
const plain = value => JSON.parse(JSON.stringify(value));

test('backup discovery includes every Hospital collection even when its parent document does not exist', async () => {
  const context = vm.createContext({requiredDeploymentIdentity,HOSPITAL_COLLECTIONS,hospitalCollectionPath,
    STAFF_ATTENDANCE_COLLECTIONS,canonicalStaffAttendanceCollectionPath,legacyStaffAttendanceCollectionPath,
    listRootCollectionIds:async()=>['settings'],getSchoolStructure:async()=>({Branches:[{Id:'main'}]})});
  vm.runInContext(unmodule(backupSource),context);
  const paths=(await context.organizationBackupDescriptors(env)).map(row=>row.path);
  for(const name of HOSPITAL_COLLECTIONS) assert.ok(paths.includes(hospitalCollectionPath(env,name)),name);
  const allowed=new Set(paths);
  assert.equal(context.restoreCollectionPathAllowed(hospitalCollectionPath(env,'Cards'),allowed,'hospital'),true);
  assert.equal(context.restoreCollectionPathAllowed('hospitalWorkspaces/another-hospital/hospitalPatients',allowed,'hospital'),false);
  assert.throws(()=>hospitalCollectionPath({...env,ORGANISATION_EDITION:'school'},'Patients'),/Invalid Hospital storage/);
});

test('Hospital registration/card/visit references survive backup serialization together', async () => {
  const f=fixture(),{PatientId}=await f.register(),patient=await f.details(PatientId);
  await f.service.assignCard(request({PatientId,Revision:patient.Revision,CardUid:'01020304'}));
  const visit=await f.service.checkIn(request({PatientId,Department:'Outpatients'}));
  const restored=new Map(JSON.parse(JSON.stringify([...f.store])));
  const person=restored.get(`${hospitalCollectionPath(env,'Patients')}/${PatientId}`);
  assert.equal(restored.get(`${hospitalCollectionPath(env,'Cards')}/${person.CardKey}`).PatientId,PatientId);
  assert.equal(restored.get(`${hospitalCollectionPath(env,'Visits')}/${visit.VisitId}`).PatientId,PatientId);
  assert.equal(restored.get(`${hospitalCollectionPath(env,'Numbers')}/${person.HospitalNumber}`).PatientId,PatientId);
  assert.equal([...restored].filter(([path])=>path.includes('/hospitalAudit/')).length,f.rows('Audit').length);
});

test('Hospital audit loads a dated, branch-scoped page and retains readable names', async () => {
  const calls=[],source=hospitalCollectionPath(env,'Audit');
  const context=vm.createContext({hospitalCollectionPath,auditWords,auditSentence,auditNarrative,auditActionContext,
    console,queryCollection:async(_env,path,options)=>{
      calls.push({path,options});
      return path===source?[{__id:'readable-event',Timestamp:'2026-10-26T12:00:00.000Z',Action:'Assign patient NFC card',Module:'Hospital',
        BranchId:'main',Subject:'Fixture Ada · H-0123456789ABCDEF',Actor:'Reception Officer',ActorUsername:'reception',Outcome:'Success'}]:[];
    }});
  vm.runInContext(unmodule(auditSource),context);
  const result=await context.loadAggregatedSecurityAudit(env,{fromDate:'2026-10-26',toDate:'2026-10-26',branchId:'main',paged:true});
  assert.equal(result.rows.length,1);assert.match(result.rows[0].Subject,/Fixture Ada/);
  const query=calls.find(call=>call.path===source);
  assert.ok(query.options.filters.some(filter=>filter.field==='BranchId'&&filter.value==='main'));
  assert.ok(query.options.filters.some(filter=>filter.field==='Timestamp'&&filter.op==='>='));
  assert.equal(query.options.limit,250);assert.equal(result.done,true);
  calls.length=0;
  await context.loadAggregatedSecurityAudit({...env,ORGANISATION_EDITION:'school'},{fromDate:'2026-10-26',toDate:'2026-10-26'});
  assert.ok(!calls.some(call=>call.path.startsWith('hospitalWorkspaces/')));
});

test('Hospital endpoint rejects unauthenticated, cross-site and mismatched-branch requests', async () => {
  let authenticated=true,executed=0;
  const context=vm.createContext({Response,URL,
    readJsonBody:request=>request.json(),
    requireStaffSession:async()=>{if(!authenticated)throw Object.assign(new Error('Sign in'),{status:401});return {};},
    createHospitalService:()=>({state:async()=>({ok:true}),search:async()=>{executed++;return {ok:true};}})});
  vm.runInContext(unmodule(routeSource),context);
  const call=async({origin='https://hospital.invalid',header='main',body={action:'search',BranchId:'main'}}={})=>{
    const data={};
    const response=await context.onRequestPost({env,data,request:new Request('https://hospital.invalid/api/staff-hospital',{
      method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Dynamax-Branch':header},body:JSON.stringify(body)})});
    return {response,data};
  };
  assert.equal((await call({origin:'https://other.invalid'})).response.status,403);
  assert.equal((await call({header:'north'})).response.status,403);
  authenticated=false;assert.equal((await call()).response.status,401);assert.equal(executed,0);
  authenticated=true;const result=await call();assert.equal(result.response.status,200);assert.equal(result.data.securityAuditHandled,true);
  assert.equal(result.response.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(plain(await result.response.json()),{ok:true});
});
