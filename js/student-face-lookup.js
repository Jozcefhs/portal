const MODEL_ID = 'human-faceres-3.3.6';
const DESCRIPTOR_LENGTH = 1024;
const ENROLLMENT_SAMPLE_COUNT = 3;
const ROUTINE_SAMPLE_COUNT = 1;
const CAPTURE_TIMEOUT_MS = 40000;
const SPOKEN_GUIDANCE_DELAY_MS = 220;
const LIVENESS_ACTIONS = new Set(['BLINK', 'TURN_LEFT', 'TURN_RIGHT', 'CHIN_UP']);
const NEUTRAL_POSE_FRAMES = 3;
const RETURN_POSE_FRAMES = 2;
const TURN_YAW_THRESHOLD = 0.22;
const CHIN_UP_PITCH_THRESHOLD = 0.17;
const RETURN_POSE_THRESHOLD = 0.1;

let humanInstancePromise = null;
let activeStream = null;
let activeDialog = null;
let detectionQueue = Promise.resolve();
const audioGuidanceStates = new WeakMap();

const clean = (value) => String(value ?? '').trim();
const escapeHtml = (value) => clean(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function audioGuidanceSupported() {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function audioGuidanceEnabled() {
  return audioGuidanceSupported() && window.DIGCPreferences?.read?.().faceAudioGuidance !== false;
}

function saveAudioGuidancePreference(enabled) {
  const preferences = window.DIGCPreferences?.read?.();
  if (preferences && window.DIGCPreferences?.save) {
    window.DIGCPreferences.save({ ...preferences, faceAudioGuidance: Boolean(enabled) });
  }
}

function audioGuidanceState(dialog) {
  if (!audioGuidanceStates.has(dialog)) {
    audioGuidanceStates.set(dialog, { timer: 0, lastMessage: '', pendingMessage: '', utterance: null });
  }
  return audioGuidanceStates.get(dialog);
}

function stopAudioGuidance(dialog) {
  const state = audioGuidanceStates.get(dialog);
  if (state?.timer) window.clearTimeout(state.timer);
  if (state) {
    state.timer = 0;
    state.pendingMessage = '';
    state.utterance = null;
  }
  if (audioGuidanceSupported()) window.speechSynthesis.cancel();
  audioGuidanceStates.delete(dialog);
}

function speakGuidance(dialog, message, { immediate = false, force = false } = {}) {
  const spokenMessage = clean(message);
  if (!dialog?.open || !spokenMessage || !audioGuidanceEnabled()) return;
  const state = audioGuidanceState(dialog);
  if (!force && (state.lastMessage === spokenMessage || state.pendingMessage === spokenMessage)) return;
  if (state.timer) window.clearTimeout(state.timer);
  state.pendingMessage = spokenMessage;
  const speak = () => {
    state.timer = 0;
    state.pendingMessage = '';
    if (!dialog.open || !audioGuidanceEnabled() || (!force && state.lastMessage === spokenMessage)) return;
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(spokenMessage);
    utterance.lang = document.documentElement.lang || navigator.language || 'en-NG';
    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.volume = 1;
    state.lastMessage = spokenMessage;
    state.utterance = utterance;
    utterance.addEventListener('end', () => {
      if (state.utterance === utterance) state.utterance = null;
    }, { once: true });
    utterance.addEventListener('error', () => {
      if (state.utterance === utterance) state.utterance = null;
    }, { once: true });
    window.speechSynthesis.speak(utterance);
  };
  state.timer = window.setTimeout(speak, immediate ? 0 : SPOKEN_GUIDANCE_DELAY_MS);
}

function updateAudioGuidanceButton(dialog) {
  const button = dialog?.querySelector('[data-face-audio]');
  if (!button) return;
  const supported = audioGuidanceSupported();
  const enabled = audioGuidanceEnabled();
  button.disabled = !supported;
  button.setAttribute('aria-pressed', String(enabled));
  button.title = supported
    ? (enabled ? 'Turn spoken camera instructions off' : 'Turn spoken camera instructions on')
    : 'Spoken instructions are not supported by this browser';
  button.querySelector('[data-face-audio-icon]').textContent = supported && enabled ? '🔊' : '🔇';
  button.querySelector('[data-face-audio-label]').textContent = supported
    ? `Audio guidance ${enabled ? 'on' : 'off'}`
    : 'Audio unavailable';
}

function initializeAudioGuidance(dialog) {
  updateAudioGuidanceButton(dialog);
  dialog?.querySelector('[data-face-audio]')?.addEventListener('click', () => {
    if (!audioGuidanceSupported()) return;
    const enabled = !audioGuidanceEnabled();
    saveAudioGuidancePreference(enabled);
    stopAudioGuidance(dialog);
    updateAudioGuidanceButton(dialog);
    if (enabled) {
      const currentInstruction = dialog.querySelector('[data-face-overlay]')?.textContent ||
        dialog.querySelector('[data-face-status]')?.textContent ||
        'Audio guidance is on.';
      speakGuidance(dialog, currentInstruction, { immediate: true, force: true });
    }
  });
}

function setStatus(dialog, message, tone = '') {
  const element = dialog?.querySelector('[data-face-status]');
  if (!element) return;
  const normalizedMessage = clean(message);
  element.className = `student-face-status${tone ? ` ${tone}` : ''}`;
  element.textContent = normalizedMessage;
  const overlay = dialog.querySelector('[data-face-overlay]');
  if (overlay) {
    overlay.className = `student-face-live-guidance${tone ? ` ${tone}` : ''}`;
    overlay.textContent = normalizedMessage;
  }
  speakGuidance(dialog, normalizedMessage);
}

function setGuideState(dialog, state = 'searching') {
  const guide = dialog?.querySelector('.student-face-guide');
  if (!guide) return;
  guide.className = `student-face-guide is-${state}`;
}

function setLivenessChallenge(dialog, challenge = null) {
  const element = dialog?.querySelector('[data-face-challenge]');
  if (!element) return;
  const action = clean(challenge?.action).toUpperCase();
  const visible = LIVENESS_ACTIONS.has(action);
  element.hidden = !visible;
  if (!visible) return;
  element.dataset.action = action;
  element.querySelector('[data-face-challenge-symbol]').textContent = clean(challenge.symbol) || '◉';
  element.querySelector('[data-face-challenge-label]').textContent = clean(challenge.label) || 'Live action';
}

function setBusy(button, busy, busyText = 'Working...') {
  if (!button) return;
  if (busy) {
    button.dataset.normalText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.normalText || button.textContent;
    delete button.dataset.normalText;
  }
}

function stopCamera(video = null) {
  const stream = video ? video.srcObject : activeStream;
  stream?.getTracks?.().forEach((track) => track.stop());
  if (video) {
    video.pause();
    video.srcObject = null;
  }
  if (activeStream === stream) activeStream = null;
}

async function faceLookupRequest(action, payload = {}) {
  const request = typeof window.DynamaxStaffFetch === 'function'
    ? window.DynamaxStaffFetch
    : window.fetch.bind(window);
  const response = await request('/api/staff-face-lookup', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({
    ok: false,
    message: 'Student face lookup did not return JSON.'
  }));
  if (!response.ok || !data.ok) {
    const failure = new Error(data.message || 'Student face lookup could not be completed.');
    failure.status = response.status;
    throw failure;
  }
  return data;
}

async function createHuman() {
  const module = await import('/vendor/human/human.esm.js?v=3.3.6');
  const config = {
    backend: 'webgl',
    cacheSensitivity: 0,
    skipAllowed: false,
    cacheModels: true,
    warmup: 'face',
    modelBasePath: '/vendor/human/models/',
    debug: false,
    filter: { enabled: true, equalization: true },
    face: {
      enabled: true,
      detector: {
        enabled: true,
        modelPath: 'blazeface.json',
        rotation: true,
        maxDetected: 2,
        minConfidence: 0.5,
        return: false
      },
      mesh: { enabled: true, modelPath: 'facemesh.json' },
      iris: { enabled: false, modelPath: 'iris.json' },
      description: { enabled: true, modelPath: 'faceres.json', minConfidence: 0.55 },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false }
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    segmentation: { enabled: false },
    gesture: { enabled: false }
  };
  let human = new module.Human(config);
  try {
    await human.load();
    await human.warmup();
  } catch (failure) {
    if (!/webgl|gpu|backend/i.test(clean(failure?.message))) throw failure;
    human = new module.Human({ ...config, backend: 'cpu' });
    await human.load();
    await human.warmup();
  }
  return human;
}

async function loadHuman(dialog) {
  if (!humanInstancePromise) humanInstancePromise = createHuman();
  setStatus(dialog, 'Loading the private on-device face model. This may take a moment...');
  try {
    return await humanInstancePromise;
  } catch (failure) {
    humanInstancePromise = null;
    throw new Error(`The on-device face model could not load. ${clean(failure?.message)}`);
  }
}

export function preloadFaceRecognitionModel() {
  if (!humanInstancePromise) humanInstancePromise = createHuman();
  return humanInstancePromise.catch((failure) => {
    humanInstancePromise = null;
    throw failure;
  });
}

export function preloadStaffAttendanceFace() {
  return preloadFaceRecognitionModel();
}

function selectedCameraFacingMode(dialog) {
  return dialog?.querySelector('[data-face-camera-select]')?.value === 'environment'
    ? 'environment'
    : 'user';
}

function cameraFacingLabel(facingMode) {
  return facingMode === 'environment' ? 'Back camera' : 'Front camera';
}

async function startCamera(dialog) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not provide secure camera access.');
  }
  const video = dialog.querySelector('[data-face-video]');
  const facingMode = selectedCameraFacingMode(dialog);
  const selectedDevice = dialog.querySelector('[data-face-camera-select]')?.value || '';
  const generation = (dialog.cameraGeneration || 0) + 1;
  dialog.cameraGeneration = generation;
  stopCamera(video);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(selectedDevice.startsWith('device:')
        ? { deviceId: { exact: selectedDevice.slice(7) } }
        : { facingMode: { ideal: facingMode } }),
      width: { ideal: 960 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    }
  });
  if (!dialog.isConnected || !dialog.open || dialog.cameraGeneration !== generation) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('Face verification was cancelled.');
  }
  activeStream = stream;
  const actualFacingMode = clean(stream.getVideoTracks?.()[0]?.getSettings?.().facingMode);
  const camera = dialog.querySelector('.student-face-camera');
  camera?.setAttribute('data-facing-mode', actualFacingMode || facingMode);
  try {
    // Register readiness listeners before assigning srcObject (fast cameras can
    // otherwise fire metadata before the handler exists).
    await waitForCameraFrames(video, stream);
    if (!dialog.open || dialog.cameraGeneration !== generation) throw new Error('Face verification was cancelled.');
    updateCameraLayout(camera, video);
    video.onresize = () => updateCameraLayout(camera, video);
    const track = stream.getVideoTracks?.()[0];
    const capabilities = track?.getCapabilities?.() || {};
    if (capabilities.focusMode?.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }
    const select = dialog.querySelector('[data-face-camera-select]');
    if (select && navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      select.querySelectorAll('[data-camera-device]').forEach((option) => option.remove());
      devices.filter((device) => device.kind === 'videoinput' && device.deviceId).forEach((device, index) => {
        const option = document.createElement('option');
        option.value = `device:${device.deviceId}`;
        option.textContent = device.label || `Camera ${index + 1}`;
        option.dataset.cameraDevice = 'true';
        select.appendChild(option);
      });
      if (selectedDevice.startsWith('device:')) select.value = selectedDevice;
    }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    if (video.srcObject === stream) stopCamera(video);
    throw error;
  }
  dialog.querySelector('[data-face-start]').hidden = true;
  setStatus(dialog, `${cameraFacingLabel(facingMode)} ready. Preparing the private face model...`, 'good');
}

