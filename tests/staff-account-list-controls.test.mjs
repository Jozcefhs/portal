import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
await import('../js/list-sorting.js');
const sorting = globalThis.DynamaxListSorting;
const helperSource = admin.slice(admin.indexOf('function alphabeticalStaffRoles('), admin.indexOf('function renderStaffUsers('));
const renderSource = admin.slice(admin.indexOf('function renderStaffUsers('), admin.indexOf('function renderRoleAccessEditor('));
const clean = (value) => String(value ?? '').trim();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const users = [
  { Username: 'zoe', LoginUsername: 'zoe@example.test', DisplayName: 'Zoe Brown', FirstName: 'Zoe', Surname: 'Brown', Role: 'Teacher', Department: 'Academics', BranchId: 'main', SchoolSectionAccess: 'Secondary', Active: 'YES', CreatedAt: '2026-02-01', UpdatedAt: '2026-04-01' },
  { Username: 'alice', DisplayName: 'Alice Smith', FirstName: 'Alice', Surname: 'Smith', Role: 'Accounts Officer', Department: 'Finance', BranchId: 'main', Active: 'NO', CreatedAt: '2026-03-01', UpdatedAt: '2026-03-01' },
  { Username: 'class10', DisplayName: 'Staff 10', Role: 'Teacher', Department: 'Academics', Active: true },
  { Username: 'class2', DisplayName: 'staff 2', Role: 'Teacher', Department: 'Academics', Active: '1', CreatedAt: '2026-01-01', UpdatedAt: '2026-02-01' }
];
function fixture(extra = {}) {
  const stored = new Map();
  const context = vm.createContext({
    clean, escapeHtml, Set, yes: (value) => value === true || ['yes', 'true', '1', 'active'].includes(clean(value).toLowerCase()),
    adminListTimestamp: sorting.timestamp, sortAdminListEntries: sorting.sortEntries,
    ADMIN_LIST_CREATED_FIELDS: sorting.createdFields, ADMIN_LIST_MODIFIED_FIELDS: sorting.modifiedFields,
    ADMIN_LIST_SORT_MODES: sorting.modes,
    window: { localStorage: { setItem: (key, value) => stored.set(key, value) } },
    ...extra
  });
  vm.runInContext(helperSource, context);
  return { context, stored, entries: users.map((user, index) => context.staffUserListEntry(user, index)) };
}
const ids = (entries) => Array.from(entries, (entry) => entry.index);

test('staff search matches display/identity names, login email, role, department and branch/section', () => {
  const { context, entries } = fixture();
  for (const query of ['ZOE', 'Brown', 'zoe@example.test', 'main secondary', 'Academics Brown', 'Teacher Zoe']) {
    assert.deepEqual(ids(context.filterStaffUserListEntries(entries, { search: query })), [0], query);
  }
  assert.deepEqual(ids(context.filterStaffUserListEntries(entries, { search: '   ' })), [0, 1, 2, 3]);
  assert.deepEqual(ids(context.filterStaffUserListEntries(entries, { search: 'no such staff' })), []);
});

test('role and active-state filters combine with search without changing account data', () => {
  const before = JSON.stringify(users);
  const { context, entries } = fixture();
  assert.deepEqual(ids(context.filterStaffUserListEntries(entries, { role: 'Teacher', status: 'active' })), [0, 2, 3]);
  assert.deepEqual(ids(context.filterStaffUserListEntries(entries, { status: 'disabled' })), [1]);
  assert.deepEqual(ids(context.filterStaffUserListEntries(entries, { search: 'Academics', role: 'Teacher', status: 'disabled' })), []);
  assert.deepEqual(ids(context.filterStaffUserListEntries(entries, { role: 'Accounts Officer', search: 'smith' })), [1]);
  assert.equal(JSON.stringify(users), before);
});

