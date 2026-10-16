import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, readdir } from 'node:fs/promises';
import { assertServiceWorkerCacheVersion } from './helpers/service-worker-cache-version.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const source = await read('js/app-dialogs.js');

function harness() {
  class Element {
    nodes = new Map(); listeners = {}; open = false; shows = 0; focuses = 0;
    classList = { toggle() {} };
    setAttribute() {} focus() { this.focuses++; } replaceChildren(...children) { this.children = children; }
    querySelector(selector) { if (!this.nodes.has(selector)) this.nodes.set(selector, new Element()); return this.nodes.get(selector); }
    querySelectorAll() { return [this.querySelector('close-x'), this.querySelector('close-cancel')]; }
    addEventListener(event, handler) { this.listeners[event] = handler; }
    showModal() { this.open = true; this.shows++; } close() { this.open = false; }
  }
  const listeners = {}, timers = new Map(), ids = new Map();
  let dialog, timerId = 0;
  const document = { body: { appendChild(node) { dialog = node; } }, createElement: () => new Element(),
    addEventListener: (name, handler) => { listeners[name] = handler; }, getElementById: id => ids.get(id) };
  const window = { requestAnimationFrame: callback => callback() };
  const context = { window, document, setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(source, context);
  const field = (label, form = {}, extra = {}) => ({ form, labels: [{ cloneNode: () => ({ textContent: label, querySelectorAll: () => [] }) }],
    validationMessage: 'Please fill out this field.', isConnected: true, willValidate: true, validity: { valid: false },
    closest: () => null, getAttribute: () => null, focuses: 0, focus() { this.focuses++; }, ...extra });
  let prevented = 0;
  const invalid = target => listeners.invalid({ target, preventDefault() { prevented++; } });
  const flush = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); };
  const close = method => {
    if (method === 'x') dialog.querySelector('close-x').listeners.click();
    else if (method === 'escape') dialog.listeners.cancel({ preventDefault() {} });
    else dialog.querySelector('form').listeners.submit({ preventDefault() {} });
  };
  return { dialog, api: window.DynamaxDialogs, field, invalid, flush, close, ids, context,
    prevented: () => prevented, items: () => Array.from(dialog.querySelector('.app-decision-details').querySelector('ol').children || [], item => item.textContent) };
}

for (const method of ['close', 'x', 'escape']) {
  test(`one submission with microtasks between invalid events closes with one ${method}`, async () => {
    const h = harness(), form = {};
    const fields = ['Saved clinic visit', 'Receiving hospital', 'Reason for referral'].map(label => h.field(label, form));
    for (const field of fields) { h.invalid(field); await Promise.resolve(); }
    h.invalid(fields[0]); // checkValidity followed by reportValidity must not duplicate it.
    assert.equal(h.dialog.shows, 0);
    h.flush();
    assert.equal(h.dialog.shows, 1);
    assert.equal(h.items().length, 3);
    assert.equal(h.prevented(), 4);
    h.invalid(fields[0]); h.flush(); // Keep the batch locked while visible.
    h.close(method); await Promise.resolve(); h.flush();
    assert.equal(h.dialog.open, false);
    assert.equal(h.dialog.shows, 1);
    assert.equal(fields[0].focuses, 1);
    assert.equal(fields[1].focuses, 0);
  });
}

test('an immediate second submission shows the updated errors, and a valid form shows none', async () => {
  const h = harness(), form = {}, first = h.field('First', form), second = h.field('Second', form);
  h.invalid(first); h.invalid(second); h.flush(); h.close(); await Promise.resolve();
  first.validity.valid = true;
  h.invalid(second); h.flush();
  assert.deepEqual(h.items(), ['Second: Please fill out this field.']);
  assert.equal(h.dialog.shows, 2); // Not suppressed by the normal alert cooldown.
  h.close(); await Promise.resolve();
  second.validity.valid = true;
  h.invalid(second); h.flush();
  assert.equal(h.dialog.open, false);
});

