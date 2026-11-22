import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { actors } from './helpers/hospital-orders-fixture.mjs';
import { billingFixture, billingActors } from './helpers/hospital-billing-fixture.mjs';
import { fixture, env, request } from './helpers/hospital-fixture.mjs';
import { inpatientActors, discharge } from './helpers/hospital-inpatient-fixture.mjs';
import { createHospitalService } from '../functions/lib/hospital-service.js';
import { balances } from '../functions/lib/hospital-billing-model.js';
import { exportOrganizationBackupPage, sanitizeBackupDocument } from '../functions/lib/organization-backup.js';
import { branchRestoreRequest } from '../functions/lib/branch-restore.js';
import { previewBranchBackup, prepareRestoreBatches } from '../js/branch-restore.js';

async function completeVisit(f) {
  const { scope, doctor } = f;
  const service = role => createHospitalService(env, inpatientActors[role], f.db);
  const nurse = service('nurse');
  const clinical = async extra => {
    const c = await doctor.clinicalContext(request(scope));
    return request({ ...scope, VisitRevision:c.visit.Revision, EncounterRevision:c.encounter?.Revision || '',
      CareRevision:c.care.Revision || '', DraftRevision:c.draft?.Revision || '', ...extra });
  };
  await nurse.recordTriage(await clinical({ Triage:{ Complaint:'Synthetic complaint', Urgency:'Routine', AllergyStatus:'Unknown' } }));
  await doctor.saveConsultation(await clinical({ Notes:{ History:'Synthetic history', Assessment:'Synthetic assessment', Plan:'Synthetic plan' } }));
  await doctor.signConsultation(await clinical({ ConfirmPatient:true }));
  const lab = await f.create('Laboratory');
  const { order } = await f.laboratory.orderDetails(request(lab));
  for (const Decision of ['Collected','Received']) {
    await f.laboratory.recordSpecimen(await f.body(lab, { SpecimenLabel:order.LabelToPrint, Decision, Note:'Synthetic specimen checked' }, f.laboratory));
  }
  const { ReportId } = await f.laboratory.recordInvestigationReport(await f.body(lab, { Text:'Synthetic result', Critical:false }, f.laboratory));
  await f.verifier.verifyInvestigationReport(await f.body(lab, { ReportId }, f.verifier));
  await f.verifier.releaseInvestigationReport(await f.body(lab, { ReportId }, f.verifier));
  const prescription = await f.create();
  await f.receive();
  await f.pharmacist.reviewPrescription(await f.body(prescription, { Decision:'Approved', Reason:'Synthetic review' }));
  const [stock] = f.rows('MedicineBatches');
  const dispense = await f.body(prescription, { BatchId:stock.BatchId, BatchRevision:stock.__updateTime, Quantity:10 });
  await f.pharmacist.dispensePrescription(dispense);
  const wardAdmin = service('admin');
  const { WardId } = await wardAdmin.saveHospitalWard(request({ Ward:{ Code:'WARD-A', Name:'Synthetic ward', Active:true } }));
  const { BedId } = await wardAdmin.saveHospitalBed(request({ WardId, Bed:{ Code:'BED-A', Name:'Synthetic bed', Active:true } }));
  const { AdmissionId } = await service('clerk').admitHospitalPatient(request({ ...scope, BedId, BedRevision:f.rows('Beds')[0].__updateTime,
    VisitRevision:f.rows('Visits')[0].__updateTime, ResponsibleClinician:'Synthetic doctor', ConfirmPatient:true }));
  const admission = extra => request({ ...scope, AdmissionId, Revision:f.rows('Admissions')[0].__updateTime,
    VisitRevision:f.rows('Visits')[0].__updateTime, ConfirmPatient:true, ...extra });
  await service('doctor').signHospitalDischarge(admission({ Summary:discharge, ConfirmClinicalReview:true }));
  const leave = admission({});
  await nurse.dischargeHospitalPatient(leave);
  const invoice = await f.cashier.issueHospitalInvoice(request({ ...scope, ChargeIds:[f.rows('ChargeEvents')[0].ChargeId], ConfirmPatient:true }));
  const payment = await f.billBody(invoice,{ Amount:'125', Method:'Cash', Reference:'RECOVERY-DRILL', Payer:'Patient' });
  await f.cashier.recordHospitalPayment(payment);
  assert.equal(f.rows('Visits')[0].Status,'Completed');
  assert.equal(f.rows('Admissions')[0].Status,'Discharged');
  assert.equal(f.rows('Wards')[0].OccupiedBeds,0);
  assert.equal(f.rows('DischargeSummaries')[0].PatientId,scope.PatientId);
  assert.equal(balances(f.rows('Invoices')[0]).PatientBalanceCents,0);
  const journals = [...f.store.entries()].filter(([path]) => path.startsWith('accountingJournals/'));
  assert.equal(journals.length,2);
  for (const [,journal] of journals) assert.equal(journal.TotalDebit,journal.TotalCredit);
  return { lab, payment, leave, dispense, invoice };
}

