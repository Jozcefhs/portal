import { modulePermissionRole } from './module-authority.js';
import { batchCommitLiteralDocuments, getDocument, queryCollectionPages } from './firestore.js';
import { credentialStateId } from './staff-credential-state.js';
import { verifyStaffApprovalPassword } from './staff-auth.js';
import { assignedStaffBranches, staffAccountVisibleInBranch } from './staff-branch-access.js';
import { staffRecordMatchesEdition } from './records-desk.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const active = value => !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(value ?? true));
const affirmative = value => value === true || ['yes', 'true', '1', 'enabled'].includes(lower(value));
const condition = row => {
  if (!row) return { exists: false };
  if (!row.__id || !row.__updateTime) fail('A security record has no current database revision. Refresh and try again.');
  return { updateTime: row.__updateTime };
};
const publicData = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
const profileId = username => lower(username).replace(/[^a-z0-9._@-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 160);
const dependencies = { batchCommitLiteralDocuments, getDocument, queryCollectionPages, verifyStaffApprovalPassword };

async function resolveTarget(env, value, db) {
  const filters = ['Username', 'username', 'UsernameKey', 'LoginUsername', 'loginUsername', 'LoginUsernameKey']
    .flatMap(field => [...new Set([clean(value), lower(value)])].map(item => ({ field, op: '==', value: item })));
  const rows = await db.queryCollectionPages(env, 'staffUsers', { filters, filterJoin: 'OR', pageSize: 20, maxRows: 20 });
  const directId = lower(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  const direct = directId ? await db.getDocument(env, 'staffUsers', directId) : null;
  if (direct && [direct.Username, direct.username, direct.__id, direct.LoginUsername].some(item => lower(item) === lower(value))) rows.push(direct);
  const matches = [...new Map(rows.map(row => [row.__id, row])).values()];
  if (matches.length !== 1) fail(matches.length ? 'This staff identity is ambiguous. Review the account records.' : 'The selected staff account no longer exists.', matches.length ? 409 : 404);
  return matches[0];
}

export async function recoverStaffSecurity(env, actor, body = {}, overrides = {}) {
  const db = { ...dependencies, ...overrides };
  if (modulePermissionRole(actor, 'staffUsers') !== 'Super Admin' || assignedStaffBranches(actor) !== null) fail('Only an organisation-wide Super Administrator can recover staff sign-in.', 403);
  if (actor.subscriptionReadOnly || actor.subscriptionActive === false) fail('The subscription is read-only.', 403);
  if (!await db.verifyStaffApprovalPassword(env, actor.username, body.currentPassword)) fail('The current administrator password is incorrect.', 401);
  const targetInput = clean(body.targetUsername), operationId = clean(body.operationId), reason = clean(body.reason);
  if (!targetInput || targetInput.length > 160) fail('Choose the staff account to recover.', 400);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(operationId)) fail('Refresh staff management to start a new account recovery.', 400);
  if (!reason || reason.length > 500) fail('Enter a recovery reason of up to 500 characters.', 400);
  const target = await resolveTarget(env, targetInput, db);
  const username = clean(target.Username || target.username || target.__id);
  const identities = [username, target.LoginUsername, target.loginUsername, target.__id].map(lower);
  if ([actor.username, actor.loginUsername].map(lower).filter(Boolean).some(identity => identities.includes(identity))) fail('Use another authorised administrator to recover your own account.');
  if (!staffRecordMatchesEdition(target, actor) || !staffAccountVisibleInBranch(target, actor)) fail('This staff account is outside the current organisation or branch.', 403);
  if (!active(target.Active)) fail('This account is disabled. Review its status before recovering sign-in.');
  if (!target.PasswordHash || !target.Salt || affirmative(target.PasswordSetupRequired)) fail('Set up this staff account password before recovering device sign-in.');
  const auditId = `STAFF-SECURITY-RECOVERY-${await credentialStateId(operationId)}`;
  const previous = await db.getDocument(env, 'staffSecurityAudit', auditId);
  if (previous) {
    if (previous.OperationId !== operationId || lower(previous.ActorUsername) !== lower(actor.username) ||
      lower(previous.Username) !== lower(username) || previous.Reason !== reason || !previous.Result) fail('This recovery request was already used for another account or reason.');
    return { ...previous.Result, alreadyCompleted: true, replay: true };
  }
  // Read before the factor queries. Enrollment also advances this revision,
  // preventing a new passkey or TOTP setup from slipping past this snapshot.
  const stateId = await credentialStateId(username);
  const state = await db.getDocument(env, 'staffCredentialRevocations', stateId);
  if (clean(state?.Epoch) !== clean(target.PasswordRecoveryEpoch)) fail('The account security state changed. Refresh and try again.');
  const [profile, passkeys, policy] = await Promise.all([
    db.getDocument(env, 'staffMfaProfiles', profileId(username)),
    db.queryCollectionPages(env, 'staffPasskeys', { filters: [
      { field: 'UsernameKey', op: '==', value: lower(username) },
      ...[...new Set([username, lower(username)])].map(value => ({ field: 'Username', op: '==', value }))
    ], filterJoin: 'OR', pageSize: 100, maxRows: 400 }),
    db.getDocument(env, 'settings', 'staffMfaPolicy')
  ]);
  const owned = row => [row.UsernameKey, row.Username].map(lower).filter(Boolean).length > 0 &&
    [row.UsernameKey, row.Username].map(lower).filter(Boolean).every(value => value === lower(username));
  if (profile && !owned(profile)) fail('The MFA profile belongs to another account.');
  if (passkeys.some(row => !owned(row))) fail('A passkey belongs to another account.');
  const activePasskeys = passkeys.filter(row => active(row.Active));
  const now = new Date().toISOString(), epoch = crypto.randomUUID();
  const fields = { PasswordRecoveryEpoch: epoch, SecurityRecoveryAt: now, SecurityRecoveryBy: actor.username,
    UpdatedAt: now, UpdatedBy: actor.username };
  const mode = clean(policy?.Mode || 'OPTIONAL').toUpperCase();
  const policyRequired = mode === 'REQUIRED_ALL' || mode === 'REQUIRED_ROLES' && (policy?.RequiredRoles || []).includes(target.Role);
  const reEnrollmentRequired = target.Role === 'External Auditor' || policyRequired && (!policy?.EnforceFrom || Date.parse(policy.EnforceFrom) <= Date.now());
  const result = { targetUsername: username, revokedPasskeys: activePasskeys.length, sessionsRevoked: true,
    reEnrollmentRequired: Boolean(reEnrollmentRequired), alreadyCompleted: false, replay: false,
    message: `Sign-in recovered for ${clean(target.DisplayName || username)}. Previous devices and sessions are revoked. Use the existing password${reEnrollmentRequired ? ' and enrol a replacement security method to continue' : ' to sign in'}.` };
  const writes = [
    { collectionPath: 'staffUsers', documentId: target.__id, ...condition(target), updateMask: Object.keys(fields), data: fields },
    { collectionPath: 'staffCredentialRevocations', documentId: stateId, ...condition(state),
      data: { ...publicData(state), Epoch: epoch, Revision: crypto.randomUUID(), ChangedAt: now } },
    ...activePasskeys.map(row => ({ collectionPath: 'staffPasskeys', documentId: row.__id, ...condition(row),
      updateMask: ['Active', 'RevokedAt', 'RevokedBy', 'RecoveryOperationId'],
      data: { Active: false, RevokedAt: now, RevokedBy: actor.username, RecoveryOperationId: operationId } }))
  ];
  if (profile) {
    const cleared = { TotpActive: false, TotpCiphertext: '', TotpIv: '', RecoveryCodeHashes: [], RecoveryCodesIssuedAt: '', LastTotpStep: -1,
      PendingTotpCiphertext: '', PendingTotpIv: '', PendingTotpExpiresAt: '', PendingTotpAuthEpoch: '',
      UpdatedAt: now, UpdatedBy: actor.username, AdministratorResetAt: now, RecoveryOperationId: operationId };
    writes.push({ collectionPath: 'staffMfaProfiles', documentId: profile.__id, ...condition(profile), updateMask: Object.keys(cleared), data: cleared });
  }
  writes.push({ collectionPath: 'staffSecurityAudit', documentId: auditId, exists: false, data: {
    AuditId: auditId, Timestamp: now, Action: 'ADMINISTRATOR RECOVERED STAFF SIGN-IN', Username: username,
    Actor: clean(actor.displayName || actor.username), ActorUsername: actor.username, BranchId: clean(target.BranchId || actor.branchId || 'main'),
    SourcePlatform: 'Web', OperationId: operationId, Reason: reason, Result: result,
    Details: `${activePasskeys.length} passkey(s) revoked; authenticator, pending setup and recovery codes cleared; prior sessions invalidated. Password, account permissions and business records preserved.`
  } });
  try { await db.batchCommitLiteralDocuments(env, writes); }
  catch (error) {
    if ([409, 412].includes(Number(error.status)) || error.code === 'FIRESTORE_WRITE_CONFLICT') {
      const committed = await db.getDocument(env, 'staffSecurityAudit', auditId);
      if (committed?.OperationId === operationId && lower(committed.ActorUsername) === lower(actor.username) &&
        lower(committed.Username) === lower(username) && committed.Reason === reason && committed.Result) return { ...committed.Result, alreadyCompleted: true, replay: true };
      fail('Account security changed during recovery. Refresh and try again.');
    }
    throw error;
  }
  return result;
}
