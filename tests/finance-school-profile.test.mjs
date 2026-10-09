import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadFinanceSchoolProfile } from '../functions/lib/finance-school-profile.js';
import { getAccountsOverview } from '../functions/api/backend.js';
import { accountingRequestBranch, accountingRowsForBranch } from '../functions/lib/accounting-branch-scope.js';
import { ORGANIZATION_EDITIONS } from '../functions/lib/organization-config.js';

const adminSource = await readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const clean = value => String(value ?? '').trim();
const plain = value => JSON.parse(JSON.stringify(value));
const branchOverride = (session, term = 'First Term') => ({
  OverrideFields: ['CurrentAcademicSession', 'CurrentTerm'],
  Values: { CurrentAcademicSession: session, CurrentTerm: term }
});

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
  const financeQueries = [], overviewCalls = [];
  const common = {
    clean,
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
      requireFirestoreEnv: () => {},
      requireStaffSession: async () => user,
      readJsonBody: async () => ({ section: 'accounts', ...options.body }),
      schoolSectionFor: row => row.SchoolSection || 'secondary',
      normalizeClassKey: clean,
      withStudentProfileDefaults: row => row,
      studentWalletProfile: () => ({}),
      getAccountsOverview: async (_env, preloaded, scope) => {
        overviewCalls.push({ preloaded, scope });
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
  return { reader, financeQueries, overviewCalls, admin, desktop };
}

function assertFinanceSession(queries, session) {
  assert.deepEqual(queries.map(row => row.collection).sort(), ['invoices', 'ledger', 'payments']);
  for (const { query } of queries) {
    assert.deepEqual(plain(query.filters), [{ field: 'AcademicSession', op: 'in', value: [session, '', 'All'] }]);
    assert.equal(query.pageSize, 500);
    assert.equal(query.maxRows, 15000);
  }
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
