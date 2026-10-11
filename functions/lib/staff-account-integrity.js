import { batchCommitLiteralDocuments, getDocument, listCollection } from './firestore.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const failure = (message, status = 409) => Object.assign(new Error(message), { status });
const GUARD_ID = 'staffAccountIntegrity';

export function staffAccountDocumentId(username) {
  const id = lower(username).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  if (!id || ['.', '..'].includes(id)) throw failure('Enter a valid username.', 400);
  return id;
}

function rowId(row) {
  return clean(row.__id) || staffAccountDocumentId(row.Username || row.username);
}

function isActiveSuperAdmin(row) {
  return clean(row.Role || row.role) === 'Super Admin'
    && !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(row.Active ?? true));
}

export function staffAccountCondition(existing) {
  if (!existing) return { exists: false };
  if (clean(existing.__updateTime)) return { updateTime: existing.__updateTime };
  throw failure('Reload staff accounts before saving; their current database version is required.');
}

export async function beginStaffAccountChange(env) {
  // Read the guard BEFORE the directory. Every management commit changes it,
  // so concurrent creates, imports and demotions cannot use a stale directory.
  const guard = await getDocument(env, 'settings', GUARD_ID);
  const rows = await listCollection(env, 'staffUsers');
  return { guard, rows };
}

export function resolveStaffAccountTarget(rows, username, originalUsername = '', { importing = false } = {}) {
  const wanted = lower(username);
  if (!wanted) throw failure('Username is required.', 400);
  const matches = rows.filter((row) => lower(row.Username || row.username || row.__id) === wanted);
  if (matches.length > 1) throw failure('This username has conflicting account records. Review them before editing.');
  const existing = matches[0] || null;
  if (!importing) {
    if (clean(originalUsername)) {
      if (lower(originalUsername) !== wanted) throw failure('The account username cannot be changed.');
      if (!existing) throw failure('The selected staff account no longer exists. Reload staff accounts.', 404);
    } else if (existing) {
      throw failure('That username already exists. Open the existing account to edit it.');
    }
  }
  const id = existing ? rowId(existing) : staffAccountDocumentId(username);
  if (rows.some((row) => row !== existing && (rowId(row) === id
      || [row.Username, row.LoginUsername, row.UsernameKey, row.LoginUsernameKey].some((value) => lower(value) === wanted)))) {
    throw failure('That username conflicts with an existing staff account. Choose a different username.');
  }
  return { existing, id };
}

export function staffAccountWrite(existing, username, data) {
  const payload = { ...data };
  for (const key of Object.keys(payload)) if (key.startsWith('__')) delete payload[key];
  return { collectionPath: 'staffUsers', documentId: existing ? rowId(existing) : staffAccountDocumentId(username),
    data: payload, ...staffAccountCondition(existing) };
}

export function assertStaffAccountFinalState(rows, writes) {
  const final = new Map(rows.map((row) => [rowId(row), row]));
  for (const write of writes.filter((row) => row.collectionPath === 'staffUsers')) {
    if (write.operation === 'delete') final.delete(write.documentId);
    else final.set(write.documentId, write.data);
  }
  if (rows.some(isActiveSuperAdmin) && ![...final.values()].some(isActiveSuperAdmin)) {
    throw failure('At least one active Super Admin must remain.');
  }
}

export async function commitStaffAccountChanges(env, state, writes) {
  if (!writes.length) return;
  if (writes.length > 499) throw failure('Split this staff account update into smaller batches.', 400);
  assertStaffAccountFinalState(state.rows, writes);
  try {
    await batchCommitLiteralDocuments(env, [
      ...writes,
      { collectionPath: 'settings', documentId: GUARD_ID,
        data: { Revision: crypto.randomUUID(), UpdatedAt: new Date().toISOString() },
        ...staffAccountCondition(state.guard) }
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status))) {
      throw failure('Staff accounts changed while saving. Refresh the list and try again.');
    }
    throw error;
  }
}
