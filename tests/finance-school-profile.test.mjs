import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { feeRowsForBranch } from '../functions/lib/fee-branch-scope.js';
import { loadFinanceSchoolProfile } from '../functions/lib/finance-school-profile.js';
import { getAccountsOverview, loadAccountsWalletLedger } from '../functions/api/backend.js';
import { accountingRequestBranch, accountingRowsForBranch } from '../functions/lib/accounting-branch-scope.js';
import { ORGANIZATION_EDITIONS } from '../functions/lib/organization-config.js';
import { branchProfilesForRecords } from '../functions/lib/branch-profile-settings.js';
import { recordBranchId } from '../functions/lib/branch-scope.js';

const adminSource = await readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const clean = value => String(value ?? '').trim();
const plain = value => JSON.parse(JSON.stringify(value));
const branchOverride = (session, term = 'First Term') => ({
  OverrideFields: ['CurrentAcademicSession', 'CurrentTerm'],
  Values: { CurrentAcademicSession: session, CurrentTerm: term }
});
const matchesFilter = (row, filter) => filter.filters
  ? filter.filterJoin === 'OR' ? filter.filters.some(child => matchesFilter(row, child))
    : filter.filters.every(child => matchesFilter(row, child))
  : Object.hasOwn(row, filter.field) && (filter.op === 'in'
    ? filter.value.includes(row[filter.field]) : row[filter.field] === filter.value);

function settingsReader({ profile = { CurrentAcademicSession: '' }, branches = {
  main: branchOverride('2026/2027')
}, failCollection = '', failId = '' } = {}) {
  const reads = [];
  return {
    reads,
    readDocument: async (env, collection, id) => {
      reads.push({ env, collection, id });
      if (collection === failCollection && (!failId || id === failId)) {
        throw new Error('Private storage diagnostic: credentials must not reach the client');
      }
      if (collection === 'settings' && id === 'schoolProfile') return profile;
      if (collection === 'branchProfileOverrides') return branches[id] || null;
      throw new Error(`Unexpected document read: ${collection}/${id}`);
    }
  };
}

function financeHarness(options = {}) {
  const reader = settingsReader(options);
  const financeQueries = [], overviewCalls = [], overviewResults = [];
  const common = {
    branchProfilesForRecords: (env, profile, rows) => branchProfilesForRecords(env, profile, rows, reader.readDocument), recordBranchId,
    loadBillingDiscounts: async () => [],
    clean,
    lower: value => clean(value).toLowerCase(),
    nowIso: () => '2026-11-04T14:00:00.000Z',
    feeRowsForBranch,
    loadBranchFinanceRows: async (_env, collection, branchId, query = {}) => {
      if (query.filters) financeQueries.push({ collection, query, branchId });
      if (options.failWalletQuery && query.filters?.some(filter => filter.filterJoin === 'OR')) {
        throw Object.assign(new Error('Wallet history is unavailable'), { status: 503 });
      }
      return (options.rows?.[collection] || []).filter(row => (query.filters || []).every(filter => matchesFilter(row, filter)));
    },
    loadAccountsWalletLedger: (env, branch, readTime) => loadAccountsWalletLedger(env, branch, readTime,
      { loadBranchFinanceRows: common.loadBranchFinanceRows }),
    mergeAccountsLedgerRows: (ledger, walletLedger) => [...ledger, ...walletLedger],
    loadFinanceSchoolProfile: (env, branch) => loadFinanceSchoolProfile(env, branch, reader.readDocument),
    getDocument: reader.readDocument,
    listCollection: async () => [],
    listCollectionForReport: async () => [],
    listSchoolCollection: async () => [],
    queryCollectionPages: async (_env, collection, query) => {
      financeQueries.push({ collection, query });
      return [];
    }
  };
  const user = {
    role: 'Super Admin', edition: 'school', allowedSections: ['accounts'],
    branchId: 'main', schoolSectionAccess: 'All', subscriptionActive: true,
    ...options.user
  };
  const admin = vm.runInNewContext(
    `${adminSource.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')}\nonRequestPost`, {
      ...common, Response,
      requireFirestoreEnv: () => {}, withVendorStorePolicy: async (_env, _user, rows) => rows,
      requireStaffSession: async () => user,
      readJsonBody: async () => ({ section: 'accounts', ...options.body }),
      schoolSectionFor: row => row.SchoolSection || 'secondary',
      normalizeClassKey: clean,
      withStudentProfileDefaults: row => row,
      studentWalletProfile: () => ({}),
      getAccountsOverview: async (_env, preloaded, scope) => {
        overviewCalls.push({ preloaded, scope });
        if (options.realOverview) {
          const result = await getAccountsOverview(_env, { accounts: [], feeItems: [], applications: [],
            students: options.students || [], billingCategories: [], billingCategoryDiscounts: [], ...preloaded }, scope);
          overviewResults.push(result);
          return result;
        }
        return { ok: true, accounts: [] };
      }
    }
  );
  const start = backendSource.indexOf('export async function getAccountsOverview');
  const desktop = vm.runInNewContext(`(${backendSource.slice(start,
    backendSource.indexOf('async function saveBillingCategory', start)).replace('export ', '')})`, {
    ...common, accountingRequestBranch, accountingRowsForBranch,
    normalizeAccount: row => row, normalizePayment: row => row, normalizeInvoice: row => row,
    normalizeLedger: row => row, normalizeFeeItem: row => row, normalizeApplication: row => row,
    normalizeStudent: row => row, selectStudentBillingProfiles: rows => rows,
    financialRowsByIdentity: () => () => []
  });
  return { reader, financeQueries, overviewCalls, overviewResults, admin, desktop };
}

