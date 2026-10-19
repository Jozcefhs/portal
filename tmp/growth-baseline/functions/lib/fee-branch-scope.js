import { getDocument, queryCollection } from './firestore.js';
import { enforceActorBranch } from './branch-scope.js';
import { canonicalSchoolBranchId } from './school-scope.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const fail = (message, status = 409) => { const error = new Error(message); error.status = status; throw error; };

// The old catalogue had no branch field. Those records belong to Main, not
// to every branch. Never copy, delete or rewrite historical invoices here.
export function feeBranchId(row = {}) {
  const value = row.BranchId || row.branchId;
  return canonicalSchoolBranchId(!value || lower(value) === 'all' ? 'main' : value);
}

export function feeRowsForBranch(rows = [], branchId = 'main') {
  if (lower(branchId) === 'all') return [...rows];
  const branch = canonicalSchoolBranchId(branchId);
  return rows.filter(row => feeBranchId(row) === branch);
}

export function feeMatchesBranch(fee, account) {
  return feeBranchId(fee) === feeBranchId(account);
}

export function feeSetupBranch(body = {}) {
  const requested = clean(body.BranchId || body.branchId);
  if (lower(requested) === 'all') fail('Select one branch before changing its fee components.', 400);
  const canonical = value => !clean(value) || lower(value) === 'all' ? '' : canonicalSchoolBranchId(value);
  const branch = enforceActorBranch({ branchId: canonical(body.UserBranchId || body.userBranchId) }, canonical(requested));
  enforceActorBranch({ branchId: canonical(body.DeviceBranchId) }, branch);
  return branch;
}

const legacyFeeId = code => clean(code).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/-+/g, '-').slice(0, 140);

export async function scopedFeeDocumentId(branchId, feeCode) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([canonicalSchoolBranchId(branchId), lower(feeCode)])));
  return `FEE-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

// Direct reads for normal records; a bounded business-code query supports old
// imports with arbitrary document IDs. A foreign branch record is never reused.
export async function resolveFeeDocument(env, branchId, feeCode, overrides = {}) {
  const db = { getDocument, queryCollection, ...overrides };
  const documentId = await scopedFeeDocumentId(branchId, feeCode);
  const matches = row => row && feeBranchId(row) === canonicalSchoolBranchId(branchId)
    && lower(row.FeeCode || row.feeCode || row.__id) === lower(feeCode);
  const scoped = await db.getDocument(env, 'feeItems', documentId);
  if (scoped) {
    if (!matches(scoped)) fail('The fee storage identity conflicts with another record. Contact support.');
    return { documentId, existing: scoped };
  }
  const oldId = legacyFeeId(feeCode);
  const legacy = await db.getDocument(env, 'feeItems', oldId);
  if (matches(legacy)) return { documentId: legacy.__id || oldId, existing: legacy };
  const candidates = await db.queryCollection(env, 'feeItems', {
    filters: [{ field: 'FeeCode', op: '==', value: clean(feeCode) }, { field: 'feeCode', op: '==', value: clean(feeCode) }],
    filterJoin: 'OR', limit: 101
  });
  if (candidates.length >= 101) fail('Too many records use this fee code. Contact support before editing it.');
  const owned = candidates.filter(matches);
  if (owned.length > 1) fail('Duplicate fee components exist in this branch. Resolve them before editing.');
  return owned.length ? { documentId: owned[0].__id, existing: owned[0] } : { documentId, existing: null };
}

export function feeDocumentWrite(target, data, operation = 'update') {
  if (target.existing && !target.existing.__updateTime) fail('Refresh Fee Setup before changing this fee.');
  return { collectionPath: 'feeItems', documentId: target.documentId, literalDocumentId: true,
    operation, data, ...(target.existing ? { updateTime: target.existing.__updateTime } : { exists: false }) };
}
