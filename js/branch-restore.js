const organisation = '@organisation';
// The encrypted backup stays in this browser. The backend verifies ownership
// and current versions for every candidate before it can become a write.
export async function previewBranchBackup(payload, branchId, mode, request, chunks, progress, eligibleOwners) {
  if (!payload.collections || typeof payload.collections !== 'object' || Array.isArray(payload.collections)) throw new Error('This backup has no collection map.');
  const { format, formatVersion, createdAt, workspaceId, edition } = payload;
  const manifest = { format, formatVersion, createdAt, workspaceId, edition };
  if (payload.scope) manifest.scope = payload.scope;
  const whole = branchId === organisation;
  if (whole && (payload.branchId || payload.scope === 'branch')) throw new Error('Choose a whole-organisation backup for this restore.');
  if (payload.branchId) manifest.branchId = payload.branchId;
  if (payload.branchId && payload.branchId !== branchId) throw new Error('This backup was created for a different branch.');
  const scope = { manifest, branchId, mode, ...(whole ? {scope:'organisation'} : {}) };
  const paths = Object.keys(payload.collections);
  const plan = await request('preview-branch-restore', { ...scope, paths });
  if (plan.branchId !== branchId || !plan.phrase || !Array.isArray(plan.paths)) throw new Error('The server returned an invalid branch preview.');
  const groups = [], batches = [];
  const totals = { create: 0, update: 0, remove: 0, unchanged: 0, conflict: 0, skipped: 0 };
  const labels = { create: 'Add', update: 'Update', remove: 'Remove', unchanged: 'Unchanged', conflict: 'Ownership conflict', keep:'Keep live record', protected:'Protected' };
  const byBranch = whole ? new Map() : null;
  if (whole) Object.assign(totals,{keep:0,protected:0});
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
        for (const { id, action, group } of part.details) {
          totals[action]++;
          if (whole) groupItem(byBranch, group, labels[action] + ' · ' + collectionPath + ' / ' + id);
          else items.push(labels[action] + ' · ' + id);
          if (eligibleOwners && ['create','update','unchanged'].includes(action)) eligibleOwners.add(collectionPath + '/' + id);
        }
        totals.skipped += part.skipped;
        if (part.hash) batches.push({ collectionPath, documents, remove, hash: part.hash });
      }
    }
    // Avoid transmitting explicitly foreign root records. Keep their IDs in
    // the comparison so an ambiguous ID can never become a removal.
    const candidates = whole ? rows : rows.filter(row => !(row.BranchId || row.branchId) || row.BranchId === branchId || row.branchId === branchId);
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
  if (whole) for (const path of paths.filter(path => !plan.paths.includes(path))) {
    groupItem(byBranch,'Excluded collections', path + ' · ' + payload.collections[path].length + ' records');
  }
  return { scope, name: plan.name, phrase: plan.phrase, totals, batches, groups, byBranch, excludedCollections: paths.length - plan.paths.length };
}

function groupItem(groups, group, item) {
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(item);
}

export async function prepareRestoreBatches(plan) {
  if (!plan.byBranch) return {hashes:plan.batches.map(batch => batch.hash)};
  // A linked sequence binds every batch to a single confirmation while keeping
  // the server's job document small for organisation archives with many files.
  let next = '';
  for (let i = plan.batches.length - 1; i >= 0; i--) {
    const batch = plan.batches[i];
    batch.nextHash = next;
    const bytes = new TextEncoder().encode(JSON.stringify([batch.hash,next]));
    next = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), n => n.toString(16).padStart(2,'0')).join('');
  }
  return {firstHash:next,batchCount:plan.batches.length};
}

