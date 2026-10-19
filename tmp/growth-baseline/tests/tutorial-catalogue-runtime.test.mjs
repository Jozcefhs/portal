import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [catalogueSource, ownerSource, adminSource, parentSource, setupSource, homeworkSource, boardingSource] = await Promise.all([
  'tutorial-module-catalogue.js', 'plan-management.js', 'admin.js', 'parent-dashboard.js',
  'setup.js', 'teacher-homework.js', 'boarding-offerings.js'
].map((name) => readFile(new URL(`../js/${name}`, import.meta.url), 'utf8')));

function between(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing runtime boundary: ${start}`);
  return source.slice(first, last);
}

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.value = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  setAttribute(name, value) { this[name] = value; }
  querySelectorAll(selector) {
    assert.equal(selector, '[data-tutorial-storage-key]');
    return this.children.flatMap((child) => [
      ...(child.dataset.tutorialStorageKey ? [child] : []),
      ...child.querySelectorAll(selector)
    ]);
  }
}

function ownerHarness(catalog = {}) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element()
  };
  const edition = document.getElementById('ownerTutorialEdition');
  const list = document.getElementById('ownerTutorialLinksList');
  edition.value = 'school';
  const context = vm.createContext({ window: {}, document, URL, ownerTutorialEdition: edition, ownerTutorialLinksList: list });
  vm.runInContext(catalogueSource, context);
  vm.runInContext(`let ownerTutorialCatalog = null; let ownerTutorialCatalogReady = true;\n${between(ownerSource,
    'function tutorialCatalogDraft(', 'function platformPaymentMoney(')}\n${between(ownerSource,
    "ownerTutorialEdition?.addEventListener('change'", "document.getElementById('saveOwnerTutorials')")}`, context);
  context.initialCatalog = catalog;
  vm.runInContext('ownerTutorialCatalog = tutorialCatalogDraft(initialCatalog); renderOwnerTutorialLinks();', context);
  return {
    catalogue: context.window.DynamaxTutorialModuleCatalogue,
    fields: () => list.querySelectorAll('[data-tutorial-storage-key]'),
    switchEdition(value) { edition.value = value; edition.listeners.change(); },
    save: () => vm.runInContext('saveVisibleTutorialDraft()', context),
    snapshot: () => JSON.parse(vm.runInContext('JSON.stringify(ownerTutorialCatalog)', context)),
    setReady: (ready) => vm.runInContext(`ownerTutorialCatalogReady = ${ready}`, context)
  };
}

const schoolKeys = [
  'School Library', 'Parent Portal - Library', 'Teacher Homework', 'Academic Policies',
  'Timetable Generation', 'Online CBT Authoring', 'Student CBT', 'Android CBT', 'Boarding Offerings'
];
const sharedKeys = ['External Audit', 'Vendor Sales & Settlements'];

test('owner renders unique tutorial fields for each edition, including recent modules and features', () => {
  const ui = ownerHarness();
  assert.equal(new Set(ui.catalogue.map((row) => row.key)).size, ui.catalogue.length);
  assert.equal(new Set(ui.catalogue.map((row) => row.storageKey)).size, ui.catalogue.length);
  for (const edition of ['school', 'faith', 'organization']) {
    ui.switchEdition(edition);
    const fields = ui.fields();
    const keys = fields.map((input) => input.dataset.tutorialStorageKey);
    assert.ok(keys.length <= 64, 'Published tutorial maps must fit the server normalization limit');
    for (const key of sharedKeys) assert.ok(keys.includes(key), `${edition}: ${key}`);
    for (const key of schoolKeys) assert.equal(keys.includes(key), edition === 'school', `${edition}: ${key}`);
    assert.equal(fields.every((input) => input.value === ''), true, 'No invented tutorial URLs');
    assert.equal(new Set(fields.map((input) => input.id)).size, fields.length);
  }
});

test('saving and edition switching preserve hidden links while clearing blank fields and legacy aliases', () => {
  const original = { Editions: {
    school: { Links: {
      'Future Module': 'https://youtu.be/future', Donations: 'https://youtu.be/hidden',
      'School Library': 'https://youtu.be/library', library: 'https://youtu.be/legacy-library',
      'Teacher Homework': 'https://youtu.be/homework'
    } },
    faith: { Links: { 'Future Church Module': 'https://youtu.be/church-future', 'External Audit': 'https://youtu.be/church-audit' } }
  } };
  const ui = ownerHarness(original);
  const field = (key) => ui.fields().find((input) => input.dataset.tutorialStorageKey === key);
  field('School Library').value = '  ';
  field('Teacher Homework').value = ' https://youtu.be/updated-homework ';
  ui.switchEdition('faith');
  assert.equal(field('External Audit').value, 'https://youtu.be/church-audit');
  field('External Audit').value = 'https://youtu.be/updated-audit';
  ui.save();
  ui.switchEdition('school');
  assert.equal(field('School Library').value, '', 'Cleared legacy aliases must not reappear');
  ui.save();
  const saved = ui.snapshot();
  assert.deepEqual(saved.Editions.school.Links, {
    'Future Module': 'https://youtu.be/future', Donations: 'https://youtu.be/hidden',
    'Teacher Homework': 'https://youtu.be/updated-homework'
  });
  assert.deepEqual(saved.Editions.faith.Links, {
    'Future Church Module': 'https://youtu.be/church-future', 'External Audit': 'https://youtu.be/updated-audit'
  });
  assert.equal(original.Editions.school.Links['School Library'], 'https://youtu.be/library', 'Draft must not mutate its source');
});

test('switching editions before a successful load cannot replace a saved draft with disabled fields', () => {
  const ui = ownerHarness({ Editions: { school: { Links: { Accounts: 'https://youtu.be/accounts' } } } });
  ui.fields().find((input) => input.dataset.tutorialStorageKey === 'Accounts').value = '';
  ui.setReady(false);
  ui.switchEdition('faith');
  assert.equal(ui.snapshot().Editions.school.Links.Accounts, 'https://youtu.be/accounts');
});

function staffHarness() {
  const context = vm.createContext({
    URL, activeSection: 'academics', academicManagementView: 'classrooms',
    academicManagementTaskViews: { timetable: 'builder' },
    dashboardData: { tutorials: { links: {}, channelUrl: 'https://www.youtube.com/@school' } },
    staffTabLabel: (_key, fallback) => fallback
  });
  vm.runInContext(between(adminSource, 'const tutorialStorageKeys =', 'const schoolOnlyWebSections ='), context);
  vm.runInContext(between(adminSource, 'function clean(', 'function canManageOrganisationSettings('), context);
  return context;
}

test('new staff module links resolve using the published keys', () => {
  const ui = staffHarness();
  for (const [section, key] of [['library', 'School Library'], ['externalAudit', 'External Audit'], ['vendorSettlements', 'Vendor Sales & Settlements']]) {
    ui.dashboardData.tutorials.links = { [key]: `https://youtu.be/${section}`, [section]: 'https://youtu.be/legacy-alias' };
    assert.equal(ui.tutorialDestination(section).moduleUrl, `https://youtu.be/${section}`);
  }
});

