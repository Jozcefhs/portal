// The encrypted backup stays in this browser. The backend verifies ownership
// and current versions for every candidate before it can become a write.
export async function previewBranchBackup(payload, branchId, mode, request, chunks, progress) {
  if (!payload.collections || typeof payload.collections !== 'object' || Array.isArray(payload.collections)) throw new Error('This backup has no collection map.');
  const { format, formatVersion, createdAt, workspaceId, edition } = payload;
  const manifest = { format, formatVersion, createdAt, workspaceId, edition };
  if (payload.branchId) manifest.branchId = payload.branchId;
  if (payload.branchId && payload.branchId !== branchId) throw new Error('This backup was created for a different branch.');
  const scope = { manifest, branchId, mode };
  const paths = Object.keys(payload.collections);
  const plan = await request('preview-branch-restore', { ...scope, paths });
  if (plan.branchId !== branchId || !plan.phrase || !Array.isArray(plan.paths)) throw new Error('The server returned an invalid branch preview.');
  const groups = [], batches = [];
  const totals = { create: 0, update: 0, remove: 0, unchanged: 0, conflict: 0, skipped: 0 };
  const labels = { create: 'Add', update: 'Update', remove: 'Remove', unchanged: 'Unchanged', conflict: 'Ownership conflict' };
  for (const collectionPath of plan.paths) {
    progress(collectionPath);
    const rows = payload.collections[collectionPath];
    if (!Array.isArray(rows)) throw new Error('Invalid backup collection: ' + collectionPath);
    const ids = new Set();
    for (const row of rows) {
      const id = row?.__id;
      if (typeof id !== 'string' || !id || id !== id.trim() || ids.has(id)) throw new Error('Invalid or duplicate document ID in ' + collectionPath);
      ids.add(id);
    }
    const items = [];
    async function previewBatches(selected, remove) {
      for (const documents of chunks(selected)) {
        const part = await request('preview-branch-restore-rows', { ...scope, collectionPath, documents, remove });
        for (const { id, action } of part.details) {
          totals[action]++;
          items.push(labels[action] + ' · ' + id);
        }
        totals.skipped += part.skipped;
        if (part.hash) batches.push({ collectionPath, documents, remove, hash: part.hash });
      }
    }
    // Avoid transmitting explicitly foreign root records. Keep their IDs in
    // the comparison so an ambiguous ID can never become a removal.
    const candidates = rows.filter(row => !(row.BranchId || row.branchId) || row.BranchId === branchId || row.branchId === branchId);
    totals.skipped += rows.length - candidates.length;
    await previewBatches(candidates, false);
    if (mode === 'exact') {
      let cursor = '';
      do {
        const page = await request('preview-branch-restore-live', { ...scope, collectionPath, cursor });
        if (cursor && page.cursor === cursor) throw new Error('The live comparison stopped advancing.');
        await previewBatches(page.rows.filter(row => !ids.has(row.__id)), true);
        cursor = page.cursor;
      } while (cursor);
    }
    if (items.length) groups.push({ path: collectionPath, items });
  }
  return { scope, name: plan.name, phrase: plan.phrase, totals, batches, groups, excludedCollections: paths.length - plan.paths.length };
}

export function restoreSummary(plan) {
  const t = plan.totals;
  return `${plan.name} · ${plan.scope.mode === 'exact' ? 'Match the backup exactly' : 'Keep newer records'}. Add ${t.create}, update ${t.update}, remove ${t.remove}, unchanged ${t.unchanged}. Ownership conflicts skipped: ${t.conflict}. Other excluded rows in eligible collections: ${t.skipped}. Excluded collections: ${plan.excludedCollections}.`;
}

export function mountBranchRestore({ request, decrypt, safetyBackup, chunks, status, dialogs }) {
  const el = id => document.getElementById(id);
  const branch = el('restoreBranch'), mode = el('restoreMode'), file = el('restoreBackupFile'), password = el('restoreBackupPassword');
  const preview = el('previewBranchRestore'), apply = el('restoreDataBackup'), summary = el('branchRestoreSummary');
  let plan, busy = false;
  function controls() {
    for (const input of [branch, mode, file, password]) input.disabled = busy;
    preview.disabled = busy || !branch.value || !file.files.length;
    apply.disabled = busy || !plan?.batches.length;
  }
  function invalidate() { plan = null; summary.replaceChildren(); controls(); }
  for (const input of [branch, mode, file, password]) input.addEventListener('input', invalidate);
  invalidate();
  preview.addEventListener('click', async () => {
    invalidate();
    busy = true; controls();
    try {
      const backup = file.files[0];
      if (backup.size > 250 * 1024 * 1024) throw new Error('The backup exceeds the 250 MB browser limit.');
      const payload = await decrypt(JSON.parse(await backup.text()), password.value);
      plan = await previewBranchBackup(payload, branch.value, mode.value, request, chunks, path => status('Comparing ' + path + '…'));
      const headline = document.createElement('p');
      headline.textContent = restoreSummary(plan);
      summary.append(headline);
      for (const group of plan.groups) {
        const details = document.createElement('details'), title = document.createElement('summary');
        title.textContent = group.path + ' (' + group.items.length + ')';
        details.append(title);
        details.addEventListener('toggle', () => {
          if (!details.open || details.childElementCount > 1) return;
          const list = document.createElement('pre');
          list.style.cssText = 'max-height:16rem;overflow:auto;white-space:pre-wrap';
          list.textContent = group.items.join('\n'); details.append(list);
        });
        summary.append(details);
      }
      status('Read-only restore preview complete.', 'good');
    } catch (error) { invalidate(); status(error.message, 'bad'); }
    finally { busy = false; controls(); }
  });
  apply.addEventListener('click', async () => {
    if (busy || !plan?.batches.length) return;
    if (password.value.length < 10) return status('Enter at least 10 characters to encrypt the safety backup. Then preview the file again.', 'bad');
    busy = true; controls();
    try {
      const confirmation = await dialogs.prompt({ title: 'Restore ' + plan.name, message: restoreSummary(plan) + ' Type ' + plan.phrase + ' to apply these changes.',
        label: 'Exact confirmation', placeholder: plan.phrase, required: true, tone: 'danger', confirmText: 'Download safety backup and restore' });
      if (confirmation !== plan.phrase || !apply.isConnected) return;
      status('Creating the encrypted safety backup…');
      await safetyBackup(password.value);
      if (!apply.isConnected) return;
      const { jobId } = await request('prepare-branch-restore', { ...plan.scope, hashes: plan.batches.map(batch => batch.hash), confirmation, safetyBackupCreated: true });
      for (const [index, batch] of plan.batches.entries()) {
        status('Restoring ' + batch.collectionPath + ' (' + (index + 1) + ' of ' + plan.batches.length + ')…');
        await request('apply-branch-restore', { ...plan.scope, ...batch, jobId, index });
      }
      status('Branch restore completed. ' + restoreSummary(plan), 'good');
      invalidate();
    } catch (error) { invalidate(); status(error.message + ' Run a fresh preview before retrying.', 'bad'); }
    finally { busy = false; controls(); }
  });
}
