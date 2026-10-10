import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import { recordManualPayment, enforceDesktopDeviceActionScope } from '../functions/api/backend.js';
import { objectToFirestoreFields, firestoreDocumentToObject } from '../functions/lib/firestore.js';

// Exercise the real backend and Firestore REST serialization. Every request is
// intercepted: the fixture cannot contact a tenant database or payment gateway.
const privateKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
}).privateKey;
if (!globalThis.crypto) globalThis.crypto = webcrypto;
let fixtureSequence = 0;

function fixture(t, branch = 'main', section = 'secondary') {
  const env = {
    FIREBASE_PROJECT_ID: `manual-payment-scope-${++fixtureSequence}`,
    FIREBASE_CLIENT_EMAIL: 'isolated@example.test', FIREBASE_PRIVATE_KEY: privateKey,
    ORGANISATION_EDITION: 'school', DYNAMAX_WORKSPACE_ID: 'isolated-school'
  };
  const base = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const documents = new Map();
  const mutations = [];
  let revision = 0;
  let createRace = null;
  let readFailure = null;
  let writeRace = null;
  const injectedRaces = [];
  const json = (status, value) => Response.json(value, { status });
  const missing = () => json(404, { error: { status: 'NOT_FOUND', message: 'No such test document' } });
  const conflict = () => json(409, { error: { status: 'ALREADY_EXISTS', message: 'Test document already exists' } });
  const save = (name, fields) => {
    const row = { name, fields: structuredClone(fields), updateTime: `2026-10-09T10:00:00.${String(++revision).padStart(6, '0')}Z` };
    documents.set(name, row);
    return row;
  };
  const put = (collection, id, row) => save(`${base}/${collection}/${id}`, objectToFirestoreFields(row));
  const get = (collection, id) => {
    const row = documents.get(`${base}/${collection}/${id}`);
    return row ? firestoreDocumentToObject(row) : null;
  };
  const rows = collection => [...documents.values()]
    .filter(row => row.name.slice(0, row.name.lastIndexOf('/')) === `${base}/${collection}`)
    .map(firestoreDocumentToObject);
  const value = encoded => firestoreDocumentToObject({ fields: { value: encoded } }).value;
  const matches = (row, where) => {
    if (!where) return true;
    if (where.compositeFilter) {
      const checks = where.compositeFilter.filters.map(filter => matches(row, filter));
      return where.compositeFilter.op === 'OR' ? checks.some(Boolean) : checks.every(Boolean);
    }
    const filter = where.fieldFilter;
    if (!filter) throw new Error('Unexpected test query filter');
    const actual = filter.field.fieldPath === '__name__' ? row.name : value(row.fields[filter.field.fieldPath]);
    const expected = value(filter.value);
    if (filter.op === 'EQUAL') return actual === expected;
    if (filter.op === 'IN') return expected.includes(actual);
    if (filter.op === 'GREATER_THAN') return actual > expected;
    if (filter.op === 'GREATER_THAN_OR_EQUAL') return actual >= expected;
    if (filter.op === 'LESS_THAN') return actual < expected;
    if (filter.op === 'LESS_THAN_OR_EQUAL') return actual <= expected;
    throw new Error(`Unexpected test query operator ${filter.op}`);
  };
  const preconditionMet = (name, precondition) => !precondition || (
    precondition.updateTime ? documents.get(name)?.updateTime === precondition.updateTime
      : precondition.exists === undefined || documents.has(name) === precondition.exists
  );
  const injectWriteRace = (name, method) => {
    if (!writeRace || name !== `${base}/${writeRace.collection}/${writeRace.id}` ||
      (writeRace.method && writeRace.method !== method)) return;
    const race = writeRace;
    writeRace = null;
    put(race.collection, race.id, race.row);
    injectedRaces.push({ name, method });
  };
  const requestCondition = parsed => parsed.searchParams.has('currentDocument.updateTime')
    ? { updateTime: parsed.searchParams.get('currentDocument.updateTime') }
    : parsed.searchParams.has('currentDocument.exists') ? { exists: parsed.searchParams.get('currentDocument.exists') === 'true' } : null;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'oauth2.googleapis.com') {
      assert.equal(parsed.pathname, '/token');
      return json(200, { access_token: 'isolated-test-token', expires_in: 3600 });
    }
    assert.equal(parsed.hostname, 'firestore.googleapis.com', 'All non-test network calls are forbidden');
    const name = decodeURIComponent(parsed.pathname.replace(/^\/v1\//, ''));
    assert.ok(name.startsWith(base), 'A test may access only its fixture project');
    const method = options.method || 'GET';
    if (readFailure?.({ name: name.slice(base.length + 1), method, options })) {
      return json(503, { error: { status: 'UNAVAILABLE', message: 'Injected database read failure' } });
    }
    if (name.endsWith(':runQuery')) {
      const { structuredQuery: query } = JSON.parse(options.body);
      const collection = `${name.slice(0, -':runQuery'.length).replace(/\/$/, '')}/${query.from[0].collectionId}`;
      let result = [...documents.values()].filter(row => row.name.slice(0, row.name.lastIndexOf('/')) === collection && matches(row, query.where));
      result.sort((left, right) => left.name.localeCompare(right.name));
      if (query.startAt?.values?.[0]?.referenceValue) {
        const cursor = query.startAt.values[0].referenceValue;
        result = result.filter(row => query.startAt.before ? row.name >= cursor : row.name > cursor);
      }
      return json(200, result.slice(0, query.limit || result.length).map(document => ({ document })));
    }
    if (name.endsWith(':commit')) {
      const { writes } = JSON.parse(options.body);
      for (const write of writes) injectWriteRace(write.update?.name || write.delete, 'COMMIT');
      for (const write of writes) {
        if (!preconditionMet(write.update?.name || write.delete, write.currentDocument)) return conflict();
      }
      mutations.push(...structuredClone(writes));
      return json(200, { writeResults: writes.map(write => {
        if (write.delete) { documents.delete(write.delete); return {}; }
        const fields = write.updateMask
          ? { ...documents.get(write.update.name)?.fields, ...write.update.fields } : write.update.fields;
        return { updateTime: save(write.update.name, fields).updateTime };
      }) });
    }
    if (method === 'POST' && parsed.searchParams.has('documentId')) {
      const target = `${name}/${parsed.searchParams.get('documentId')}`;
      if (name === `${base}/payments` && createRace) {
        put('payments', parsed.searchParams.get('documentId'), createRace);
        createRace = null;
      }
      if (documents.has(target)) return conflict();
      const fields = JSON.parse(options.body).fields;
      mutations.push({ create: target, fields: structuredClone(fields) });
      return json(200, save(target, fields));
    }
    if (method === 'PATCH') {
      injectWriteRace(name, method);
      const condition = requestCondition(parsed);
      if (!preconditionMet(name, condition)) return conflict();
      const fields = JSON.parse(options.body).fields;
      mutations.push({ patch: name, fields: structuredClone(fields) });
      return json(200, save(name, parsed.searchParams.has('updateMask.fieldPaths')
        ? { ...documents.get(name)?.fields, ...fields } : fields));
    }
    if (method === 'DELETE') {
      injectWriteRace(name, method);
      if (!preconditionMet(name, requestCondition(parsed))) return conflict();
      mutations.push({ delete: name });
      documents.delete(name);
      return json(200, {});
    }
    assert.equal(method, 'GET');
    if (documents.has(name)) return json(200, documents.get(name));
    const relative = name.slice(base.length + 1);
    if (relative.split('/').length % 2 === 1) {
      return json(200, { documents: [...documents.values()].filter(row => row.name.slice(0, row.name.lastIndexOf('/')) === name) });
    }
    return missing();
  };
  const schoolPath = (collection, selectedBranch = branch, selectedSection = section) =>
    `schoolBranches/${selectedBranch}/sections/${selectedSection}/${collection}`;
  const student = (id = 'STU-001', selectedBranch = branch, selectedSection = section, extra = {}) => put(
    schoolPath('students', selectedBranch, selectedSection), id, {
      AdmissionNo: id, DisplayName: 'Test Student', BranchId: selectedBranch, SchoolSection: selectedSection,
      ClassName: selectedSection === 'primary' ? 'Primary 4' : 'Grade 8',
      BillingCategory: 'Regular', StudentType: 'Day Student', AcademicSession: '2026/2027', Term: 'First Term', ...extra
    }
  );
  const body = overrides => ({
    AccountRef: 'STU-001', FeeCode: 'WALLET_TOPUP', Amount: 1250,
    Reference: 'MANUAL-001', Method: 'Bank Transfer', PaidAt: '2026-10-09T10:00:00.000Z',
    BranchId: branch, UserBranchId: branch, DeviceBranchId: branch,
    UserSchoolSectionAccess: section, SchoolSection: section,
    UserRole: 'Accounts Officer', UserUsername: 'accounts@example.test', RecordedBy: 'Test Accounts Officer',
    DeferNotifications: true, ...overrides
  });
  put('settings', 'schoolStructure', { Branches: [{ Id: 'main' }, { Id: 'north' }], Sections: ['primary', 'secondary'], ActiveBranchId: 'main' });
  put('settings', 'schoolProfile', { CurrentAcademicSession: '2026/2027', CurrentTerm: 'First Term' });
  put('feeItems', 'WALLET_TOPUP', { FeeCode: 'WALLET_TOPUP', FeeName: 'Student Wallet Top-up', FeeCategory: 'Wallet', Amount: 0, Active: 'YES' });
  put('feeItems', 'ACC', { FeeCode: 'ACC', FeeName: 'Admission acceptance fee', FeeCategory: 'Acceptance Fee', Amount: 1250, Active: 'YES' });
  const payment = overrides => ({
    PaymentId: 'PAY-001', Reference: 'MANUAL-001', AccountRef: 'STU-001', AdmissionNo: 'STU-001',
    BranchId: branch, SchoolSection: section, FeeCode: 'WALLET_TOPUP', FeeName: 'Student Wallet Top-up', FeeCategory: 'Wallet',
    Amount: 1250, GrossAmount: 1250, NetAmount: 1250, GatewayFee: 0,
    AcademicSession: '2026/2027', Term: 'First Term', Method: 'Bank Transfer', Gateway: 'Manual',
    PaidAt: '2026-10-09T10:00:00.000Z', Status: 'Paid', ...overrides
  });
  return { env, documents, mutations, put, get, rows, student, body, payment, schoolPath, injectedRaces,
    race: row => { createRace = row; }, failRead: predicate => { readFailure = predicate; },
    raceWrite: (collection, id, row, method = '') => { writeRace = { collection, id, row, method }; },
    record: overrides => recordManualPayment(env, body(overrides)) };
}

