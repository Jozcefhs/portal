import test from 'node:test';
import assert from 'node:assert/strict';
import { assertServiceWorkerCacheVersion } from './helpers/service-worker-cache-version.mjs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../js/staff-attendance-groups.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../css/staff-attendance-groups.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
const window = {};
runInNewContext(source, { window, FormData, Date, Map, Set });
const ui = window.DynamaxAttendanceGroups;
const rest = () => ({ Enabled: false, ResumptionTime: '08:00', ClosingTime: '17:00', EndDayOffset: 0 });
const day = () => ({ ...rest(), Enabled: true });
const fields = (overrides = {}) => ({ Name: 'Nurses', GroupId: '', ScheduleType: 'FIXED', GraceMinutes: '10', ClockInOpenMinutesBefore: '60', OvertimeMinimumMinutes: '15', ...overrides });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('fixed schedule serializes seven weekdays and independent group thresholds', () => {
  const group = ui.groupFromFields(fields(), Array.from({ length: 7 }, (_, i) => i < 5 ? day() : rest()));
  assert.deepEqual(Object.keys(group.DaySchedules), ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
  assert.equal(group.DaySchedules.SUN.Enabled, false);
  assert.equal(group.GraceMinutes, 10);
  assert.equal(group.ClockInOpenMinutesBefore, 60);
  assert.equal(group.OvertimeMinimumMinutes, 15);
  assert.equal(group.CycleDays, undefined);
});

test('24 hours on / 48 hours off is a three-calendar-day rotation', () => {
  const group = ui.groupFromFields(fields({ ScheduleType: 'ROTATING', AnchorDate: '2026-10-11' }), [
    { ...day(), ClosingTime: '08:00', EndDayOffset: 1 }, rest(), rest()
  ]);
  const preview = plain(ui.previewRows(group, '2026-10-11', 7));
  assert.deepEqual(preview.map((row) => row.slot.Enabled), [true, false, false, true, false, false, true]);
  assert.deepEqual(preview.map((row) => row.cycleDay), [1, 2, 3, 1, 2, 3, 1]);
  assert.equal(preview[0].slot.EndDayOffset, 1);
  assert.equal(group.DaySchedules, undefined);
});

test('preview treats the anchor as cycle day one even before that date', () => {
  const group = ui.groupFromFields(fields({ ScheduleType: 'ROTATING', AnchorDate: '2026-10-11' }), [day(), rest(), rest()]);
  assert.deepEqual(plain(ui.previewRows(group, '2026-10-09', 3)).map((row) => row.cycleDay), [2, 3, 1]);
});

test('fixed overnight schedule supports next-day finish and previews actual weekdays', () => {
  const slots = Array.from({ length: 7 }, rest);
  slots[6] = { ...day(), ResumptionTime: '19:00', ClosingTime: '07:00', EndDayOffset: 1 };
  const group = ui.groupFromFields(fields(), slots);
  assert.equal(ui.previewRows(group, '2026-10-11', 1)[0].slot.ResumptionTime, '19:00');
  assert.equal(ui.previewRows(group, '2026-10-12', 1)[0].slot.Enabled, false);
});

test('48-hour shifts are supported when enough rest days prevent overlap', () => {
  const group = ui.groupFromFields(fields({ ScheduleType: 'ROTATING', AnchorDate: '2026-10-11' }), [
    { ...day(), ClosingTime: '08:00', EndDayOffset: 2 }, rest(), rest(), rest()
  ]);
  assert.equal(group.CycleDays[0].EndDayOffset, 2);
});

test('overlap validation covers the weekly and rotating repeat boundaries', () => {
  const weekly = Array.from({ length: 7 }, rest);
  weekly[0] = day();
  weekly[6] = { ...day(), ClosingTime: '10:00', EndDayOffset: 1 };
  assert.throws(() => ui.groupFromFields(fields(), weekly), /overlap/);
  assert.throws(() => ui.groupFromFields(fields({ ScheduleType: 'ROTATING', AnchorDate: '2026-10-11' }), [
    { ...day(), ClosingTime: '09:00', EndDayOffset: 1 }
  ]), /overlap/);
});

test('invalid durations, dates, thresholds and empty rotations are rejected', () => {
  assert.throws(() => ui.groupFromFields(fields(), Array.from({ length: 7 }, rest)), /at least one/);
  assert.throws(() => ui.groupFromFields(fields(), [{ ...day(), ClosingTime: '07:00' }, ...Array.from({ length: 6 }, rest)]), /valid hours/);
  assert.throws(() => ui.groupFromFields(fields({ ScheduleType: 'ROTATING', AnchorDate: '2026-02-30' }), [day()]), /valid date/);
  assert.throws(() => ui.groupFromFields(fields({ GraceMinutes: '1.5' }), Array.from({ length: 7 }, day)), /whole number/);
  assert.throws(() => ui.groupFromFields(fields({ ScheduleType: 'ROTATING', AnchorDate: '2026-10-11' }), Array.from({ length: 63 }, day)), /1–62/);
  assert.throws(() => ui.groupFromFields(fields({ Name: ' ' }), Array.from({ length: 7 }, day)), /group name/);
});

test('rest days retain valid serialized times even if a time was cleared before unticking the day', () => {
  const group = ui.groupFromFields(fields(), [day(), { ...rest(), ResumptionTime: '', ClosingTime: '' }, ...Array.from({ length: 5 }, rest)]);
  assert.equal(group.DaySchedules.TUE.Enabled, false);
  assert.equal(group.DaySchedules.TUE.ResumptionTime, '08:00');
  assert.equal(group.DaySchedules.TUE.ClosingTime, '17:00');
});

test('one-day and 62-day rotations are valid at the supported bounds', () => {
  for (const length of [1, 62]) {
    const group = ui.groupFromFields(fields({ ScheduleType: 'ROTATING', AnchorDate: '2026-10-11' }), Array.from({ length }, day));
    assert.equal(group.CycleDays.length, length);
  }
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: manager UI is capability-gated and does not expose roster controls to ordinary staff`, () => {
    assert.match(ui.render({ edition, capabilities: { canManage: true }, policy: {} }), /Assign staff to groups/);
    assert.equal(ui.render({ edition, capabilities: { canManage: false }, roster: { Groups: [{ Name: 'Private' }] } }), '');
  });
}

function fakeElement() {
  return {
    value: '', innerHTML: '', textContent: '', className: '', disabled: false, isConnected: true,
    listeners: new Map(), dataset: {},
    addEventListener(event, handler) { this.listeners.set(event, handler); },
    async fire(event, target = this) { return this.listeners.get(event)?.({ target, preventDefault() {} }); },
    insertAdjacentHTML(_where, html) { this.innerHTML += html; },
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

function controller() {
  const selectors = ['[data-group-editor]', '[data-group-status]', '[data-group-list]', '[data-staff-search]', '[data-staff-department]', '[data-assignment-count]', '[data-assignment-list]', '[data-pending-count]', '[data-save-assignments]'];
  const nodes = new Map(selectors.map((key) => [key, fakeElement()]));
  const root = fakeElement();
  root.querySelector = (selector) => nodes.get(selector);
  root.querySelectorAll = () => [...nodes.values()];
  const calls = [];
  let reloads = 0;
  let fail = false;
  const data = {
    capabilities: { canManage: true }, todayAttendanceDate: '2026-10-11', policy: {},
    roster: { Revision: 'current-version', Groups: [
      { GroupId: 'nurses', Name: 'Nurses <script>', ScheduleType: 'FIXED' },
      { GroupId: 'security', Name: 'Security', ScheduleType: 'ROTATING', AnchorDate: '2026-10-11', CycleDays: [day(), rest(), rest()] }
    ], Assignments: [
      { Username: 'alice', GroupId: 'security', EffectiveFrom: '2026-10-12' },
      { Username: 'alice', GroupId: 'nurses', EffectiveFrom: '2026-10-10' },
      { Username: 'alice', GroupId: '', EffectiveFrom: '2026-10-01' }
    ] },
    staffDirectory: [
      { Username: 'alice', DisplayName: 'Alice <img>', Department: 'Clinic', Role: 'Clinic User' },
      { Username: 'bob', DisplayName: 'Bob', Department: 'Security', Role: 'Department User' }
    ]
  };
  ui.mount(root, { data, request: async (action, body) => { calls.push({ action, body: plain(body) }); if (fail) throw new Error('Concurrent update. Refresh.'); return { ok: true }; }, reload: async () => { reloads += 1; }, confirm: async () => true, onDirty() {} });
  const assignment = (username, value) => ({ dataset: { staffUsername: username }, value, closest() { return this; } });
  const save = { closest() { return this; }, matches(selector) { return selector === '[data-save-assignments]'; } };
  return { nodes, calls, root, assignment, save, reloads: () => reloads, reject: () => { fail = true; } };
}

test('assignment list uses latest effective history, escapes names and retains historical groups', () => {
  const view = controller();
  const list = view.nodes.get('[data-assignment-list]').innerHTML;
  assert.match(list, /value="nurses" selected/);
  assert.doesNotMatch(list, /value="security" selected/);
  assert.match(list, /Alice &lt;img&gt;/);
  assert.match(list, /Nurses &lt;script&gt;/);
  assert.match(view.nodes.get('[data-group-list]').innerHTML, /historical assignments/);
});

test('staff assignment search/department filters preserve unsaved changes across redraws', async () => {
  const view = controller();
  await view.nodes.get('[data-assignment-list]').fire('change', view.assignment('alice', 'security'));
  view.nodes.get('[data-staff-search]').value = 'bob';
  await view.nodes.get('[data-staff-search]').fire('input');
  assert.match(view.nodes.get('[data-assignment-count]').textContent, /1 of 2/);
  assert.doesNotMatch(view.nodes.get('[data-assignment-list]').innerHTML, /Alice/);
  view.nodes.get('[data-staff-search]').value = '';
  view.nodes.get('[data-staff-department]').value = 'Clinic';
  await view.nodes.get('[data-staff-department]').fire('change');
  assert.match(view.nodes.get('[data-assignment-list]').innerHTML, /value="security" selected/);
  assert.match(view.nodes.get('[data-pending-count]').textContent, /1 unsaved assignment/);
});

test('clear assignment sends only the changed staff and current revision, then reloads', async () => {
  const view = controller();
  await view.nodes.get('[data-assignment-list]').fire('change', view.assignment('alice', ''));
  await view.root.fire('click', view.save);
  assert.deepEqual(view.calls, [{ action: 'assigngroups', body: { ExpectedRevision: 'current-version', Assignments: [{ Username: 'alice', GroupId: '' }] } }]);
  assert.equal(view.reloads(), 1);
});

test('failed concurrent saves retain pending edits and show the server error', async () => {
  const view = controller();
  view.reject();
  await view.nodes.get('[data-assignment-list]').fire('change', view.assignment('alice', 'security'));
  await view.root.fire('click', view.save);
  assert.match(view.nodes.get('[data-group-status]').textContent, /Concurrent update/);
  assert.equal(view.reloads(), 0);
  assert.match(view.nodes.get('[data-pending-count]').textContent, /1 unsaved/);
  assert.equal(view.nodes.get('[data-save-assignments]').disabled, false);
});

test('personal UI uses assigned policy and shift date; off-duty staff cannot clock in', () => {
  assert.match(admin, /const myPolicy = data\.myPolicy \|\| policy/);
  assert.match(admin, /const todaySchedule = data\.todaySchedule \|\| \(currentShift \? \{ \.\.\.currentShift, Enabled: true \}/);
  assert.match(admin, /const stateOffDuty = data\.state === 'OFF_DUTY'/);
  assert.match(admin, /sites\.length && !stateComplete && !stateOffDuty && nextDirection/);
  assert.match(admin, /clean\(data\.attendanceDate \|\| data\.todayAttendanceDate\)/);
  assert.match(admin, /name="AttendanceDate" type="date"/);
  assert.match(admin, /DynamaxAttendanceGroups\?\.mount/);
  assert.match(admin, /key: 'groups', label: 'Attendance groups'/);
});

function dashboardHtml(data) {
  const dashboardClockEl = { innerHTML: '' };
  const start = admin.indexOf('function renderDashboardTimeAttendance(');
  const end = admin.indexOf('function dashboardPresencePollingAllowed(', start);
  const render = runInNewContext(`${admin.slice(start, end)}\nrenderDashboardTimeAttendance`, {
    dashboardClockEl, currentUser: null, activeSection: 'overview', dashboardAttendanceCache: null,
    dashboardClockTimeZone: 'Africa/Lagos', DynamaxTime: { DEFAULT_TIME_ZONE: 'Africa/Lagos' },
    clean: (value) => String(value ?? '').trim(), escapeHtml: (value) => String(value ?? '').replace(/</g, '&lt;'),
    announceRandomPresenceConfirmation() {}, warmAttendanceIdentity() {},
    dashboardAttendanceSiteStorageKey() { return 'site'; }, attendanceDashboardAllowed() { return true; },
    updateDashboardClockFace() {}, dashboardAttendanceTime(value) { return value; },
    document: { getElementById() { return null; } }, window: { localStorage: { getItem() { return ''; } } }
  });
  render(data);
  return dashboardClockEl.innerHTML;
}

test('dashboard renders off-duty group rest days with disabled clock action', () => {
  const html = dashboardHtml({ state: 'OFF_DUTY', nextDirection: '', selfgroup: { Name: 'Security B' },
    todaySchedule: { Enabled: false }, sites: [{ SiteId: 'main', Name: 'Main gate' }], policy: {} });
  assert.match(html, /Security B/);
  assert.match(html, /No shift scheduled \/ shift ended/);
  assert.match(html, /id="dashboardAttendanceClockButton" disabled>Off duty/);
});

test('dashboard shows overnight shift date and keeps clock-out available after midnight', () => {
  const html = dashboardHtml({ state: 'CLOCKED_IN', nextDirection: 'OUT', attendanceDate: '2026-10-10',
    currentShift: { GroupName: 'Nurses night', ResumptionTime: '19:00', ClosingTime: '07:00', EndDayOffset: 1 },
    sites: [{ SiteId: 'main', Name: 'Clinic' }], policy: {}, myPolicy: {} });
  assert.match(html, /Shift date: 2026-10-10/);
  assert.match(html, /19:00-07:00 \(\+1 day\)/);
  assert.match(html, /id="dashboardAttendanceClockButton" >Clock out/);
});

test('dashboard midnight refresh uses calendar date while presence uses shift date', () => {
  assert.match(admin, /attendanceDate !== clean\(dashboardAttendanceCache\.data\.todayCalendarDate \|\| dashboardAttendanceCache\.data\.todayAttendanceDate\)/);
  assert.match(admin, /clean\(state\.attendanceDate\) !== clean\(cached\.attendanceDate \|\| cached\.todayAttendanceDate\)/);
  assert.match(source, /data\.todayCalendarDate \|\| data\.todayAttendanceDate \|\| data\.attendanceDate/);
});

test('group editor and staff assignment cards use responsive layouts without narrow button wrapping', () => {
  assert.match(styles, /@media \(max-width: 640px\)/);
  assert.match(styles, /word-break: normal; overflow-wrap: normal/);
  assert.match(styles, /\[hidden\] \{ display: none !important/);
  assert.match(styles, /\.attendance-group-filters, \.attendance-groups-workspace \.attendance-group-person \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test('attendance group assets are versioned, cached and loaded before the admin controller', () => {
  assert.match(html, /css\/staff-attendance-groups\.css\?v=20261011-attendance-groups/);
  const helper = html.search(/src="js\/staff-attendance-groups\.js\?v=20261011-attendance-groups[^"\n]*"/);
  const controller = html.indexOf('src="js/admin.js?v=');
  assert.ok(helper > 0 && controller > helper);
  assert.match(html, /js\/admin\.js\?v=[^"\n]*attendance-groups/);
  assertServiceWorkerCacheVersion(serviceWorker, 378);
  assert.match(serviceWorker, /SHELL\.push\('\/css\/staff-attendance-groups\.css', '\/js\/staff-attendance-groups\.js'\)/);
});
