import { safeScopeId, schoolSectionFor } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();

export const STUDENT_FACE_MODEL_ID = 'human-faceres-3.3.6';
export const STUDENT_FACE_TEMPLATE_VERSION = 1;
export const STUDENT_FACE_DESCRIPTOR_LENGTH = 1024;
export const STUDENT_FACE_DESCRIPTOR_MIN_LENGTH = STUDENT_FACE_DESCRIPTOR_LENGTH;
export const STUDENT_FACE_DESCRIPTOR_MAX_LENGTH = STUDENT_FACE_DESCRIPTOR_LENGTH;
export const STUDENT_FACE_DEFAULT_THRESHOLD = 0.68;
export const STUDENT_FACE_DEFAULT_MARGIN = 0.08;
export const STUDENT_FACE_DEFAULT_RETENTION_DAYS = 365;

export async function studentFaceTemplateDocumentId(value) {
  const normalized = clean(value).toLowerCase();
  if (!normalized) throw new Error('The student reference is invalid.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return `face-${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function studentFaceTemplateMeta(env = {}, row = {}) {
  return {
    workspaceId: clean(env.DYNAMAX_WORKSPACE_ID || env.FIREBASE_PROJECT_ID),
    branchId: safeScopeId(row.BranchId || 'main'),
    schoolSection: schoolSectionFor(row),
    studentId: clean(row.StudentRef),
    modelId: clean(row.ModelId || STUDENT_FACE_MODEL_ID),
    templateVersion: Number(row.TemplateVersion || STUDENT_FACE_TEMPLATE_VERSION),
    keyVersion: clean(row.EncryptionKeyVersion || env.FACE_TEMPLATE_KEY_VERSION || 'v1')
  };
}

export function studentFaceTemplateEncryptionSecret(env = {}, template = {}) {
  const currentVersion = clean(env.FACE_TEMPLATE_KEY_VERSION || 'v1');
  const templateVersion = clean(template.EncryptionKeyVersion || 'v1');
  if (templateVersion === currentVersion) return clean(env.FACE_TEMPLATE_ENCRYPTION_KEY);
  let previous = {};
  try {
    previous = JSON.parse(clean(env.FACE_TEMPLATE_PREVIOUS_KEYS) || '{}');
  } catch (_failure) {
    throw new Error('The configured face-template keyring is invalid.');
  }
  const secret = clean(previous?.[templateVersion]);
  if (secret.length < 24) throw new Error(`The face-template key ${templateVersion} is unavailable.`);
  return secret;
}

function base64UrlEncode(bytes) {
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const normalized = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function finiteSetting(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function studentFaceLookupEnabled(env = {}) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(
    clean(env.STUDENT_FACE_LOOKUP_ENABLED).toLowerCase()
  );
}

export function studentFaceLookupConfigured(env = {}) {
  return studentFaceLookupEnabled(env) && clean(env.FACE_TEMPLATE_ENCRYPTION_KEY).length >= 24;
}

export function studentFaceMatchSettings(env = {}) {
  return {
    threshold: finiteSetting(
      env.STUDENT_FACE_MATCH_THRESHOLD,
      STUDENT_FACE_DEFAULT_THRESHOLD,
      0.5,
      0.95
    ),
    margin: finiteSetting(
      env.STUDENT_FACE_MATCH_MARGIN,
      STUDENT_FACE_DEFAULT_MARGIN,
      0.02,
      0.3
    )
  };
}

export function studentFaceTemplateRetentionDays(env = {}) {
  const configured = Number(env.STUDENT_FACE_TEMPLATE_RETENTION_DAYS);
  if (!Number.isInteger(configured)) return STUDENT_FACE_DEFAULT_RETENTION_DAYS;
  return Math.max(30, Math.min(730, configured));
}

export function studentFaceTemplateExpiresAt(env = {}, now = Date.now()) {
  const timestamp = Number(now);
  if (!Number.isFinite(timestamp)) throw new Error('The face-template enrollment time is invalid.');
  return new Date(
    timestamp + (studentFaceTemplateRetentionDays(env) * 24 * 60 * 60 * 1000)
  ).toISOString();
}

export function validateFaceDescriptor(value, expectedLength = 0) {
  if (!Array.isArray(value)) throw new Error('The face template is invalid.');
  if (value.length !== STUDENT_FACE_DESCRIPTOR_LENGTH) {
    throw new Error('The face template has an unsupported length.');
  }
  if (expectedLength && value.length !== expectedLength) {
    throw new Error('The face template does not match the configured recognition model.');
  }
  const normalized = value.map((entry) => {
    const number = Number(entry);
    if (!Number.isFinite(number) || Math.abs(number) > 10) {
      throw new Error('The face template contains an invalid value.');
    }
    return Math.round(number * 1e6) / 1e6;
  });
  let squaredNorm = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  normalized.forEach((number) => {
    squaredNorm += number * number;
    minimum = Math.min(minimum, number);
    maximum = Math.max(maximum, number);
  });
  if (squaredNorm < 1e-8 || maximum - minimum < 1e-6) {
    throw new Error('The face template is degenerate.');
  }
  return normalized;
}

export function averageFaceDescriptors(samples) {
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 8) {
    throw new Error('Capture between two and eight face samples.');
  }
  const normalized = samples.map((sample, index) =>
    validateFaceDescriptor(sample, index ? samples[0]?.length : 0)
  );
  const output = new Array(normalized[0].length).fill(0);
  normalized.forEach((sample) => sample.forEach((value, index) => {
    output[index] += value;
  }));
  return output.map((value) => Math.round((value / normalized.length) * 1e6) / 1e6);
}

export function studentFaceTemplateAad(meta = {}) {
  return JSON.stringify({
    workspaceId: clean(meta.workspaceId),
    branchId: clean(meta.branchId).toLowerCase(),
    schoolSection: clean(meta.schoolSection).toLowerCase(),
    studentId: clean(meta.studentId),
    modelId: clean(meta.modelId || STUDENT_FACE_MODEL_ID),
    templateVersion: Number(meta.templateVersion || STUDENT_FACE_TEMPLATE_VERSION),
    keyVersion: clean(meta.keyVersion || 'v1')
  });
}

async function importEncryptionKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clean(secret)));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptFaceDescriptor(descriptor, secret, meta = {}) {
  if (clean(secret).length < 24) throw new Error('Face-template encryption is not configured.');
  const normalized = validateFaceDescriptor(descriptor);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(studentFaceTemplateAad(meta));
  const key = await importEncryptionKey(secret);
  const plaintext = new TextEncoder().encode(JSON.stringify(normalized));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext);
  return {
    DescriptorCiphertext: base64UrlEncode(encrypted),
    DescriptorIv: base64UrlEncode(iv),
    DescriptorLength: normalized.length,
    EncryptionAlgorithm: 'A256GCM',
    EncryptionKeyVersion: clean(meta.keyVersion || 'v1')
  };
}

