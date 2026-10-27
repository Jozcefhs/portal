// Only implemented Hospital modules enter the commercial/access catalogue.
// The complete roadmap, including specialist services, is tracked in docs/hospital-edition-scope.md.
export const HOSPITAL_STAFF_ROLES = Object.freeze([
  'Medical Director', 'Hospital Administrator', 'Doctor', 'Nurse', 'Pharmacist',
  'Laboratory Scientist', 'Radiographer', 'Registration Officer', 'Medical Records Officer',
  'Hospital Cashier', 'HMO Officer'
]);

export const HOSPITAL_MODULES = Object.freeze([
  Object.freeze({Key:'hospitalTheatre',Editions:Object.freeze(['hospital']),Labels:Object.freeze({hospital:'Theatre and procedures'}),Description:'Theatre bookings, clinical checklists, operative records and recovery handover.',Requires:Object.freeze(['hospitalPatients','hospitalReception'])}),
  Object.freeze({Key:'hospitalNursing',Editions:Object.freeze(['hospital']),Labels:Object.freeze({hospital:'Nursing and handovers'}),Description:'Inpatient charts, medication administration and acknowledged shift handovers.',Requires:Object.freeze(['hospitalPatients','hospitalReception','hospitalInpatients','hospitalOrders'])}),
  Object.freeze({Key:'hospitalInpatients',Editions:Object.freeze(['hospital']),Labels:Object.freeze({hospital:'Wards and admissions'}),Description:'Ward setup, admission, bed allocation, transfers and signed discharge.',Requires:Object.freeze(['hospitalPatients','hospitalReception'])}),
  Object.freeze({ Key: 'hospitalPatients', Editions: Object.freeze(['hospital']),
    Labels: Object.freeze({ hospital: 'Patient registration' }),
    Description: 'Patient identity, demographic records and controlled patient lookup.', Requires: Object.freeze([]) }),
  Object.freeze({ Key: 'hospitalReception', Editions: Object.freeze(['hospital']),
    Labels: Object.freeze({ hospital: 'Reception and visits' }),
    Description: 'Patient check-in and dated visit queues.', Requires: Object.freeze(['hospitalPatients']) }),
  Object.freeze({ Key: 'hospitalTriage', Editions: Object.freeze(['hospital']), Labels: Object.freeze({ hospital: 'Triage and nursing' }),
    Description: 'Recorded observations, allergies and attributable nursing entries.', Requires: Object.freeze(['hospitalPatients','hospitalReception']) }),
  Object.freeze({ Key: 'hospitalConsultations', Editions: Object.freeze(['hospital']), Labels: Object.freeze({ hospital: 'Consultations' }),
    Description: 'Consultation drafts, signed notes and retained amendments.', Requires: Object.freeze(['hospitalPatients','hospitalReception']) }),
  Object.freeze({ Key:'hospitalOrders', Editions:Object.freeze(['hospital']), Labels:Object.freeze({hospital:'Prescriptions and investigations'}),
    Description:'Clinician-issued prescriptions and investigation requests.',Requires:Object.freeze(['hospitalPatients','hospitalReception']) }),
  Object.freeze({ Key:'hospitalPharmacy', Editions:Object.freeze(['hospital']), Labels:Object.freeze({hospital:'Pharmacy'}),
    Description:'Prescription review, batch stock, dispensing and recorded returns.',Requires:Object.freeze(['hospitalPatients','hospitalReception']) }),
  Object.freeze({ Key:'hospitalLaboratory', Editions:Object.freeze(['hospital']), Labels:Object.freeze({hospital:'Laboratory'}),
    Description:'Specimen handling, report verification and release.',Requires:Object.freeze(['hospitalPatients','hospitalReception']) }),
  Object.freeze({Key:'hospitalBilling',Editions:Object.freeze(['hospital']),Labels:Object.freeze({hospital:'Billing and payments'}),Description:'Patient invoices, payments, credits and accounting reconciliation.',Requires:Object.freeze(['hospitalPatients','hospitalReception'])}),
  Object.freeze({Key:'hospitalHmo',Editions:Object.freeze(['hospital']),Labels:Object.freeze({hospital:'HMO and insurance'}),Description:'Tariffs, staff-verified eligibility, claims and settlements.',Requires:Object.freeze(['hospitalPatients','hospitalReception'])}),
  Object.freeze({ Key:'hospitalImaging', Editions:Object.freeze(['hospital']), Labels:Object.freeze({hospital:'Imaging investigations'}),
    Description:'Imaging requests, verified reports and release.',Requires:Object.freeze(['hospitalPatients','hospitalReception']) })
]);

