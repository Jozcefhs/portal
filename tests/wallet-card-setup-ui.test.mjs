import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const source = script.slice(script.indexOf('function walletAmountValue'), script.indexOf('function tuckShopLookupIcon'));
const buttonSource = script.slice(script.indexOf('async function runButtonAction'), script.indexOf('function setDashboardRefreshLoading'));

class Element {
  constructor(value = '') { this.value = value; this.disabled = false; this.hidden = false; this.isConnected = true; this.listeners = {}; this.attributes = {}; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  fire(name, extra = {}) { return this.listeners[name]?.({ preventDefault() {}, currentTarget: this, ...extra }); }
  getAttribute(name) { return this.attributes[name]; }
  focus() { this.focused = true; }
}

function walletUi({ account = { AccountRef: 'TEST/A', WalletCardId: 'CARD-A' }, respond } = {}) {
  let lookup, setup, workspace, loaded, empty;
  const requests = [];
  const context = {
    accountWalletSetupState: { account, accountRef: account?.AccountRef || '', cardId: '' },
    dashboardStatus: new Element(),
    clean: (value) => String(value ?? '').trim(), escapeHtml: (value) => String(value ?? ''), money: (value) => `₦${value || 0}`,
    staffLearnerTerms: () => ({ singular: 'student', Singular: 'Student' }),
    setStatus: (el, text, kind) => { el.textContent = text; el.kind = kind; },
    setButtonLoading: (button, loading) => { button.disabled = loading; button.attributes['aria-busy'] = String(loading); },
    FormData: class { constructor(form) { this.form = form; } entries() { return Object.entries(this.form.elements).filter(([, el]) => !el.disabled).map(([key, el]) => [key, el.value]); } },
    document: { getElementById: (id) => ({ accountWalletSetupWorkspace: workspace, accountWalletLookupForm: lookup, accountWalletSetupForm: setup })[id] },
    staffFetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url, options, body });
      const data = respond ? await respond(body) : { ok: true, account: { AccountRef: body.AccountRef, WalletCardId: body.action === 'save' ? body.WalletCardId : '' } };
      return { ok: data.ok, json: async () => data };
    }
  };
  vm.createContext(context);
  vm.runInContext(buttonSource + source, context);

  function form(values) {
    const result = new Element();
    result.elements = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, new Element(value)]));
    result.button = new Element();
    result.button.textContent = 'Submit';
    result.status = new Element();
    result.querySelector = (selector) => selector === '[data-wallet-status]' ? result.status : result.button;
    return result;
  }

  function mount() {
    if (lookup) lookup.isConnected = false;
    if (setup) setup.isConnected = false;
    const state = context.accountWalletSetupState;
    lookup = form({ AccountRef: state.account?.AccountRef || state.accountRef, WalletCardId: state.cardId });
    setup = state.account ? form({ AccountRef: state.account.AccountRef, WalletCardId: state.account.WalletCardId || '', WalletPin: '', WalletPinConfirm: '' }) : null;
    empty = new Element(); empty.hidden = Boolean(setup);
    loaded = setup ? { remove() { setup.isConnected = false; setup = null; loaded = null; } } : null;
    workspace = new Element();
    const mountedLookup = lookup, mountedSetup = setup;
    workspace.querySelector = (selector) => selector === '[data-wallet-loaded-account]' ? loaded : empty;
    workspace.querySelectorAll = () => [mountedLookup, mountedSetup].filter((form) => form?.isConnected).flatMap((form) => [...Object.values(form.elements), form.button]);
    context.bindAccountWalletSetupWorkspace();
  }
  context.refreshAccountWalletSetupWorkspace = mount;
  mount();
  return { context, requests, lookup: () => lookup, setup: () => setup, empty: () => empty };
}

test('an unassigned students card field never falls back to a previously entered lookup card', () => {
  const { context } = walletUi({ account: { AccountRef: 'TEST/B' } });
  context.accountWalletSetupState.cardId = 'PREVIOUS-CARD';
  const html = context.renderAccountWalletSetupWorkspace();
  const assignment = html.slice(html.indexOf('id="accountWalletSetupForm"'));
  assert.match(assignment, /name="WalletCardId" value=""/);
  assert.doesNotMatch(assignment, /PREVIOUS-CARD/);
});

