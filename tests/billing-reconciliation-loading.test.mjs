import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const script = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const loading = script.slice(script.indexOf('function setButtonLoading('), script.indexOf('async function runButtonAction('));
const start = script.indexOf('  const reconcilePlans = async');
const flow = script.slice(start, script.indexOf("  panelEl.querySelector('[data-review-all-student-billing]')", start));

function buttonState() {
  const classes = new Set(), attributes = {};
  const button = {
    disabled: false, textContent: 'Reconcile reviewed account',
    classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => { attributes[name] = value; },
    getAttribute: (name) => attributes[name]
  };
  return { button, classes, attributes };
}

const plan = (reference = 'TEST/A') => ({ profile: { AccountRef: reference }, previewToken: 'reviewed-token' });
const result = (overrides = {}) => ({ message: 'Missing charges reconciled.', after: { recordedCredit: 14000, difference: 0 }, ...overrides });

function reconciliation(respond) {
  const ui = buttonState(), status = {}, requests = [];
  const context = {
    reconcileRequest: async (payload) => {
      requests.push(payload);
      assert.equal(ui.classes.has('is-loading'), true);
      assert.equal(ui.attributes['aria-busy'], 'true');
      return respond(payload);
    },
    setStatus: (target, message, type) => { target.textContent = message; target.type = type; },
    escapeHtml: (value) => String(value), money: (value) => `₦${value}`
  };
  const apply = vm.runInNewContext(`${loading}\n${flow}\nreconcilePlans`, context);
  return { ...ui, status, requests, apply };
}

function assertFinished(ui, label = /^Review complete/) {
  assert.equal(ui.classes.has('is-loading'), false, 'spinner must be removed');
  assert.equal(ui.attributes['aria-busy'], 'false', 'assistive technology must see completion');
  assert.equal(ui.button.disabled, true, 'the same financial submission must not become retryable');
  assert.match(ui.button.textContent, label);
}

test('completed single-account reconciliation clears the spinner and retains the result', async () => {
  const ui = reconciliation(() => result());
  await ui.apply([plan()], ui.button, ui.status);
  assertFinished(ui);
  assert.match(ui.status.innerHTML, /1 accounts reconciled; 0 require another review/);
  assert.match(ui.status.innerHTML, /Recorded credit: ₦14000; remaining charge difference: ₦0/);
  await ui.apply([plan()], ui.button, ui.status);
  assert.equal(ui.requests.length, 1, 'completed submission cannot post twice');
});

test('multi-account results and credit warnings complete without hiding failed outcomes or retrying', async () => {
  const ui = reconciliation(({ AccountRef }) => {
    if (AccountRef === 'TEST/B') throw new Error('Response lost — run a fresh review.');
    return result({ creditWarning: AccountRef === 'TEST/C' });
  });
  await ui.apply([plan(), plan('TEST/B'), plan('TEST/C')], ui.button, ui.status);
  assertFinished(ui);
  assert.match(ui.status.innerHTML, /2 accounts reconciled; 1 require another review; 1 credit-allocation warnings/);
  assert.match(ui.status.innerHTML, /Response lost/);
  assert.equal(ui.requests.length, 3);
});

test('all failed responses still clear loading and require a new preview rather than resubmitting', async () => {
  const ui = reconciliation(() => { throw new Error('Request timed out.'); });
  await ui.apply([plan()], ui.button, ui.status);
  assertFinished(ui);
  assert.match(ui.status.innerHTML, /0 accounts reconciled; 1 require another review/);
  await ui.apply([plan()], ui.button, ui.status);
  assert.equal(ui.requests.length, 1);
});

test('an unexpected result-rendering error clears loading without implying the posting did not commit', async () => {
  const ui = reconciliation(() => ({ message: 'Saved, but result summary missing.' }));
  await ui.apply([plan()], ui.button, ui.status);
  assertFinished(ui, /^Stopped/);
  assert.match(ui.status.textContent, /Some changes may already be saved\. Load a fresh preview/);
  assert.equal(ui.status.type, 'bad');
});

test('a second click during the pending request does not post the same reviewed account twice', async () => {
  let finish;
  const ui = reconciliation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = ui.apply([plan()], ui.button, ui.status);
  await ui.apply([plan()], ui.button, ui.status);
  assert.equal(ui.requests.length, 1);
  finish(result());
  await pending;
  assertFinished(ui);
});

test('single Boarding Wear reversal also ends the loading state while keeping the posted action disabled', async () => {
  const marker = "content.querySelector('[data-post-boardwear-reversal]')?.addEventListener('click', async (event) => {";
  const handlerStart = script.indexOf(marker) + marker.length;
  const body = script.slice(handlerStart, script.indexOf('\n    });', handlerStart));
  const ui = buttonState(), status = {}, requests = [];
  const handler = vm.runInNewContext(`${loading}\n(async (event) => {${body}\n})`, {
    content: { querySelector: (selector) => selector === '[data-reversal-reason]' ? { value: 'Reviewed correction' } : status },
    plan: { amount: 60000, outstandingRemoved: 0, releasedCredit: 60000, profile: { AccountRef: 'TEST/A' }, previewToken: 'token' },
    reference: 'TEST/A',
    window: { DynamaxDialogs: { confirm: async () => true } },
    reconcileRequest: async (payload) => { requests.push(payload); return { message: 'Posted.', summary: { CreditBalance: 60000, OutstandingBalance: 0 } }; },
    setStatus: (target, message) => { target.textContent = message; }, money: (value) => String(value)
  });
  await handler({ currentTarget: ui.button });
  assertFinished(ui, /^Posted/);
  assert.match(status.textContent, /Posted\. Available credit: 60000; outstanding: 0/);
  assert.equal(requests.length, 1);
});
