import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  STUDENT_FACE_DEFAULT_MARGIN,
  STUDENT_FACE_DEFAULT_RETENTION_DAYS,
  STUDENT_FACE_DEFAULT_THRESHOLD,
  STUDENT_FACE_DESCRIPTOR_MAX_LENGTH,
  STUDENT_FACE_DESCRIPTOR_MIN_LENGTH,
  STUDENT_FACE_MODEL_ID,
  averageFaceDescriptors,
  bestFaceTemplateMatch,
  decryptFaceDescriptor,
  encryptFaceDescriptor,
  faceDescriptorSimilarity,
  faceTemplateIsUsable,
  studentFaceLookupConfigured,
  studentFaceLookupEnabled,
  studentFaceMatchSettings,
  studentFaceTemplateAad,
  studentFaceTemplateExpiresAt,
  studentFaceTemplateRetentionDays,
  validateFaceDescriptor
} from '../functions/lib/student-face-templates.js';
import { recordsDeskCapabilities } from '../functions/lib/records-desk.js';

const portalRoot = new URL('../', import.meta.url);
const [templateSource, endpointSource, uiSource, adminSource, staffSessionSource, staffUsersSource, cssSource, adminHtmlSource] = await Promise.all([
  readFile(new URL('functions/lib/student-face-templates.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-face-lookup.js', portalRoot), 'utf8'),
  readFile(new URL('js/student-face-lookup.js', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-session.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/staff-users.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('admin.html', portalRoot), 'utf8')
]);

const descriptor = (value = 0, length = STUDENT_FACE_DESCRIPTOR_MIN_LENGTH) =>
  new Array(length).fill(0).map((_, index) =>
    Math.round((value + (((index % 17) - 8) * 0.0001)) * 1e6) / 1e6
  );

const activeTemplate = (overrides = {}) => ({
  Active: true,
  TemplateExpiresAt: '2099-12-31T23:59:59.000Z',
  ...overrides
});

test('face descriptors are bounded, finite, model-sized and deterministically rounded', () => {
  const accepted = descriptor(0.123456789);
  accepted[0] = 0.123456789;
  accepted[1] = '0.25';
  const normalized = validateFaceDescriptor(accepted);
  assert.equal(normalized.length, STUDENT_FACE_DESCRIPTOR_MIN_LENGTH);
  assert.equal(normalized[0], 0.123457);
  assert.equal(normalized[1], 0.25);

  assert.throws(() => validateFaceDescriptor(null), /invalid/i);
  assert.throws(
    () => validateFaceDescriptor(descriptor(0, STUDENT_FACE_DESCRIPTOR_MIN_LENGTH - 1)),
    /unsupported length/i
  );
  assert.throws(
    () => validateFaceDescriptor(descriptor(0, STUDENT_FACE_DESCRIPTOR_MAX_LENGTH + 1)),
    /unsupported length/i
  );
  assert.throws(
    () => validateFaceDescriptor([...descriptor(0).slice(0, -1), Number.NaN]),
    /invalid value/i
  );
  assert.throws(() => validateFaceDescriptor(new Array(1024).fill(0)), /degenerate/i);
  assert.throws(() => validateFaceDescriptor(new Array(1024).fill(0.5)), /degenerate/i);
  assert.throws(
    () => validateFaceDescriptor(descriptor(0), STUDENT_FACE_DESCRIPTOR_MIN_LENGTH + 1),
    /unsupported length|recognition model/i
  );
});

test('two to eight same-sized live samples can be averaged without retaining the samples', () => {
  const averaged = averageFaceDescriptors([
    descriptor(0.1),
    descriptor(0.2),
    descriptor(0.3)
  ]);
  assert.equal(averaged.length, STUDENT_FACE_DESCRIPTOR_MIN_LENGTH);
  assert.equal(averaged[0], descriptor(0.2)[0]);
  assert.equal(averaged.at(-1), descriptor(0.2).at(-1));

  assert.throws(() => averageFaceDescriptors([descriptor(0.1)]), /two and eight/i);
  assert.throws(
    () => averageFaceDescriptors(new Array(9).fill(null).map(() => descriptor(0.1))),
    /two and eight/i
  );
  assert.throws(
    () => averageFaceDescriptors([
      descriptor(0.1),
      descriptor(0.2, STUDENT_FACE_DESCRIPTOR_MIN_LENGTH + 1)
    ]),
    /unsupported length|recognition model/i
  );
});

test('encrypted templates round-trip only within the bound workspace, branch, section and student', async () => {
  const secret = 'face-test-secret-that-is-long-enough-2026';
  const meta = {
    workspaceId: 'school-production',
    branchId: 'Main',
    schoolSection: 'Secondary',
    studentId: 'DCA/26/001',
    modelId: STUDENT_FACE_MODEL_ID,
    templateVersion: 1,
    keyVersion: 'test-v1'
  };
  const original = descriptor(0.314159);
  const encrypted = await encryptFaceDescriptor(original, secret, meta);

  assert.equal(encrypted.EncryptionAlgorithm, 'A256GCM');
  assert.equal(encrypted.DescriptorLength, original.length);
  assert.equal(encrypted.EncryptionKeyVersion, 'test-v1');
  assert.ok(encrypted.DescriptorCiphertext.length > 40);
  assert.doesNotMatch(encrypted.DescriptorCiphertext, /0\.314159/);
  assert.deepEqual(await decryptFaceDescriptor(encrypted, secret, meta), original);

  await assert.rejects(
    decryptFaceDescriptor(encrypted, secret, { ...meta, branchId: 'annex' })
  );
  await assert.rejects(
    decryptFaceDescriptor(encrypted, secret, { ...meta, studentId: 'DCA/26/002' })
  );
  await assert.rejects(
    decryptFaceDescriptor(encrypted, 'different-secret-that-is-also-long-enough', meta)
  );
  assert.notEqual(
    studentFaceTemplateAad(meta),
    studentFaceTemplateAad({ ...meta, schoolSection: 'primary' })
  );
  await assert.rejects(
    decryptFaceDescriptor(encrypted, secret, { ...meta, keyVersion: 'test-v2' })
  );
});

test('feature configuration is opt-in and match settings remain within conservative bounds', () => {
  assert.equal(studentFaceLookupEnabled({ STUDENT_FACE_LOOKUP_ENABLED: 'true' }), true);
  assert.equal(studentFaceLookupEnabled({ STUDENT_FACE_LOOKUP_ENABLED: 'off' }), false);
  assert.equal(studentFaceLookupConfigured({
    STUDENT_FACE_LOOKUP_ENABLED: 'true',
    FACE_TEMPLATE_ENCRYPTION_KEY: 'too-short'
  }), false);
  assert.equal(studentFaceLookupConfigured({
    STUDENT_FACE_LOOKUP_ENABLED: 'enabled',
    FACE_TEMPLATE_ENCRYPTION_KEY: 'a-strong-test-key-with-24-characters'
  }), true);

  assert.deepEqual(studentFaceMatchSettings({}), {
    threshold: STUDENT_FACE_DEFAULT_THRESHOLD,
    margin: STUDENT_FACE_DEFAULT_MARGIN
  });
  assert.deepEqual(studentFaceMatchSettings({
    STUDENT_FACE_MATCH_THRESHOLD: 1,
    STUDENT_FACE_MATCH_MARGIN: 0
  }), { threshold: 0.95, margin: 0.02 });

  assert.equal(studentFaceTemplateRetentionDays({}), STUDENT_FACE_DEFAULT_RETENTION_DAYS);
  assert.equal(studentFaceTemplateRetentionDays({
    STUDENT_FACE_TEMPLATE_RETENTION_DAYS: '7'
  }), 30);
  assert.equal(studentFaceTemplateRetentionDays({
    STUDENT_FACE_TEMPLATE_RETENTION_DAYS: '999'
  }), 730);
  assert.equal(
    studentFaceTemplateExpiresAt(
      { STUDENT_FACE_TEMPLATE_RETENTION_DAYS: '30' },
      Date.parse('2026-07-30T00:00:00.000Z')
    ),
    '2026-08-29T00:00:00.000Z'
  );
});

test('matching rejects weak and ambiguous candidates and accepts a clearly separated candidate', () => {
  const query = descriptor(0);
  const strong = {
    id: 'strong',
    descriptor: descriptor(0.2),
    record: activeTemplate()
  };
  const closeRunnerUp = {
    id: 'close-runner-up',
    descriptor: descriptor(0.205),
    record: activeTemplate()
  };
  const weak = {
    id: 'weak',
    descriptor: descriptor(0.4),
    record: activeTemplate()
  };

  assert.equal(faceDescriptorSimilarity(query, query), 1);
  assert.ok(faceDescriptorSimilarity(query, strong.descriptor) >= 0.79);
  assert.ok(faceDescriptorSimilarity(query, weak.descriptor) < 0.7);

  const matched = bestFaceTemplateMatch(query, [strong, weak], {
    threshold: 0.7,
    margin: 0.08
  });
  assert.equal(matched.outcome, 'matched');
  assert.equal(matched.match.id, 'strong');

  const noMatch = bestFaceTemplateMatch(query, [weak], {
    threshold: 0.7,
    margin: 0.08
  });
  assert.equal(noMatch.outcome, 'no-match');
  assert.equal(noMatch.match, null);

  const ambiguous = bestFaceTemplateMatch(query, [strong, closeRunnerUp], {
    threshold: 0.7,
    margin: 0.08
  });
  assert.equal(ambiguous.outcome, 'ambiguous');
  assert.equal(ambiguous.match, null);
  assert.equal(ambiguous.best.id, 'strong');
  assert.equal(ambiguous.runnerUp.id, 'close-runner-up');
});

test('inactive and retention-expired templates cannot participate in matching', () => {
  const now = new Date('2026-07-30T12:00:00.000Z');
  assert.equal(faceTemplateIsUsable(activeTemplate(), now), true);
  assert.equal(faceTemplateIsUsable(activeTemplate({ Active: false }), now), false);
  assert.equal(faceTemplateIsUsable(activeTemplate({ TemplateExpiresAt: '' }), now), false);
  assert.equal(faceTemplateIsUsable(activeTemplate({
    TemplateExpiresAt: '2026-07-29T23:59:59.000Z'
  }), now), false);

  const result = bestFaceTemplateMatch(descriptor(0), [
    {
      id: 'expired-identical',
      descriptor: descriptor(0),
      record: activeTemplate({ TemplateExpiresAt: '2026-07-29T23:59:59.000Z' })
    },
    {
      id: 'active-weaker',
      descriptor: descriptor(0.2),
      record: activeTemplate()
    }
  ], { threshold: 0.7, margin: 0.08 });
  assert.equal(result.outcome, 'matched');
  assert.equal(result.match.id, 'active-weaker');
});

test('the face endpoint is staff-authenticated, school-only, explicitly delegated and scoped', () => {
  assert.match(endpointSource, /requireStaffSession\(env, request\)/);
  assert.match(endpointSource, /ensureSchoolRecordsDesk\(user\)/);
  assert.match(endpointSource, /lower\(user\.edition\) !== 'school'/);
  assert.match(endpointSource, /ensureLookupPermission\(user\)/);
  assert.match(endpointSource, /biometricLookupEnabled === true/);
  assert.match(templateSource, /STUDENT_FACE_LOOKUP_ENABLED/);
  assert.match(templateSource, /FACE_TEMPLATE_ENCRYPTION_KEY/);
  assert.match(
    endpointSource,
    /scopedCollectionPath\('studentFaceTemplates', branchId, schoolSection\)/
  );
  assert.match(endpointSource, /requestedSchoolScope\(user, branchId\)/);
  assert.match(endpointSource, /schoolSectionAccess/);
  assert.match(staffSessionSource, /biometricLookupEnabled:/);
  assert.match(staffSessionSource, /record\.BiometricLookupEnabled/);
  assert.match(staffUsersSource, /function explicitOptIn\(value\)/);
  assert.match(staffUsersSource, /BiometricLookupEnabled: explicitOptIn/);
  assert.match(endpointSource, /LOOKUP_LIMIT = 20/);
  assert.match(endpointSource, /STUDENT_FACE_MAX_GALLERY/);
  assert.match(endpointSource, /Number\.isInteger\(sampleCount\)/);
  assert.match(endpointSource, /readJsonBody\(request, \{ maxBytes: 128 \* 1024 \}\)/);
});

test('biometric capability is an explicit school permission and deletion survives feature disablement', () => {
  const base = {
    edition: 'school',
    role: 'Principal',
    allowedSections: ['recordsDesk'],
    biometricLookupEnabled: 'false'
  };
  assert.equal(recordsDeskCapabilities(base).canUseStudentFaceLookup, false);
  assert.equal(recordsDeskCapabilities({ ...base, biometricLookupEnabled: 'true' }).canUseStudentFaceLookup, true);
  assert.equal(recordsDeskCapabilities({
    ...base,
    edition: 'faith',
    biometricLookupEnabled: true
  }).canUseStudentFaceLookup, false);

  const revokeStart = endpointSource.indexOf('async function revoke');
  const revokeEnd = endpointSource.indexOf('function candidateStudent', revokeStart);
  const revokeSource = endpointSource.slice(revokeStart, revokeEnd);
  assert.match(revokeSource, /canEraseTemplates\(user\)/);
  assert.doesNotMatch(revokeSource, /ensureConfigured\(env\)/);
});

test('the endpoint stores only encrypted templates, supports deletion, audits use and never caches results', () => {
  assert.match(endpointSource, /encryptFaceDescriptor\(/);
  assert.match(endpointSource, /decryptFaceDescriptor\(/);
  assert.match(endpointSource, /\.\.\.encrypted/);
  assert.doesNotMatch(endpointSource, /\bDescriptor\s*:\s*descriptor\b/);
  assert.match(endpointSource, /studentTemplateDocumentId\(studentRef\)/);
  assert.match(endpointSource, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(endpointSource, /batchCommitDocuments\(env,/);
  assert.match(endpointSource, /operation: 'delete'/);
  assert.match(endpointSource, /FACE_TEMPLATE_PREVIOUS_KEYS/);
  assert.match(endpointSource, /STUDENT_FACE_RATE_LIMITER/);
  assert.match(endpointSource, /writeAudit\(env, user, 'FACE LOOKUP'/);
  assert.match(endpointSource, /Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'/);
  assert.match(endpointSource, /studentSearchCard\(matched\)/);
  assert.match(endpointSource, /Confirm the student before opening the record/);
  assert.doesNotMatch(endpointSource, /ProfilePhotoDataUrl|ParentLoginCode|PasswordHash/);
});

test('the browser UI keeps frames on-device, requires a live action and always stops camera tracks', () => {
  assert.match(uiSource, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(uiSource, /human\.detect\(video, \{[\s\S]*?description: \{ enabled: livenessConfirmed \}/);
  assert.match(uiSource, /actionObserved && blink\.open/);
  assert.match(uiSource, /faces\.length !== 1/);
  assert.match(uiSource, /captureReadiness\(face, video\)/);
  assert.match(uiSource, /getTracks\?\.\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(uiSource, /dialog\.addEventListener\('close', \(\) => \{[\s\S]*?stopCamera\(video\)/);
  assert.match(uiSource, /stopCamera\(video\);[\s\S]*?faceLookupRequest\('match'/);
  assert.doesNotMatch(
    uiSource,
    /localStorage|sessionStorage|indexedDB|toDataURL|toBlob|FormData/
  );
});

test('face capture gives persistent visual and optional spoken guidance without recording audio', () => {
  assert.match(uiSource, /SpeechSynthesisUtterance/);
  assert.match(uiSource, /window\.speechSynthesis\.speak\(utterance\)/);
  assert.match(uiSource, /state\.lastMessage === spokenMessage/);
  assert.match(uiSource, /state\.pendingMessage === spokenMessage/);
  assert.match(uiSource, /SPOKEN_GUIDANCE_DELAY_MS = 220/);
  assert.match(uiSource, /faceAudioGuidance/);
  assert.match(uiSource, /data-face-audio/);
  assert.match(uiSource, /Audio guidance \$\{enabled \? 'on' : 'off'\}/);
  assert.match(uiSource, /data-face-overlay/);
  assert.match(uiSource, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(uiSource, /stopAudioGuidance\(dialog\)/);
  assert.match(cssSource, /\.student-face-live-guidance/);
  assert.match(cssSource, /\.student-face-audio-toggle/);
  assert.match(uiSource, /audio: false/);
});

test('the capture pipeline keeps enrollment strong while making routine checks fast and guided', () => {
  assert.match(uiSource, /const ENROLLMENT_SAMPLE_COUNT = 3/);
  assert.match(uiSource, /const ROUTINE_SAMPLE_COUNT = 1/);
  assert.doesNotMatch(uiSource, /ATTENDANCE_VERIFY_SAMPLE_COUNT = 2/);
  assert.match(uiSource, /warmup: 'face'/);
  assert.match(uiSource, /cacheModels: true/);
  assert.match(uiSource, /iris: \{ enabled: false/);
  assert.match(uiSource, /const sampleCount = mode === 'enroll' \? ENROLLMENT_SAMPLE_COUNT : ROUTINE_SAMPLE_COUNT/);
  assert.match(uiSource, /captureDescriptor\(dialog, human, sampleCount\)/);
  assert.match(uiSource, /sampleCount: ENROLLMENT_SAMPLE_COUNT/);
  assert.match(uiSource, /Move closer to the camera\./);
  assert.match(uiSource, /Improve the lighting and hold the phone steady\./);
  assert.match(uiSource, /Move your face toward the centre of the oval\./);
  assert.match(uiSource, /Blink detected\. Open your eyes and hold still\./);
  assert.match(uiSource, /You can try again without reopening the camera\./);
});

test('staff attendance uses a server-issued random blink or head-pose challenge', () => {
  for (const action of ['BLINK', 'TURN_LEFT', 'TURN_RIGHT', 'CHIN_UP']) {
    assert.match(uiSource, new RegExp(action));
  }
  assert.match(uiSource, /face\?\.rotation\?\.angle/);
  assert.match(uiSource, /TURN_YAW_THRESHOLD = 0\.22/);
  assert.match(uiSource, /CHIN_UP_PITCH_THRESHOLD = 0\.17/);
  assert.match(uiSource, /neutralFrames >= NEUTRAL_POSE_FRAMES/);
  assert.match(uiSource, /returnFrames >= RETURN_POSE_FRAMES/);
  assert.match(uiSource, /staffAttendanceFaceRequest\('challenge'/);
  assert.match(uiSource, /LivenessChallengeToken: activeChallenge\?\.challengeToken/);
  assert.match(uiSource, /LivenessEvidence: livenessEvidence/);
  assert.match(uiSource, /one random live action is required for each attendance check/);
  assert.match(cssSource, /\.student-face-challenge/);
});

test('eligible Records Desk sessions prepare the model during idle time without opening the camera', () => {
  assert.match(adminSource, /function preloadRecordsDeskFaceRecognition\(\)/);
  assert.match(adminSource, /recordsDeskFaceLookupAllowed\(\)/);
  assert.match(adminSource, /requestIdleCallback/);
  assert.match(adminSource, /window\.setTimeout\(preload, 300\)/);
  assert.match(adminSource, /preloadFaceRecognitionModel\(\)/);
  assert.match(adminSource, /student-face-lookup\.js\?v=20260813-random-liveness-challenge/);
  const preloaderStart = uiSource.indexOf('export function preloadFaceRecognitionModel');
  const preloaderEnd = uiSource.indexOf('async function startCamera', preloaderStart);
  const preloaderSource = uiSource.slice(preloaderStart, preloaderEnd);
  assert.match(preloaderSource, /createHuman\(\)/);
  assert.doesNotMatch(preloaderSource, /getUserMedia|openStudentFaceLookup/);
});

test('lookup and enrollment are explicitly initiated without consent fields, and a human confirms every match', () => {
  assert.match(uiSource, /data-face-start disabled>Start camera/);
  assert.match(uiSource, /Authorized biometric enrollment/);
  assert.doesNotMatch(uiSource, /Parent or guardian consent/);
  assert.doesNotMatch(uiSource, /consentGuardianName|consentReference|consentExpiresAt|consentGranted/);
  assert.doesNotMatch(endpointSource, /ConsentGranted|ConsentReference|ConsentGuardianName|ConsentExpiresAt/);
  assert.match(endpointSource, /TemplateExpiresAt: studentFaceTemplateExpiresAt/);
  assert.match(uiSource, /data-face-confirm>Confirm and open/);
  assert.match(uiSource, /Use manual search/);
  assert.match(uiSource, /credentials: 'same-origin'/);
  assert.match(uiSource, /cache: 'no-store'/);

  assert.match(adminSource, /recordsDeskFaceLookupAllowed\(\)/);
  assert.match(adminSource, /id="recordsDeskFaceLookup"/);
  assert.match(adminSource, /mode: 'lookup'/);
  assert.match(
    adminSource,
    /onMatch: \(match\) => loadRecordsDeskDetail\('students', match\.id, match\.branchId\)/
  );
  assert.match(adminSource, /action\?\.id === 'student-face-enroll'/);
  assert.match(cssSource, /\.student-face-dialog/);
  assert.match(cssSource, /html\[data-theme="dark"\] \.student-face-dialog/);
  assert.match(cssSource, /@media\(max-width:680px\)/);
  assert.match(adminHtmlSource, /css\/style\.css\?v=20260813-dashboard-presence/);
});
