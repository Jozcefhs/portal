import { requiredDeploymentIdentity } from './deployment-identity.js';

export const HOSPITAL_COLLECTIONS = Object.freeze([
  'Patients', 'Numbers', 'PatientMatches', 'Cards', 'Operations', 'Audit', 'Visits', 'OpenVisits',
  'AppointmentSchedules','AppointmentScheduleEvents','Appointments','AppointmentEvents',
  'Encounters', 'CareSummaries', 'Consultations', 'ClinicalEntries',
  'Orders', 'OrderEvents', 'MedicineBatches', 'StockReceipts', 'StockMovements', 'Dispenses', 'MedicineReturns', 'ChargeEvents', 'InvestigationReports', 'ReleasedReports', 'CriticalAlerts',
  'BillingSettings','BillingSettingVersions','HmoPlans','HmoPlanVersions','HmoEligibility','HmoEligibilityVersions',
  'Invoices','BillingEvents','Claims','ClaimVersions','CreditTotals','CreditNotes','Payments','PaymentReferences','Refunds','RefundReferences',
  'Funds','FundEvents','FundAllocationBatches','FundAllocationReturns','FundRefunds',
  'Theatres','TheatreVersions','TheatreReservations','TheatreActiveResources','ProcedureCases','ProcedureEvents',
  'NursingCharts','MedicationDoses','NursingHandovers','NursingEvents',
  'Wards','WardVersions','Beds','BedVersions','Admissions','OpenAdmissions','AdmissionEvents','DischargeSummaries',
  'CorporateAccounts','CorporateAccountVersions','CorporateCoverage','CorporateCoverageVersions','CorporateEvents'
]);

export function hospitalCollectionPath(env, name) {
  const identity = requiredDeploymentIdentity(env);
  if (identity.edition !== 'hospital' || !HOSPITAL_COLLECTIONS.includes(name)) {
    throw Object.assign(new Error('Invalid Hospital storage scope.'), { status: 403 });
  }
  return `hospitalWorkspaces/${identity.workspaceId}/hospital${name}`;
}
