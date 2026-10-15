import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../js/procurement.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../css/procurement.css', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const parseResponse = runInNewContext(`${admin.slice(admin.indexOf('async function procurementResponseResult('), admin.indexOf('function procurementInventoryFields('))}\nprocurementResponseResult`, {
  receivedResponseError: message => Object.assign(new Error(message), { responseReceived: true })
});

function element() {
  return { innerHTML: '', textContent: '', value: '', disabled: false, isConnected: true, dataset: {}, elements: {}, children: [],
    listeners: new Map(), classList: { toggle() {} }, attributes: {},
    addEventListener(type, fn) { this.listeners.set(type, fn); }, removeEventListener(type) { this.listeners.delete(type); },
    async fire(type, target = this) { return this.listeners.get(type)?.({ target, currentTarget: this, preventDefault() {} }); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute(name, value) { this.attributes[name] = value; }, contains() { return true; }, focus() {},
    append(node) { this.children.push(node); node.parentNode = this; }, insertAdjacentHTML(_position, markup) { this.innerHTML += markup; }, remove() { this.isConnected = false; if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }, close() {}, showModal() {}, reportValidity() { return true; }
  };
}
function fixture(overrides = {}, options = {}) {
  const nodes = new Map(['[data-proc-status]', '[data-proc-count]', '[data-proc-body]'].map(selector => [selector, element()]));
  const root = element(); root.querySelector = selector => nodes.get(selector); root.querySelectorAll = () => [];
  const modalForm = element(); const progress = element();
  const importNodes = new Map(['[data-proc-import-csv]', '[data-proc-import-results]', '[data-proc-import-confirm]', 'button[type="submit"]', '[data-proc-import-preview]', '[data-proc-import-file]', '[data-proc-import-template]'].map(selector => [selector, element()]));
  const pickerNodes = new Map(['[data-proc-pick-search]', '[data-proc-choices]', '[data-proc-pick-count]', '[data-proc-pick-status]', '[data-proc-pick-all]', '[data-proc-pick-clear]', '[data-proc-pick-empty]', '[data-proc-lines]'].map(selector => [selector, element()]));
  const choices = pickerNodes.get('[data-proc-choices]'), holder = pickerNodes.get('[data-proc-lines]');
  const decode = text => text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  let choiceMarkup = '';
  Object.defineProperty(choices, 'innerHTML', { get: () => choiceMarkup, set(value) {
    choiceMarkup = value;
    choices.children = [...value.matchAll(/data-proc-pick-item="([^"]*)"/g)].map(match => ({ ...element(), checked: false,
      dataset: { procPickItem: decode(match[1]) }, matches: selector => selector === '[data-proc-pick-item]' }));
  } });
  choices.querySelectorAll = () => choices.children;
  const makeLine = () => {
    const line = element(), controls = new Map(['[data-line-quantity]', '[data-line-inventory]', '[data-remove-line]'].map(selector => [selector, element()]));
    let markup = '';
    Object.defineProperty(line, 'innerHTML', { get: () => markup, set(value) {
      markup = value; controls.get('[data-line-quantity]').value = decode(value.match(/data-line-quantity[^>]*value="([^"]*)"/)?.[1] || '');
    } });
    line.querySelector = selector => controls.get(selector); line.querySelectorAll = () => [...controls.values()];
    return line;
  };
  modalForm.querySelector = selector => importNodes.get(selector) || pickerNodes.get(selector) || progress;
  modalForm.querySelectorAll = selector => selector === '[data-proc-import-source]' ? [importNodes.get('[data-proc-import-csv]'), importNodes.get('[data-proc-import-file]')] : selector === 'button, input, select, textarea' ? [...importNodes.values(), ...pickerNodes.values(), ...choices.children, ...holder.children.flatMap(line => line.querySelectorAll()), modalForm.elements.Department] : [];
  modalForm.elements = { Department: element(), ItemCode: element(), Discrepancy: { checked: false } };
  const modal = element(); modal.querySelector = () => modalForm;
  const downloads = [], blobs = new Map();
  const document = { createElement: tag => tag === 'a'
    ? { ...element(), click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); } } : tag === 'div' ? makeLine() : modal, body: { append() {} } };
  const window = { crypto: webcrypto };
  runInNewContext(source, { window, document, AbortController, Intl, Date, setTimeout, clearTimeout, Blob,
    URL: { createObjectURL(blob) { const url = `blob:fixture-${blobs.size}`; blobs.set(url, blob); return url; }, revokeObjectURL(url) { blobs.delete(url); } },
    FormData: class { constructor(form) { this.values = Object.entries(form.values || {}); } [Symbol.iterator]() { return this.values[Symbol.iterator](); } } });
  const data = { ok: true, capabilities: { canManage: true, canApprove: true, canReviewRequests: true, canRequest: true, canReceive: true, canConfigure: true, canOverride: true }, schoolSection: 'Secondary', schoolSections: ['Primary', 'Secondary'],
    items: [{ ItemId: 'rice', ItemName: 'Rice <script>', Unit: 'kg', Quantity: 90, ReorderLevel: 100 }],
    departments: [{ Key: 'kitchen', Name: 'Kitchen' }],
    departmentInventory: [{ InventoryId: 'rice-dept', Department: 'kitchen', SchoolSection: 'Secondary', ItemName: 'Rice', Unit: 'kg', Quantity: 20 }],
    requests: [{ RequisitionId: 'REQ-1', Department: 'kitchen', Status: 'PENDING', Notes: 'Need rice', Revision: 1, Lines: [{ ItemId: 'rice', ItemName: 'Rice', Quantity: 10, InventoryId: 'rice-dept' }] }],
    purchases: [], transfers: [], settings: { Enabled: false, Revision: 0 }, ...overrides };
  const calls = [];
  let fail, listFailure, lookupResult, recordsResult, detailResult, previewResult;
  const controller = window.DynamaxProcurement.mount(root, { ...options, request: async (action, payload) => {
    calls.push({ action, payload: plain(payload) });
    if (action === 'list') { if (listFailure) throw listFailure; return data; }
    if (fail) throw fail;
    if (action === 'lookupinventory') return lookupResult || { ok: true, departmentInventory: [] };
    if (action === 'records') return recordsResult || { ok: true, records: [], paging: { mode: payload.Mode, hasMore: false, nextCursor: null } };
    if (action === 'recorddetail') return { ok: true, record: detailResult };
    if (action === 'previewitemimport') return previewResult;
    return { ok: true, message: 'Saved.' };
  } });
  const action = (value, id = '') => ({ dataset: { procAction: value, id }, closest() { return this; } });
  const tab = value => ({ dataset: { procTab: value }, closest() { return this; } });
  return { ui: window.DynamaxProcurement, root, nodes, calls, data, controller, modal, modalForm, progress, action, tab, importNodes, downloads, pickerNodes, preview: result => { previewResult = result; }, fail: error => { fail = error; }, failList: error => { listFailure = error; }, lookup: result => { lookupResult = result; }, records: result => { recordsResult = result; }, detail: record => { detailResult = record; } };
}

