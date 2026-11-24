// Run locally with Node and Wrangler. --live uses the Hospital Owner's Demo R2 bucket.
// The workspace and file key are newly generated for each run. No Firestore binding is used.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { putStoredDocument } from '../functions/lib/document-storage.js';
import { backupDocuments } from '../functions/lib/backup-documents.js';
import { branchRestoreRequest } from '../functions/lib/branch-restore.js';
import { collectDocumentIndex, extractDocument, readBackupFile, writeDocumentArchive } from '../js/document-backup.js';
import { prepareRestoreBatches, previewBranchBackup, previewRestoreFiles } from '../js/branch-restore.js';

const require = createRequire(import.meta.url);
const wrangler = require.resolve(process.env.WRANGLER_MODULE || 'wrangler');
const { getPlatformProxy } = require(wrangler);
// Miniflare's Node RPC serializer recognises its own Headers implementation.
globalThis.Headers = createRequire(wrangler)('miniflare').Headers;
const live = process.argv.includes('--live');
assert.ok(process.argv.slice(2).every(arg => arg === '--live'));
const configDir = await mkdtemp(join(tmpdir(), 'hospital-file-drill-'));
const configPath = join(configDir, 'wrangler.json');
const workspaceId = 'recovery-drill-' + crypto.randomUUID();
const branch = 'west';
const expectedKey = 'v1/hospital/' + workspaceId + '/finance/west/all/synthetic-visit/attachment/test.txt';
const user = { username:'drill-admin', role:'Super Admin', branchAccess:'all', branchId:'all' };
const encoding = { window:{ crypto }, btoa, atob, TextEncoder, TextDecoder, clean:value => String(value ?? '').trim() };
const admin = await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
runInNewContext(admin.slice(admin.indexOf('function base64FromBytes('),admin.indexOf('function downloadBackupFile(')),encoding);
const password = crypto.randomUUID();
const bytes = new TextEncoder().encode('Synthetic attachment for encrypted hospital recovery.\n'.repeat(22000));
let platform, bucket, created = false;
try {
  await writeFile(configPath, JSON.stringify({ name:'hospital-file-recovery-drill', compatibility_date:'2025-09-01',
    r2_buckets:[{ binding:'DYNAMAX_DOCUMENTS', bucket_name:'dynamax-hospital-review-documents', remote:live }] }));
  platform = await getPlatformProxy({ configPath, envFiles:[], persist:false, remoteBindings:live });
  bucket = platform.env.DYNAMAX_DOCUMENTS;
  const env = { DYNAMAX_DOCUMENTS:bucket, DYNAMAX_WORKSPACE_ID:workspaceId, ORGANISATION_EDITION:'hospital' };
  const path = 'hospitalWorkspaces/' + workspaceId + '/hospitalVisits';
  // The clinical record and restore journal stay in this process. Only the attachment goes to R2.
  const rows = new Map();
  let commits = 0;
  const db = {
    getDocument: async (_,p,id) => rows.get(p+'/'+id),
    getDocuments: async (_,p,ids) => ids.map(id => rows.get(p+'/'+id)),
    async commit(_,writes) {
      for (const write of writes) {
        const key = write.collectionPath + '/' + write.documentId, before = rows.get(key);
        if (write.exists === false) assert.equal(before,undefined);
        if (write.updateTime) assert.equal(write.updateTime,before.__updateTime);
        rows.set(key,{ ...before,...write.data,__id:write.documentId,__updateTime:String(++commits) });
      }
    }
  };
  assert.equal(await bucket.head(expectedKey),null);
  const original = await putStoredDocument(env,{ category:'finance',branchId:branch,ownerId:'synthetic-visit',
    documentType:'attachment',operationId:'test',fileName:'test.txt',mimeType:'text/plain',bytes });
  assert.equal(original.key,expectedKey);
  created = true;
  const record = { __id:'synthetic-visit',BranchId:branch,Document:original.reference };
  rows.set(path+'/'+record.__id,{ ...record,__updateTime:'initial' });
  const payload = { format:'dynamax-organization-backup',formatVersion:3,createdAt:new Date().toISOString(),
    workspaceId,edition:'hospital',collections:{[path]:[record]} };
  const backup = (action,body) => backupDocuments(env,user,action,body,db);
  const restore = (action,body) => branchRestoreRequest(env,user,action,body,db);
  const noop = () => {};
  const index = await collectDocumentIndex(payload,backup,noop);
  assert.deepEqual(index.files.map(file => file.key),[expectedKey]);
  const parts = [];
  await writeDocumentArchive({payload,index,password,encrypt:encoding.encryptOrganizationBackup,derive:encoding.deriveBackupEncryptionKey,
    read:async body => (await backup('read-backup-document',body)).blob(),progress:noop,
    handle:{createWritable:async () => ({write:part=>parts.push(part),close:noop,abort:noop})} });
  const archive = new Blob(parts);
  await assert.rejects(readBackupFile(archive,'incorrect',encoding.decryptOrganizationBackup));
  const opened = await readBackupFile(archive,password,encoding.decryptOrganizationBackup);
  const extract = i => extractDocument(archive,opened,i,password,encoding.deriveBackupEncryptionKey);
  assert.deepEqual(new Uint8Array(await (await extract(0)).arrayBuffer()),bytes);
  async function preview() {
    const plan = await previewBranchBackup(opened.payload,'@organisation','missing',restore,records=>[records],noop);
    await previewRestoreFiles(plan,opened,new Set(),restore,extract);
    return plan;
  }
  assert.equal((await preview()).batches.length,0);
  await bucket.delete(expectedKey);
  const plan = await preview();
  assert.equal(plan.batches.length,1);
  const batch = plan.batches[0];
  assert.equal(batch.file.key,expectedKey);
  assert.equal(commits,0);
  const sequence = await prepareRestoreBatches(plan);
  const {jobId} = await restore('prepare-branch-restore',{...plan.scope,...sequence,confirmation:plan.phrase,safetyBackupCreated:true});
  const body = {...plan.scope,...batch,index:0,jobId,binary:await (await extract(0)).arrayBuffer(),byteLength:bytes.length};
  assert.ok((await restore('apply-branch-restore-document',body)).complete);
  const recovered = await bucket.get(expectedKey);
  assert.deepEqual(new Uint8Array(await recovered.arrayBuffer()),bytes);
  assert.equal(recovered.customMetadata.uploadedAt,original.uploadedAt);
  assert.equal(recovered.customMetadata.operationId,'test');
  const beforeRetry = commits;
  assert.ok((await restore('apply-branch-restore-document',body)).complete);
  assert.equal(commits,beforeRetry);
  assert.equal((await bucket.head(expectedKey)).version,recovered.version);
  assert.equal((await preview()).batches.length,0);
  assert.equal(rows.get(path+'/'+record.__id).Document,original.reference);
  console.log('Verified encrypted multi-chunk recovery, original reference, identical bytes, and duplicate-free replay.');
} finally {
  try {
    if (created) {
      await bucket.delete(expectedKey);
      assert.equal(await bucket.head(expectedKey),null);
      console.log('Removed the synthetic attachment from ' + (live ? 'remote' : 'local') + ' R2.');
    }
  } finally {
    if (platform) await platform.dispose();
    await rm(configDir,{recursive:true,force:true});
  }
}
