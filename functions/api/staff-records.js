import {
  firestoreDocumentToObject,
  firestoreRequest,
  listCollection,
  requireFirestoreEnv,
  upsertDocument
} from '../lib/firestore.js';
import { CHURCH_COLLECTIONS, churchCollectionPath } from '../lib/church-foundation.js';
import { resolveMembershipBranch } from '../lib/church-membership.js';
import {
  allowedRecordsDeskTypes,
  applicantDetailProjection,
  applicantSearchCard,
  departmentDetailProjection,
  departmentSearchCard,
  donorDetailProjection,
  donorSearchCard,
  memberDetailProjection,
  memberSearchCard,
  normalizeRecordsDeskQuery,
  recordMatches,
  recordReferencesMatch,
  recordsDeskCapabilities,
  recordsDeskLimit,
  recordsDeskRank,
  staffDetailProjection,
  staffRecordMatchesEdition,
  staffSearchCard,
  studentDetailProjection,
  studentSearchCard
} from '../lib/records-desk.js';
import { listSchoolCollection, schoolCollectionPaths, schoolSectionFor } from '../lib/school-scope.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const number = (value) => {
  const parsed = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const SEARCH_FIELDS = Object.freeze({
  students: [
    'AdmissionNo', 'AccountRef', 'ApplicationReference', 'DisplayName', 'ApplicantName',
    'StudentName', 'ClassName', 'ClassArm', 'StudentType', 'ParentName'
  ],
  applicants: [
    'ApplicationReference', 'ApplicationID', 'AdmissionNo', 'ApplicantName', 'DisplayName',
    'ClassApplyingFor', 'ClassAppliedFor', 'Email', 'VerificationEmail', 'Phone', 'ParentPhone'
  ],
  staff: ['Username', 'DisplayName', 'Role', 'Department', 'Position'],
  members: ['MemberId', 'DisplayName', 'FirstName', 'MiddleName', 'Surname', 'Phone', 'Email', 'Ministry'],
  departments: ['DepartmentId', 'Name', 'DepartmentName', 'DepartmentType', 'AreaZone', 'Description'],
  donors: [
    'DonorId', 'DisplayName', 'DonorName', 'Email', 'DonorEmail', 'Phone', 'DonorPhone',
    'Address', 'DonationSearchText', 'GivingTypes', 'Currencies'
  ]
});
const ROW_CACHE_TTL_MS = 5000;
const ROW_CACHE_MAX_ENTRIES = 8;
const rowsCache = new Map();

function error(message, status = 400) {
  const failure = new Error(message);
  failure.status = status;
  return failure;
}

function safeId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
}

function assignedBranch(user = {}, requested = '', allowAll = false) {
  const assigned = lower(user.branchId);
  const wanted = lower(requested);
  if (assigned && wanted && assigned !== wanted) {
    throw error('This staff account is restricted to another branch.', 403);
  }
  if (assigned) return assigned;
  if (wanted) return wanted;
  return allowAll ? '' : 'main';
}

function visibleSchoolRecord(row, user, requestedBranch = '') {
  const branch = assignedBranch(user, requestedBranch, true);
  const section = lower(user.schoolSectionAccess || 'All');
  const branchAllowed = !branch || lower(row.BranchId || 'main') === branch;
  const sectionAllowed = section === 'all' || schoolSectionFor(row) === section;
  return branchAllowed && sectionAllowed;
}

function visibleStaffDirectoryRecord(row, user, requestedBranch = '') {
  if (!staffRecordMatchesEdition(row, user)) return false;
  const branch = assignedBranch(user, requestedBranch, true);
  const branchAllowed = !branch || lower(row.BranchId || 'main') === branch;
  if (!branchAllowed) return false;
  if (lower(user.edition) !== 'school') return true;
  const section = lower(user.schoolSectionAccess || 'All');
  const rowSection = lower(row.SchoolSectionAccess || row.SchoolSection || 'All');
  return section === 'all' || rowSection === 'all' || rowSection === section;
}

function searchFields(type, capabilities) {
  const fields = [...(SEARCH_FIELDS[type] || [])];
  if (type === 'students' && capabilities.canViewStudentContact) {
    fields.push('ParentPhone', 'ParentEmail');
  }
  if (type === 'students' && capabilities.canViewStudentWallet) {
    fields.push('WalletCardId');
  }
  if (type === 'donors' && capabilities.canViewDonorNotes) fields.push('Notes');
  return fields;
}