async function pickerFixture(overrides = {}) {
  const view = fixture({ items: [
    { ItemId: 'soap', ItemName: 'Soap <sample>', ItemCode: 'SOAP', Unit: 'bottles', Quantity: 12 },
    { ItemId: 'rice', ItemName: 'Rice', ItemCode: 'RICE', Unit: 'kg', Quantity: 90 },
    { ItemId: 'vendor', ItemName: 'Vendor-owned item', Unit: 'kg', Quantity: 10, VendorId: 'vendor' }
  ], departmentInventory: [
    { InventoryId: 'rice-kitchen', Department: 'kitchen', SchoolSection: 'Secondary', ItemName: 'Rice', Unit: 'kg', ProcurementItemId: 'rice', Quantity: 1 },
    { InventoryId: 'soap-kitchen', Department: 'kitchen', SchoolSection: 'Secondary', ItemName: 'Soap', Unit: 'bottles', ProcurementItemId: 'soap', Quantity: 2 },
    { InventoryId: 'soap-clinic', Department: 'clinic', SchoolSection: 'Secondary', ItemName: 'Soap', Unit: 'bottles', ProcurementItemId: 'soap', Quantity: 3 },
    { InventoryId: 'soap-primary', Department: 'kitchen', SchoolSection: 'Primary', ItemName: 'Soap', Unit: 'bottles', Quantity: 4 },
    { InventoryId: 'soap-wrong-unit', Department: 'kitchen', SchoolSection: 'Secondary', ItemName: 'Soap', Unit: 'pcs', Quantity: 5 },
    { InventoryId: 'soap-wrong-link', Department: 'kitchen', SchoolSection: 'Secondary', ItemName: 'Soap', Unit: 'bottles', ProcurementItemId: 'other', Quantity: 6 },
    { InventoryId: 'soap-vendor', Department: 'kitchen', SchoolSection: 'Secondary', ItemName: 'Soap', Unit: 'bottles', VendorId: 'vendor', Quantity: 7 }
  ], ...overrides }, { branchId: 'main', department: 'kitchen' });
  await tick(); view.modalForm.elements.Department.value = 'kitchen';
  view.modalForm.values = { Department: 'kitchen', NeededBy: '', Notes: 'Resupply request' };
  await view.root.fire('click', view.action('newrequest'));
  const picker = selector => view.pickerNodes.get(selector), choices = picker('[data-proc-choices]'), holder = picker('[data-proc-lines]');
  return { ...view, picker, choices, holder,
    async choose(itemId, checked = true) { const input = choices.children.find(row => row.dataset.procPickItem === itemId); assert.ok(input); input.checked = checked; await choices.fire('change', input); },
    async searchItems(value) { picker('[data-proc-pick-search]').value = value; await picker('[data-proc-pick-search]').fire('input'); } };
}

test('supply request checklist is searchable, alphabetical and excludes vendor stock', async t => {
  const view = await pickerFixture(); t.after(() => view.controller.destroy());
  assert.match(view.modal.innerHTML, /Choose items/); assert.doesNotMatch(view.modal.innerHTML, /Add another item/);
  assert.equal(view.modalForm.className, 'procurement-form procurement-request-form');
  assert.equal(view.modal.className, 'procurement-dialog procurement-request-dialog');
  assert.deepEqual(view.choices.children.map(row => row.dataset.procPickItem), ['rice', 'soap']);
  assert.match(view.choices.innerHTML, /Soap &lt;sample&gt;/); assert.doesNotMatch(view.choices.innerHTML, /<sample>|Vendor-owned/);
  assert.match(view.choices.innerHTML, /90 available centrally/);
  await view.searchItems('bottles'); assert.deepEqual(view.choices.children.map(row => row.dataset.procPickItem), ['soap']);
  await view.searchItems('rIcE'); assert.deepEqual(view.choices.children.map(row => row.dataset.procPickItem), ['rice']);
  await view.searchItems('not-present'); assert.match(view.choices.innerHTML, /No matching/);
  assert.equal(view.picker('[data-proc-pick-all]').disabled, true);
});

test('selecting matches adds independent quantity and destination lines and submits all selected items', async t => {
  const view = await pickerFixture(); t.after(() => view.controller.destroy());
  await view.picker('[data-proc-pick-all]').fire('click'); assert.equal(view.holder.children.length, 2);
  assert.match(view.picker('[data-proc-pick-count]').textContent, /2 of 20 items selected/);
  for (const [i, target] of ['rice-kitchen', 'soap-kitchen'].entries()) {
    view.holder.children[i].querySelector('[data-line-quantity]').value = String(i + 2);
    view.holder.children[i].querySelector('[data-line-inventory]').value = target;
  }
  await view.modalForm.fire('submit');
  const sent = view.calls.find(call => call.action === 'request');
  assert.equal(sent.payload.Department, 'kitchen'); assert.equal(sent.payload.SchoolSection, 'Secondary');
  assert.deepEqual(sent.payload.Lines, [{ ItemId: 'rice', Quantity: 2, InventoryId: 'rice-kitchen' }, { ItemId: 'soap', Quantity: 3, InventoryId: 'soap-kitchen' }]);
  assert.equal(view.calls.at(-1).action, 'list');
});

test('searching and reselecting preserve entered quantities without duplicate lines', async t => {
  const view = await pickerFixture(); t.after(() => view.controller.destroy());
  await view.choose('soap'); const line = view.holder.children[0];
  line.querySelector('[data-line-quantity]').value = '4.125'; line.querySelector('[data-line-inventory]').value = 'soap-kitchen';
  await view.searchItems('rice'); await view.choose('rice'); await view.searchItems('soap');
  assert.equal(view.choices.children[0].checked, true); assert.equal(view.holder.children[0], line);
  assert.equal(line.querySelector('[data-line-quantity]').value, '4.125');
  await view.picker('[data-proc-pick-all]').fire('click'); assert.equal(view.holder.children.length, 2);
  await view.choose('soap', false); assert.equal(view.holder.children.length, 1);
  await view.choose('soap'); const restored = view.holder.children[1];
  assert.equal(restored.querySelector('[data-line-quantity]').value, '4.125'); assert.equal(restored.querySelector('[data-line-inventory]').value, 'soap-kitchen');
  await restored.querySelector('[data-remove-line]').fire('click'); assert.equal(view.choices.children[0].checked, false);
  await view.picker('[data-proc-pick-clear]').fire('click'); assert.equal(view.holder.children.length, 0);
  await view.modalForm.fire('submit'); assert.ok(!view.calls.some(call => call.action === 'request'));
  assert.match(view.picker('[data-proc-pick-status]').textContent, /Select at least one/);
});

test('checklist enforces 20-item limit without partially selecting oversized matches', async t => {
  const items = Array.from({ length: 21 }, (_, i) => ({ ItemId: `item${i}`, ItemName: `Item ${i}`, Unit: 'pcs', Quantity: 1 }));
  const view = await pickerFixture({ items }); t.after(() => view.controller.destroy());
  await view.picker('[data-proc-pick-all]').fire('click'); assert.equal(view.holder.children.length, 0);
  assert.match(view.picker('[data-proc-pick-status]').textContent, /No selection was changed/);
  for (let i = 0; i < 20; i++) await view.choose(`item${i}`);
  assert.equal(view.holder.children.length, 20); assert.equal(view.choices.children.find(row => row.dataset.procPickItem === 'item20').disabled, true);
  await view.choose('item20'); assert.equal(view.holder.children.length, 20);
  await view.choose('item0', false); assert.equal(view.choices.children.find(row => row.dataset.procPickItem === 'item20').disabled, false);
  await view.choose('item20'); assert.equal(view.holder.children.length, 20);
});