test('academic subfeatures select specific tutorials and fall back to Academic Management', () => {
  const ui = staffHarness();
  ui.dashboardData.tutorials.links = {
    'Academic Management': 'https://youtu.be/academics',
    'Timetable Generation': 'https://youtu.be/timetable',
    'Online CBT Authoring': 'https://youtu.be/authoring',
    'Student CBT': 'https://youtu.be/student'
  };
  assert.equal(ui.tutorialDestination().moduleUrl, 'https://youtu.be/academics');
  ui.academicManagementView = 'timetable';
  assert.equal(ui.tutorialDestination().moduleUrl, 'https://youtu.be/academics');
  ui.academicManagementTaskViews.timetable = 'generator';
  assert.equal(ui.tutorialDestination().moduleUrl, 'https://youtu.be/timetable');
  ui.dashboardData.tutorials.links['Timetable Generation'] = 'https://example.com/unsafe';
  assert.equal(ui.tutorialDestination().moduleUrl, 'https://youtu.be/academics');
  ui.academicManagementView = 'cbt';
  assert.equal(ui.tutorialDestination().moduleUrl, 'https://youtu.be/authoring');
  assert.equal(ui.tutorialDestination('teacherHomework').moduleUrl, 'https://youtu.be/academics');
  ui.dashboardData.tutorials.links['Teacher Homework'] = 'https://youtu.be/homework';
  assert.equal(ui.tutorialDestination('teacherHomework').moduleUrl, 'https://youtu.be/homework');
  ui.dashboardData.tutorials.links.Accounts = 'https://youtu.be/accounts';
  assert.equal(ui.tutorialDestination('boardingOfferings').moduleUrl, 'https://youtu.be/accounts');
  ui.dashboardData.tutorials.links['Boarding Offerings'] = 'https://youtu.be/boarding';
  assert.equal(ui.tutorialDestination('boardingOfferings').moduleUrl, 'https://youtu.be/boarding');
});