function assertFinanceSession(queries, session) {
  const periodQueries = queries.filter(row => row.query.filters.some(filter => filter.field === 'AcademicSession'));
  const walletQueries = queries.filter(row => row.query.filters.some(filter => filter.filterJoin === 'OR'));
  assert.deepEqual(periodQueries.map(row => row.collection).sort(), ['invoices', 'ledger', 'payments']);
  assert.equal(walletQueries.length, 1, 'both web and desktop request lifetime wallet data once');
  assert.equal(queries.length, 4);
  for (const { query } of periodQueries) {
    assert.deepEqual(plain(query.filters), [{ field: 'AcademicSession', op: 'in', value: [session, '', 'All'] }]);
    assert.equal(query.pageSize, 500);
    assert.equal(query.maxRows, 15000);
  }
  assert.equal(walletQueries[0].collection, 'ledger');
  assert.equal(walletQueries[0].query.readTime, periodQueries[0].query.readTime);
  assert.ok(periodQueries.every(row => row.query.readTime === periodQueries[0].query.readTime));
}

test('saved Main Branch session works even when organisation session is blank', async () => {
  const { readDocument, reads } = settingsReader();
  const profile = await loadFinanceSchoolProfile({}, 'main', readDocument);
  assert.equal(profile.CurrentAcademicSession, '2026/2027');
  assert.equal(profile.CurrentTerm, 'First Term');
  assert.equal(profile.EffectiveBranchId, 'main');
  assert.equal(profile.OrganisationDefaults.CurrentAcademicSession, '');
  assert.deepEqual(reads.map(({ collection, id }) => [collection, id]), [
    ['settings', 'schoolProfile'], ['branchProfileOverrides', 'main']
  ]);
});

test('branch session overrides a different organisation session and inherits other fields', async () => {
  const { readDocument } = settingsReader({
    profile: { CurrentAcademicSession: '2025/2026', CurrentTerm: 'Second Term', SchoolName: 'Demo School' },
    branches: { annex: { Values: { CurrentAcademicSession: '2026/2027', UnknownSetting: 'ignored' } } }
  });
  const profile = await loadFinanceSchoolProfile({}, 'ANNEX', readDocument);
  assert.equal(profile.CurrentAcademicSession, '2026/2027');
  assert.equal(profile.CurrentTerm, 'Second Term');
  assert.equal(profile.SchoolName, 'Demo School');
  assert.equal(profile.UnknownSetting, undefined);
});

test('existing organisation session continues to work without branch overrides', async () => {
  const { readDocument } = settingsReader({ profile: { CurrentAcademicSession: '2026/2027' }, branches: {} });
  assert.equal((await loadFinanceSchoolProfile({}, 'main', readDocument)).CurrentAcademicSession, '2026/2027');
});

test('explicit blank branch session does not silently fall back to a different financial year', async () => {
  const { readDocument } = settingsReader({ profile: { CurrentAcademicSession: '2025/2026' },
    branches: { main: branchOverride('') } });
  assert.equal((await loadFinanceSchoolProfile({}, 'main', readDocument)).CurrentAcademicSession, '');
});

test('missing organisation profile can still use a saved branch session', async () => {
  const { readDocument } = settingsReader({ profile: null });
  assert.equal((await loadFinanceSchoolProfile({}, 'main', readDocument)).CurrentAcademicSession, '2026/2027');
});

test('environment defaults match Settings but an explicitly saved blank takes precedence', async () => {
  const env = { CURRENT_ACADEMIC_SESSION: '2026/2027', CURRENT_TERM: 'Third Term' };
  const missing = settingsReader({ profile: null, branches: {} });
  assert.equal((await loadFinanceSchoolProfile(env, 'main', missing.readDocument)).CurrentAcademicSession, '2026/2027');
  assert.equal((await loadFinanceSchoolProfile(env, 'main', missing.readDocument)).CurrentTerm, 'Third Term');
  const blank = settingsReader({ branches: {} });
  assert.equal((await loadFinanceSchoolProfile(env, 'main', blank.readDocument)).CurrentAcademicSession, '');
});