const denied = error => [403, 404, 409].includes(error.status);

for (const branch of ['main', 'north']) {
  test(`${branch}: branch-approved laptop may post a wallet top-up only to its authorised account`, async t => {
    const f = fixture(t, branch);
    f.student();
    assert.doesNotThrow(() => enforceDesktopDeviceActionScope({ type: 'device', branchId: branch }, 'recordManualPayment', f.body()));
    const result = await f.record();
    assert.equal(result.ok, true);
    assert.equal(result.payment.BranchId, branch);
    assert.equal(result.payment.SchoolSection, 'secondary');
    assert.equal(f.rows('payments').length, 1);
    assert.equal(f.rows('ledger').length, 1);
    assert.equal(f.rows('ledger')[0].Credit, 1250);
    assert.equal(f.rows('accountingJournals').length, 1);
    assert.equal(f.rows('accountingJournals')[0].BranchId, branch);
    assert.equal(f.rows('accountingJournals')[0].TotalDebit, 1250);
    assert.equal(f.rows('accountingJournals')[0].TotalCredit, 1250);
    assert.ok(f.rows('accountSummaries').some(row => row.WalletBalance === 1250), JSON.stringify(f.rows('accountSummaries')));
  });

  test(`${branch}: applicant acceptance payment updates only the scoped applicant`, async t => {
    const f = fixture(t, branch);
    const applicant = { ApplicationReference: 'APP-001', DisplayName: 'Test Applicant', BranchId: branch,
      SchoolSection: 'secondary', ClassApplyingFor: 'Grade 8', AcademicSession: '2026/2027', Term: 'First Term' };
    f.put(f.schoolPath('applications'), 'APP-001', applicant);
    const result = await f.record({ AccountRef: 'APP-001', ApplicationReference: 'APP-001', AdmissionNo: '', FeeCode: 'ACC' });
    assert.equal(result.ok, true);
    assert.equal(result.payment.AccountRef, 'APP-001');
    assert.equal(result.payment.BranchId, branch);
    assert.equal(f.get(f.schoolPath('applications'), 'APP-001').AcceptanceFeePaid, 'YES');
    assert.equal(f.rows('ledger').length, 1);
    assert.equal(f.rows('ledger')[0].Credit, 1250);
  });
}

