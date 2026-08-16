import { getDocument, upsertDocument } from './firestore.js';
import { safeScopeId, schoolSectionFor, scopedCollectionPath } from './school-scope.js';

const encoder = new TextEncoder();
const CREDENTIAL_COLLECTION = 'studentLoginCredentials';
const PASSWORD_ITERATIONS = 120000;
const PASSWORD_HASH_VERSION = 'pbkdf2-sha256-v1';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function bytesToHex(value) {
  return Array.from(new Uint8Array(value)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secureEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

export function studentLoginCredentialCollection(student = {}) {
  return scopedCollectionPath(
    CREDENTIAL_COLLECTION,
    safeScopeId(student.BranchId || 'main'),
    schoolSectionFor(student)
  );
}

export async function studentLoginCredentialId(reference) {
  const normalized = lower(reference);
  if (!normalized) throw new Error('The student admission number is required.');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(normalized));
  return `student-login-${bytesToHex(digest)}`;
}

export async function hashStudentPassword(password, iterations = PASSWORD_ITERATIONS) {
  const value = String(password || '');
  if (value !== value.trim()) throw new Error('Student password cannot begin or end with a space.');
  if (value.length < 8) throw new Error('Student password must be at least 8 characters.');
  if (value.length > 128) throw new Error('Student password must not exceed 128 characters.');
  const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  const material = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256'
  }, material, 256);
  return {
    Salt: salt,
    PasswordHash: bytesToHex(bits),
    PasswordIterations: iterations,
    PasswordHashVersion: PASSWORD_HASH_VERSION
  };
}

export async function verifyStudentPasswordHash(credential = {}, password = '') {
  if (lower(credential.PasswordHashVersion) !== PASSWORD_HASH_VERSION) return false;
  const salt = clean(credential.Salt);
  const expected = lower(credential.PasswordHash);
  const value = String(password || '');
  if (!salt || !expected || !value) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: encoder.encode(salt),
    iterations: Number(credential.PasswordIterations || PASSWORD_ITERATIONS),
    hash: 'SHA-256'
  }, material, 256);
  return secureEqual(bytesToHex(bits), expected);
}

export async function getStudentLoginCredential(env, student = {}) {
  const reference = clean(student.AdmissionNo || student.AccountRef || student.StudentRef || student.__id);
  if (!reference) return null;
  const record = await getDocument(
    env,
    studentLoginCredentialCollection(student),
    await studentLoginCredentialId(reference)
  ).catch(() => null);
  return record && lower(record.StudentRef) === lower(reference) ? record : null;
}

export async function saveStudentLoginPassword(env, student = {}, password = '', actor = '') {
  const reference = clean(student.AdmissionNo || student.AccountRef || student.StudentRef || student.__id);
  if (!reference) throw new Error('The student admission number is required before setting a password.');
  const collection = studentLoginCredentialCollection(student);
  const documentId = await studentLoginCredentialId(reference);
  const existing = await getDocument(env, collection, documentId).catch(() => null);
  const timestamp = new Date().toISOString();
  const record = {
    StudentRef: reference,
    BranchId: safeScopeId(student.BranchId || 'main'),
    SchoolSection: schoolSectionFor(student),
    ...(await hashStudentPassword(password)),
    Active: true,
    PasswordChangedAt: timestamp,
    UpdatedAt: timestamp,
    UpdatedBy: clean(actor) || 'Student Register',
    CreatedAt: clean(existing?.CreatedAt) || timestamp,
    CreatedBy: clean(existing?.CreatedBy) || clean(actor) || 'Student Register'
  };
  await upsertDocument(env, collection, documentId, record);
  return { StudentRef: reference, PasswordConfigured: true, PasswordChangedAt: timestamp };
}

export function publicStudentLoginStatus(credential = null) {
  return {
    PasswordConfigured: Boolean(credential && credential.Active !== false && clean(credential.PasswordHash)),
    PasswordChangedAt: clean(credential?.PasswordChangedAt)
  };
}

