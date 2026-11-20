export async function collectBranchBackup(branchId, request, progress) {
  const plan = await request('plan-branch-backup', { branchId });
  if (plan.scope !== 'branch' || !branchId || plan.branchId !== branchId || !plan.workspaceId || !plan.edition ||
      !plan.createdAt || plan.format !== 'dynamax-organization-backup' || !Array.isArray(plan.paths) ||
      new Set(plan.paths).size !== plan.paths.length) throw new Error('The server could not confirm the selected backup scope.');
  const { format, formatVersion, createdAt, workspaceId, edition, scope } = plan;
  const collections = Object.create(null);
  for (const path of plan.paths) {
    const rows = [], ids = new Set(), cursors = new Set();
    let cursor = '';
    do {
      const page = await request('export-branch-page', { branchId, collectionPath: path, createdAt, cursor });
      if (page.branchId !== branchId || page.workspaceId !== workspaceId || page.edition !== edition ||
          page.collectionPath !== path || page.createdAt !== createdAt || !Array.isArray(page.documents) ||
          typeof page.cursor !== 'string') throw new Error('The backup page does not match the selected branch.');
      for (const row of page.documents) {
        if (!row?.__id || ids.has(row.__id)) throw new Error('Invalid or duplicate record in ' + path);
        ids.add(row.__id);
        rows.push(row);
      }
      cursor = page.cursor;
      if (cursor && cursors.has(cursor)) throw new Error('The backup service repeated a page.');
      cursors.add(cursor);
    } while (cursor);
    collections[path] = rows;
    progress(Object.keys(collections).length, plan.paths.length);
  }
  return { format, formatVersion, createdAt, workspaceId, edition, scope, branchId, collections };
}
