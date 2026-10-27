import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extractFunction, source } from './helpers/academic-register-fixture.mjs';
import { academicManagementCapabilities, academicWebActor } from '../functions/lib/academic-management.js';

const functions = ['academicRecordId', 'academicIsActive', 'academicSelectOptions', 'academicLearnerTerms',
  'academicManagementViews', 'academicManagementHeader', 'openAcademicClassScoreRegister', 'bindAcademicAreaNavigation'].map(extractFunction).join('\n');
const load = source.match(/async function loadAcademicManagement\([\s\S]*?\n}/)[0];
function client(role = 'Super Admin', mounted = false) {
  const calls = [], shown = [], handlers = {};
  const data = { permissions: academicManagementCapabilities(academicWebActor({ role, edition: 'school', allowedSections: ['academics'] })),
    sections: ['secondary'], sessions: [], terms: [], workspaceDataDeferred: true };
  const context = vm.createContext({ clean: value => String(value ?? '').trim(), escapeHtml: value => String(value ?? ''),
    currentUser: { role }, availableBranches: [{ id: 'main', name: 'Main Branch' }], selectedBranchId: 'main',
    academicManagementView: 'scorebook', academicManagementTaskViews: { scorebook: 'entry' },
    academicManagementFilters: { section: 'secondary', sessionId: 'session', termId: 'term' },
    academicManagementData: data, academicManagementLoadRequest: 0, activeSection: 'academics',
    panelEl: { querySelector: selector => selector === '[data-academic-class-score-register]' ? mounted ? {} : null
      : { addEventListener: (event, handler) => { handlers[`${selector}:${event}`] = handler; } } },
    document: { getElementById: () => ({}) }, setStatus: () => {},
    academicManagementRequest: async (action, payload) => { calls.push({ action, payload }); return data; },
    renderAcademicManagement: () => {}, showAcademicManagementTask: (...args) => shown.push(args)
  });
  vm.runInContext(functions + '\n' + load, context);
  return { context, calls, shown, data, handlers };
}

test('Super Admin header exposes a direct register button and area option even while scorebook records are deferred', () => {
  const f = client(); const html = f.context.academicManagementHeader(f.data, {});
  assert.match(html, /data-academic-open-score-register>Class score register<\/button>/);
  assert.match(html, /<option value="classRegister">Class score register<\/option>/);
});

test('direct navigation overrides remembered entry and requests only register selectors', async () => {
  const f = client(); f.context.bindAcademicAreaNavigation();
  f.handlers['[data-academic-open-score-register]:click']();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.context.academicManagementView, 'scorebook');
  assert.equal(f.context.academicManagementTaskViews.scorebook, 'classRegister');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].action, 'bootstrap');
  assert.equal(f.calls[0].payload.ScorebookTask, 'classRegister');
  assert.equal(f.calls[0].payload.WorkspaceLoadMode, 'navigation');
  assert.equal(f.calls[0].payload.RecordClassId, undefined);
});

test('area dropdown reaches the same register and reopening a mounted register makes no request', () => {
  const f = client('Super Admin', true); f.context.bindAcademicAreaNavigation();
  f.handlers['[data-academic-view-select]:change']({ currentTarget: { value: 'classRegister' } });
  assert.equal(f.calls.length, 0); assert.equal(f.shown.length, 1);
  assert.deepEqual(f.shown[0].slice(0, 2), ['scorebook', 'classRegister']);
  assert.match(f.context.academicManagementHeader(f.data, {}), /value="classRegister" selected/);
});

test('navigation preserves teacher classroom scope and does not expose the register to finance-only staff', () => {
  const teacher = client('Teacher');
  assert.match(teacher.context.academicManagementHeader(teacher.data, {}), /data-academic-open-score-register>My classroom scores/);
  assert.equal(teacher.data.permissions.canReviewScores, false);
  const denied = client('Accounts Officer');
  assert.doesNotMatch(denied.context.academicManagementHeader(denied.data, {}), /data-academic-open-score-register|value="classRegister"/);
  denied.context.openAcademicClassScoreRegister(); assert.equal(denied.calls.length, 0);
});
