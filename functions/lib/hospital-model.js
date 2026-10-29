import { assignedStaffBranches } from './staff-branch-access.js';
import { HOSPITAL_ROLE_CAPABILITIES } from './hospital-catalog.js';

export const clean = value => String(value ?? '').trim();
export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const id = value => /^[a-zA-Z0-9_-]{8,128}$/.test(clean(value)) ? clean(value) : fail('The record reference is invalid.');
export const nameKey = value => clean(value).normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ');
export async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  return value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
}
export function cardUid(value) {
  const uid = clean(value).replace(/[:\s-]/g, '').toUpperCase();
  if (!/^(?:[A-F0-9]{8}|[A-F0-9]{14}|[A-F0-9]{20})$/.test(uid)) fail('Read the NFC card UID as 4, 7 or 10 hexadecimal bytes.');
  return uid;
}
export function hospitalBranch(user, requested, configured = []) {
  const branch = clean(requested).toLowerCase();
  if (!branch || branch === 'all') fail('Select one hospital branch.');
  const allowed = assignedStaffBranches(user);
  if (allowed !== null && !allowed.includes(branch)) fail('This branch is outside your assigned access.', 403);
  const active = clean(user.activeBranchId || user.branchId).toLowerCase();
  if (active && active !== 'all' && active !== branch) fail('Select this branch as your working branch before continuing.', 403);
  if (!configured.some(row => clean(row.id || row.Id).toLowerCase() === branch)) fail('Choose a configured hospital branch.', 403);
  return branch;
}
export function hospitalCapabilities(user) {
  if (user.edition !== 'hospital' || user.subscriptionActive === false) return [];
  const sections = new Set(user.allowedSections || []);
  const modules={'procurement.read':['hospitalPharmacy','hospitalBilling'],'procurement.request':['hospitalPharmacy'],'procurement.suppliers':['hospitalPharmacy','hospitalBilling'],'procurement.approve':['hospitalPharmacy'],'procurement.receive':['hospitalPharmacy'],'procurement.finance':['hospitalBilling'],'procurement.bill':['hospitalBilling'],'procurement.approveBill':['hospitalBilling'],'procurement.pay':['hospitalBilling'],'procurement.correct':['hospitalBilling'],'theatre.read':['hospitalTheatre'],'theatre.configure':['hospitalTheatre'],'theatre.work':['hospitalTheatre'],'theatre.schedule':['hospitalTheatre'],'theatre.sign':['hospitalTheatre'],'nursing.read':['hospitalNursing'],'nursing.write':['hospitalNursing'],'inpatient.read':['hospitalInpatients'],'inpatient.configure':['hospitalInpatients'],'inpatient.admit':['hospitalInpatients'],
    'inpatient.clinical':['hospitalInpatients'],'inpatient.discharge':['hospitalInpatients'],'patients.read':['hospitalPatients'],'patients.write':['hospitalPatients'],
    'visits.read':['hospitalReception'],'visits.write':['hospitalReception'],
    'appointments.read':['hospitalReception'],'appointments.write':['hospitalReception'],'appointments.configure':['hospitalReception'],
    'clinical.read':['hospitalTriage','hospitalConsultations'],'triage.write':['hospitalTriage'],'consultations.write':['hospitalConsultations'],
    'orders.read':['hospitalOrders'],'orders.create':['hospitalOrders'],'pharmacy.work':['hospitalPharmacy'],'pharmacy.configure':['hospitalPharmacy'],
    'laboratory.configure':['hospitalLaboratory'],'imaging.configure':['hospitalImaging'],
    'laboratory.work':['hospitalLaboratory'],'imaging.work':['hospitalImaging'],
    'billing.read':['hospitalBilling'],'billing.write':['hospitalBilling'],'billing.configure':['hospitalBilling'],
    'billing.collect':['hospitalBilling'],'billing.refund':['hospitalBilling'],'hmo.work':['hospitalHmo']};
  return (HOSPITAL_ROLE_CAPABILITIES[user.role] || []).filter(capability => modules[capability]?.some(module=>sections.has(module)));
}
export function patientFields(input = {}, today = new Date().toISOString().slice(0, 10)) {
  const text = (key, limit = 160) => {
    const value = clean(input[key]);
    if (value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(`${key} is too long or contains invalid characters.`);
    return value;
  };
  const FirstName = text('FirstName'), LastName = text('LastName'), DateOfBirth = text('DateOfBirth', 10);
  if (!FirstName || !LastName) fail('Enter the patient’s first name and surname.');
  if (DateOfBirth && (!/^\d{4}-\d{2}-\d{2}$/.test(DateOfBirth)
    || !Number.isFinite(Date.parse(`${DateOfBirth}T00:00:00Z`))
    || new Date(`${DateOfBirth}T00:00:00Z`).toISOString().slice(0, 10) !== DateOfBirth || DateOfBirth > today)) fail('Enter a valid date of birth that is not in the future.');
  const Sex = text('Sex') || 'Unknown';
  if (!['Female', 'Male', 'Other', 'Unknown'].includes(Sex)) fail('Choose a valid sex entry.');
  return { FirstName, LastName, OtherNames: text('OtherNames'), DateOfBirth, Sex,
    Phone: text('Phone', 40), Email: text('Email', 254), Address: text('Address', 1000),
    EmergencyContactName: text('EmergencyContactName'), EmergencyContactPhone: text('EmergencyContactPhone', 40),
    GuardianName: text('GuardianName'), GuardianRelationship: text('GuardianRelationship', 80),
    InsurerName: text('InsurerName'), InsuranceNumber: text('InsuranceNumber', 100) };
}
export function patientName(row) { return [row.LastName, row.FirstName, row.OtherNames].filter(Boolean).join(' '); }
export function patientSummary(row) {
  return { PatientId: row.PatientId, HospitalNumber: row.HospitalNumber, DisplayName: patientName(row),
    DateOfBirth: row.DateOfBirth, Sex: row.Sex, Status: row.Status,
    CardStatus: row.CardKey ? 'Active' : 'Not assigned', CardLast4: row.CardLast4 || '', Revision: row.__updateTime };
}
export function patientDetails(row) {
  return { ...patientSummary(row), ...patientFields(row), CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt };
}
