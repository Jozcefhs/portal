const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export const RECORD_DESK_TYPES = Object.freeze([
  'students',
  'applicants',
  'staff',
  'members',
  'departments'
]);

const PASTORAL_ROLES = new Set(['Super Admin', 'Pastor']);

export function recordsDeskCapabilities(user = {}) {
  const allowed = new Set((user.allowedSections || []).map(clean).filter(Boolean));
  const edition = lower(user.edition || user.organisationEdition || user.organizationEdition) || 'school';
  const enabled = allowed.has('recordsDesk');
  const schoolEdition = edition === 'school';
  const organisationEdition = ['church', 'faith', 'organization'].includes(edition);
  return {
    enabled,
    edition,
    canSearchStudents: enabled && schoolEdition &&
      ['students', 'accounts', 'clinic', 'tuckShop'].some((section) => allowed.has(section)),
    canSearchApplicants: enabled && schoolEdition && allowed.has('admissions'),
    canSearchStaff: enabled && allowed.has('staffUsers') && clean(user.role) === 'Super Admin',
    canSearchMembers: enabled && organisationEdition && allowed.has('members'),
    canSearchDepartments: enabled && organisationEdition &&
      ['members', 'funds', 'offerings'].some((section) => allowed.has(section)),
    canViewStudentContact: allowed.has('students') || allowed.has('admissions'),
    canViewStudentFinance: allowed.has('accounts'),
    canViewStudentClinic: allowed.has('clinic'),
    canViewStudentWallet: allowed.has('tuckShop') || allowed.has('accounts'),
    canViewStaffSecurity: allowed.has('staffUsers') && clean(user.role) === 'Super Admin',
    canViewMemberContact: allowed.has('members'),
    canViewPastoralNotes: PASTORAL_ROLES.has(clean(user.role)),
    canViewDepartmentRoster: allowed.has('members'),
    canViewDepartmentFinance: allowed.has('funds') || allowed.has('offerings') || allowed.has('incomeAnalytics')
  };
}

export function allowedRecordsDeskTypes(capabilities = {}) {
  return [
    capabilities.canSearchStudents && 'students',
    capabilities.canSearchApplicants && 'applicants',
    capabilities.canSearchStaff && 'staff',
    capabilities.canSearchMembers && 'members',
    capabilities.canSearchDepartments && 'departments'
  ].filter(Boolean);
}

export function normalizeRecordsDeskQuery(value) {
  return lower(value).replace(/\s+/g, ' ').slice(0, 120);
}

export function recordsDeskLimit(value, fallback = 24) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(40, parsed);
}

export function recordReferenceKey(value) {
  return lower(value).replace(/[^a-z0-9]/g, '');
}

export function recordReferenceKeys(row = {}) {
  return [
    row.AccountRef,
    row.AdmissionNo,
    row.ApplicationReference,
    row.ApplicationID,
    row.MemberId,
    row.DepartmentId,
    row.Username,
    row.__id
  ].map(recordReferenceKey).filter(Boolean);
}

export function recordReferencesMatch(value, row = {}) {
  const wanted = recordReferenceKey(value);
  return Boolean(wanted && recordReferenceKeys(row).includes(wanted));
}

export function recordMatches(row = {}, query = '', fields = []) {
  const wanted = normalizeRecordsDeskQuery(query);
  if (!wanted) return false;
  const terms = wanted.split(' ').filter(Boolean);
  const haystack = fields.map((field) => clean(row[field])).filter(Boolean).join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function recordsDeskRank(card = {}, query = '') {
  const wanted = normalizeRecordsDeskQuery(query);
  const wantedRef = recordReferenceKey(wanted);
  const id = recordReferenceKey(card.id);
  const title = lower(card.title);
  if (wantedRef && id === wantedRef) return 0;
  if (title === wanted) return 1;
  if (title.startsWith(wanted)) return 2;
  if (id.startsWith(wantedRef)) return 3;
  return 4;
}

function card(type, id, title, subtitle, status, row = {}) {
  return {
    type,
    id: clean(id),
    title: clean(title) || clean(id) || 'Unnamed record',
    subtitle: clean(subtitle),
    status: clean(status) || 'Active',
    branchId: clean(row.BranchId || row.branchId || 'main').toLowerCase() || 'main',
    schoolSection: clean(row.SchoolSection || row.schoolSection)
  };
}

export function studentSearchCard(row = {}) {
  const id = clean(row.AdmissionNo || row.AccountRef || row.ApplicationReference || row.__id);
  return card(
    'students',
    id,
    row.DisplayName || row.ApplicantName || row.StudentName || row.Name,
    [id, row.ClassName, row.ClassArm, row.StudentType].map(clean).filter(Boolean).join(' · '),
    row.Status || row.AcademicProgress,
    row
  );
}

export function applicantSearchCard(row = {}) {
  const id = clean(row.ApplicationReference || row.ApplicationID || row.AdmissionNo || row.__id);
  return card(
    'applicants',
    id,
    row.ApplicantName || row.DisplayName || row.Name,
    [id, row.ClassApplyingFor || row.ClassAppliedFor, row.Email || row.VerificationEmail].map(clean).filter(Boolean).join(' · '),
    row.Status || row.ResultStatus || 'Application',
    row
  );
}

export function staffSearchCard(row = {}) {
  const id = clean(row.Username || row.username || row.__id);
  return card(
    'staff',
    id,
    row.DisplayName || row.displayName || id,
    [row.Role, row.Department, row.Position].map(clean).filter(Boolean).join(' · '),
    row.Active === undefined || !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(row.Active)) ? 'Active' : 'Disabled',
    row
  );
}

