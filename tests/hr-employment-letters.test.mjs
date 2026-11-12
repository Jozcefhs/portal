import test from 'node:test';
import assert from 'node:assert/strict';
import { hrEmploymentLetterService, normalizeEmploymentLetterTerms } from '../functions/lib/hr-employment-letters.js';
import { hrCapabilitiesFor } from '../functions/lib/human-resources.js';

const clone = value => structuredClone(value);
const terms = { LetterDate: '2026-11-10', StartDate: '2026-12-01', Probation: 'Three months, subject to the agreed review.',
  NoticePeriod: 'One month in writing.', WorkingHours: 'Monday to Friday, 8am to 4pm.', Benefits: 'As listed in the attached staff policy.',
  Terms: 'Follow the organisation staff handbook.', AcceptanceDeadline: '2026-11-24' };
function fixture({ edition = 'school', role = 'HR Manager', branch = 'north', profile = true, advanced = false } = {}) {
  let version = 20, sendCount = 0, pdfCount = 0;
  const records = new Map(), reads = [], queries = [], writes = [], sent = [], objects = new Map(), storageCalls = [];
  const row = (collection, id, value) => records.set(`${collection}/${id}`, { ...value, __id: id, __updateTime: `v${++version}` });
  row('staffUsers', 'stable-staff-id', { Username: 'employee', DisplayName: 'Example Employee', Email: 'employee@example.org', Active: true,
    BranchId: branch, OrganisationEdition: edition, Position: 'Operations Officer', Department: 'Operations' });
  row('hrEmployees', 'employee', { Username: 'employee', EmployeeId: 'EMP-101', DisplayName: 'Example Employee', Position: 'Operations Officer',
    Department: 'Operations', WorkEmail: 'employee@example.org', EmploymentType: 'Permanent', HireDate: '2026-12-01', Status: 'Active', BranchId: branch, OrganisationEdition: edition });
  if (profile) row('payrollProfiles', 'existing-profile-id', { EmployeeId: 'EMP-101', Username: 'employee', BranchId: branch, OrganisationEdition: edition,
    DisplayName: 'Example Employee', BasicSalary: 100000, Allowances: [{ Name: 'Housing allowance', Amount: 25000 }], Deductions: [{ Name: 'Staff association', Amount: 1000 }],
    CalculationMode: advanced ? 'CONFIGURABLE_PAYE' : 'LEGACY_FLAT_RATE', BankName: 'Keep bank', AccountNumber: 'KEEP-ACCOUNT',
    TaxRate: 5, PensionRate: 8, TIN: 'KEEP-TIN', ComponentAssignments: advanced ? [{ ComponentId: 'BASIC', Amount: 200000 }, { ComponentId: 'HOUSING', Amount: 50000 }] : [],
    Active: 'YES', CreatedAt: '2020-01-01', Notes: 'Retain private notes' });
  row('payrollSalaryComponents', 'BASIC', { ComponentId: 'BASIC', Code: 'BASIC', Name: 'Basic salary', ComponentType: 'earning', CalculationType: 'fixed_amount', Active: 'YES', DisplayOrder: 1 });
  row('payrollSalaryComponents', 'HOUSING', { ComponentId: 'HOUSING', Code: 'HOUSING', Name: 'Housing allowance', ComponentType: 'earning', CalculationType: 'fixed_amount', Active: 'YES', DisplayOrder: 2 });
  row('settings', 'schoolProfile', { SchoolName: 'Example School', SchoolAddress: 'Example address', SchoolEmail: 'office@example.org' });
  row('settings', 'organisationProfile', { Name: 'Example Organisation', Address: 'Organisation address', Email: 'office@example.org' });
  row('payrollRuns', 'KEEP-RUN', { Amount: 123 }); row('payrollItems', 'KEEP-ITEM', { Amount: 456 }); row('payrollPayments', 'KEEP-PAYMENT', { Amount: 789 });
  const state = { beforeCommit: null, deliveryError: null, failSentCommit: false, uniquePdfs: false, failDraftCreate: false };
  const get = async (_env, collection, id) => { reads.push(`${collection}/${id}`); return clone(records.get(`${collection}/${id}`) || null); };
  const validate = write => {
    const stored = records.get(`${write.collectionPath}/${write.documentId}`);
    if (write.exists === false && stored || write.updateTime && stored?.__updateTime !== write.updateTime) throw Object.assign(new Error('Version conflict'), { status: 409 });
  };
  const commit = async (_env, items) => {
    if (state.beforeCommit) { const fn = state.beforeCommit; state.beforeCommit = null; fn(); }
    if (state.failSentCommit && items.some(write => write.collectionPath === 'hrEmploymentLetters' && write.data.Status === 'Sent')) throw new Error('Saved delivery unavailable');
    items.forEach(validate);
    writes.push(clone(items));
    for (const item of items) {
      const old = records.get(`${item.collectionPath}/${item.documentId}`);
      row(item.collectionPath, item.documentId, item.updateMask ? { ...old, ...item.data } : item.data);
    }
  };
  const service = hrEmploymentLetterService({
    now: () => '2026-11-10T10:00:00.000Z', getDocument: get,
    findStaffUserRecord: async (_env, username, options) => {
      assert.equal(options.allowListFallback, false); reads.push(`staff:${username}`);
      return clone([...records.entries()].find(([key, value]) => key.startsWith('staffUsers/') && [value.Username, value.LoginUsername, value.__id].includes(username))?.[1] || null);
    },
    queryCollection: async (_env, collection, options) => {
      queries.push({ collection, options: clone(options) });
      assert.ok(options.limit <= 101);
      const selected = [...records.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => value)
        .filter(value => options.filters.every(filter => filter.op === 'in' ? filter.value.includes(value[filter.field]) : value[filter.field] === filter.value)).slice(0, options.limit);
      return clone(selected.map(value => options.select ? { ...Object.fromEntries(options.select.map(key => [key, value[key]])), __id: value.__id, __updateTime: value.__updateTime } : value));
    },
    batchCommitLiteralDocuments: commit,
    createDocumentIfAbsent: async (_env, collection, id, data) => {
      if (state.failDraftCreate) throw new Error('Draft persistence outcome unknown');
      if (records.has(`${collection}/${id}`)) return { created: false, document: clone(records.get(`${collection}/${id}`)) };
      await commit({}, [{ collectionPath: collection, documentId: id, data, exists: false }]);
      return { created: true, document: clone(records.get(`${collection}/${id}`)) };
    },
    updateDocumentIfCurrent: async (_env, collection, id, data, current) => {
      await commit({}, [{ collectionPath: collection, documentId: id, data, updateTime: current.__updateTime }]);
      return clone(records.get(`${collection}/${id}`));
    },
    loadStaffApprovalProfile: async (_env, username) => { assert.equal(username, 'manager'); return null; },
    loadStaffPosition: async () => ({ IssuerTitle: 'Human Resources Manager' }),
    effectiveBranchProfile: async (_env, defaults, selectedBranch) => ({ ...defaults, BranchName: `${selectedBranch} branch` }),
    getDocumentBranding: async () => ({ WorkspaceId: 'test-workspace', OrganisationEdition: edition, DocumentLogoDataUrl: '' }),
    createEmploymentLetterPdf: async (_profile, letter, signature) => { pdfCount++; assert.equal(signature.signatureDataUrl, ''); return new TextEncoder().encode(`%PDF-1.4 ${letter.EmployeeName} ${letter.Salary.GrossPay}${state.uniquePdfs ? ` ${pdfCount}` : ''}`); },
    sendConfiguredEmail: async (_env, message) => { sendCount++; sent.push(clone(message)); if (state.deliveryError) throw state.deliveryError;
      return { ok: true, provider: 'fake-provider', providerMessageId: 'mock-message-id' }; }
  });
  const env = { DYNAMAX_WORKSPACE_ID: 'test-workspace', ORGANISATION_EDITION: edition, DYNAMAX_DOCUMENTS: {
    async put(key, bytes, options) { storageCalls.push(['put', key]); objects.set(key, { bytes: new Uint8Array(bytes), ...clone(options) }); return { etag: 'test-etag' }; },
    async get(key) { storageCalls.push(['get', key]); const stored = objects.get(key); if (!stored) return null;
      return { ...stored, size: stored.bytes.byteLength, arrayBuffer: async () => stored.bytes.slice().buffer }; },
    async delete(key) { storageCalls.push(['delete', key]); objects.delete(key); }
  } };
  const user = { username: 'manager', displayName: 'Example Manager', role, branchId: branch, edition, allowedSections: ['humanResources'] };
  const call = (action, body = {}, selectedUser = user) => service(env, selectedUser, { action, Username: 'employee', ...body });
  return { records, reads, queries, writes, sent, state, row, call, user, env, objects, storageCalls, sendCount: () => sendCount, pdfCount: () => pdfCount,
    async draft() { return (await call('saveEmploymentLetter', terms)).letter; },
    async send(letter) { return call('sendEmploymentLetter', { LetterId: letter.LetterId, LetterVersion: letter.LetterVersion, ConfirmedRecipientEmail: letter.RecipientEmail, ConfirmSend: true }); } };
}