async function archive(f, original) {
  let snapshotTime, discoveries = 0, structureReads = 0;
  const db = {
    async listRootCollectionIds(_, {readTime}) {
      assert.ok(readTime);
      assert.equal(readTime,snapshotTime ||= readTime);
      discoveries++;
      return [...new Set([...original.keys()].map(path => path.split('/')[0]))];
    },
    async getDocument(_, path, id, {readTime}) {
      assert.equal(readTime,snapshotTime); structureReads++;
      return original.get(path+'/'+id);
    },
    async listCollectionPage(_, path, options) {
      assert.equal(new URLSearchParams(options.query).get('readTime'),snapshotTime);
      const records = [...original].filter(([key]) => key.slice(0,key.lastIndexOf('/')) === path).map(([,row])=>row);
      const start = Number(options.pageToken);
      const end = start + 3;
      return { documents:records.slice(start,end), nextPageToken:end < records.length ? String(end) : '' };
    }
  };
  const collections = {};
  let cursor = 0, pageToken = '';
  do {
    const page = await exportOrganizationBackupPage(env,{cursor,pageToken},db);
    for (const [path,rows] of Object.entries(page.collections)) (collections[path] ||= []).push(...rows);
    if (!pageToken) {
      // Simulate a new root collection appearing during export.
      f.store.set('laterCollection/after',{__id:'after', AfterSnapshot:true});
    }
    if (page.backup.complete) break;
    ({ nextCursor:cursor, nextPageToken:pageToken } = page.backup);
  } while (true);
  assert.equal(discoveries,1);
  assert.equal(structureReads,1);
  assert.equal(Object.values(collections).flat().length, original.size);
  return { format:'dynamax-organization-backup', formatVersion:3, createdAt:snapshotTime, workspaceId:env.DYNAMAX_WORKSPACE_ID, edition:'hospital', collections };
}

async function encryptedRoundTrip(payload) {
  const code = await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
  const scope = { window:{ crypto }, btoa, atob, TextEncoder, TextDecoder, clean:value=>String(value ?? '').trim() };
  runInNewContext(code.slice(code.indexOf('function base64FromBytes('),code.indexOf('function downloadBackupFile(')),scope);
  const key = crypto.randomUUID();
  const file = JSON.stringify(await scope.encryptOrganizationBackup(payload,key));
  assert.ok(!file.includes('Synthetic result'));
  await assert.rejects(scope.decryptOrganizationBackup(JSON.parse(file),'wrong password'),/incorrect/);
  return JSON.parse(JSON.stringify(await scope.decryptOrganizationBackup(JSON.parse(file),key)));
}