export function faceGuideSize(width, height) {
  if (!(width > 0 && height > 0)) return { width: 58, height: 76 };
  // An oval keeps its human proportions on portrait and landscape streams.
  // Independent percentage insets used to make portrait faces long and thin.
  const guideHeight = Math.min(height * 0.76, width * 0.78 / 0.76);
  return { width: guideHeight * 0.76 / width * 100, height: guideHeight / height * 100 };
}

function updateCameraLayout(camera, video) {
  const ratio = video.videoWidth / video.videoHeight;
  if (!camera || !(ratio > 0)) return;
  const guide = faceGuideSize(video.videoWidth, video.videoHeight);
  camera.style.aspectRatio = String(ratio);
  camera.style.maxWidth = `min(${Math.round(360 * ratio)}px, ${42 * ratio}dvh)`;
  camera.style.setProperty('--face-guide-width', `${guide.width}%`);
  camera.style.setProperty('--face-guide-height', `${guide.height}%`);
}

export async function waitForCameraFrames(video, stream) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready);
      if (error) reject(error); else resolve();
    };
    const ready = () => { if (video.readyState >= 2 && video.videoWidth && video.videoHeight) finish(); };
    const timeout = setTimeout(() => finish(new Error('The camera did not deliver video frames. Close other camera apps and retry.')), 10000);
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.srcObject = stream;
    try { Promise.resolve(video.play()).then(ready, finish); } catch (error) { finish(error); }
  });
}