export function restoreSummary(plan) {
  const t = plan.totals;
  if (plan.byBranch) return [plan.name, 'Add ' + t.create + ', update ' + t.update + ', already identical ' + t.unchanged +
    ', keep differing live records ' + t.keep + ', protected ' + t.protected + ', ownership conflicts ' + t.conflict + '.',
    'Excluded collections: ' + plan.excludedCollections + '.', plan.fileSummary].filter(Boolean).join(' · ');
  return `${plan.name} · ${plan.scope.mode === 'exact' ? 'Match the backup exactly' : 'Keep newer records'}. Add ${t.create}, update ${t.update}, remove ${t.remove}, unchanged ${t.unchanged}. Ownership conflicts skipped: ${t.conflict}. Other excluded rows in eligible collections: ${t.skipped}. Excluded collections: ${plan.excludedCollections}.${plan.fileSummary ? ' ' + plan.fileSummary : ''}`;
}

export async function previewRestoreFiles(plan, opened, eligibleOwners, request, read) {
  const { branchId, manifest } = plan.scope;
  const archive = opened.payload.documentArchive;
  if (!opened.offsets || !archive) return 'This backup contains database records only.';
  const root = 'v1/' + manifest.edition + '/' + manifest.workspaceId + '/';
  const whole = branchId === organisation;
  const inBranch = key => typeof key === 'string' && (key.startsWith(root) && (whole || key.slice(root.length).split('/')[1] === branchId) ||
    whole && manifest.edition === 'school' && key.startsWith('private-portal-cbt/' + manifest.workspaceId + '/'));
  function addFile(key, text) {
    if (whole) {
      const group = key.startsWith(root) ? key.slice(root.length).split('/')[1] : 'Organisation-wide';
      groupItem(plan.byBranch,group,'File · ' + text);
    } else items.push(text);
  }
  const keys = new Set([...archive.files.map(file => file.key), ...(archive.missing || [])]);
  const owners = new Map(), shared = new Set();
  function links(value, owner, eligible) {
    if (typeof value === 'string') {
      const key = value.replace(/^r2:\/\/dynamax-documents\//, '');
      if (keys.has(key)) {
        if (!eligible) shared.add(key);
        else if (!owners.has(key)) owners.set(key, owner);
      }
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) links(child, owner, eligible);
    }
  }
  if (!whole) for (const [path, rows] of Object.entries(opened.payload.collections)) {
    for (const row of rows) links(row, { path, id: row.__id }, eligibleOwners.has(path + '/' + row.__id));
  }
  const seen = new Map(), items = [], pending = [];
  let create = 0, unchanged = 0, blocked = 0, excluded = 0;
  async function compare() {
    if (!pending.length) return;
    const { details } = await request('preview-branch-restore-documents', { ...plan.scope, files: pending.map(item => item.file) });
    if (details.length !== pending.length) throw new Error('Incomplete file preview.');
    for (const [i, detail] of details.entries()) {
      const {file, number} = pending[i];
      if (detail.key !== file.key) throw new Error('File preview did not match the archive.');
      let label;
      if (detail.state === 'create' && detail.hash) {
        create++;
        plan.batches.push({file, number, hash: detail.hash});
        label = 'Restore';
      } else if (detail.state === 'unchanged') { unchanged++; label = 'Already present'; }
      else { blocked++; label = detail.state === 'conflict' ? 'Keep differing live file' : 'Unverified ownership'; }
      addFile(file.key,label + ' · ' + file.name + ' · ' + file.key);
    }
    pending.length = 0;
  }
  for (const [number, entry] of archive.files.entries()) {
    if (!inBranch(entry.key)) { excluded++; continue; }
    if (seen.has(entry.key)) {
      const earlier = seen.get(entry.key);
      if (earlier.version !== entry.version || earlier.etag !== entry.etag || earlier.size !== entry.size) throw new Error('Conflicting archive entries for ' + entry.key);
      continue;
    }
    seen.set(entry.key, entry);
    const owner = owners.get(entry.key);
    if (shared.has(entry.key) || branchId === 'main' && !owner) {
      blocked++; items.push('Unverified ownership · ' + entry.name + ' · ' + entry.key); continue;
    }
    const blob = await read(number);
    const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2,'0')).join('');
    const {key, size, version, etag, name, type} = entry;
    pending.push({number, file: {key, size, version, etag, name, type, sha256,
      ...(entry.uploadedAt !== undefined ? {uploadedAt:entry.uploadedAt} : {}),
      ...(entry.operationId !== undefined ? {operationId:entry.operationId} : {}), ...(owner ? {owner} : {})}});
    if (pending.length === 40) await compare();
  }
  await compare();
  for (const key of new Set(archive.missing || [])) {
    if (inBranch(key)) { blocked++; addFile(key,'Missing from backup · ' + key); }
  }
  if (items.length) plan.groups.push({ path: 'Uploaded documents', items });
  return 'Documents to restore: ' + create + '. Already present: ' + unchanged + '. Conflicts, unverified or missing: ' + blocked + '. Outside the selected scope: ' + excluded + '.';
}