test('organisation-wide overview never borrows one branch session', async () => {
  for (const branch of ['', 'all', ' ALL ']) {
    const { readDocument, reads } = settingsReader();
    const profile = await loadFinanceSchoolProfile({}, branch, readDocument);
    assert.equal(profile.CurrentAcademicSession, '');
    assert.equal(profile.SettingsScope, 'organisation');
    assert.equal(reads.length, 1);
  }
});

test('each request resolves its own tenant and branch without a shared profile cache', async () => {
  const seen = [];
  const reader = async (env, collection, id) => {
    seen.push([env.tenant, collection, id]);
    return collection === 'settings' ? { SchoolName: env.tenant }
      : branchOverride(`${env.tenant}/${id}`);
  };
  const results = await Promise.all([
    loadFinanceSchoolProfile({ tenant: 'A' }, 'main', reader),
    loadFinanceSchoolProfile({ tenant: 'B' }, 'annex', reader)
  ]);
  assert.deepEqual(results.map(row => row.CurrentAcademicSession), ['A/main', 'B/annex']);
  assert.deepEqual(results.map(row => row.SchoolName), ['A', 'B']);
  assert.equal(seen.length, 4);
});

for (const edition of ORGANIZATION_EDITIONS) {
  test(`${edition} web Accounts uses the authorized branch session for all finance pages`, async () => {
    const h = financeHarness({ user: { edition }, body: { BranchId: 'untrusted-branch' } });
    const response = await h.admin({ env: {}, request: {} });
    const result = await response.json();
    assert.equal(response.status, 200, result.message);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(result.summary.financeAcademicSession, '2026/2027');
    assertFinanceSession(h.financeQueries, '2026/2027');
    assert.equal(h.overviewCalls[0].preloaded.schoolProfile.CurrentAcademicSession, '2026/2027');
    assert.equal(h.overviewCalls[0].scope.branchId, 'main');
  });

  test(`${edition} desktop Accounts resolves the same branch-effective session`, async () => {
    const h = financeHarness();
    const result = await h.desktop({ ORGANISATION_EDITION: edition }, {}, { UserBranchId: 'main' });
    assert.equal(result.financeAcademicSession, '2026/2027');
    assertFinanceSession(h.financeQueries, '2026/2027');
    assert.equal(h.reader.reads.find(row => row.collection === 'branchProfileOverrides').id, 'main');
  });
}

test('switching branches selects the matching session on both Accounts-loading paths', async () => {
  const options = { profile: { CurrentAcademicSession: '2024/2025' }, branches: {
    main: branchOverride('2026/2027'), primary: branchOverride('2025/2026')
  } };
  for (const [branch, session] of [['main', '2026/2027'], ['primary', '2025/2026']]) {
    const web = financeHarness({ ...options, user: { branchId: branch } });
    assert.equal((await (await web.admin({ env: {}, request: {} })).json()).summary.financeAcademicSession, session);
    assertFinanceSession(web.financeQueries, session);
    const desktop = financeHarness(options);
    assert.equal((await desktop.desktop({}, {}, { UserBranchId: branch })).financeAcademicSession, session);
    assertFinanceSession(desktop.financeQueries, session);
  }
});

test('desktop assigned-branch authorization is checked before profile or financial reads', async () => {
  const h = financeHarness();
  await assert.rejects(h.desktop({}, {}, { UserBranchId: 'main', BranchId: 'primary' }),
    error => error.status === 403);
  assert.equal(h.reader.reads.length, 0);
  assert.equal(h.financeQueries.length, 0);
});

for (const failCollection of ['settings', 'branchProfileOverrides']) {
  test(`${failCollection} read failure stops web and desktop before any financial queries`, async () => {
    const web = financeHarness({ failCollection });
    const response = await web.admin({ env: {}, request: {} });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.code, 'FINANCE_SETTINGS_UNAVAILABLE');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.match(result.message, /Could not load school settings/);
    assert.doesNotMatch(result.message, /Set the current|Private storage|credentials/);
    assert.equal(web.financeQueries.length, 0);
    assert.equal(web.overviewCalls.length, 0);
    const desktop = financeHarness({ failCollection });
    await assert.rejects(desktop.desktop({}, {}, { UserBranchId: 'main' }),
      error => error.status === 503 && error.code === 'FINANCE_SETTINGS_UNAVAILABLE');
    assert.equal(desktop.financeQueries.length, 0);
  });
}

