import test from 'node:test';
import assert from 'node:assert/strict';
import { eyeOpenness, blinkFrameState, waitForCameraFrames, captureReadiness, captureDescriptor } from '../js/student-face-lookup.js';

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

test('face guidance refuses low confidence, tiny, clipped and off-centre captures', () => {
  const video = { videoWidth: 640, videoHeight: 480 };
  const good = { faceScore: 0.9, box: [240, 100, 160, 230] };
  assert.equal(captureReadiness(good, video).ready, true);
  assert.equal(captureReadiness({ ...good, faceScore: 0.4 }, video).ready, false);
  assert.equal(captureReadiness({ ...good, box: [300,200,40,60] }, video).ready, false);
  assert.equal(captureReadiness({ ...good, box: [10,0,440,450] }, video).ready, false);
  assert.equal(captureReadiness({ ...good, box: [560,100,160,230] }, video).ready, false);
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
