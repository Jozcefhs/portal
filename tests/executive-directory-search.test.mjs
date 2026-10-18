import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function cancelExecutiveDirectorySearch()'), source.indexOf('function bindExecutiveOfficeEvents()'));
function fixture() {
  const timers = new Map(), calls = [], status = {}, results = {};
  const form = { isConnected: true, elements: { query: { value: '' } } };
  let id = 0;
  const context = vm.createContext({ window: { clearTimeout: key => timers.delete(key), setTimeout: (fn, ms) => { assert.equal(ms, 350); timers.set(++id, fn); return id; } },
    document: { getElementById: name => name === 'executiveDirectorySearch' ? form : status }, panelEl: { querySelector: () => results },
    clean: value => String(value ?? '').trim(), currentUser: { username: 'tester' }, selectedBranchId: 'main',
    staffSessionAbortController: new AbortController(), activeSection: 'executiveOffice', executiveOfficeTab: 'directory',
    executiveDirectoryTimer: null, executiveDirectorySequence: 0, executiveDirectoryBusy: false, executiveDirectoryPending: null,
    executiveDirectoryQuery: '', executiveDirectoryType: 'student', executiveDirectoryResults: [], executiveAvailableDirectoryTypes: [],
    executiveDirectoryResultsMarkup: () => 'results only',
    executiveOfficeRequest: (action, payload) => new Promise((resolve, reject) => { calls.push({ action, payload, resolve, reject }); }) });
  vm.runInContext(code, context);
  return { context, form, timers, calls, status, results,
    type: (text, immediate = false) => { form.elements.query.value = text; context.scheduleExecutiveDirectorySearch(form, immediate); },
    tick: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('typing debounces, requires two characters and never replaces the focused form', async () => {
  const f = fixture(); f.type('p'); f.tick(); assert.equal(f.calls.length, 0);
  f.type('ph'); f.type('phi'); f.type('philip'); assert.equal(f.timers.size, 1); f.tick();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].payload.query, 'philip');
  f.calls[0].resolve({ results: [{ id: '1' }] }); await settle();
  assert.equal(f.status.textContent, '1 permitted record found.'); assert.equal(f.form.elements.query.value, 'philip');
});
test('one active search keeps only latest pending query; stale results never overwrite new input', async () => {
  const f = fixture(); f.type('ph'); f.tick(); f.type('phil'); f.tick(); f.type('philip'); f.tick();
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ results: [{ id: 'stale' }] }); await settle();
  assert.equal(f.context.executiveDirectoryResults.length, 0); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].payload.query, 'philip');
  f.calls[1].resolve({ results: [{ id: 'latest' }] }); await settle();
  assert.equal(f.context.executiveDirectoryResults[0].id, 'latest');
});
test('Search/Enter bypass debounce and errors stay inline', async () => {
  const f = fixture(); f.type('Ada'); f.type('Ada', true);
  assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
  f.calls[0].reject(new Error('Connection unavailable')); await settle();
  assert.equal(f.status.textContent, 'Connection unavailable'); assert.equal(f.status.className, 'status bad');
});
for (const change of ['branch', 'user', 'session', 'tab', 'detached', 'clear']) {
  test(`search discards response after ${change}`, async () => {
    const f = fixture(); f.type('Ada', true);
    if (change === 'branch') f.context.selectedBranchId = 'north';
    if (change === 'user') f.context.currentUser = { username: 'other' };
    if (change === 'session') f.context.staffSessionAbortController.abort();
    if (change === 'tab') f.context.executiveOfficeTab = 'compose';
    if (change === 'detached') f.form.isConnected = false;
    if (change === 'clear') f.type('');
    f.calls[0].resolve({ results: [{ id: 'private' }] }); await settle();
    assert.equal(f.context.executiveDirectoryResults.length, 0);
  });
}
test('the same directory event handlers serve every edition and support IME composition', () => {
  assert.match(source, /directoryInput\?\.addEventListener\('input'/);
  assert.match(source, /event.isComposing/); assert.match(source, /addEventListener\('compositionend'/);
  assert.doesNotMatch(code, /renderExecutiveOffice\(|setStatus\(/);
});
