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
    Description: 'Patient check-in and dated visit queues.', Requires: Object.freeze(['hospitalPatients']) })
]);

export const HOSPITAL_ROLE_CAPABILITIES = Object.freeze({
  'Super Admin': ['patients.read', 'patients.write', 'visits.read', 'visits.write'],
  'Hospital Administrator': ['patients.read', 'patients.write', 'visits.read', 'visits.write'],
  'Medical Director': ['patients.read', 'visits.read'],
  'Doctor': ['patients.read', 'visits.read'],
  'Nurse': ['patients.read', 'visits.read'],
  'Registration Officer': ['patients.read', 'patients.write', 'visits.read', 'visits.write'],
  'Medical Records Officer': ['patients.read', 'patients.write', 'visits.read'],
  'Front Desk': ['patients.read', 'patients.write', 'visits.read', 'visits.write']
});

export function hospitalRoleModules(role) {
  const capabilities = HOSPITAL_ROLE_CAPABILITIES[role] || [];
  return [
    ...(capabilities.includes('patients.read') ? ['hospitalPatients'] : []),
    ...(capabilities.includes('visits.read') ? ['hospitalReception'] : [])
  ];
}