test('staff lists support all seven shared sorts, natural names, stable default and missing timestamps last', () => {
  const { entries } = fixture();
  const expected = {
    default: [0, 1, 2, 3], 'name-asc': [1, 3, 2, 0], 'name-desc': [0, 2, 3, 1],
    'created-desc': [1, 0, 3, 2], 'created-asc': [3, 0, 1, 2],
    'modified-desc': [0, 1, 3, 2], 'modified-asc': [3, 1, 0, 2]
  };
  for (const [mode] of sorting.modes) assert.deepEqual(ids(sorting.sortEntries(entries, mode)), expected[mode], mode);
});

function registerFixture({ unavailableStorage = false } = {}) {
  const { context, entries, stored } = fixture();
  const rows = entries.map((entry) => ({ hidden: false, dataset: {
    listIndex: String(entry.index), listName: entry.name, listCreated: String(entry.created), listModified: String(entry.modified),
    listSearch: entry.search, listRole: entry.role, listStatus: entry.status
  } }));
  const controls = {
    '[data-staff-user-search]': { value: '', readOnly: true }, '[data-staff-user-role]': { value: '' },
    '[data-staff-user-status]': { value: '' }, '[data-staff-user-sort]': { value: 'default', dataset: { listStorageKey: 'staff-sort' } },
    '[data-staff-user-count]': { textContent: '' }, '[data-staff-user-empty]': { hidden: true }
  };
  for (const control of Object.values(controls)) control.addEventListener = (type, listener) => { control[`on${type}`] = listener; };
  const list = { querySelectorAll: () => [...rows], append: (row) => { rows.splice(rows.indexOf(row), 1); rows.push(row); } };
  const register = { dataset: { staffUserQuery: '' },
    querySelector: (selector) => selector === '.staff-user-list' ? list : controls[selector],
    querySelectorAll: () => ['[data-staff-user-role]', '[data-staff-user-status]', '[data-staff-user-sort]'].map((selector) => controls[selector]) };
  if (unavailableStorage) context.window.localStorage.setItem = () => { throw new Error('Storage unavailable'); };
  return { context, rows, controls, register, stored };
}

test('live card filtering updates visible rows, count and empty state and preserves action-bearing nodes', () => {
  const { context, rows, controls, register, stored } = registerFixture();
  const originalRows = [...rows];
  controls['[data-staff-user-search]'].value = 'staff';
  register.dataset.staffUserQuery = 'staff';
  controls['[data-staff-user-sort]'].value = 'name-asc';
  context.applyStaffUserListControls(register);
  assert.deepEqual(rows.filter((row) => !row.hidden).map((row) => row.dataset.listIndex), ['3', '2']);
  assert.equal(controls['[data-staff-user-count]'].textContent, '2 of 4 accounts shown');
  assert.equal(controls['[data-staff-user-empty]'].hidden, true);
  assert.equal(stored.get('staff-sort'), 'name-asc');
  assert.ok(rows.every((row) => originalRows.includes(row)), 'sorting moves original cards instead of recreating edit/delete controls');
  controls['[data-staff-user-status]'].value = 'disabled';
  context.applyStaffUserListControls(register);
  assert.equal(controls['[data-staff-user-empty]'].hidden, false);
  assert.equal(controls['[data-staff-user-count]'].textContent, '0 of 4 accounts shown');
  controls['[data-staff-user-search]'].value = '';
  register.dataset.staffUserQuery = '';
  controls['[data-staff-user-status]'].value = '';
  controls['[data-staff-user-sort]'].value = 'default';
  context.applyStaffUserListControls(register);
  assert.deepEqual(rows.map((row) => row.dataset.listIndex), ['0', '1', '2', '3']);
  assert.ok(rows.every((row) => !row.hidden));
});

test('search and sorting still work when browser storage is blocked', () => {
  const { context, register } = registerFixture({ unavailableStorage: true });
  assert.doesNotThrow(() => context.applyStaffUserListControls(register));
  assert.doesNotThrow(() => context.applyStaffUserListControls(null));
});

