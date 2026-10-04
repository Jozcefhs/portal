// Complete a fixed audit snapshot in bounded requests, never treating partial
// results as the period total or silently skipping failed sources.
export async function loadCompleteSecurityAudit(request, scope, onProgress = () => {}, isCurrent = () => true) {
  const rows = new Map();
  const facets = {};
  const cursors = new Set();
  let batchCursor = null;
  let readTime = '';
  let scanned = 0;
  while (isCurrent()) {
    const data = await request('list', { ...scope, paged: true, ...(batchCursor ? { batchCursor } : {}) });
    if (!isCurrent()) return null;
    if (data.paged !== true || data.fromDate !== scope.fromDate || data.toDate !== scope.toDate
      || !data.readTime || readTime && data.readTime !== readTime) {
      throw new Error('The audit snapshot changed or the portal needs updating. Refresh the audit log.');
    }
    if (data.warnings?.length) throw new Error(data.warnings.join(' '));
    readTime = data.readTime;
    for (const row of data.rows || []) {
      if (!row.AuditId || !row.SourceCollection) throw new Error('An audit record has no stable identity. Refresh the audit log.');
      rows.set(`${row.SourceCollection}/${row.AuditId}`, row);
    }
    for (const [key, values] of Object.entries(data.facets || {})) {
      facets[key] ||= new Set();
      values.forEach((value) => facets[key].add(value));
    }
    scanned += Number(data.scanned || 0);
    onProgress({ scanned, loaded: rows.size });
    if (data.done === true) {
      if (data.nextCursor) throw new Error('The audit result has an unexpected continuation. Refresh the audit log.');
      return { ...scope, readTime, rows: [...rows.values()].sort((a, b) => b.Timestamp.localeCompare(a.Timestamp)
        || `${a.SourceCollection}/${a.AuditId}`.localeCompare(`${b.SourceCollection}/${b.AuditId}`)),
      facets: Object.fromEntries(Object.entries(facets).map(([key, values]) => [key, [...values].sort((a, b) => a.localeCompare(b))])),
      warnings: [], totalMatches: rows.size, truncated: false, complete: true };
    }
    const cursorKey = JSON.stringify(data.nextCursor);
    if (!data.nextCursor || cursors.has(cursorKey) || data.nextCursor.readTime !== readTime
      || data.nextCursor.fromDate !== scope.fromDate || data.nextCursor.toDate !== scope.toDate) {
      throw new Error('The audit cursor did not advance. Refresh the audit log.');
    }
    cursors.add(cursorKey);
    batchCursor = data.nextCursor;
  }
  return null;
}
