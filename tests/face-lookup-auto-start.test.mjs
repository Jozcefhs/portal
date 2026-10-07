import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../js/student-face-lookup.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const lookupCode = source.slice(source.indexOf('export async function openStudentFaceLookup'), source.indexOf('async function staffAttendanceFaceRequest')).replace(/^export /, '');
const busyCode = source.slice(source.indexOf('function setBusy('), source.indexOf('function stopCamera('));

function control(text = '') {
  const handlers = new Map();
  return { textContent: text, dataset: {}, disabled: false, hidden: false, isConnected: true,
    addEventListener: (type, callback) => handlers.set(type, callback),
    click: async () => handlers.get('click')?.(),
    handlers };
}

function fixture({ facingMode = 'user', capture = async () => Array(1024).fill(0.25), cameraError = null, matchError = null, permission = true } = {}) {
  const start = control('Start camera');
  const retry = control('Retry scan');
  retry.disabled = true;
  const select = control();
  select.value = facingMode;
  const video = { srcObject: null };
  const progress = {};
  const status = {};
  const revoke = control();
  const cancel = control();
  const match = {};
  const elements = { '[data-face-video]': video, '[data-face-start]': start, '[data-face-capture]': retry,
    '[data-face-camera-select]': select, '[data-face-status]': status, '[data-face-match]': match,
    '[data-face-progress]': progress, '[data-face-revoke]': revoke };
  const dialog = { open: false, isConnected: true, cameraGeneration: 0,
    querySelector: key => elements[key] || null, querySelectorAll: () => [cancel],
    addEventListener: () => {}, showModal: () => { dialog.open = true; },
    close: () => { dialog.open = false; }, remove: () => { dialog.isConnected = false; } };
  const calls = { cameras: [], lookupCaptures: 0, guidedCaptures: 0, previews: 0, requests: [], matches: [], bound: null, markup: '' };
  const human = {};
  const context = {
    MODEL_ID: 'human-faceres-3.3.6', ENROLLMENT_SAMPLE_COUNT: 3, ROUTINE_SAMPLE_COUNT: 1,
    activeDialog: null, activeStream: null,
    document: { body: { lastElementChild: dialog, insertAdjacentHTML: (_position, markup) => { calls.markup = markup; } } },
    clean: value => String(value ?? '').trim(),
    dialogMarkup: mode => mode,
    initializeAudioGuidance: () => {}, stopAudioGuidance: () => {}, setGuideState: () => {},
    setStatus: (_dialog, message) => { status.textContent = message; },
    formatCameraError: error => error.message,
    bindCameraSelector: (_dialog, _button, options) => { calls.bound = options; },
    lockCaptureControls: (_dialog, locked) => { dialog.captureRunning = locked; start.disabled = locked; select.disabled = locked; },
    loadHuman: async () => human,
    startCamera: async () => {
      if (cameraError) throw cameraError;
      calls.cameras.push(select.value);
      video.srcObject = context.activeStream = {};
      dialog.cameraGeneration++;
      start.hidden = true;
    },
    stopCamera: () => { video.srcObject = context.activeStream = null; },
    previewFace: async () => { calls.previews++; },
    captureLookupDescriptor: async (_dialog, readyHuman) => { assert.equal(readyHuman, human); calls.lookupCaptures++; return capture(); },
    captureDescriptor: async (_dialog, readyHuman, count) => { assert.equal(readyHuman, human); assert.equal(count, 3); calls.guidedCaptures++; return Array(1024).fill(0.25); },
    renderPossibleMatch: (_dialog, result, callback) => { calls.matches.push(result); match.confirm = () => callback?.(result); },
    faceLookupRequest: async (action, payload) => {
      calls.requests.push({ action, payload });
      if (action === 'status') return { enabled: true, configured: true, canLookup: permission, canManage: true };
      if (action === 'match') {
        if (matchError) throw matchError;
        return { match: { id: 'SYNTHETIC-STUDENT', title: 'Synthetic test student' }, message: 'Confirm the possible match.' };
      }
      return { message: 'Enrolled.' };
    }
  };
  const open = runInNewContext(`${busyCode}\n${lookupCode}; openStudentFaceLookup`, context);
  return { open, calls, dialog, start, retry, select, video, status, human, match };
}

test('Start camera automatically captures and searches with either camera, but never opens a match without confirmation', async () => {
  for (const facingMode of ['user', 'environment']) {
    const f = fixture({ facingMode });
    let opened = 0;
    await f.open({ onMatch: () => { opened++; } });
    assert.equal(f.calls.cameras.length, 0, 'opening the dialog must not activate the camera');
    assert.match(f.status.textContent, /Scanning starts automatically/);
    await f.start.click();
    assert.deepEqual(f.calls.cameras, [facingMode]);
    assert.equal(f.calls.lookupCaptures, 1);
    assert.equal(f.calls.guidedCaptures, 0);
    assert.equal(f.calls.previews, 0, 'do not start an overlapping preview loop during automatic capture');
    assert.deepEqual(f.calls.requests.map(x => x.action), ['status', 'match']);
    assert.equal(f.calls.requests[1].payload.descriptor.length, 1024);
    assert.equal(f.video.srcObject, null, 'stop the camera after obtaining the query sample');
    assert.equal(f.retry.hidden, true);
    assert.equal(f.start.hidden, false);
    assert.equal(opened, 0);
    f.match.confirm();
    assert.equal(opened, 1);
  }
});

