import { batchCommitDocuments, getDocument, listCollectionForReport, queryCollectionPages } from './firestore.js';
import { getAccountingChartRows } from './accounting-reference-cache.js';
import { validateRequisitionPosting } from './requisition-posting.js';
import { canonicalSchoolBranchId, schoolCollectionPaths, schoolSectionFor } from './school-scope.js';
import { selectStudentBillingProfiles, studentBillingIdentity, studentProfileValue } from './student-billing-profile.js';
import { withStudentDisplayName } from './student-display-name.js';
import { studentWalletProfile } from './student-wallet-profile.js';
import { requireConfiguredDesktopSecret, secureTextEqual } from './backend-security.js';
import { verifyStaffApprovalPassword } from './staff-auth.js';
import { walletAccountPayload } from '../api/backend.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const plain = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
const roles = new Set(['Accounts Officer', 'Super Admin', 'Director']);
export const OFFERING_BATCH_SIZE = 5;
export const OFFERING_COLLECTION = 'boardingServiceOfferings';
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const money = cents => cents / 100;
export function offeringCents(value) {
  const text = clean(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text) || Number(text) > 10000000) fail('Enter a non-negative amount with at most two decimal places (maximum 10,000,000).');
  return Math.round(Number(text) * 100);
}
function dateOnly(value) {
  const text = clean(value), date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) fail('Choose a valid service or remittance date.');
  return text;
}
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function previewSignature(env, user, scope, input, expires) {
  const secret = requireConfiguredDesktopSecret(env, 'boarding offering preview');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = JSON.stringify({ username: lower(user.username), scope, input, expires });
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function previewToken(env, user, scope, input) {
  const expires = Date.now() + 15 * 60 * 1000;
  return `${expires}.${await previewSignature(env, user, scope, input, expires)}`;
}
async function verifyPreviews(env, user, scope, input, tokens) {
  const count = Math.ceil(input.Rows.length / OFFERING_BATCH_SIZE);
  if (!Array.isArray(tokens) || tokens.length !== count) fail('Preview every selected student before confirming.', 409);
  for (let index = 0; index < count; index++) {
    const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(clean(tokens[index]));
    if (!match || Number(match[1]) <= Date.now() || Number(match[1]) > Date.now() + 15 * 60 * 1000) fail('The offering preview expired. Preview again before confirming.', 409);
    const chunk = { ...input, Rows: input.Rows.slice(index * OFFERING_BATCH_SIZE, (index + 1) * OFFERING_BATCH_SIZE) };
    if (!secureTextEqual(match[2], await previewSignature(env, user, scope, chunk, Number(match[1])))) fail('The selected students, amounts or service details changed. Preview again before confirming.', 409);
  }
}
export function offeringScope(user) {
  if (!clean(user.username) || lower(user.edition) !== 'school' || !roles.has(clean(user.assignedRole || user.role))
    || !(user.allowedSections || []).includes('accounts')) fail('Only school Accounts Officers, Directors and Super Admins with Accounts access may manage boarding offerings.', 403);
  if (!clean(user.branchId) || lower(user.branchId) === 'all') fail('Select one working branch before managing boarding offerings.', 403);
  const section = lower(user.schoolSectionAccess || 'All');
  if (!['all', 'primary', 'secondary'].includes(section)) fail('Your school section access is invalid.', 403);
  return { BranchId: canonicalSchoolBranchId(user.branchId), SchoolSection: section === 'all' ? 'All' : section,
    OrganisationEdition: 'school' };
}
export function isOfferingBoarder(row) {
  const type = studentProfileValue(row, 'StudentType', ['studentType', 'BoardingPreference', 'boardingPreference', 'ResidencyType', 'residencyType']);
  const status = studentProfileValue(row, 'Status', ['status'], 'Active');
  return /\b(board(?:ing|er)?|hostel|resident)\b/i.test(type) && !/\b(?:non|not)[- ]?board/i.test(type)
    && !['inactive', 'disabled', 'withdrawn', 'graduated', 'left', 'suspended', 'deceased', 'on leave', 'transferred', 'no', 'false', '0'].includes(lower(status))
    && !['no', 'false', '0', 'disabled', 'inactive'].includes(lower(row.Active ?? row.active ?? 'YES'));
}
function inScope(row, scope) {
  const identity = studentBillingIdentity(row);
  const path = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/students$/i.exec(clean(row.__scopePath));
  if (path && ((clean(row.BranchId || row.branchId) && canonicalSchoolBranchId(row.BranchId || row.branchId) !== identity.branch)
    || (clean(row.SchoolSection || row.schoolSection) && schoolSectionFor(row) !== identity.section))) fail('A student profile has conflicting branch or section ownership. Review the student profile before deducting offerings.', 409);
  return identity.branch === scope.BranchId && (scope.SchoolSection === 'All' || identity.section === scope.SchoolSection);
}
function studentKey(row) { const identity = studentBillingIdentity(row); return `${identity.section}|${identity.reference}`; }
function publicStudent(row) {
  return { StudentKey: studentKey(row), StudentDocumentId: clean(row.__id), AccountRef: studentProfileValue(row, 'AdmissionNo', ['admissionNo', 'AccountRef', 'accountRef', '__id']),
    DisplayName: clean(row.DisplayName), ClassName: studentProfileValue(row, 'ClassName', ['className', 'ClassAdmitted']),
    SchoolSection: studentBillingIdentity(row).section, WalletCardStatus: studentWalletProfile(row).WalletCardStatus,
    PinProtected: Boolean(clean(row.WalletPinHash || row.walletPinHash)) && Number(row.WalletPinThreshold || row.walletPinThreshold) > 0 };
}
function serviceVisible(service, scope) {
  return service && service.OrganisationEdition === 'school' && service.BranchId === scope.BranchId
    && Array.isArray(service.Rows) && service.Rows.every(row => scope.SchoolSection === 'All' || row.SchoolSection === scope.SchoolSection);
}
function publicService(service) {
  return { ServiceId: service.ServiceId, Reference: service.Reference, Date: service.Date, ServiceName: service.ServiceName,
    ChurchName: service.ChurchName, PayableAccount: service.PayableAccount, Notes: service.Notes, Status: service.Status,
    Count: service.Rows.length, PostedCount: service.PostedCount, Total: money(service.TotalCents), Collected: money(service.CollectedCents),
    Remitted: money(service.RemittedCents), Outstanding: money(service.CollectedCents - service.RemittedCents),
    Rows: service.Rows.map(({ StudentKey, AccountRef, DisplayName, ClassName, AmountCents, SchoolSection }, index) =>
      ({ StudentKey, AccountRef, DisplayName, ClassName, Amount: money(AmountCents), SchoolSection, Posted: index < service.PostedCount })) };
}
async function mapLimited(items, task) {
  const result = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(5, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; result[index] = await task(items[index], index); }
  }));
  return result;
}
async function roster(env, scope, io) {
  const [paths, profile] = await Promise.all([io.paths(env, 'students', { branchId: scope.BranchId, schoolSectionAccess: scope.SchoolSection }), io.get(env, 'settings', 'schoolProfile')]);
  const groups = await Promise.all(paths.map(async path => (await io.list(env, path)).map(row => ({ ...row, __scopePath: path }))));
  return selectStudentBillingProfiles(groups.flat()).filter(row => inScope(row, scope) && isOfferingBoarder(row))
    .map(row => withStudentDisplayName(row, profile || {})).sort((a, b) => clean(a.DisplayName).localeCompare(clean(b.DisplayName)));
}
async function selectedStudents(env, scope, rows, io) {
  const ids = [...new Set(rows.map(row => clean(row.StudentDocumentId)))];
  if (ids.some(id => !id || id.length > 512 || id.includes('/') || id === '.' || id === '..')) fail('A selected student is no longer available. Reload the boarding list.', 409);
  const [paths, profile] = await Promise.all([io.paths(env, 'students', { branchId: scope.BranchId, schoolSectionAccess: scope.SchoolSection }), io.get(env, 'settings', 'schoolProfile')]);
  // Read only the five selected document IDs across the allowed scope paths.
  // The client ID is a lookup hint, never proof of membership or identity.
  const matches = await mapLimited(ids.flatMap(id => paths.map(path => ({ id, path }))), async ({ id, path }) => {
    const row = await io.get(env, path, id);
    return row ? { ...row, __scopePath: path } : null;
  });
  return selectStudentBillingProfiles(matches.filter(Boolean)).filter(row => inScope(row, scope) && isOfferingBoarder(row))
    .map(row => withStudentDisplayName(row, profile || {}));
}
function planInput(body) {
  const Reference = clean(body.Reference).toUpperCase();
  if (!/^[A-Z0-9_-]{3,80}$/.test(Reference)) fail('Use a unique service reference of 3–80 letters, numbers, hyphens or underscores. Reuse it when retrying the same service.');
  const ServiceName = clean(body.ServiceName), ChurchName = clean(body.ChurchName), Notes = clean(body.Notes);
  if (!ServiceName || ServiceName.length > 150 || !ChurchName || ChurchName.length > 150 || Notes.length > 1000) fail('Enter the service name and receiving church (up to 150 characters each); notes may contain up to 1,000 characters.');
  if (!Array.isArray(body.Rows) || !body.Rows.length || body.Rows.length > 2000) fail('Select between 1 and 2,000 boarding students.');
  const keys = new Set();
  const Rows = body.Rows.map(row => {
    const StudentKey = clean(row.StudentKey), AmountCents = offeringCents(row.Amount);
    if (!StudentKey || StudentKey.length > 200 || keys.has(StudentKey) || !AmountCents) fail('Each selected student must appear once with an amount greater than zero.');
    keys.add(StudentKey); return { StudentKey, AmountCents };
  }).sort((a, b) => a.StudentKey.localeCompare(b.StudentKey));
  return { Reference, Date: dateOnly(body.Date), ServiceName, ChurchName, Notes, PayableAccount: clean(body.PayableAccount), Rows };
}
export function offeringAccountChoices(chart) {
  const active = chart.filter(row => !['no', 'false', 'inactive', 'disabled', '0'].includes(lower(row.Active ?? 'YES')));
  return { payable: active.filter(row => clean(row.Code) !== '2200' && lower(row.Type) === 'liability' && lower(row.Group) === 'payables'),
    payment: active.filter(row => lower(row.Type) === 'asset' && lower(row.Group) === 'cash and bank') };
}
async function references(env, io) {
  const [chart, periods] = await Promise.all([io.chart(env, { fresh: true }), io.list(env, 'accountingPeriods')]);
  return { chart, periods, ...offeringAccountChoices(chart) };
}
function journal(service, id, value, date, user, paymentAccount = '') {
  const description = `${paymentAccount ? 'Remittance' : 'Boarding service offering'}: ${service.ServiceName} — ${service.ChurchName}`;
  return { JournalNo: id, Date: date, Status: 'Posted', System: 'YES', Source: paymentAccount ? 'Boarding Offering Remittance' : 'Boarding Service Offering',
    SourceId: service.ServiceId, Reference: service.Reference, Description: description, BranchId: service.BranchId,
    SchoolSection: service.SchoolSection, OrganisationEdition: 'school', Department: 'Boarding', Currency: 'NGN',
    CreatedAt: new Date().toISOString(), CreatedBy: clean(user.displayName || user.username), PostedBy: clean(user.username),
    TotalDebit: money(value), TotalCredit: money(value), Lines: [
      { LineNo: 1, AccountCode: paymentAccount ? service.PayableAccount : '2200', Debit: money(value), Credit: 0, Description: description },
      { LineNo: 2, AccountCode: paymentAccount || service.PayableAccount, Debit: 0, Credit: money(value), Description: description } ] };
}
function validateJournal(j, refs) {
  validateRequisitionPosting(j, refs.chart, refs.periods, 'school');
  if (j.Lines[0].AccountCode === '2200' && !refs.chart.some(row => clean(row.Code) === '2200' && lower(row.Type) === 'liability')) fail('Student Wallet Liability (2200) must be configured before deducting offerings.', 409);
}
async function walletCheck(env, student, amountCents, pin, io) {
  const identity = studentBillingIdentity(student);
  const account = await io.wallet(env, { ...student, BranchId: identity.branch, SchoolSection: identity.section }), errors = [];
  const balance = Math.round(Number(account.WalletBalance) * 100), spent = Math.round(Number(account.WalletSpentToday) * 100);
  if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(spent)) fail('The wallet balance could not be verified.', 409);
  for (const field of ['WalletTxnLimit', 'WalletDailyLimit', 'WalletPinThreshold']) {
    if (!Number.isFinite(Number(account[field] || 0)) || Number(account[field] || 0) < 0) fail('Wallet restrictions are invalid. Review the student wallet setup before deducting offerings.', 409);
  }
  if (lower(account.WalletCardStatus) !== 'active') errors.push(`Wallet is ${account.WalletCardStatus}.`);
  if (amountCents > balance) errors.push('Insufficient wallet balance.');
  if (Number(account.WalletTxnLimit) > 0 && amountCents > Math.round(Number(account.WalletTxnLimit) * 100)) errors.push('Wallet transaction limit exceeded.');
  if (Number(account.WalletDailyLimit) > 0 && spent + amountCents > Math.round(Number(account.WalletDailyLimit) * 100)) errors.push('Wallet daily limit exceeded.');
  const pinHash = clean(student.WalletPinHash || student.walletPinHash), threshold = Number(account.WalletPinThreshold);
  if (pinHash && threshold > 0 && amountCents >= Math.round(threshold * 100)) {
    const supplied = clean(pin);
    const hashed = supplied ? await digest(`${requireConfiguredDesktopSecret(env, 'wallet PIN')}:${supplied}`) : '';
    if (!supplied || !secureTextEqual(hashed, pinHash)) errors.push('A valid wallet PIN is required.');
  }
  return { account, balance, errors };
}
async function preview(env, user, scope, body, io) {
  const input = planInput(body), [students, refs] = await Promise.all([selectedStudents(env, scope, body.Rows, io), references(env, io)]);
  if (!refs.payable.some(row => clean(row.Code) === input.PayableAccount)) fail('Choose an active Payables liability account for money owed to the church. Do not use a revenue account.');
  const byKey = new Map(students.map(row => [studentKey(row), row]));
  const pins = new Map(body.Rows.map(row => [clean(row.StudentKey), row.Pin]));
  const Rows = await mapLimited(input.Rows, async row => {
    const student = byKey.get(row.StudentKey);
    if (!student || !student.__id || !student.__scopePath || !student.__updateTime) fail('A selected student is no longer an active boarder in this scope. Reload the list.', 409);
    const { balance, errors } = await walletCheck(env, student, row.AmountCents, pins.get(row.StudentKey), io);
    return { ...publicStudent(student), Amount: money(row.AmountCents), Balance: money(balance), BalanceAfter: money(balance - row.AmountCents),
      Errors: errors, StudentId: student.__id, StudentPath: student.__scopePath, StudentVersion: student.__updateTime, AmountCents: row.AmountCents };
  });
  const total = Rows.reduce((sum, row) => sum + row.AmountCents, 0);
  validateJournal(journal({ ...scope, ...input, ServiceId: 'preview' }, 'preview', total, input.Date, user), refs);
  const PreviewDigest = await digest(JSON.stringify({ scope, input, rows: Rows.map(row => [row.StudentKey, row.StudentVersion, row.Balance, row.Errors]) }));
  return { input, Rows, TotalCents: total, PreviewDigest, Ready: Rows.every(row => !row.Errors.length) };
}
function publicPreview(plan, token) {
  return { ok: true, PreviewDigest: plan.PreviewDigest, Ready: plan.Ready, Total: money(plan.TotalCents), Count: plan.Rows.length,
    PreviewToken: token,
    Rows: plan.Rows.map(({ StudentPath, StudentId, StudentVersion, AmountCents, ...row }) => row), message: plan.Ready ? 'Review these wallet deductions before confirming.' : 'Resolve the flagged wallets before confirming. No money has been deducted.' };
}
function write(collectionPath, documentId, data, previous = null) {
  if (previous && !clean(previous.__updateTime)) fail('Refresh this record before continuing.', 409);
  return { collectionPath, documentId, data: plain(data), ...(previous ? { updateTime: previous.__updateTime } : { exists: false }) };
}
function audit(scope, user, id, action, details) {
  return write('accountingAudit', `BOARDING-${id}`, { ...scope, AuditId: `BOARDING-${id}`, Timestamp: new Date().toISOString(),
    Action: action, EntityType: 'Boarding Service Offering', EntityId: id, User: clean(user.displayName || user.username),
    ActorUsername: clean(user.username), UserRole: clean(user.assignedRole || user.role), SourcePlatform: 'Web', Details: details });
}
async function commit(env, writes, io) {
  try { await io.commit(env, writes); }
  catch (error) {
    if ([409, 412].includes(Number(error.status))) fail('A wallet or service record changed. This batch was not partially posted. Reload the service before retrying; completed students will not be charged twice.', 409);
    throw error;
  }
}
async function scopedService(env, scope, serviceId, io) {
  if (!/^BO-[a-f0-9]{40}$/.test(clean(serviceId))) fail('Choose a valid boarding offering service.');
  const saved = await io.get(env, OFFERING_COLLECTION, serviceId);
  if (!serviceVisible(saved, scope)) fail('This offering service is unavailable in your branch or school section.', 404);
  return saved;
}

