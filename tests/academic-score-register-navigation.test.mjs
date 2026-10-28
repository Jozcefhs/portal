import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extractFunction, source, fixture as workspaceFixture, renderWorkspace } from './helpers/academic-register-fixture.mjs';
import { academicManagementCapabilities, academicWebActor, getAcademicClassScoreRegister } from '../functions/lib/academic-management.js';

const functions = ['academicRecordId', 'academicIsActive', 'academicSelectOptions', 'academicLearnerTerms',
  'academicManagementViews', 'academicManagementHeader', 'focusAcademicClassScoreRegister', 'openAcademicClassScoreRegister', 'bindAcademicAreaNavigation'].map(extractFunction).join('\n');
const load = source.match(/async function loadAcademicManagement\([\s\S]*?\n}/)[0];
function client(role = 'Super Admin', mounted = false) {
  const calls = [], shown = [], handlers = {}, focused = [], scrolled = [], messages = [];
  const choice = { value: '', focus: () => focused.push('class') };
  const loadButton = { textContent: 'Load / refresh scores', disabled: false, focus: () => focused.push('load') };
  const headerButton = { disabled: false, addEventListener: (event, handler) => { handlers[`[data-academic-open-score-register]:${event}`] = handler; } };
  const form = { elements: { ClassId: choice }, hasAttribute: name => name === 'data-classroom-register',
    querySelector: selector => selector === '[type="submit"]' ? loadButton
      : selector === '.class-register-load-controls' ? { scrollIntoView: options => scrolled.push(options) } : null };
  const data = { permissions: academicManagementCapabilities(academicWebActor({ role, edition: 'school', allowedSections: ['academics'] })),
    sections: ['secondary'], sessions: [], terms: [], workspaceDataDeferred: true };
  const context = vm.createContext({ clean: value => String(value ?? '').trim(), escapeHtml: value => String(value ?? ''),
    currentUser: { role }, availableBranches: [{ id: 'main', name: 'Main Branch' }], selectedBranchId: 'main',
    academicManagementView: 'scorebook', academicManagementTaskViews: { scorebook: 'entry' },
    academicManagementFilters: { section: 'secondary', sessionId: 'session', termId: 'term' },
    academicManagementData: data, academicManagementLoadRequest: 0, activeSection: 'academics',
    panelEl: { querySelector: selector => selector === '[data-academic-class-score-register]' ? mounted ? form : null
      : selector === '[data-academic-open-score-register]' ? headerButton
      : { addEventListener: (event, handler) => { handlers[`${selector}:${event}`] = handler; } } },
    document: { getElementById: () => ({}) }, setStatus: (_node, message) => messages.push(message),
    academicManagementRequest: async (action, payload) => { calls.push({ action, payload }); return data; },
    renderAcademicManagement: () => {}, showAcademicManagementTask: (...args) => shown.push(args)
  });
  vm.runInContext(functions + '\n' + load, context);
  return { context, calls, shown, data, handlers, focused, scrolled, messages, choice, headerButton };
}

test('Super Admin header exposes a direct register button and area option even while scorebook records are deferred', () => {
  const f = client(); const html = f.context.academicManagementHeader(f.data, {});
  assert.match(html, /data-academic-open-score-register>Classroom score register<\/button>/);
  assert.match(html, /<option value="classRegister">Classroom score register<\/option>/);
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
  assert.deepEqual(f.focused, ['class']); assert.equal(f.scrolled.length, 1);
  assert.match(f.messages.at(-1), /Classroom score register is open.*Load \/ refresh scores/);
  assert.match(f.context.academicManagementHeader(f.data, {}), /value="classRegister" selected/);
});

test('reopening with a selected class focuses the explicit load action without requesting scores', () => {
  const f = client('Super Admin', true); f.choice.value = 'grade7';
  f.context.openAcademicClassScoreRegister();
  assert.deepEqual(f.focused, ['load']); assert.equal(f.scrolled.length, 1);
  assert.equal(f.calls.length, 0);
});

test('repeated header clicks during opening share the pending selector request', async () => {
  const f = client();
  const opening = f.context.openAcademicClassScoreRegister();
  assert.equal(f.headerButton.disabled, true);
  f.context.openAcademicClassScoreRegister();
  await opening;
  assert.equal(f.calls.length, 1); assert.equal(f.headerButton.disabled, false);
});

test('navigation preserves teacher classroom scope and does not expose the register to finance-only staff', () => {
  const teacher = client('Teacher');
  assert.match(teacher.context.academicManagementHeader(teacher.data, {}), /data-academic-open-score-register>My classroom scores/);
  assert.equal(teacher.data.permissions.canReviewScores, false);
  const denied = client('Accounts Officer');
  assert.doesNotMatch(denied.context.academicManagementHeader(denied.data, {}), /data-academic-open-score-register|value="classRegister"/);
  denied.context.openAcademicClassScoreRegister(); assert.equal(denied.calls.length, 0);
});

for (const role of ['Super Admin', 'Director', 'Admin', 'Principal', 'Vice Principal Academics', 'Vice Principal Administration',
  'Head Teacher', 'Assistant Head Teacher', 'Management', 'ICT', 'Examination Officer', 'Admissions Officer']) {
  test(`${role}: academic register navigation and viewing are available with module access`, async () => {
    const f = client(role);
    assert.equal(f.data.permissions.canViewClassScoreRegister, true);
    assert.match(f.context.academicManagementHeader(f.data, {}), /data-academic-open-score-register>Classroom score register/);
    const input = workspaceFixture(); input.data.permissions = f.data.permissions;
    assert.match(renderWorkspace('scorebook', input), /data-academic-class-score-register/);
    f.context.openAcademicClassScoreRegister();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls[0].payload.ScorebookTask, 'classRegister');
    for (const override of [{ allowedSections: [] }, { edition: 'faith' }, { edition: 'organization' }]) {
      const user = academicWebActor({ role, edition: 'school', allowedSections: ['academics'], ...override });
      assert.equal(academicManagementCapabilities(user).canViewClassScoreRegister, false);
      await assert.rejects(getAcademicClassScoreRegister({}, user, {}), { code: 'ACADEMIC_ACCESS_FORBIDDEN' });
    }
  });
}

test('new management viewers gain read-only web access without score editing, approval or publication', async () => {
  for (const role of ['Director', 'Admin', 'Admissions Officer']) {
    const f = client(role), permissions = f.data.permissions;
    for (const key of ['canEnterScores', 'canReviewScores', 'canApproveScores', 'canManageScoreCorrections', 'canCalculateResults', 'canPublishResults']) {
      assert.equal(permissions[key], false, `${role}: ${key}`);
    }
    const input = workspaceFixture(); input.data.permissions = permissions;
    const form = renderWorkspace('scorebook', input).match(/<form[^>]*data-academic-class-score-register>[\s\S]*?<\/form>/)[0];
    assert.match(form, /Preview \/ print/); assert.doesNotMatch(form, /data-class-register-reactivate/);
    await assert.rejects(getAcademicClassScoreRegister({}, { role, edition: 'school', allowedSections: ['academics'] }, {}), { code: 'ACADEMIC_ACCESS_FORBIDDEN' });
  }
  const departmentTeacher = academicManagementCapabilities(academicWebActor({ role: 'Department User', department: 'Academics', edition: 'school' }));
  assert.equal(departmentTeacher.canViewClassroomScores, true);
  assert.equal(departmentTeacher.canViewClassScoreRegister, false);
});
