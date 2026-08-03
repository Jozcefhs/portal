const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export const HR_ROLE_GROUPS = Object.freeze({
  leadership: Object.freeze(['HR Director', 'HR Manager']),
  operations: Object.freeze([
    'HR Business Partner',
    'HR Officer',
    'HR Assistant',
    'Recruitment Officer',
    'Learning & Development Officer',
    'Employee Relations Officer',
    'Performance Management Officer',
    'Compensation & Benefits Officer',
    'Payroll Officer',
    'Health & Safety Officer'
  ]),
  supervisors: Object.freeze(['Line Manager'])
});

export const HUMAN_RESOURCES_ROLES = Object.freeze([
  ...HR_ROLE_GROUPS.leadership,
  ...HR_ROLE_GROUPS.operations,
  ...HR_ROLE_GROUPS.supervisors
]);

const HR_ROLE_SET = new Set(HUMAN_RESOURCES_ROLES);
const HR_LEADERS = new Set(['Super Admin', ...HR_ROLE_GROUPS.leadership]);
const HR_GENERALISTS = new Set([...HR_LEADERS, 'HR Business Partner', 'HR Officer']);

export function humanResourcesRole(role) {
  return HR_ROLE_SET.has(clean(role));
}

export function hrCapabilitiesFor(user = {}) {
  const role = clean(user.role || user.Role);
  const generalist = HR_GENERALISTS.has(role);
  const leader = HR_LEADERS.has(role);
  const executive = ['Principal', 'Management', 'Senior Pastor', 'Head Minister', 'Church Administrator'].includes(role);
  return {
    canViewDirectory: generalist || executive || ['HR Assistant', 'Line Manager', 'Payroll Officer', 'Compensation & Benefits Officer', 'Learning & Development Officer', 'Employee Relations Officer', 'Performance Management Officer', 'Health & Safety Officer'].includes(role),
    canManagePeople: generalist || role === 'HR Assistant',
    canManageLeave: generalist || ['HR Assistant', 'Employee Relations Officer'].includes(role),
    canApproveLeave: leader || executive || role === 'Line Manager' || role === 'Employee Relations Officer',
    canManageRecruitment: generalist || ['HR Assistant', 'Recruitment Officer'].includes(role),
    canManagePerformance: generalist || ['Employee Relations Officer', 'Performance Management Officer', 'Line Manager'].includes(role),
    canManageTraining: generalist || ['Learning & Development Officer', 'Health & Safety Officer'].includes(role),
    canManageEmploymentHistory: generalist || role === 'HR Assistant',
    canManageCompensation: generalist || role === 'Compensation & Benefits Officer',
    canReviewCompensation: leader || executive || role === 'Payroll Officer',
    canManageTime: generalist || ['HR Assistant', 'Employee Relations Officer', 'Line Manager'].includes(role),
    canManageRelations: generalist || ['Employee Relations Officer', 'Health & Safety Officer'].includes(role),
    canManageDiscipline: generalist || role === 'Employee Relations Officer',
    canManageCompliance: generalist || ['Health & Safety Officer', 'Compensation & Benefits Officer', 'Payroll Officer'].includes(role),
    canManageExit: generalist || role === 'Employee Relations Officer',
    canSeeAllHrRecords: generalist || executive
  };
}

export function safeHrStaffUser(row = {}) {
  return {
    Username: clean(row.Username || row.username || row.__id),
    DisplayName: clean(row.DisplayName || row.displayName || row.Username || row.username || row.__id),
    Role: clean(row.Role || row.role),
    Department: clean(row.Department || row.department),
    BranchId: clean(row.BranchId || row.branchId),
    Email: clean(row.Email || row.email),
    Phone: clean(row.Phone || row.phone),
    Active: row.Active === undefined ? true : !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(row.Active))
  };
}

function required(value, label) {
  const result = clean(value);
  if (!result) {
    const error = new Error(`${label} is required.`);
    error.status = 400;
    throw error;
  }
  return result;
}

function option(value, allowed, fallback, label) {
  const selected = clean(value || fallback);
  if (!allowed.includes(selected)) {
    const error = new Error(`Choose a valid ${label}.`);
    error.status = 400;
    throw error;
  }
  return selected;
}

