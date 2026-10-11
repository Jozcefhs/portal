import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { clinicDispensingItems } from '../js/clinic-dispensing.js';

const source = await readFile(new URL('../js/clinic-dispensing.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function node() {
  return { value: '', innerHTML: '', textContent: '', disabled: false, hidden: false, checked: false, isConnected: true,
    listeners: new Map(), options: [], tagName: 'INPUT', defaultValue: '', dataset: {},
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    fire(type, target = this, detail) { return this.listeners.get(type)?.({ target, detail, preventDefault() {} }); },
    setAttribute(name) { if (name === 'hidden') this.hidden = true; }, add(option) { this.options.push(option); } };
}
function fixture() {
  const host = node(), form = node(), submit = node(), status = node(), lineHost = node();
  const selectors = new Map(['[data-clinic-edit]', '[data-clinic-add]', '[data-clinic-correction]', '[data-clinic-reason]', '[data-clinic-status]', '[data-clinic-return]'].map(key => [key, node()]));
  selectors.set('[data-clinic-lines]', lineHost);
  host.querySelector = key => selectors.get(key);
  let lineRows = [];
  Object.defineProperty(lineHost, 'innerHTML', { get() { return this.html || ''; }, set(html) {
    this.html = html;
    lineRows = [...html.matchAll(/data-clinic-line>([\s\S]*?)<\/div>/g)].map(([, row]) => {
      const item = node(), quantity = node();
      item.value = row.match(/<option value="([^"]*)" selected>/)?.[1] || '';
      quantity.value = row.match(/data-clinic-quantity[^>]*value="([^"]*)"/)?.[1] || '';
      return { item, quantity, querySelector: key => key === '[data-clinic-item]' ? item : quantity };
    });
  } });
  host.querySelectorAll = () => lineRows;
  const formNodes = new Map([['[data-clinic-dispensing]', host], ['button[type="submit"]', submit], ['[data-department-status]', status], ['#clinicStudentSearch', node()], ['#clinicFaceLookup', node()], ['[data-clinic-student-result]', node()]]);
  form.querySelector = key => formNodes.get(key);
  form.elements = Object.fromEntries(['Date', 'AdmissionNo', 'Complaint', 'Treatment', 'Disposition', 'Notes'].map(key => [key, node()]));
  form.elements.Date.value = form.elements.Date.defaultValue = '2026-10-11';
  form.elements.AdmissionNo.value = 'STUDENT-1'; form.elements.Complaint.value = 'Synthetic';
  form.elements.Disposition.tagName = 'SELECT'; form.elements.Disposition.options = [{ value: 'Treated' }];
  const calls = [], errors = [], saved = []; let reject = false;
  const mount = runInNewContext(source.replace(/^export /gm, '') + '\nmountClinicDispensing;', {
    crypto: webcrypto, Option: function (text, value) { return { text, value }; },
    FormData: class { constructor(element) { this.values = Object.entries(element.elements).map(([key, field]) => [key, field.value]); } entries() { return this.values; } }
  });
  mount(form, { inventory: [{ __id: 'CLINIC-ONE', ItemName: 'Supply <img>', Quantity: 8, Unit: 'pcs', SchoolSection: 'Secondary' },
    { __id: 'VENDOR-ONE', VendorId: 'V-1', ItemName: 'Private vendor supply' },
    { __id: 'OTHER-SECTION', ItemName: 'Primary supply', SchoolSection: 'Primary' },
    { __id: 'OTHER-BRANCH', ItemName: 'Other branch supply', SchoolSection: 'Secondary', BranchId: 'annex' }],
    records: [{ RecordId: 'OLD-1', Revision: 4, Date: '2026-10-10', AdmissionNo: 'STUDENT-2', StudentName: '<script>', Complaint: 'Earlier visit', SchoolSection: 'Secondary', DispensedItems: [{ InventoryId: 'CLINIC-ONE', Quantity: 2 }] }],
    request: async body => { calls.push(plain(body)); if (reject) throw new Error('Retry safely'); return { ok: true }; },
    onSaved: result => saved.push(result), setStatus: (_node, message) => errors.push(message) });
  return { host, form, submit, status, lineHost, selectors, calls, errors, saved, rows: () => lineRows, reject: value => { reject = value; } };
}

