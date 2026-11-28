import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { env, request } from './hospital-fixture.mjs';
import { inpatientActors, discharge } from './hospital-inpatient-fixture.mjs';
import { createHospitalService } from '../../functions/lib/hospital-service.js';
import { balances } from '../../functions/lib/hospital-billing-model.js';

export async function completeVisit(f) {
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

export async function encryptedRoundTrip(payload) {
  const code = await readFile(new URL('../../js/admin.js',import.meta.url),'utf8');
  const scope = { window:{ crypto }, btoa, atob, TextEncoder, TextDecoder, clean:value=>String(value ?? '').trim() };
  runInNewContext(code.slice(code.indexOf('function base64FromBytes('),code.indexOf('function downloadBackupFile(')),scope);
  const key = crypto.randomUUID();
  const file = JSON.stringify(await scope.encryptOrganizationBackup(payload,key));
  assert.ok(!file.includes('Synthetic result'));
  await assert.rejects(scope.decryptOrganizationBackup(JSON.parse(file),'wrong password'),/incorrect/);
  return JSON.parse(JSON.stringify(await scope.decryptOrganizationBackup(JSON.parse(file),key)));
}
