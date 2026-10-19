import { batchUpsertDocuments, deleteDocument, listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { hashStaffPassword, requireStaffSession } from '../lib/staff-auth.js';

function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function safeId(value) { return lower(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120); }
function nowIso() { return new Date().toISOString(); }
function activeValue(value) { return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(value)); }

function publicUser(row) {
  return {
    Username: clean(row.Username || row.username || row.__id),
    DisplayName: clean(row.DisplayName || row.displayName),
    Role: clean(row.Role || row.role) || 'Front Desk',
    Department: clean(row.Department || row.department),
    BranchId: clean(row.BranchId || row.branchId),
    SchoolSectionAccess: clean(row.SchoolSectionAccess || row.schoolSectionAccess) || 'All',
    ApprovalEnabled: row.ApprovalEnabled === undefined ? false : activeValue(row.ApprovalEnabled),
    ApprovalMaxAmount: Number(row.ApprovalMaxAmount || 0) || 0,
    ApprovalAccounts: Array.isArray(row.ApprovalAccounts) ? row.ApprovalAccounts : clean(row.ApprovalAccounts).split(',').map(clean).filter(Boolean),
    TabAccess: Array.isArray(row.TabAccess) ? row.TabAccess : clean(row.TabAccess).split(',').map(clean).filter(Boolean),
    Active: row.Active === undefined ? true : activeValue(row.Active),
    MustChangePassword: row.MustChangePassword === undefined ? false : activeValue(row.MustChangePassword),
    CreatedAt: clean(row.CreatedAt),
    UpdatedAt: clean(row.UpdatedAt),
    LastLoginAt: clean(row.LastLoginAt)
  };
}