test('a genuinely unsaved or explicitly cleared session still blocks unbounded financial reads', async () => {
  for (const options of [{ branches: {} }, { profile: { CurrentAcademicSession: '2025/2026' },
    branches: { main: branchOverride('') } }, { user: { branchId: '' } }]) {
    const web = financeHarness(options);
    const response = await web.admin({ env: {}, request: {} });
    assert.equal(response.status, 409);
    assert.equal(web.financeQueries.length, 0);
    const desktop = financeHarness(options);
    await assert.rejects(desktop.desktop({}, {}, {
      BranchId: options.user?.branchId === '' ? 'all' : 'main'
    }), error => error.status === 409);
    assert.equal(desktop.financeQueries.length, 0);
  }
});

test('already resolved one-account snapshots stay offline and keep the supplied period', async () => {
  const result = await getAccountsOverview({}, {
    schoolProfile: { CurrentAcademicSession: '2025/2026', CurrentTerm: 'Third Term' },
    accounts: [], payments: [], invoices: [], ledger: [], feeItems: [], students: [], applications: [],
    billingCategories: [], accountSummaries: []
  }, { BranchId: 'main' });
  assert.equal(result.financeAcademicSession, '2025/2026');
  assert.deepEqual(result.accounts, []);
});

test('web period preload passes missing-period refunds into the real wallet projection once', async () => {
  const identity = { AccountRef: 'TEST/25/18', AdmissionNo: 'TEST/25/18', BranchId: 'main', SchoolSection: 'secondary',
    ClassName: 'Grade 8', AcademicSession: '2026/2027', Term: 'First Term' };
  const ledger = [
    { ...identity, LedgerNo: 'FEES', FeeCategory: 'School Fee', Reference: 'PAY-FEES', Credit: 805720, Debit: 0 },
    { ...identity, LedgerNo: 'DEPOSIT', FeeCategory: 'Wallet', EntryType: 'Wallet Deposit', Credit: 6000, Debit: 0 },
    { ...identity, LedgerNo: 'PURCHASES', FeeCategory: 'Wallet', EntryType: 'Wallet Purchase', Credit: 0, Debit: 9500 },
    { AccountRef: identity.AccountRef, AdmissionNo: identity.AdmissionNo, BranchId: 'main', SchoolSection: 'secondary',
      LedgerNo: 'REFUND', FeeCategory: 'Wallet', EntryType: 'Wallet Refund', Credit: 3500, Debit: 0 },
    { ...identity, LedgerNo: 'OTHER-BRANCH', BranchId: 'north', FeeCategory: 'Wallet', Credit: 3000 },
    { ...identity, LedgerNo: 'OTHER-SECTION', SchoolSection: 'primary', FeeCategory: 'Wallet', Credit: 4000 }
  ];
  const h = financeHarness({ realOverview: true, user: { schoolSectionAccess: 'secondary' }, students: [identity], rows: {
    ledger, payments: [{ ...identity, Reference: 'PAY-FEES', FeeCategory: 'School Fee', Amount: 805720, Status: 'Paid' }],
    invoices: [{ ...identity, InvoiceId: 'INV-FEE', FeeCategory: 'School Fee', Amount: 600000, Credit: 600000 }],
    accountSummaries: [{ ...identity, WalletBalance: 900, CreditBalance: 205720 }]
  } });
  const response = await h.admin({ env: {}, request: {} });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assertFinanceSession(h.financeQueries, identity.AcademicSession);
  assert.equal(h.overviewCalls[0].preloaded.ledger.some(row => row.LedgerNo === 'REFUND'), false);
  assert.deepEqual(h.overviewCalls[0].preloaded.walletLedger.map(row => row.LedgerNo), ['DEPOSIT', 'PURCHASES', 'REFUND']);
  assert.equal(h.overviewResults.length, 1);
  const account = h.overviewResults[0].accounts.find(row => row.AccountRef === identity.AccountRef);
  assert.equal(account.WalletBalance, 0);
  assert.equal(account.ExcessCredit, 205720);
  assert.equal(account.TotalCredit, 805720);
  assert.equal(account.TotalDebit, 600000);
  assert.equal(h.overviewResults[0].ledger.filter(row => row.FeeCategory === 'Wallet').length, 3);
});

test('wallet preload fails closed and unrelated web modules do not load wallet history', async () => {
  const failed = financeHarness({ failWalletQuery: true });
  const response = await failed.admin({ env: {}, request: {} });
  assert.equal(response.status, 503);
  assert.equal(failed.overviewCalls.length, 0);
  const students = financeHarness({ user: { allowedSections: ['students'] }, body: { section: 'students' } });
  assert.equal((await students.admin({ env: {}, request: {} })).status, 200);
  assert.equal(students.financeQueries.length, 0);
  assert.equal(students.overviewCalls.length, 0);
});
