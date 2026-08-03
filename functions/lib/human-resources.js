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
