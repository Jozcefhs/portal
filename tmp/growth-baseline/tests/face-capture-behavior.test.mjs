import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { eyeOpenness, blinkFrameState, waitForCameraFrames, captureReadiness, captureDescriptor, captureLookupDescriptor, faceGuideSize } from '../js/student-face-lookup.js';
import { randomLivenessChallenge, validateLivenessEvidence } from '../functions/api/staff-attendance-face.js';

function faceEyes(gap, rotation = 0) {
  const mesh = Array.from({ length: 468 }, () => [0, 0, 0]);
  for (const [top, bottom, outer, inner, offset] of [[374,386,263,362,0], [145,159,33,133,50]]) {
    mesh[top] = [offset + 10, -gap / 2, 0];
    mesh[bottom] = [offset + 10, gap / 2, 0];
    mesh[outer] = [offset, 0, 0];
    mesh[inner] = [offset + 20, 0, 0];
  }
  return { mesh: mesh.map(([x,y,z]) => [x*Math.cos(rotation)-y*Math.sin(rotation), x*Math.sin(rotation)+y*Math.cos(rotation), z]) };
}

test('blink uses eye corners and is invariant to head roll', () => {
  const open = faceEyes(6);
  const baseline = eyeOpenness(open);
  assert.equal(baseline.left, 0.3);
  assert.ok(Math.abs(eyeOpenness(faceEyes(6, 0.4)).left - 0.3) < 1e-10);
  assert.deepEqual(blinkFrameState(open, baseline), { open: true, closed: false });
  assert.deepEqual(blinkFrameState(faceEyes(1), baseline), { open: false, closed: true });
  assert.deepEqual(blinkFrameState({}), { open: false, closed: false });
  assert.equal(blinkFrameState(faceEyes(1)).closed, false, 'cannot pass a blink without an open-eye baseline');
});

test('capture directions agree with the bundled Human rotation implementation', async () => {
  const source = await readFile(new URL('../vendor/human/human.esm.js', import.meta.url), 'utf8');
  const start = source.indexOf('var calculateFaceAngle =');
  const end = source.indexOf('// src/face/anthropometry.ts', start);
  assert.ok(start >= 0 && end > start);
  const calculate = runInNewContext(`${source.slice(start, end)}; calculateFaceAngle`);
  for (const [depth, direction] of [[0.2, 'left'], [-0.2, 'right']]) {
    const mesh = Array.from({length:468}, () => [0.5, 0.5, 0]);
    mesh[10] = [0.5, 0.2, 0]; mesh[152] = [0.5, 0.8, 0];
    mesh[234] = [0.2, 0.5, -depth]; mesh[454] = [0.8, 0.5, depth];
    const angle = calculate({meshRaw:mesh, boxRaw:[0.2,0.2,0.6,0.6]}, [640,480]).angle;
    assert.ok(direction === 'left' ? angle.yaw < -0.22 : angle.yaw > 0.22);
  }
});

test('camera readiness handles an immediate first frame without missing the event', async () => {
  const video = new EventTarget();
  Object.defineProperty(video, 'srcObject', { set(value) {
    this.stream = value; this.readyState = 2; this.videoWidth = 640; this.videoHeight = 480;
    this.dispatchEvent(new Event('loadeddata'));
  }});
  video.play = async () => {};
  const stream = {};
  await waitForCameraFrames(video, stream);
  assert.equal(video.stream, stream);
});

test('camera playback errors are returned rather than hanging capture', async () => {
  const video = new EventTarget();
  video.play = async () => { throw new Error('camera busy'); };
  await assert.rejects(waitForCameraFrames(video, {}), /camera busy/);
});