test('registration, care, discharge and paid bill survive encrypted recovery and retried operations',async t => {
  const f = await billingFixture();
  const actions = await completeVisit(f);
  const original = structuredClone(f.store);
  const backup = await encryptedRoundTrip(await archive(f,original));
  const destination = fixture();
  const sentinel = { __id:'existing', __updateTime:'other', BranchId:'north', Keep:true };
  destination.store.set('accountingJournals/existing',sentinel);
  const adapter = {
    getDocument:destination.db.getDocument,
    getDocuments:(_,path,ids)=>Promise.all(ids.map(id=>destination.db.getDocument(env,path,id))),
    commit:(_,writes)=>destination.db.batchCommitLiteralDocuments(env,writes.map(w=>({
      ...w, currentDocument:w.exists === false ? {exists:false} : {updateTime:w.updateTime},
      data:{ ...(w.updateMask && destination.store.get(w.collectionPath+'/'+w.documentId)), ...w.data }
    })))
  };
  const owner = { username:'recovery-owner', role:'Super Admin', branchAccess:'all', branchId:'all' };
  const call = (action,body)=>branchRestoreRequest(env,owner,action,body,adapter);
  const preview = payload=>previewBranchBackup(payload,'@organisation','missing',call,rows=>rows.length?[rows]:[],()=>{});
  await assert.rejects(preview({...backup,workspaceId:'another-hospital'}));
  const plan = await preview(backup);
  assert.equal(destination.commits.length,0);
  assert.equal(plan.totals.create,original.size);
  const {jobId} = await call('prepare-branch-restore',{...plan.scope,...await prepareRestoreBatches(plan),confirmation:plan.phrase,safetyBackupCreated:true});
  for (const [index,batch] of plan.batches.entries()) {
    const body = {...plan.scope,...batch,index,jobId};
    const result = await call('apply-branch-restore',body);
    const writes = destination.commits.length;
    assert.deepEqual(await call('apply-branch-restore',body),result);
    assert.equal(destination.commits.length,writes);
  }
  assert.equal((await preview(backup)).batches.length,0);
  for (const [key,record] of original) {
    const path = key.slice(0,key.lastIndexOf('/'));
    assert.deepEqual(sanitizeBackupDocument(path,destination.store.get(key)),sanitizeBackupDocument(path,record),key);
    assert.deepEqual(f.store.get(key),record,key);
  }
  assert.deepEqual(destination.store.get('accountingJournals/existing'),sentinel);
  assert.ok(!destination.store.has('laterCollection/after'));
  const before = destination.commits.length;
  for (const [actor,action,body] of [
    [billingActors.cashier,'recordHospitalPayment',actions.payment],
    [inpatientActors.nurse,'dischargeHospitalPatient',actions.leave]
  ]) {
    const result = await createHospitalService(env,actor,destination.db)[action](body);
    assert.equal(result.replayed,true);
  }
  const pharmacy = createHospitalService(env,actors.pharmacist,destination.db);
  assert.equal((await pharmacy.dispensePrescription(actions.dispense)).replayed,true);
  assert.equal(destination.commits.length,before);
  const doctor = createHospitalService(env,inpatientActors.doctor,destination.db);
  assert.equal((await doctor.orderDetails(request(actions.lab))).releasedReport.Text,'Synthetic result');
  assert.equal(destination.commits.length,before+1);
  assert.ok(destination.commits.at(-1).every(write=>write.collectionPath.endsWith('/hospitalAudit') || write.collectionPath.endsWith('/hospitalOperations')));
  t.diagnostic(original.size+' records recovered across '+Object.values(backup.collections).filter(rows=>rows.length).length+' populated collections.');
});


test('expired and out-of-order hospital export continuations fail before storage access', async () => {
  const unavailable = {};
  for (const [stamp,position] of [[Date.now()-3600001,1],[Date.now(),2]]) {
    await assert.rejects(exportOrganizationBackupPage(env, {cursor:1,pageToken:`hospital-v1:${stamp}:${position}:`}, unavailable),/invalid or expired/);
  }
});