test('duplicate Start or capture clicks cannot create a second scan while auto capture is pending', async () => {
  let release;
  let started;
  const capturing = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({ capture: () => { started(); return pending; } });
  await f.open();
  const scanning = f.start.click();
  await capturing;
  assert.equal(f.dialog.captureRunning, true);
  assert.equal(f.select.disabled, true);
  await f.start.click();
  await f.retry.click();
  assert.equal(f.calls.lookupCaptures, 1);
  release(Array(1024).fill(0.25));
  await scanning;
  assert.equal(f.calls.requests.filter(x => x.action === 'match').length, 1);
  assert.equal(f.dialog.captureRunning, false);
  assert.equal(f.select.disabled, false);
});

test('a framing timeout exposes Retry scan and reuses the active stream without another camera click', async () => {
  let attempts = 0;
  const f = fixture({ capture: async () => {
    if (!attempts++) throw new Error('Capture paused. Move closer. Tap Retry scan to retry.');
    return Array(1024).fill(0.25);
  } });
  await f.open();
  await f.start.click();
  assert.equal(f.retry.hidden, false);
  assert.equal(f.retry.disabled, false);
  assert.match(f.status.textContent, /Capture paused/);
  await f.retry.click();
  assert.equal(f.calls.cameras.length, 1);
  assert.equal(f.calls.lookupCaptures, 2);
  assert.equal(f.calls.requests.filter(x => x.action === 'match').length, 1);
  assert.equal(f.retry.hidden, true);
});

test('a match request failure stops the camera and permits a fresh automatic scan', async () => {
  const f = fixture({ matchError: new Error('Network unavailable') });
  await f.open();
  await f.start.click();
  assert.match(f.status.textContent, /Network unavailable.*Start the camera to try again/);
  assert.equal(f.video.srcObject, null);
  assert.equal(f.start.hidden, false);
  assert.equal(f.start.disabled, false);
  assert.equal(f.retry.hidden, true);
  await f.start.click();
  assert.equal(f.calls.lookupCaptures, 2);
});

test('camera denial and missing lookup permission never trigger automatic capture', async () => {
  const denied = fixture({ cameraError: new Error('Camera denied') });
  await denied.open();
  await denied.start.click();
  assert.equal(denied.calls.lookupCaptures, 0);
  assert.equal(denied.start.disabled, false);
  assert.match(denied.status.textContent, /Camera denied/);
  const blocked = fixture({ permission: false });
  await blocked.open();
  await blocked.start.click();
  assert.equal(blocked.calls.cameras.length, 0);
  assert.equal(blocked.calls.lookupCaptures, 0);
});

test('closing the dialog during camera preparation cancels before automatic scanning starts', async () => {
  const f = fixture();
  await f.open();
  const preparing = f.start.click();
  f.dialog.open = false;
  await preparing;
  assert.equal(f.calls.lookupCaptures, 0);
  assert.equal(f.calls.requests.filter(x => x.action === 'match').length, 0);
  assert.equal(f.video.srcObject, null);
});

test('lookup hides the extra capture button until a scan or retry needs it, even with global button styles', () => {
  assert.match(source,/data-face-capture\$\{enrollment \? '' : ' hidden'\} disabled/);
  assert.match(css,/\.student-face-dialog>footer button\[hidden\]\{display:none\}/);
});

test('enrollment still previews first and waits for its explicit guided capture click', async () => {
  const f = fixture();
  await f.open({ mode: 'enroll', student: { id: 'SYNTHETIC-STUDENT' } });
  await f.start.click();
  assert.equal(f.calls.lookupCaptures, 0);
  assert.equal(f.calls.guidedCaptures, 0);
  assert.equal(f.calls.previews, 1);
  await f.retry.click();
  assert.equal(f.calls.guidedCaptures, 1);
  assert.deepEqual(f.calls.requests.map(x => x.action), ['status', 'enroll']);
});

test('changing an idle active lookup camera uses the same automatic capture callback', async () => {
  const f = fixture();
  await f.open();
  assert.equal(f.calls.bound.quickLookup, true);
  assert.equal(typeof f.calls.bound.onCameraReady, 'function');
  f.video.srcObject = {};
  f.retry.disabled = false;
  await f.calls.bound.onCameraReady(f.human);
  assert.equal(f.calls.lookupCaptures, 1);
  assert.equal(f.calls.requests.filter(x => x.action === 'match').length, 1);
  const selectorCode = source.slice(source.indexOf('function bindCameraSelector'),source.indexOf('function faceGeometry'));
  assert.match(selectorCode,/if \(quickLookup && onCameraReady\) await onCameraReady\(human\);\s*else void previewFace/);
});