function optionalMoney(value, label) {
  if (clean(value) === '') return 0;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000000000) {
    const error = new Error(`${label} must be zero or a valid positive amount.`);
    error.status = 400;
    throw error;
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function normalizeHrEmployee(input = {}, existing = {}) {
  const username = lower(input.Username || input.username || existing.Username);
  return {
    EmployeeId: clean(input.EmployeeId || existing.EmployeeId),
    Username: required(username, 'Staff username'),
    DisplayName: required(input.DisplayName || existing.DisplayName || username, 'Staff name'),
    Position: clean(input.Position || existing.Position),
    Department: clean(input.Department || existing.Department),
    EmploymentType: clean(input.EmploymentType || existing.EmploymentType || 'Permanent'),
    HireDate: clean(input.HireDate || existing.HireDate),
    ManagerUsername: lower(input.ManagerUsername || existing.ManagerUsername),
    WorkEmail: clean(input.WorkEmail || existing.WorkEmail),
    Phone: clean(input.Phone || existing.Phone),
    EmergencyContact: clean(input.EmergencyContact || existing.EmergencyContact),
    Status: clean(input.Status || existing.Status || 'Active')
  };
}

export function leaveDays(startDate, endDate) {
  const start = new Date(`${clean(startDate)}T00:00:00Z`);
  const end = new Date(`${clean(endDate)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

export function normalizeHrLeave(input = {}, actor = {}, existing = {}) {
  const startDate = required(input.StartDate || existing.StartDate, 'Leave start date');
  const endDate = required(input.EndDate || existing.EndDate, 'Leave end date');
  const days = leaveDays(startDate, endDate);
  if (!days) {
    const error = new Error('Leave end date must be on or after the start date.');
    error.status = 400;
    throw error;
  }
  const username = lower(input.Username || existing.Username || actor.username || actor.Username);
  return {
    Username: required(username, 'Staff username'),
    DisplayName: clean(input.DisplayName || existing.DisplayName || actor.displayName || actor.DisplayName || username),
    LeaveType: clean(input.LeaveType || existing.LeaveType || 'Annual leave'),
    StartDate: startDate,
    EndDate: endDate,
    Days: days,
    Reason: required(input.Reason || existing.Reason, 'Leave reason'),
    Status: clean(existing.Status || 'Pending')
  };
}

export function normalizeHrVacancy(input = {}, existing = {}) {
  const openings = Math.max(1, Math.round(Number(input.Openings ?? existing.Openings ?? 1) || 1));
  return {
    Title: required(input.Title || existing.Title, 'Job title'),
    Department: required(input.Department || existing.Department, 'Department'),
    EmploymentType: clean(input.EmploymentType || existing.EmploymentType || 'Permanent'),
    Openings: openings,
    ClosingDate: clean(input.ClosingDate || existing.ClosingDate),
    Status: clean(input.Status || existing.Status || 'Open'),
    Description: clean(input.Description || existing.Description)
  };
}

export function normalizeHrReview(input = {}, existing = {}) {
  const rating = Number(input.Rating ?? existing.Rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    const error = new Error('Performance rating must be between 1 and 5.');
    error.status = 400;
    throw error;
  }
  return {
    Username: required(lower(input.Username || existing.Username), 'Staff username'),
    DisplayName: clean(input.DisplayName || existing.DisplayName),
    ReviewPeriod: required(input.ReviewPeriod || existing.ReviewPeriod, 'Review period'),
    Rating: rating,
    Strengths: clean(input.Strengths || existing.Strengths),
    DevelopmentAreas: clean(input.DevelopmentAreas || existing.DevelopmentAreas),
    Goals: clean(input.Goals || existing.Goals),
    Status: clean(input.Status || existing.Status || 'Completed')
  };
}

export function normalizeHrTraining(input = {}, existing = {}) {
  return {
    Username: required(lower(input.Username || existing.Username), 'Staff username'),
    DisplayName: clean(input.DisplayName || existing.DisplayName),
    Course: required(input.Course || existing.Course, 'Course or programme'),
    Provider: clean(input.Provider || existing.Provider),
    CompletionDate: clean(input.CompletionDate || existing.CompletionDate),
    Status: clean(input.Status || existing.Status || 'Planned'),
    CertificateReference: clean(input.CertificateReference || existing.CertificateReference)
  };
}

export function normalizeHrCandidate(input = {}, existing = {}) {
  const email = lower(input.Email || existing.Email);
  const phone = clean(input.Phone || existing.Phone);
  if (!email && !phone) {
    const error = new Error('Candidate email or phone is required.');
    error.status = 400;
    throw error;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('Enter a valid candidate email address.');
    error.status = 400;
    throw error;
  }
  return {
    VacancyId: required(input.VacancyId || existing.VacancyId, 'Vacancy'),
    CandidateName: required(input.CandidateName || existing.CandidateName, 'Candidate name'),
    Email: email,
    Phone: phone,
    ApplicationDate: clean(input.ApplicationDate || existing.ApplicationDate),
    ApplicationReference: clean(input.ApplicationReference || existing.ApplicationReference),
    QualificationSummary: clean(input.QualificationSummary || existing.QualificationSummary),
    InterviewDate: clean(input.InterviewDate || existing.InterviewDate),
    InterviewPanel: clean(input.InterviewPanel || existing.InterviewPanel),
    InterviewNotes: clean(input.InterviewNotes || existing.InterviewNotes),
    QualificationCheck: option(input.QualificationCheck || existing.QualificationCheck, ['Pending', 'Verified', 'Failed', 'Not required'], 'Pending', 'qualification check status'),
    ReferenceCheck: option(input.ReferenceCheck || existing.ReferenceCheck, ['Pending', 'Verified', 'Failed', 'Not required'], 'Pending', 'reference check status'),
    Status: option(input.Status || existing.Status, ['Applied', 'Screening', 'Interview', 'Offer', 'Selected', 'Rejected', 'Withdrawn'], 'Applied', 'candidate status')
  };
}

export function normalizeHrEmploymentHistory(input = {}, existing = {}) {
  const effectiveDate = required(input.EffectiveDate || existing.EffectiveDate, 'Effective date');
  const expiryDate = clean(input.ExpiryDate || existing.ExpiryDate);
  if (expiryDate && expiryDate < effectiveDate) {
    const error = new Error('Expiry date must be on or after the effective date.');
    error.status = 400;
    throw error;
  }
  return {
    Username: required(lower(input.Username || existing.Username), 'Staff username'),
    DisplayName: clean(input.DisplayName || existing.DisplayName),
    RecordType: option(input.RecordType || existing.RecordType, ['Contract', 'Qualification', 'Promotion', 'Transfer', 'Award', 'Employment document', 'Other'], 'Employment document', 'employment record type'),
    Title: required(input.Title || existing.Title, 'Record title'),
    EffectiveDate: effectiveDate,
    ExpiryDate: expiryDate,
    DocumentReference: clean(input.DocumentReference || existing.DocumentReference),
    Notes: clean(input.Notes || existing.Notes)
  };
}

export function normalizeHrCompensationChange(input = {}, existing = {}) {
  const currency = clean(input.Currency || existing.Currency || 'NGN').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    const error = new Error('Currency must be a three-letter code such as NGN or USD.');
    error.status = 400;
    throw error;
  }
  return {
    Username: required(lower(input.Username || existing.Username), 'Staff username'),
    DisplayName: clean(input.DisplayName || existing.DisplayName),
    ChangeType: option(input.ChangeType || existing.ChangeType, ['Salary adjustment', 'Allowance', 'Bonus', 'Pension', 'Deduction', 'Benefit', 'Other'], 'Benefit', 'pay or benefit change type'),
    Amount: optionalMoney(input.Amount ?? existing.Amount, 'Amount'),
    Currency: currency,
    EffectiveDate: required(input.EffectiveDate || existing.EffectiveDate, 'Effective date'),
    Details: required(input.Details || existing.Details, 'Change details'),
    Status: clean(existing.Status || 'Pending')
  };
}

export function normalizeHrTimeRecord(input = {}, existing = {}) {
  return {
    Username: required(lower(input.Username || existing.Username), 'Staff username'),
    DisplayName: clean(input.DisplayName || existing.DisplayName),
    RecordType: option(input.RecordType || existing.RecordType, ['Work schedule', 'Lateness', 'Absence', 'Attendance correction', 'Shift assignment'], 'Work schedule', 'time record type'),
    WorkDate: required(input.WorkDate || existing.WorkDate, 'Work date'),
    StartTime: clean(input.StartTime || existing.StartTime),
    EndTime: clean(input.EndTime || existing.EndTime),
    Reason: clean(input.Reason || existing.Reason),
    Status: option(input.Status || existing.Status, ['Recorded', 'Excused', 'Unexcused', 'Resolved'], 'Recorded', 'time record status')
  };
}

export function normalizeHrEmployeeCase(input = {}, existing = {}) {
  return {
    Username: required(lower(input.Username || existing.Username), 'Staff username'),
    DisplayName: clean(input.DisplayName || existing.DisplayName),
    CaseType: option(input.CaseType || existing.CaseType, ['Welfare concern', 'Grievance', 'Workplace conflict', 'Misconduct', 'Disciplinary action', 'Health and safety', 'Other'], 'Welfare concern', 'employee case type'),
    OpenedDate: required(input.OpenedDate || existing.OpenedDate, 'Case date'),
    Severity: option(input.Severity || existing.Severity, ['Low', 'Moderate', 'High', 'Critical'], 'Moderate', 'case severity'),
    Summary: required(input.Summary || existing.Summary, 'Case summary'),
    ActionTaken: clean(input.ActionTaken || existing.ActionTaken),
    PolicyReference: clean(input.PolicyReference || existing.PolicyReference),
    Status: option(input.Status || existing.Status, ['Open', 'Under review', 'Action required', 'Resolved', 'Closed'], 'Open', 'case status')
  };
}

export function normalizeHrCompliance(input = {}, existing = {}) {
  return {
    Category: option(input.Category || existing.Category, ['Labour law', 'Pension', 'Tax obligation', 'Health and safety', 'Employment contract', 'Workplace policy', 'Other'], 'Labour law', 'compliance category'),
    Obligation: required(input.Obligation || existing.Obligation, 'Compliance obligation'),
    Owner: clean(input.Owner || existing.Owner),
    DueDate: clean(input.DueDate || existing.DueDate),
    EvidenceReference: clean(input.EvidenceReference || existing.EvidenceReference),
    Notes: clean(input.Notes || existing.Notes),
    Status: option(input.Status || existing.Status, ['Not started', 'In progress', 'Compliant', 'Action required', 'Overdue'], 'Not started', 'compliance status')
  };
}

export function normalizeHrExit(input = {}, existing = {}) {
  const lastWorkingDate = required(input.LastWorkingDate || existing.LastWorkingDate, 'Last working date');
  const noticeDate = clean(input.NoticeDate || existing.NoticeDate);
  if (noticeDate && noticeDate > lastWorkingDate) {
    const error = new Error('Last working date must be on or after the notice date.');
    error.status = 400;
    throw error;
  }
  return {
    Username: required(lower(input.Username || existing.Username), 'Staff username'),
    DisplayName: clean(input.DisplayName || existing.DisplayName),
    ExitType: option(input.ExitType || existing.ExitType, ['Resignation', 'Retirement', 'Dismissal', 'End of contract', 'Redundancy', 'Death in service', 'Other'], 'Resignation', 'exit type'),
    NoticeDate: noticeDate,
    LastWorkingDate: lastWorkingDate,
    Reason: clean(input.Reason || existing.Reason),
    HandoverStatus: option(input.HandoverStatus || existing.HandoverStatus, ['Not started', 'In progress', 'Completed', 'Not applicable'], 'Not started', 'handover status'),
    ClearanceStatus: option(input.ClearanceStatus || existing.ClearanceStatus, ['Not started', 'In progress', 'Cleared'], 'Not started', 'clearance status'),
    FinalPayStatus: option(input.FinalPayStatus || existing.FinalPayStatus, ['Pending', 'Sent to payroll', 'Paid', 'Not applicable'], 'Pending', 'final pay status'),
    FinalDocumentReference: clean(input.FinalDocumentReference || existing.FinalDocumentReference),
    ExitInterviewNotes: clean(input.ExitInterviewNotes || existing.ExitInterviewNotes),
    Status: option(input.Status || existing.Status, ['Planned', 'In progress', 'Completed', 'Cancelled'], 'Planned', 'exit status')
  };
}