async function audit(env, actor, action, username, details = '') {
  const id = `STAFF-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, 'staffSecurityAudit', id, {
    AuditId: id,
    Timestamp: nowIso(),
    Action: action,
    Username: username,
    Details: clean(details),
    Actor: actor.displayName || actor.username,
    ActorUsername: actor.username,
    SourcePlatform: 'Web'
  });
}

function ensureSuperAdmin(actor) {
  if (actor.role === 'Super Admin') return;
  const err = new Error('Only Super Admin can manage staff accounts.');
  err.status = 403;
  throw err;
}

function activeSuperAdmins(rows, excluding = '') {
  return rows.filter((row) => lower(row.Username || row.__id) !== lower(excluding) &&
    clean(row.Role) === 'Super Admin' && (row.Active === undefined || activeValue(row.Active)));
}

async function listUsers(env) {
  const rows = await listCollection(env, 'staffUsers');
  return rows.map(publicUser).sort((a, b) => a.Username.localeCompare(b.Username));
}

async function listSecurityAudit(env) {
  const rows = await listCollection(env, 'staffSecurityAudit');
  return rows.sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp))).slice(0, 80).map((row) => ({
    Timestamp: clean(row.Timestamp), Action: clean(row.Action), Username: clean(row.Username),
    Actor: clean(row.Actor || row.ActorUsername), SourcePlatform: clean(row.SourcePlatform), Details: clean(row.Details)
  }));
}

async function saveUser(env, actor, body) {
  const username = clean(body.Username || body.username);
  if (!username) { const err = new Error('Username is required.'); err.status = 400; throw err; }
  const id = safeId(username);
  if (!id) { const err = new Error('Enter a valid username.'); err.status = 400; throw err; }
  const rows = await listCollection(env, 'staffUsers');
  const existing = rows.find((row) => lower(row.Username || row.__id) === lower(username));
  const role = clean(body.Role || body.role) || 'Front Desk';
  const department = clean(body.Department || body.department);
  const active = activeValue(body.Active === undefined ? true : body.Active);
  if (role === 'Department User' && !department) { const err = new Error('Department is required for a Department User.'); err.status = 400; throw err; }
  if (existing && clean(existing.Role) === 'Super Admin' && activeValue(existing.Active === undefined ? true : existing.Active) &&
      (role !== 'Super Admin' || !active) && activeSuperAdmins(rows, username).length === 0) {
    const err = new Error('At least one active Super Admin must remain.'); err.status = 409; throw err;
  }
  const password = String(body.Password || body.password || '');
  if (!existing && !password) { const err = new Error('Password is required for a new staff account.'); err.status = 400; throw err; }
  const passwordFields = password ? await hashStaffPassword(password) : {};
  const payload = {
    ...(existing || {}),
    Username: username,
    DisplayName: clean(body.DisplayName || body.displayName) || username,
    Role: role,
    Department: department,
    BranchId: clean(body.BranchId || body.branchId),
    SchoolSectionAccess: clean(body.SchoolSectionAccess || body.schoolSectionAccess) || 'All',
    ApprovalEnabled: role === 'Super Admin' ? true : activeValue(body.ApprovalEnabled ?? false),
    ApprovalMaxAmount: Math.max(0, Number(body.ApprovalMaxAmount || 0) || 0),
    ApprovalAccounts: Array.isArray(body.ApprovalAccounts) ? body.ApprovalAccounts.map(clean).filter(Boolean) : clean(body.ApprovalAccounts).split(',').map(clean).filter(Boolean),
    TabAccess: Array.isArray(body.TabAccess) ? body.TabAccess.map(clean).filter(Boolean) : clean(body.TabAccess).split(',').map(clean).filter(Boolean),
    Active: active,
    MustChangePassword: password ? activeValue(body.MustChangePassword === undefined ? true : body.MustChangePassword) : activeValue(existing?.MustChangePassword || false),
    ...passwordFields,
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actor.displayName || actor.username,
    UpdatedAt: nowIso(),
    UpdatedBy: actor.displayName || actor.username
  };
  delete payload.__id;
  delete payload.__name;
  await upsertDocument(env, 'staffUsers', id, payload);
  await audit(env, actor, existing ? 'UPDATE USER' : 'CREATE USER', username, `${role}${department ? ` | ${department}` : ''}`);
  return { ok: true, message: existing ? 'Staff account updated.' : 'Staff account created.', user: publicUser(payload) };
}

async function importUsers(env, actor, body) {
  const users = Array.isArray(body.users) ? body.users.slice(0, 500) : [];
  if (!users.length) { const err = new Error('Choose a CSV containing at least one staff row.'); err.status = 400; throw err; }
  const existingRows = await listCollection(env, 'staffUsers');
  const existingByName = new Map(existingRows.map((row) => [lower(row.Username || row.__id), row]));
  const writes = []; const failures = []; const seen = new Set();
  for (let index = 0; index < users.length; index += 1) {
    try {
      const row = users[index] || {};
      const username = clean(row.Username || row.username);
      const id = safeId(username);
      if (!username || !id) throw new Error('Username is required.');
      if (seen.has(lower(username))) throw new Error('Duplicate username in this CSV.');
      seen.add(lower(username));
      const existing = existingByName.get(lower(username));
      const password = String(row.Password || row.password || '');
      if (!existing && !password) throw new Error('Password is required for a new staff account.');
      const role = clean(row.Role || row.role) || 'Front Desk';
      const department = clean(row.Department || row.department);
      if (role === 'Department User' && !department) throw new Error('Department is required for a Department User.');
      const payload = {
        ...(existing || {}), Username: username,
        DisplayName: clean(row.DisplayName || row.displayName) || username,
        Role: role, Department: department,
        BranchId: clean(row.BranchId || row.branchId),
        SchoolSectionAccess: clean(row.SchoolSectionAccess || row.schoolSectionAccess) || 'All',
        ApprovalEnabled: role === 'Super Admin' ? true : activeValue(row.ApprovalEnabled ?? false),
        ApprovalMaxAmount: Math.max(0, Number(row.ApprovalMaxAmount || 0) || 0),
        ApprovalAccounts: clean(row.ApprovalAccounts).split(/[;,]/).map(clean).filter(Boolean),
        TabAccess: clean(row.TabAccess).split(/[;,]/).map(clean).filter(Boolean),
        Active: activeValue(row.Active === undefined ? true : row.Active),
        MustChangePassword: activeValue(row.MustChangePassword === undefined ? true : row.MustChangePassword),
        ...(password ? await hashStaffPassword(password) : {}),
        CreatedAt: existing?.CreatedAt || nowIso(), CreatedBy: existing?.CreatedBy || actor.displayName || actor.username,
        UpdatedAt: nowIso(), UpdatedBy: actor.displayName || actor.username
      };
      delete payload.__id; delete payload.__name;
      writes.push({ collectionPath: 'staffUsers', documentId: id, data: payload });
    } catch (error) {
      failures.push({ row: index + 2, username: clean(users[index]?.Username), message: error.message || String(error) });
    }
  }
  if (writes.length) await batchUpsertDocuments(env, writes);
  const imported = writes.length;
  await audit(env, actor, 'BULK IMPORT', `${imported} staff`, `${failures.length} failed`);
  return { ok: true, message: `${imported} staff account(s) uploaded${failures.length ? `; ${failures.length} failed.` : '.'}`, imported, failures };
}

async function deleteUser(env, actor, body) {
  const username = clean(body.Username || body.username);
  const rows = await listCollection(env, 'staffUsers');
  const existing = rows.find((row) => lower(row.Username || row.__id) === lower(username));
  if (!existing) { const err = new Error('Staff account was not found.'); err.status = 404; throw err; }
  if (lower(username) === lower(actor.username)) { const err = new Error('You cannot delete the account currently signed in.'); err.status = 409; throw err; }
  if (clean(existing.Role) === 'Super Admin' && activeValue(existing.Active === undefined ? true : existing.Active) && activeSuperAdmins(rows, username).length === 0) {
    const err = new Error('At least one active Super Admin must remain.'); err.status = 409; throw err;
  }
  await deleteDocument(env, 'staffUsers', existing.__id || safeId(username));
  await audit(env, actor, 'DELETE USER', username, clean(existing.Role));
  return { ok: true, message: 'Staff account deleted.' };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const actor = await requireStaffSession(env, request);
    ensureSuperAdmin(actor);
    const body = await request.json().catch(() => ({}));
    const action = lower(body.action || 'list');
    let result;
    if (action === 'list') {
      const [users, audit, accounts] = await Promise.all([listUsers(env), listSecurityAudit(env), listCollection(env, 'chartOfAccounts')]);
      result = { ok: true, users, audit, approvalAccounts: accounts.filter((row) => activeValue(row.Active === undefined ? true : row.Active)).map((row) => ({ Code: clean(row.Code || row.__id), Name: clean(row.Name) })).filter((row) => row.Code).sort((a, b) => a.Code.localeCompare(b.Code)) };
    }
    else if (action === 'save') result = await saveUser(env, actor, body);
    else if (action === 'delete') result = await deleteUser(env, actor, body);
    else if (action === 'import') result = await importUsers(env, actor, body);
    else { const err = new Error('Unknown staff-user action.'); err.status = 400; throw err; }
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