test('changing receiving department clears destinations, including deselected drafts, without losing quantities', async t => {
  const view = await pickerFixture(); t.after(() => view.controller.destroy());
  await view.choose('soap'); const first = view.holder.children[0], target = first.querySelector('[data-line-inventory]');
  assert.match(target.innerHTML, /soap-kitchen/); assert.doesNotMatch(target.innerHTML, /soap-clinic|soap-primary|soap-wrong-unit|soap-wrong-link|soap-vendor/);
  first.querySelector('[data-line-quantity]').value = '5'; target.value = 'soap-kitchen';
  view.modalForm.elements.Department.value = 'clinic'; await view.modalForm.elements.Department.fire('change');
  assert.equal(target.value, ''); assert.match(target.innerHTML, /soap-clinic/); assert.doesNotMatch(target.innerHTML, /soap-kitchen/);
  assert.equal(first.querySelector('[data-line-quantity]').value, '5');
  await view.modalForm.fire('submit'); assert.ok(!view.calls.some(call => call.action === 'request'));
  target.value = 'soap-clinic'; await view.choose('soap', false);
  view.modalForm.elements.Department.value = 'kitchen'; await view.modalForm.elements.Department.fire('change'); await view.choose('soap');
  assert.equal(view.holder.children[0].querySelector('[data-line-inventory]').value, '');
  assert.equal(view.holder.children[0].querySelector('[data-line-quantity]').value, '5');
});

test('multi-item requests retain the original idempotency key after a lost response', async t => {
  const view = await pickerFixture(); t.after(() => view.controller.destroy()); await view.choose('rice');
  const line = view.holder.children[0]; line.querySelector('[data-line-quantity]').value = '2'; line.querySelector('[data-line-inventory]').value = 'rice-kitchen';
  view.fail(new Error('Connection lost')); await view.modalForm.fire('submit'); const original = view.calls.at(-1);
  await view.modalForm.fire('submit'); assert.deepEqual(view.calls.at(-1), original);
  line.querySelector('[data-line-quantity]').value = '3'; await view.modalForm.fire('submit'); assert.deepEqual(view.calls.at(-1), original);
  assert.match(view.progress.textContent, /before changing or resubmitting/);
});

test('request lines require exact target inventory, positive amounts, unique items and a 20-line maximum', async () => {
  const view = fixture(); await tick();
  const lines = view.ui.lineValues([{ ItemId: 'rice', Quantity: '2.5', InventoryId: 'department-row' }], false, true);
  assert.deepEqual(plain(lines), [{ ItemId: 'rice', Quantity: 2.5, InventoryId: 'department-row' }]);
  for (const value of ['', '-1', '0', 'Infinity', 'NaN', '1000000001']) assert.throws(() => view.ui.lineValues([{ ItemId: 'rice', Quantity: value }]));
  assert.throws(() => view.ui.lineValues([{ ItemId: 'rice', Quantity: 1 }], false, true), /matching department/);
  assert.throws(() => view.ui.lineValues([{ ItemId: 'rice', Quantity: 1 }, { ItemId: 'rice', Quantity: 2 }]), /once/);
  assert.throws(() => view.ui.lineValues(Array.from({ length: 21 }, (_, n) => ({ ItemId: String(n), Quantity: 1 }))), /1 and 20/);
  view.controller.destroy();
});

