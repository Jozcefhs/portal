import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('function studentAdmissionYearIntakeToolbar('), source.indexOf('function studentClassExportCsv('));
const clean = value => String(value ?? '').trim();
const user = { role: 'Super Admin', edition: 'school', allowedSections: ['students', 'accounts'] };

test('toolbar offers sessions from every class, explains the First Term rule, and removes Grade 7-only wording', () => {
  const render = vm.runInNewContext(`${block}\nstudentAdmissionYearIntakeToolbar`, { currentUser: user, clean, escapeHtml: clean });
  const html = render([{ ClassName: 'Grade 8', AcademicSession: '2026/2027' }, { ClassName: 'Primary 5', AcademicSession: '2027/2028' }]);
  assert.match(html, /First Term intake correction — all classes/);
  assert.match(html, /DCA\/26\/… qualifies in First Term 2026\/2027/);
  assert.match(html, /value="2026\/2027"/);
  assert.match(html, /value="2027\/2028"/);
  assert.doesNotMatch(html, /Review Grade 7|Grade 7 intake correction|data-grade7/);
  assert.match(source, /\+ studentAdmissionYearIntakeToolbar\(students\)/);
  assert.match(source, /bindStudentAdmissionYearIntake\(\);/);
});

function fixture({ confirm = true, fail = false } = {}) {
  const element = () => ({ hidden: false, disabled: false, value: '', textContent: '', listeners: {},
    addEventListener(name, fn) { this.listeners[name] = fn; } });
  const elements = Object.fromEntries(['session', 'preview', 'apply', 'status'].map(key => [`[data-intake-${key}]`, element()]));
  const select = elements['[data-intake-session]']; select.value = '2026/2027';
  const apply = elements['[data-intake-apply]'];
  const calls = [], confirmations = [], dashboardStatus = element();
  let remaining = 103, refreshed = false;
  const context = { currentUser: user, clean, escapeHtml: clean, dashboardStatus,
    panelEl: { querySelector: () => ({ querySelector: key => elements[key] }) },
    setStatus: (el, message) => { el.textContent = message; },
    setButtonLoading: (el, loading) => { el.disabled = loading; },
    loadDashboard: async () => { refreshed = true; },
    window: { DynamaxDialogs: { confirm: async options => { confirmations.push(options); return confirm; } } },
    staffFetch: async (_url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      if (body.action === 'applyIntakeCorrection') {
        assert.equal(select.disabled, true); assert.equal(apply.disabled, true);
        if (fail) throw new Error('Connection interrupted.');
        const updated = Math.min(100, remaining); remaining -= updated;
        return { ok: true, json: async () => ({ ok: true, updated, remaining }) };
      }
      return { ok: true, json: async () => ({ ok: true, total: 103, toChange: remaining, alreadyNew: 103 - remaining,
        academicSession: '2026/2027', branchId: 'main', schoolSectionAccess: 'all', previewToken: `remaining-${remaining}` }) };
    } };
  vm.runInNewContext(`${block}\nbindStudentAdmissionYearIntake();`, context);
  return { elements, calls, confirmations, dashboardStatus, isRefreshed: () => refreshed, select, apply };
}

test('review and apply keep controls locked during batches and use a fresh preview token each time', async () => {
  const f = fixture();
  await f.elements['[data-intake-preview]'].listeners.click();
  assert.equal(f.apply.disabled, false);
  assert.match(f.elements['[data-intake-status]'].textContent, /103 matching student record\(s\) across all classes/);
  await f.apply.listeners.click();
  assert.equal(f.confirmations.length, 1);
  assert.match(f.confirmations[0].message, /Existing invoices and payments will not be changed/);
  assert.deepEqual(f.calls.filter(call => call.action === 'applyIntakeCorrection').map(call => call.PreviewToken), ['remaining-103', 'remaining-3']);
  assert.equal(f.select.disabled, false);
  assert.equal(f.apply.disabled, true);
  assert.equal(f.isRefreshed(), true);
  assert.match(f.dashboardStatus.textContent, /103 student record\(s\) marked New Intake/);
});

test('cancel performs no writes; uncertain failure requires a fresh review before retrying', async () => {
  const cancelled = fixture({ confirm: false });
  await cancelled.elements['[data-intake-preview]'].listeners.click();
  await cancelled.apply.listeners.click();
  assert.equal(cancelled.calls.length, 1);
  assert.equal(cancelled.select.disabled, false);
  const failed = fixture({ fail: true });
  await failed.elements['[data-intake-preview]'].listeners.click();
  await failed.apply.listeners.click();
  assert.equal(failed.apply.disabled, true);
  assert.equal(failed.isRefreshed(), false);
  assert.match(failed.elements['[data-intake-status]'].textContent, /review the live records again before retrying/);
});