function searchCard(type, row) {
  if (type === 'students') return studentSearchCard(row);
  if (type === 'applicants') return applicantSearchCard(row);
  if (type === 'staff') return staffSearchCard(row);
  if (type === 'members') return memberSearchCard(row);
  if (type === 'donors') return donorSearchCard(row);
  return departmentSearchCard(row);
}

function donorContactKeys(row = {}) {
  const email = lower(row.Email || row.DonorEmail);
  const phone = clean(row.Phone || row.DonorPhone).replace(/[^0-9+]/g, '');
  const name = lower(row.DisplayName || row.DonorName || row.Name);
  return [
    name && email && `email:${name}|${email}`,
    name && phone && `phone:${name}|${phone}`,
    !email && !phone && name && `name:${name}`
  ].filter(Boolean);
}

export function donorDirectoryRows(registeredDonors = [], donations = [], branchId = 'main') {
  const rowsByKey = new Map();
  const contactIndex = new Map();
  const givingTypesByKey = new Map();
  const currenciesByKey = new Map();
  const addContactIndex = (key, row) => donorContactKeys(row).forEach((contact) => contactIndex.set(contact, key));
  registeredDonors.forEach((profile) => {
    const donorId = clean(profile.DonorId || profile.__id);
    if (!donorId) return;
    const key = `registered:${lower(donorId)}`;
    const row = {
      ...profile,
      __id: donorId,
      DonorId: donorId,
      BranchId: clean(profile.BranchId || branchId || 'main'),
      DonorType: 'Registered donor',
      Donations: [],
      ContributionCount: 0,
      DonationSearchText: '',
      GivingTypes: '',
      Currencies: ''
    };
    rowsByKey.set(key, row);
    addContactIndex(key, row);
  });
  donations.forEach((donation, index) => {
    const donorId = clean(donation.DonorId);
    const name = clean(donation.DonorName);
    const email = lower(donation.DonorEmail);
    const phone = clean(donation.DonorPhone);
    if (!donorId && !name && !email && !phone) return;
    const contactKey = donorContactKeys({ DisplayName: name, Email: email, Phone: phone })
      .map((candidate) => contactIndex.get(candidate)).find(Boolean);
    const occasionalIdentity = [name, email, phone.replace(/[^0-9+]/g, '')].map(lower).join('|');
    const key = donorId ? `registered:${lower(donorId)}` : contactKey || `occasional:${occasionalIdentity}`;
    let row = rowsByKey.get(key);
    if (!row) {
      const fallbackId = clean(donation.DonationId || donation.Reference || donation.__id || index + 1);
      const generatedId = donorId || `OCC-${safeId(occasionalIdentity || fallbackId)}`;
      row = {
        __id: generatedId,
        DonorId: generatedId,
        DisplayName: name || email || phone || 'Anonymous donor',
        Email: email,
        Phone: phone,
        BranchId: clean(donation.BranchId || branchId || 'main'),
        DonorType: donorId ? 'Registered donor' : 'Occasional donor',
        Active: 'YES',
        Donations: [],
        ContributionCount: 0,
        DonationSearchText: '',
        GivingTypes: '',
        Currencies: ''
      };
      rowsByKey.set(key, row);
    }
    row.DisplayName = clean(row.DisplayName || name || email || phone || 'Anonymous donor');
    row.Email = clean(row.Email || email);
    row.Phone = clean(row.Phone || phone);
    row.Donations.push(donation);
    row.ContributionCount = row.Donations.length;
    const contributionDate = clean(donation.PaidAt || donation.Date || donation.CreatedAt || donation.UpdatedAt);
    if (contributionDate && (!row.FirstContributionAt || contributionDate < row.FirstContributionAt)) row.FirstContributionAt = contributionDate;
    if (contributionDate && (!row.LatestContributionAt || contributionDate > row.LatestContributionAt)) row.LatestContributionAt = contributionDate;
    row.DonationSearchText = [row.DonationSearchText, [
      donation.DonationId, donation.Reference, donation.ReceiptNo, donation.PaymentReference,
      donation.PaymentType, donation.GivingTypeName, donation.PaymentMethod, donation.Status
    ].map(clean).filter(Boolean).join(' ')].filter(Boolean).join(' ');
    const givingTypes = givingTypesByKey.get(key) || new Set();
    const givingType = clean(donation.GivingTypeName || donation.PaymentType);
    if (givingType) givingTypes.add(givingType);
    givingTypesByKey.set(key, givingTypes);
    const currencies = currenciesByKey.get(key) || new Set();
    const currency = clean(donation.TransactionCurrency || donation.Currency || 'NGN').toUpperCase();
    if (currency) currencies.add(currency);
    currenciesByKey.set(key, currencies);
  });
  return [...rowsByKey.entries()].map(([key, row]) => ({
    ...row,
    GivingTypes: [...(givingTypesByKey.get(key) || [])].join(' '),
    Currencies: [...(currenciesByKey.get(key) || [])].join(' ')
  }));
}