test('front and back selections request their own camera and use the actual stream orientation', async () => {
  const source = await readFile(new URL('../js/student-face-lookup.js', import.meta.url), 'utf8');
  const cameraCode = source.slice(source.indexOf('function selectedCameraFacingMode'), source.indexOf('export function faceGuideSize'));
  for (const facingMode of ['user', 'environment']) {
    let constraints;
    let orientation;
    const stream = { getTracks: () => [], getVideoTracks: () => [{ getSettings: () => ({ facingMode }) }] };
    const video = { srcObject: null };
    const select = { value: facingMode };
    const start = { hidden: false };
    const camera = { setAttribute: (name, value) => { if (name === 'data-facing-mode') orientation = value; } };
    const dialog = { open: true, isConnected: true, cameraGeneration: 1,
      querySelector: key => ({ '[data-face-video]': video, '[data-face-camera-select]': select,
        '[data-face-start]': start, '.student-face-camera': camera })[key] || null };
    const startCamera = runInNewContext(`${cameraCode}; startCamera`, {
      navigator: { mediaDevices: { getUserMedia: async value => { constraints = value; return stream; } } },
      clean: value => String(value ?? '').trim(), activeStream: null,
      stopCamera: () => {}, setStatus: () => {}, updateCameraLayout: () => {},
      waitForCameraFrames: async (target, value) => { target.srcObject = value; }
    });
    await startCamera(dialog);
    assert.equal(constraints.video.facingMode.ideal, facingMode);
    assert.equal(constraints.audio, false);
    assert.equal(orientation, facingMode);
    assert.equal(video.srcObject, stream);
    assert.equal(start.hidden, true);
  }
});

test('a possible lookup match cannot open a record until staff press confirm', async () => {
  const source = await readFile(new URL('../js/student-face-lookup.js', import.meta.url), 'utf8');
  const rendererCode = source.slice(source.indexOf('function renderPossibleMatch'), source.indexOf('export async function openStudentFaceLookup'));
  const render = runInNewContext(`${rendererCode}; renderPossibleMatch`, {
    clean: value => String(value ?? '').trim(), escapeHtml: value => String(value)
  });
  const confirm = new EventTarget();
  const container = { hidden: true, querySelector: () => confirm };
  let opened = 0;
  let closed = 0;
  const dialog = { querySelector: () => container, close: () => { closed++; } };
  const match = { id: 'TEST-STUDENT', title: 'Synthetic test student', scoreBand: 'very-high' };
  render(dialog, match, value => { assert.equal(value, match); opened++; });
  assert.equal(container.hidden, false);
  assert.match(container.innerHTML, /Confirm the student visually/);
  assert.equal(opened, 0);
  assert.equal(closed, 0);
  confirm.dispatchEvent(new Event('click'));
  assert.equal(opened, 1);
  assert.equal(closed, 1);
});

test('face guidance refuses low confidence, tiny, clipped and off-centre captures', () => {
  const video = { videoWidth: 640, videoHeight: 480 };
  const good = { faceScore: 0.9, box: [240, 100, 160, 230] };
  assert.equal(captureReadiness(good, video).ready, true);
  assert.equal(captureReadiness({ ...good, faceScore: 0.4 }, video).ready, false);
  assert.equal(captureReadiness({ ...good, box: [300,200,40,60] }, video).ready, false);
  assert.equal(captureReadiness({ ...good, box: [10,0,440,450] }, video).ready, false);
  assert.equal(captureReadiness({ ...good, box: [560,100,160,230] }, video).ready, false);
});

test('portrait and landscape guides keep face proportions and accept a face that fits the actual frame', () => {
  for (const [width, height] of [[480, 640], [640, 480], [360, 640], [1280, 720]]) {
    const guide = faceGuideSize(width, height);
    assert.ok(Math.abs((guide.width * width) / (guide.height * height) - 0.76) < 0.001);
    assert.ok(guide.width <= 78.001 && guide.height <= 76.001);
  }
  const video = { videoWidth: 480, videoHeight: 640 };
  assert.equal(captureReadiness({ faceScore: 0.9, box: [100, 100, 270, 430] }, video).ready, true);
  assert.equal(captureReadiness({ faceScore: 0.9, box: [-5, 100, 270, 430] }, video).ready, false);
});

test('new server challenges use head turns and validation still rejects incomplete or wrong evidence', () => {
  for (let index = 0; index < 100; index++) {
    const challenge = randomLivenessChallenge();
    assert.ok(['TURN_LEFT', 'TURN_RIGHT'].includes(challenge.action));
    assert.match(challenge.instruction, /hold/);
  }
  const valid = { action: 'TURN_LEFT', completed: true, neutralEstablished: true, actionObserved: true,
    returnedToCentre: true, durationMs: 2000, observedGesture: 'facing left', maximumAbsoluteYawDelta: 0.3 };
  assert.doesNotThrow(() => validateLivenessEvidence('TURN_LEFT', valid));
  for (const invalid of [{ returnedToCentre: false }, { actionObserved: false }, { neutralEstablished: false },
    { maximumAbsoluteYawDelta: 0.05 }, { observedGesture: 'facing right' }, { action: 'BLINK' }]) {
    assert.throws(() => validateLivenessEvidence('TURN_LEFT', { ...valid, ...invalid }));
  }
});