test('reusable salary names are branch scoped and retries do not change payroll or duplicate names', async () => {
  const f = fixture();
  const payroll = clone(f.records.get('payrollProfiles/existing-profile-id'));
  assert.deepEqual((await f.call('listSalaryTemplates')).templates, { Allowances: [], Deductions: [] });
  assert.deepEqual((await f.call('addSalaryTemplate', { Kind: 'Allowances', Name: '  Housing   allowance  ', Amount: 999 })).templates,
    { Allowances: ['Housing allowance'], Deductions: [] });
  await f.call('addSalaryTemplate', { Kind: 'Allowances', Name: 'HOUSING allowance' });
  assert.equal(f.writes.length, 1);
  await f.call('addSalaryTemplate', { Kind: 'Deductions', Name: 'Staff association' });
  assert.deepEqual((await f.call('listSalaryTemplates')).templates,
    { Allowances: ['Housing allowance'], Deductions: ['Staff association'] });
  await assert.rejects(f.call('addSalaryTemplate', { Kind: 'Allowances', Name: 'Other', BranchId: 'another-branch' }), { status: 403 });
  const other = { ...f.user, branchId: 'another-branch' };
  assert.deepEqual((await f.call('listSalaryTemplates', {}, other)).templates, { Allowances: [], Deductions: [] });
  await assert.rejects(f.call('addSalaryTemplate', { Kind: 'Deductions', Name: 'Other' }, { ...f.user, subscriptionReadOnly: true }), { status: 403 });
  await assert.rejects(f.call('addSalaryTemplate', { Kind: 'Allowances', Name: 'Other' }, { ...f.user, role: 'Payroll Officer' }), { status: 403 });
  assert.deepEqual(f.records.get('payrollProfiles/existing-profile-id'), payroll);
  assert.deepEqual(f.queries, []);
  assert.ok(f.reads.every(read => read.startsWith('hrSalaryTemplates/')));
});