test('changing admission number immediately discards the previous student and clears card lookup', async () => {
  const ui = walletUi();
  ui.lookup().elements.WalletCardId.value = 'CARD-A';
  const previousForm = ui.setup();
  ui.lookup().elements.AccountRef.value = 'TEST/B';
  ui.lookup().elements.AccountRef.fire('input');
  assert.equal(ui.lookup().elements.WalletCardId.value, '');
  assert.equal(ui.context.accountWalletSetupState.account, null);
  assert.equal(previousForm.isConnected, false);
  assert.equal(ui.empty().hidden, false);
  await ui.lookup().fire('submit');
  assert.equal(ui.requests[0].body.AccountRef, 'TEST/B');
  assert.equal(ui.requests[0].body.WalletCardId, '');
  assert.equal(ui.setup().elements.WalletCardId.value, '');
});

test('changing card lookup clears the old admission number rather than looking up two students', () => {
  const ui = walletUi();
  ui.lookup().elements.WalletCardId.value = 'CARD-B';
  ui.lookup().elements.WalletCardId.fire('input');
  assert.equal(ui.lookup().elements.AccountRef.value, '');
  assert.equal(ui.context.accountWalletSetupState.cardId, 'CARD-B');
  assert.equal(ui.setup(), null);
});

test('a failed lookup leaves no old card assignment form available to save', async () => {
  const ui = walletUi({ respond: () => ({ ok: false, message: 'Student not found.' }) });
  const previousForm = ui.setup();
  await ui.lookup().fire('submit');
  assert.equal(ui.context.accountWalletSetupState.account, null);
  assert.equal(ui.setup(), null);
  assert.equal(ui.lookup().status.textContent, 'Student not found.');
  await previousForm.fire('submit');
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.requests[0].body.action, 'lookup');
});

test('branch or session changes ignore a delayed lookup response from the old workspace', async () => {
  let finish;
  const ui = walletUi({ respond: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = ui.lookup().fire('submit');
  const nextState = { account: null, accountRef: 'NEW-BRANCH', cardId: '' };
  ui.context.accountWalletSetupState = nextState;
  finish({ ok: true, account: { AccountRef: 'TEST/A', WalletCardId: 'CARD-A' } });
  await pending;
  assert.equal(ui.context.accountWalletSetupState, nextState);
  assert.equal(nextState.account, null);
  assert.equal(ui.context.dashboardStatus.textContent, undefined);
});

test('saving a card needs the authenticated session but no extra password or new wallet PIN', async () => {
  const ui = walletUi();
  ui.setup().elements.WalletCardId.value = 'NEW-CARD';
  await ui.setup().fire('submit');
  assert.equal(ui.requests.length, 1);
  const { options, body } = ui.requests[0];
  assert.equal(options.credentials, 'same-origin');
  assert.equal(body.action, 'save');
  assert.equal(body.AccountRef, 'TEST/A');
  assert.equal(body.WalletCardId, 'NEW-CARD');
  assert.equal(body.WalletPin, '');
  assert.equal('WalletPinConfirm' in body, false);
  assert.equal('password' in body, false);
  assert.equal(ui.setup().elements.WalletCardId.value, 'NEW-CARD');
});

test('save blocks mismatched student identity and retains PIN confirmation checks', async () => {
  const ui = walletUi();
  ui.setup().elements.AccountRef.value = 'TEST/B';
  await ui.setup().fire('submit');
  assert.equal(ui.requests.length, 0);
  ui.setup().elements.AccountRef.value = 'TEST/A';
  ui.setup().elements.WalletPin.value = '1234';
  ui.setup().elements.WalletPinConfirm.value = '5678';
  await ui.setup().fire('submit');
  assert.equal(ui.requests.length, 0);
  assert.equal(ui.setup().elements.WalletPinConfirm.focused, true);
});

test('registration prevents repeated submits and changing students during an in-flight save', async () => {
  let finish;
  const ui = walletUi({ respond: () => new Promise((resolve) => { finish = resolve; }) });
  const originalForm = ui.setup();
  const pending = originalForm.fire('submit');
  assert.equal(ui.lookup().elements.AccountRef.disabled, true);
  await originalForm.fire('submit');
  await ui.lookup().fire('submit');
  assert.equal(ui.requests.length, 1);
  finish({ ok: true, account: { AccountRef: 'TEST/A', WalletCardId: 'CARD-A' } });
  await pending;
  assert.equal(ui.lookup().elements.AccountRef.disabled, false);
});

test('the wallet API still requires staff account permissions, scoped identity and duplicate-card protection', async () => {
  const api = await readFile(new URL('../functions/api/staff-wallet.js', import.meta.url), 'utf8');
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.match(api, /await requireStaffSession\(env, request\)/);
  assert.match(api, /allowedSections \|\| \[\]\)\.includes\('accounts'\)/);
  assert.match(backend, /This wallet card is already assigned to another student/);
  assert.match(backend, /saveWalletCard', 'recordWalletPurchase'/);
});