test('parent library view uses its own published tutorial and retains channel fallback', () => {
  const context = vm.createContext({
    URL, window: { SCHOOL_PROFILE: {} }, activeDashboardView: 'library',
    requiredParentPasswordDialog: null, changeParentPasswordDialog: null,
    parentNotificationDialog: null, parentNotificationPanel: null, parentOnboardingPanel: null,
    dashboardContent: { hidden: false }, dashboard: { tutorials: { links: {
      'Parent Portal - Library': 'https://youtu.be/parent-library', 'School Library': 'https://youtu.be/staff-library'
    }, channelUrl: 'https://www.youtube.com/@school' } }
  });
  vm.runInContext(between(parentSource, 'const parentTutorialContexts =', 'function newIdempotencyKey('), context);
  vm.runInContext(between(parentSource, 'function safeYouTubeTutorialUrl(', 'function updateParentTutorialControl('), context);
  assert.equal(context.parentTutorialDestination().operationUrl, 'https://youtu.be/parent-library');
  delete context.dashboard.tutorials.links['Parent Portal - Library'];
  assert.equal(context.parentTutorialDestination().operationUrl, '');
  assert.equal(context.parentTutorialDestination().channelUrl, 'https://www.youtube.com/@school');
});

test('academic policy tutorial uses published links and safe parent-module/channel fallbacks', async () => {
  const heading = new Element();
  const opened = [], requests = [], alerts = [];
  let completed = 0;
  let profile = { TutorialLinks: {
    'Academic Policies': 'https://youtu.be/policies', 'Academic Management': 'https://youtu.be/academics'
  }, TutorialChannelUrl: 'https://www.youtube.com/@school' };
  const context = vm.createContext({
    URL, academicPolicySection: { querySelector: () => heading }, document: { createElement: () => new Element() },
    window: {
      open: (...args) => opened.push(args), DynamaxDialogs: { alert: async (value) => alerts.push(value) },
      DynamaxActionFeedback: { begin: () => true, end: () => { completed++; } }
    },
    fetch: async (...args) => { requests.push(args); return { ok: true, json: async () => ({ ok: true, profile }) }; }
  });
  vm.runInContext(between(setupSource, 'let academicPolicyTutorialUrl =', 'const settingsTerminology ='), context);
  context.installAcademicPolicyTutorial();
  const button = heading.children[0];
  assert.equal(button.type, 'button');
  await context.preloadAcademicPolicyTutorial();
  const openedSynchronously = button.listeners.click({ currentTarget: button });
  assert.equal(opened.length, 1, 'Cached destination opens during the click, before any await');
  await openedSynchronously;
  assert.deepEqual(requests, [['/api/settings']], 'Only the public published catalogue is read; no settings write or password is sent');
  assert.deepEqual(opened[0], ['https://youtu.be/policies', '_blank', 'noopener,noreferrer']);
  profile.TutorialLinks['Academic Policies'] = 'javascript:alert(1)';
  assert.equal(context.academicPolicyTutorialDestination(profile), 'https://youtu.be/academics');
  profile.TutorialLinks = '{}';
  assert.equal(context.academicPolicyTutorialDestination(profile), 'https://www.youtube.com/@school');
  profile = {};
  await context.preloadAcademicPolicyTutorial();
  await button.listeners.click({ currentTarget: button });
  assert.equal(alerts[0].title, 'Tutorial not published yet');
  assert.equal(opened.length, 1);
  assert.equal(completed, 1);
});