test('concurrent reusable additions cannot replace each other', async () => {
  const f = fixture();
  await f.call('listSalaryTemplates');
  const id = f.reads[0].split('/')[1];
  f.state.beforeCommit = () => f.row('hrSalaryTemplates', id, { Allowances: ['Housing'], Deductions: [] });
  await f.call('addSalaryTemplate', { Kind: 'Allowances', Name: 'Transport' });
  assert.deepEqual((await f.call('listSalaryTemplates')).templates.Allowances, ['Housing', 'Transport']);
  assert.equal(f.writes.length, 1);
});

test('rename and delete update only reusable names and reject stale or duplicate changes', async () => {
  const f = fixture();
  const recordsBefore = clone([...f.records]);
  await f.call('listSalaryTemplates');
  const id = f.reads[0].split('/')[1];
  // Existing catalogs from before the edit controls have no Revision field.
  f.row('hrSalaryTemplates', id, { Allowances: ['Housing allowance', 'Meals'], Deductions: ['Staff association'] });
  const { templateVersion } = await f.call('listSalaryTemplates');
  const rename = { Kind: 'Allowances', ExistingName: 'Housing allowance', TemplateVersion: templateVersion };
  await assert.rejects(f.call('editSalaryTemplate', { ...rename, Name: 'MEALS' }), { status: 409 });
  assert.equal(f.writes.length, 0);
  const renamed = await f.call('editSalaryTemplate', { ...rename, Name: 'Housing support' });
  assert.deepEqual(renamed.templates.Allowances, ['Housing support', 'Meals']);
  const remove = { Kind: 'Deductions', ExistingName: 'Staff association', TemplateVersion: renamed.templateVersion };
  await assert.rejects(f.call('deleteSalaryTemplate', { ...remove, TemplateVersion: templateVersion }), { status: 409 });
  await assert.rejects(f.call('deleteSalaryTemplate', { ...remove, BranchId: 'elsewhere' }), { status: 403 });
  await assert.rejects(f.call('deleteSalaryTemplate', remove, { ...f.user, subscriptionReadOnly: true }), { status: 403 });
  const deleted = await f.call('deleteSalaryTemplate', remove);
  assert.deepEqual(deleted.templates, { Allowances: ['Housing support', 'Meals'], Deductions: [] });
  await f.call('addSalaryTemplate', { Kind: 'Deductions', Name: 'Staff association' });
  await assert.rejects(f.call('deleteSalaryTemplate', remove), { status: 409 });
  assert.deepEqual((await f.call('listSalaryTemplates')).templates.Deductions, ['Staff association']);
  assert.deepEqual([...f.records].filter(([key]) => !key.startsWith('hrSalaryTemplates/')), recordsBefore);
  assert.equal(f.writes.length, 3);
  assert.ok(f.writes.flat().every(write => write.collectionPath === 'hrSalaryTemplates'));
  assert.ok(f.reads.every(read => read.startsWith('hrSalaryTemplates/')));
});