test('labels exclude dropdown choices, values and help text; accessible labels are supported', () => {
  const h = harness(), form = {}, select = h.field('', form);
  select.labels = [{ cloneNode: () => {
    let contents = 'Choose a visit PRIVATE VALUE Helpful hint';
    return { get textContent() { return `Saved clinic visit${contents}`; },
      querySelectorAll: selector => { assert.match(selector, /select/); assert.match(selector, /small/); return [{ remove() { contents = ''; } }]; } };
  } }];
  h.ids.set('hospital-label', { textContent: 'Receiving hospital' });
  const hospital = h.field('', form, { getAttribute: name => name === 'aria-labelledby' ? 'hospital-label' : null });
  const reason = h.field('', form, { getAttribute: name => name === 'aria-label' ? 'Reason' : null });
  const unnamed = h.field('', form, { name: 'Contact' });
  [select, hospital, reason, unnamed].forEach(h.invalid); h.flush();
  assert.deepEqual(h.items().map(item => item.split(':')[0]), ['Saved clinic visit', 'Receiving hospital', 'Reason', 'Contact']);
  assert.doesNotMatch(h.items().join(' '), /PRIVATE|Choose a visit|Helpful hint/);
});

test('different forms are separate; clearing cancels queued validation and focus restoration', async () => {
  const h = harness(), first = h.field('First'), second = h.field('Second');
  h.invalid(first); h.invalid(second); h.flush();
  assert.deepEqual(h.items(), ['First: Please fill out this field.']);
  h.close(); await Promise.resolve();
  assert.deepEqual(h.items(), ['Second: Please fill out this field.']);
  assert.equal(first.focuses, 0); // Do not steal focus from another active dialogue.
  h.api.clear(); await Promise.resolve();
  assert.equal(h.dialog.open, false);
  assert.equal(second.focuses, 0);
  h.invalid(first); h.api.clear(); h.flush();
  assert.equal(h.dialog.open, false);
});

test('repeated-row fields are all listed, while one required radio group is listed once', () => {
  const h = harness(), form = {};
  const fields = [h.field('Quantity', form), h.field('Quantity', form),
    h.field('Payment method', form, { type: 'radio', name: 'method' }),
    h.field('Payment method', form, { type: 'radio', name: 'method' }),
    h.field('Unit cost', form, { validationMessage: 'Value must be greater than or equal to 0.' })];
  fields.forEach(h.invalid); h.flush();
  assert.equal(h.items().length, 4);
  assert.equal(h.items().filter(item => item.startsWith('Quantity:')).length, 2);
  assert.match(h.items()[3], /greater than or equal to 0/);
});

test('prompt validation is excluded and detached/disabled controls are dropped', () => {
  const h = harness();
  h.invalid(h.field('Prompt', {}, { closest: () => h.dialog }));
  assert.equal(h.prevented(), 0);
  h.invalid(h.field('Removed', {}, { isConnected: false }));
  h.invalid(h.field('Disabled', {}, { willValidate: false }));
  h.flush(); assert.equal(h.dialog.shows, 0);
});

test('installing the shared component twice does not register another validation listener', () => {
  const h = harness();
  vm.runInNewContext(source, h.context);
  h.invalid(h.field('Reason')); h.flush();
  assert.equal(h.dialog.shows, 1);
});

test('every top-level page with a form loads shared validation and dialogue styles', async () => {
  for (const name of await readdir(new URL('../', import.meta.url))) {
    if (!name.endsWith('.html')) continue;
    const html = await read(name);
    if (!/<form\b/i.test(html)) continue;
    assert.match(html, /js\/app-dialogs\.js\?v=20261016-grouped-form-validation/, name);
    assert.match(html, /css\/(?:style|app-dialogs)\.css/, name);
    assert.equal((html.match(/js\/app-dialogs\.js/g) || []).length, 1, name);
  }
  const sw = await read('sw.js');
  assertServiceWorkerCacheVersion(sw, 398);
  assert.match(sw, /\/css\/app-dialogs\.css/);
});