function liveFrame({ yaw = 0, pitch = 0.32, gap = 2.4, gesture = '', count = 1 } = {}) {
  const face = { ...faceEyes(gap), faceScore: 0.95, box: [100, 100, 270, 430],
    rotation: { angle: { yaw, pitch, roll: 0.04 } } };
  return { face: Array.from({ length: count }, () => structuredClone(face)),
    gesture: gesture ? [{ face: 0, gesture }] : [] };
}

function captureHarness(t, frames, { inferenceMs = 350, videoSize = [480, 640], facingMode = 'user', embedding = Array(1024).fill(0.25) } = {}) {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  globalThis.window = { setTimeout: callback => { now += 50; queueMicrotask(callback); } };
  t.after(() => { delete globalThis.window; });
  const video = { videoWidth: videoSize[0], videoHeight: videoSize[1], srcObject: { getVideoTracks: () => [{ readyState: 'live', getSettings: () => ({ facingMode }) }] } };
  const elements = { '[data-face-video]': video, '[data-face-progress]': {}, '[data-face-status]': {}, '.student-face-guide': {} };
  const dialog = { open: true, isConnected: true, cameraGeneration: 1, querySelector: key => elements[key] || null };
  let index = 0;
  const detections = [];
  const human = { detect: async (_video, options) => {
    now += inferenceMs;
    const frame = structuredClone(frames[Math.min(index++, frames.length - 1)]);
    detections.push(options.face.description.enabled);
    if (options.face.description.enabled) for (const face of frame.face) face.embedding = embedding;
    return frame;
  } };
  return { dialog, human, detections, video, elements };
}

test('slow portrait capture finishes with a gentle turn, natural narrow eyes and no blink', async t => {
  const still = liveFrame();
  const { dialog, human, detections } = captureHarness(t, [still, still, still,
    liveFrame({ yaw: -0.3, gesture: 'facing left' }), still, still, still, still, still]);
  let evidence;
  const descriptor = await captureDescriptor(dialog, human, 3, { onLivenessEvidence: value => { evidence = value; } });
  assert.equal(descriptor.length, 1024);
  assert.equal(descriptor[0], 0.25);
  assert.equal(evidence.action, 'TURN_LEFT');
  assert.equal(evidence.blinkClosedSeen, false);
  assert.equal(evidence.actionObserved, true);
  assert.equal(evidence.returnedToCentre, true);
  assert.equal(evidence.observedGesture, 'facing left');
  assert.ok(detections.slice(0, 6).every(value => value === false), 'descriptor work waits until the live action finishes');
});

test('head-turn enrollment works when a phone omits gesture labels and eye landmarks', async t => {
  const frames = [liveFrame(), liveFrame(), liveFrame(), liveFrame({ yaw: -0.3 }),
    liveFrame(), liveFrame(), liveFrame(), liveFrame(), liveFrame()];
  frames.forEach((frame) => frame.face.forEach((face) => { face.mesh = []; }));
  const { dialog, human } = captureHarness(t, frames);
  let evidence;
  const descriptor = await captureDescriptor(dialog, human, 3, {
    onLivenessEvidence: value => { evidence = value; }
  });
  assert.equal(descriptor.length, 1024);
  assert.equal(evidence.observedGesture, 'facing left');
  assert.equal(evidence.returnedToCentre, true);
});

test('slow mobile inference has enough time for a complete live action and samples', async t => {
  const still = liveFrame();
  const { dialog, human } = captureHarness(t, [still, still, still, liveFrame({ yaw: -0.3 }),
    still, still, still, still, still], { inferenceMs: 3500 });
  const descriptor = await captureDescriptor(dialog, human, 3);
  assert.equal(descriptor.length, 1024);
});

