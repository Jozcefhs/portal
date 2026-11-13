import { getDocument, getDocuments, queryCollection, queryCollectionPages, createDocumentIfAbsent, updateDocumentIfCurrent, batchCommitLiteralDocuments } from './firestore.js';
import { findStaffUserRecord } from './staff-auth.js';
import { branchRecordVisible, recordBranchId, enforceActorBranch } from './branch-scope.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { staffRecordMatchesEdition } from './records-desk.js';
import { employmentDocumentId, staffEmploymentAliases, staffEmploymentDetails } from './staff-employment.js';
import { hrCapabilitiesFor } from './human-resources.js';
import { payrollProfileValues } from './payroll/profile-input.js';
import { calculateConfigurablePayroll } from './payroll/payroll-calculation-service.js';
import { getDocumentBranding, documentBrandingMatchesDeployment } from './document-branding.js';
import { effectiveBranchProfile } from './branch-profile-settings.js';
import { loadStaffApprovalProfile, validateApprovalImage } from './staff-approval-profile.js';
import { loadStaffPosition } from './staff-position.js';
import { sendConfiguredEmail, escapeEmailHtml } from './email-service.js';
import { createEmploymentLetterPdf } from './hr-employment-letter-pdf.js';
import { putStoredDocument, getStoredDocument, deleteStoredDocument } from './document-storage.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const plain = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LETTERS = 'hrEmploymentLetters';
const SALARY_TEMPLATES = 'hrSalaryTemplates';
const SALARY_TEMPLATE_ACTIONS = ['listsalarytemplates', 'addsalarytemplate', 'editsalarytemplate', 'deletesalarytemplate'];
const PAY_GRADES = 'hrPayGrades';
const PAY_GRADE_NAMES = 'hrPayGradeNames';
const PAY_GRADE_ASSIGNMENTS = 'hrPayGradeAssignments';
const PAY_GRADE_WRITE_ACTIONS = ['savepaygrade', 'renamepaygrade', 'deletepaygrade', 'assignpaygrademembers', 'applypaygrade'];
export const HR_PAY_GRADE_ACTIONS = ['listpaygrades', 'listpaygrademembers', 'getpaygradepreview', ...PAY_GRADE_WRITE_ACTIONS];
const payGradeFields = profile => Object.fromEntries(['PayGradeId', 'PayGrade', 'PayLevel', 'PayGradeRevision']
  .map(key => [key, clean(profile?.[key])]));
const LETTER_SUMMARY_FIELDS = ['LetterId', 'EmployeeKey', 'Username', 'EmployeeName', 'RecipientEmail', 'BranchId', 'WorkspaceId', 'OrganisationEdition',
  'LetterDate', 'Status', 'FileName', 'CreatedAt', 'SentAt', 'SignatureApplied'];
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');
const payGradeScopeId = (identity, branchId) => digest([identity.workspaceId, identity.edition, branchId]);
const legacyGradeProfileFields = ['Username', 'BranchId', 'branchId', 'Active', 'CalculationMode',
  'Edition', 'edition', 'OrganisationEdition', 'organisationEdition', 'OrganizationEdition', 'organizationEdition'];
const legacyGradeProfileVisible = (profile, edition) => staffRecordMatchesEdition(profile, { edition })
  && lower(profile.Active) !== 'no' && clean(profile.CalculationMode).toUpperCase() !== 'CONFIGURABLE_PAYE';

export async function loadHrDirectoryPayGrades(env, staff, { query = queryCollectionPages } = {}) {
  const result = new Map();
  if (!staff.length) return result;
  const identity = requiredDeploymentIdentity(env);
  const branches = [...new Set(staff.map(row => recordBranchId(row)))];
  const scopeIds = await Promise.all(branches.map(branch => payGradeScopeId(identity, branch)));
  const scopeForBranch = new Map(branches.map((branch, index) => [branch, scopeIds[index]]));
  const scopeFor = row => scopeForBranch.get(recordBranchId(row));
  const lookup = async (collection, field, ids, select) => {
    const queries = [];
    for (let offset = 0; offset < ids.length; offset += 25) {
      queries.push(query(env, collection, { filters: [{ field, op: 'in', value: ids.slice(offset, offset + 25) }], select }));
    }
    return (await Promise.all(queries)).flat();
  };
  const grades = await lookup(PAY_GRADES, 'ScopeId', scopeIds, ['ScopeId', 'PayGrade', 'PayLevel']);
  if (!grades.length) return result;
  const gradeById = new Map(grades.map(row => [row.__id, row]));
  const activeScopes = new Set(grades.map(row => row.ScopeId));
  const assignments = await lookup(PAY_GRADE_ASSIGNMENTS, 'ScopeId', [...activeScopes], ['ScopeId', 'StaffId', 'PayGradeId']);
  const scopedKey = (scope, key) => `${scope}/${key}`;
  const byStaffId = new Map(assignments.map(row => [scopedKey(row.ScopeId, row.StaffId), row.PayGradeId]));
  const byAlias = new Map(), legacyScopes = new Set();
  function assign(row, grade) {
    if (grade?.ScopeId !== scopeFor(row)) return;
    result.set(row, { GradeId: grade.__id, PayGrade: clean(grade.PayGrade), PayLevel: clean(grade.PayLevel) });
  }
  for (const row of staff) {
    const scope = scopeFor(row);
    if (!activeScopes.has(scope)) continue;
    for (const alias of staffEmploymentAliases(row)) {
      const aliasKey = scopedKey(scope, alias);
      byAlias.set(aliasKey, byAlias.has(aliasKey) ? null : row);
    }
    const key = scopedKey(scope, row.__id);
    if (byStaffId.has(key)) {
      assign(row, gradeById.get(byStaffId.get(key)));
      continue;
    }
    legacyScopes.add(scope);
  }
  const legacyGradeIds = grades.filter(row => legacyScopes.has(row.ScopeId)).map(row => row.__id);
  const profiles = await lookup('payrollProfiles', 'PayGradeId', legacyGradeIds, [...legacyGradeProfileFields, 'PayGradeId']);
  const legacy = new Map();
  for (const profile of profiles) {
    const grade = gradeById.get(profile.PayGradeId);
    const scope = scopeFor(profile);
    const row = byAlias.get(scopedKey(scope, lower(profile.Username)));
    if (!row || byStaffId.has(scopedKey(scope, row.__id)) || grade?.ScopeId !== scope || !legacyGradeProfileVisible(profile, identity.edition)) continue;
    legacy.set(row, legacy.has(row) && legacy.get(row) !== grade ? null : grade);
  }
  for (const [row, grade] of legacy) assign(row, grade);
  return result;
}

const bytesDigest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const base64 = bytes => { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); };
const summary = row => ({ ...Object.fromEntries(LETTER_SUMMARY_FIELDS.map(key => [key, row[key] ?? ''])), LetterVersion: clean(row.__updateTime) });
const documentResult = row => ({ ...summary(row), PdfBase64: row.PdfBase64, Terms: row.Terms, Salary: row.Salary, IssuerName: row.IssuerName, IssuerTitle: row.IssuerTitle });
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const condition = row => {
  if (!row) return { exists: false };
  if (!clean(row.__updateTime)) throw fail('The current record version is missing. Reload before saving.', 409);
  return { updateTime: row.__updateTime };
};