test('purchase lines explicitly record costs, including a valid zero-cost delivery', async () => {
  const view = fixture(); await tick();
  assert.deepEqual(plain(view.ui.lineValues([{ ItemId: 'rice', Quantity: '10', UnitCost: '0' }], true)), [{ ItemId: 'rice', Quantity: 10, UnitCost: 0 }]);
  assert.throws(() => view.ui.lineValues([{ ItemId: 'rice', Quantity: 1, UnitCost: '-1' }], true), /Unit cost/);
  view.controller.destroy();
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: procurement renders central stock, supply requests and capability-gated operations`, async () => {
    const view = fixture({ edition }); await tick();
    assert.match(view.root.innerHTML, /Supply requests/);
    assert.match(view.root.innerHTML, /Central stock/);
    assert.match(view.root.innerHTML, /Purchases/);
    assert.match(view.nodes.get('[data-proc-body]').innerHTML, /data-proc-action="reviewrequest"/);
    await view.root.fire('click', view.tab('stock'));
    assert.match(view.nodes.get('[data-proc-body]').innerHTML, /Rice &lt;script&gt;/);
    assert.match(view.nodes.get('[data-proc-count]').textContent, /1 of 1/);
    view.controller.destroy();
  });
}

test('department users cannot see procurement purchasing, review or configuration actions', async () => {
  const view = fixture({ capabilities: { canRequest: true, canReceive: true } }); await tick();
  assert.doesNotMatch(view.root.innerHTML, /data-proc-tab="purchases"|data-proc-tab="settings"/);
  assert.match(view.root.innerHTML, /Request supplies/);
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /data-proc-action="reviewrequest"|data-proc-action="issue"/);
  view.controller.destroy();
});

test('request review capability is distinct from purchase approval', async () => {
  const view = fixture({ capabilities: { canApprove: true } }); await tick();
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /data-proc-action="reviewrequest"/);
  view.controller.destroy();
});

test('read-only subscription removes all mutation actions, including branch configuration', async () => {
  const view = fixture({}, { readOnly: true }); await tick();
  assert.match(view.root.innerHTML, /Read-only access/);
  assert.doesNotMatch(view.root.innerHTML, /data-proc-action="newrequest"/);
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /data-proc-action="reviewrequest"/);
  await view.root.fire('click', view.tab('settings'));
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /data-proc-action="settings"/);
  view.controller.destroy();
});

test('vendor-owned stock is excluded from both central and department inventories', async () => {
  const view = fixture({ items: [{ ItemId: 'a', ItemName: 'Vincent product', VendorId: 'vincent' }, { ItemId: 'b', ItemName: 'Owned by Vendor', OwnershipType: 'Vendor' }], departmentInventory: [{ InventoryId: 'v', ItemName: 'Vendor rice', VendorId: 'v' }] }); await tick();
  await view.root.fire('click', view.tab('stock'));
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /Vincent product|Owned by Vendor/);
  assert.match(view.nodes.get('[data-proc-count]').textContent, /0 of 0/);
  await view.root.fire('click', view.tab('departments'));
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /Vendor rice/);
  view.controller.destroy();
});

test('receipt actions require permission on the particular delivery, not merely another department', async () => {
  const view = fixture({ transfers: [
    { TransferId: 'own', Department: 'kitchen', Status: 'IN_TRANSIT', CanReceive: true, Lines: [{ ItemId: 'rice', Quantity: 10, ReceivedQuantity: 3, ReturnedQuantity: 2 }] },
    { TransferId: 'other', Department: 'clinic', Status: 'IN_TRANSIT', CanReceive: false, Lines: [{ ItemId: 'drug', Quantity: 4 }] }
  ] }); await tick();
  await view.root.fire('click', view.tab('transfers'));
  const html = view.nodes.get('[data-proc-body]').innerHTML;
  assert.match(html, /data-proc-action="confirmreceipt" data-id="own"/);
  assert.doesNotMatch(html, /data-proc-action="confirmreceipt" data-id="other"/);
  assert.match(html, /2 returned centrally/);
  assert.match(html, /data-proc-action="returntransfer"/);
  view.controller.destroy();
});

test('search is empty by default and filters the active table with a result count', async () => {
  const view = fixture(); await tick();
  assert.match(view.root.innerHTML, /data-proc-search value=""/);
  await view.root.fire('input', { value: 'unmatched', matches: selector => selector === '[data-proc-search]' });
  assert.match(view.nodes.get('[data-proc-count]').textContent, /0 of 1/);
  view.controller.destroy();
});

test('school-section changes re-read authorised server data rather than mixing sections in the browser', async () => {
  const view = fixture(); await tick();
  await view.root.fire('change', { value: 'Primary', matches: selector => selector === '[data-proc-school-section]' });
  assert.deepEqual(view.calls.at(-1), { action: 'list', payload: { SchoolSection: 'Primary' } });
  view.controller.destroy();
});

test('failed school-section loads retain the previous label, records and form scope', async () => {
  const view = fixture(); await tick();
  const selector = { value: 'Primary', matches: value => value === '[data-proc-school-section]' };
  const records = view.nodes.get('[data-proc-body]').innerHTML;
  view.failList(new Error('Connection unavailable'));
  await view.root.fire('change', selector);
  assert.equal(selector.value, 'Secondary');
  assert.equal(view.nodes.get('[data-proc-body]').innerHTML, records);
  assert.match(view.nodes.get('[data-proc-status]').textContent, /Connection unavailable/);
  await view.root.fire('click', view.action('newdestination'));
  assert.match(view.modal.innerHTML, /School section: Secondary/);
  view.modalForm.values = { ItemId: 'rice', Department: 'kitchen', Price: '0' };
  await view.modalForm.fire('submit');
  assert.equal(view.calls.find(call => call.action === 'savedestination').payload.SchoolSection, 'Secondary');
  view.controller.destroy();
});

test('requests identify and escape the departmental destination as well as the central item', async () => {
  const view = fixture({ requests: [{ RequisitionId: 'REQ-1', Status: 'PENDING', Lines: [{ ItemId: 'rice', ItemName: 'Rice <central>', DepartmentItemName: 'Rice <department>', Quantity: 3 }] }] });
  await tick();
  assert.match(view.nodes.get('[data-proc-body]').innerHTML, /Rice &lt;central&gt;/);
  assert.match(view.nodes.get('[data-proc-body]').innerHTML, /Department item: Rice &lt;department&gt;/);
  view.controller.destroy();
});

test('older inventory lookup is read-only, scoped, deduplicated and cleared by a fresh scope load', async () => {
  const view = fixture(); await tick();
  view.lookup({ ok: true, departmentInventory: [
    { InventoryId: 'old-rice', Department: 'kitchen', SchoolSection: 'Secondary', ItemName: 'Old <rice>', Unit: 'kg', Quantity: 2 },
    { InventoryId: 'rice-dept', Department: 'kitchen', SchoolSection: 'Secondary', ItemName: 'Rice', Unit: 'kg', Quantity: 20 },
    { InventoryId: 'other-section', Department: 'kitchen', SchoolSection: 'Primary', ItemName: 'Wrong section' },
    { InventoryId: 'vendor', Department: 'kitchen', SchoolSection: 'Secondary', ItemName: 'Vendor item', OwnerType: 'Vendor' }
  ] });
  await view.root.fire('click', view.tab('departments'));
  assert.match(view.root.innerHTML, /Find older department item/);
  await view.root.fire('click', view.action('lookupinventory'));
  view.modalForm.values = { Department: 'kitchen', ItemName: 'Old rice', InventoryId: '' };
  await view.modalForm.fire('submit');
  assert.deepEqual(view.calls.at(-1), { action: 'lookupinventory', payload: { Department: 'kitchen', ItemName: 'Old rice', InventoryId: '', SchoolSection: 'Secondary' } });
  assert.match(view.nodes.get('[data-proc-body]').innerHTML, /Old &lt;rice&gt;/);
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /Wrong section|Vendor item/);
  assert.equal(view.nodes.get('[data-proc-count]').textContent, '2 of 2 records shown');
  view.data.schoolSection = 'Primary'; view.data.departmentInventory = [];
  await view.root.fire('change', { value: 'Primary', matches: value => value === '[data-proc-school-section]' });
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /Old &lt;rice&gt;/);
  view.controller.destroy();
});

test('active work remains the default and history load-more uses readonly scoped cursors with truthful loaded counts', async () => {
  const view = fixture({ paging: { requests: { mode: 'active', hasMore: true, nextCursor: { Id: 'REQ-1' } } } }); await tick();
  assert.match(view.root.innerHTML, /value="active" selected/);
  assert.match(view.nodes.get('[data-proc-count]').textContent, /1 of 1 loaded active records shown\. More records are available/);
  assert.match(view.root.innerHTML, /Pending requests loaded/);
  view.records({ ok: true, records: [{ RequisitionId: 'REQ-1', Status: 'PENDING' }, { RequisitionId: 'REQ-2', Status: 'APPROVED' }], paging: { mode: 'active', hasMore: false, nextCursor: null } });
  await view.root.fire('click', view.action('more'));
  assert.deepEqual(view.calls.at(-1), { action: 'records', payload: { Kind: 'requests', Mode: 'active', SchoolSection: 'Secondary', Cursor: { Id: 'REQ-1' } } });
  assert.match(view.nodes.get('[data-proc-count]').textContent, /2 of 2 loaded active records shown\. End of this record list/);
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /data-proc-action="more"/);
  view.records({ ok: true, records: [{ RequisitionId: 'OLD-1', Status: 'REJECTED' }], paging: { mode: 'history', hasMore: true, nextCursor: { Id: 'OLD-1' } } });
  await view.root.fire('change', { value: 'history', matches: selector => selector === '[data-proc-record-mode]' });
  assert.deepEqual(view.calls.at(-1), { action: 'records', payload: { Kind: 'requests', Mode: 'history', SchoolSection: 'Secondary' } });
  assert.match(view.nodes.get('[data-proc-body]').innerHTML, /OLD-1/); assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /REQ-2/);
  assert.match(view.nodes.get('[data-proc-count]').textContent, /loaded history records/);
  view.controller.destroy();
});

test('failed history changes retain the loaded mode and data, while receipt details load lazily', async () => {
  const view = fixture({ paging: { requests: { mode: 'active', hasMore: false, nextCursor: null } } }); await tick();
  const selector = { value: 'history', matches: name => name === '[data-proc-record-mode]' }, existing = view.nodes.get('[data-proc-body]').innerHTML;
  view.fail(new Error('Offline'));
  await view.root.fire('change', selector);
  assert.equal(selector.value, 'active'); assert.equal(view.nodes.get('[data-proc-body]').innerHTML, existing);
  assert.match(view.nodes.get('[data-proc-status]').textContent, /Offline/);
  view.fail(null); view.detail({ RequisitionId: 'REQ-1', Status: 'PENDING', Receipts: [{ CreatedAt: '2026-10-01', Notes: 'Counted <safely>' }] });
  await view.root.fire('click', view.action('viewrequest', 'REQ-1'));
  assert.deepEqual(view.calls.at(-1), { action: 'recorddetail', payload: { Kind: 'requests', RecordId: 'REQ-1', SchoolSection: 'Secondary' } });
  assert.match(view.modal.innerHTML, /Receipt history/); assert.match(view.modal.innerHTML, /Counted &lt;safely&gt;/);
  view.controller.destroy();
});

test('central-only subscriptions explain inventory modules without implying transfer access', async () => {
  const view = fixture({ departments: [], capabilities: { canManage: true } }); await tick();
  assert.match(view.root.innerHTML, /Procurement covers central purchasing; enable the relevant inventory module/);
  view.controller.destroy();
});

test('central item form cannot enter opening/current stock quantities', async () => {
  const view = fixture(); await tick();
  await view.root.fire('click', view.action('newitem'));
  assert.match(view.modal.innerHTML, /Central stock starts at zero/);
  assert.doesNotMatch(view.modal.innerHTML, /name="Quantity"/);
  assert.equal(view.modal.attributes['aria-labelledby'], 'procurement-dialog-title');
  view.controller.destroy();
});

test('saved forms carry idempotency key and revision, then refresh authoritative data', async () => {
  const view = fixture(); await tick();
  await view.root.fire('click', view.action('newitem'));
  view.modalForm.values = { ItemName: 'Rice', Unit: 'kg', ReorderLevel: '5' };
  await view.modalForm.fire('submit');
  assert.equal(view.calls[1].action, 'saveitem');
  assert.match(view.calls[1].payload.RequestId, /^[0-9a-f-]{36}$/);
  assert.equal(view.calls[1].payload.ReorderLevel, 5);
  assert.equal(view.calls.at(-1).action, 'list');
  view.controller.destroy();
});

test('unknown network outcomes keep the same idempotency key and forbid altered retry payloads', async () => {
  const view = fixture(); await tick();
  await view.root.fire('click', view.action('newitem'));
  view.modalForm.values = { ItemName: 'Rice', Unit: 'kg', ReorderLevel: '5' };
  view.fail(new Error('Connection lost'));
  await view.modalForm.fire('submit');
  const id = view.calls.at(-1).payload.RequestId;
  await view.modalForm.fire('submit');
  assert.equal(view.calls.at(-1).payload.RequestId, id);
  const count = view.calls.length;
  view.modalForm.values.ItemName = 'Sugar';
  await view.modalForm.fire('submit');
  assert.equal(view.calls.length, count);
  assert.match(view.progress.textContent, /previous response was not received/);
  view.controller.destroy();
});

test('server rejection permits corrected entries with a fresh idempotency key', async () => {
  const view = fixture(); await tick();
  await view.root.fire('click', view.action('newitem'));
  view.modalForm.values = { ItemName: 'Rice', Unit: 'kg', ReorderLevel: '5' };
  view.fail(Object.assign(new Error('Duplicate item'), { responseReceived: true }));
  await view.modalForm.fire('submit');
  const id = view.calls.at(-1).payload.RequestId;
  view.modalForm.values.ItemName = 'Sugar';
  await view.modalForm.fire('submit');
  assert.notEqual(view.calls.at(-1).payload.RequestId, id);
  assert.equal(view.calls.at(-1).payload.ItemName, 'Sugar');
  view.controller.destroy();
});

test('transient server failures and invalid response bodies retain the original operation ID', async () => {
  for (const status of [408, 500, 502, 503, 504]) {
    let failure;
    try { await parseResponse({ ok: false, status, json: async () => ({ ok: false, message: 'Upstream unavailable' }) }); }
    catch (error) { failure = error; }
    assert.equal(failure.responseReceived, false, `status ${status} must remain an unknown outcome`);
    const view = fixture(); await tick();
    await view.root.fire('click', view.action('newitem'));
    view.modalForm.values = { ItemName: 'Rice', Unit: 'kg', ReorderLevel: '5' };
    view.fail(failure);
    await view.modalForm.fire('submit');
    const reference = view.calls.at(-1).payload.RequestId;
    await view.modalForm.fire('submit');
    assert.equal(view.calls.at(-1).payload.RequestId, reference);
    view.controller.destroy();
  }
  for (const body of [null, [], {}, { message: 'proxy failure' }, '<html>Bad gateway</html>']) {
    await assert.rejects(parseResponse({ ok: true, status: 200, json: async () => body }), error => error.responseReceived === false);
  }
  await assert.rejects(parseResponse({ ok: false, status: 502, json: async () => { throw new SyntaxError('Not JSON'); } }), error => error.responseReceived === false);
});

test('definitive validation/access/conflict replies permit correction, and valid success is returned', async () => {
  for (const status of [400, 403, 409]) {
    await assert.rejects(parseResponse({ ok: false, status, json: async () => ({ ok: false, message: 'Definitive rejection' }) }), error => error.responseReceived === true);
  }
  assert.deepEqual(await parseResponse({ ok: true, status: 200, json: async () => ({ ok: true, message: 'Saved' }) }), { ok: true, message: 'Saved' });
});

test('unmount cancels listeners and prevents stale updates when another module opens', async () => {
  const view = fixture(); await tick();
  view.ui.unmount();
  assert.equal(view.root.listeners.size, 0);
  const count = view.calls.length;
  await view.controller.reload();
  assert.equal(view.calls.length, count);
});

test('supplier receipts require a distinct delivery reference and send only newly received quantities', async () => {
  const view = fixture({ purchases: [{ PurchaseId: 'p1', Revision: 2, Status: 'APPROVED', Lines: [{ ItemId: 'rice', Quantity: 20, ReceivedQuantity: 5 }] }] }); await tick();
  await view.root.fire('click', view.action('receivepurchase', 'p1'));
  assert.match(view.modalForm.innerHTML, /name="DeliveryReference"[^>]*required/);
  assert.match(view.modal.innerHTML, /max="15"/);
  view.modalForm.values = { DeliveryReference: 'DEL-2', Notes: 'Five kilograms received' };
  const quantityInput = Object.assign(element(), { value: '5', dataset: { receiptItem: 'rice' } });
  view.modalForm.querySelectorAll = selector => selector === '[data-receipt-item]' ? [quantityInput] : [];
  await view.modalForm.fire('submit');
  assert.equal(view.calls[1].action, 'receivepurchase');
  assert.equal(view.calls[1].payload.DeliveryReference, 'DEL-2');
  assert.deepEqual(view.calls[1].payload.Lines, [{ ItemId: 'rice', Quantity: 5 }]);
  assert.equal(view.calls[1].payload.ExpectedRevision, 2);
  view.controller.destroy();
});

test('zero-quantity discrepancy reports use the exact server flag without inventing a receipt', async () => {
  const view = fixture({ transfers: [{ TransferId: 't1', Revision: 4, Status: 'IN_TRANSIT', CanReceive: true, Lines: [{ ItemId: 'rice', Quantity: 10, ReceivedQuantity: 2, ReturnedQuantity: 3 }] }] }); await tick();
  await view.root.fire('click', view.action('confirmreceipt', 't1'));
  assert.match(view.modal.innerHTML, /max="5"/);
  view.modalForm.values = { Notes: 'The five outstanding units have not arrived', OverrideReason: 'Reviewed exceptional receipt' };
  view.modalForm.elements.Discrepancy.checked = true;
  const quantityInput = Object.assign(element(), { value: '0', dataset: { receiptItem: 'rice' } });
  view.modalForm.querySelectorAll = selector => selector === '[data-receipt-item]' ? [quantityInput] : [];
  await view.modalForm.fire('submit');
  assert.equal(view.calls[1].payload.ReportDiscrepancy, true);
  assert.deepEqual(view.calls[1].payload.Lines, []);
  assert.equal(view.calls[1].payload.OverrideReason, 'Reviewed exceptional receipt');
  view.controller.destroy();
});

test('Procurement can create a zero-stock department target without opening the department module', async () => {
  const view = fixture(); await tick();
  await view.root.fire('click', view.tab('departments'));
  assert.match(view.root.innerHTML, /Add department item/);
  await view.root.fire('click', view.action('newdestination'));
  assert.match(view.modal.innerHTML, /zero stock/);
  assert.doesNotMatch(view.modal.innerHTML, /name="Quantity"/);
  view.modalForm.elements.Department.value = 'bookstore';
  await view.modalForm.elements.Department.fire('change');
  assert.equal(view.modalForm.elements.ItemCode.required, true);
  view.modalForm.values = { ItemId: 'rice', Department: 'kitchen', ItemCode: 'RICE', Price: '0', Notes: '' };
  await view.modalForm.fire('submit');
  assert.equal(view.calls[1].action, 'savedestination');
  assert.equal(view.calls[1].payload.SchoolSection, 'Secondary');
  assert.equal(view.calls[1].payload.Price, 0);
  assert.equal(view.calls[1].payload.Quantity, undefined);
  view.controller.destroy();
});

test('central-stock rows remove excess padding, detail gaps and inherited button margins', async t => {
  const view = fixture(); t.after(() => view.controller.destroy()); await tick();
  await view.root.fire('click', view.tab('stock'));
  assert.match(view.nodes.get('[data-proc-body]').innerHTML, /class="procurement-table procurement-stock-table"/);
  assert.match(styles, /\.procurement-stock-table td \{ padding: 4px 10px; vertical-align: middle; line-height: 1.2;/);
  assert.match(styles, /\.procurement-stock-table td small \{ margin: 0;/);
  assert.match(styles, /\.procurement-stock-table button \{ margin: 0; min-height: 32px;/);
  assert.match(styles, /@media \(max-width: 600px\) \{\s*\.procurement-stock-table button \{ min-height: 40px;/);
  await view.root.fire('click', view.tab('requests'));
  assert.doesNotMatch(view.nodes.get('[data-proc-body]').innerHTML, /procurement-stock-table/);
});

test('supply request spacing is compact without shrinking checkbox or input touch targets', () => {
  assert.match(styles, /\.procurement-request-form label \{ margin: 0; gap: \.2rem;/);
  assert.match(styles, /\.procurement-request-dialog button \{ margin: 0;/);
  assert.match(styles, /\.procurement-request-form \{ gap: \.55rem;/);
  assert.match(styles, /\.procurement-request-form \.procurement-pick-choice \{ min-height: 44px;/);
  assert.match(styles, /\.procurement-request-form textarea \{[^}]*min-height: 40px;/);
  assert.match(styles, /\.procurement-request-form \.procurement-lines:empty \{ display: none;/);
  assert.match(styles, /\.procurement-picked-line \{ grid-template-columns: minmax\(0, 1.1fr\) minmax\(80px, .4fr\) minmax\(0, 1.5fr\) auto;/);
  assert.match(styles, /\.procurement-picked-line > \.procurement-picked-destination \{ grid-column: 2 \/ -1;/);
});

test('mobile layouts keep amounts and statuses unbroken and scroll wide records horizontally', () => {
  assert.match(styles, /\.procurement-table-wrap \{ overflow: auto;/);
  assert.match(styles, /\.procurement-number \{[^}]*white-space: nowrap; word-break: normal; overflow-wrap: normal/);
  assert.match(styles, /\.procurement-state \{[^}]*white-space: nowrap; word-break: normal/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /\.procurement-metrics \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.procurement-form \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test('admin registers procurement for all editions and connects only the branch-scoped API', () => {
  assert.match(admin, /\['procurement', 'Procurement'\]/);
  assert.match(admin, /procurement: 'Procurement'/);
  const restricted = admin.slice(admin.indexOf('const organizationOnlyStaffRoles'), admin.indexOf('const nonSchoolOnlyStaffRoles'));
  assert.doesNotMatch(restricted, /Procurement Officer/);
  const integration = admin.slice(admin.indexOf("active === 'procurement'"), admin.indexOf("active === 'vendorSettlements'", admin.indexOf("active === 'procurement'")));
  assert.match(integration, /BranchId: procurementBranchId/);
  assert.match(integration, /\/api\/staff-procurement/);
  assert.match(integration, /readOnly: currentUser\?\.subscriptionReadOnly === true/);
  assert.match(integration, /Choose one working branch from the branch selector/);
  assert.match(admin, /window\.DynamaxProcurement\?\.unmount\(\)/);
});

test('legacy inventory UI protects procurement quantities without hiding vendor stock', () => {
  const body = admin.slice(admin.indexOf('function procurementManagedItem'), admin.indexOf('function renderStaffStore'));
  assert.match(body, /controlled && !vendorOwned/);
  assert.match(body, /control\.readOnly = readOnly/);
  assert.match(admin, /option\.disabled = managed/);
  assert.match(admin, /bindProcurementDepartmentShortcut\(section\)/);
  assert.doesNotMatch(admin, /bindProcurementDepartmentShortcut\('library'\)/);
});

test('legacy OwnerType vendor stock remains editable when branch procurement is enabled', () => {
  const setFields = runInNewContext(`${admin.slice(admin.indexOf('function procurementInventoryFields('), admin.indexOf('function bindProcurementDepartmentShortcut('))}\nprocurementInventoryFields`, {
    clean: value => String(value ?? '').trim(), procurementManagedItem: () => false
  });
  const form = element(); form.elements = { Quantity: element(), Unit: element(), ItemCode: element() };
  form.querySelector = () => element();
  setFields(form, { OwnerType: 'Vendor', __id: 'legacy-vendor-item', Quantity: 7 }, true);
  assert.equal(form.elements.Quantity.readOnly, false);
  assert.equal(form.elements.Unit.readOnly, false);
  assert.match(admin, /row\?\.OwnershipType \|\| row\?\.OwnerType/);
});

test('stock and reorder figures line up with explicitly numeric headers in both inventories', async () => {
  const view = fixture({ purchases: [{ PurchaseId: 'p1', SupplierName: 'Supplier', TotalAmount: 1234 }] }); await tick();
  for (const [tab, labels] of [['stock', ['Central stock', 'Reorder level']], ['departments', ['Available stock', 'Reorder level']], ['purchases', ['Amount']]]) {
    await view.root.fire('click', view.tab(tab));
    const html = view.nodes.get('[data-proc-body]').innerHTML;
    for (const label of labels) assert.match(html, new RegExp(`<th scope="col" class="procurement-number">${label}</th>`));
    assert.match(html, /<td class="procurement-number">/);
  }
  assert.doesNotMatch(source, /quantity\|stock\|units\|cost\|amount/);
  view.controller.destroy();
});

const importRow = { RowNumber: 2, ItemName: 'Sugar <test>', Unit: 'kg', ItemCode: 'SUGAR', ReorderLevel: '5', QuantityAvailable: '20.125' };
const importModule = {
  PROCUREMENT_IMPORT_LIMITS: { rows: 50, bytes: 65536 },
  PROCUREMENT_IMPORT_COLUMNS: { central: ['ItemName', 'Unit', 'ItemCode', 'Category', 'ReorderLevel', 'QuantityAvailable'], department: ['ItemName', 'Unit', 'ItemCode', 'Category', 'ReorderLevel', 'QuantityAvailable', 'Notes'] },
  parseProcurementItemCsv: () => [importRow], normalizeProcurementImportRow: row => ({ row, errors: [] })
};
const readyPreview = { ok: true, canImport: true, PreviewFingerprint: 'checked-records-v1', summary: { total: 1, ready: 1, skipped: 0, errors: 0, newCentral: 1, newDepartment: 1 }, rows: [{ ...importRow, status: 'ready', errors: [] }] };
async function importFixture(mode = 'central', module = importModule) {
  const view = fixture({}, { branchId: 'branch-1', loadItemImport: async () => module }); await tick();
  await view.root.fire('click', view.tab(mode === 'department' ? 'departments' : 'stock'));
  await view.root.fire('click', view.action('batchitems'));
  view.modalForm.elements.Department.value = 'kitchen';
  view.preview(readyPreview);
  return view;
}

test('batch upload is shown only to writable procurement managers in every edition', async () => {
  for (const edition of ['school', 'faith', 'organization']) {
    for (const [allowed, extra] of [[true, {}], [false, { readOnly: true }], [false, { capabilities: { canRequest: true } }]]) {
      const view = fixture({ edition, ...extra }); await tick();
      for (const tab of ['stock', 'departments']) {
        await view.root.fire('click', view.tab(tab));
        assert.equal(view.root.innerHTML.includes('Batch upload items'), allowed);
      }
      view.controller.destroy();
    }
  }
});

test('CSV preview is read-only; confirmed department import keeps section, department and fingerprint', async () => {
  const view = await importFixture('department');
  assert.match(view.modal.innerHTML, /Branch: branch-1 · School section: Secondary/);
  assert.match(view.modal.innerHTML, /opening available quantity/);
  assert.match(view.modal.innerHTML, /Price is not required/);
  assert.match(view.modal.innerHTML, /Existing items and vendor-owned stock are never overwritten/);
  assert.match(view.modal.innerHTML, /Download CSV template/);
  assert.equal(view.importNodes.get('button[type="submit"]').disabled, true);
  await view.importNodes.get('[data-proc-import-preview]').fire('click');
  const previewCall = view.calls.at(-1);
  assert.equal(previewCall.action, 'previewitemimport');
  assert.equal(previewCall.payload.RequestId, undefined);
  assert.equal(previewCall.payload.SchoolSection, 'Secondary');
  assert.equal(previewCall.payload.Department, 'kitchen');
  assert.match(view.importNodes.get('[data-proc-import-results]').innerHTML, /Sugar &lt;test&gt;/);
  assert.match(view.importNodes.get('[data-proc-import-results]').innerHTML, /Available quantity/);
  assert.match(view.importNodes.get('[data-proc-import-results]').innerHTML, /20\.125/);
  assert.doesNotMatch(view.importNodes.get('[data-proc-import-results]').innerHTML, /Price \(optional\)/);
  assert.equal(view.importNodes.get('[data-proc-import-confirm]').disabled, false);
  await view.modalForm.fire('submit');
  assert.equal(view.calls.at(-1).action, 'previewitemimport');
  view.importNodes.get('[data-proc-import-confirm]').checked = true;
  await view.modalForm.fire('submit');
  const imported = view.calls.find(call => call.action === 'importitems');
  assert.equal(imported.payload.PreviewFingerprint, readyPreview.PreviewFingerprint);
  assert.equal(imported.payload.Department, 'kitchen');
  assert.equal(imported.payload.SchoolSection, 'Secondary');
  assert.match(imported.payload.RequestId, /^[0-9a-f-]{36}$/);
  assert.equal(imported.payload.Rows[0].Quantity, undefined);
  assert.equal(imported.payload.Rows[0].QuantityAvailable, '20.125');
  assert.equal(view.calls.at(-1).action, 'list');
  view.controller.destroy();
});

for (const mode of ['central', 'department']) test(`${mode}: downloaded CSV template contains QuantityAvailable and no required price`, async () => {
  const importer = await import('../js/procurement-item-import.js'), view = await importFixture(mode, importer);
  await view.importNodes.get('[data-proc-import-template]').fire('click');
  assert.equal(view.downloads.length, 1); assert.equal(view.downloads[0].name, `procurement-${mode}-items.csv`);
  const csv = await view.downloads[0].blob.text(), columns = csv.trim().replace(/^\uFEFF/, '').split(',');
  assert.deepEqual(columns, importer.PROCUREMENT_IMPORT_COLUMNS[mode]);
  assert.ok(columns.includes('QuantityAvailable')); assert.ok(!columns.includes('Price'));
  view.controller.destroy();
});

test('central CSV previews available quantities and confirms opening stock without department fields', async () => {
  const importer = await import('../js/procurement-item-import.js'), view = await importFixture('central', importer);
  assert.match(view.modal.innerHTML, /opening available quantity/);
  assert.match(view.modal.innerHTML, /not stock held by departments/);
  assert.match(view.modal.innerHTML, /blank means 0/);
  assert.doesNotMatch(view.modal.innerHTML, /Create zero-stock items|Do not include stock quantities/);
  view.importNodes.get('[data-proc-import-csv]').value = 'ItemName,Unit,ItemCode,Category,ReorderLevel,QuantityAvailable\nSugar,kg,SUGAR,Food,5,20.125\n';
  await view.importNodes.get('[data-proc-import-preview]').fire('click');
  const html = view.importNodes.get('[data-proc-import-results]').innerHTML;
  assert.match(html, /Available quantity/); assert.match(html, /20\.125/); assert.match(html, /new central items; skipped balances remain unchanged/);
  assert.doesNotMatch(html, /New central stock balances: 0|Price \(optional\)/);
  assert.equal(view.importNodes.get('button[type="submit"]').textContent, 'Create items with opening stock');
  assert.match(view.progress.textContent, /with their opening quantities/);
  await view.modalForm.fire('submit'); assert.equal(view.calls.at(-1).action, 'previewitemimport');
  view.importNodes.get('[data-proc-import-confirm]').checked = true;
  await view.modalForm.fire('submit');
  const payload = view.calls.find(call => call.action === 'importitems').payload;
  assert.equal(payload.ImportMode, 'central'); assert.equal(payload.Rows[0].QuantityAvailable, '20.125');
  assert.equal(payload.Department, undefined); assert.equal(payload.SchoolSection, undefined); assert.equal(payload.Rows[0].Quantity, undefined);
  view.controller.destroy();
});

test('CSV errors do not call the server, while stale edits invalidate checked previews', async () => {
  const invalid = await importFixture('central', { ...importModule, normalizeProcurementImportRow: () => ({ errors: ['Unit is required <unsafe>'] }) });
  await invalid.importNodes.get('[data-proc-import-preview]').fire('click');
  assert.equal(invalid.calls.length, 1);
  assert.match(invalid.importNodes.get('[data-proc-import-results]').innerHTML, /Row 2: Unit is required &lt;unsafe&gt;/);
  assert.equal(invalid.importNodes.get('button[type="submit"]').disabled, true);
  invalid.controller.destroy();
  const view = await importFixture('department');
  await view.importNodes.get('[data-proc-import-preview]').fire('click');
  await view.modalForm.elements.Department.fire('change');
  assert.equal(view.importNodes.get('button[type="submit"]').disabled, true);
  assert.equal(view.importNodes.get('[data-proc-import-confirm]').checked, false);
  await view.modalForm.fire('submit');
  assert.equal(view.calls.at(-1).action, 'previewitemimport');
  view.controller.destroy();
});

test('all-skipped and conflicting-row previews cannot be imported', async () => {
  for (const status of ['skip', 'error']) {
    const view = await importFixture();
    view.preview({ ...readyPreview, canImport: false, summary: { ready: 0, skipped: status === 'skip' ? 1 : 0, errors: status === 'error' ? 1 : 0 }, rows: [{ ...importRow, status, errors: status === 'error' ? ['Existing vendor-owned record'] : [] }] });
    await view.importNodes.get('[data-proc-import-preview]').fire('click');
    assert.equal(view.importNodes.get('button[type="submit"]').disabled, true);
    assert.equal(view.importNodes.get('[data-proc-import-confirm]').disabled, true);
    assert.match(view.progress.textContent, status === 'skip' ? /no new items/ : /Correct all errors/);
    view.controller.destroy();
  }
});

test('unknown batch results lock source and retain identical retry payloads; definitive conflict permits re-preview', async () => {
  const view = await importFixture('department');
  await view.importNodes.get('[data-proc-import-preview]').fire('click');
  view.importNodes.get('[data-proc-import-confirm]').checked = true;
  view.fail(new Error('Connection lost'));
  await view.modalForm.fire('submit');
  const first = view.calls.at(-1);
  assert.equal(view.importNodes.get('[data-proc-import-csv]').disabled, true);
  assert.equal(view.modalForm.elements.Department.disabled, true);
  assert.equal(view.importNodes.get('[data-proc-import-preview]').disabled, true);
  assert.equal(view.importNodes.get('button[type="submit"]').textContent, 'Retry unchanged upload');
  await view.modalForm.fire('submit');
  assert.deepEqual(view.calls.at(-1), first);
  view.fail(Object.assign(new Error('Existing records changed; preview again.'), { responseReceived: true }));
  await view.modalForm.fire('submit');
  assert.equal(view.importNodes.get('[data-proc-import-csv]').disabled, false);
  assert.equal(view.importNodes.get('[data-proc-import-preview]').disabled, false);
  assert.equal(view.importNodes.get('button[type="submit"]').disabled, true);
  assert.match(view.progress.textContent, /Existing records changed/);
  view.controller.destroy();
});

test('in-flight preview freezes all inputs and refuses duplicate submissions', async () => {
  const view = await importFixture();
  let resolve;
  view.preview(new Promise(done => { resolve = done; }));
  const pending = view.importNodes.get('[data-proc-import-preview]').fire('click');
  assert.equal(view.importNodes.get('[data-proc-import-csv]').disabled, true);
  await view.importNodes.get('[data-proc-import-preview]').fire('click');
  assert.equal(view.calls.filter(call => call.action === 'previewitemimport').length, 1);
  resolve(readyPreview); await pending;
  assert.equal(view.importNodes.get('[data-proc-import-csv]').disabled, false);
  view.controller.destroy();
});

test('real shared CSV parser previews opening quantities and legacy optional prices but rejects direct stock writes', async () => {
  const module = await import('../js/procurement-item-import.js');
  const view = await importFixture('department', module);
  const csv = view.importNodes.get('[data-proc-import-csv]');
  csv.value = 'ItemName,Unit,ItemCode,ReorderLevel,Price\nSugar,kg,SUGAR,5,200\n';
  await view.importNodes.get('[data-proc-import-preview]').fire('click');
  assert.deepEqual(view.calls.at(-1).payload.Rows, [{ ItemName: 'Sugar', Unit: 'kg', ItemCode: 'SUGAR', ReorderLevel: '5', Price: '200', RowNumber: 2 }]);
  assert.match(view.importNodes.get('[data-proc-import-results]').innerHTML, /Price \(optional\)/);
  csv.value = 'ItemName,Unit,ItemCode,ReorderLevel,QuantityAvailable\nSugar,kg,SUGAR,5,20.125\n'; await csv.fire('input');
  await view.importNodes.get('[data-proc-import-preview]').fire('click');
  assert.deepEqual(view.calls.at(-1).payload.Rows, [{ ItemName: 'Sugar', Unit: 'kg', ItemCode: 'SUGAR', ReorderLevel: '5', QuantityAvailable: '20.125', RowNumber: 2 }]);
  assert.doesNotMatch(view.importNodes.get('[data-proc-import-results]').innerHTML, /Price \(optional\)/);
  const count = view.calls.length;
  csv.value = 'ItemName,Unit,Quantity\nSugar,kg,200\n'; await csv.fire('input');
  await view.importNodes.get('[data-proc-import-preview]').fire('click');
  assert.equal(view.calls.length, count);
  assert.match(view.progress.textContent, /direct Quantity and vendor fields are not allowed/);
  view.controller.destroy();
});

test('file-read failures preserve the existing CSV draft and late reads do not replace newer edits', async () => {
  const view = await importFixture();
  const file = view.importNodes.get('[data-proc-import-file]'), csv = view.importNodes.get('[data-proc-import-csv]');
  csv.value = 'Existing draft';
  file.files = [{ name: 'items.csv', size: 100000 }];
  await file.fire('change');
  assert.equal(csv.value, 'Existing draft');
  assert.match(view.progress.textContent, /Existing draft contents have been kept/);
  let resolve;
  file.files = [{ name: 'items.csv', size: 10, text: () => new Promise(done => { resolve = done; }) }];
  const reading = file.fire('change');
  csv.value = 'Newer typed draft'; await csv.fire('input');
  resolve('Late file'); await reading;
  assert.equal(csv.value, 'Newer typed draft');
  view.controller.destroy();
});
