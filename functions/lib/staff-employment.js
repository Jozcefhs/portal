import { getDocuments } from './firestore.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { staffRecordMatchesEdition } from './records-desk.js';
import { recordBranchId } from './branch-scope.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
export const employmentDocumentId = value => lower(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
export const staffEmploymentAliases = staff => [...new Set([
  staff.Username, staff.username, staff.LoginUsername, staff.loginUsername, staff.__id
].map(lower).filter(Boolean))];

// This is a presentation projection, not an access-policy or payroll update.
// Confidential HR case notes, emergency contacts and compensation never leave HR.
export const EMPLOYMENT_DISPLAY_FIELDS = Object.freeze([
  'EmployeeId', 'DisplayName', 'Position', 'Department', 'EmploymentType',
  'HireDate', 'ManagerUsername', 'WorkEmail', 'Phone', 'Status'
]);

export function staffEmploymentDetails(staff, employees, edition) {
  const aliases = new Set(staffEmploymentAliases(staff));
  const branch = recordBranchId(staff);
  if (!staffRecordMatchesEdition(staff, { edition, username: staff.Username || staff.username || staff.__id })) return {};
  const matches = employees.filter(row => row && aliases.has(lower(row.Username || row.username))
    && recordBranchId(row, branch) === branch
    && staffRecordMatchesEdition(row, { edition, username: row.Username || row.username }));
  const result = {};
  for (const field of EMPLOYMENT_DISPLAY_FIELDS) {
    const values = [...new Set(matches.map(row => clean(row[field])).filter(Boolean))];
    if (values.length > 1) {
      throw Object.assign(new Error(`Conflicting HR ${field} records for ${clean(staff.Username || staff.__id)} need HR review.`), { status: 409 });
    }
    if (values.length) result[field] = values[0];
  }
  return result;
}

export async function withStaffEmployment(env, staffRows, { read = getDocuments } = {}) {
  if (!staffRows.length) return [];
  const { edition } = requiredDeploymentIdentity(env);
  const ids = [...new Set(staffRows.flatMap(staffEmploymentAliases).map(employmentDocumentId).filter(Boolean))];
  // Bounded batch reads of known staff IDs, never an unpaginated HR scan.
  const employees = await read(env, 'hrEmployees', ids);
  return staffRows.map(staff => {
    const Employment = staffEmploymentDetails(staff, employees, edition);
    return { ...staff, Position: Employment.Position || clean(staff.Position), Employment };
  });
}

export function employmentDirectoryRow(staff) {
  const employment = staff.Employment || {};
  return { ...staff,
    DisplayName: employment.DisplayName || staff.DisplayName,
    Department: employment.Department || staff.Department,
    Position: employment.Position || staff.Position,
    Email: employment.WorkEmail || staff.Email,
    Phone: employment.Phone || staff.Phone
  };
}

// Only descriptive fields flow to new payroll drafts. No amount, bank, tax,
// Active flag, identifier, approval or historical payslip is overwritten.
export function employmentPayrollProfile(profile, staff) {
  const employment = staff?.Employment || {};
  const result = { ...profile };
  for (const field of ['DisplayName', 'Department', 'Position', 'EmploymentType']) {
    if (clean(employment[field])) result[field] = clean(employment[field]);
  }
  return result;
}
