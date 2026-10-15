import assert from 'node:assert/strict';
import { assertServiceWorkerCacheVersion } from './helpers/service-worker-cache-version.mjs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const source = await read('js/admin.js');
const css = await read('css/style.css');
const extract = (from, to) => source.slice(source.indexOf(`function ${from}(`), source.indexOf(to));
const rowsSource = extract('externalAuditJournalRows', 'function externalAuditFindingRows(');
const bindingSource = extract('bindExternalAuditEvents', 'function exportIncomeAnalyticsCsv(');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const journal = {
  Date: '2026-09-30', JournalNo: 'SYS-INVCREDIT-AUTO-INV-20260930172916-4806FC78-0-4200000',
  RecordId: 'stored-record-id', Status: 'Posted', BranchId: 'main',
  Description: 'Parent credit applied: INV-20260930172916-4806FC78',
  SourceType: 'Student Invoice Credit', SourceId: 'INV-20260930172916-4806FC78', TotalDebit: 42000, TotalCredit: 42000,
  Lines: [{ AccountCode: '2310', Description: 'TEST/001', Debit: 42000, Credit: 0 },
    { AccountCode: '1100', Description: 'Cambridge Checkpoint Textbooks', Department: 'Books', Debit: 0, Credit: 42000 }]
};
const renderRows = (journals, role = 'Super Admin') => vm.runInNewContext(`(${rowsSource})()`, {
  externalAuditState: { journals }, currentUser: { role }, escapeHtml
});

test('journal disclosure occupies a separate full-width row and preserves all line amounts', () => {
  const html = renderRows([journal, journal]);
  assert.match(html, /<tr class="audit-journal-detail" id="external-audit-journal-lines-0" hidden><td colspan="7">/);
  assert.match(html, /aria-expanded="false" aria-controls="external-audit-journal-lines-0"/);
  assert.match(html, /id="external-audit-journal-lines-1" hidden/);
  assert.doesNotMatch(html, /<details>|class="admin-table-wrap"/);
  assert.match(html, /data-label="Debit" class="audit-amount">42,000\.00/);
  assert.match(html, /data-label="Credit" class="audit-amount">0\.00/);
  assert.match(html, /<th scope="col" class="audit-amount">Credit<\/th>/);
  assert.match(html, /data-audit-journal-evidence="stored-record-id"/);
  assert.match(html, /Source: Student Invoice Credit INV-20260930172916-4806FC78/);
  assert.doesNotMatch(html, /data-audit-query-journal/);
  assert.match(renderRows([journal], 'External Auditor'), /data-audit-query-journal="SYS-INVCREDIT/);
});

test('journal rows escape untrusted fields and cover empty registers and line lists', () => {
  const malicious = '<img src=x onerror="alert(1)">';
  const html = renderRows([{ ...journal, JournalNo: malicious, SourceId: malicious,
    Lines: [{ AccountCode: malicious, Description: malicious, Department: malicious }] }], 'External Auditor');
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /id="external-audit-journal-lines-0" hidden/);
  assert.match(renderRows([{ ...journal, Lines: [] }]), /colspan="5">No lines recorded/);
  assert.match(renderRows([]), /colspan="7">No journals/);
});

test('each disclosure toggles independently, updates accessibility and closes again', () => {
  const details = [{ hidden: true }, { hidden: true }];
  const buttons = details.map((_, index) => ({
    attrs: { 'aria-controls': `external-audit-journal-lines-${index}`, 'aria-expanded': 'false' },
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(event, handler) { assert.equal(event, 'click'); this.click = handler; }
  }));
  vm.runInNewContext(`(${bindingSource})()`, {
    panelEl: { querySelectorAll: (selector) => selector === '[data-audit-toggle-lines]' ? buttons : [] },
    document: { getElementById: (id) => details[buttons.findIndex(button => button.attrs['aria-controls'] === id)] }
  });
  buttons[1].click();
  assert.equal(details[0].hidden, true);
  assert.equal(details[1].hidden, false);
  assert.equal(buttons[1].attrs['aria-expanded'], 'true');
  assert.equal(buttons[1].textContent, 'Hide lines');
  buttons[1].click();
  assert.equal(details[1].hidden, true);
  assert.equal(buttons[1].attrs['aria-expanded'], 'false');
  assert.equal(buttons[1].textContent, 'View lines');
});

test('layout keeps monetary columns aligned, wraps references and adapts to the panel width', () => {
  assert.match(source, /class="admin-table-wrap external-audit-journal-register"/);
  assert.match(source, /<th scope="col" class="audit-amount">Debit<\/th>/);
  assert.match(css, /\.external-audit-journal-register \.admin-table\{width:100%;min-width:0;table-layout:fixed\}/);
  assert.match(css, /\.audit-amount\{text-align:right;white-space:nowrap;overflow-wrap:normal;font-variant-numeric:tabular-nums\}/);
  assert.match(css, /@container audit-register \(max-width:900px\)/);
  assert.match(css, /\.audit-journal-detail\[hidden\]\{display:none!important\}/);
});

test('staff shell and offline cache are versioned for the journal layout repair', async () => {
  const html = await read('admin.html');
  assert.match(html, /css\/style\.css\?v=[^"]*audit-journal-layout/);
  assert.match(html, /js\/admin\.js\?v=[^"]*audit-journal-layout/);
  assertServiceWorkerCacheVersion(await read('sw.js'), 378);
});
