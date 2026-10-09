import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import * as rules from '../functions/lib/vendor-settlement-rules.js';
import {searchLibraryBorrowers} from '../functions/lib/school-library.js';
import {schoolSectionFor} from '../functions/lib/school-scope.js';
import {staffCanUseStudentFaceLookup} from '../functions/api/staff-face-lookup.js';
import {safeScopeId} from '../functions/lib/school-scope.js';
import {recordReferencesMatch,studentSearchCard} from '../functions/lib/records-desk.js';

const stripped = source => source.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm,'').replace(/export /g,'');
const [customerSource,accessSource,salesSource,faceSource] = await Promise.all(['functions/lib/school-tuck-shop.js','functions/lib/vendor-sales-access.js','functions/lib/vendor-sales.js','functions/api/staff-face-lookup.js'].map(p=>readFile(new URL(`../${p}`,import.meta.url),'utf8')));
const actor = {username:'seller',role:'Vendor User',edition:'school',branchId:'main',schoolSectionAccess:'All',allowedSections:['vendorSettlements','tuckShop']};
function fixture() {
  const students = [
    {AdmissionNo:'DNX-26-006',DisplayName:'Sample Child',ClassName:'Grade 7',WalletCardId:'CARD-6',ParentEmail:'parent@example.test',WalletPinHash:'private',BranchId:'main',SchoolSection:'secondary'},
    {AdmissionNo:'PRI/001',DisplayName:'Primary Child',ClassName:'Primary 1',BranchId:'main',SchoolSection:'primary'},
    {AdmissionNo:'OTHER/001',DisplayName:'Other Child',BranchId:'other',SchoolSection:'secondary'}
  ];
  let vendors = [{ScopeKey:'school--main',VendorId:'v1',LoginUsername:'seller',SchoolSection:'Secondary',Active:'YES'}];
  const access = runInNewContext(`${stripped(accessSource)}\n({linkedSalesVendors,vendorCustomerScope})`,{...rules,queryCollectionPages:async()=>vendors});
  const customers = runInNewContext(`${stripped(customerSource)}\n({searchTuckShopCustomers,canonicalTuckShopStudentReference})`,{
    listSchoolCollection:async()=>students,listCollection:async()=>[],schoolSectionFor,searchLibraryBorrowers
  });
  const calls = [];
  const getWalletCardAccount = async (_env,body) => {
    calls.push(body);
    const student = students.find(row=>row.BranchId===body.UserBranchId && (body.UserSchoolSectionAccess==='All' || row.SchoolSection===body.UserSchoolSectionAccess)
      && (body.WalletCardId ? row.WalletCardId===body.WalletCardId.toUpperCase() : row.AdmissionNo===body.AccountRef));
    if(!student) throw Object.assign(new Error('Not found'),{status:404});
    return {account:{...student,AccountRef:student.AdmissionNo,WalletBalance:1000,WalletSpentToday:200}};
  };
  const source = stripped(salesSource).replace(/const \{getWalletCardAccount\} = await import\('[^']+'\);/,'');
  const handle = runInNewContext(`${source}\nhandleVendorSalesAction`,{...rules,...access,...customers,getWalletCardAccount});
  return {students,calls,access,customers,handle,disable:()=>{vendors=[];},run:(action,body={},user=actor)=>handle({},user,{action,Section:'tuckShop',...body})};
}

test('vendor admission lookup canonicalizes formatting/case and returns the saved identity only',async()=>{
  const f=fixture();
  for(const ref of ['DNX26/006','dnx-26-006','DNX-26-006']) {
    const result=await f.run('vendorWalletLookup',{AccountRef:ref});
    assert.equal(result.account.AccountRef,'DNX-26-006');
    assert.equal(result.account.DisplayName,'Sample Child');
    for(const field of ['WalletBalance','WalletSpentToday','WalletPinHash','ParentEmail','WalletCardId']) assert.equal(result.account[field],undefined);
  }
  assert.equal(f.calls.at(-1).UserSchoolSectionAccess,'secondary');
});

test('partial admission IDs and duplicate normalized IDs cannot select an arbitrary wallet',async()=>{
  const f=fixture(); await assert.rejects(f.run('vendorWalletLookup',{AccountRef:'DNX26/00'}),/not found/);
  f.students.push({...f.students[0],AdmissionNo:'DNX26/006'});
  await assert.rejects(f.customers.canonicalTuckShopStudentReference({},actor,'dnx26/006'),/More than one/);
});

test('vendor search finds names, admission IDs, card IDs and email but returns no contact or wallet data',async()=>{
  const f=fixture();
  for(const Query of ['Sample','DNX26/006','CARD-6','parent@example.test']) {
    const result=await f.run('vendorCustomerSearch',{Query}); assert.equal(result.customers.length,1);
    assert.deepEqual(Object.keys(result.customers[0]).sort(),['CustomerName','CustomerRef','CustomerType','Detail']);
  }
  assert.equal((await f.run('vendorCustomerSearch',{Query:'Primary'})).customers.length,0);
  assert.equal((await f.run('vendorCustomerSearch',{Query:'Other'})).customers.length,0);
  await assert.rejects(f.run('vendorWalletLookup',{AccountRef:'PRI/001'}),/not found/);
  await assert.rejects(f.run('vendorWalletLookup',{AccountRef:'OTHER/001'}),/not found/);
  await assert.rejects(f.run('vendorWalletLookup'),/Enter a card/);
});

test('card lookup, linkage, edition and permitted modules fail closed',async()=>{
  const f=fixture(); assert.equal((await f.run('vendorWalletLookup',{WalletCardId:'card-6'})).account.AccountRef,'DNX-26-006');
  for(const change of [{username:'other'},{edition:'faith'},{branchId:'other'},{schoolSectionAccess:'Primary'},{allowedSections:['vendorSettlements']}])
    await assert.rejects(f.run('vendorCustomerSearch',{Query:'Sample'},{...actor,...change}));
  f.disable(); await assert.rejects(f.run('vendorWalletLookup',{AccountRef:'DNX-26-006'}),/No active/);
});

test('vendor face lookup is purchase-only and derives student scope from active linked vendors',async()=>{
  const f=fixture();
  assert.equal(staffCanUseStudentFaceLookup(actor,'tuck-shop-purchase'),true);
  assert.equal(staffCanUseStudentFaceLookup({...actor,allowedSections:['recordsDesk','tuckShop']},'records-desk'),false);
  const source=stripped(faceSource);
  const endpoint=runInNewContext(`${source}\nonRequestPost`,{
    ...f.access, isVendorSeller:user=>user.role==='Vendor User',staffCanUseStudentFaceLookup,
    recordsDeskCapabilities:()=>({}),requireFirestoreEnv(){},requireStaffSession:async()=>actor,
    readJsonBody:async req=>req.json(),Response,crypto:webcrypto,
    studentFaceLookupConfigured:()=>true,studentFaceLookupEnabled:()=>true,
    STUDENT_FACE_MODEL_ID:'fixture-model',STUDENT_FACE_TEMPLATE_VERSION:1
  });
  const post=async body=>endpoint({env:{},request:new Request('https://fixture.test/api/staff-face-lookup',{method:'POST',body:JSON.stringify(body)})});
  const status=await post({action:'status',purpose:'tuck-shop-purchase'}); assert.equal(status.status,200);
  const result=await status.json(); assert.equal(result.canLookup,true); assert.equal(result.canManage,false); assert.equal(result.canErase,false);
  assert.equal((await post({action:'enroll',purpose:'tuck-shop-purchase'})).status,403);
  assert.equal((await post({action:'status',purpose:'records-desk'})).status,403);
  f.disable(); assert.equal((await post({action:'status',purpose:'tuck-shop-purchase'})).status,403);
});

test('session gateway permits the assisted face endpoint but still blocks all general student and financial APIs',async()=>{
  const auth=await readFile(new URL('../functions/lib/staff-auth.js',import.meta.url),'utf8');
  const begin=auth.indexOf('export async function requireStaffSession('),end=auth.indexOf('export async function createStaffAttendanceProof(',begin);
  const requireSession=runInNewContext(`${auth.slice(begin,end).replace('export ','')}\nrequireStaffSession`,{
    clean:rules.clean,lower:rules.lower,URL,readStaffSession:async()=>actor,findStaffUserRecord:async()=>({...actor,Active:'YES'}),
    publicUser:row=>row,externalAuditAccessExpired:()=>false,staffAccessFor:async()=>({}),
    staffUserForAccess:user=>user,applyStaffBranchContext:user=>user
  });
  const request=path=>new Request(`https://fixture.test${path}`);
  assert.equal((await requireSession({},request('/api/staff-face-lookup'))).username,'seller');
  for(const path of ['/api/staff-records','/api/staff-wallet','/api/staff-users','/api/staff-accounting','/api/staff-departments'])
    await assert.rejects(requireSession({},request(path)),error=>error.status===403);
});

test('face matching visits only linked vendor school sections and returns minimal confirmation, not templates',async()=>{
  const f=fixture(),paths=[],audits=[];
  const endpoint=runInNewContext(`${stripped(faceSource)}\nonRequestPost`,{
    ...f.access,isVendorSeller:user=>user.role==='Vendor User',recordsDeskCapabilities:()=>({}),safeScopeId,schoolSectionFor,recordReferencesMatch,studentSearchCard,
    requireFirestoreEnv(){},requireStaffSession:async()=>actor,readJsonBody:async req=>req.json(),Response,crypto:webcrypto,
    studentFaceLookupConfigured:()=>true,studentFaceLookupEnabled:()=>true,validateFaceDescriptor:value=>value,faceTemplateIsUsable:()=>true,
    STUDENT_FACE_MODEL_ID:'fixture-model',STUDENT_FACE_TEMPLATE_VERSION:1,
    getSchoolStructure:async()=>({Branches:[{Id:'main'},{Id:'other'}],Sections:['primary','secondary']}),
    scopedCollectionPath:(collection,branch,section)=>`${branch}/${section}/${collection}`,
    listSchoolCollection:async()=>f.students,
    listCollection:async(_env,path)=>{paths.push(path);return f.students.map(row=>({StudentRef:row.AdmissionNo,BranchId:row.BranchId,SchoolSection:row.SchoolSection,
      ModelId:'fixture-model',DescriptorCiphertext:'encrypted',DescriptorIv:'iv'}));},
    decryptFaceDescriptor:async()=>[1,2],studentFaceMatchSettings:()=>({}),
    bestFaceTemplateMatch:(_query,candidates)=>({outcome:'matched',match:{student:candidates[0]?.student,similarity:0.9}}),
    upsertDocument:async(_env,_collection,_id,row)=>audits.push(row)
  });
  const result=await endpoint({env:{FIREBASE_PROJECT_ID:'fixture',FACE_TEMPLATE_ENCRYPTION_KEY:'fixture-only-secret',STUDENT_FACE_RATE_LIMITER:{limit:async()=>({success:true})}},
    request:new Request('https://fixture.test/api/staff-face-lookup',{method:'POST',body:JSON.stringify({action:'match',purpose:'tuck-shop-purchase',modelId:'fixture-model',descriptor:[1,2],branchId:'other'})})});
  assert.equal(result.status,200);const body=await result.json();assert.equal(body.match.id,'DNX-26-006');
  assert.deepEqual(paths,['main/secondary/studentFaceTemplates']);
  assert.equal(body.match.ParentEmail,undefined);assert.equal(body.match.descriptor,undefined);assert.equal(body.match.WalletBalance,undefined);
  assert.equal(audits.length,1);assert.equal(audits[0].Purpose,'tuck-shop-purchase');
});