test('roles sort alphabetically without mutating the original list or Set', () => {
  const { context } = fixture();
  const roles = ['Vendor User', 'Super Admin', 'Director', 'Admin', 'Accounts Officer', 'Teacher'];
  const before = [...roles];
  const expected = ['Accounts Officer', 'Admin', 'Director', 'Super Admin', 'Teacher', 'Vendor User'];
  assert.deepEqual(Array.from(context.alphabeticalStaffRoles(roles)), expected);
  assert.deepEqual(Array.from(context.alphabeticalStaffRoles(new Set(roles))), expected);
  assert.deepEqual(roles, before);
});

function renderedFixture(edition, { previous = null, rolePolicy = true, rows = users } = {}) {
  const roles = ['Vendor User', 'Super Admin', 'Director', 'Admin', 'Accounts Officer', 'Teacher'];
  const panel = { querySelector: (selector) => selector === '[data-staff-account-register]' ? previous : null, innerHTML: '' };
  const { context } = fixture({
    panelEl: panel, activeSection: 'staffUsers', staffUsersData: rows, staffSeatUsage: null,
    staffRoleAccessData: rolePolicy ? { roles: Object.fromEntries(roles.map((role) => [role, {}])) } : null,
    currentUser: { username: 'signed-in-admin' }, resolveDashboardEdition: () => edition,
    staffRolesForEdition: () => roles, webTabsForEdition: () => [], staffModulePreferencesData: null,
    staffRoleAccessSelectedRole: '', staffMfaAdminData: null, staffNameMigration: null, staffNameFormat: 'First name, surname',
    canManageOrganisationSettings: () => false, canAssignStaffBranches: false, availableBranches: [], staffAuditData: [], staffApprovalAccounts: [],
    savedAdminListSort: () => 'name-desc', adminListStorageKey: () => 'staff-sort',
    document: { getElementById: () => null }, mountWorkspaceTabs: () => {}, bindStaffUserEvents: () => {},
    renderRoleAccessEditor: () => {}, updateMfaPolicyEditor: () => {}, staffMfaAccountLabel: () => 'Two-factor not enrolled'
  });
  vm.runInContext(renderSource, context);
  context.renderStaffUsers();
  return panel.innerHTML;
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition} staff screen renders scoped controls and alphabetic role options without changing the default role`, () => {
    const html = renderedFixture(edition);
    for (const selector of ['data-staff-account-register', 'data-staff-user-search', 'data-staff-user-role', 'data-staff-user-status', 'data-staff-user-sort']) assert.ok(html.includes(selector));
    const options = html.match(/<select name="Role" required>([\s\S]*?)<\/select>/)[1];
    assert.deepEqual([...options.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map((match) => match[1]), ['Accounts Officer', 'Admin', 'Director', 'Super Admin', 'Teacher', 'Vendor User']);
    assert.match(options, /<option selected>Vendor User<\/option>/);
    assert.match(html, /value="name-desc" selected/);
    assert.match(html, /data-edit-user="zoe"/);
    assert.match(html, /data-delete-user="alice"/);
  });
}

test('the fallback role list and empty register render with the same controls', () => {
  const html = renderedFixture('school', { rolePolicy: false, rows: [] });
  assert.match(html, /No database staff accounts found/);
  assert.match(html, /data-staff-user-sort/);
  assert.match(html, /<option>Accounts Officer<\/option>/);
});

test('search and filters survive a refresh/edit rerender and user-supplied values are escaped', () => {
  const values = { '[data-staff-user-search]': '" <script>Smith</script>', '[data-staff-user-role]': 'Teacher', '[data-staff-user-status]': 'active' };
  const html = renderedFixture('school', { previous: { dataset: { staffUserQuery: values['[data-staff-user-search]'] }, querySelector: (selector) => ({ value: values[selector] }) } });
  assert.match(html, /value="&quot; &lt;script&gt;Smith&lt;\/script&gt;"/);
  assert.match(html, /value="Teacher" selected/);
  assert.match(html, /value="active" selected/);
  assert.doesNotMatch(html, /<script>Smith/);
});

test('fresh openings and autofilled usernames do not create or retain a default search', () => {
  const { context, register, controls, rows } = registerFixture();
  const search = controls['[data-staff-user-search]'];
  search.value = 'admin'; // A password manager filled the DOM before events were bound.
  const html = renderedFixture('school', { previous: register });
  assert.match(html, /data-staff-user-search value=""/);
  assert.match(html, /name="staff-account-filter"[^>]*autocomplete="off"[^>]*readonly/);
  context.bindStaffUserListControls(register);
  assert.equal(search.value, '');
  assert.ok(rows.every((row) => !row.hidden));
  // A later unfocused autofill event must not filter accounts either.
  search.value = 'admin'; search.oninput(); search.onchange();
  assert.equal(search.value, '');
  assert.equal(register.dataset.staffUserQuery, '');
  assert.equal(controls['[data-staff-user-count]'].textContent, '4 of 4 accounts shown');
});

test('focused manual search works, including admin, and reopening clears only the query', () => {
  const { context, register, controls, rows } = registerFixture();
  const search = controls['[data-staff-user-search]'];
  context.bindStaffUserListControls(register);
  search.onfocus();
  assert.equal(search.readOnly, false);
  search.value = 'admin'; search.oninput();
  assert.equal(register.dataset.staffUserQuery, 'admin', 'admin remains a valid intentional query');
  assert.ok(rows.every((row) => row.hidden));
  search.value = 'zoe'; search.oninput(); search.onblur();
  assert.equal(search.readOnly, true);
  assert.equal(register.dataset.staffUserQuery, 'zoe');
  assert.match(renderedFixture('school', { previous: register }), /data-staff-user-search value="zoe"/);
  controls['[data-staff-user-role]'].value = 'Teacher';
  context.resetStaffUserListSearch(register);
  context.applyStaffUserListControls(register);
  assert.equal(search.value, '');
  assert.equal(register.dataset.staffUserQuery, '');
  assert.equal(controls['[data-staff-user-role]'].value, 'Teacher');
  assert.equal(controls['[data-staff-user-count]'].textContent, '3 of 4 accounts shown');
  const navigation = admin.slice(admin.indexOf('function selectSection('), admin.indexOf('function renderMobileNavigation('));
  assert.match(navigation, /key === 'staffUsers' && activeSection !== key/);
  assert.ok(navigation.indexOf('resetStaffUserListSearch(') < navigation.indexOf('activeSection = key'));
});

test('controls stay with the Staff accounts tab and filter locally without fetching or replacing the list', () => {
  assert.match(renderSource, /key: 'accounts'[\s\S]*?nodes: panelEl\.querySelector\(':scope > \.staff-account-register'\)/);
  const bindings = admin.slice(admin.indexOf('function bindStaffUserEvents('), admin.indexOf("  ['FirstName', 'MiddleName', 'Surname'].forEach", admin.indexOf('function bindStaffUserEvents(')));
  assert.match(bindings, /bindStaffUserListControls\(staffRegister\)/);
  assert.match(helperSource, /search\.addEventListener\('input', updateSearch\)/);
  assert.match(helperSource, /data-staff-user-role.*data-staff-user-status.*data-staff-user-sort/);
  assert.match(helperSource, /applyStaffUserListControls\(register\)/);
  assert.doesNotMatch(helperSource, /staffFetch|fetch\(|innerHTML\s*=/);
  assert.match(css, /\.staff-user-list-toolbar\{position:static;display:grid/);
  assert.match(css, /@media \(max-width:520px\)\{\.staff-user-list-toolbar/);
});