export function mountBranchRestore({ request, staffFetch, decrypt, safetyBackup, chunks, status, dialogs, derive }) {
  const el = id => document.getElementById(id);
  const branch = el('restoreBranch'), mode = el('restoreMode'), file = el('restoreBackupFile'), password = el('restoreBackupPassword');
  const preview = el('previewBranchRestore'), apply = el('restoreDataBackup'), summary = el('branchRestoreSummary');
  let plan, busy = false;
  const browse = el('openBackupDocuments'), documentList = el('backupDocumentList');
  const include = el('restoreUploadedDocuments');
  let revision = 0;
  if (browse) browse.addEventListener('click', async () => {
    const selected = file.files[0], secret = password.value, current = ++revision;
    documentList.replaceChildren();
    if (!selected || !secret) return status('Choose an encrypted backup and enter its password.', 'bad');
    browse.disabled = true;
    try {
      const {readBackupFile,extractDocument,saveArchiveBlob} = await import('./document-backup.js?v=1');
      const opened = await readBackupFile(selected,secret,decrypt);
      if (current !== revision || !browse.isConnected) return;
      const files = opened.payload.documentArchive?.files || [];
      const missing = opened.offsets && opened.payload.documentArchive.missing;
      if (missing?.length) {
        const details = document.createElement('details'), label = document.createElement('summary'), entries = document.createElement('pre');
        label.textContent = missing.length+' referenced files were missing when this backup was made';
        entries.textContent = missing.join('\n'); details.append(label,entries); documentList.append(details);
      }
      if (!files.length || !opened.offsets) { documentList.append('This backup contains no embedded documents.'); return; }
      const select = document.createElement('select'), button = document.createElement('button');
      select.setAttribute('aria-label','Document in backup');
      files.forEach((entry,i)=>select.add(new Option(entry.name+' · '+entry.key,String(i))));
      button.type = 'button'; button.textContent = 'Download selected document';
      button.addEventListener('click',async ()=>{
        button.disabled = true;
        try {
          const i = Number(select.value), blob = await extractDocument(selected,opened,i,secret,derive);
          if (current === revision && button.isConnected) saveArchiveBlob(blob,files[i].name.replace(/[\\/:*?"<>|]/g,'_'));
        } catch { status('Could not verify or decrypt the selected document.', 'bad'); }
        finally { button.disabled = false; }
      });
      documentList.append(select,button);
    } catch (error) { if (current===revision) status(error.message,'bad'); }
    finally { browse.disabled = false; }
  });
  function controls() {
    for (const input of [branch, mode, file, password]) input.disabled = busy;
    if (include) include.disabled = busy;
    preview.disabled = busy || !branch.value || !file.files.length;
    apply.disabled = busy || !plan?.batches.length;
  }
  function invalidate() { revision++; documentList?.replaceChildren(); plan = null; summary.replaceChildren(); controls(); }
  const modeHint = el('restoreModeHint');
  const branchHint = modeHint?.textContent;
  function showScope() {
    const whole = branch.value === organisation;
    const options = whole ? [['missing','Add missing records only'],['merge','Restore changed and missing records']] :
      [['merge','Keep newer records'],['exact','Match the backup exactly']];
    mode.replaceChildren(...options.map(([value,label]) => new Option(label,value)));
    if (modeHint) modeHint.textContent = whole ? 'Review all branches and shared records together. Existing files and live-only records are kept in both modes.' : branchHint;
    preview.textContent = whole ? 'Preview organisation restore' : 'Preview branch restore';
    invalidate();
  }
  branch.addEventListener('change',showScope);
  for (const input of [branch, mode, file, password]) input.addEventListener('input', invalidate);
  include?.addEventListener('change', invalidate);
  invalidate();
  preview.addEventListener('click', async () => {
    invalidate();
    busy = true; controls();
    try {
      const backup = file.files[0];
      const {readBackupFile, extractDocument} = await import('./document-backup.js?v=1');
      const opened = await readBackupFile(backup,password.value,decrypt);
      const {payload} = opened;
      const eligibleOwners = include?.checked ? new Set() : null;
      plan = await previewBranchBackup(payload, branch.value, mode.value, request, chunks, path => status('Comparing ' + path + '…'), eligibleOwners);
      if (eligibleOwners) {
        status('Comparing archived documents with branch storage…');
        const key = opened.offsets && await derive(password.value, Uint8Array.from(payload.documentArchive.salt));
        plan.readFile = number => extractDocument(backup, opened, number, '', () => key);
        plan.fileSummary = await previewRestoreFiles(plan, opened, eligibleOwners, request, plan.readFile);
      }
      if (plan.byBranch) plan.groups = [...plan.byBranch].sort(([a],[b]) => a.localeCompare(b)).map(([path,items]) => ({path,items}));
      const headline = document.createElement('p');
      headline.textContent = restoreSummary(plan);
      if (!eligibleOwners && payload.documentArchive) headline.textContent += ' This restore applies database records. Use Browse documents in backup to download individual files.';
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
    let completedBatches = 0;
    try {
      const confirmation = await dialogs.prompt({ title: 'Restore ' + plan.name, message: restoreSummary(plan) + ' Type ' + plan.phrase + ' to apply these changes.',
        label: 'Exact confirmation', placeholder: plan.phrase, required: true, tone: 'danger', confirmText: 'Download safety backup and restore' });
      if (confirmation !== plan.phrase || !apply.isConnected) return;
      status('Creating the encrypted safety backup…');
      await safetyBackup(password.value);
      if (!apply.isConnected) return;
      const { jobId } = await request('prepare-branch-restore', { ...plan.scope, ...await prepareRestoreBatches(plan), confirmation, safetyBackupCreated: true });
      for (const [index, batch] of plan.batches.entries()) {
        if (!apply.isConnected) throw new Error('The restore screen changed.');
        if (batch.file) {
          status('Restoring ' + batch.file.name + '…');
          const {branchId, mode} = plan.scope;
          const metadata = {branchId, mode, jobId, index, file: batch.file, hash: batch.hash};
          if (plan.byBranch) Object.assign(metadata,{scope:'organisation',nextHash:batch.nextHash});
          const response = await staffFetch('/api/data-backup', {method:'POST', credentials:'same-origin', cache:'no-store',
            headers:{'Content-Type':'application/octet-stream', 'X-Restore-Document':encodeURIComponent(JSON.stringify(metadata))},
            body:await plan.readFile(batch.number)});
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.message || 'Document restore failed.');
          completedBatches++;
          continue;
        }
        status('Restoring ' + batch.collectionPath + ' (' + (index + 1) + ' of ' + plan.batches.length + ')…');
        await request('apply-branch-restore', { ...plan.scope, ...batch, jobId, index });
        completedBatches++;
      }
      status((plan.byBranch ? 'Organisation' : 'Branch') + ' restore completed. ' + restoreSummary(plan), 'good');
      invalidate();
    } catch (error) {
      invalidate();
      const progress = completedBatches ? ' Confirmed batches completed: ' + completedBatches + '.' : '';
      status(error.message + progress + ' Run a fresh preview before retrying.', 'bad');
    }
    finally { busy = false; controls(); }
  });
}
