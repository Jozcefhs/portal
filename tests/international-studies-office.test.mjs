import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {executiveOfficeCapabilities, normalizeCorrespondenceDraft, normalizeTemplate, requestedExecutiveScope} from '../functions/lib/executive-correspondence.js';
import {rolesForEdition, defaultModulesForRole} from '../functions/lib/role-module-access.js';
const officer={role:'International Studies Officer',username:'studies',displayName:'Studies Officer',branchId:'main',schoolSectionAccess:'secondary'};
const scope={edition:'school',branchId:'main',schoolSection:'secondary',officeKey:'international-studies'};
const draft={Kind:'recommendation',Subject:'Study recommendation',Body:'Verified information',RecipientType:'student',RecipientId:'DCA/26/001',RecipientName:'Student'};

test('international studies is a school role with correspondence, not academic editing or finance approval',()=>{
  assert.ok(rolesForEdition('school').includes(officer.role));
  for(const edition of ['faith','organization']) {assert.ok(!rolesForEdition(edition).includes(officer.role));assert.equal(executiveOfficeCapabilities(officer,edition).enabled,false);}
  const modules=defaultModulesForRole(officer.role,'school');
  assert.ok(modules.includes('executiveOffice'));
  for(const key of ['academics','accounts','students','staffUsers','recordsDesk']) assert.ok(!modules.includes(key));
  const caps=executiveOfficeCapabilities(officer,'school');
  assert.ok(caps.canIssue && caps.canSend && caps.canSearchStudents);assert.equal(caps.canSearchStaff,false);
  assert.equal(executiveOfficeCapabilities({...officer,allowedSections:['payroll']},'school').enabled,false);
  assert.deepEqual(requestedExecutiveScope(officer,{},'school'),scope);
  assert.throws(()=>requestedExecutiveScope(officer,{branchId:'other'},'school'),/another branch/);
  assert.throws(()=>requestedExecutiveScope(officer,{schoolSection:'primary'},'school'),/another school section/);
});

test('office identity is trusted, draft restrictions apply to aliases and templates too',()=>{
  const record=normalizeCorrespondenceDraft({...draft,OfficeKey:'principal'},scope);
  assert.equal(record.OfficeKey,'international-studies');
  assert.throws(()=>normalizeCorrespondenceDraft({...draft,RecipientType:'staffusers'},scope),/parents and external/);
  assert.throws(()=>normalizeCorrespondenceDraft({...draft,Kind:'transfer-certificate'},scope),/head of school/);
  assert.throws(()=>normalizeTemplate({...draft,Name:'Transfer',Kind:'transfer-certificate'},scope),/head of school/);
  assert.equal(normalizeCorrespondenceDraft(draft,{...scope,officeKey:undefined,existing:record}).OfficeKey,'international-studies');
});

const source=(await readFile(new URL('../functions/lib/executive-correspondence.js',import.meta.url),'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?$/gm,'').replace(/\bexport /g,'');
function fixture(){
  const records=new Map(),reads=[],writes=[];
  const c=vm.createContext({crypto:webcrypto,URL,console,Date,
    requiredDeploymentIdentity:()=>({edition:'school'}),resolveOrganizationConfig:()=>({Edition:'school',Name:'School',Code:'SCH'}),
    effectiveBranchProfile:async()=>({}),getDocumentBranding:async()=>({}),getWebBranding:async()=>({}),
    documentBrandingMatchesDeployment:()=>true,webBrandingMatchesDeployment:()=>true,
    loadStaffApprovalProfile:async()=>({}),publicStaffApprovalProfile:()=>({}),loadStaffPosition:async()=>({IssuerTitle:'International Studies Officer'}),
    safeScopeId:s=>s,schoolSectionFor:r=>r.SchoolSection,
    getDocument:async(_env,path,id)=>{reads.push({path,id});return records.get(`${path}/${id}`)||null;},
    upsertDocument:async(_env,path,id,row)=>{writes.push({path,id,row});records.set(`${path}/${id}`,structuredClone(row));},
    listCollection:async(_env,path)=>{throw new Error(`Unrequested collection scan: ${path}`);},
    queryCollection:async(_env,path,options)=>{reads.push({path,options});return [...records.entries()].filter(([key])=>key.startsWith(`${path}/`)).map(([,r])=>r).filter(r=>options.filters.every(f=>r[f.field]===f.value)).slice(0,options.limit);}
  });vm.runInContext(source,c);
  return {records,reads,writes,run:body=>c.handleExecutiveOfficeAction({},officer,body)};
}

test('new office bootstrap reads only its scoped letters/templates and self settings; mutations stay isolated',async()=>{
  const f=fixture();
  f.records.set('executiveCorrespondence/principal',{CorrespondenceId:'principal',Edition:'school',BranchId:'main',SchoolSection:'secondary',Kind:'official-letter',Status:'Draft',Body:'Confidential'});
  f.records.set('executiveCorrespondence/other',{CorrespondenceId:'other',Edition:'school',BranchId:'other',SchoolSection:'secondary',OfficeKey:'international-studies',Status:'Draft'});
  const initial=await f.run({action:'bootstrap'});
  assert.equal(initial.correspondence.length,0);assert.equal(initial.classes.length,0);
  assert.deepEqual(Array.from(initial.metricPreferences),['issuedCorrespondence']);
  assert.ok(initial.templates.some(t=>t.TemplateId==='builtin-study-parent-letter'));
  assert.ok(!initial.kinds.some(k=>k.id==='transfer-certificate'));
  assert.equal(f.writes.length,0);
  const saved=await f.run({action:'saveDraft',...draft});
  const stored=f.records.get(`executiveCorrespondence/${saved.correspondence.CorrespondenceId}`);
  assert.equal(stored.OfficeKey,'international-studies');
  const again=await f.run({action:'list'});assert.equal(again.correspondence.length,1);
  const count=f.writes.length;
  for(const action of ['saveDraft','document','issue','send']) await assert.rejects(f.run({action,...draft,CorrespondenceId:'principal'}),/permitted scope|password|authoris/i);
  await assert.rejects(f.run({action:'document',CorrespondenceId:'other'}),/permitted scope/);
  await assert.rejects(f.run({action:'search',type:'staff',query:'Staff'}),/directory type/);
  assert.equal(f.writes.length,count);
  assert.equal(f.records.get('executiveCorrespondence/principal').Body,'Confidential');
});