export function normalizeEmploymentLetterTerms(body, employee) {
  const fields = {};
  const defaults = { Position: employee.Position, Department: employee.Department, EmploymentType: employee.EmploymentType, StartDate: employee.HireDate };
  for (const [key, maximum] of Object.entries({ LetterDate: 10, StartDate: 10, Position: 160, Department: 160, EmploymentType: 100,
    WorkLocation: 250, ReportingTo: 160, Probation: 1500, NoticePeriod: 1500, WorkingHours: 1500, Benefits: 2500, Terms: 6000, AcceptanceDeadline: 10 })) {
    fields[key] = clean(body[key] ?? defaults[key]);
    if (fields[key].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(fields[key])) throw fail(`${key}: use at most ${maximum} characters without control characters.`);
  }
  for (const key of ['LetterDate', 'StartDate']) if (!validDate(fields[key])) throw fail(`Choose a valid ${key === 'LetterDate' ? 'letter date' : 'employment start date'}.`);
  if (fields.AcceptanceDeadline && !validDate(fields.AcceptanceDeadline)) throw fail('Choose a valid acceptance deadline.');
  for (const key of ['Position', 'Department', 'EmploymentType']) if (!fields[key]) throw fail(`${key} is required for the employment letter.`);
  return fields;
}

function safeProfile(profile) {
  if (!profile) return null;
  const values = payrollProfileValues({}, profile);
  return { ...Object.fromEntries(['EmployeeId', 'BasicSalary', 'Allowances', 'Deductions', 'CalculationMode', 'Currency', 'PayFrequency']
    .map(key => [key, profile[key] ?? ({ Currency: 'NGN', PayFrequency: 'Monthly', CalculationMode: 'LEGACY_FLAT_RATE', Allowances: [], Deductions: [] }[key] ?? '')])),
    BasicSalary: values.BasicSalary, Allowances: values.Allowances, Deductions: values.Deductions, ...payGradeFields(profile) };
}

function salaryValues(body, existing = {}) {
  if (clean(body.Currency || 'NGN').toUpperCase() !== 'NGN' || lower(body.PayFrequency || 'Monthly') !== 'monthly') {
    throw fail('Linked payroll salary structures currently use NGN per month.');
  }
  const { BasicSalary, Allowances, Deductions } = payrollProfileValues({
    BasicSalary: body.BasicSalary, Allowances: body.Allowances, Deductions: body.Deductions
  }, existing);
  if (Allowances.length > 40 || Deductions.length > 40) throw fail('Use no more than 40 allowances and 40 deductions.');
  return { BasicSalary, Allowances, Deductions, Currency: 'NGN', PayFrequency: 'Monthly' };
}

function assertSalaryEmployeeActive(target) {
  if (['false', 'no', '0', 'disabled', 'inactive'].includes(lower(target.staff.Active))
      || ['exited', 'terminated', 'inactive', 'disabled'].includes(lower(target.employee.Status))) {
    throw fail('This employee is inactive. Review their employment status before changing salary or issuing a letter.', 409);
  }
}

function assertSalaryProfileEditable(target) {
  if (clean(target.profile?.CalculationMode).toUpperCase() === 'CONFIGURABLE_PAYE') {
    throw fail('This employee uses advanced payroll components. Update those assignments in Accounts.', 409);
  }
}

function salaryMatches(profile, desired) {
  const current = safeProfile(profile);
  return current && Object.entries(desired).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value));
}