export async function decryptFaceDescriptor(record = {}, secret, meta = {}) {
  if (clean(secret).length < 24) throw new Error('Face-template encryption is not configured.');
  if (clean(record.EncryptionAlgorithm) !== 'A256GCM') {
    throw new Error('The stored face template uses an unsupported encryption format.');
  }
  const iv = base64UrlDecode(record.DescriptorIv);
  if (iv.length !== 12) throw new Error('The stored face template has an invalid IV.');
  const ciphertext = base64UrlDecode(record.DescriptorCiphertext);
  const aad = new TextEncoder().encode(studentFaceTemplateAad(meta));
  const key = await importEncryptionKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    ciphertext
  );
  return validateFaceDescriptor(
    JSON.parse(new TextDecoder().decode(plaintext)),
    Number(record.DescriptorLength || 0)
  );
}

export function faceDescriptorSimilarity(first, second) {
  const left = validateFaceDescriptor(first);
  const right = validateFaceDescriptor(second, left.length);
  let squaredDifference = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    squaredDifference += difference * difference;
  }
  const enhancedDistance = Math.round(100 * 25 * squaredDifference) / 100;
  if (enhancedDistance === 0) return 1;
  const rootDistance = Math.sqrt(enhancedDistance);
  const normalized = (1 - (rootDistance / 100) - 0.2) / 0.6;
  return Math.round(10000 * Math.max(0, Math.min(1, normalized))) / 10000;
}

export function faceTemplateIsUsable(record = {}, now = new Date()) {
  const active = record.Active === true || ['yes', 'true', '1', 'active'].includes(
    clean(record.Active).toLowerCase()
  );
  if (!active) return false;
  const expiry = Date.parse(clean(record.TemplateExpiresAt));
  return Number.isFinite(expiry) && expiry > now.getTime();
}

export function bestFaceTemplateMatch(queryDescriptor, candidates = [], options = {}) {
  const query = validateFaceDescriptor(queryDescriptor);
  const threshold = finiteSetting(options.threshold, STUDENT_FACE_DEFAULT_THRESHOLD, 0.5, 0.95);
  const margin = finiteSetting(options.margin, STUDENT_FACE_DEFAULT_MARGIN, 0.02, 0.3);
  const ranked = candidates
    .filter((candidate) => candidate && faceTemplateIsUsable(candidate.record || candidate))
    .map((candidate) => {
      try {
        return {
          ...candidate,
          similarity: faceDescriptorSimilarity(query, candidate.descriptor)
        };
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => right.similarity - left.similarity);
  const first = ranked[0] || null;
  const second = ranked[1] || null;
  if (!first || first.similarity < threshold) {
    return { outcome: 'no-match', match: null, runnerUp: second, threshold, margin };
  }
  if (second && first.similarity - second.similarity < margin) {
    return { outcome: 'ambiguous', match: null, best: first, runnerUp: second, threshold, margin };
  }
  return { outcome: 'matched', match: first, runnerUp: second, threshold, margin };
}