export const HOSPITAL_ROLE_CAPABILITIES = Object.freeze({
  'Super Admin': ['theatre.configure','inpatient.read','inpatient.admit','inpatient.configure','patients.read', 'patients.write', 'visits.read', 'visits.write','billing.read','billing.write','billing.configure','billing.refund','hmo.work'],
  'Hospital Administrator': ['theatre.configure','inpatient.read','inpatient.admit','inpatient.configure','patients.read', 'patients.write', 'visits.read', 'visits.write','billing.read','billing.write','billing.configure','billing.refund','hmo.work'],
  'Medical Director': ['theatre.read','theatre.schedule','theatre.work','theatre.sign','nursing.read','nursing.write','inpatient.read','inpatient.clinical','inpatient.discharge','patients.read', 'visits.read', 'clinical.read', 'triage.write', 'consultations.write','orders.read','orders.create'],
  'Doctor': ['theatre.read','theatre.schedule','theatre.work','theatre.sign','nursing.read','nursing.write','inpatient.read','inpatient.clinical','inpatient.discharge','patients.read', 'visits.read', 'clinical.read', 'triage.write', 'consultations.write','orders.read','orders.create'],
  'Nurse': ['theatre.read','theatre.work','nursing.read','nursing.write','inpatient.read','inpatient.clinical','inpatient.admit','patients.read', 'visits.read', 'clinical.read', 'triage.write','orders.read'],
  'Pharmacist':['patients.read','visits.read','pharmacy.work'],
  'Laboratory Scientist':['patients.read','visits.read','laboratory.work'],
  'Radiographer':['patients.read','visits.read','imaging.work'],
  'Registration Officer': ['inpatient.read','inpatient.admit','patients.read', 'patients.write', 'visits.read', 'visits.write'],
  'Medical Records Officer': ['inpatient.read','patients.read', 'patients.write', 'visits.read'],
  'Hospital Cashier':['patients.read','visits.read','billing.read','billing.write','billing.collect'],
  'HMO Officer':['patients.read','visits.read','hmo.work'],
  'Front Desk': ['inpatient.read','inpatient.admit','patients.read', 'patients.write', 'visits.read', 'visits.write']
});

export function hospitalRoleModules(role) {
  const capabilities = HOSPITAL_ROLE_CAPABILITIES[role] || [];
  return [
    ...(capabilities.some(c=>c.startsWith('theatre.')) ? ['hospitalTheatre'] : []),
    ...(capabilities.includes('nursing.read') ? ['hospitalNursing'] : []),
    ...(capabilities.includes('inpatient.read') ? ['hospitalInpatients'] : []),
    ...(capabilities.includes('patients.read') ? ['hospitalPatients'] : []),
    ...(capabilities.includes('visits.read') ? ['hospitalReception'] : []),
    ...(capabilities.includes('triage.write') ? ['hospitalTriage'] : []),
    ...(capabilities.includes('consultations.write') ? ['hospitalConsultations'] : []),
    ...(capabilities.includes('orders.read') ? ['hospitalOrders'] : []),
    ...(capabilities.includes('pharmacy.work') ? ['hospitalPharmacy'] : []),
    ...(capabilities.includes('laboratory.work') ? ['hospitalLaboratory'] : []),
    ...(capabilities.includes('billing.read') ? ['hospitalBilling'] : []),
    ...(capabilities.includes('hmo.work') ? ['hospitalHmo'] : []),
    ...(capabilities.includes('imaging.work') ? ['hospitalImaging'] : [])
  ];
}