export function memberSearchCard(row = {}) {
  const id = clean(row.MemberId || row.memberId || row.__id);
  return card(
    'members',
    id,
    row.DisplayName || [row.FirstName, row.Surname].map(clean).filter(Boolean).join(' '),
    [id, row.Ministry, row.Phone].map(clean).filter(Boolean).join(' · '),
    row.MembershipStatus || row.Status,
    row
  );
}

export function departmentSearchCard(row = {}) {
  const id = clean(row.DepartmentId || row.departmentId || row.__id);
  return card(
    'departments',
    id,
    row.Name || row.DepartmentName,
    [id, row.DepartmentType, row.AreaZone].map(clean).filter(Boolean).join(' · '),
    row.Active === undefined || !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(row.Active)) ? 'Active' : 'Inactive',
    row
  );
}

const item = (label, value) => ({ label, value: clean(value) });
const nonEmpty = (rows) => rows.filter((row) => clean(row.value));

export function studentDetailProjection(row = {}, capabilities = {}) {
  const header = studentSearchCard(row);
  const sections = [{
    key: 'identity',
    title: 'Student identity',
    items: nonEmpty([
      item('Admission number', row.AdmissionNo || row.AccountRef),
      item('Class', [row.ClassName, row.ClassArm].map(clean).filter(Boolean).join(' ')),
      item('Student type', row.StudentType),
      item('Academic session', row.AcademicSession),
      item('Term', row.Term),
      item('Enrollment', row.EnrollmentCategory),
      item('Academic progress', row.AcademicProgress),
      item('Gender', row.Gender)
    ])
  }];
  if (capabilities.canViewStudentContact) {
    sections.push({
      key: 'contact',
      title: 'Parent or guardian',
      items: nonEmpty([
        item('Name', row.ParentName),
        item('Phone', row.ParentPhone),
        item('Email', row.ParentEmail),
        item('Area', row.CityArea || row.StateOfResidence)
      ])
    });
  }
  if (capabilities.canViewStudentClinic) {
    sections.push({
      key: 'medical',
      title: 'Medical and emergency',
      items: nonEmpty([
        item('Blood group', row.BloodGroup),
        item('Genotype', row.Genotype),
        item('Medical condition', row.MedicalCondition),
        item('Emergency contact', row.EmergencyContactName),
        item('Emergency phone', row.EmergencyContactPhone)
      ])
    });
  }
  return { ...header, sections };
}

export function applicantDetailProjection(row = {}) {
  const header = applicantSearchCard(row);
  return {
    ...header,
    sections: [{
      key: 'application',
      title: 'Application',
      items: nonEmpty([
        item('Reference', row.ApplicationReference || row.ApplicationID || row.__id),
        item('Class applying for', row.ClassApplyingFor || row.ClassAppliedFor),
        item('Student type', row.StudentType),
        item('Application status', row.Status),
        item('Admission decision', row.ResultStatus || row.AdmissionDecision),
        item('Submitted', row.SubmittedAt || row.Timestamp)
      ])
    }, {
      key: 'contact',
      title: 'Applicant contact',
      items: nonEmpty([
        item('Email', row.Email || row.VerificationEmail || row.ParentEmail),
        item('Phone', row.Phone || row.ParentPhone),
        item('Parent or guardian', row.ParentName)
      ])
    }]
  };
}

export function staffDetailProjection(row = {}, capabilities = {}) {
  const header = staffSearchCard(row);
  const sections = [{
    key: 'identity',
    title: 'Staff directory',
    items: nonEmpty([
      item('Username', row.Username || row.__id),
      item('Role', row.Role),
      item('Department', row.Department),
      item('Position', row.Position),
      item('Branch', row.BranchId),
      item('School section', row.SchoolSectionAccess)
    ])
  }];
  if (capabilities.canViewStaffSecurity) {
    sections.push({
      key: 'security',
      title: 'Account status',
      items: nonEmpty([
        item('Status', header.status),
        item('Last login', row.LastLoginAt),
        item('Password change required', row.MustChangePassword ? 'Yes' : 'No')
      ])
    });
  }
  return { ...header, sections };
}

export function memberDetailProjection(row = {}, capabilities = {}) {
  const header = memberSearchCard(row);
  const sections = [{
    key: 'membership',
    title: 'Membership',
    items: nonEmpty([
      item('Member ID', row.MemberId || row.__id),
      item('Status', row.MembershipStatus || row.Status),
      item('Membership date', row.MembershipDate),
      item('Ministry', row.Ministry),
      item('Baptism status', row.BaptismStatus),
      item('Occupation', row.Occupation)
    ])
  }];
  if (capabilities.canViewMemberContact) {
    sections.push({
      key: 'contact',
      title: 'Contact',
      items: nonEmpty([
        item('Phone', row.Phone),
        item('Email', row.Email),
        item('Address', row.Address),
        item('Area', row.CityArea),
        item('State', row.State),
        item('Emergency contact', row.EmergencyContactName),
        item('Emergency phone', row.EmergencyContactPhone)
      ])
    });
  }
  if (capabilities.canViewPastoralNotes && clean(row.PastoralNotes)) {
    sections.push({
      key: 'pastoral',
      title: 'Pastoral care',
      items: [item('Private note', row.PastoralNotes)]
    });
  }
  return { ...header, sections };
}

export function departmentDetailProjection(row = {}) {
  const header = departmentSearchCard(row);
  return {
    ...header,
    sections: [{
      key: 'structure',
      title: 'Department',
      items: nonEmpty([
        item('Department ID', row.DepartmentId || row.__id),
        item('Type', row.DepartmentType),
        item('Area or zone', row.AreaZone),
        item('Description', row.Description),
        item('Status', header.status)
      ])
    }]
  };
}