test('academic tutorial retry requires a new click before opening and never blocks settings unlock', { timeout: 1000 }, async () => {
  const opened = [], alerts = [];
  let fail = true;
  const context = vm.createContext({
    URL, window: {
      open: (url) => opened.push(url), DynamaxDialogs: { alert: async (value) => alerts.push(value) },
      DynamaxActionFeedback: { begin: () => true, end: () => {} }
    },
    fetch: async () => {
      if (fail) throw new Error('Offline');
      return { ok: true, json: async () => ({ ok: true, profile: { TutorialLinks: { 'Academic Policies': 'https://youtu.be/policies' } } }) };
    }
  });
  vm.runInContext(between(setupSource, 'let academicPolicyTutorialUrl =', 'const settingsTerminology ='), context);
  await context.preloadAcademicPolicyTutorial();
  assert.equal(opened.length, 0);
  fail = false;
  await context.openAcademicPolicyTutorial({ currentTarget: {} });
  assert.equal(alerts[0].title, 'Tutorial ready');
  assert.equal(opened.length, 0, 'Async reload must not open a mobile popup');
  const click = context.openAcademicPolicyTutorial({ currentTarget: {} });
  assert.equal(opened[0], 'https://youtu.be/policies');
  await click;

  let profileApplied = false, preloaded = false;
  const settings = vm.createContext({
    settingsScopeField: { value: 'organisation' }, settingsBranchField: { value: '' }, activeSettingsEdition: 'school',
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, profile: { SchoolName: 'Example' } }) }),
    applyProfile: () => { profileApplied = true; }, loadAcademicPolicy: async () => {},
    preloadAcademicPolicyTutorial: () => { preloaded = true; return new Promise(() => {}); }, setStatus: () => {}
  });
  vm.runInContext(between(setupSource, 'async function loadProfile(', "setupLoginForm.addEventListener('submit'"), settings);
  const loaded = await settings.loadProfile('password');
  assert.equal(loaded.SchoolName, 'Example');
  assert.equal(profileApplied, true);
  assert.equal(preloaded, true, 'Optional preload starts without delaying settings unlock');
});

test('homework and boarding dialogs expose tutorial callbacks without changing operation permissions', async () => {
  class Dialog extends Element {
    constructor() { super(); this.nodes = new Map(); this.isConnected = true; }
    querySelector(selector) {
      if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
      return this.nodes.get(selector);
    }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
  }
  const dialogs = [];
  const document = {
    createElement: (tag) => tag === 'dialog' ? new Dialog() : new Element(),
    getElementById: () => null, body: { append: (dialog) => dialogs.push(dialog) }
  };
  const context = vm.createContext({ window: {}, document });
  vm.runInContext(homeworkSource, context);
  vm.runInContext(boardingSource, context);
  let tutorials = 0;
  const openTutorial = () => { tutorials++; };
  const staffFetch = async () => { throw new Error('Offline'); };
  await context.window.DynamaxTeacherHomework.open({ staffFetch, branchId: 'main', schoolSection: 'primary', openTutorial });
  const homeworkButton = dialogs[0].querySelector('.teacher-homework-heading > div').children[0];
  assert.equal(homeworkButton.type, 'button', 'Tutorial button must not submit or close the homework form');
  homeworkButton.listeners.click();
  await context.window.DynamaxBoardingOfferings.open({ fetch: staffFetch, user: { edition: 'school', role: 'Teacher', allowedSections: [] }, openTutorial });
  assert.equal(dialogs.length, 1, 'Tutorial wiring must not bypass boarding access checks');
  await context.window.DynamaxBoardingOfferings.open({ fetch: staffFetch, user: { edition: 'school', role: 'Accounts Officer', allowedSections: ['accounts'] }, openTutorial });
  const boardingButton = dialogs[1].querySelector('.boarding-offering-heading > div').children[0];
  assert.equal(boardingButton.type, 'button');
  boardingButton.listeners.click();
  assert.equal(tutorials, 2);
});