function detectFrame(human, video, options) {
  // Human owns reusable tensors; overlapping preview/capture calls can corrupt
  // results, especially when a dialog is closed and immediately reopened.
  const detection = detectionQueue.then(async () => {
    const result = await human.detect(video, options);
    // Human can return an error result rather than reject. Treating that as
    // "no face" used to repeat positioning instructions until capture timed out.
    if (result?.error) throw new Error(`Face detection could not run. ${clean(result.error)}`);
    return result;
  });
  detectionQueue = detection.catch(() => {});
  return detection;
}

function lockCaptureControls(dialog, locked) {
  dialog.captureRunning = locked;
  dialog.querySelector('[data-face-start]').disabled = locked;
  const select = dialog.querySelector('[data-face-camera-select]');
  if (select) select.disabled = locked;
}

async function previewFace(dialog, human) {
  const video = dialog.querySelector('[data-face-video]');
  const stream = video.srcObject;
  const generation = dialog.cameraGeneration;
  while (dialog.open && video.srcObject === stream && stream && !dialog.captureRunning && dialog.cameraGeneration === generation) {
    try {
      const result = await detectFrame(human, video, { face: { description: { enabled: false } } });
      if (!dialog.open || dialog.captureRunning || video.srcObject !== stream) break;
      const faces = result?.face || [];
      const readiness = faces.length === 1 ? captureReadiness(faces[0], video) : {
        ready: false, state: 'searching', message: faces.length ? 'Only one person may be in the camera frame.' : 'Move your face into the camera frame.'
      };
      setGuideState(dialog, readiness.state);
      setStatus(dialog, readiness.ready ? 'Face detected. Tap Capture face when ready.' : readiness.message, readiness.ready ? 'good' : 'warn');
    } catch (error) {
      if (dialog.open && !dialog.captureRunning) setStatus(dialog, formatCameraError(error), 'bad');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function bindCameraSelector(dialog, captureButton, { quickLookup = false } = {}) {
  const select = dialog?.querySelector('[data-face-camera-select]');
  const video = dialog?.querySelector('[data-face-video]');
  if (!select || !video) return;
  select.addEventListener('change', async () => {
    if (dialog.captureRunning) return;
    const facingMode = selectedCameraFacingMode(dialog);
    dialog.querySelector('.student-face-camera')?.setAttribute('data-facing-mode', facingMode);
    if (!activeStream || !video.srcObject) {
      setStatus(dialog, `${cameraFacingLabel(facingMode)} selected. Choose Start camera when ready.`, 'good');
      return;
    }
    select.disabled = true;
    dialog.querySelector('[data-face-start]').disabled = true;
    captureButton.disabled = true;
    try {
      await startCamera(dialog);
      const human = await loadHuman(dialog);
      captureButton.disabled = false;
      setStatus(dialog, quickLookup
        ? `${cameraFacingLabel(facingMode)} is ready. Look straight at the camera and tap Capture face. No head turn is needed.`
        : `${cameraFacingLabel(facingMode)} is ready. Continue with the live face check.`, 'good');
      void previewFace(dialog, human);
    } catch (failure) {
      stopCamera(video);
      dialog.querySelector('[data-face-start]').hidden = false;
      setStatus(dialog, formatCameraError(failure), 'bad');
    } finally {
      select.disabled = false;
      dialog.querySelector('[data-face-start]').disabled = false;
    }
  });
}

function faceGeometry(face, video) {
  const box = Array.isArray(face?.box) ? face.box : [];
  if (box.length < 4 || !video.videoWidth || !video.videoHeight) return null;
  const width = Number(box[2]) || 0;
  const height = Number(box[3]) || 0;
  const centerX = Number(box[0]) + (Number(box[2]) / 2);
  const centerY = Number(box[1]) + (Number(box[3]) / 2);
  return {
    width,
    height,
    minimumSize: Math.min(width, height),
    maximumSize: Math.max(width, height),
    clipped: Number(box[0]) < 0 || Number(box[1]) < 0 || Number(box[0]) + width > video.videoWidth || Number(box[1]) + height > video.videoHeight,
    centred: Math.abs(centerX - video.videoWidth / 2) <= video.videoWidth * 0.32 &&
      Math.abs(centerY - video.videoHeight / 2) <= video.videoHeight * 0.34
  };
}

export function eyeOpenness(face) {
  const mesh = Array.isArray(face?.mesh) ? face.mesh : [];
  if (mesh.length <= 450) return null;
  const distance = (a, b) => Math.hypot(Number(mesh[a]?.[0]) - Number(mesh[b]?.[0]), Number(mesh[a]?.[1]) - Number(mesh[b]?.[1]));
  const ratio = (top, bottom, outer, inner) => {
    const numerator = distance(top, bottom);
    const denominator = distance(outer, inner);
    return Number.isFinite(numerator) && denominator > 0 ? numerator / denominator : null;
  };
  // Eyelid separation / eye-corner width, invariant to head roll. The former
  // landmarks were outside the eye corners and prevented reliable blink checks.
  const left = ratio(374, 386, 263, 362);
  const right = ratio(145, 159, 33, 133);
  return Number.isFinite(left) && Number.isFinite(right) ? { left, right } : null;
}

export function blinkFrameState(face, baseline = null) {
  const openness = eyeOpenness(face);
  const meshClosed = baseline && openness && openness.left < baseline.left * 0.55 && openness.right < baseline.right * 0.55;
  const meshOpen = openness && openness.left > (baseline ? baseline.left * 0.8 : 0.06) && openness.right > (baseline ? baseline.right * 0.8 : 0.06);
  return {
    closed: Boolean(meshClosed),
    open: Boolean(meshOpen)
  };
}

function facePose(face) {
  const angle = face?.rotation?.angle || {};
  const yaw = Number(angle.yaw);
  const pitch = Number(angle.pitch);
  const roll = Number(angle.roll);
  return [yaw, pitch, roll].every(Number.isFinite) ? { yaw, pitch, roll } : null;
}

function normalizeLivenessChallenge(challenge = {}) {
  const action = clean(challenge.action || 'TURN_LEFT').toUpperCase();
  const instructions = {
    BLINK: 'Close both eyes for a moment, then open them.',
    TURN_LEFT: 'Slowly turn your head a little to your left and hold.',
    TURN_RIGHT: 'Slowly turn your head a little to your right and hold.',
    CHIN_UP: 'Raise your chin slightly and hold.'
  };
  const selected = LIVENESS_ACTIONS.has(action) ? action : 'TURN_LEFT';
  return {
    action: selected,
    // Older servers can still issue BLINK. A sustained close/open action is
    // visible to slower phone inference, unlike a split-second natural blink.
    instruction: selected === 'BLINK' ? instructions.BLINK : (clean(challenge.instruction) || instructions[selected])
  };
}

function frontalPose(pose) {
  return pose && Math.abs(pose.yaw) <= 0.38 && Math.abs(pose.pitch) <= 0.45 && Math.abs(pose.roll) <= 0.35;
}

function roundedMovement(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

export function captureReadiness(face, video) {
  const geometry = faceGeometry(face, video);
  const score = Number(face?.faceScore || face?.boxScore || 0);
  if (!geometry || score < 0.55) {
    return { ready: false, state: 'warning', message: 'Improve the lighting and hold the phone steady.' };
  }
  if (geometry.minimumSize < Math.min(120, video.videoWidth * 0.2)) {
    return { ready: false, state: 'warning', message: 'Move closer to the camera.' };
  }
  if (geometry.clipped || geometry.width > video.videoWidth * 0.88 || geometry.height > video.videoHeight * 0.88) {
    return { ready: false, state: 'warning', message: 'Move a little farther from the camera.' };
  }
  if (!geometry.centred) {
    return { ready: false, state: 'warning', message: 'Move your face toward the centre of the guide.' };
  }
  return { ready: true, state: 'ready', message: 'Position is good. Hold still for your live instruction.' };
}

function averageDescriptors(samples) {
  if (!samples.length) throw new Error('No valid face sample was captured.');
  const length = samples[0].length;
  if (!length || samples.some((sample) => sample.length !== length)) {
    throw new Error('The captured face samples were inconsistent.');
  }
  const average = new Array(length).fill(0);
  samples.forEach((sample) => sample.forEach((value, index) => {
    average[index] += Number(value);
  }));
  return average.map((value) => Math.round((value / samples.length) * 1e6) / 1e6);
}

// Assisted search is not authentication or attendance verification. It uses a
// clear, steady frontal sample and still requires staff to confirm the match.
// Keep this separate from captureDescriptor's live movement/evidence pipeline.
export async function captureLookupDescriptor(dialog, human) {
  const video = dialog.querySelector('[data-face-video]');
  const progress = dialog.querySelector('[data-face-progress]');
  if (!video.srcObject) throw new Error('Start the camera first.');
  const stream = video.srcObject;
  const generation = dialog.cameraGeneration;
  const ensureActive = () => {
    if (!dialog.open || !dialog.isConnected || video.srcObject !== stream || dialog.cameraGeneration !== generation || stream.getVideoTracks().some((track) => track.readyState === 'ended')) {
      throw new Error('Face lookup was cancelled.');
    }
  };
  const started = Date.now();
  let stableFrames = 0;
  let previousPose = null;
  let lastGuidance = 'Look straight at the camera and hold still. No head turn is needed.';
  progress.hidden = false;
  progress.max = ROUTINE_SAMPLE_COUNT;
  progress.value = 0;
  setGuideState(dialog, 'searching');
  setStatus(dialog, lastGuidance);
  try {
    while (Date.now() - started < CAPTURE_TIMEOUT_MS) {
      ensureActive();
      const result = await detectFrame(human, video, {
        face: { description: { enabled: stableFrames >= NEUTRAL_POSE_FRAMES - 1 } }
      });
      ensureActive();
      const faces = result?.face || [];
      const face = faces.length === 1 ? faces[0] : null;
      const readiness = face ? captureReadiness(face, video) : {
        ready: false, state: 'searching', message: faces.length
          ? 'Only one person may be in the camera frame.'
          : 'Move your face into the camera frame.'
      };
      const pose = facePose(face);
      if (!readiness.ready || !frontalPose(pose)) {
        stableFrames = 0;
        previousPose = null;
        lastGuidance = readiness.ready ? 'Look straight at the camera for a clear sample.' : readiness.message;
        setGuideState(dialog, readiness.ready ? 'warning' : readiness.state);
        setStatus(dialog, lastGuidance, 'warn');
      } else {
        const steady = !previousPose || (Math.abs(pose.yaw - previousPose.yaw) < 0.08
          && Math.abs(pose.pitch - previousPose.pitch) < 0.08
          && Math.abs(pose.roll - previousPose.roll) < 0.08);
        stableFrames = steady ? stableFrames + 1 : 1;
        previousPose = { ...pose };
        const embeddingReady = Array.isArray(face.embedding) && face.embedding.length === DESCRIPTOR_LENGTH && face.embedding.every(Number.isFinite);
        if (stableFrames >= NEUTRAL_POSE_FRAMES && embeddingReady) {
          progress.value = ROUTINE_SAMPLE_COUNT;
          setGuideState(dialog, 'capture');
          setStatus(dialog, 'Clear face sample captured. Searching for a possible match...', 'good');
          return averageDescriptors([face.embedding.map(Number)]);
        }
        lastGuidance = 'Look straight at the camera and hold still. No head turn is needed.';
        setGuideState(dialog, 'ready');
        setStatus(dialog, lastGuidance, 'good');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    ensureActive();
    setGuideState(dialog, 'warning');
    throw new Error(`Capture paused. ${lastGuidance} Tap Capture face to retry.`);
  } finally {
    progress.hidden = true;
  }
}

export async function captureDescriptor(dialog, human, sampleCount = ENROLLMENT_SAMPLE_COUNT, options = {}) {
  const video = dialog.querySelector('[data-face-video]');
  const progress = dialog.querySelector('[data-face-progress]');
  if (!video.srcObject) throw new Error('Start the camera first.');
  const stream = video.srcObject;
  const generation = dialog.cameraGeneration;
  const ensureActive = () => {
    if (!dialog.open || !dialog.isConnected || video.srcObject !== stream || dialog.cameraGeneration !== generation || stream.getVideoTracks().some((track) => track.readyState === 'ended')) {
      throw new Error('Face verification was cancelled.');
    }
  };
  const challenge = normalizeLivenessChallenge(options.challenge);
  const samples = [];
  const started = Date.now();
  let neutralPose = null;
  let neutralEyes = null;
  let neutralFrames = 0;
  let previousNeutralPose = null;
  let lastGuidance = 'Move your face into the camera frame.';
  let actionObserved = false;
  let returnFrames = 0;
  let closedEyesSeen = false;
  let livenessConfirmed = false;
  let observedGesture = '';
  let lastCaptureAt = 0;
  const movement = {
    maximumYawDelta: 0,
    minimumYawDelta: 0,
    maximumPitchDelta: 0,
    minimumPitchDelta: 0,
    maximumAbsoluteYawDelta: 0,
    maximumAbsolutePitchDelta: 0
  };
  setGuideState(dialog, 'searching');
  setStatus(dialog, 'Centre your face and hold still to begin the live check.');
  progress.hidden = false;
  progress.max = sampleCount;
  progress.value = 0;
  while (Date.now() - started < CAPTURE_TIMEOUT_MS && samples.length < sampleCount) {
    ensureActive();
    const result = await detectFrame(human, video, {
      face: { description: { enabled: livenessConfirmed } }
    });
    ensureActive();
    const faces = result?.face || [];
    if (faces.length !== 1) {
      neutralPose = null;
      neutralEyes = null;
      neutralFrames = 0;
      previousNeutralPose = null;
      actionObserved = false;
      closedEyesSeen = false;
      livenessConfirmed = false;
      returnFrames = 0;
      samples.length = 0;
      progress.value = 0;
      setGuideState(dialog, 'searching');
      lastGuidance = faces.length ? 'Only one person may be in the camera frame.' : 'Move your face into the camera frame.';
      setStatus(dialog, lastGuidance, 'warn');
      await new Promise((resolve) => window.setTimeout(resolve, 60));
      continue;
    }
    const face = faces[0];
    const readiness = captureReadiness(face, video);
    const pose = facePose(face);
    const blink = blinkFrameState(face, neutralEyes);
    if (readiness.ready && pose && !neutralPose) {
      const stable = !previousNeutralPose || (Math.abs(pose.yaw - previousNeutralPose.yaw) < 0.08
        && Math.abs(pose.pitch - previousNeutralPose.pitch) < 0.08);
      // Head-turn checks do not depend on eyelid landmarks. Some mobile
      // cameras resolve pose reliably but never resolve a usable blink.
      const neutralNow = frontalPose(pose) && (challenge.action !== 'BLINK' || blink.open);
      neutralFrames = neutralNow ? (stable ? neutralFrames + 1 : 1) : 0;
      previousNeutralPose = { ...pose };
      if (neutralFrames >= NEUTRAL_POSE_FRAMES) {
        neutralPose = { ...pose };
        neutralEyes = eyeOpenness(face);
        setGuideState(dialog, 'ready');
        setStatus(dialog, challenge.instruction, 'good');
      }
    }
    if (readiness.ready && neutralPose && !livenessConfirmed) {
      const yawDelta = pose ? pose.yaw - neutralPose.yaw : 0;
      const pitchDelta = pose ? pose.pitch - neutralPose.pitch : 0;
      movement.maximumYawDelta = Math.max(movement.maximumYawDelta, yawDelta);
      movement.minimumYawDelta = Math.min(movement.minimumYawDelta, yawDelta);
      movement.maximumPitchDelta = Math.max(movement.maximumPitchDelta, pitchDelta);
      movement.minimumPitchDelta = Math.min(movement.minimumPitchDelta, pitchDelta);
      movement.maximumAbsoluteYawDelta = Math.max(movement.maximumAbsoluteYawDelta, Math.abs(yawDelta));
      movement.maximumAbsolutePitchDelta = Math.max(movement.maximumAbsolutePitchDelta, Math.abs(pitchDelta));
      if (challenge.action === 'BLINK') {
        if (blink.closed) {
          closedEyesSeen = true;
          actionObserved = true;
        }
        if (actionObserved && blink.open) {
          returnFrames += 1;
          if (returnFrames >= RETURN_POSE_FRAMES) livenessConfirmed = true;
        } else returnFrames = 0;
      } else {
        const wantedGesture = challenge.action === 'TURN_LEFT'
          ? 'facing left'
          : challenge.action === 'TURN_RIGHT'
            ? 'facing right'
            : 'head up';
        // Human's gesture label is intermittent on mobile even when the
        // measured head rotation is clear. Use signed pose movement instead.
        // Human 3.3.6 reports a left turn as negative yaw and a right turn as
        // positive yaw (independent of the CSS-mirrored front-camera preview).
        const movementDetected = challenge.action === 'CHIN_UP'
          ? pitchDelta >= CHIN_UP_PITCH_THRESHOLD
          : challenge.action === 'TURN_LEFT'
            ? yawDelta <= -TURN_YAW_THRESHOLD
            : yawDelta >= TURN_YAW_THRESHOLD;
        if (movementDetected) {
          actionObserved = true;
          observedGesture = wantedGesture;
        }
        if (actionObserved) {
          const returned = Math.abs(yawDelta) <= RETURN_POSE_THRESHOLD &&
            Math.abs(pitchDelta) <= RETURN_POSE_THRESHOLD &&
            (challenge.action !== 'BLINK' || blink.open);
          returnFrames = returned ? returnFrames + 1 : 0;
          if (returnFrames >= RETURN_POSE_FRAMES) livenessConfirmed = true;
        }
      }
    }
    const embeddingReady = Array.isArray(face.embedding) && face.embedding.length === DESCRIPTOR_LENGTH && face.embedding.every(Number.isFinite);
    const frontal = frontalPose(pose) && (challenge.action !== 'BLINK' || blink.open);
    if (!readiness.ready) {
      if (!neutralPose) { neutralFrames = 0; previousNeutralPose = null; }
      setGuideState(dialog, readiness.state);
      lastGuidance = readiness.message;
      setStatus(dialog, lastGuidance, 'warn');
    } else if (!neutralPose) {
      setGuideState(dialog, 'ready');
      lastGuidance = 'Look straight at the camera. Hold your phone at eye level.';
      setStatus(dialog, lastGuidance, 'good');
    } else if (!livenessConfirmed) {
      setGuideState(dialog, actionObserved ? 'capture' : 'ready');
      lastGuidance = actionObserved
        ? (challenge.action === 'BLINK'
            ? 'Blink detected. Open your eyes and hold still.'
            : 'Good. Look back at the camera and hold still.')
        : challenge.instruction;
      setStatus(dialog, lastGuidance, 'good');
    } else if (!frontal) {
      setGuideState(dialog, 'warning');
      lastGuidance = 'Look straight at the camera for a clear sample.';
      setStatus(dialog, lastGuidance, 'warn');
    } else if (!embeddingReady) {
      setGuideState(dialog, 'capture');
      lastGuidance = 'Live check complete. Hold still while we capture your face.';
      setStatus(dialog, lastGuidance, 'good');
    } else if (Date.now() - lastCaptureAt >= 180) {
      samples.push(face.embedding.map(Number));
      lastCaptureAt = Date.now();
      progress.value = samples.length;
      setGuideState(dialog, 'capture');
      setStatus(dialog, `Live sample ${samples.length} of ${sampleCount} captured. Keep still.`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  ensureActive();
  progress.hidden = true;
  if (samples.length < sampleCount) {
    setGuideState(dialog, 'warning');
    throw new Error(`Capture paused. ${lastGuidance} Tap Capture face to retry.`);
  }
  options.onLivenessEvidence?.({
    action: challenge.action,
    completed: true,
    neutralEstablished: Boolean(neutralPose),
    actionObserved,
    returnedToCentre: livenessConfirmed,
    blinkClosedSeen: closedEyesSeen,
    observedGesture,
    durationMs: Date.now() - started,
    maximumYawDelta: roundedMovement(movement.maximumYawDelta),
    minimumYawDelta: roundedMovement(movement.minimumYawDelta),
    maximumPitchDelta: roundedMovement(movement.maximumPitchDelta),
    minimumPitchDelta: roundedMovement(movement.minimumPitchDelta),
    maximumAbsoluteYawDelta: roundedMovement(movement.maximumAbsoluteYawDelta),
    maximumAbsolutePitchDelta: roundedMovement(movement.maximumAbsolutePitchDelta)
  });
  return averageDescriptors(samples);
}

function formatCameraError(failure) {
  if (failure?.name === 'NotAllowedError') return 'Camera access was declined. Allow camera access in your browser settings, then retry.';
  if (failure?.name === 'NotFoundError') return 'No camera was found on this device.';
  if (failure?.name === 'NotReadableError') return 'The camera is already in use by another application.';
  if (failure?.name === 'SecurityError') return 'Camera access requires the secure HTTPS version of this portal.';
  return clean(failure?.message || failure) || 'The camera could not be used.';
}

function dialogMarkup(mode, student = {}, allowCameraSelection = false) {
  const enrollment = mode === 'enroll';
  const sampleCount = enrollment ? ENROLLMENT_SAMPLE_COUNT : ROUTINE_SAMPLE_COUNT;
  const studentName = clean(student.title || student.StudentName || student.studentName);
  const studentId = clean(student.id || student.AccountRef || student.studentId);
  const studentIdentity = studentName && studentId && studentName !== studentId
    ? `${studentName} · ${studentId}`
    : (studentName || studentId);
  return `<dialog class="student-face-dialog" data-student-face-dialog aria-modal="true" aria-labelledby="studentFaceDialogTitle">
    <header>
      <div><small>${enrollment ? 'Authorized biometric enrollment' : 'Staff-assisted student lookup'}</small>
        <h2 id="studentFaceDialogTitle">${enrollment ? 'Student face enrollment' : 'Find student by face'}</h2>
        ${enrollment ? `<p>${escapeHtml(studentIdentity)}</p>` : ''}
      </div>
      <button type="button" class="student-face-close" data-face-close aria-label="Close">×</button>
    </header>
    <div class="student-face-notice">
      <span aria-hidden="true">🛡️</span>
      <p><strong>Private assisted lookup</strong><small>Camera frames stay on this device. A mathematical face template is sent securely for comparison within this school scope. This does not authenticate a student or make an automatic decision.${enrollment ? '' : ' Quick search uses a straight-facing capture, not a live-person check. Staff must confirm the possible match.'}</small></p>
    </div>
    <div class="student-face-camera-toolbar">
      ${allowCameraSelection ? '<label class="student-face-camera-field"><span>Camera</span><select data-face-camera-select aria-label="Choose camera for face capture"><option value="user">Front camera</option><option value="environment">Back camera</option></select></label>' : ''}
      <button type="button" class="student-face-audio-toggle" data-face-audio aria-pressed="true"><span data-face-audio-icon aria-hidden="true">🔊</span><span data-face-audio-label>Audio guidance on</span></button>
    </div>
    <div class="student-face-camera">
      <video data-face-video playsinline muted aria-label="Live student face camera preview"></video>
      <div class="student-face-guide is-searching" aria-hidden="true"></div>
    </div>
    <progress data-face-progress value="0" max="${sampleCount}" hidden></progress>
    <p class="student-face-status" data-face-status role="status" aria-live="polite" aria-atomic="true">Checking whether this school and staff account can use face lookup...</p>
    <div class="student-face-match" data-face-match hidden></div>
    <footer>
      <button type="button" class="secondary" data-face-start disabled>Start camera</button>
      <button type="button" data-face-capture disabled>Capture face</button>
      ${enrollment ? '<button type="button" class="danger" data-face-revoke hidden>Remove enrollment</button>' : ''}
      <button type="button" class="secondary" data-face-close>${enrollment ? 'Close' : 'Use manual search'}</button>
    </footer>
  </dialog>`;
}

function renderPossibleMatch(dialog, match, onMatch, confirmText = 'Confirm and open') {
  const container = dialog.querySelector('[data-face-match]');
  container.hidden = false;
  container.innerHTML = `<div>
    <span class="student-face-match-avatar">${escapeHtml(clean(match.title).split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase())}</span>
    <p><small>Possible match · ${escapeHtml(match.scoreBand === 'very-high' ? 'very high confidence' : 'high confidence')}</small>
      <strong>${escapeHtml(match.title)}</strong><span>${escapeHtml(match.subtitle || match.id)}</span></p>
    <button type="button" data-face-confirm>${escapeHtml(confirmText)}</button>
  </div>
  <small>Confirm the student visually. If this is not the student, close this result and use manual search.</small>`;
  container.querySelector('[data-face-confirm]')?.addEventListener('click', () => {
    onMatch?.(match);
    dialog.close();
  });
}

export async function openStudentFaceLookup(options = {}) {
  const mode = options.mode === 'enroll' ? 'enroll' : 'lookup';
  const sampleCount = mode === 'enroll' ? ENROLLMENT_SAMPLE_COUNT : ROUTINE_SAMPLE_COUNT;
  const allowCameraSelection = mode === 'lookup' || options.allowCameraSelection !== false;
  if (activeDialog?.open) activeDialog.close();
  document.body.insertAdjacentHTML('beforeend', dialogMarkup(mode, options.student || {}, allowCameraSelection));
  const dialog = document.body.lastElementChild;
  activeDialog = dialog;
  const video = dialog.querySelector('[data-face-video]');
  const startButton = dialog.querySelector('[data-face-start]');
  const captureButton = dialog.querySelector('[data-face-capture]');
  const revokeButton = dialog.querySelector('[data-face-revoke]');
  const studentId = clean(options.student?.id || options.student?.AccountRef || options.student?.studentId);
  const branchId = clean(options.student?.branchId || options.student?.BranchId);
  const purpose = mode === 'enroll' ? 'records-desk' : (clean(options.purpose) || 'records-desk');
  let status = null;
  initializeAudioGuidance(dialog);
  if (allowCameraSelection) bindCameraSelector(dialog, captureButton, { quickLookup: mode === 'lookup' });

  const close = () => {
    dialog.cameraGeneration = (dialog.cameraGeneration || 0) + 1;
    stopCamera(video);
    if (dialog.open) dialog.close();
  };
  dialog.querySelectorAll('[data-face-close]').forEach((button) => button.addEventListener('click', close));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('close', () => {
    stopAudioGuidance(dialog);
    stopCamera(video);
    dialog.remove();
    if (activeDialog === dialog) activeDialog = null;
  }, { once: true });

  startButton.addEventListener('click', async () => {
    if (startButton.disabled) return;
    captureButton.disabled = true;
    setBusy(startButton, true, 'Preparing camera...');
    const select = dialog.querySelector('[data-face-camera-select]');
    if (select) select.disabled = true;
    try {
      const [, human] = await Promise.all([startCamera(dialog), loadHuman(dialog)]);
      if (!dialog.isConnected || !dialog.open) {
        stopCamera(video);
        return;
      }
      captureButton.disabled = false;
      setStatus(dialog, mode === 'lookup'
        ? 'Camera ready. Look straight at the camera and tap Capture face. No head turn is needed.'
        : 'Camera ready. Tap Capture face and follow one simple head movement.', 'good');
      void previewFace(dialog, human);
    } catch (failure) {
      dialog.cameraGeneration = (dialog.cameraGeneration || 0) + 1;
      stopCamera(video);
      captureButton.disabled = true;
      startButton.hidden = false;
      setStatus(dialog, formatCameraError(failure), 'bad');
    } finally {
      setBusy(startButton, false);
      if (select) select.disabled = false;
    }
  });

  captureButton.addEventListener('click', async () => {
    if (captureButton.disabled) return;
    setBusy(captureButton, true, mode === 'enroll' ? 'Enrolling...' : 'Scanning...');
    lockCaptureControls(dialog, true);
    dialog.querySelector('[data-face-match]').hidden = true;
    try {
      const human = await loadHuman(dialog);
      const descriptor = mode === 'lookup'
        ? await captureLookupDescriptor(dialog, human)
        : await captureDescriptor(dialog, human, sampleCount);
      stopCamera(video);
      startButton.hidden = false;
      if (mode === 'enroll') {
        const result = await faceLookupRequest('enroll', {
          studentId,
          branchId,
          purpose,
          modelId: MODEL_ID,
          descriptor,
          sampleCount: ENROLLMENT_SAMPLE_COUNT
        });
        status = { ...status, enrolled: true };
        revokeButton.hidden = false;
        setStatus(dialog, result.message, 'good');
        options.onEnrollmentChange?.(true);
      } else {
        const result = await faceLookupRequest('match', { modelId: MODEL_ID, descriptor, purpose });
        if (!result.match) {
          setStatus(dialog, result.message, result.outcome === 'ambiguous' ? 'warn' : 'bad');
        } else {
          setStatus(dialog, result.message, 'good');
          renderPossibleMatch(dialog, result.match, options.onMatch, options.confirmText);
        }
      }
    } catch (failure) {
      setGuideState(dialog, 'warning');
      const retryHint = activeStream
        ? ''
        : ' Start the camera to try again.';
      setStatus(dialog, `${formatCameraError(failure)}${retryHint}`, 'bad');
    } finally {
      dialog.querySelector('[data-face-progress]').hidden = true;
      lockCaptureControls(dialog, false);
      setBusy(captureButton, false);
      captureButton.disabled = !activeStream;
    }
  });

  revokeButton?.addEventListener('click', async () => {
    if (!await window.DynamaxDialogs.confirm({ title: 'Remove face enrollment', message: `Remove face enrollment for ${studentId}? The encrypted face template will be deleted.`, tone: 'danger', confirmText: 'Remove enrollment' })) return;
    setBusy(revokeButton, true, 'Removing...');
    try {
      const result = await faceLookupRequest('revoke', { studentId, branchId, purpose });
      status = { ...status, enrolled: false };
      revokeButton.hidden = true;
      setStatus(dialog, result.message, 'good');
      options.onEnrollmentChange?.(false);
    } catch (failure) {
      setStatus(dialog, clean(failure?.message), 'bad');
    } finally {
      setBusy(revokeButton, false);
    }
  });

  dialog.showModal();
  try {
    status = await faceLookupRequest('status', { studentId, branchId, purpose });
    const allowed = status.enabled && status.configured && status.canLookup &&
      (mode !== 'enroll' || status.canManage);
    startButton.disabled = !allowed;
    if (revokeButton) revokeButton.hidden = !(status.enrolled || status.expired) || !status.canErase;
    if (!status.enabled) setStatus(dialog, 'Student face lookup is disabled for this school.', 'bad');
    else if (!status.configured) setStatus(dialog, status.message, 'bad');
    else if (!status.canLookup) setStatus(dialog, 'This staff account cannot use face lookup in this workspace.', 'bad');
    else if (mode === 'enroll' && !status.canManage) setStatus(dialog, 'This staff account cannot manage face enrollment.', 'bad');
    else if (status.expired) setStatus(dialog, status.enrollmentMessage, 'warn');
    else if (mode === 'lookup') setStatus(dialog, 'Ready. Choose the front or back camera, then Start camera. Look straight ahead; no head turn is needed.', 'good');
    else setStatus(dialog, status.enrolled ? 'A face template is already enrolled. A new enrollment will replace it.' : 'Ready. Start the camera when the student is present.', 'good');
  } catch (failure) {
    startButton.disabled = true;
    setStatus(dialog, clean(failure?.message), 'bad');
  }
}

async function staffAttendanceFaceRequest(action, payload = {}) {
  const request = typeof window.DynamaxStaffFetch === 'function'
    ? window.DynamaxStaffFetch
    : window.fetch.bind(window);
  const response = await request('/api/staff-attendance-face', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Face attendance did not return JSON.' }));
  if (!response.ok || !data.ok) throw new Error(data.message || 'Face attendance could not be completed.');
  return data;
}

export function staffAttendanceFaceStatus() {
  return staffAttendanceFaceRequest('status');
}

export function revokeStaffAttendanceFace(attendanceProof) {
  return staffAttendanceFaceRequest('revoke', { AttendanceProof: attendanceProof });
}

function attendanceFaceDialogMarkup(mode) {
  const enrollment = mode === 'enroll';
  const sampleCount = enrollment ? ENROLLMENT_SAMPLE_COUNT : ROUTINE_SAMPLE_COUNT;
  return `<dialog class="student-face-dialog staff-attendance-face-dialog" data-staff-attendance-face-dialog aria-modal="true" aria-labelledby="attendanceFaceDialogTitle">
    <header>
      <div><small>${enrollment ? 'Private biometric enrollment' : 'Attendance identity check'}</small>
        <h2 id="attendanceFaceDialogTitle">${enrollment ? 'Enroll my face' : 'Verify my face'}</h2>
        <p>${enrollment ? 'This enrollment is linked only to your signed-in staff account.' : 'Complete a live check for this attendance action.'}</p>
      </div>
      <button type="button" class="student-face-close" data-face-close aria-label="Close">&times;</button>
    </header>
    <div class="student-face-notice">
      <span aria-hidden="true">&#128737;</span>
      <p><strong>Private face capture</strong><small>Camera frames stay on this device. Follow one gentle head movement, then we capture automatically. Only an encrypted face template is saved.</small></p>
    </div>
    <div class="student-face-camera-toolbar">
      <label class="student-face-camera-field"><span>Camera</span><select data-face-camera-select aria-label="Choose camera for face capture"><option value="user">Front camera</option><option value="environment">Back camera</option></select></label>
      <button type="button" class="student-face-audio-toggle" data-face-audio aria-pressed="true"><span data-face-audio-icon aria-hidden="true">🔊</span><span data-face-audio-label>Audio guidance on</span></button>
    </div>
    <div class="student-face-camera">
      <video data-face-video playsinline muted aria-label="Live staff face camera preview"></video>
      <div class="student-face-guide is-searching" aria-hidden="true"></div>
    </div>
    <progress data-face-progress value="0" max="${sampleCount}" hidden></progress>
    <p class="student-face-status" data-face-status role="status" aria-live="polite" aria-atomic="true">Ready to open the camera.</p>
    <footer>
      <button type="button" class="secondary" data-face-start>Start camera</button>
      <button type="button" data-face-capture disabled>Capture face</button>
      <button type="button" class="secondary" data-face-close>Cancel</button>
    </footer>
  </dialog>`;
}

export function captureStaffAttendanceFace(options = {}) {
  const mode = options.mode === 'enroll' ? 'enroll' : 'verify';
  if (activeDialog?.open) activeDialog.close();
  document.body.insertAdjacentHTML('beforeend', attendanceFaceDialogMarkup(mode));
  const dialog = document.body.lastElementChild;
  activeDialog = dialog;
  const video = dialog.querySelector('[data-face-video]');
  const startButton = dialog.querySelector('[data-face-start]');
  const captureButton = dialog.querySelector('[data-face-capture]');
  const sampleCount = mode === 'enroll' ? ENROLLMENT_SAMPLE_COUNT : ROUTINE_SAMPLE_COUNT;
  let activeChallenge = null;
  let settled = false;
  let preparing = false;
  let capturing = false;
  initializeAudioGuidance(dialog);
  bindCameraSelector(dialog, captureButton);

  return new Promise((resolve, reject) => {
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      stopCamera(video);
      if (dialog.open) dialog.close();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(null);
    dialog.querySelectorAll('[data-face-close]').forEach((button) => button.addEventListener('click', cancel));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      cancel();
    });
    dialog.addEventListener('close', () => {
      stopAudioGuidance(dialog);
      stopCamera(video);
      dialog.remove();
      if (activeDialog === dialog) activeDialog = null;
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, { once: true });

    const captureAndSubmit = async () => {
      if (capturing || settled) return;
      capturing = true;
      setBusy(captureButton, true, mode === 'enroll' ? 'Saving...' : 'Verifying...');
      lockCaptureControls(dialog, true);
      try {
        const human = await loadHuman(dialog);
        if (mode === 'verify' && !activeChallenge) {
          activeChallenge = await staffAttendanceFaceRequest('challenge', {
            SiteId: options.siteId,
            Direction: options.direction
          });
          setLivenessChallenge(dialog, activeChallenge);
        }
        let livenessEvidence = null;
        const descriptor = await captureDescriptor(dialog, human, sampleCount, {
          challenge: mode === 'verify' ? activeChallenge : { action: 'TURN_LEFT' },
          onLivenessEvidence: (evidence) => { livenessEvidence = evidence; }
        });
        const result = await staffAttendanceFaceRequest(mode === 'enroll' ? 'enroll' : 'verify', {
          modelId: MODEL_ID,
          descriptor,
          sampleCount,
          SiteId: options.siteId,
          Direction: options.direction,
          AttendanceProof: options.attendanceProof,
          LivenessChallengeToken: activeChallenge?.challengeToken,
          LivenessEvidence: livenessEvidence
        });
        setStatus(dialog, result.message, 'good');
        finish(result);
      } catch (error) {
        if (mode === 'verify') {
          activeChallenge = null;
          setLivenessChallenge(dialog, null);
        }
        setGuideState(dialog, 'warning');
        setStatus(dialog, formatCameraError(error), 'bad');
      } finally {
        capturing = false;
        dialog.querySelector('[data-face-progress]').hidden = true;
        lockCaptureControls(dialog, false);
        if (captureButton.isConnected) {
          setBusy(captureButton, false);
          captureButton.disabled = !activeStream;
        }
      }
    };

    const prepareCamera = async (captureAutomatically = false) => {
      if (preparing || capturing || settled) return;
      preparing = true;
      setBusy(startButton, true, 'Preparing camera...');
      dialog.querySelector('[data-face-camera-select]').disabled = true;
      try {
        const challengePromise = mode === 'verify'
          ? staffAttendanceFaceRequest('challenge', {
              SiteId: options.siteId,
              Direction: options.direction
            })
          : Promise.resolve(null);
        const [, human, challengeResult] = await Promise.all([startCamera(dialog), loadHuman(dialog), challengePromise]);
        activeChallenge = challengeResult;
        setLivenessChallenge(dialog, activeChallenge);
        if (!dialog.isConnected || !dialog.open) {
          stopCamera(video);
          return;
        }
        captureButton.disabled = false;
        setStatus(dialog, captureAutomatically
          ? (activeChallenge?.instruction || 'Camera ready. Follow the live instruction.')
          : 'Camera and private face model are ready.', 'good');
        if (captureAutomatically) await captureAndSubmit();
        else void previewFace(dialog, human);
      } catch (error) {
        dialog.cameraGeneration = (dialog.cameraGeneration || 0) + 1;
        stopCamera(video);
        captureButton.disabled = true;
        startButton.hidden = false;
        setStatus(dialog, formatCameraError(error), 'bad');
      } finally {
        preparing = false;
        if (startButton.isConnected) setBusy(startButton, false);
        dialog.querySelector('[data-face-camera-select]').disabled = false;
      }
    };

    startButton.addEventListener('click', () => prepareCamera(false));
    captureButton.addEventListener('click', captureAndSubmit);

    dialog.showModal();
    void prepareCamera(mode === 'verify');
  });
}