test('salary and letter access is limited to permitted HR roles', async () => {
  for (const role of ['Teacher', 'HR Assistant', 'Line Manager', 'Recruitment Officer']) {
    const f = fixture({ role });
    await assert.rejects(f.call('getSalaryStructure'), error => error.status === 403);
    assert.equal(f.reads.length, 0); assert.equal(f.queries.length, 0);
  }
  const f = fixture({ role: 'Payroll Officer' });
  assert.ok((await f.call('getSalaryStructure')).profile);
  await assert.rejects(f.call('saveSalaryStructure', { BasicSalary: 10, PayrollVersion: '' }), error => error.status === 403);
  await assert.rejects(f.draft(), error => error.status === 403);
  assert.equal(hrCapabilitiesFor({ role: 'HR Manager' }).canIssueEmploymentLetters, true);
});

test('selected employee load is bounded, read-only and omits bank/tax/private details', async () => {
  const f = fixture(); const result = await f.call('getSalaryStructure');
  assert.equal(result.salary.GrossPay, 125000); assert.equal(result.profile.EmployeeId, 'EMP-101');
  assert.equal(result.profile.Currency, 'NGN'); assert.equal(result.profile.PayFrequency, 'Monthly');
  assert.equal(result.profile.BankName, undefined); assert.equal(result.profile.AccountNumber, undefined); assert.equal(result.profile.TIN, undefined); assert.equal(result.profile.Notes, undefined);
  assert.equal(f.writes.length, 0); assert.equal(f.sendCount(), 0);
  assert.equal(f.storageCalls.length, 0);
  assert.deepEqual(f.queries.map(row => row.collection), ['payrollProfiles', 'hrEmploymentLetters']);
  assert.equal(f.queries[1].options.select.includes('PdfBase64'), false);
  assert.ok(!f.reads.some(path => /payrollRuns|payrollItems|payrollPayments/.test(path)));
});

test('legacy salary component strings are normalized for the editor without write-through', async () => {
  const f = fixture(), stored = f.records.get('payrollProfiles/existing-profile-id');
  stored.BasicSalary = '100000'; stored.Allowances = 'Housing allowance=25000';
  stored.Deductions = '[{"Name":"Staff association","Amount":1000}]';
  const before = clone(stored), result = await f.call('getSalaryStructure');
  assert.deepEqual(result.profile.Allowances, [{ Name: 'Housing allowance', Amount: 25000 }]);
  assert.deepEqual(result.profile.Deductions, [{ Name: 'Staff association', Amount: 1000 }]);
  await f.call('saveSalaryStructure', { ...result.profile, PayrollVersion: result.PayrollVersion });
  assert.equal(f.writes.length, 0); assert.deepEqual(f.records.get('payrollProfiles/existing-profile-id'), before);
});