test('frontend validates finite, unique, bounded, precise dispensing quantities', () => {
  assert.deepEqual(clinicDispensingItems([{ InventoryId: ' MED-1 ', Quantity: '0.125' }]), [{ InventoryId: 'MED-1', Quantity: 0.125 }]);
  for (const rows of [null, Array(31).fill({}), [{ InventoryId: 'one', Quantity: 0.0001 }], [{ InventoryId: 'one', Quantity: 1000001 }], [{ InventoryId: 'one', Quantity: 1 }, { InventoryId: 'one', Quantity: 2 }]]) assert.throws(() => clinicDispensingItems(rows));
});

test('new visits post exact quantities and keep the same request reference on an unchanged retry', async () => {
  const f = fixture();
  await f.selectors.get('[data-clinic-add]').fire('click');
  assert.match(f.lineHost.innerHTML, /Supply &lt;img&gt;/);
  assert.doesNotMatch(f.lineHost.innerHTML, /Private vendor supply/);
  f.rows()[0].item.value = 'CLINIC-ONE'; f.rows()[0].quantity.value = '2';
  f.reject(true); await f.form.fire('submit'); await f.form.fire('submit');
  assert.equal(f.calls[0].RequestId, f.calls[1].RequestId);
  assert.equal(f.calls[0].RecordId, f.calls[1].RecordId);
  assert.deepEqual(f.calls[0].DispensedItems, [{ InventoryId: 'CLINIC-ONE', Quantity: 2 }]);
  assert.equal(f.submit.disabled, false);
  f.reject(false); await f.form.fire('submit');
  assert.equal(f.saved.length, 1);
});

test('reviewed edits preserve exact IDs and send revision, reason and explicit cancellation-return choice', async () => {
  const f = fixture(), edit = f.selectors.get('[data-clinic-edit]');
  edit.value = '0'; await edit.fire('change');
  assert.equal(f.form.elements.AdmissionNo.value, 'STUDENT-2');
  assert.equal(f.form.elements.AdmissionNo.readOnly, true);
  assert.equal(f.selectors.get('[data-clinic-reason]').required, true);
  assert.doesNotMatch(f.lineHost.innerHTML, /Primary supply/);
  assert.doesNotMatch(f.lineHost.innerHTML, /Other branch supply/);
  f.selectors.get('[data-clinic-reason]').value = 'Unused supplies returned';
  f.selectors.get('[data-clinic-status]').value = 'Cancelled';
  f.selectors.get('[data-clinic-return]').checked = true;
  await f.form.fire('submit');
  assert.equal(f.calls[0].ExpectedRevision, 4);
  assert.equal(f.calls[0].RecordId, 'OLD-1');
  assert.equal(f.calls[0].RestoreDispensedStock, true);
  assert.equal(f.calls[0].Status, 'Cancelled');
  assert.deepEqual(f.calls[0].DispensedItems, [{ InventoryId: 'CLINIC-ONE', Quantity: 2 }]);
  edit.value = ''; await edit.fire('change');
  assert.equal(f.form.elements.AdmissionNo.readOnly, false);
  assert.equal(f.selectors.get('[data-clinic-correction]').hidden, true);
  assert.equal(f.form.elements.Disposition.value, 'Treated');
});

test('invalid dispensing never reaches the server and clinic form wiring keeps stock results refreshed', async () => {
  const f = fixture(); await f.selectors.get('[data-clinic-add]').fire('click');
  await f.form.fire('submit');
  assert.equal(f.calls.length, 0); assert.equal(f.errors.length, 1);
  const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /data-clinic-dispensing/);
  assert.match(admin, /mountClinicDispensing\(clinicRecordForm, \{ inventory, records/);
  assert.match(admin, /onSaved: result => \{ renderDepartmentOperations\('clinic', result\)/);
});
