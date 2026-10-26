// Only implemented Hospital modules enter the commercial/access catalogue.
// The complete roadmap, including specialist services, is tracked in docs/hospital-edition-scope.md.
export const HOSPITAL_STAFF_ROLES = Object.freeze([
  'Medical Director', 'Hospital Administrator', 'Doctor', 'Nurse', 'Pharmacist',
  'Laboratory Scientist', 'Radiographer', 'Registration Officer', 'Medical Records Officer',
  'Hospital Cashier', 'HMO Officer'
]);

export const HOSPITAL_MODULES = Object.freeze([
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
  Object.freeze({ Key:'hospitalImaging', Editions:Object.freeze(['hospital']), Labels:Object.freeze({hospital:'Imaging investigations'}),
    Description:'Imaging requests, verified reports and release.',Requires:Object.freeze(['hospitalPatients','hospitalReception']) })
]);

export const HOSPITAL_ROLE_CAPABILITIES = Object.freeze({
  'Super Admin': ['patients.read', 'patients.write', 'visits.read', 'visits.write'],
  'Hospital Administrator': ['patients.read', 'patients.write', 'visits.read', 'visits.write'],
  'Medical Director': ['patients.read', 'visits.read', 'clinical.read', 'triage.write', 'consultations.write','orders.read','orders.create'],
  'Doctor': ['patients.read', 'visits.read', 'clinical.read', 'triage.write', 'consultations.write','orders.read','orders.create'],
  'Nurse': ['patients.read', 'visits.read', 'clinical.read', 'triage.write','orders.read'],
  'Pharmacist':['patients.read','visits.read','pharmacy.work'],
  'Laboratory Scientist':['patients.read','visits.read','laboratory.work'],
  'Radiographer':['patients.read','visits.read','imaging.work'],
  'Registration Officer': ['patients.read', 'patients.write', 'visits.read', 'visits.write'],
  'Medical Records Officer': ['patients.read', 'patients.write', 'visits.read'],
  'Front Desk': ['patients.read', 'patients.write', 'visits.read', 'visits.write']
});

export function hospitalRoleModules(role) {
  const capabilities = HOSPITAL_ROLE_CAPABILITIES[role] || [];
  return [
    ...(capabilities.includes('patients.read') ? ['hospitalPatients'] : []),
    ...(capabilities.includes('visits.read') ? ['hospitalReception'] : []),
    ...(capabilities.includes('triage.write') ? ['hospitalTriage'] : []),
    ...(capabilities.includes('consultations.write') ? ['hospitalConsultations'] : []),
    ...(capabilities.includes('orders.read') ? ['hospitalOrders'] : []),
    ...(capabilities.includes('pharmacy.work') ? ['hospitalPharmacy'] : []),
    ...(capabilities.includes('laboratory.work') ? ['hospitalLaboratory'] : []),
    ...(capabilities.includes('imaging.work') ? ['hospitalImaging'] : [])
  ];
}