async function rowsForType(env, user, type, branchId) {
  const cacheKey = [
    clean(env.FIREBASE_PROJECT_ID),
    lower(user.username),
    lower(user.edition),
    lower(user.branchId),
    lower(user.schoolSectionAccess || 'all'),
    lower(branchId),
    type
  ].join('|');
  const cached = rowsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  let rows;
  if (type === 'students') {
    rows = (await listSchoolCollection(env, 'students', {
      branchId: assignedBranch(user, branchId, true),
      schoolSectionAccess: user.schoolSectionAccess
    })).filter((row) => visibleSchoolRecord(row, user, branchId));
  } else if (type === 'applicants') {
    rows = (await listSchoolCollection(env, 'applications', {
      branchId: assignedBranch(user, branchId, true),
      schoolSectionAccess: user.schoolSectionAccess
    })).filter((row) => visibleSchoolRecord(row, user, branchId));
  } else if (type === 'staff') {
    rows = (await listCollection(env, 'staffUsers'))
      .filter((row) => visibleStaffDirectoryRecord(row, user, branchId))
      .map((row) => {
        const safe = { ...row };
        delete safe.PasswordHash;
        delete safe.Salt;
        delete safe.ProfilePhotoDataUrl;
        return safe;
      });
  } else if (type === 'donors') {
    const organisationBranch = resolveMembershipBranch(user, branchId);
    const [donors, donations] = await Promise.all([
      listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.donors, organisationBranch)),
      listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.donations, organisationBranch))
    ]);
    rows = donorDirectoryRows(donors, donations, organisationBranch);
  } else {
    const organisationBranch = resolveMembershipBranch(user, branchId);
    rows = type === 'members'
      ? await listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.members, organisationBranch))
      : await listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.departments, organisationBranch));
  }
  rowsCache.set(cacheKey, { rows, expiresAt: Date.now() + ROW_CACHE_TTL_MS });
  while (rowsCache.size > ROW_CACHE_MAX_ENTRIES) {
    rowsCache.delete(rowsCache.keys().next().value);
  }
  return rows;
}