test('missing student/applicant is rejected before financial writes', async t => {
  const f = fixture(t);
  await assert.rejects(f.record(), denied);
  assert.equal(f.mutations.length, 0);
});

test('a foreign branch student cannot be targeted through its account reference', async t => {
  const f = fixture(t);
  f.student('STU-001', 'north');
  await assert.rejects(f.record(), denied);
  assert.equal(f.mutations.length, 0);
});

test('an authoritative primary-only user cannot widen access with a posted secondary section', async t => {
  const f = fixture(t, 'main', 'primary');
  f.student('STU-001', 'main', 'secondary');
  await assert.rejects(f.record({ SchoolSection: 'secondary' }), denied);
  assert.equal(f.mutations.length, 0);
});

test('a forged application link is rejected without touching the foreign applicant', async t => {
  const f = fixture(t);
  f.student();
  f.put(f.schoolPath('applications', 'north'), 'APP-FOREIGN', {
    ApplicationReference: 'APP-FOREIGN', BranchId: 'north', SchoolSection: 'secondary', ClassApplyingFor: 'Grade 8'
  });
  await assert.rejects(f.record({ ApplicationReference: 'APP-FOREIGN', FeeCode: 'ACC' }), denied);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.get(f.schoolPath('applications', 'north'), 'APP-FOREIGN').AcceptanceFeePaid, undefined);
});

for (const role of ['Front Desk', 'Department User', 'Vendor User']) {
  test(`a branch-approved device does not give ${role} permission to post manual payments`, async t => {
    const f = fixture(t);
    f.student();
    await assert.rejects(f.record({ UserRole: role }), error => error.status === 403);
    assert.equal(f.mutations.length, 0);
  });
}

for (const [label, override] of [
  ['foreign branch', { BranchId: 'north' }],
  ['foreign account', { AccountRef: 'STU-OTHER', AdmissionNo: 'STU-OTHER' }],
  ['foreign section', { SchoolSection: 'primary' }],
  ['different fee', { FeeCode: 'ACC', FeeCategory: 'Acceptance Fee' }],
  ['different amount', { Amount: 500, GrossAmount: 500, NetAmount: 500 }]
]) {
  test(`existing duplicate reference for ${label} is rejected before processing updates`, async t => {
    const f = fixture(t);
    f.student();
    f.put('payments', 'MANUAL-001', f.payment(override));
    const before = structuredClone(f.get('payments', 'MANUAL-001'));
    await assert.rejects(f.record(), denied);
    assert.equal(f.mutations.length, 0);
    assert.deepEqual(f.get('payments', 'MANUAL-001'), before);
  });
}

for (const [label, override] of [
  ['foreign branch', { BranchId: 'north' }],
  ['foreign account', { AccountRef: 'STU-OTHER', AdmissionNo: 'STU-OTHER' }]
]) {
  test(`create race winner belonging to ${label} is rejected without dependent writes`, async t => {
    const f = fixture(t);
    f.student();
    f.race(f.payment(override));
    await assert.rejects(f.record(), denied);
    assert.equal(f.mutations.length, 0);
    assert.equal(f.rows('ledger').length, 0);
    assert.equal(f.rows('accountingJournals').length, 0);
  });
}

test('retrying the same valid payment does not duplicate wallet credit or its journal', async t => {
  const f = fixture(t, 'north');
  f.student();
  const first = await f.record();
  const second = await f.record();
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(f.rows('payments').length, 1);
  assert.equal(f.rows('ledger').length, 1);
  assert.equal(f.rows('ledger')[0].Credit, 1250);
  assert.equal(f.rows('accountingJournals').length, 1);
  assert.ok(f.rows('accountSummaries').some(row => row.WalletBalance === 1250), JSON.stringify(f.rows('accountSummaries')));
});