// Storage and credential dependencies are injectable for deterministic finance tests.
export async function handleBoardingOfferings(env, user, body, dependencies = {}) {
  const scope = offeringScope(user), action = clean(body.action);
  const io = { get: getDocument, list: listCollectionForReport, query: queryCollectionPages, chart: getAccountingChartRows,
    wallet: walletAccountPayload, commit: batchCommitDocuments, paths: schoolCollectionPaths,
    authorize: async () => verifyStaffApprovalPassword(env, user.username, body.approvalPassword), ...dependencies };
  if (!['bootstrap', 'preview', 'start', 'postNext', 'remit'].includes(action)) fail('Choose a valid boarding offering action.');
  if (['start', 'postNext', 'remit'].includes(action)) {
    if (user.subscriptionReadOnly || user.subscriptionActive === false) fail('This workspace is read-only.', 403);
    if (body.Authorized !== true || !await io.authorize()) fail('Confirm the authorised offering instruction and enter your current staff password.', 403);
  }
  if (action === 'bootstrap') {
    const [students, chart, services] = await Promise.all([roster(env, scope, io), io.chart(env, { fresh: true }),
      io.query(env, OFFERING_COLLECTION, { filters: [{ field: 'BranchId', op: '==', value: scope.BranchId }], pageSize: 250, maxRows: 5000 })]);
    const choices = offeringAccountChoices(chart), publicAccount = row => ({ Code: clean(row.Code), Name: clean(row.Name) });
    return { ok: true, Students: students.map(publicStudent), PayableAccounts: choices.payable.map(publicAccount), PaymentAccounts: choices.payment.map(publicAccount),
      Services: services.filter(row => serviceVisible(row, scope)).sort((a, b) => clean(b.CreatedAt).localeCompare(clean(a.CreatedAt))).slice(0, 30).map(publicService) };
  }
  if (action === 'preview') {
    if (!Array.isArray(body.Rows) || body.Rows.length > OFFERING_BATCH_SIZE) fail(`Preview at most ${OFFERING_BATCH_SIZE} students per request. The screen will process larger selections in small batches.`);
    const plan = await preview(env, user, scope, body, io);
    return publicPreview(plan, plan.Ready ? await previewToken(env, user, scope, plan.input) : '');
  }
  if (action === 'start') {
    const input = planInput(body), ServiceId = `BO-${(await digest(`${scope.BranchId}|${input.Reference}`)).slice(0, 40)}`;
    const BusinessDigest = await digest(JSON.stringify(input)), previous = await io.get(env, OFFERING_COLLECTION, ServiceId);
    if (previous) {
      if (!serviceVisible(previous, scope) || previous.BusinessDigest !== BusinessDigest) fail('This service reference already exists with different details. Review the recorded service; do not create a second reference for the same service.', 409);
      return { ok: true, replayed: true, Service: publicService(previous), message: 'This service already exists. Only unposted students can be processed.' };
    }
    // Ready previews are signed, user/scope/amount-bound and expire. Avoid a
    // school-wide wallet scan in one Worker request; each posting batch always
    // reloads its wallets, restrictions and balances before the atomic debit.
    await verifyPreviews(env, user, scope, input, body.PreviewTokens);
    const [students, refs] = await Promise.all([roster(env, scope, io), references(env, io)]);
    if (!refs.payable.some(row => clean(row.Code) === input.PayableAccount)) fail('Choose an active church payable account.');
    const byKey = new Map(students.map(row => [studentKey(row), row]));
    const rows = input.Rows.map(row => {
      const student = byKey.get(row.StudentKey);
      if (!student || !student.__id || !student.__scopePath || !student.__updateTime) fail('A selected boarding student changed. Reload and preview the service again.', 409);
      return { ...publicStudent(student), AmountCents: row.AmountCents, StudentId: student.__id, StudentPath: student.__scopePath };
    });
    const totalCents = rows.reduce((sum, row) => sum + row.AmountCents, 0);
    validateJournal(journal({ ...scope, ...input, ServiceId }, 'preview', totalCents, input.Date, user), refs);
    const timestamp = new Date().toISOString();
    const service = { ...scope, ...input, ServiceId, BusinessDigest,
      Rows: rows.map(({ PinProtected, WalletCardStatus, ...row }) => row),
      TotalCents: totalCents, CollectedCents: 0, RemittedCents: 0, PostedCount: 0, Status: 'Pending',
      CreatedAt: timestamp, CreatedBy: clean(user.username), AuthorizationConfirmedBy: clean(user.username), AuthorizationConfirmedAt: timestamp };
    await commit(env, [write(OFFERING_COLLECTION, ServiceId, service), audit(scope, user, ServiceId, 'AUTHORISE BOARDING OFFERING', `${input.Reference}; ${rows.length} students; total ${money(totalCents)}; receiving church ${input.ChurchName}`)], io);
    return { ok: true, Service: publicService(service), message: 'Service authorised. Wallet deductions will now be processed in small, atomic batches.' };
  }
  const service = await scopedService(env, scope, body.ServiceId, io);
  if (action === 'postNext') {
    const offset = Number(body.Offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > service.Rows.length || offset % OFFERING_BATCH_SIZE !== 0) fail('Choose a valid service batch.');
    if (offset < service.PostedCount) return { ok: true, replayed: true, Service: publicService(service), message: 'This batch was already recorded. No duplicate deductions were made.' };
    if (offset !== service.PostedCount) fail('Reload the service before posting the next batch.', 409);
    if (service.PostedCount === service.Rows.length) return { ok: true, Service: publicService(service), message: 'All offering deductions are already recorded.' };
    const refs = await references(env, io);
    if (!refs.payable.some(row => clean(row.Code) === service.PayableAccount)) fail('The church payable account is no longer active. Ask Accounts to review it.', 409);
    const pins = new Map((Array.isArray(body.Rows) ? body.Rows : []).map(row => [clean(row.StudentKey), row.Pin]));
    const batch = service.Rows.slice(offset, offset + OFFERING_BATCH_SIZE), timestamp = new Date().toISOString();
    const groups = await mapLimited(batch, async (row, index) => {
      const student = await io.get(env, row.StudentPath, row.StudentId);
      if (!student) fail(`${row.DisplayName}: the student record is no longer available.`, 409);
      student.__scopePath = row.StudentPath;
      if (!isOfferingBoarder(student) || !inScope(student, scope) || studentKey(student) !== row.StudentKey) fail(`${row.DisplayName}: boarding status or scope changed. No deductions were made in this batch.`, 409);
      const { account, errors } = await walletCheck(env, student, row.AmountCents, pins.get(row.StudentKey), io);
      if (errors.length) fail(`${row.DisplayName}: ${errors.join(' ')} No deductions were made in this batch.`, 409);
      const id = `${service.ServiceId}-${offset + index}`, ledgerNo = `OFFERING-${id}`;
      const entry = { LedgerNo: ledgerNo, Date: timestamp, ServiceDate: service.Date, AccountRef: account.AccountRef, AdmissionNo: account.AdmissionNo,
        ApplicationReference: account.ApplicationReference, DisplayName: row.DisplayName, ClassName: row.ClassName,
        AcademicSession: account.AcademicSession, Term: account.Term, BranchId: scope.BranchId, SchoolSection: row.SchoolSection,
        OrganisationEdition: 'school', EntryType: 'Wallet Offering', FeeCategory: 'Wallet', FeeCode: 'BOARDING_SERVICE_OFFERING',
        Department: 'Boarding', Description: `${service.ServiceName} — offering for ${service.ChurchName}`, Debit: money(row.AmountCents), Credit: 0,
        Currency: 'NGN', Reference: service.Reference, ServiceId: service.ServiceId, RecordedBy: clean(user.displayName || user.username),
        Source: 'Boarding Service Offering' };
      const j = journal({ ...service, SchoolSection: row.SchoolSection }, `SYS-${ledgerNo}`, row.AmountCents, service.Date, user);
      validateJournal(j, refs);
      return [write(row.StudentPath, row.StudentId, { WalletLastPurchaseAt: timestamp, WalletLastPurchaseNo: ledgerNo }, student),
        write('ledger', ledgerNo, entry), write('accountingJournals', j.JournalNo, j)];
    });
    // Patch only the concurrency guard; never overwrite an enrolment/profile field.
    for (const writes of groups) writes[0].updateMask = ['WalletLastPurchaseAt', 'WalletLastPurchaseNo'];
    const collected = batch.reduce((sum, row) => sum + row.AmountCents, 0), count = offset + batch.length;
    const updated = { ...service, PostedCount: count, CollectedCents: service.CollectedCents + collected,
      Status: count === service.Rows.length ? 'Collected' : 'Partially collected', UpdatedAt: timestamp };
    await commit(env, [...groups.flat(), write(OFFERING_COLLECTION, service.ServiceId, updated, service),
      audit(scope, user, `${service.ServiceId}-${offset}`, 'DEDUCT BOARDING OFFERINGS', `${service.Reference}; students ${offset + 1}–${count}; amount ${money(collected)}`)], io);
    return { ok: true, Service: publicService(updated), message: `${count} of ${service.Rows.length} students processed; ${money(updated.CollectedCents)} collected.` };
  }
  const amountCents = offeringCents(body.Amount), remittanceRef = clean(body.RemittanceReference).toUpperCase();
  if (!amountCents || !/^[A-Z0-9_-]{3,100}$/.test(remittanceRef)) fail('Enter a positive remittance amount and a unique payment reference (letters, numbers, hyphens or underscores).');
  const operationId = `${service.ServiceId}-${(await digest(remittanceRef)).slice(0, 32)}`, paymentAccount = clean(body.PaymentAccount), date = dateOnly(body.Date);
  const previous = await io.get(env, 'boardingOfferingRemittances', operationId);
  if (previous) {
    if (previous.AmountCents !== amountCents || previous.PaymentAccount !== paymentAccount || previous.Date !== date) fail('This remittance reference was already used with different details.', 409);
    return { ok: true, replayed: true, Service: publicService(service), message: 'This remittance was already recorded. No bank transfer was initiated.' };
  }
  if (amountCents > service.CollectedCents - service.RemittedCents) fail('The remittance exceeds the collected, unremitted offering balance.');
  const refs = await references(env, io);
  if (!refs.payment.some(row => clean(row.Code) === paymentAccount)) fail('Select an active cash or bank account for the remittance.');
  const j = journal(service, `SYS-REMIT-${operationId}`, amountCents, date, user, paymentAccount);
  validateJournal(j, refs);
  const updated = { ...service, RemittedCents: service.RemittedCents + amountCents, UpdatedAt: new Date().toISOString() };
  await commit(env, [write(OFFERING_COLLECTION, service.ServiceId, updated, service), write('accountingJournals', j.JournalNo, j),
    write('boardingOfferingRemittances', operationId, { ...scope, ServiceId: service.ServiceId, Reference: remittanceRef, Date: date,
      ChurchName: service.ChurchName, AmountCents: amountCents, PaymentAccount: paymentAccount, JournalNo: j.JournalNo, RecordedBy: clean(user.username) }),
    audit(scope, user, operationId, 'RECORD BOARDING OFFERING REMITTANCE', `${service.Reference}; payment ${remittanceRef}; amount ${money(amountCents)}`)], io);
  return { ok: true, Service: publicService(updated), message: 'Remittance recorded. No bank transfer was initiated.' };
}
