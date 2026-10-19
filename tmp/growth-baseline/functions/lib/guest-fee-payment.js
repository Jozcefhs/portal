import {
  deleteDocumentIfCurrent,
  getDocument,
  patchDocumentFieldsIfCurrent,
  upsertDocument
} from './firestore.js';
import {
  getSchoolDocumentById,
  getSchoolDocumentsById,
  querySchoolCollection,
  safeScopeId,
  schoolSectionFor
} from './school-scope.js';
import { escapeEmailHtml, sendConfiguredEmail } from './email-service.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CHALLENGE_COLLECTION = 'guestFeePaymentChallenges';
const OTP_MINUTES = 10;
const TOKEN_MINUTES = 20;
const MAX_OTP_ATTEMPTS = 5;

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));

function safeDocumentId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
}

function bytesToBase64Url(value) {
  let binary = '';
  new Uint8Array(value).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
  const normalized = clean(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function guestFeeSecret(env = {}) {
  const secret = clean(
    env.GUEST_FEE_PAYMENT_SECRET
      || env.PARENT_SESSION_SECRET
      || env.STAFF_SESSION_SECRET
      || env.BACKEND_SHARED_SECRET
  );
  if (!secret) {
    const error = new Error('Guest fee-payment authorization is not configured. Add PARENT_SESSION_SECRET in Cloudflare.');
    error.status = 503;
    throw error;
  }
  return secret;
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(guestFeeSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function keyedDigest(env, value) {
  return bytesToBase64Url(await crypto.subtle.sign(
    'HMAC',
    await hmacKey(env),
    encoder.encode(clean(value))
  ));
}

async function encryptionKey(env) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`dynamax-guest-fee-payment:${guestFeeSecret(env)}`)
  );
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export function maskGuestFeeParentEmail(value) {
  const email = lower(value);
  const separator = email.indexOf('@');
  if (separator < 1) return '';
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export function guestFeeStudentReference(student = {}) {
  return clean(student.AdmissionNo || student.AdmissionNumber || student.AccountRef || student.__id);
}

function guestFeeParentEmail(student = {}, application = {}) {
  return [
    student.ParentEmail,
    student.ParentEmailAddress,
    student.GuardianEmail,
    student.FatherEmail,
    student.MotherEmail,
    student.VerificationEmail,
    application.ParentEmail,
    application.VerificationEmail,
    application.Email
  ].map(lower).find(validEmail) || '';
}

function activeStudent(student = {}) {
  return !['dismissed', 'deleted', 'deceased', 'withdrawn'].includes(lower(student.Status));
}

async function linkedApplication(env, student = {}) {
  const applicationReference = clean(student.ApplicationReference || student.ApplicationID);
  if (!applicationReference) return null;
  const studentScope = clean(student.__scopePath);
  const applicationScope = studentScope.replace(/\/students$/i, '/applications');
  if (applicationScope && applicationScope !== studentScope) {
    const scoped = await getDocument(env, applicationScope, safeDocumentId(applicationReference)).catch(() => null);
    if (scoped) return { ...scoped, __scopePath: applicationScope };
  }
  return getSchoolDocumentById(env, 'applications', safeDocumentId(applicationReference)).catch(() => null);
}

async function findGuestFeeStudent(env, admissionNumber) {
  const wanted = clean(admissionNumber).toUpperCase();
  if (!wanted || wanted.length > 140) {
    const error = new Error('Enter a valid admission number.');
    error.status = 400;
    throw error;
  }
  let candidates = await getSchoolDocumentsById(env, 'students', safeDocumentId(wanted)).catch(() => []);
  if (!candidates.length) {
    const groups = await Promise.all(['AdmissionNo', 'AdmissionNumber', 'AccountRef'].map((field) => (
      querySchoolCollection(env, 'students', {
        filters: [{ field, op: '==', value: wanted }],
        limit: 2
      }).catch(() => [])
    )));
    const unique = new Map();
    groups.flat().forEach((row) => {
      const key = `${clean(row.__scopePath)}|${clean(row.__id) || guestFeeStudentReference(row)}`;
      if (key !== '|') unique.set(key, row);
    });
    candidates = [...unique.values()];
  }
  candidates = candidates.filter((row) => (
    activeStudent(row)
      && [row.AdmissionNo, row.AdmissionNumber, row.AccountRef, row.__id]
        .some((value) => lower(value) === lower(wanted) || lower(safeDocumentId(value)) === lower(safeDocumentId(wanted)))
  ));
  if (candidates.length !== 1) {
    const error = new Error(candidates.length
      ? 'That admission number is not unique. Please contact the school Accounts Office.'
      : 'No active student was found with that admission number.');
    error.status = candidates.length ? 409 : 404;
    throw error;
  }
  const student = candidates[0];
  const application = await linkedApplication(env, student);
  const parentEmail = guestFeeParentEmail(student, application || {});
  if (!parentEmail) {
    const error = new Error('No parent email is linked to this student. Please contact the school Accounts Office.');
    error.status = 409;
    throw error;
  }
  const accountRef = guestFeeStudentReference(student);
  if (!accountRef) {
    const error = new Error('This student does not have a valid fee account reference.');
    error.status = 409;
    throw error;
  }
  const scopePath = clean(student.__scopePath) || 'students';
  return {
    accountRef,
    admissionNo: clean(student.AdmissionNo || student.AdmissionNumber || accountRef),
    displayName: clean(student.DisplayName || student.ApplicantName || student.StudentName) || 'Student',
    parentEmail,
    branchId: safeScopeId(student.BranchId || 'main'),
    schoolSection: schoolSectionFor(student),
    sourceType: 'student',
    scopePath
  };
}

function makeOtp() {
  const random = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(random % 1000000).padStart(6, '0');
}

async function challengeDocumentId(env, target) {
  return `guest-fee-${(await keyedDigest(env, `${target.scopePath}:${target.accountRef}`)).slice(0, 56)}`;
}

async function otpDigest(env, challengeId, otp) {
  return keyedDigest(env, `otp:${challengeId}:${clean(otp)}`);
}

export async function createGuestFeePaymentToken(env, target = {}, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    purpose: 'guest-fee-payment',
    accountRef: clean(target.accountRef),
    admissionNo: clean(target.admissionNo),
    parentEmail: lower(target.parentEmail),
    sourceType: 'student',
    scopePath: clean(target.scopePath),
    branchId: safeScopeId(target.branchId || 'main'),
    iat: issuedAt,
    exp: issuedAt + TOKEN_MINUTES * 60,
    jti: crypto.randomUUID()
  };
  if (!payload.accountRef || !validEmail(payload.parentEmail) || !payload.scopePath) {
    throw new Error('The guest fee-payment authorization target is incomplete.');
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(env),
    encoder.encode(JSON.stringify(payload))
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(encrypted)}`;
}

export async function readGuestFeePaymentToken(env, token, now = Date.now()) {
  const [ivPart, payloadPart, extra] = clean(token).split('.');
  if (!ivPart || !payloadPart || extra || clean(token).length > 4096) return null;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64UrlToBytes(ivPart) },
      await encryptionKey(env),
      base64UrlToBytes(payloadPart)
    );
    const payload = JSON.parse(decoder.decode(decrypted));
    if (payload?.purpose !== 'guest-fee-payment') return null;
    if (!payload.exp || Number(payload.exp) <= Math.floor(now / 1000)) return null;
    if (!clean(payload.accountRef) || !validEmail(payload.parentEmail) || !clean(payload.scopePath)) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

export async function requireGuestFeePaymentToken(env, token) {
  const payload = await readGuestFeePaymentToken(env, token);
  if (payload) return payload;
  const error = new Error('This fee-payment authorization has expired or is invalid. Request a new OTP.');
  error.status = 401;
  error.code = 'GUEST_FEE_AUTH_INVALID';
  throw error;
}

function otpEmailFrame(target, otp) {
  return `<div style="margin:0;background:#eef4f8;padding:18px 10px;color:#17324d;font-family:Arial,sans-serif"><div style="max-width:620px;margin:auto;border-top:6px solid #0b8f76;border-radius:12px;background:#fff;padding:22px"><p style="margin:0;color:#0b8f76;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Parent approval required</p><h1 style="margin:6px 0 12px;color:#123f6d;font-size:23px">Fee-payment verification code</h1><p>A person has requested permission to pay fees for <strong>${escapeEmailHtml(target.displayName)}</strong> (${escapeEmailHtml(target.admissionNo)}).</p><p style="margin:18px 0;padding:14px;border:1px solid #a8daca;border-radius:10px;background:#edf9f5;color:#075f4d;font-size:28px;font-weight:bold;letter-spacing:6px;text-align:center">${escapeEmailHtml(otp)}</p><p>This code expires in ${OTP_MINUTES} minutes. Forward it only if you approve this payment. It authorizes fee payment only and cannot open the parent dashboard.</p><p style="color:#63788d;font-size:12px">If you did not approve this request, do not share the code.</p></div></div>`;
}

export async function issueGuestFeePaymentOtp(env, admissionNumber) {
  const target = await findGuestFeeStudent(env, admissionNumber);
  const challengeId = await challengeDocumentId(env, target);
  const otp = makeOtp();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + OTP_MINUTES * 60 * 1000).toISOString();
  const challenge = {
    Purpose: 'Guest Fee Payment',
    OtpHash: await otpDigest(env, challengeId, otp),
    AccountRef: target.accountRef,
    AdmissionNo: target.admissionNo,
    ParentEmail: target.parentEmail,
    DisplayName: target.displayName,
    BranchId: target.branchId,
    SchoolSection: target.schoolSection,
    SourceType: target.sourceType,
    ScopePath: target.scopePath,
    Attempts: 0,
    Status: 'Pending',
    CreatedAt: createdAt,
    UpdatedAt: createdAt,
    ExpiresAt: expiresAt
  };
  await upsertDocument(env, CHALLENGE_COLLECTION, challengeId, challenge);
  try {
    await sendConfiguredEmail(env, {
      toEmail: target.parentEmail,
      toName: 'Parent/Guardian',
      subject: `Fee-payment approval code for ${target.displayName}`,
      textContent: `A person has requested permission to pay fees for ${target.displayName} (${target.admissionNo}).\n\nVerification code: ${otp}\n\nThis code expires in ${OTP_MINUTES} minutes. Forward it only if you approve this payment. It authorizes fee payment only and cannot open the parent dashboard.\n\nIf you did not approve this request, do not share the code.`,
      htmlContent: otpEmailFrame(target, otp),
      branchId: target.branchId
    });
  } catch (error) {
    await upsertDocument(env, CHALLENGE_COLLECTION, challengeId, {
      ...challenge,
      Status: 'Delivery Failed',
      UpdatedAt: new Date().toISOString()
    }).catch(() => null);
    throw error;
  }
  return {
    challengeId,
    maskedParentEmail: maskGuestFeeParentEmail(target.parentEmail),
    admissionNo: target.admissionNo,
    expiresAt,
    expiresInMinutes: OTP_MINUTES
  };
}

export async function verifyGuestFeePaymentOtp(env, challengeId, otp) {
  const id = clean(challengeId);
  const code = clean(otp);
  if (!/^guest-fee-[A-Za-z0-9_-]{20,80}$/.test(id) || !/^\d{6}$/.test(code)) {
    const error = new Error('Enter the six-digit OTP sent to the parent.');
    error.status = 400;
    throw error;
  }
  const challenge = await getDocument(env, CHALLENGE_COLLECTION, id).catch(() => null);
  if (!challenge || clean(challenge.Status).toLowerCase() !== 'pending') {
    const error = new Error('This OTP is no longer valid. Request a new one.');
    error.status = 401;
    throw error;
  }
  if (Date.parse(clean(challenge.ExpiresAt)) <= Date.now()) {
    await patchDocumentFieldsIfCurrent(env, CHALLENGE_COLLECTION, id, {
      Status: 'Expired', UpdatedAt: new Date().toISOString()
    }, challenge).catch(() => null);
    const error = new Error('This OTP has expired. Request a new one.');
    error.status = 401;
    throw error;
  }
  const attempts = Math.max(0, Number(challenge.Attempts || 0));
  if (attempts >= MAX_OTP_ATTEMPTS) {
    const error = new Error('Too many incorrect attempts. Request a new OTP.');
    error.status = 429;
    throw error;
  }
  const suppliedHash = await otpDigest(env, id, code);
  const expectedHash = clean(challenge.OtpHash);
  const valid = expectedHash && suppliedHash.length === expectedHash.length
    && Array.from(suppliedHash).reduce((difference, character, index) => (
      difference | (character.charCodeAt(0) ^ expectedHash.charCodeAt(index))
    ), 0) === 0;
  if (!valid) {
    const nextAttempts = attempts + 1;
    await patchDocumentFieldsIfCurrent(env, CHALLENGE_COLLECTION, id, {
      Attempts: nextAttempts,
      Status: nextAttempts >= MAX_OTP_ATTEMPTS ? 'Locked' : 'Pending',
      UpdatedAt: new Date().toISOString()
    }, challenge);
    const error = new Error(nextAttempts >= MAX_OTP_ATTEMPTS
      ? 'Too many incorrect attempts. Request a new OTP.'
      : `Incorrect OTP. ${MAX_OTP_ATTEMPTS - nextAttempts} attempt${MAX_OTP_ATTEMPTS - nextAttempts === 1 ? '' : 's'} remaining.`);
    error.status = nextAttempts >= MAX_OTP_ATTEMPTS ? 429 : 401;
    throw error;
  }
  const target = {
    accountRef: challenge.AccountRef,
    admissionNo: challenge.AdmissionNo,
    parentEmail: challenge.ParentEmail,
    branchId: challenge.BranchId,
    sourceType: 'student',
    scopePath: challenge.ScopePath
  };
  const token = await createGuestFeePaymentToken(env, target);
  await deleteDocumentIfCurrent(env, CHALLENGE_COLLECTION, id, challenge);
  return {
    token,
    admissionNo: clean(challenge.AdmissionNo),
    maskedParentEmail: maskGuestFeeParentEmail(challenge.ParentEmail),
    expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60 * 1000).toISOString(),
    expiresInMinutes: TOKEN_MINUTES
  };
}
