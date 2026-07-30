const MODEL_ID = 'human-faceres-3.3.6';
const DESCRIPTOR_LENGTH = 1024;
const SAMPLE_COUNT = 3;
const CAPTURE_TIMEOUT_MS = 30000;

let humanInstancePromise = null;
let activeStream = null;
let activeDialog = null;

const clean = (value) => String(value ?? '').trim();
const escapeHtml = (value) => clean(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function setStatus(dialog, message, tone = '') {
  const element = dialog?.querySelector('[data-face-status]');
  if (!element) return;
  element.className = `student-face-status${tone ? ` ${tone}` : ''}`;
  element.textContent = clean(message);
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
  const stream = activeStream || video?.srcObject;
  stream?.getTracks?.().forEach((track) => track.stop());
  if (video) {
    video.pause();
    video.srcObject = null;
  }
  activeStream = null;
}

async function faceLookupRequest(action, payload = {}) {
  const response = await fetch('/api/staff-face-lookup', {
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
        minConfidence: 0.6,
        return: false
      },
      mesh: { enabled: true, modelPath: 'facemesh.json' },
      iris: { enabled: true, modelPath: 'iris.json' },
      description: { enabled: true, modelPath: 'faceres.json', minConfidence: 0.55 },
      emotion: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false }
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    segmentation: { enabled: false },
    gesture: { enabled: true }
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

async function startCamera(dialog) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not provide secure camera access.');
  }
  const video = dialog.querySelector('[data-face-video]');
  stopCamera(video);
  activeStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 960 },
      height: { ideal: 720 }
    }
  });
  video.srcObject = activeStream;
  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('The camera did not become ready.')), 10000);
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      resolve();
    };
  });
  await video.play();
  setStatus(dialog, 'Camera ready. Preparing the private face model...', 'good');
}

function flattenedGestures(result = {}) {
  const source = Array.isArray(result.gesture)
    ? result.gesture
    : Object.values(result.gesture || {});
  return source.map((entry) => clean(entry?.gesture || entry).toLowerCase()).filter(Boolean);
}

