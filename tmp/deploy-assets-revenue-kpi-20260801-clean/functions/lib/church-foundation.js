import { safeScopeId } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();
const money = (value) => {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
};
const safeId = (value) => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);

export const CHURCH_COLLECTIONS = Object.freeze({
  members: 'churchMembers',
  households: 'churchHouseholds',
  departments: 'organisationDepartments',
  departmentPositions: 'organisationDepartmentPositions',
  departmentMembers: 'organisationDepartmentMembers',
  departmentMeetings: 'organisationDepartmentMeetings',
  departmentAttendance: 'organisationDepartmentAttendance',
  departmentOfferings: 'organisationDepartmentOfferings',
  specialPrograms: 'organisationSpecialPrograms',
  programRegistrations: 'organisationProgramRegistrations',
  foreignVisitors: 'organisationForeignVisitors',
  departmentAudit: 'organisationDepartmentAudit',
  services: 'churchServices',
  serviceOccurrences: 'churchServiceOccurrences',
  attendance: 'churchAttendance',
  serviceAudit: 'churchServiceAudit',
  funds: 'churchFunds',
  fundMappings: 'churchFundMappings',
  givingTypes: 'churchGivingTypes',
  fundAudit: 'churchFundAudit',
  donationAudit: 'churchDonationAudit',
  offeringApprovalRoutes: 'churchOfferingApprovalRoutes',
  donations: 'churchDonations',
  offerings: 'churchOfferings',
  offeringApprovalRoutesAudit: 'churchOfferingApprovalRoutesAudit',
  offeringAudit: 'churchOfferingAudit',
  approvals: 'churchApprovals',
  membershipAudit: 'churchMembershipAudit'
});

export const CHURCH_ACCOUNTING_TARGET = 'accountingJournals';

export function churchCollectionPath(collection, branchId = 'main') {
  const allowed = Object.values(CHURCH_COLLECTIONS);
  if (!allowed.includes(clean(collection))) throw new Error(`Unknown church collection: ${clean(collection) || '(blank)'}`);
  return `organisationBranches/${safeScopeId(branchId)}/${clean(collection)}`;
}

export function safeChurchDocumentId(value) {
  return safeId(value);
}

export function normalizeOfferingDraft(input = {}) {
  const offeringId = clean(input.OfferingId || input.offeringId);
  const totalAmount = money(input.TotalAmount ?? input.totalAmount ?? input.Amount ?? input.amount);
  if (!offeringId) throw new Error('OfferingId is required.');
  if (totalAmount <= 0) throw new Error('Offering amount must be greater than zero.');
  return {
    OfferingId: offeringId,
    BranchId: safeScopeId(input.BranchId || input.branchId || 'main'),
    ServiceId: clean(input.ServiceId || input.serviceId),
    FundId: clean(input.FundId || input.fundId),
    GivingTypeId: clean(input.GivingTypeId || input.givingTypeId),
    GivingTypeName: clean(input.GivingTypeName || input.givingTypeName || input.PaymentType || input.paymentType),
    RevenueAccountCode: clean(input.RevenueAccountCode || input.revenueAccountCode),
    Date: clean(input.Date || input.date),
    Currency: clean(input.Currency || input.currency) || 'NGN',
    TotalAmount: totalAmount,
    Status: clean(input.Status || input.status) || 'Draft',
    ApprovalStatus: clean(input.ApprovalStatus || input.approvalStatus) || 'Pending',
    AccountingStatus: clean(input.AccountingStatus || input.accountingStatus) || 'Unposted',
    JournalNo: clean(input.JournalNo || input.journalNo),
    RecordedBy: clean(input.RecordedBy || input.recordedBy),
    Notes: clean(input.Notes || input.notes)
  };
}

// This returns the established accountingJournals payload shape. Persistence
// remains in the accounting service so church features never create a ledger.
export function buildOfferingJournalDraft(offeringInput, mapping = {}) {
  const offering = normalizeOfferingDraft(offeringInput);
  const debitAccount = clean(mapping.DebitAccountCode || mapping.debitAccountCode);
  const creditAccount = clean(
    mapping.IncomeAccountCode || mapping.incomeAccountCode ||
    mapping.CreditAccountCode || mapping.creditAccountCode
  );
  if (!debitAccount || !creditAccount) throw new Error('Offering debit and credit account mappings are required.');
  const journalNo = offering.JournalNo || `SYS-OFFERING-${safeId(offering.OfferingId)}`;
  const givingTypeName = clean(
    mapping.GivingTypeName || offering.GivingTypeName || 'Offering'
  );
  return {
    JournalNo: journalNo,
    Date: offering.Date,
    Description: clean(mapping.Description) || `Offering receipt ${offering.OfferingId}`,
    Reference: offering.OfferingId,
    Source: 'Church Offering',
    SourceId: offering.OfferingId,
    GivingTypeId: clean(mapping.GivingTypeId || offering.GivingTypeId),
    GivingTypeName: givingTypeName,
    RevenueAccountCode: creditAccount,
    Department: clean(mapping.Department) || 'Church',
    CostCentre: clean(mapping.CostCentre) || offering.BranchId,
    Status: 'Draft',
    Lines: [
      {
        AccountCode: debitAccount,
        Description: `${givingTypeName} receipt`,
        Debit: offering.TotalAmount,
        Credit: 0,
        Department: clean(mapping.Department) || 'Church',
        CostCentre: clean(mapping.CostCentre) || offering.BranchId
      },
      {
        AccountCode: creditAccount,
        Description: clean(mapping.IncomeDescription) || `${givingTypeName} income`,
        Debit: 0,
        Credit: offering.TotalAmount,
        Department: clean(mapping.Department) || 'Church',
        CostCentre: clean(mapping.CostCentre) || offering.BranchId
      }
    ],
    RecordedBy: offering.RecordedBy
  };
}
