import test from 'node:test';
import assert from 'node:assert/strict';
import { getBranchClassCatalogue, projectBranchClassCatalogue, branchClassCatalogueRevisionWrite } from '../functions/lib/branch-class-catalogue.js';

const classes = [
  { __id:'original-nursery', ClassId:'original-nursery', Name:'Nursery 2', BranchId:'garden', SchoolSection:'primary', Status:'Active', __updateTime:'v1' },
  { ClassId:'closed', Name:'Old Class', BranchId:'garden', SchoolSection:'primary', Status:'Archived' },
  { ClassId:'secondary', Name:'Grade 10', BranchId:'garden', SchoolSection:'secondary', Status:'Active' },
  { ClassId:'other', Name:'Nursery 2', BranchId:'main', SchoolSection:'primary', Status:'Active' }
];
const arms = [
  { ArmId:'original-arm', ClassId:'original-nursery', Name:'Excellence', BranchId:'garden', SchoolSection:'primary', Status:'Active', __updateTime:'a1' },
  { ArmId:'retired-arm', ClassId:'original-nursery', Name:'Retired', BranchId:'garden', Status:'Archived' },
  { ArmId:'foreign-arm', ClassId:'original-nursery', Name:'Foreign', BranchId:'main', Status:'Active' }
];

test('shared catalogue retains existing IDs and sections without recreating or including foreign/retired arms', () => {
  const before = structuredClone({classes,arms});
  const rows = projectBranchClassCatalogue(classes, arms, {branchId:'garden',section:'primary'});
  assert.equal(rows.length,2);
  const nursery = rows.find(row=>row.ClassName==='Nursery 2');
  assert.equal(nursery.AcademicClassId,'original-nursery');
  assert.equal(nursery.Arms,'Excellence');
  assert.deepEqual(nursery.ArmRecords,[{ArmId:'original-arm',Name:'Excellence',RevisionToken:'a1'}]);
  assert.equal(rows.find(row=>row.ClassName==='Old Class').Active,'NO');
  assert.deepEqual({classes,arms},before);
});

test('loading a branch only reads its bounded catalogues, never pupils, scores or old settings', async () => {
  const reads=[];
  const result=await getBranchClassCatalogue({}, {branchId:'garden',section:'primary',includeInactive:false}, {
    getDocument:async (_env,path,id)=>{reads.push({path,id});return {ClassCatalogueRevision:'r1'};},
    queryCollectionPages:async (_env,path,options)=>{reads.push({path,options});return path==='academicClasses'?classes:arms;}
  });
  assert.equal(result.classes.length,1);
  assert.equal(result.catalogueRevision,'r1');
  assert.deepEqual(reads.map(r=>r.path),['branchSchoolSettings','academicClasses','academicArms']);
  for(const read of reads.slice(1)) assert.deepEqual(read.options.filters,[{field:'BranchId',op:'==',value:'garden'}]);
});

test('name-only consumers omit arm reads and unavailable database cannot fall back to another catalogue', async () => {
  const reads=[];
  await getBranchClassCatalogue({}, {branchId:'garden',includeArms:false,metadata:{}}, {
    getDocument:async()=>{throw Error('unexpected read');},
    queryCollectionPages:async(_env,path)=>{reads.push(path);return classes;}
  });
  assert.deepEqual(reads,['academicClasses']);
  await assert.rejects(getBranchClassCatalogue({}, {branchId:'garden'}, {getDocument:async()=>{throw Error('offline');}}),/offline/);
  await assert.rejects(getBranchClassCatalogue({}, {branchId:'all'}),/Select one branch/);
});

test('catalogue concurrency guard preserves branch metadata and requires its exact saved version', () => {
  const snapshot={ClassCatalogueRevision:'old',AdmissionSetupMode:'independent',__updateTime:'saved-version',__id:'garden'};
  const write=branchClassCatalogueRevisionWrite('garden',snapshot,'Office','2026-11-10T10:00:00Z');
  assert.equal(write.updateTime,'saved-version');
  assert.equal(write.data.AdmissionSetupMode,'independent');
  assert.equal(write.data.ClassSetupMode,'academic');
  assert.notEqual(write.data.ClassCatalogueRevision,'old');
  assert.equal(write.data.__updateTime,undefined);
  assert.equal(branchClassCatalogueRevisionWrite('garden',null).exists,false);
  assert.throws(()=>branchClassCatalogueRevisionWrite('garden',{}),/revision is missing/);
});
