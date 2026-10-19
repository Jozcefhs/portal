import { listCollectionPage } from './firestore.js';
import { actorBranchScope, branchRecordVisible } from './branch-scope.js';

const clean = (value) => String(value ?? '').trim();
const PAGE_SIZE = 80;
const MAX_READS = 4;
const CURSOR_LIFETIME_MS = 50 * 60 * 1000;

// A small, ordered read independent of the staff directory. Filter every page
// using the same branch rules as staff administration, including legacy main
// records. Do not scan the entire log or relax the shared collection limit.
export async function loadStaffSecurityHistory(env, actor, cursor = null, overrides = {}) {
  const fetchPage = overrides.listCollectionPage || listCollectionPage;
  const scope = JSON.stringify([clean(env.FIREBASE_PROJECT_ID), actorBranchScope(actor), clean(actor.edition)]);
  const now = Date.now();
  const readTime = cursor === null ? new Date(now).toISOString() : cursor?.readTime;
  if (cursor !== null && (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)
    || cursor.version !== 1 || cursor.scope !== scope || typeof cursor.pageToken !== 'string'
    || !cursor.pageToken || cursor.pageToken.length > 12000 || typeof readTime !== 'string'
    || !Number.isFinite(Date.parse(readTime)) || Date.parse(readTime) > now
    || Date.parse(readTime) < now - CURSOR_LIFETIME_MS)) {
    throw Object.assign(new Error('This security-history page has expired or belongs to another workspace. Refresh security activity.'), { status: 400 });
  }
  let pageToken = cursor?.pageToken || '';
  const rows = [], seenTokens = new Set();
  const query = new URLSearchParams({ orderBy: 'Timestamp desc, __name__ desc', readTime }).toString();
  for (let page = 0; page < MAX_READS; page += 1) {
    const pageSize = PAGE_SIZE - rows.length;
    const result = await fetchPage(env, 'staffSecurityAudit', { pageSize, pageToken, query });
    if (!Array.isArray(result.documents) || result.documents.length > pageSize || typeof result.nextPageToken !== 'string') {
      throw new Error('Security activity returned an incomplete page. Retry loading security activity.');
    }
    for (const row of result.documents.filter((entry) => branchRecordVisible(entry, actor))) {
      rows.push({
        AuditId: clean(row.__id || row.AuditId), Timestamp: clean(row.Timestamp),
        Action: clean(row.Action), Username: clean(row.Username), Actor: clean(row.Actor || row.ActorUsername),
        BranchId: clean(row.BranchId || row.branchId || 'main'),
        SourcePlatform: clean(row.SourcePlatform), Details: clean(row.Details)
      });
    }
    const next = result.nextPageToken;
    if (next && (next === pageToken || seenTokens.has(next))) throw new Error('Security activity could not advance to the next page. Refresh security activity.');
    if (next) seenTokens.add(next);
    pageToken = next;
    if (!pageToken || rows.length >= PAGE_SIZE) break;
  }
  return { rows, readTime, nextCursor: pageToken ? { version: 1, scope, readTime, pageToken } : null };
}