test('signed right-turn and legacy blink challenges require their own movement sequence', async t => {
  const still = liveFrame();
  for (const [challenge, action] of [
    [{ action: 'TURN_RIGHT' }, liveFrame({ yaw: 0.3 })],
    [{ action: 'BLINK' }, liveFrame({ gap: 0.7 })]
  ]) {
    const { dialog, human } = captureHarness(t, [still, still, still, action, action, still, still, still]);
    let evidence;
    await captureDescriptor(dialog, human, 1, { challenge, onLivenessEvidence: value => { evidence = value; } });
    assert.equal(evidence.action, challenge.action);
    assert.equal(evidence.completed, true);
    assert.equal(evidence.blinkClosedSeen, challenge.action === 'BLINK');
  }
});

test('static frames, a wrong direction and a face that never returns cannot pass capture', async t => {
  const still = liveFrame();
  for (const frames of [
    [still],
    [still, still, still, liveFrame({ yaw: 0.3, gesture: 'facing right' }), still],
    [still, still, still, liveFrame({ yaw: -0.3, gesture: 'facing left' })]
  ]) {
    const { dialog, human } = captureHarness(t, frames, { inferenceMs: 600 });
    let evidence;
    await assert.rejects(captureDescriptor(dialog, human, 1, { onLivenessEvidence: value => { evidence = value; } }), /Capture paused/);
    assert.equal(evidence, undefined);
  }
});

test('another person entering the frame invalidates the observed live action', async t => {
  const still = liveFrame();
  const { dialog, human } = captureHarness(t, [still, still, still,
    liveFrame({ yaw: -0.3, gesture: 'facing left' }), liveFrame({ count: 2 }), still]);
  await assert.rejects(captureDescriptor(dialog, human, 1), /Capture paused/);
});

test('closing the dialog during inference cancels before evidence or a descriptor is returned', async () => {
  globalThis.window = { setTimeout };
  const stream = { getVideoTracks: () => [{ readyState: 'live' }] };
  const video = { srcObject: stream };
  const progress = {};
  const status = {};
  const dialog = { open: true, isConnected: true, cameraGeneration: 1,
    querySelector: (selector) => ({ '[data-face-video]': video, '[data-face-progress]': progress, '[data-face-status]': status })[selector] || null };
  let detectStarted;
  const started = new Promise((resolve) => { detectStarted = resolve; });
  let finishDetect;
  const human = { detect: () => { detectStarted(); return new Promise((resolve) => { finishDetect = resolve; }); } };
  let evidence = false;
  const capture = captureDescriptor(dialog, human, 1, { onLivenessEvidence: () => { evidence = true; } });
  await started;
  dialog.open = false;
  finishDetect({ face: [] });
  await assert.rejects(capture, /cancelled/);
  assert.equal(evidence, false);
  delete globalThis.window;
});

test('Human error results fail immediately and do not poison the next capture', async t => {
  const still = liveFrame();
  const { dialog, human } = captureHarness(t, [{error:'Camera frame unavailable', face:[]}]);
  await assert.rejects(captureDescriptor(dialog, human, 1), /Face detection could not run.*Camera frame unavailable/);
  const retry = captureHarness(t, [still, still, still, liveFrame({yaw:-0.3}), still, still, still]);
  assert.equal((await captureDescriptor(retry.dialog, retry.human, 1)).length, 1024);
});

test('assisted lookup succeeds with three straight-facing frames on front and back cameras, without movement or eye landmarks', async t => {
  for (const [facingMode, videoSize, box] of [
    ['user', [480, 640], [100, 100, 270, 430]],
    ['environment', [640, 480], [180, 80, 230, 300]]
  ]) {
    const still = liveFrame();
    still.face[0].box = box;
    still.face[0].mesh = [];
    const { dialog, human, detections, elements } = captureHarness(t, [still], { facingMode, videoSize });
    const descriptor = await captureLookupDescriptor(dialog, human);
    assert.equal(descriptor.length, 1024);
    assert.equal(descriptor[0], 0.25);
    assert.deepEqual(detections, [false, false, true]);
    assert.equal(elements['[data-face-progress]'].value, 1);
    assert.equal(elements['[data-face-progress]'].hidden, true);
    assert.match(elements['[data-face-status]'].textContent, /possible match/);
    assert.doesNotMatch(elements['[data-face-status]'].textContent, /Live check|verified/);
  }
});