for (const collection of ['invoices', 'ledger', 'payments']) {
  test(`a conflicting ${collection} row for the same account reference fails closed`, async t => {
    const f = fixture(t);
    f.student();
    f.put(collection, 'FOREIGN-ROW', {
      InvoiceId: 'FOREIGN-ROW', LedgerNo: 'FOREIGN-ROW', PaymentId: 'FOREIGN-ROW',
      Reference: 'FOREIGN-REF', AccountRef: 'STU-001', AdmissionNo: 'STU-001', BranchId: 'north',
      SchoolSection: 'secondary', FeeCode: 'ACC', FeeCategory: 'Acceptance Fee', Amount: 100, Debit: 100,
      Credit: 0, Status: 'Unpaid', AcademicSession: '2026/2027', Term: 'First Term'
    });
    const before = structuredClone(f.get(collection, 'FOREIGN-ROW'));
    await assert.rejects(f.record(), denied);
    assert.deepEqual(f.get(collection, 'FOREIGN-ROW'), before);
    assert.equal(f.rows('payments').filter(row => row.Reference === 'MANUAL-001').length, 0);
  });
}

for (const [collection, id] of [['ledger', 'LED-MANUAL-001'], ['accountingJournals', 'SYS-PAY-MANUAL-001']]) {
  test(`a foreign ${collection} document at the derived posting ID is never overwritten`, async t => {
    const f = fixture(t);
    f.student();
    f.put(collection, id, { AccountRef: 'STU-OTHER', BranchId: 'north', SchoolSection: 'secondary',
      Reference: 'MANUAL-001', JournalNo: id, LedgerNo: id, Status: 'Posted', Credit: 99,
      Lines: [{ AccountCode: '1000', Debit: 99, Credit: 0 }, { AccountCode: '2300', Debit: 0, Credit: 99 }] });
    const before = structuredClone(f.get(collection, id));
    await assert.rejects(f.record(), denied);
    assert.deepEqual(f.get(collection, id), before);
    assert.equal(f.mutations.length, 0);
  });
}

test('an existing summary owned by another branch cannot be overwritten by a matching account reference', async t => {
  const f = fixture(t);
  f.student();
  f.put('accountSummaries', 'STU-001', {
    AccountRef: 'STU-001', BranchId: 'north', SchoolSection: 'secondary', WalletBalance: 9900, OutstandingBalance: 450
  });
  const before = structuredClone(f.get('accountSummaries', 'STU-001'));
  await assert.rejects(f.record(), denied);
  assert.deepEqual(f.get('accountSummaries', 'STU-001'), before);
  assert.equal(f.mutations.length, 0);
});

function schoolFee(f, amount = 2500) {
  f.put('feeItems', 'TUI', {
    FeeCode: 'TUI', FeeName: 'Tuition', FeeCategory: 'School Fee', Amount: amount,
    ClassName: 'All', StudentType: 'All', Gender: 'All', BillingCategory: 'All', EnrollmentCategory: 'All',
    AcademicProgress: 'All', AcademicSession: '2026/2027', Term: 'First Term',
    Currency: 'NGN', PayableOnline: 'YES', Active: 'YES', DueDate: '2026-10-01'
  });
}

function schoolInvoice(branch = 'main', overrides = {}) {
  return {
    InvoiceId: 'INV-001', AccountRef: 'STU-001', AccountRefNormalized: 'stu001', AdmissionNo: 'STU-001',
    BranchId: branch, SchoolSection: 'secondary', DisplayName: 'Test Student', ClassName: 'Grade 8',
    FeeCode: 'TUI', FeeName: 'Tuition', FeeCategory: 'School Fee', Amount: 2500, Debit: 2500, Credit: 0, Balance: 2500,
    AcademicSession: '2026/2027', Term: 'First Term', Status: 'Unpaid',
    Date: '2026-10-01T10:00:00.000Z', CreatedAt: '2026-10-01T10:00:00.000Z', DueDate: '2026-10-01', ...overrides
  };
}

for (const branch of ['main', 'north']) {
  for (const existingInvoice of [true, false]) {
    test(`${branch}: school-fee total ${existingInvoice ? 'settles an existing' : 'creates and settles a new'} invoice and retry is idempotent`, async t => {
      const f = fixture(t, branch);
      f.student();
      schoolFee(f);
      if (existingInvoice) f.put('invoices', 'INV-001', schoolInvoice(branch));
      const body = { FeeCode: 'SCHOOL_FEES_TOTAL', FeeName: 'School fees total', FeeCategory: 'School Fee' };
      const first = await f.record(body);
      assert.equal(first.ok, true);
      assert.equal(first.invoicePostingWarning, '', 'Invoice generation and downstream credit reconciliation must complete');
      const invoice = f.rows('invoices').find(row => row.FeeCode === 'TUI');
      assert.ok(invoice);
      assert.equal(invoice.BranchId, branch);
      assert.equal(invoice.SchoolSection, 'secondary');
      assert.equal(invoice.Debit, 2500);
      assert.equal(invoice.Credit, 1250);
      assert.equal(invoice.Balance, 1250);
      assert.equal(invoice.Status, 'Part Paid');
      const firstJournals = f.rows('accountingJournals');
      const receipt = firstJournals.find(row => row.Source === 'Fee Payment');
      assert.ok(receipt);
      assert.equal(receipt.Lines.find(line => line.AccountCode === '2310').Credit, 1250);
      assert.equal(firstJournals.filter(row => row.Source === 'Student Invoice').length, 1);
      assert.equal(firstJournals.filter(row => row.Source === 'Student Invoice Credit').reduce((sum, row) => sum + row.TotalDebit, 0), 1250);
      assert.ok(firstJournals.every(row => row.BranchId === branch && row.TotalDebit === row.TotalCredit));
      const second = await f.record(body);
      assert.equal(second.ok, true);
      assert.equal(second.duplicate, true);
      assert.equal(second.invoicePostingWarning, '');
      assert.equal(f.rows('payments').length, 1);
      assert.equal(f.rows('ledger').filter(row => row.EntryType === 'Payment').length, 1);
      assert.equal(f.rows('invoices').length, 1);
      assert.equal(f.rows('invoices')[0].Credit, 1250);
      assert.equal(f.rows('accountingJournals').length, firstJournals.length);
      assert.ok(f.rows('accountSummaries').some(row => row.TotalCredit === 1250 && row.OutstandingBalance === 1250 && row.WalletBalance === 0));
    });
  }
}

