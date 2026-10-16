import { getFirestoreAccessToken, firestoreBaseUrl, batchCommitDocuments } from './firestore.js';

// Lock evidence for the commit without rewriting its fields OR update revision.
// Unlike a no-op update, this leaves original wallet debits/receipts untouched.
export async function commitWithReadChecks(env, writes, checks, dependencies = {}) {
  const token = await (dependencies.token || getFirestoreAccessToken)(env);
  const base = (dependencies.base || firestoreBaseUrl)(env);
  const request = dependencies.fetch || fetch;
  const commit = dependencies.commit || batchCommitDocuments;
  const resource = base.replace(/^https:\/\/firestore.googleapis.com\/v1\//, '');
  const expected = new Map();
  for (const check of checks) {
    if (!/^[A-Za-z0-9_-]+$/.test(check.collectionPath) || !/^[A-Za-z0-9_-]+$/.test(check.documentId) || !check.updateTime)
      throw new Error('A checked commit requires valid source identifiers and revisions.');
    expected.set(`${resource}/${check.collectionPath}/${check.documentId}`, check.updateTime);
  }
  if (!expected.size || expected.size > 30) throw new Error('A checked commit requires 1 to 30 evidence records.');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let transaction = '';
  try {
    const response = await request(`${base}:batchGet`, { method: 'POST', headers,
      body: JSON.stringify({ documents: [...expected.keys()], mask: { fieldPaths: [] }, newTransaction: { readWrite: {} } }) });
    const data = await response.json();
    if (Array.isArray(data)) transaction = data.find(row => row.transaction)?.transaction || '';
    if (!response.ok || !transaction) throw Object.assign(new Error('Could not lock the original refund evidence. Refresh before retrying.'), { status: 409 });
    const found = new Map();
    for (const row of data) {
      if (!row.found && !row.missing) continue;
      const name = row.found?.name || row.missing;
      if (!expected.has(name) || found.has(name)) throw new Error('Unexpected refund evidence response.');
      found.set(name, row.found?.updateTime || '');
    }
    if (found.size !== expected.size || [...expected].some(([name, revision]) => found.get(name) !== revision))
      throw Object.assign(new Error('Original refund evidence changed. No refund was posted; refresh for review.'), { status: 409 });
    return await commit(env, writes, { transaction });
  } catch (error) {
    if (transaction) await request(`${base}:rollback`, { method: 'POST', headers, body: JSON.stringify({ transaction }) }).catch(() => {});
    throw error;
  }
}