async function writeAudit(env, user, action, details = {}) {
  const auditId = `RDS-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await upsertDocument(env, 'staffRecordsAudit', safeId(auditId), {
    AuditId: auditId,
    Timestamp: new Date().toISOString(),
    Action: clean(action).toUpperCase(),
    Actor: clean(user.displayName || user.username),
    ActorUsername: clean(user.username),
    ActorRole: clean(user.role),
    BranchId: clean(user.branchId || details.BranchId || 'all').toLowerCase() || 'all',
    EntityType: clean(details.EntityType),
    EntityId: clean(details.EntityId),
    Query: clean(details.Query).slice(0, 120),
    ResultCount: Math.max(0, Number(details.ResultCount || 0) || 0),
    SourcePlatform: 'Web Records Desk'
  });
}

function requestedTypes(body, availableTypes) {
  const supplied = Array.isArray(body.types)
    ? body.types
    : clean(body.type || body.RecordType).split(',');
  const wanted = supplied.map(lower).filter(Boolean);
  return wanted.length
    ? availableTypes.filter((type) => wanted.includes(type))
    : availableTypes;
}

async function searchRecords(env, user, body, capabilities) {
  const query = normalizeRecordsDeskQuery(body.query || body.search || body.Search);
  if (query.length < 3) throw error('Enter at least three characters to search the Records Desk.');
  const availableTypes = allowedRecordsDeskTypes(capabilities);
  const types = requestedTypes(body, availableTypes);
  if (!types.length) throw error('Your current role cannot search the selected record type.', 403);
  const limit = recordsDeskLimit(body.limit);
  const branchId = clean(body.branchId || body.BranchId);
  const groups = await Promise.all(types.map(async (type) => {
    const rows = await rowsForType(env, user, type, branchId);
    return rows
      .filter((row) => recordMatches(row, query, searchFields(type, capabilities)))
      .map((row) => searchCard(type, row));
  }));
  const matches = groups.flat().filter((row) => row.id).sort((left, right) => {
    const rank = recordsDeskRank(left, query) - recordsDeskRank(right, query);
    return rank || left.title.localeCompare(right.title);
  });
  const results = matches.slice(0, limit);
  return {
    ok: true,
    message: matches.length ? `${matches.length} matching record${matches.length === 1 ? '' : 's'} found.` : 'No matching records found.',
    query,
    availableTypes,
    totalMatches: matches.length,
    truncated: matches.length > results.length,
    results
  };
}

function referenceKeys(row = {}) {
  return [
    row.AccountRef,
    row.AdmissionNo,
    row.ApplicationReference,
    row.ApplicationID,
    row.__id
  ].map((value) => clean(value)).filter(Boolean);
}

function rowMatchesKeys(row, keys) {
  return keys.some((key) => [
    row.AccountRef,
    row.AdmissionNo,
    row.ApplicationReference,
    row.ApplicationID,
    row.StudentRef,
    row.__id
  ].some((candidate) => recordReferencesMatch(candidate, { __id: key })));
}

function studentLogicalIdentity(row = {}) {
  const documentName = clean(row.__name);
  if (documentName) return documentName;
  return [
    clean(row.__scopePath),
    clean(row.__id),
    clean(row.AdmissionNo || row.AccountRef || row.ApplicationReference || row.ApplicationID),
    clean(row.DisplayName || row.ApplicantName || row.StudentName)
  ].map(lower).join('::');
}

async function legacyStudentReferenceIsUnique(env, selected) {
  const keys = referenceKeys(selected);
  if (!keys.length) return false;
  const paths = await schoolCollectionPaths(env, 'students');
  const matches = new Map([[studentLogicalIdentity(selected), selected]]);
  // The detail request has already read every school scope and still needs its
  // activity collections plus the audit write. Keep the full legacy scan inside
  // the Pages Free-plan subrequest ceiling; exhausting this budget fails closed.
  let remainingRequests = Math.min(12, Math.max(0, 38 - paths.length));
  if (!remainingRequests) return false;
  for (const path of paths) {
    let pageToken = '';
    do {
      if (remainingRequests <= 0) return false;
      const params = new URLSearchParams({ pageSize: '500' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await firestoreRequest(env, `${path}?${params.toString()}`);
      remainingRequests -= 1;
      (page.documents || [])
        .map(firestoreDocumentToObject)
        .map((row) => ({ ...row, __scopePath: path }))
        .filter((row) => rowMatchesKeys(row, keys))
        .forEach((row) => matches.set(studentLogicalIdentity(row), row));
      if (matches.size > 1) return false;
      pageToken = clean(page.nextPageToken);
    } while (pageToken);
  }
  return matches.size === 1;
}

function recent(rows, dateFields, limit = 8) {
  return [...rows].sort((left, right) => {
    const leftDate = dateFields.map((field) => clean(left[field])).find(Boolean) || '';
    const rightDate = dateFields.map((field) => clean(right[field])).find(Boolean) || '';
    return rightDate.localeCompare(leftDate);
  }).slice(0, limit);
}

function activity(title, rows) {
  return rows.length ? { title, rows } : null;
}

function studentActions(user, student) {
  const allowed = new Set(user.allowedSections || []);
  const id = clean(student.AdmissionNo || student.AccountRef || student.__id);
  const faceLookupEnabled = user.biometricLookupEnabled === true ||
    ['yes', 'true', '1', 'enabled'].includes(lower(user.biometricLookupEnabled));
  const canManageFaceTemplate = faceLookupEnabled &&
    ['Super Admin', 'Principal', 'Admissions Officer'].includes(clean(user.role));
  return [
    allowed.has('students') && { id: 'student-profile', label: 'Edit profile', targetSection: 'students', context: { AccountRef: id } },
    allowed.has('accounts') && { id: 'student-finance', label: 'Open Finance', targetSection: 'accounts', context: { AccountRef: id } },
    allowed.has('clinic') && { id: 'student-clinic', label: 'Open Clinic', targetSection: 'clinic', context: { AccountRef: id } },
    allowed.has('tuckShop') && { id: 'student-wallet', label: 'Open Wallet Purchase', targetSection: 'tuckShop', context: { AccountRef: id } },
    allowed.has('studentConduct') && { id: 'student-conduct', label: 'Open Conduct & Discipline', targetSection: 'studentConduct', context: { AccountRef: id } },
    canManageFaceTemplate && {
      id: 'student-face-enroll',
      label: 'Face enrollment',
      context: {
        AccountRef: id,
        StudentName: clean(student.DisplayName || student.ApplicantName || student.StudentName || student.Name),
        BranchId: clean(student.BranchId || 'main'),
        SchoolSection: schoolSectionFor(student)
      }
    }
  ].filter(Boolean);
}

async function studentDetail(env, user, row, capabilities) {
  const detail = studentDetailProjection(row, capabilities);
  const keys = referenceKeys(row);
  const allowed = new Set(user.allowedSections || []);
  const selectedBranch = lower(row.BranchId || 'main') || 'main';
  const selectedSection = lower(schoolSectionFor(row));
  const [payments, invoices, ledger, clinicRecords, storeOrders, conductRecords] = await Promise.all([
    capabilities.canViewStudentFinance ? listCollection(env, 'payments') : Promise.resolve([]),
    capabilities.canViewStudentFinance ? listCollection(env, 'invoices') : Promise.resolve([]),
    capabilities.canViewStudentFinance || capabilities.canViewStudentWallet ? listCollection(env, 'ledger') : Promise.resolve([]),
    capabilities.canViewStudentClinic ? listCollection(env, 'clinicRecords') : Promise.resolve([]),
    ['bookstore', 'uniformStore', 'tuckShop'].some((section) => allowed.has(section))
      ? listCollection(env, 'storeOrders')
      : Promise.resolve([]),
    capabilities.canViewStudentConduct
      ? listSchoolCollection(env, 'studentConductCases', {
        branchId: selectedBranch,
        schoolSectionAccess: user.schoolSectionAccess
      })
      : Promise.resolve([])
  ]);
  const activityRows = [...payments, ...invoices, ...ledger, ...clinicRecords, ...storeOrders, ...conductRecords];
  const hasLegacyActivity = activityRows.some((item) =>
    (!clean(item.BranchId) || !clean(item.SchoolSection || item.schoolSection)) &&
    rowMatchesKeys(item, keys));
  const legacyReferenceIsSafe = hasLegacyActivity
    ? await legacyStudentReferenceIsUnique(env, row).catch(() => false)
    : false;
  const scoped = (rows) => rows.filter((item) => {
    if (!rowMatchesKeys(item, keys)) return false;
    const itemBranch = lower(item.BranchId);
    if (itemBranch && itemBranch !== selectedBranch) return false;
    if (!itemBranch && !legacyReferenceIsSafe) return false;
    const itemSection = clean(item.SchoolSection || item.schoolSection)
      ? lower(schoolSectionFor(item))
      : '';
    if (!itemSection && !legacyReferenceIsSafe) return false;
    return !selectedSection || itemSection === selectedSection || !itemSection;
  });
  const studentPayments = scoped(payments);
  const studentInvoices = scoped(invoices);
  const studentLedger = scoped(ledger);
  const walletRows = studentLedger.filter((item) =>
    lower(item.FeeCategory) === 'wallet' || lower(item.EntryType).includes('wallet'));
  const metrics = [];
  const activities = [];
  if (capabilities.canViewStudentFinance) {
    const billed = studentInvoices.reduce((sum, item) => sum + number(item.Debit || item.Amount), 0);
    const paid = studentPayments.reduce((sum, item) => sum + number(item.Amount || item.Credit), 0);
    const outstanding = studentInvoices.reduce((sum, item) => {
      if (item.Balance !== undefined && item.Balance !== '') return sum + Math.max(0, number(item.Balance));
      return sum + Math.max(0, number(item.Debit || item.Amount) - number(item.Credit || item.PaidAmount));
    }, 0);
    metrics.push(
      { label: 'Invoiced', value: billed, format: 'money' },
      { label: 'Paid', value: paid, format: 'money' },
      { label: 'Outstanding', value: outstanding, format: 'money' }
    );
    activities.push(activity('Recent payments', recent(studentPayments, ['PaidAt', 'Date', 'RecordedAt']).map((item) => ({
      title: clean(item.FeeName || item.FeeCode || 'Payment'),
      meta: [item.PaidAt || item.Date, item.Reference].map(clean).filter(Boolean).join(' · '),
      amount: number(item.Amount || item.Credit),
      status: clean(item.Status || 'Paid')
    }))));
  }
  if (capabilities.canViewStudentWallet) {
    const balance = walletRows.reduce((sum, item) => sum + number(item.Credit) - number(item.Debit), 0);
    metrics.push({ label: 'Wallet balance', value: balance, format: 'money' });
    activities.push(activity('Wallet activity', recent(walletRows, ['Date', 'CreatedAt']).map((item) => ({
      title: clean(item.Description || item.FeeName || item.EntryType || 'Wallet activity'),
      meta: clean(item.Date || item.CreatedAt),
      amount: number(item.Credit) - number(item.Debit),
      status: clean(item.EntryType)
    }))));
  }
  if (capabilities.canViewStudentClinic) {
    activities.push(activity('Clinic visits', recent(scoped(clinicRecords), ['Date', 'CreatedAt']).map((item) => ({
      title: clean(item.Complaint || item.Reason || 'Clinic visit'),
      meta: [item.Date, item.Disposition].map(clean).filter(Boolean).join(' · '),
      status: clean(item.Treatment)
    }))));
  }
  if (storeOrders.length) {
    activities.push(activity('Store orders', recent(scoped(storeOrders), ['CreatedAt', 'Date']).map((item) => ({
      title: clean(item.Description || item.StoreType || item.OrderNo || 'Store order'),
      meta: clean(item.CreatedAt || item.Date),
      amount: number(item.Amount || item.TotalAmount),
      status: clean(item.Status)
    }))));
  }
  if (capabilities.canViewStudentConduct) {
    const cases = recent(scoped(conductRecords), ['IncidentDate', 'UpdatedAt', 'CreatedAt']);
    activities.push({
      title: 'Conduct & discipline',
      rows: cases.length
        ? cases.map((item) => ({
          title: clean(item.Summary || item.Category || item.CaseId || 'Conduct case'),
          meta: [
            item.IncidentDate,
            item.Category,
            item.Severity ? `${clean(item.Severity)} severity` : '',
            item.Status
          ].map(clean).filter(Boolean).join(' · '),
          detail: [
            item.Sanction ? `Measure: ${clean(item.Sanction)}` : '',
            item.Resolution ? `Resolution: ${clean(item.Resolution)}` : ''
          ].filter(Boolean).join(' · ')
        }))
        : [{
          title: 'No conduct cases recorded',
          meta: 'No disciplinary record in your permitted school scope.'
        }]
    });
  }
  return {
    ...detail,
    metrics,
    activities: activities.filter(Boolean),
    actions: studentActions(user, row)
  };
}

function countUploadedDocuments(row = {}) {
  const values = row.UploadedDocuments || row.Documents || row.DocumentLinks;
  if (Array.isArray(values)) return values.filter(Boolean).length;
  if (values && typeof values === 'object') return Object.values(values).filter(Boolean).length;
  return [
    row.BirthCertificateUrl,
    row.PreviousResultUrl,
    row.PassportPhotoUrl,
    row.MedicalReportUrl
  ].filter(Boolean).length;
}

function applicantDetail(user, row) {
  const detail = applicantDetailProjection(row);
  return {
    ...detail,
    metrics: [
      { label: 'Uploaded documents', value: countUploadedDocuments(row) },
      { label: 'Application status', value: clean(row.Status || 'Application') },
      { label: 'Admission decision', value: clean(row.ResultStatus || row.AdmissionDecision || 'Pending') }
    ],
    activities: [],
    actions: (user.allowedSections || []).includes('admissions')
      ? [{ id: 'applicant-review', label: 'Open Admissions', targetSection: 'admissions', context: { ApplicationReference: detail.id } }]
      : []
  };
}

function staffDetail(user, row, capabilities) {
  const detail = staffDetailProjection(row, capabilities);
  return {
    ...detail,
    metrics: [
      { label: 'Role', value: clean(row.Role || 'Front Desk') },
      { label: 'Department', value: clean(row.Department || 'Not assigned') },
      { label: 'Account', value: detail.status }
    ],
    activities: [],
    actions: capabilities.canViewStaffSecurity
      ? [{ id: 'staff-account', label: 'Manage staff account', targetSection: 'staffUsers', context: { Username: detail.id } }]
      : []
  };
}

async function memberDetail(env, user, row, capabilities, branchId) {
  const detail = memberDetailProjection(row, capabilities);
  const memberId = clean(row.MemberId || row.__id);
  const path = (collection) => churchCollectionPath(collection, branchId);
  const [memberships, departments, positions, departmentAttendance, serviceAttendance] = await Promise.all([
    listCollection(env, path(CHURCH_COLLECTIONS.departmentMembers)),
    listCollection(env, path(CHURCH_COLLECTIONS.departments)),
    listCollection(env, path(CHURCH_COLLECTIONS.departmentPositions)),
    listCollection(env, path(CHURCH_COLLECTIONS.departmentAttendance)),
    listCollection(env, path(CHURCH_COLLECTIONS.attendance))
  ]);
  const assignments = memberships.filter((item) => recordReferencesMatch(item.MemberId, { __id: memberId }));
  const departmentMap = new Map(departments.map((item) => [clean(item.DepartmentId || item.__id), clean(item.Name)]));
  const positionMap = new Map(positions.map((item) => [clean(item.PositionId || item.__id), clean(item.Name)]));
  if (capabilities.canViewDepartmentRoster && assignments.length) {
    detail.sections.push({
      key: 'responsibilities',
      title: 'Department responsibilities',
      items: assignments.slice(0, 12).map((item) => ({
        label: departmentMap.get(clean(item.DepartmentId)) || clean(item.DepartmentName || item.DepartmentId),
        value: positionMap.get(clean(item.PositionId)) || clean(item.PositionName || item.PositionId || item.Status)
      }))
    });
  }
  const attendanceCount = [...departmentAttendance, ...serviceAttendance].filter((item) =>
    recordReferencesMatch(item.MemberId || item.AttendeeMemberId, { __id: memberId })).length;
  return {
    ...detail,
    metrics: [
      { label: 'Departments', value: assignments.length },
      { label: 'Attendance records', value: attendanceCount },
      { label: 'Membership', value: detail.status }
    ],
    activities: [],
    actions: (user.allowedSections || []).includes('members')
      ? [{ id: 'member-directory', label: 'Open Members & Departments', targetSection: 'members', context: { MemberId: memberId } }]
      : []
  };
}

async function departmentDetail(env, user, row, capabilities, branchId) {
  const detail = departmentDetailProjection(row);
  const departmentId = clean(row.DepartmentId || row.__id);
  const path = (collection) => churchCollectionPath(collection, branchId);
  const [memberships, members, positions, meetings, attendance, offerings] = await Promise.all([
    listCollection(env, path(CHURCH_COLLECTIONS.departmentMembers)),
    capabilities.canViewDepartmentRoster
      ? listCollection(env, path(CHURCH_COLLECTIONS.members))
      : Promise.resolve([]),
    listCollection(env, path(CHURCH_COLLECTIONS.departmentPositions)),
    listCollection(env, path(CHURCH_COLLECTIONS.departmentMeetings)),
    listCollection(env, path(CHURCH_COLLECTIONS.departmentAttendance)),
    capabilities.canViewDepartmentFinance
      ? listCollection(env, path(CHURCH_COLLECTIONS.departmentOfferings))
      : Promise.resolve([])
  ]);
  const departmentMembers = memberships.filter((item) => clean(item.DepartmentId) === departmentId);
  const departmentMeetings = meetings.filter((item) => clean(item.DepartmentId) === departmentId);
  const meetingIds = new Set(departmentMeetings.map((item) => clean(item.MeetingId || item.__id)));
  const departmentAttendance = attendance.filter((item) => meetingIds.has(clean(item.MeetingId)));
  const departmentOfferings = offerings.filter((item) => clean(item.DepartmentId) === departmentId);
  if (capabilities.canViewDepartmentRoster && departmentMembers.length) {
    const memberMap = new Map(members.map((item) => [clean(item.MemberId || item.__id), clean(item.DisplayName)]));
    const positionMap = new Map(positions.map((item) => [clean(item.PositionId || item.__id), clean(item.Name)]));
    detail.sections.push({
      key: 'roster',
      title: 'Department roster',
      items: departmentMembers.slice(0, 20).map((item) => ({
        label: memberMap.get(clean(item.MemberId)) || clean(item.MemberName || item.MemberId),
        value: positionMap.get(clean(item.PositionId)) || clean(item.PositionName || item.Status)
      }))
    });
  }
  const metrics = [
    { label: 'Members', value: departmentMembers.length },
    { label: 'Meetings', value: departmentMeetings.length },
    { label: 'Attendance', value: departmentAttendance.length }
  ];
  if (capabilities.canViewDepartmentFinance) {
    metrics.push({
      label: 'Offerings',
      value: departmentOfferings.reduce((sum, item) => sum + number(item.Amount), 0),
      format: 'money'
    });
  }
  const allowed = new Set(user.allowedSections || []);
  return {
    ...detail,
    metrics,
    activities: [
      activity('Recent meetings', recent(departmentMeetings, ['Date', 'CreatedAt']).map((item) => ({
        title: clean(item.Title || item.MeetingId || 'Department meeting'),
        meta: [item.Date, item.Location].map(clean).filter(Boolean).join(' · '),
        status: clean(item.Status)
      })))
    ].filter(Boolean),
    actions: [
      allowed.has('members') && { id: 'department-manage', label: 'Manage department', targetSection: 'members', context: { DepartmentId: departmentId } },
      allowed.has('offerings') && { id: 'department-offering', label: 'Open Offerings', targetSection: 'offerings', context: { DepartmentId: departmentId } }
    ].filter(Boolean)
  };
}

function donorDetail(user, row, capabilities) {
  const detail = donorDetailProjection(row, capabilities);
  const contributions = Array.isArray(row.Donations) ? row.Donations : [];
  const paid = contributions.filter((item) => ['paid', 'completed'].includes(lower(item.Status || item.PaymentStatus)));
  const settledNgn = paid.reduce((sum, item) => {
    const currency = clean(item.TransactionCurrency || item.Currency || 'NGN').toUpperCase();
    if (currency === 'NGN') return sum + number(item.BaseAmount || item.Amount);
    return lower(item.ConversionStatus) === 'converted' ? sum + number(item.BaseAmount) : sum;
  }, 0);
  const foreignByCurrency = new Map();
  paid.forEach((item) => {
    const currency = clean(item.TransactionCurrency || item.Currency || 'NGN').toUpperCase();
    if (currency === 'NGN') return;
    const current = foreignByCurrency.get(currency) || { amount: 0, count: 0 };
    current.amount += number(item.Amount);
    current.count += 1;
    foreignByCurrency.set(currency, current);
  });
  if (foreignByCurrency.size) {
    detail.sections.push({
      key: 'foreign-giving',
      title: 'Foreign-currency giving',
      items: [...foreignByCurrency.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, value]) => ({
        label: currency,
        value: `${value.amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${value.count} contribution${value.count === 1 ? '' : 's'}`
      }))
    });
  }
  return {
    ...detail,
    metrics: [
      { label: 'Contributions', value: contributions.length },
      { label: 'Paid', value: paid.length },
      { label: 'Settled NGN', value: settledNgn, format: 'money' }
    ],
    activities: [
      activity('Recent contributions', recent(contributions, ['PaidAt', 'Date', 'CreatedAt', 'UpdatedAt'], 12).map((item) => ({
        title: clean(item.GivingTypeName || item.PaymentType || 'Donation'),
        meta: [
          item.PaidAt || item.Date || item.CreatedAt,
          item.DonationId || item.Reference || item.ReceiptNo,
          item.PaymentMethod,
          item.Status || item.PaymentStatus
        ].map(clean).filter(Boolean).join(' Â· '),
        amount: number(item.Amount),
        currency: clean(item.TransactionCurrency || item.Currency || 'NGN').toUpperCase()
      })))
    ].filter(Boolean),
    actions: (user.allowedSections || []).includes('donations')
      ? [{ id: 'donor-giving', label: 'Open Donations', targetSection: 'donations', context: { DonorId: detail.id } }]
      : []
  };
}

async function detailRecord(env, user, body, capabilities) {
  const type = lower(body.type || body.RecordType);
  const id = clean(body.id || body.RecordId);
  const availableTypes = allowedRecordsDeskTypes(capabilities);
  if (!availableTypes.includes(type)) throw error('Your current role cannot view that record type.', 403);
  if (!id) throw error('Choose a record to view.');
  const requestedBranch = clean(body.branchId || body.BranchId);
  const rows = await rowsForType(env, user, type, requestedBranch);
  const row = rows.find((item) => recordReferencesMatch(id, item));
  if (!row) throw error('The selected record was not found in your permitted scope.', 404);
  let detail;
  if (type === 'students') detail = await studentDetail(env, user, row, capabilities);
  else if (type === 'applicants') detail = applicantDetail(user, row);
  else if (type === 'staff') detail = staffDetail(user, row, capabilities);
  else if (type === 'donors') detail = donorDetail(user, row, capabilities);
  else {
    const branchId = resolveMembershipBranch(user, requestedBranch || row.BranchId);
    detail = type === 'members'
      ? await memberDetail(env, user, row, capabilities, branchId)
      : await departmentDetail(env, user, row, capabilities, branchId);
  }
  await writeAudit(env, user, 'VIEW', {
    BranchId: requestedBranch || row.BranchId,
    EntityType: type,
    EntityId: id,
    ResultCount: 1
  });
  return { ok: true, message: 'Record details loaded.', availableTypes, detail };
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const capabilities = recordsDeskCapabilities(user);
    if (!capabilities.enabled) throw error('This staff account is not allowed to use the Records Desk.', 403);
    const body = await readJsonBody(request, { maxBytes: 128 * 1024 });
    const action = lower(body.action || 'search');
    const data = action === 'search'
      ? await searchRecords(env, user, body, capabilities)
      : action === 'detail'
        ? await detailRecord(env, user, body, capabilities)
        : (() => { throw error('Choose a valid Records Desk action.'); })();
    return Response.json(data, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
    });
  } catch (failure) {
    return Response.json({ ok: false, message: failure.message || String(failure) }, {
      status: failure.status || 500,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
    });
  }
}