test('lookup resets steady-frame calibration when another person enters, then can safely retry', async t => {
  const still = liveFrame();
  const { dialog, human, detections } = captureHarness(t, [still, still, liveFrame({ count: 2 }), still, still, still]);
  assert.equal((await captureLookupDescriptor(dialog, human)).length, 1024);
  assert.deepEqual(detections, [false, false, true, false, false, true]);
});

test('lookup rejects missing, multiple, low-quality, tiny, clipped, off-centre or non-frontal faces', async t => {
  const badFrames = [liveFrame({ count: 0 }), liveFrame({ count: 2 }), liveFrame({ yaw: 0.6 })];
  for (const change of [{ faceScore: 0.3 }, { box: [210, 260, 30, 40] },
    { box: [-10, 100, 270, 430] }, { box: [0, 0, 140, 130] }, { rotation: {} }]) {
    const frame = liveFrame();
    Object.assign(frame.face[0], change);
    badFrames.push(frame);
  }
  for (const badFrame of badFrames) {
    const { dialog, human, detections, elements } = captureHarness(t, [badFrame], { inferenceMs: 6000 });
    await assert.rejects(captureLookupDescriptor(dialog, human), /Capture paused/);
    assert.ok(detections.every(value => value === false));
    assert.equal(elements['[data-face-progress]'].hidden, true);
  }
});

test('lookup requires a finite 1024-value descriptor even when the pose and face are good', async t => {
  for (const embedding of [null, Array(1023).fill(0.25), Array(1024).fill(NaN), Array(1024).fill(Infinity), Array(1024).fill('0.25')]) {
    const { dialog, human, elements } = captureHarness(t, [liveFrame()], { embedding, inferenceMs: 6000 });
    await assert.rejects(captureLookupDescriptor(dialog, human), /Capture paused/);
    assert.equal(elements['[data-face-progress]'].value, 0);
  }
});

test('lookup cannot combine unstable poses or good frames separated by poor framing', async t => {
  for (const alternate of [liveFrame({ yaw: 0.15 }), liveFrame({ count: 0 })]) {
    const frames = Array.from({ length: 80 }, (_, index) => index % 2 ? alternate : liveFrame());
    const { dialog, human, detections } = captureHarness(t, frames, { inferenceMs: 1000 });
    await assert.rejects(captureLookupDescriptor(dialog, human), /Capture paused/);
    assert.ok(detections.every(value => value === false));
  }
});

test('lookup cancels a pending inference when the dialog closes, camera changes or track ends', async t => {
  for (const cancel of [
    ({ dialog }) => { dialog.open = false; },
    ({ dialog }) => { dialog.isConnected = false; },
    ({ dialog }) => { dialog.cameraGeneration += 1; },
    ({ video }) => { video.srcObject = {}; },
    ({ video }) => { video.srcObject.getVideoTracks = () => [{ readyState: 'ended' }]; }
  ]) {
    const harness = captureHarness(t, [liveFrame()]);
    const detect = harness.human.detect;
    harness.human.detect = async (...args) => {
      const frame = await detect(...args);
      cancel(harness);
      return frame;
    };
    await assert.rejects(captureLookupDescriptor(harness.dialog, harness.human), /lookup was cancelled/);
    assert.equal(harness.elements['[data-face-progress]'].hidden, true);
    assert.equal(harness.elements['[data-face-progress]'].value, 0);
  }
});

test('lookup reports Human errors immediately and the next quick capture can recover', async t => {
  const failed = captureHarness(t, [{ error: 'Camera frame unavailable', face: [] }]);
  await assert.rejects(captureLookupDescriptor(failed.dialog, failed.human), /Face detection could not run.*Camera frame unavailable/);
  assert.equal(failed.elements['[data-face-progress]'].hidden, true);
  const retry = captureHarness(t, [liveFrame()]);
  assert.equal((await captureLookupDescriptor(retry.dialog, retry.human)).length, 1024);
});

test('lookup refuses to capture before a camera stream is started', async t => {
  const { dialog, human, video, detections } = captureHarness(t, [liveFrame()]);
  video.srcObject = null;
  await assert.rejects(captureLookupDescriptor(dialog, human), /Start the camera first/);
  assert.equal(detections.length, 0);
});
