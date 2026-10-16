import { listCollectionPage } from './firestore.js';

const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

// Fixed-cost history reads shared by operational modules. Authorization remains
// the caller's existing predicate and is applied again on EVERY page.
export async function loadWorkspaceHistoryPage(env, user, config, cursor = null, overrides = {}) {
  const fetchPage = overrides.listCollectionPage || listCollectionPage;
  const scope = JSON.stringify([env.FIREBASE_PROJECT_ID, user.username, user.role,
    user.branchId, user.schoolSectionAccess, user.edition, config.key, config.collection]);
  const now = Date.now();
  const readTime = cursor === null ? new Date(now).toISOString() : cursor?.readTime;
  if (cursor !== null && (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)
    || cursor.version !== 2 || cursor.scope !== scope || typeof cursor.pageToken !== 'string'
    || !cursor.pageToken || cursor.pageToken.length > 12000 || typeof readTime !== 'string'
    || !Number.isFinite(Date.parse(readTime)) || Date.parse(readTime) > now
    || Date.parse(readTime) < now - 50 * 60 * 1000)) fail('This history page expired or belongs to another workspace. Refresh the history.');
  const rows = [], seenTokens = new Set();
  let pageToken = cursor?.pageToken || '';
  // Firestore's default document-name order needs no custom index and includes
  // legacy records without dates. Reversing __name__ can require an index.
  // The UI labels this as paged history, not a complete/recent report. Version 2
  // rejects tokens from the old descending order before they reach Firestore.
  const query = new URLSearchParams({ readTime }).toString();
  for (let page = 0; page < 4; page += 1) {
    const pageSize = 100 - rows.length;
    const result = await fetchPage(env, config.collection, { pageSize, pageToken, query });
    if (!Array.isArray(result.documents) || result.documents.length > pageSize || typeof result.nextPageToken !== 'string') throw new Error('History returned an incomplete page. Retry loading history.');
    rows.push(...result.documents.filter(config.visible));
    const next = result.nextPageToken;
    if (next && (next === pageToken || seenTokens.has(next))) throw new Error('History could not advance to the next page. Refresh history.');
    if (next) seenTokens.add(next);
    pageToken = next;
    if (!pageToken || rows.length === 100) break;
  }
  return { rows, nextCursor: pageToken ? { version: 2, scope, readTime, pageToken } : null };
}