test('legacy Main Branch invoice metadata can inherit its verified account section without changing its original charge', async t => {
  const f = fixture(t);
  f.student();
  schoolFee(f);
  const legacy = schoolInvoice();
  delete legacy.BranchId;
  delete legacy.SchoolSection;
  f.put('invoices', 'INV-001', legacy);
  const result = await f.record({ FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee' });
  assert.equal(result.ok, true);
  assert.equal(result.invoicePostingWarning, '');
  const invoice = f.get('invoices', 'INV-001');
  assert.equal(invoice.Debit, 2500);
  assert.equal(invoice.Credit, 1250);
  assert.equal(invoice.CreatedAt, legacy.CreatedAt);
  assert.equal(invoice.BranchId, 'main');
  assert.equal(invoice.SchoolSection, 'secondary');
  assert.ok(f.rows('accountingJournals').every(row => row.BranchId === 'main'));
});

test('school-fee total cannot allocate a same-reference invoice from another school section', async t => {
  const f = fixture(t);
  f.student();
  schoolFee(f);
  f.put('invoices', 'INV-001', schoolInvoice('main', { SchoolSection: 'primary', ClassName: 'Primary 4' }));
  const before = structuredClone(f.get('invoices', 'INV-001'));
  await assert.rejects(f.record({ FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee' }), denied);
  assert.equal(f.mutations.length, 0);
  assert.deepEqual(f.get('invoices', 'INV-001'), before);
});

test('an invoice without branch ownership cannot be adopted by a North Branch payment', async t => {
  const f = fixture(t, 'north');
  f.student();
  schoolFee(f);
  const legacy = schoolInvoice('north');
  delete legacy.BranchId;
  delete legacy.SchoolSection;
  delete legacy.ClassName;
  f.put('invoices', 'INV-001', legacy);
  await assert.rejects(f.record({ FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee' }), denied);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.get('invoices', 'INV-001').Credit, 0);
});

test('identical student reference found in two branches fails closed before any receipt is created', async t => {
  const f = fixture(t);
  f.student();
  f.student('STU-001', 'north');
  await assert.rejects(f.record(), denied);
  assert.equal(f.mutations.length, 0);
});

test('a duplicate student reference in a legacy noncanonical document ID cannot evade ambiguity checks', async t => {
  const f = fixture(t);
  f.student();
  f.put(f.schoolPath('students', 'north'), 'OLD-IMPORT-ID', {
    AdmissionNo: 'STU-001', BranchId: 'north', SchoolSection: 'secondary', ClassName: 'Grade 8', DisplayName: 'Other Student'
  });
  await assert.rejects(f.record(), denied);
  assert.equal(f.mutations.length, 0);
});

test('gateway-charge posting cannot overwrite a charge owned by a different branch', async t => {
  const f = fixture(t);
  f.student();
  f.put('paymentGatewayCharges', 'PAYSTACK-FEE-MANUAL-001', {
    ChargeId: 'PAYSTACK-FEE-MANUAL-001', BranchId: 'north', AccountRef: 'STU-OTHER', SchoolSection: 'secondary',
    Reference: 'MANUAL-001', Amount: 300, GrossCollection: 9000, NetSettlement: 8700
  });
  const before = structuredClone(f.get('paymentGatewayCharges', 'PAYSTACK-FEE-MANUAL-001'));
  await assert.rejects(f.record({ GrossAmount: 1300, Amount: 1300, GatewayFee: 50, NetAmount: 1250 }), denied);
  assert.deepEqual(f.get('paymentGatewayCharges', 'PAYSTACK-FEE-MANUAL-001'), before);
  assert.equal(f.mutations.length, 0);
});

test('a same-branch posting-ID collision cannot replace a journal for an unrelated reference', async t => {
  const f = fixture(t);
  f.student();
  f.put('accountingJournals', 'SYS-PAY-MANUAL-001', {
    JournalNo: 'SYS-PAY-MANUAL-001', BranchId: 'main', Reference: 'OTHER-PAYMENT', SourceId: 'OTHER-PAYMENT',
    Status: 'Posted', Source: 'Fee Payment', TotalDebit: 9900, TotalCredit: 9900,
    Lines: [{ AccountCode: '1000', Debit: 9900, Credit: 0 }, { AccountCode: '2300', Debit: 0, Credit: 9900 }]
  });
  const before = structuredClone(f.get('accountingJournals', 'SYS-PAY-MANUAL-001'));
  await assert.rejects(f.record(), denied);
  assert.deepEqual(f.get('accountingJournals', 'SYS-PAY-MANUAL-001'), before);
  assert.equal(f.mutations.length, 0);
});

test('a saved student link to an applicant in another section fails closed', async t => {
  const f = fixture(t);
  f.student('STU-001', 'main', 'secondary', { ApplicationReference: 'APP-001' });
  f.put(f.schoolPath('applications', 'main', 'primary'), 'APP-001', {
    ApplicationReference: 'APP-001', BranchId: 'main', SchoolSection: 'primary', ClassApplyingFor: 'Primary 4'
  });
  await assert.rejects(f.record({ FeeCode: 'ACC' }), denied);
  assert.equal(f.mutations.length, 0);
  assert.equal(f.get(f.schoolPath('applications', 'main', 'primary'), 'APP-001').AcceptanceFeePaid, undefined);
});

for (const [label, predicate] of [
  ['payment reference read', ({ name, method }) => method === 'GET' && name === 'payments/MANUAL-001'],
  ['ledger posting read', ({ name, method }) => method === 'GET' && name === 'ledger/LED-MANUAL-001'],
  ['journal posting read', ({ name, method }) => method === 'GET' && name === 'accountingJournals/SYS-PAY-MANUAL-001'],
  ['financial query', ({ name, options }) => name.endsWith(':runQuery') && JSON.parse(options.body).structuredQuery.from[0].collectionId === 'invoices'],
  ['summary read', ({ name, method }) => method === 'GET' && name === 'accountSummaries/STU-001']
]) {
  test(`an unavailable ${label} fails closed instead of assuming there is no conflicting record`, async t => {
    const f = fixture(t);
    f.student();
    f.failRead(predicate);
    await assert.rejects(f.record(), /Injected database read failure/);
    assert.equal(f.mutations.length, 0);
  });
}

test('gateway fees credit only the net amount, remain branch-owned, and do not duplicate on retry', async t => {
  const f = fixture(t, 'north');
  f.student();
  const input = { Amount: 1300, GrossAmount: 1300, GatewayFee: 50, NetAmount: 1250, Gateway: 'Paystack', Method: 'Online' };
  const first = await f.record(input);
  assert.equal(first.ok, true);
  assert.equal(first.payment.Amount, 1250);
  assert.equal(first.payment.GrossAmount, 1300);
  assert.equal(first.payment.GatewayFee, 50);
  assert.equal(first.payment.NetAmount, 1250);
  const charge = f.get('paymentGatewayCharges', 'PAYSTACK-FEE-MANUAL-001');
  assert.equal(charge.BranchId, 'north');
  assert.equal(charge.SchoolSection, 'secondary');
  assert.equal(charge.AccountRef, 'STU-001');
  assert.equal(charge.Amount, 50);
  assert.equal(charge.GrossCollection, 1300);
  assert.equal(charge.NetSettlement, 1250);
  const second = await f.record(input);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(f.rows('paymentGatewayCharges').length, 1);
  assert.equal(f.rows('payments').length, 1);
  assert.equal(f.rows('ledger').length, 1);
  assert.equal(f.rows('ledger')[0].Credit, 1250);
  assert.equal(f.rows('accountingJournals').length, 1);
  assert.equal(f.rows('accountingJournals')[0].TotalDebit, 1250);
  assert.equal(f.rows('accountingJournals')[0].TotalCredit, 1250);
  assert.equal(f.rows('accountSummaries')[0].WalletBalance, 1250);
});

for (const [collection, id, row] of [
  ['ledger', 'LED-MANUAL-001', { LedgerNo: 'LED-MANUAL-001', AccountRef: 'STU-OTHER', BranchId: 'north', SchoolSection: 'secondary', Credit: 9950, Reference: 'MANUAL-001' }],
  ['accountingJournals', 'SYS-PAY-MANUAL-001', { JournalNo: 'SYS-PAY-MANUAL-001', BranchId: 'north', Reference: 'MANUAL-001', SourceId: 'MANUAL-001', Status: 'Posted', TotalDebit: 9950, TotalCredit: 9950 }],
  ['accountSummaries', 'STU-001', { AccountRef: 'STU-001', BranchId: 'north', SchoolSection: 'secondary', WalletBalance: 9950 }]
]) {
  test(`a ${collection} create race fails its compare-and-set and preserves the winning record`, async t => {
    const f = fixture(t);
    f.student();
    f.raceWrite(collection, id, row, 'PATCH');
    await assert.rejects(f.record(), error => error.status === 409);
    assert.equal(f.injectedRaces.length, 1, 'The intended write race must actually occur');
    const saved = f.get(collection, id);
    for (const [key, expected] of Object.entries(row)) assert.deepEqual(saved[key], expected);
    assert.equal(f.rows('payments').length, 1, 'An already-recorded receipt remains available for safe retry/review');
    assert.notEqual(f.rows('payments')[0].ProcessingStatus, 'Completed');
  });
}

test('concurrent invoice edits abort the whole allocation batch and preserve the winning invoice version', async t => {
  const f = fixture(t);
  f.student();
  schoolFee(f);
  f.put('invoices', 'INV-001', schoolInvoice());
  const winningInvoice = schoolInvoice('main', { Credit: 200, Balance: 2300, Status: 'Part Paid', Notes: 'A separate account officer edited this invoice' });
  f.raceWrite('invoices', 'INV-001', winningInvoice, 'COMMIT');
  await assert.rejects(f.record({ FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee' }), error => error.status === 409);
  assert.equal(f.injectedRaces.length, 1);
  const saved = f.get('invoices', 'INV-001');
  assert.equal(saved.Credit, 200);
  assert.equal(saved.Balance, 2300);
  assert.equal(saved.Notes, winningInvoice.Notes);
  assert.equal(f.rows('accountingJournals').filter(row => row.Source === 'Student Invoice Credit').length, 0,
    'A failed batch cannot leave a journal claiming its invoice credit was applied');
  assert.notEqual(f.rows('payments')[0].InvoiceAllocationStatus, 'Completed');
});

test('a concurrent edit prevents standalone acceptance-invoice deletion using its version precondition', async t => {
  const f = fixture(t);
  f.student();
  const invoice = schoolInvoice('main', { FeeCode: 'ACC', FeeName: 'Acceptance fee', FeeCategory: 'Acceptance Fee' });
  f.put('invoices', 'INV-001', invoice);
  const winningInvoice = { ...invoice, Notes: 'A newer version must not be deleted' };
  f.raceWrite('invoices', 'INV-001', winningInvoice, 'DELETE');
  await assert.rejects(f.record({ FeeCode: 'ACC' }), error => error.status === 409);
  assert.equal(f.injectedRaces.length, 1);
  assert.equal(f.get('invoices', 'INV-001').Notes, winningInvoice.Notes);
  assert.equal(f.mutations.filter(item => item.delete?.endsWith('/invoices/INV-001')).length, 0);
});

test('a legitimate Primary-to-Secondary sibling credit is inspected read-only while the recipient payment stays section-scoped', async t => {
  const f = fixture(t, 'main', 'secondary');
  f.student();
  f.student('PRIMARY-001', 'main', 'primary');
  schoolFee(f);
  const action = {
    ActionId: 'TRANSFER-001', AccountRef: 'PRIMARY-001', TargetAccountRef: 'STU-001',
    BranchId: 'main', SchoolSection: 'primary', ClassName: 'Primary 4', Action: 'transfer to sibling',
    Amount: 400, Reference: 'SIBLING-TRANSFER-001', JournalNo: 'SYS-CREDIT-TRANSFER-001',
    CreatedAt: '2026-10-08T10:00:00.000Z'
  };
  f.put('creditActions', action.ActionId, action);
  f.put('accountingJournals', action.JournalNo, {
    JournalNo: action.JournalNo, AccountRef: 'PRIMARY-001', TargetAccountRef: 'STU-001', BranchId: 'main', SchoolSection: 'primary',
    Reference: action.Reference, Source: 'Student Account Credit Action', SourceId: action.ActionId,
    Date: '2026-10-08T10:00:00.000Z', Status: 'Posted', TotalDebit: 400, TotalCredit: 400,
    Lines: [{ AccountCode: '2310', Debit: 400, Credit: 0 }, { AccountCode: '2310', Debit: 0, Credit: 400 }]
  });
  f.put('ledger', 'TRANSFER-OUT', {
    LedgerNo: 'TRANSFER-OUT', AccountRef: 'PRIMARY-001', AdmissionNo: 'PRIMARY-001', BranchId: 'main', SchoolSection: 'primary',
    FeeCode: 'CREDIT_TRANSFER_OUT', FeeName: 'Credit Transfer Out', FeeCategory: 'Account Credit',
    EntryType: 'Credit Transfer', Debit: 400, Credit: 0, Reference: action.Reference, Date: '2026-10-08T10:00:00.000Z'
  });
  f.put('ledger', 'TRANSFER-IN', {
    LedgerNo: 'TRANSFER-IN', AccountRef: 'STU-001', AdmissionNo: 'STU-001', BranchId: 'main', SchoolSection: 'secondary',
    FeeCode: 'CREDIT_TRANSFER_IN', FeeName: 'Credit Transfer In', FeeCategory: 'Account Credit',
    EntryType: 'Credit Transfer', Debit: 0, Credit: 400, Reference: action.Reference, Date: '2026-10-08T10:00:00.000Z'
  });
  const actionBefore = structuredClone(f.get('creditActions', action.ActionId));
  const journalBefore = structuredClone(f.get('accountingJournals', action.JournalNo));
  const sourceBefore = structuredClone(f.get('ledger', 'TRANSFER-OUT'));
  const input = { FeeCode: 'SCHOOL_FEES_TOTAL', FeeName: 'School fees total', FeeCategory: 'School Fee' };
  const first = await f.record(input);
  assert.equal(first.ok, true);
  assert.equal(first.invoicePostingWarning, '');
  assert.equal(first.payment.SchoolSection, 'secondary');
  assert.equal(f.rows('invoices')[0].Credit, 1650, 'The recipient receives its 400 transfer plus the new 1250 receipt once');
  assert.equal(f.rows('invoices')[0].Balance, 850);
  const second = await f.record(input);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.invoicePostingWarning, '');
  assert.equal(f.rows('invoices')[0].Credit, 1650);
  assert.deepEqual(f.get('creditActions', action.ActionId), actionBefore);
  assert.deepEqual(f.get('accountingJournals', action.JournalNo), journalBefore);
  assert.deepEqual(f.get('ledger', 'TRANSFER-OUT'), sourceBefore);
  assert.equal(f.rows('accountSummaries')[0].TotalCredit, 1650);
  assert.equal(f.rows('accountSummaries')[0].OutstandingBalance, 850);
});

for (const field of ['accountRef', 'admissionNo', 'applicationReference']) {
  test(`a conflicting lowercase ${field} invoice alias cannot bypass account-ownership validation`, async t => {
    const f = fixture(t);
    f.student();
    schoolFee(f);
    f.put('invoices', 'INV-001', schoolInvoice('main', { [field]: 'FOREIGN-ACCOUNT' }));
    const before = structuredClone(f.get('invoices', 'INV-001'));
    await assert.rejects(f.record({ FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee' }), denied);
    assert.equal(f.mutations.length, 0);
    assert.deepEqual(f.get('invoices', 'INV-001'), before);
  });
}

test('trusted internal gateway recorder remains usable without desktop actor or branch fields', async t => {
  const f = fixture(t);
  f.student();
  const result = await f.record({
    BranchId: undefined, UserBranchId: undefined, DeviceBranchId: undefined,
    SchoolSection: undefined, UserSchoolSectionAccess: undefined,
    UserRole: undefined, UserUsername: undefined, RecordedBy: 'Verified Paystack callback',
    Method: 'Online', Gateway: 'Paystack', Amount: 1300, GrossAmount: 1300, GatewayFee: 50, NetAmount: 1250
  });
  assert.equal(result.ok, true);
  assert.equal(result.payment.BranchId, 'main');
  assert.equal(result.payment.SchoolSection, 'secondary');
  assert.equal(result.payment.Amount, 1250);
  assert.equal(f.rows('payments').length, 1);
  assert.equal(f.rows('ledger')[0].Credit, 1250);
  assert.equal(f.rows('accountingJournals')[0].TotalDebit, 1250);
  assert.equal(f.rows('accountingJournals')[0].TotalCredit, 1250);
});

function legacyIncomingSiblingCredit(f, journalBranch = 'north') {
  f.student();
  f.student('PRIMARY-001', 'north', 'primary');
  schoolFee(f);
  // recordCreditAction's historical marker does not contain branch/section.
  // Ownership must be established from its linked, posted accounting journal.
  f.put('creditActions', 'TRANSFER-LEGACY', {
    ActionId: 'TRANSFER-LEGACY', AccountRef: 'PRIMARY-001', TargetAccountRef: 'STU-001',
    Action: 'transfer to sibling', Amount: 400, Reference: 'SIBLING-LEGACY',
    JournalNo: 'SYS-CREDIT-TRANSFER-LEGACY', CreatedAt: '2026-10-08T10:00:00.000Z'
  });
  f.put('accountingJournals', 'SYS-CREDIT-TRANSFER-LEGACY', {
    JournalNo: 'SYS-CREDIT-TRANSFER-LEGACY', BranchId: journalBranch, SchoolSection: 'primary',
    AccountRef: 'PRIMARY-001', TargetAccountRef: 'STU-001', Source: 'Student Account Credit Action',
    SourceId: 'TRANSFER-LEGACY', Reference: 'SIBLING-LEGACY', Date: '2026-10-08T10:00:00.000Z',
    Status: 'Posted', TotalDebit: 400, TotalCredit: 400,
    Lines: [{ AccountCode: '2310', Debit: 400, Credit: 0 }, { AccountCode: '2310', Debit: 0, Credit: 400 }]
  });
  f.put('ledger', 'TRANSFER-LEGACY-IN', {
    LedgerNo: 'TRANSFER-LEGACY-IN', AccountRef: 'STU-001', AdmissionNo: 'STU-001', BranchId: 'north', SchoolSection: 'secondary',
    FeeCode: 'CREDIT_TRANSFER_IN', FeeCategory: 'Account Credit', EntryType: 'Credit Transfer',
    Debit: 0, Credit: 400, Reference: 'SIBLING-LEGACY', Date: '2026-10-08T10:00:00.000Z'
  });
}

test('North legacy incoming credit action inherits branch only from its linked posted North journal', async t => {
  const f = fixture(t, 'north');
  legacyIncomingSiblingCredit(f);
  const actionBefore = structuredClone(f.get('creditActions', 'TRANSFER-LEGACY'));
  const journalBefore = structuredClone(f.get('accountingJournals', 'SYS-CREDIT-TRANSFER-LEGACY'));
  const input = { FeeCode: 'SCHOOL_FEES_TOTAL', FeeName: 'School fees total', FeeCategory: 'School Fee' };
  const first = await f.record(input);
  assert.equal(first.ok, true);
  assert.equal(first.invoicePostingWarning, '');
  assert.equal(f.rows('invoices')[0].Credit, 1650);
  const retry = await f.record(input);
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.invoicePostingWarning, '');
  assert.equal(f.rows('invoices')[0].Credit, 1650);
  assert.deepEqual(f.get('creditActions', 'TRANSFER-LEGACY'), actionBefore, 'Ownership is inferred read-only, not adopted by rewriting history');
  assert.deepEqual(f.get('accountingJournals', 'SYS-CREDIT-TRANSFER-LEGACY'), journalBefore);
});

test('North legacy incoming action cannot inherit branch from a posted foreign-branch journal', async t => {
  const f = fixture(t, 'north');
  legacyIncomingSiblingCredit(f, 'main');
  const actionBefore = structuredClone(f.get('creditActions', 'TRANSFER-LEGACY'));
  const journalBefore = structuredClone(f.get('accountingJournals', 'SYS-CREDIT-TRANSFER-LEGACY'));
  await assert.rejects(f.record({ FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee' }), denied);
  assert.equal(f.mutations.length, 0);
  assert.deepEqual(f.get('creditActions', 'TRANSFER-LEGACY'), actionBefore);
  assert.deepEqual(f.get('accountingJournals', 'SYS-CREDIT-TRANSFER-LEGACY'), journalBefore);
});