function faceIsCentered(face, video) {
  const box = Array.isArray(face?.box) ? face.box : [];
  if (box.length < 4 || !video.videoWidth || !video.videoHeight) return false;
  const centerX = Number(box[0]) + (Number(box[2]) / 2);
  const centerY = Number(box[1]) + (Number(box[3]) / 2);
  return Math.abs(centerX - video.videoWidth / 2) <= video.videoWidth * 0.25 &&
    Math.abs(centerY - video.videoHeight / 2) <= video.videoHeight * 0.28;
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

async function captureDescriptor(dialog, human) {
  const video = dialog.querySelector('[data-face-video]');
  const progress = dialog.querySelector('[data-face-progress]');
  if (!activeStream || !video.srcObject) throw new Error('Start the camera first.');
  const samples = [];
  const started = Date.now();
  let closedEyesSeen = false;
  let blinkConfirmed = false;
  let lastCaptureAt = 0;
  setStatus(dialog, 'Blink once while looking at the camera.');
  progress.hidden = false;
  progress.max = SAMPLE_COUNT;
  progress.value = 0;
  while (Date.now() - started < CAPTURE_TIMEOUT_MS && samples.length < SAMPLE_COUNT) {
    const result = await human.detect(video);
    const faces = result?.face || [];
    if (faces.length !== 1) {
      setStatus(dialog, faces.length ? 'Only one person may be in the camera frame.' : 'Move your face into the camera frame.');
      await new Promise((resolve) => window.setTimeout(resolve, 140));
      continue;
    }
    const face = faces[0];
    const gestures = flattenedGestures(result);
    const blinking = gestures.some((gesture) => gesture.includes('blink'));
    if (blinking) closedEyesSeen = true;
    if (closedEyesSeen && !blinking) blinkConfirmed = true;
    const faceScore = Number(face.faceScore || face.boxScore || 0);
    const minimumSize = Math.min(Number(face.box?.[2] || 0), Number(face.box?.[3] || 0));
    const ready = blinkConfirmed &&
      faceScore >= 0.6 &&
      minimumSize >= Math.min(150, video.videoWidth * 0.25) &&
      faceIsCentered(face, video) &&
      Array.isArray(face.embedding) &&
      face.embedding.length === DESCRIPTOR_LENGTH;
    if (!blinkConfirmed) {
      setStatus(dialog, 'Blink once while looking at the camera.');
    } else if (!ready) {
      setStatus(dialog, 'Keep your face centred, clearly lit and close enough to the camera.');
    } else if (Date.now() - lastCaptureAt >= 350) {
      samples.push(face.embedding.map(Number));
      lastCaptureAt = Date.now();
      progress.value = samples.length;
      setStatus(dialog, `Live sample ${samples.length} of ${SAMPLE_COUNT} captured. Keep still.`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  progress.hidden = true;
  if (samples.length < SAMPLE_COUNT) {
    throw new Error('A reliable live face sample was not captured in time. Try again or use manual search.');
  }
  return averageDescriptors(samples);
}

function formatCameraError(failure) {
  if (failure?.name === 'NotAllowedError') return 'Camera access was declined. Allow camera access or use manual search.';
  if (failure?.name === 'NotFoundError') return 'No camera was found on this device.';
  if (failure?.name === 'NotReadableError') return 'The camera is already in use by another application.';
  if (failure?.name === 'SecurityError') return 'Camera access requires the secure HTTPS version of this portal.';
  return clean(failure?.message || failure) || 'The camera could not be used.';
}

function dialogMarkup(mode, student = {}) {
  const enrollment = mode === 'enroll';
  const studentName = clean(student.title || student.StudentName || student.studentName);
  const studentId = clean(student.id || student.AccountRef || student.studentId);
  const defaultExpiry = new Date();
  defaultExpiry.setFullYear(defaultExpiry.getFullYear() + 1);
  const studentIdentity = studentName && studentId && studentName !== studentId
    ? `${studentName} · ${studentId}`
    : (studentName || studentId);
  return `<dialog class="student-face-dialog" data-student-face-dialog aria-modal="true" aria-labelledby="studentFaceDialogTitle">
    <header>
      <div><small>${enrollment ? 'Consent-based biometric enrollment' : 'Staff-assisted student lookup'}</small>
        <h2 id="studentFaceDialogTitle">${enrollment ? 'Student face enrollment' : 'Find student by face'}</h2>
        ${enrollment ? `<p>${escapeHtml(studentIdentity)}</p>` : ''}
      </div>
      <button type="button" class="student-face-close" data-face-close aria-label="Close">×</button>
    </header>
    <div class="student-face-notice">
      <span aria-hidden="true">🛡️</span>
      <p><strong>Private assisted lookup</strong><small>Camera frames stay on this device. A mathematical face template is sent securely for comparison within this school scope. This does not authenticate a student or make an automatic decision.</small></p>
    </div>
    <div class="student-face-camera">
      <video data-face-video playsinline muted aria-label="Live student face camera preview"></video>
      <div class="student-face-guide" aria-hidden="true"></div>
      <p>Keep one face centred and blink once when prompted.</p>
    </div>
    <progress data-face-progress value="0" max="${SAMPLE_COUNT}" hidden></progress>
    ${enrollment ? `<fieldset class="student-face-consent">
      <legend>Parent or guardian consent</legend>
      <label>Guardian name <span aria-hidden="true">*</span><input name="consentGuardianName" autocomplete="off" required></label>
      <label>Consent reference <span aria-hidden="true">*</span><input name="consentReference" placeholder="Form, email or approval reference" autocomplete="off" required></label>
      <label>Consent expiry <input name="consentExpiresAt" type="date" value="${defaultExpiry.toISOString().slice(0, 10)}" required></label>
      <label class="student-face-consent-check"><input name="consentGranted" type="checkbox"> I confirm that documented guardian consent and the school's required privacy review are in place.</label>
    </fieldset>` : ''}
    <p class="student-face-status" data-face-status>Checking whether this school and staff account can use face lookup...</p>
    <div class="student-face-match" data-face-match hidden></div>
    <footer>
      <button type="button" class="secondary" data-face-start disabled>Start camera</button>
      <button type="button" data-face-capture disabled>${enrollment ? 'Enroll face' : 'Scan face'}</button>
      ${enrollment ? '<button type="button" class="danger" data-face-revoke hidden>Remove enrollment</button>' : ''}
      <button type="button" class="secondary" data-face-close>${enrollment ? 'Close' : 'Use manual search'}</button>
    </footer>
  </dialog>`;
}

function validateConsent(dialog) {
  const guardian = clean(dialog.querySelector('[name="consentGuardianName"]')?.value);
  const reference = clean(dialog.querySelector('[name="consentReference"]')?.value);
  const expiresAt = clean(dialog.querySelector('[name="consentExpiresAt"]')?.value);
  const granted = Boolean(dialog.querySelector('[name="consentGranted"]')?.checked);
  if (!granted || guardian.length < 3 || reference.length < 3 || !expiresAt) {
    throw new Error('Record the guardian name, consent reference and expiry, then confirm consent.');
  }
  return {
    consentGranted: true,
    consentGuardianName: guardian,
    consentReference: reference,
    consentExpiresAt
  };
}

function renderPossibleMatch(dialog, match, onMatch) {
  const container = dialog.querySelector('[data-face-match]');
  container.hidden = false;
  container.innerHTML = `<div>
    <span class="student-face-match-avatar">${escapeHtml(clean(match.title).split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase())}</span>
    <p><small>Possible match · ${escapeHtml(match.scoreBand === 'very-high' ? 'very high confidence' : 'high confidence')}</small>
      <strong>${escapeHtml(match.title)}</strong><span>${escapeHtml(match.subtitle || match.id)}</span></p>
    <button type="button" data-face-confirm>Confirm and open</button>
  </div>
  <small>Confirm the student visually. If this is not the student, close this result and use manual search.</small>`;
  container.querySelector('[data-face-confirm]')?.addEventListener('click', () => {
    onMatch?.(match);
    dialog.close();
  });
}

export async function openStudentFaceLookup(options = {}) {
  const mode = options.mode === 'enroll' ? 'enroll' : 'lookup';
  if (activeDialog?.open) activeDialog.close();
  document.body.insertAdjacentHTML('beforeend', dialogMarkup(mode, options.student || {}));
  const dialog = document.body.lastElementChild;
  activeDialog = dialog;
  const video = dialog.querySelector('[data-face-video]');
  const startButton = dialog.querySelector('[data-face-start]');
  const captureButton = dialog.querySelector('[data-face-capture]');
  const revokeButton = dialog.querySelector('[data-face-revoke]');
  const studentId = clean(options.student?.id || options.student?.AccountRef || options.student?.studentId);
  const branchId = clean(options.student?.branchId || options.student?.BranchId);
  let status = null;

  const close = () => {
    stopCamera(video);
    if (dialog.open) dialog.close();
  };
  dialog.querySelectorAll('[data-face-close]').forEach((button) => button.addEventListener('click', close));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('close', () => {
    stopCamera(video);
    dialog.remove();
    if (activeDialog === dialog) activeDialog = null;
  }, { once: true });

  startButton.addEventListener('click', async () => {
    if (startButton.disabled) return;
    captureButton.disabled = true;
    setBusy(startButton, true, 'Preparing camera...');
    try {
      await Promise.all([startCamera(dialog), loadHuman(dialog)]);
      if (!dialog.isConnected || !dialog.open) {
        stopCamera(video);
        return;
      }
      captureButton.disabled = false;
      setStatus(dialog, 'Camera and private face model are ready. Choose Scan face.', 'good');
    } catch (failure) {
      stopCamera(video);
      captureButton.disabled = true;
      setStatus(dialog, formatCameraError(failure), 'bad');
    } finally {
      setBusy(startButton, false);
    }
  });

  captureButton.addEventListener('click', async () => {
    if (captureButton.disabled) return;
    setBusy(captureButton, true, mode === 'enroll' ? 'Enrolling...' : 'Scanning...');
    try {
      const consent = mode === 'enroll' ? validateConsent(dialog) : {};
      const human = await loadHuman(dialog);
      const descriptor = await captureDescriptor(dialog, human);
      stopCamera(video);
      if (mode === 'enroll') {
        const result = await faceLookupRequest('enroll', {
          studentId,
          branchId,
          modelId: MODEL_ID,
          descriptor,
          sampleCount: SAMPLE_COUNT,
          ...consent
        });
        status = { ...status, enrolled: true };
        revokeButton.hidden = false;
        setStatus(dialog, result.message, 'good');
        options.onEnrollmentChange?.(true);
      } else {
        const result = await faceLookupRequest('match', { modelId: MODEL_ID, descriptor });
        if (!result.match) {
          setStatus(dialog, result.message, result.outcome === 'ambiguous' ? 'warn' : 'bad');
        } else {
          setStatus(dialog, result.message, 'good');
          renderPossibleMatch(dialog, result.match, options.onMatch);
        }
      }
    } catch (failure) {
      stopCamera(video);
      setStatus(dialog, formatCameraError(failure), 'bad');
    } finally {
      setBusy(captureButton, false);
      captureButton.disabled = !activeStream;
    }
  });

  revokeButton?.addEventListener('click', async () => {
    if (!window.confirm(`Remove face enrollment for ${studentId}? The encrypted face template will be deleted.`)) return;
    setBusy(revokeButton, true, 'Removing...');
    try {
      const result = await faceLookupRequest('revoke', { studentId, branchId });
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
    status = await faceLookupRequest('status', { studentId, branchId });
    const allowed = status.enabled && status.configured && status.canLookup &&
      (mode !== 'enroll' || status.canManage);
    startButton.disabled = !allowed;
    if (revokeButton) revokeButton.hidden = !(status.enrolled || status.expired) || !status.canErase;
    if (!status.enabled) setStatus(dialog, 'Student face lookup is disabled for this school.', 'bad');
    else if (!status.configured) setStatus(dialog, status.message, 'bad');
    else if (!status.canLookup) setStatus(dialog, 'This staff account has not been granted biometric lookup permission.', 'bad');
    else if (mode === 'enroll' && !status.canManage) setStatus(dialog, 'This staff account cannot manage face enrollment.', 'bad');
    else if (status.expired) setStatus(dialog, status.enrollmentMessage, 'warn');
    else setStatus(dialog, status.enrolled ? 'A face template is already enrolled. A new enrollment will replace it.' : 'Ready. Start the camera when the student is present.', 'good');
  } catch (failure) {
    startButton.disabled = true;
    setStatus(dialog, clean(failure?.message), 'bad');
  }
}
