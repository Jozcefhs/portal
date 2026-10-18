import { batchCommitLiteralDocuments, getDocument } from './firestore.js';
import { findStaffLoginRecord, hashStaffPassword } from './staff-auth.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { externalAuditAccessExpired } from './external-audit.js';
import { sendConfiguredEmail, escapeEmailHtml } from './email-service.js';
import { credentialStateId } from './staff-credential-state.js';

const clean = value => String(value ?? '').trim();
const TOKEN_COLLECTION = 'staffPasswordRecovery';
export const RECOVERY_REQUEST_MESSAGE = 'If this is an active staff account with an email saved on the login account, a one-time code will be sent. Check your inbox and spam folder. No administrator email verification is needed. If it does not arrive, try again later or contact your administrator.';

export function normalizeRecoveryEmail(value) {
  const email = clean(value).toLowerCase();
  if (email && (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))) {
    throw Object.assign(new Error('Enter a valid login-account email address.'), { status: 400 });
  }
  return email;
}

function active(row, edition) {
  const rowEdition = clean(row?.OrganisationEdition || row?.OrganizationEdition || row?.Edition).toLowerCase();
  return row && (!rowEdition || rowEdition === edition || (rowEdition === 'church' && edition === 'faith'))
    && !['no', 'false', '0', 'inactive', 'disabled'].includes(clean(row.Active ?? true).toLowerCase())
    && !externalAuditAccessExpired(row) && Boolean(row.Salt && row.PasswordHash);
}

function condition(row) {
  if (!row) return { exists: false };
  if (!row.__updateTime) throw new Error('Account version unavailable.');
  return { updateTime: row.__updateTime };
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fingerprint(row) {
  return digest(JSON.stringify([row.Username, row.LoginUsername || row.Username, row.Salt,
    row.PasswordHash, row.PasswordIterations, row.RecoveryEmail, row.RecoveryEmailChangedAt]));
}

function invalidCode() {
  return Object.assign(new Error('This recovery code is invalid, expired, or already used. Request a new code.'), { status: 400 });
}

// Called in waitUntil: the public response does not reveal lookup or delivery
// timing. The saved LOGIN email is used without an administrator verification
// requirement: the one-time code proves inbox access. Display-only HR contacts
// and request-supplied emails are never used.
export async function requestStaffPasswordRecovery(env, username) {
  const identity = requiredDeploymentIdentity(env);
  const login = clean(username).toLowerCase();
  if (!login || login.length > 160) return;
  const rateId = await digest(`${identity.workspaceId}|${identity.edition}|${login}`);
  const rate = await getDocument(env, 'staffPasswordRecoveryLimits', rateId);
  const now = Date.now();
  const currentWindow = Number(rate?.WindowUntil) > now;
  if (currentWindow && (Number(rate.Count) >= 3 || now - Number(rate.LastRequestedAt) < 60_000)) return;
  try {
    await batchCommitLiteralDocuments(env, [{ collectionPath: 'staffPasswordRecoveryLimits', documentId: rateId,
      ...condition(rate), data: { Count: currentWindow ? Number(rate.Count) + 1 : 1,
        WindowUntil: currentWindow ? rate.WindowUntil : now + 15 * 60_000, LastRequestedAt: now } }]);
  } catch (error) {
    if ([409, 412].includes(Number(error.status)) || error.code === 'FIRESTORE_WRITE_CONFLICT') return;
    throw error;
  }
  const row = await findStaffLoginRecord(env, login);
  if (!active(row, identity.edition) || clean(row.LoginUsername || row.Username).toLowerCase() !== login) return;
  const email = normalizeRecoveryEmail(row.RecoveryEmail);
  if (!email || !row.__id) return;
  const code = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
  const id = await digest(code);
  await batchCommitLiteralDocuments(env, [{ collectionPath: TOKEN_COLLECTION, documentId: id, exists: false,
    data: { StaffId: row.__id, Username: row.Username, Fingerprint: await fingerprint(row),
      WorkspaceId: identity.workspaceId, Edition: identity.edition, UsedAt: '',
      CreatedAt: new Date(now).toISOString(), ExpiresAt: new Date(now + 15 * 60_000).toISOString() } }]);
  await sendConfiguredEmail(env, {
    toEmail: email, toName: clean(row.DisplayName || row.Username), branchId: clean(row.BranchId),
    subject: 'Staff password recovery code',
    textContent: `A password reset was requested for your staff login in ${identity.workspaceId}.\n\nYour one-time code is:\n${code}\n\nCopy this code into the password recovery page you opened from your organisation's staff sign-in screen. It expires in 15 minutes. Do not share it. If you did not request this, ignore this email; your password has not changed.`,
    htmlContent: `<p>A password reset was requested for your staff login in ${escapeEmailHtml(identity.workspaceId)}.</p><p>Your one-time code:</p><p><strong>${code}</strong></p><p>Copy it into the password recovery page you opened from your organisation's staff sign-in screen. It expires in 15 minutes. Do not share it.</p><p>If you did not request this, ignore this email; your password has not changed.</p>`
  });
}

export async function resetStaffPassword(env, code, password) {
  const identity = requiredDeploymentIdentity(env);
  const token = clean(code).toLowerCase();
  if (!/^[a-f0-9]{48}$/.test(token)) throw invalidCode();
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw Object.assign(new Error('Use a password between 12 and 128 characters.'), { status: 400 });
  }
  const id = await digest(token);
  const recovery = await getDocument(env, TOKEN_COLLECTION, id);
  if (!recovery || recovery.UsedAt || !(Date.parse(recovery.ExpiresAt) > Date.now())
      || recovery.WorkspaceId !== identity.workspaceId || recovery.Edition !== identity.edition) throw invalidCode();
  const row = await getDocument(env, 'staffUsers', recovery.StaffId);
  if (!active(row, identity.edition) || await fingerprint(row) !== recovery.Fingerprint) throw invalidCode();
  const fields = { ...await hashStaffPassword(password), MustChangePassword: false, PasswordSetupRequired: false,
    PasswordChangedAt: new Date().toISOString(), PasswordRecoveryEpoch: crypto.randomUUID() };
  const auditId = `PASSWORD-RECOVERY-${crypto.randomUUID()}`;
  try {
    await batchCommitLiteralDocuments(env, [
      { collectionPath: 'staffUsers', documentId: recovery.StaffId, ...condition(row), data: fields, updateMask: Object.keys(fields) },
      { collectionPath: TOKEN_COLLECTION, documentId: id, ...condition(recovery),
        data: { UsedAt: fields.PasswordChangedAt }, updateMask: ['UsedAt'] },
      { collectionPath: 'staffCredentialRevocations', documentId: await credentialStateId(row.Username),
        data: { Epoch: fields.PasswordRecoveryEpoch, ChangedAt: fields.PasswordChangedAt } },
      { collectionPath: 'staffSecurityAudit', documentId: auditId, exists: false,
        data: { AuditId: auditId, Timestamp: fields.PasswordChangedAt, Action: 'STAFF PASSWORD RECOVERED',
          Username: row.Username, ActorUsername: row.Username, Actor: clean(row.DisplayName || row.Username),
          Role: row.Role, BranchId: clean(row.BranchId) || 'main', SourcePlatform: 'Web',
          Details: 'One-time recovery email code verified. Password replaced and prior web sessions invalidated. Roles, permissions and MFA unchanged.' } }
    ]);
  } catch (error) {
    if ([404, 409, 412].includes(Number(error.status)) || error.code === 'FIRESTORE_WRITE_CONFLICT') throw invalidCode();
    throw error;
  }
}