test('salary changes preserve existing IDs, bank/tax settings and past payroll; retries do not add writes', async () => {
  const f = fixture(); const initial = await f.call('getSalaryStructure');
  const beforePast = [...f.records.entries()].filter(([key]) => /^payroll(?:Runs|Items|Payments)\//.test(key));
  const body = { PayrollVersion: initial.PayrollVersion, BasicSalary: 120000, Allowances: [{ Name: 'Housing allowance', Amount: 30000 }], Deductions: [{ Name: 'Staff association', Amount: 1000 }], Currency: 'NGN', PayFrequency: 'Monthly' };
  const saved = await f.call('saveSalaryStructure', body);
  assert.equal(saved.salary.GrossPay, 150000); assert.notEqual(saved.PayrollVersion, initial.PayrollVersion);
  const profile = f.records.get('payrollProfiles/existing-profile-id');
  for (const [key, value] of Object.entries({ BankName: 'Keep bank', AccountNumber: 'KEEP-ACCOUNT', TaxRate: 5, PensionRate: 8, TIN: 'KEEP-TIN', CreatedAt: '2020-01-01' })) assert.equal(profile[key], value);
  assert.deepEqual([...f.records.entries()].filter(([key]) => /^payroll(?:Runs|Items|Payments)\//.test(key)), beforePast);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('hrSalaryRevisions/')).length, 1);
  const writes = f.writes.length; await f.call('saveSalaryStructure', body); assert.equal(f.writes.length, writes);
  await assert.rejects(f.call('saveSalaryStructure', { ...body, BasicSalary: 121000 }), /changed/);
  assert.equal(f.writes.length, writes);
});

test('first salary save uses one stable profile and simultaneous saves cannot duplicate it', async () => {
  const f = fixture({ profile: false });
  const body = { PayrollVersion: '', BasicSalary: 80000, Allowances: [], Deductions: [] };
  const results = await Promise.allSettled([f.call('saveSalaryStructure', body), f.call('saveSalaryStructure', body)]);
  assert.ok(results.some(row => row.status === 'fulfilled'));
  assert.equal([...f.records.keys()].filter(key => key.startsWith('payrollProfiles/')).length, 1);
  assert.equal([...f.records.keys()].filter(key => key.startsWith('hrSalaryRevisions/')).length, 1);
});

test('branch, edition, forged employee IDs and inactive employee writes are rejected', async () => {
  const f = fixture();
  await assert.rejects(f.call('getSalaryStructure', {}, { ...f.user, branchId: 'other' }), error => error.status === 404);
  await assert.rejects(f.call('getSalaryStructure', { BranchId: 'other' }), error => error.status === 403);
  await assert.rejects(f.call('saveSalaryStructure', { BranchId: 'other', PayrollVersion: '', BasicSalary: 1 }, { ...f.user, role: 'Super Admin', branchId: '' }), error => error.status === 403);
  await assert.rejects(f.call('getSalaryStructure', { EmployeeId: 'FORGED' }), /identity changed/);
  await assert.rejects(f.call('getSalaryStructure', {}, { ...f.user, edition: 'faith' }), error => error.status === 403);
  f.records.get('staffUsers/stable-staff-id').Active = false;
  await assert.rejects(f.draft(), /inactive/);
  const initial = await f.call('getSalaryStructure');
  await assert.rejects(f.call('saveSalaryStructure', { PayrollVersion: initial.PayrollVersion, BasicSalary: 1 }), /inactive/);
  assert.equal(f.writes.length, 0);
});

test('concurrent staff branch or HR employment changes abort all salary writes', async () => {
  for (const path of ['staffUsers/stable-staff-id', 'hrEmployees/employee']) {
    const f = fixture(); const initial = await f.call('getSalaryStructure');
    f.state.beforeCommit = () => { f.records.get(path).__updateTime = 'changed-concurrently'; f.records.get(path).BranchId = 'other'; };
    await assert.rejects(f.call('saveSalaryStructure', { PayrollVersion: initial.PayrollVersion, BasicSalary: 150000 }), /Version conflict/);
    assert.equal(f.writes.length, 0); assert.equal(f.records.get('payrollProfiles/existing-profile-id').BasicSalary, 100000);
  }
});

test('advanced salary letters use actual assigned components without overwriting advanced payroll', async () => {
  const f = fixture({ advanced: true }); const initial = await f.call('getSalaryStructure');
  assert.equal(initial.salaryEditable, false); assert.equal(initial.salary.GrossPay, 250000);
  await assert.rejects(f.call('saveSalaryStructure', { BasicSalary: 1, PayrollVersion: initial.PayrollVersion }), /advanced payroll components/);
  const letter = await f.draft(); assert.equal(letter.Salary.GrossPay, 250000);
  assert.equal(f.records.get('payrollProfiles/existing-profile-id').BasicSalary, 100000);
});

for (const edition of ['school', 'faith', 'organization']) test(`${edition}: preview does not save or send, saved draft is immutable and duplicate sends are prevented`, async () => {
  const f = fixture({ edition });
  const preview = await f.call('previewEmploymentLetter', { ...terms, SignatureDataUrl: 'forged', RecipientEmail: 'attacker@example.org' });
  assert.equal(preview.letter.LetterId, ''); assert.equal(preview.letter.RecipientEmail, 'employee@example.org');
  assert.equal(f.writes.length, 0); assert.equal(f.sendCount(), 0);
  const letter = await f.draft(); const count = f.writes.length;
  assert.equal((await f.draft()).LetterId, letter.LetterId); assert.equal(f.writes.length, count);
  const sent = await f.send(letter); assert.equal(sent.letter.Status, 'Sent');
  await f.send(letter); assert.equal(f.sendCount(), 1);
  assert.equal(f.sent[0].requireAttachments, true); assert.equal(f.sent[0].attachments[0].content, letter.PdfBase64);
  assert.equal(f.sent[0].branchId, 'north');
  const saved = f.records.get(`hrEmploymentLetters/${letter.LetterId}`);
  assert.equal(saved.PdfBase64, undefined); assert.ok(saved.PdfDocumentReference.startsWith(`r2://dynamax-documents/v1/${edition}/test-workspace/human-resources/north/all/`));
  assert.match(saved.PdfSha256, /^[a-f0-9]{64}$/); assert.equal(f.objects.size, 1);
  assert.equal(f.storageCalls.filter(([operation]) => operation === 'put').length, 1);
});

test('preview stays read-only; private R2 is required only when saving a draft', async () => {
  const f = fixture(); delete f.env.DYNAMAX_DOCUMENTS;
  const preview = await f.call('previewEmploymentLetter', terms);
  assert.ok(preview.letter.PdfBase64); assert.equal(f.writes.length, 0);
  await assert.rejects(f.draft(), /R2 document storage is not connected/);
  assert.equal(f.writes.length, 0); assert.equal(f.sendCount(), 0);
});

test('private PDF ownership, existence and content integrity are checked before reading or sending', async () => {
  for (const change of ['missing', 'hash', 'owner', 'branch']) {
    const f = fixture(), letter = await f.draft(), saved = f.records.get(`hrEmploymentLetters/${letter.LetterId}`), object = f.objects.get(saved.PdfObjectKey);
    if (change === 'missing') f.objects.clear();
    if (change === 'hash') object.bytes[10] ^= 1;
    if (change === 'owner') object.customMetadata.ownerId = 'other-employee';
    if (change === 'branch') object.customMetadata.branchId = 'other-branch';
    await assert.rejects(f.send(letter), /not found|does not match|integrity check/);
    assert.equal(f.sendCount(), 0); assert.equal(saved.Status, 'Draft');
  }
});

test('concurrent immutable draft creation cleans only the confirmed losing object', async () => {
  const f = fixture(); f.state.uniquePdfs = true;
  const drafts = await Promise.all([f.draft(), f.draft()]);
  assert.equal(drafts[0].LetterId, drafts[1].LetterId); assert.equal(drafts[0].PdfBase64, drafts[1].PdfBase64);
  assert.equal(f.objects.size, 1); assert.equal(f.storageCalls.filter(([operation]) => operation === 'delete').length, 1);
  const saved = f.records.get(`hrEmploymentLetters/${drafts[0].LetterId}`);
  assert.ok(f.objects.has(saved.PdfObjectKey));
  const uncertain = fixture(); uncertain.state.failDraftCreate = true;
  await assert.rejects(uncertain.draft(), /persistence outcome unknown/);
  assert.equal(uncertain.objects.size, 1); assert.equal(uncertain.storageCalls.filter(([operation]) => operation === 'delete').length, 0);
});

test('a stable staff document retains letter history after username changes', async () => {
  const f = fixture(), letter = await f.draft();
  f.records.get('staffUsers/stable-staff-id').Username = 'renamed';
  f.records.get('staffUsers/stable-staff-id').LoginUsername = 'employee';
  f.records.get('payrollProfiles/existing-profile-id').Username = 'renamed';
  const result = await f.call('getSalaryStructure', { Username: 'renamed' });
  assert.equal(result.letters[0].LetterId, letter.LetterId);
  assert.equal((await f.call('loadEmploymentLetter', { Username: 'renamed', LetterId: letter.LetterId })).letter.PdfBase64, letter.PdfBase64);
});

test('changed employee or salary data prevents sending an obsolete draft', async () => {
  for (const mutate of [f => { f.records.get('payrollProfiles/existing-profile-id').BasicSalary += 1000; },
    f => { f.records.get('hrEmployees/employee').WorkEmail = 'changed@example.org'; }]) {
    const f = fixture(), letter = await f.draft(); mutate(f);
    await assert.rejects(f.send(letter), /changed after this draft/); assert.equal(f.sendCount(), 0);
  }
  const f = fixture(), letter = await f.draft();
  await assert.rejects(f.send({ ...letter, LetterVersion: 'stale' }), /letter changed/);
  await assert.rejects(f.call('sendEmploymentLetter', { LetterId: letter.LetterId }), /confirm/);
  assert.equal(f.sendCount(), 0);
});

test('simultaneous delivery claims result in one provider call', async () => {
  const f = fixture(), letter = await f.draft();
  await Promise.allSettled([f.send(letter), f.send(letter)]);
  assert.equal(f.sendCount(), 1);
});

test('employee and salary changes racing the send claim prevent provider delivery atomically', async () => {
  for (const [path, field, value] of [
    ['staffUsers/stable-staff-id', 'BranchId', 'other'],
    ['staffUsers/stable-staff-id', 'Active', false],
    ['hrEmployees/employee', 'WorkEmail', 'new@example.org'],
    ['payrollProfiles/existing-profile-id', 'BasicSalary', 300000],
    ['payrollSalaryComponents/HOUSING', 'Active', 'NO']
  ]) {
    const f = fixture({ advanced: path.startsWith('payrollSalaryComponents/') }), letter = await f.draft(), count = f.writes.length;
    f.state.beforeCommit = () => { f.records.get(path).__updateTime = 'raced-version'; f.records.get(path)[field] = value; };
    await assert.rejects(f.send(letter), /Version conflict/);
    assert.equal(f.sendCount(), 0); assert.equal(f.writes.length, count);
    assert.equal(f.records.get(`hrEmploymentLetters/${letter.LetterId}`).Status, 'Draft');
  }
});

test('known unavailable provider is retryable, network uncertainty and failed accepted-status persistence are not resent', async () => {
  const unavailable = fixture(), letter = await unavailable.draft();
  unavailable.state.deliveryError = Object.assign(new Error('Email provider is not configured'), { retrySafe: true, code: 'EMAIL_SENDER_UNAVAILABLE', status: 503 });
  await assert.rejects(unavailable.send(letter), /not configured/);
  const failed = (await unavailable.call('loadEmploymentLetter', { LetterId: letter.LetterId })).letter;
  assert.equal(failed.Status, 'Failed'); unavailable.state.deliveryError = null;
  assert.equal((await unavailable.send(failed)).letter.Status, 'Sent');
  for (const kind of ['uncertain', 'accepted-record-failed']) {
    const f = fixture(), draft = await f.draft();
    if (kind === 'uncertain') f.state.deliveryError = new Error('Network timeout'); else f.state.failSentCommit = true;
    await assert.rejects(f.send(draft), /provider log/);
    await assert.rejects(f.send(draft), /uncertain/); assert.equal(f.sendCount(), 1);
  }
});

test('validation does not invent terms and protects read-only subscriptions', async () => {
  const empty = normalizeEmploymentLetterTerms({ LetterDate: '2026-11-10' }, { Position: 'Teacher', Department: 'Academic', EmploymentType: 'Permanent', HireDate: '2026-11-11' });
  for (const field of ['Probation', 'NoticePeriod', 'WorkingHours', 'Benefits', 'Terms']) assert.equal(empty[field], '');
  assert.throws(() => normalizeEmploymentLetterTerms({ ...terms, StartDate: '2026-02-30' }, {}), /valid employment start date/);
  const f = fixture();
  await assert.rejects(f.call('saveEmploymentLetter', terms, { ...f.user, subscriptionReadOnly: true }), error => error.status === 403);
  assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
});