// All reads below are for one explicitly selected staff identity. No payroll run,
// payslip, bank account or full employee collection is loaded to open HR.
export function hrEmploymentLetterService(overrides = {}) {
  const db = { getDocument, getDocuments, queryCollection, createDocumentIfAbsent, updateDocumentIfCurrent, batchCommitLiteralDocuments, findStaffUserRecord,
    requiredDeploymentIdentity, getDocumentBranding, documentBrandingMatchesDeployment, effectiveBranchProfile, loadStaffApprovalProfile,
    loadStaffPosition, sendConfiguredEmail, createEmploymentLetterPdf, now, ...overrides };
  const storage = { putStoredDocument, getStoredDocument, deleteStoredDocument, ...overrides };
  async function pdfFor(env, row) {
    if (!row.PdfDocumentReference || !/^[a-f0-9]{64}$/.test(clean(row.PdfSha256))
      || row.PdfContentType !== 'application/pdf' || !Number.isSafeInteger(row.PdfBytes) || row.PdfBytes < 1 || row.PdfBytes > 525000) {
      throw fail('The saved PDF storage record is unavailable. Nothing was sent; prepare a new draft or contact support.', 409);
    }
    const saved = await storage.getStoredDocument(env, row.PdfDocumentReference);
    const meta = saved.object.customMetadata || {};
    if (saved.key !== row.PdfObjectKey || saved.mimeType !== 'application/pdf' || meta.ownerId !== row.EmployeeKey
      || meta.branchId !== row.BranchId || meta.documentType !== 'employment-letter'
      || meta.category !== 'human-resources' || Number(saved.object.size) !== row.PdfBytes) {
      throw fail('The saved employment PDF does not match this employee and branch. Nothing was sent.', 409);
    }
    const bytes = new Uint8Array(await saved.object.arrayBuffer());
    if (bytes.byteLength !== row.PdfBytes || await bytesDigest(bytes) !== row.PdfSha256) throw fail('The saved employment PDF failed its integrity check. Nothing was sent.', 409);
    return base64(bytes);
  }
  const loadedDocumentResult = async (env, row) => documentResult({ ...row, PdfBase64: await pdfFor(env, row) });
  const auditWrite = (id, user, target, action, timestamp) => ({ collectionPath: 'hrAudit', documentId: id, exists: false, data: {
    AuditId: id, Timestamp: timestamp, Action: action, Reference: target.employee.Username, Details: target.employee.DisplayName,
    ActorUsername: lower(user.username), Actor: clean(user.displayName || user.username), BranchId: target.employee.BranchId,
    OrganisationEdition: target.identity.edition, WorkspaceId: target.identity.workspaceId
  } });
  const identityGuards = target => [
    ['staffUsers', target.staff], ...target.employeeRecords.map(row => ['hrEmployees', row])
  ].map(([collectionPath, row]) => {
    const field = ['Username', 'username', 'BranchId'].find(key => Object.hasOwn(row, key));
    if (!field || !row.__id) throw fail('The saved staff identity cannot be verified. Reload the employee before saving.', 409);
    // A same-value field update supplies a Firestore precondition while leaving
    // every staff/HR value unchanged if branch, identity or status changes race.
    return { collectionPath, documentId: row.__id, data: { [field]: row[field] }, updateMask: [field], ...condition(row) };
  });
  const salaryGuards = target => [
    ['payrollProfiles', target.profile, 'EmployeeId'],
    ...[...new Map((target.salaryDefinitions || []).map(row => [row.__id, row])).values()].map(row => ['payrollSalaryComponents', row, 'Code'])
  ].map(([collectionPath, row, field]) => {
    if (!row?.__id || !Object.hasOwn(row, field)) throw fail('The saved salary version cannot be verified. Load the employee again before sending.', 409);
    return { collectionPath, documentId: row.__id, data: { [field]: row[field] }, updateMask: [field], ...condition(row) };
  });
  async function targetFor(env, user, body, identity) {
    const username = lower(body.Username);
    if (!username || username.length > 160 || /[\r\n/\\]/.test(username)) throw fail('Select an employee.');
    const staff = await db.findStaffUserRecord(env, username, { allowListFallback: false });
    if (!staff || !branchRecordVisible(staff, user) || !staffRecordMatchesEdition(staff, { ...user, edition: identity.edition })) throw fail('Employee was not found in your permitted branch and edition.', 404);
    const branchId = enforceActorBranch(user, body.BranchId, recordBranchId(staff), recordBranchId(staff));
    if (branchId !== recordBranchId(staff)) throw fail('This employee belongs to another branch. Select their saved branch; salary setup cannot transfer staff between branches.', 403);
    const canonicalUsername = clean(staff.Username || staff.username || staff.__id), aliases = staffEmploymentAliases(staff);
    const employees = await Promise.all([...new Set(aliases.map(employmentDocumentId))].map(id => db.getDocument(env, 'hrEmployees', id)));
    const usernames = [...new Set([canonicalUsername, ...aliases].filter(Boolean))].slice(0, 10);
    const profiles = await db.queryCollection(env, 'payrollProfiles', { filters: [{ field: 'Username', op: 'in', value: usernames }], limit: 11 });
    return targetFromRows(staff, branchId, identity, employees, profiles, body.EmployeeId);
  }

  async function targetFromRows(staff, branchId, identity, employees, profiles, employeeId = '') {
    const canonicalUsername = clean(staff.Username || staff.username || staff.__id), aliases = staffEmploymentAliases(staff);
    const employment = staffEmploymentDetails(staff, employees.filter(Boolean), identity.edition);
    const employee = { ...employment, Username: canonicalUsername, EmployeeId: clean(employment.EmployeeId),
      DisplayName: clean(employment.DisplayName || staff.DisplayName || canonicalUsername), Department: clean(employment.Department || staff.Department),
      Position: clean(employment.Position || staff.Position), EmploymentType: clean(employment.EmploymentType || staff.EmploymentType),
      HireDate: clean(employment.HireDate), WorkEmail: lower(employment.WorkEmail || staff.Email), BranchId: branchId };
    if (profiles.length > 10) throw fail('Too many payroll profiles match this employee. Resolve the duplicate profiles in Accounts first.', 409);
    const scoped = profiles.filter(row => recordBranchId(row) === branchId && staffRecordMatchesEdition(row, { edition: identity.edition, username: canonicalUsername }));
    if (scoped.length > 1 || profiles.some(row => !scoped.includes(row))) throw fail('The employee has conflicting payroll profiles or a profile in another branch. Review the existing payroll identity in Accounts first.', 409);
    const profile = scoped[0] || null;
    if (clean(employeeId) && clean(employeeId) !== clean(profile?.EmployeeId || employee.EmployeeId)) throw fail('The selected employee payroll identity changed. Load the employee again.', 409);
    const employeeKey = (await digest([identity.workspaceId, identity.edition, branchId, 'staff', clean(staff.__id) || lower(canonicalUsername)])).slice(0, 40);
    return { identity, staff, employee, profile, employeeKey, employeeRecords: employees.filter(row => row
      && recordBranchId(row, branchId) === branchId && aliases.includes(lower(row.Username || row.username))) };
  }

  async function lookupByNames(env, collection, field, values, maxPerName) {
    const names = [...new Set(values)];
    const queries = [];
    for (let offset = 0; offset < names.length; offset += 25) {
      const group = names.slice(offset, offset + 25);
      const limit = group.length * maxPerName + 1;
      queries.push(db.queryCollection(env, collection, { filters: [{ field, op: 'in', value: group }], limit }).then(rows => {
        if (rows.length >= limit) throw fail('Too many records match the selected staff. Resolve duplicate identities first.', 409);
        return rows;
      }));
    }
    return (await Promise.all(queries)).flat();
  }

  const staffUsername = row => lower(row?.Username || row?.username || row?.__id);
  const staffInGradeScope = (row, user, identity, branchId) => row && branchRecordVisible(row, user)
    && recordBranchId(row) === branchId && staffRecordMatchesEdition(row, { ...user, edition: identity.edition });
  const gradeAssignmentId = (scopeId, row) => digest([scopeId, row.__id]);

  async function batchStaffRows(env, user, identity, branchId, usernames, { skipMissing = false } = {}) {
    const documentIds = usernames.map(name => employmentDocumentId(name).slice(0, 120));
    if (documentIds.some(id => !id || id === '.' || id === '..')) throw fail('The selection includes an invalid username.');
    const direct = await db.getDocuments(env, 'staffUsers', documentIds);
    const matches = (row, username) => [row?.Username, row?.username, row?.__id].some(value => lower(value) === username);
    const missing = usernames.filter((name, index) => !matches(direct[index], name));
    const indexed = await lookupByNames(env, 'staffUsers', 'UsernameKey', missing, 2);
    return usernames.map((name, index) => {
      const rows = matches(direct[index], name) ? [direct[index]] : indexed.filter(row => matches(row, name));
      const row = rows[0];
      if (rows.length !== 1 || !staffInGradeScope(row, user, identity, branchId)) {
        if (skipMissing) return null;
        throw fail(`${name}: Employee was not uniquely found in this branch.`, 409);
      }
      return row;
    }).filter(Boolean);
  }

  async function batchSalaryTargets(env, identity, branchId, staff, { readProfiles = true } = {}) {
    const aliasesFor = row => [...new Set([clean(row.Username || row.username || row.__id), ...staffEmploymentAliases(row)].filter(Boolean))];
    const aliases = staff.map(aliasesFor);
    const [employees, profiles] = await Promise.all([
      db.getDocuments(env, 'hrEmployees', [...new Set(staff.flatMap(staffEmploymentAliases).map(employmentDocumentId).filter(Boolean))]),
      readProfiles ? lookupByNames(env, 'payrollProfiles', 'Username', aliases.flat(), 10) : []
    ]);
    return Promise.all(staff.map((row, index) => {
      const ids = staffEmploymentAliases(row).map(employmentDocumentId);
      return targetFromRows(row, branchId, identity, employees.filter(record => record && ids.includes(record.__id)),
        profiles.filter(profile => aliases[index].includes(profile.Username)));
    }));
  }
  async function salaryFor(env, target, payrollDate = db.now().slice(0, 10)) {
    const profile = target.profile;
    if (!profile) return null;
    if (clean(profile.Currency || 'NGN').toUpperCase() !== 'NGN' || lower(profile.PayFrequency || 'Monthly') !== 'monthly') throw fail('This payroll profile uses a different currency or pay frequency. Review it in Accounts before preparing a letter.', 409);
    if (clean(profile.Active).toUpperCase() === 'NO') throw fail('This employee payroll profile is inactive. Review it in Accounts before preparing a letter.', 409);
    let earnings, deductions, definitions = [];
    if (clean(profile.CalculationMode).toUpperCase() === 'CONFIGURABLE_PAYE') {
      const assignments = Array.isArray(profile.ComponentAssignments) ? profile.ComponentAssignments : [];
      if (!assignments.length || assignments.length > 50) throw fail('Review the employee salary-component assignments in Accounts before preparing a letter.', 409);
      definitions = (await Promise.all(assignments.map(async row => {
        if (clean(row.ComponentId)) return db.getDocument(env, 'payrollSalaryComponents', clean(row.ComponentId));
        const matches = await db.queryCollection(env, 'payrollSalaryComponents', { filters: [{ field: 'Code', op: '==', value: clean(row.Code) }], limit: 2 });
        if (matches.length !== 1) throw fail('A salary component is missing or ambiguous. Review it in Accounts.', 409);
        return matches[0];
      }))).filter(Boolean);
      // Reuse the established component formula engine for gross contractual
      // earnings only. Statutory taxes are deliberately not presented as net pay.
      const calculation = calculateConfigurablePayroll({ employee: { ...profile, TaxStatus: 'EXEMPT', PensionParticipating: 'NO', NhfParticipating: 'NO', AdditionalReliefs: [] },
        configuration: { components: definitions, profiles: [], bands: [], reliefs: [] }, payrollDate });
      earnings = calculation.ComponentBreakdown.filter(row => row.ComponentType === 'earning').map(row => ({ Name: row.Name || row.Code, Amount: row.Amount }));
      deductions = calculation.OtherDeductions.map(row => ({ Name: row.Name, Amount: row.Amount }));
    } else {
      const values = payrollProfileValues({}, profile);
      earnings = [{ Name: 'Basic salary', Amount: values.BasicSalary }, ...values.Allowances];
      deductions = values.Deductions;
    }
    target.salaryDefinitions = definitions;
    const salary = { Currency: 'NGN', PayFrequency: 'Monthly', Earnings: earnings, Deductions: deductions,
      GrossPay: Math.round(earnings.reduce((sum, row) => sum + row.Amount, 0) * 100) / 100 };
    return { ...salary, Fingerprint: await digest({ salary, CalculationMode: profile.CalculationMode || 'LEGACY_FLAT_RATE',
      ComponentAssignments: profile.ComponentAssignments || [], Definitions: definitions.map(plain) }) };
  }
  async function lettersFor(env, target) {
    const rows = await db.queryCollection(env, LETTERS, { filters: [{ field: 'EmployeeKey', op: '==', value: target.employeeKey }], select: LETTER_SUMMARY_FIELDS, limit: 101 });
    return { letters: rows.slice(0, 100).map(summary).sort((a, b) => clean(b.CreatedAt).localeCompare(clean(a.CreatedAt))), lettersTruncated: rows.length > 100 };
  }
  async function salaryResult(env, user, target, { withLetters = false } = {}) {
    const salary = await salaryFor(env, target);
    return { ok: true, employee: target.employee, profile: safeProfile(target.profile), PayrollVersion: clean(target.profile?.__updateTime),
      salary, salaryEditable: hrCapabilitiesFor(user).canManageSalaryStructure && clean(target.profile?.CalculationMode).toUpperCase() !== 'CONFIGURABLE_PAYE',
      ...(withLetters ? await lettersFor(env, target) : {}) };
  }
  async function employeeFingerprint(target) {
    return digest(target.employee);
  }
  async function draftFor(env, user, target, body) {
    const terms = normalizeEmploymentLetterTerms(body, target.employee);
    if (!EMAIL.test(target.employee.WorkEmail)) throw fail('Save a valid employee work email in their HR record before preparing an employment letter.');
    const salary = await salaryFor(env, target, terms.StartDate);
    if (!salary) throw fail('Save this employee salary structure before preparing an employment letter.', 409);
    const [approval, signatory, defaults, organisation, branding] = await Promise.all([
      db.loadStaffApprovalProfile(env, user.username), db.loadStaffPosition(env, user, { staff: (env, username) => db.findStaffUserRecord(env, username, { allowListFallback: false }) }),
      db.getDocument(env, 'settings', 'schoolProfile'), db.getDocument(env, 'settings', 'organisationProfile'), db.getDocumentBranding(env)
    ]);
    const profile = await db.effectiveBranchProfile(env, { ...(defaults || {}),
      ...(target.identity.edition !== 'school' ? {
        SchoolName: clean(organisation?.Name || organisation?.OrganisationName || organisation?.OrganizationName || defaults?.SchoolName),
        SchoolAddress: clean(organisation?.Address || defaults?.SchoolAddress), SchoolPhone: clean(organisation?.Phone || defaults?.SchoolPhone),
        SchoolEmail: clean(organisation?.Email || defaults?.SchoolEmail)
      } : {}) }, target.employee.BranchId);
    const employerName = clean(profile.SchoolName);
    if (!employerName) throw fail('Save the employer organisation name in settings before preparing employment letters.');
    const signatureDataUrl = validateApprovalImage(approval?.SignatureDataUrl, 'Your saved signature');
    if (signatureDataUrl && !/^data:image\/(?:png|jpe?g);base64,/i.test(signatureDataUrl)) throw fail('Save a PNG or JPG signature in My signature settings before preparing this PDF.');
    const validBranding = db.documentBrandingMatchesDeployment(env, branding) ? branding : {};
    const documentProfile = { ...profile, DocumentLogoDataUrl: validBranding?.DocumentLogoDataUrl || '', DocumentSignatureDataUrl: '' };
    const snapshot = { PdfTemplateVersion: 1, WorkspaceId: target.identity.workspaceId, OrganisationEdition: target.identity.edition,
      BranchId: target.employee.BranchId, BranchName: clean(profile.BranchName || profile.BranchLabel || target.employee.BranchId),
      EmployeeKey: target.employeeKey, Username: target.employee.Username, EmployeeName: target.employee.DisplayName,
      EmployeeId: clean(target.profile.EmployeeId || target.employee.EmployeeId), RecipientEmail: target.employee.WorkEmail,
      EmployerName: employerName, Terms: terms, LetterDate: terms.LetterDate, Salary: salary,
      EmployeeFingerprint: await employeeFingerprint(target), SalaryFingerprint: salary.Fingerprint,
      IssuerName: clean(user.displayName || user.username), IssuerUsername: lower(user.username), IssuerTitle: signatory.IssuerTitle || 'Authorised Officer',
      SignatureApplied: Boolean(signatureDataUrl), SignatureFingerprint: signatureDataUrl ? await digest(signatureDataUrl) : '',
      BrandingFingerprint: await digest(documentProfile) };
    const id = `EMP-${(await digest(snapshot)).slice(0, 32)}`;
    return { row: { ...snapshot, LetterId: id, Status: 'Draft', FileName: `Employment_${id}.pdf` }, profile: documentProfile, signatureDataUrl };
  }
  async function salaryTemplates(env, user, identity, body, action) {
    const branchId = enforceActorBranch(user, body.BranchId);
    const id = await digest([identity.workspaceId, identity.edition, branchId]);
    const listing = action === 'listsalarytemplates';
    const adding = action === 'addsalarytemplate';
    const deleting = action === 'deletesalarytemplate';
    const kind = clean(body.Kind);
    const name = clean(body.Name).replace(/\s+/g, ' ');
    const existingName = clean(body.ExistingName);
    if (!listing) {
      if (!['Allowances', 'Deductions'].includes(kind)) throw fail('Choose allowance or deduction.');
      if (!deleting && (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name))) throw fail('Enter a name of up to 120 characters.');
      if (!adding && !existingName) throw fail('Select a reusable item.');
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const row = await db.getDocument(env, SALARY_TEMPLATES, id);
      const templates = { Allowances: row?.Allowances || [], Deductions: row?.Deductions || [] };
      const templateVersion = clean(row?.Revision || row?.__updateTime);
      const result = { ok: true, templates, templateVersion };
      if (listing) return result;
      if (!adding && clean(body.TemplateVersion) !== templateVersion) {
        throw fail('The reusable list changed. Refresh reusable items and select the item again.', 409);
      }
      const names = [...templates[kind]];
      const index = names.indexOf(existingName);
      const duplicate = names.findIndex(value => lower(value) === lower(name));
      if (adding) {
        if (duplicate !== -1) return { ...result, message: 'That name is already available in the reusable list.' };
        if (names.length >= 200) throw fail('This branch already has 200 reusable items of this type.', 409);
        names.push(name);
      } else {
        if (index === -1) throw fail('This reusable item is no longer available. Refresh the list.', 404);
        if (!deleting && name === existingName) return { ...result, message: 'The reusable name is already saved.' };
        if (!deleting && duplicate !== -1 && duplicate !== index) throw fail('That name is already used for this type of item.', 409);
        if (deleting) names.splice(index, 1);
        else names[index] = name;
      }
      templates[kind] = names.sort((a, b) => a.localeCompare(b));
      const revision = crypto.randomUUID();
      try {
        await db.batchCommitLiteralDocuments(env, [{ collectionPath: SALARY_TEMPLATES, documentId: id,
          data: { ...templates, BranchId: branchId, WorkspaceId: identity.workspaceId, OrganisationEdition: identity.edition,
            Revision: revision, UpdatedAt: db.now(), UpdatedBy: lower(user.username) }, ...condition(row) }]);
        const message = adding ? `${name} added to the reusable list.`
          : deleting ? `${existingName} removed from the reusable list.` : `Reusable name updated to ${name}.`;
        return { ...result, templateVersion: revision, message };
      } catch (error) {
        if (error.status !== 409) throw error;
        if (!adding) throw fail('The reusable list changed. Refresh reusable items and select the item again.', 409);
      }
    }
    throw fail('The reusable list changed while saving. Try adding the item again.', 409);
  }
  async function salaryWritePlan(env, user, target, desired, timestamp, action, { batch = false } = {}) {
    const employeeId = clean(target.profile?.EmployeeId || target.employee.EmployeeId) || `EMP-HR-${target.employeeKey.slice(0, 24)}`;
    const documentId = target.profile?.__id || employeeId.replace(/[\/\\?#\[\]]/g, '-');
    if (!documentId || documentId.length > 140) throw fail('The saved employee payroll identity is invalid. Review it in Accounts.', 409);
    if (!batch && !target.profile && await db.getDocument(env, 'payrollProfiles', documentId)) {
      throw fail('That employee ID already belongs to a payroll profile. Review it in Accounts before creating another.', 409);
    }
    const payload = { ...plain(target.profile), ...desired, EmployeeId: employeeId, Username: target.employee.Username,
      DisplayName: target.employee.DisplayName, BranchId: target.employee.BranchId, OrganisationEdition: target.identity.edition,
      Department: target.employee.Department, Position: target.employee.Position, EmploymentType: target.employee.EmploymentType,
      CalculationMode: target.profile?.CalculationMode || 'LEGACY_FLAT_RATE', Active: target.profile?.Active || 'YES',
      CreatedAt: target.profile?.CreatedAt || timestamp, CreatedBy: target.profile?.CreatedBy || clean(user.displayName || user.username),
      UpdatedAt: timestamp, UpdatedBy: clean(user.displayName || user.username) };
    const changeId = `SAL-${(await digest([target.employeeKey, clean(target.profile?.__updateTime), desired])).slice(0, 32)}`;
    return { documentId, writes: [
      ...identityGuards(target),
      { collectionPath: 'payrollProfiles', documentId, data: payload, ...condition(target.profile) },
      { collectionPath: 'hrSalaryRevisions', documentId: changeId, exists: false, data: { RevisionId: changeId, EmployeeKey: target.employeeKey,
        Username: target.employee.Username, EmployeeId: employeeId, BranchId: target.employee.BranchId, OrganisationEdition: target.identity.edition,
        Before: safeProfile(target.profile), After: safeProfile(payload), ChangedAt: timestamp, ChangedBy: lower(user.username) } },
      auditWrite(changeId, user, target, action, timestamp)
    ] };
  }

  const gradeView = row => ({
    GradeId: row.__id || row.GradeId, PayGrade: row.PayGrade, PayLevel: row.PayLevel, Revision: row.Revision, ...salaryValues(row)
  });

  function gradeNames(body) {
    const PayGrade = clean(body.PayGrade).replace(/\s+/g, ' '), PayLevel = clean(body.PayLevel).replace(/\s+/g, ' ');
    if ([PayGrade, PayLevel].some(value => !value || value.length > 60 || /[\u0000-\u001f\u007f]/.test(value))) {
      throw fail('Enter a pay grade and a level of up to 60 characters each.');
    }
    return { PayGrade, PayLevel };
  }

  const gradeNameKey = (scopeId, names) => digest([scopeId, lower(names.PayGrade), lower(names.PayLevel)]);
  const gradeRevision = user => ({ Revision: crypto.randomUUID(), UpdatedAt: db.now(), UpdatedBy: lower(user.username) });

  async function gradeNameSlot(env, scopeId, names) {
    const nameId = await gradeNameKey(scopeId, names);
    const [claim, legacy] = await Promise.all([
      db.getDocument(env, PAY_GRADE_NAMES, nameId), db.getDocument(env, PAY_GRADES, nameId)
    ]);
    // Earlier versions used the name key as the grade document ID. Once
    // renamed, that document keeps its ID and no longer occupies the old name.
    const legacyMatch = legacy?.ScopeId === scopeId && lower(legacy.PayGrade) === lower(names.PayGrade)
      && lower(legacy.PayLevel) === lower(names.PayLevel);
    if (legacyMatch && claim && claim.GradeId !== nameId) throw fail('This grade and level has conflicting name records.', 409);
    return { nameId, gradeId: claim?.GradeId || (legacyMatch ? nameId : ''), legacy: legacyMatch ? legacy : null };
  }

  async function scopedGrade(env, scopeId, gradeId) {
    if (!/^[a-f0-9]{64}$/.test(gradeId)) throw fail('Select a pay grade and level.');
    const row = await db.getDocument(env, PAY_GRADES, gradeId);
    if (!row || row.ScopeId !== scopeId) throw fail('This pay grade and level is unavailable in your branch.', 404);
    return row;
  }

  function assertGradeRevision(row, revision) {
    if (clean(row?.Revision) !== clean(revision)) {
      throw fail('This grade and level already exists or changed. Refresh pay grades before saving.', 409);
    }
  }

  const claimGradeName = (nameId, gradeId) => ({
    collectionPath: PAY_GRADE_NAMES, documentId: nameId, data: { GradeId: gradeId }, exists: false
  });

  async function releaseGradeName(env, nameId, gradeId) {
    const claim = await db.getDocument(env, PAY_GRADE_NAMES, nameId);
    if (!claim) return [];
    if (claim.GradeId !== gradeId) throw fail('The grade name changed. Refresh pay grades and try again.', 409);
    return [{ collectionPath: PAY_GRADE_NAMES, documentId: nameId, operation: 'delete', ...condition(claim) }];
  }

  async function gradeMembers(env, user, identity, branchId, scopeId, gradeId) {
    const filters = [{ field: 'PayGradeId', op: '==', value: gradeId }];
    const [assignments, profiles] = await Promise.all([
      db.queryCollection(env, PAY_GRADE_ASSIGNMENTS, { filters, select: ['ScopeId', 'StaffId'], limit: 1001 }),
      db.queryCollection(env, 'payrollProfiles', { filters,
        select: legacyGradeProfileFields, limit: 1001 })
    ]);
    if (assignments.length > 1000 || profiles.length > 1000) throw fail('Too many staff are assigned to load in one selection. Choose the employees directly.', 413);
    const assignedIds = new Set(assignments.filter(row => row.ScopeId === scopeId).map(row => row.StaffId).filter(Boolean));
    const active = row => staffInGradeScope(row, user, identity, branchId)
      && !['false', 'no', '0', 'disabled', 'inactive'].includes(lower(row.Active));
    const assigned = (await db.getDocuments(env, 'staffUsers', [...assignedIds])).filter(active);
    const selected = new Set(assigned.map(staffUsername));
    const legacyNames = [...new Set(profiles.filter(row => recordBranchId(row) === branchId
      && legacyGradeProfileVisible(row, identity.edition))
      .map(row => lower(row.Username)).filter(name => name && !selected.has(name)))];
    const legacy = (await batchStaffRows(env, user, identity, branchId, legacyNames, { skipMissing: true }))
      .filter(row => active(row) && !assignedIds.has(row.__id));
    const keys = await Promise.all(legacy.map(row => gradeAssignmentId(scopeId, row)));
    const current = await db.getDocuments(env, PAY_GRADE_ASSIGNMENTS, keys);
    legacy.forEach((row, index) => {
      if (!current[index]) selected.add(staffUsername(row));
    });
    return { ok: true, usernames: [...selected] };
  }

  async function payGrades(env, user, identity, body, action) {
    const branchId = enforceActorBranch(user, body.BranchId);
    const scopeId = await payGradeScopeId(identity, branchId);
    if (action === 'listpaygrades') {
      const rows = await db.queryCollection(env, PAY_GRADES, { filters: [{ field: 'ScopeId', op: '==', value: scopeId }], limit: 501 });
      if (rows.length > 500) throw fail('The branch pay grade list is too large to load.', 413);
      return { ok: true, grades: rows.map(gradeView) };
    }
    if (action === 'savepaygrade') {
      const names = gradeNames(body);
      const salary = salaryValues(body);
      if ([...salary.Allowances, ...salary.Deductions].some(row => row.Name.length > 120)) {
        throw fail('Allowance and deduction names must use at most 120 characters.');
      }
      const requestedId = clean(body.GradeId);
      const slot = requestedId ? null : await gradeNameSlot(env, scopeId, names);
      const existingId = requestedId || slot?.gradeId;
      const row = existingId ? slot?.legacy || await scopedGrade(env, scopeId, existingId) : null;
      assertGradeRevision(row, body.GradeRevision);
      if (row && (row.PayGrade !== names.PayGrade || row.PayLevel !== names.PayLevel)) {
        throw fail('Use Edit grade and level to change the name.', 409);
      }
      if (row && JSON.stringify(salaryValues(row)) === JSON.stringify(salary)) return { ok: true, grade: gradeView(row) };
      const GradeId = existingId || await digest([scopeId, crypto.randomUUID()]);
      const data = { GradeId, ...names, ...salary, ScopeId: scopeId, BranchId: branchId, WorkspaceId: identity.workspaceId,
        OrganisationEdition: identity.edition, ...gradeRevision(user) };
      const writes = [{ collectionPath: PAY_GRADES, documentId: GradeId, data, ...condition(row) }];
      if (!row) writes.push(claimGradeName(slot.nameId, GradeId));
      await db.batchCommitLiteralDocuments(env, writes);
      return { ok: true, grade: gradeView(data) };
    }

    const gradeId = clean(body.GradeId);
    const grade = await scopedGrade(env, scopeId, gradeId);
    if (action === 'renamepaygrade' || action === 'deletepaygrade') {
      assertGradeRevision(grade, body.GradeRevision);
      const oldNameId = await gradeNameKey(scopeId, grade);
      const target = { collectionPath: PAY_GRADES, documentId: gradeId, ...condition(grade) };
      if (action === 'deletepaygrade') {
        await db.batchCommitLiteralDocuments(env, [{ ...target, operation: 'delete' },
          ...await releaseGradeName(env, oldNameId, gradeId)]);
        return { ok: true };
      }
      const names = gradeNames(body);
      if (names.PayGrade === grade.PayGrade && names.PayLevel === grade.PayLevel) return { ok: true, grade: gradeView(grade) };
      const data = { ...names, ...gradeRevision(user) };
      const writes = [{ ...target, data, updateMask: Object.keys(data) }];
      const newNameId = await gradeNameKey(scopeId, names);
      if (newNameId !== oldNameId) {
        const slot = await gradeNameSlot(env, scopeId, names);
        if (slot.gradeId) throw fail('That grade and level already exists in this branch.', 409);
        writes.push(claimGradeName(slot.nameId, gradeId), ...await releaseGradeName(env, oldNameId, gradeId));
      }
      await db.batchCommitLiteralDocuments(env, writes);
      return { ok: true, grade: gradeView({ ...grade, ...data }) };
    }
    if (action === 'listpaygrademembers') {
      return gradeMembers(env, user, identity, branchId, scopeId, gradeId);
    }

    const usernames = Array.isArray(body.Usernames) ? [...new Set(body.Usernames.map(lower).filter(Boolean))].sort() : [];
    if (!usernames.length || usernames.length > 50) throw fail('Select between 1 and 50 staff for the batch.');
    const assigning = action === 'assignpaygrademembers';
    if (assigning) assertGradeRevision(grade, body.GradeRevision);
    const staff = await batchStaffRows(env, user, identity, branchId, usernames);
    if (new Set(staff.map(row => row.__id)).size !== staff.length) throw fail('The selection includes more than one login for the same employee.', 409);
    const keys = await Promise.all(staff.map(row => gradeAssignmentId(scopeId, row)));
    const [targets, assignments] = await Promise.all([
      batchSalaryTargets(env, identity, branchId, staff, { readProfiles: !assigning }),
      db.getDocuments(env, PAY_GRADE_ASSIGNMENTS, keys)
    ]);
    const gradeGuard = { collectionPath: PAY_GRADES, documentId: gradeId, data: { Revision: grade.Revision }, updateMask: ['Revision'], ...condition(grade) };
    if (assigning) {
      const timestamp = db.now();
      const changes = targets.flatMap((target, index) => {
        assertSalaryEmployeeActive(target);
        const existing = assignments[index];
        if (existing?.PayGradeId === gradeId) return [];
        const data = { ScopeId: scopeId, StaffId: target.staff.__id, PayGradeId: gradeId, UpdatedAt: timestamp, UpdatedBy: lower(user.username) };
        const assignment = { collectionPath: PAY_GRADE_ASSIGNMENTS, documentId: keys[index], data, ...condition(existing) };
        const audit = auditWrite(`GRADE-${crypto.randomUUID()}`, user, target, 'ASSIGN PAY GRADE AND LEVEL', timestamp);
        audit.data.Details = `${target.employee.DisplayName} · ${grade.PayGrade} / ${grade.PayLevel}`;
        return [{ target, assignment, audit }];
      });
      if (!changes.length) return { ok: true, assignedCount: 0 };
      const guards = changes.flatMap(({ target }) => identityGuards(target));
      const distinctGuards = [...new Map(guards.map(write => [`${write.collectionPath}/${write.documentId}`, write])).values()];
      await db.batchCommitLiteralDocuments(env, [gradeGuard, ...distinctGuards, ...changes.flatMap(({ assignment, audit }) => [assignment, audit])]);
      return { ok: true, assignedCount: changes.length };
    }
    const desired = { ...salaryValues(grade), PayGradeId: gradeId, PayGrade: grade.PayGrade, PayLevel: grade.PayLevel, PayGradeRevision: grade.Revision };
    for (const [index, target] of targets.entries()) {
      try {
        assertSalaryEmployeeActive(target);
        if (assignments[index] && assignments[index].PayGradeId !== gradeId) throw fail('This employee is assigned to a different pay grade and level. Update their assignment before applying this salary.', 409);
        assertSalaryProfileEditable(target);
        if (['no', 'false', '0', 'disabled', 'inactive'].includes(lower(target.profile?.Active))) throw fail('The payroll profile is inactive.', 409);
        if (target.profile && (clean(target.profile.Currency || 'NGN').toUpperCase() !== 'NGN'
            || lower(target.profile.PayFrequency || 'Monthly') !== 'monthly')) throw fail('The payroll profile uses a different currency or pay frequency.', 409);
      } catch (error) {
        if (!error.status || error.status >= 500) throw error;
        throw fail(`${target.employee.Username}: ${error.message}`, error.status);
      }
    }
    const changed = targets.filter(target => !salaryMatches(target.profile, desired));
    const previewVersion = await digest([scopeId, gradeId, grade.Revision, lower(user.username), targets.map(target => [
      target.employeeKey, clean(target.staff.__updateTime), clean(target.profile?.__updateTime),
      target.employeeRecords.map(row => [row.__id, row.__updateTime]).sort((a, b) => a[0].localeCompare(b[0]))
    ])]);
    if (action === 'getpaygradepreview') {
      return { ok: true, grade: gradeView(grade), previewVersion, changedCount: changed.length, staff: targets.map(target => ({
        Username: target.employee.Username, DisplayName: target.employee.DisplayName, current: safeProfile(target.profile)
      })) };
    }
    if (!changed.length) return { ok: true, updatedCount: 0 };
    if (clean(body.PreviewVersion) !== previewVersion) throw fail('The grade, employee or payroll data changed. Preview the batch again.', 409);
    const timestamp = db.now();
    const plans = await Promise.all(changed.map(target => salaryWritePlan(env, user, target, desired, timestamp, 'APPLY PAY GRADE SALARY STRUCTURE', { batch: true })));
    const writes = plans.flatMap(plan => plan.writes);
    if (new Set(writes.map(write => `${write.collectionPath}/${write.documentId}`)).size !== writes.length) {
      throw fail('The selection has overlapping payroll or employee records. Resolve the duplicate links before applying.', 409);
    }
    // Guard the exact grade revision in the same commit as the profile writes.
    writes.push(gradeGuard);
    await db.batchCommitLiteralDocuments(env, writes);
    return { ok: true, updatedCount: changed.length };
  }

  return async function handle(env, user, body) {
    const identity = db.requiredDeploymentIdentity(env), capabilities = hrCapabilitiesFor(user), action = lower(body.action);
    const templateAction = SALARY_TEMPLATE_ACTIONS.includes(action);
    const gradeAction = HR_PAY_GRADE_ACTIONS.includes(action);
    if (!(user.allowedSections || []).includes('humanResources') || !clean(user.username) || lower(user.edition || identity.edition) !== identity.edition) throw fail('Human Resources access is required.', 403);
    if (!capabilities.canViewSalaryStructure) throw fail('Your role cannot view employee salary structures or employment letters.', 403);
    const writesEmployment = (templateAction && action !== 'listsalarytemplates')
      || PAY_GRADE_WRITE_ACTIONS.includes(action) || ['savesalarystructure', 'saveemploymentletter', 'sendemploymentletter'].includes(action);
    if (writesEmployment && (user.subscriptionReadOnly === true || user.subscriptionActive === false)) throw fail('Human Resources changes are read-only until the subscription is renewed.', 403);
    if ((templateAction || gradeAction || action === 'savesalarystructure') && !capabilities.canManageSalaryStructure) throw fail('Your role cannot change salary structures.', 403);
    if (templateAction) return salaryTemplates(env, user, identity, body, action);
    if (gradeAction) return payGrades(env, user, identity, body, action);
    if (action.includes('employmentletter') && !capabilities.canIssueEmploymentLetters) throw fail('Your role cannot prepare or send employment letters.', 403);
    const target = await targetFor(env, user, body, identity);
    if (['savesalarystructure', 'saveemploymentletter', 'sendemploymentletter'].includes(action)) assertSalaryEmployeeActive(target);
    if (action === 'getsalarystructure') return salaryResult(env, user, target, { withLetters: capabilities.canIssueEmploymentLetters });
    if (action === 'savesalarystructure') {
      assertSalaryProfileEditable(target);
      const desired = salaryValues(body, target.profile || {});
      if (salaryMatches(target.profile, desired)) {
        return { ...await salaryResult(env, user, target), message: 'The salary structure is already saved. No records were changed.' };
      }
      if (!Object.hasOwn(body, 'PayrollVersion') || clean(body.PayrollVersion) !== clean(target.profile?.__updateTime)) throw fail('This salary structure changed or has not been loaded. Load the employee again before saving.', 409);
      const { documentId, writes } = await salaryWritePlan(env, user, target, desired, db.now(), 'SAVE EMPLOYEE SALARY STRUCTURE');
      await db.batchCommitLiteralDocuments(env, writes);
      target.profile = await db.getDocument(env, 'payrollProfiles', documentId);
      if (!target.profile) throw fail('The salary was saved but could not be reloaded. Load the employee again before making another change.', 503);
      return { ...await salaryResult(env, user, target), message: 'Salary structure saved. Existing payroll runs, payslips and payment records were preserved.' };
    }
    if (['previewemploymentletter', 'saveemploymentletter'].includes(action) && !body.LetterId) {
      const draft = await draftFor(env, user, target, body);
      if (action === 'saveemploymentletter') {
        const existing = await db.getDocument(env, LETTERS, draft.row.LetterId);
        if (existing) return { ok: true, letter: await loadedDocumentResult(env, existing), message: 'This employment letter is already saved. No duplicate was created.' };
      }
      const bytes = await db.createEmploymentLetterPdf(draft.profile, draft.row, { signatureDataUrl: draft.signatureDataUrl });
      if (!bytes.byteLength || bytes.byteLength > 525000) throw fail('The employment PDF is too large. Reduce the configured logo or signature image size and preview again.');
      const pdf = base64(bytes);
      if (action === 'previewemploymentletter') return { ok: true, letter: documentResult({ ...draft.row, PdfBase64: pdf, LetterId: '', Status: 'Preview' }), message: 'Preview only. No record was saved and no email was sent.' };
      const hash = await bytesDigest(bytes);
      const stored = await storage.putStoredDocument(env, { bytes, operationId: `${draft.row.LetterId}-${hash.slice(0, 40)}`,
        category: 'human-resources', branchId: target.employee.BranchId, schoolSection: 'all', ownerId: target.employeeKey,
        documentType: 'employment-letter', fileName: draft.row.FileName, mimeType: 'application/pdf' });
      // PDFs are private R2 objects; Firestore contains only the operational
      // draft, immutable storage identity and hash, never indexed PDF bytes.
      const row = { ...draft.row, PdfDocumentReference: stored.reference, PdfObjectKey: stored.key,
        PdfSha256: hash, PdfBytes: bytes.byteLength, PdfContentType: 'application/pdf', CreatedAt: db.now() };
      const created = await db.createDocumentIfAbsent(env, LETTERS, row.LetterId, row);
      const saved = created.document;
      if (!saved?.__updateTime) throw fail('The saved draft could not be confirmed. Reload the employee before retrying; no email was sent.', 503);
      if (!created.created && saved.PdfDocumentReference !== row.PdfDocumentReference) {
        // Another request won the immutable draft create. Its known saved
        // reference proves this content-addressed object is unused by the
        // letter. Never delete on an ambiguous Firestore/network failure.
        await storage.deleteStoredDocument(env, row.PdfDocumentReference).catch(() => {});
      }
      return { ok: true, letter: saved.PdfDocumentReference === stored.reference
        ? documentResult({ ...saved, PdfBase64: pdf }) : await loadedDocumentResult(env, saved), message: 'Employment letter saved as a draft. Review the PDF before sending.' };
    }
    if (!['loademploymentletter', 'previewemploymentletter', 'sendemploymentletter'].includes(action)) throw fail('Choose a valid employee salary or employment letter action.');
    const id = clean(body.LetterId);
    if (!/^EMP-[a-f0-9]{32}$/.test(id)) throw fail('Select a saved employment letter.');
    const row = await db.getDocument(env, LETTERS, id);
    if (!row || row.EmployeeKey !== target.employeeKey || row.WorkspaceId !== identity.workspaceId || row.OrganisationEdition !== identity.edition || row.BranchId !== target.employee.BranchId) throw fail('Employment letter was not found for this employee and branch.', 404);
    if (action !== 'sendemploymentletter') return { ok: true, letter: await loadedDocumentResult(env, row), message: 'Saved employment letter loaded.' };
    if (body.ConfirmSend !== true || lower(body.ConfirmedRecipientEmail) !== row.RecipientEmail) throw fail('Review the saved PDF and confirm its employee recipient before sending.');
    if (row.Status === 'Sent') return { ok: true, letter: await loadedDocumentResult(env, row), message: 'The provider already accepted this employment letter. It was not sent again.' };
    if (!['Draft', 'Failed'].includes(row.Status)) throw fail('Delivery is in progress or its outcome is uncertain. Check the email provider log before any further sending; automatic resend is blocked.', 409);
    if (clean(body.LetterVersion) !== clean(row.__updateTime)) throw fail('This letter changed. Reload its saved PDF before sending.', 409);
    const salary = await salaryFor(env, target, row.Terms.StartDate);
    if (row.EmployeeFingerprint !== await employeeFingerprint(target) || row.SalaryFingerprint !== salary?.Fingerprint || target.employee.WorkEmail !== row.RecipientEmail) throw fail('The saved employee details or salary changed after this draft. Prepare and review a new employment letter before sending.', 409);
    const pdf = await pdfFor(env, row);
    const sending = { ...plain(row), Status: 'Sending', SendStartedAt: db.now() };
    // Claim delivery against the same employee, HR and payroll/component
    // revisions that were reviewed. A concurrent change aborts before email.
    const claimWrites = [ ...identityGuards(target), ...salaryGuards(target),
      { collectionPath: LETTERS, documentId: id, data: sending, ...condition(row) } ];
    const claim = await db.batchCommitLiteralDocuments(env, claimWrites);
    const claimVersion = clean(claim?.writeResults?.[claimWrites.length - 1]?.updateTime);
    const claimed = claimVersion ? { ...sending, __id: id, __updateTime: claimVersion } : await db.getDocument(env, LETTERS, id);
    if (!claimed || claimed.Status !== 'Sending') throw fail('The delivery claim could not be verified. Nothing was sent; reload the saved letter.', 503);
    let delivery;
    try {
      const message = `Dear ${row.EmployeeName},\n\nPlease find attached your employment letter from ${row.EmployerName}. Review the appointment, salary structure and terms in the PDF, then contact Human Resources about acceptance.\n\nReference: ${row.LetterId}\n\n${row.IssuerName}\n${row.IssuerTitle}`;
      delivery = await db.sendConfiguredEmail(env, { toEmail: row.RecipientEmail, toName: row.EmployeeName,
        subject: `Employment letter - ${row.EmployerName}`, textContent: message,
        htmlContent: `<div style="font-family:Arial,sans-serif;white-space:pre-line">${escapeEmailHtml(message)}</div>`,
        branchId: row.BranchId, attachments: [{ name: row.FileName, content: pdf }], requireAttachments: true });
      if (!delivery?.ok || delivery.attachmentFallback) throw fail('The provider did not confirm acceptance of the email with its PDF attachment.', 503);
    } catch (error) {
      const status = error.retrySafe === true ? 'Failed' : 'Uncertain';
      await db.updateDocumentIfCurrent(env, LETTERS, id, { ...plain(claimed), Status: status, LastFailureCode: clean(error.code) || 'EMAIL_NOT_CONFIRMED' }, claimed);
      throw fail(status === 'Failed' ? `${error.message} Reload the saved letter to retry.` : 'Email acceptance could not be confirmed. Check the provider log; automatic resend is blocked to prevent duplicate letters.', error.status || 503);
    }
    const sent = { ...plain(claimed), Status: 'Sent', SentAt: db.now(), SentBy: lower(user.username),
      Provider: clean(delivery.provider), ProviderMessageId: clean(delivery.providerMessageId) };
    try {
      await db.batchCommitLiteralDocuments(env, [
        { collectionPath: LETTERS, documentId: id, data: sent, ...condition(claimed) },
        auditWrite(`SEND-${id}`, user, target, 'SEND EMPLOYMENT LETTER', sent.SentAt)
      ]);
    } catch {
      throw fail('The provider accepted the email, but the delivery record could not be confirmed. Do not resend; check the provider log.', 503);
    }
    return { ok: true, letter: documentResult({ ...sent, PdfBase64: pdf }), message: `Employment PDF accepted by the email provider for ${row.RecipientEmail}. This does not confirm that it has been read.` };
  };
}

export const handleHrEmploymentLetter = hrEmploymentLetterService();
