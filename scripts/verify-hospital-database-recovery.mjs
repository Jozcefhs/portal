// Use a local Firestore emulator for the source. --live writes only to the
// empty, named recovery database in the isolated Hospital Owner's Demo.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { env as fixtureEnv } from '../tests/helpers/hospital-fixture.mjs';
import { billingFixture } from '../tests/helpers/hospital-billing-fixture.mjs';
import { completeVisit, encryptedRoundTrip } from '../tests/helpers/hospital-journey-fixture.mjs';
import { batchCommitLiteralDocuments, getDocument, getDocuments, listRootCollectionIds } from '../functions/lib/firestore.js';
import { exportOrganizationBackupPage, sanitizeBackupDocument } from '../functions/lib/organization-backup.js';
import { branchRestoreRequest } from '../functions/lib/branch-restore.js';
import { previewBranchBackup, prepareRestoreBatches } from '../js/branch-restore.js';

const args = process.argv.slice(2);
assert.ok(!args.length || (args.length === 1 && args[0] === '--live'), 'Use --live or no arguments.');
const live = args.length === 1;
const emulator = process.env.FIRESTORE_EMULATOR_HOST || '';
assert.match(emulator, /^127\.0\.0\.1:\d+$/, 'Set FIRESTORE_EMULATOR_HOST to the local emulator on 127.0.0.1.');
const run = randomUUID().slice(0,8);
const project = 'demo-recovery-' + run;
const database = 'hospital-recovery-drill';
const fakeIdentity = 'synthetic@' + project + '.invalid';
const { privateKey } = generateKeyPairSync('rsa',{modulusLength:2048});
const source = { ...fixtureEnv, FIREBASE_PROJECT_ID:project, FIREBASE_CLIENT_EMAIL:fakeIdentity,
  FIREBASE_PRIVATE_KEY:privateKey.export({type:'pkcs8',format:'pem'}) };
const destination = { ...source, FIRESTORE_DATABASE_ID:database };
if (live) {
  const credentials = JSON.parse(await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));
  assert.equal(credentials.project_id,'dynamax-hospital-review','Expected the Hospital Owner’s Demo service account.');
  Object.assign(destination,{FIREBASE_PROJECT_ID:credentials.project_id,FIREBASE_CLIENT_EMAIL:credentials.client_email,
    FIREBASE_PRIVATE_KEY:credentials.private_key});
}

// Run the deployed REST adapter unmodified. Local synthetic authorisation
// stays inside this process. All local reads/writes are constrained to this run.
const network = globalThis.fetch;
const localPrefix = '/v1/projects/' + project + '/databases/';
const livePrefix = '/v1/projects/dynamax-hospital-review/databases/' + database + '/';
globalThis.fetch = async (input,options={}) => {
  const url = new URL(input);
  if (url.href === 'https://oauth2.googleapis.com/token') {
    const claim = JSON.parse(Buffer.from(options.body.get('assertion').split('.')[1],'base64url'));
    if (claim.iss === fakeIdentity) return Response.json({access_token:'owner',expires_in:3600});
    assert.ok(live && claim.iss === destination.FIREBASE_CLIENT_EMAIL);
  } else {
    assert.equal(url.origin,'https://firestore.googleapis.com');
    if (url.pathname.startsWith(localPrefix)) {
      assert.equal(new Headers(options.headers).get('Authorization'),'Bearer owner');
      // Emulator 1.21 rejects REST GET readTime with "Only timestamps past
      // epoch are supported". The seeded source is immutable during export.
      // The live portal regression separately exercises snapshot reads.
      if (!options.method || options.method === 'GET') url.searchParams.delete('readTime');
      return network('http://' + emulator + url.pathname + url.search,{...options,redirect:'error'});
    }
    assert.ok(live && url.pathname.startsWith(livePrefix),'Unexpected recovery destination.');
  }
  return network(input,{...options,redirect:'error'});
};

const original = await billingFixture();
await completeVisit(original);
const writes = [...original.store].map(([path,row]) => ({
  collectionPath:path.slice(0,path.lastIndexOf('/')), documentId:row.__id, exists:false, restoreJsonTypes:true,
  data:Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('__')))
}));
await batchCommitLiteralDocuments(source,writes);
// The exporter takes its snapshot two seconds before the first request.
await delay(2100);
let cursor = 0, pageToken = '', createdAt;
const collections = {};
for (;;) {
  const page = await exportOrganizationBackupPage(source,{cursor,pageToken});
  createdAt ??= page.exportedAt;
  assert.equal(page.exportedAt,createdAt);
  for (const [path,rows] of Object.entries(page.collections)) (collections[path] ??= []).push(...rows);
  if (page.backup.complete) break;
  ({nextCursor:cursor,nextPageToken:pageToken} = page.backup);
}
const paths = Object.entries(collections).filter(([,rows])=>rows.length);
const exported = paths.reduce((total,[,rows])=>total+rows.length,0);
assert.equal(exported,original.store.size);
for (const [path,rows] of paths) for (const row of rows) {
  assert.ok(original.store.has(path+'/'+row.__id),'Unexpected document in the synthetic export');
}
const backup = await encryptedRoundTrip({format:'dynamax-organization-backup',formatVersion:3,createdAt,
  edition:'hospital',workspaceId:source.DYNAMAX_WORKSPACE_ID,collections});
const owner = { username:'drill-admin', role:'Super Admin', branchAccess:'all', branchId:'all' };
const call = (action,body)=>branchRestoreRequest(destination,owner,action,body);
const chunks = rows=>Array.from({length:Math.ceil(rows.length/50)},(_,i)=>rows.slice(i*50,(i+1)*50));
const preview = ()=>previewBranchBackup(backup,'@organisation','missing',call,chunks,()=>{});
assert.deepEqual(await listRootCollectionIds(destination),[],'Recovery destination must be empty. Nothing was restored.');
const plan = await preview();
assert.equal(plan.totals.create,exported);
assert.deepEqual(await listRootCollectionIds(destination),[],'Preview must not create any documents.');
const {jobId} = await call('prepare-branch-restore',{...plan.scope,...await prepareRestoreBatches(plan),
  confirmation:plan.phrase,safetyBackupCreated:true});
for (const [index,batch] of plan.batches.entries()) {
  const body = {...plan.scope,...batch,index,jobId};
  const applied = await call('apply-branch-restore',body);
  const job = await getDocument(destination,'systemRestoreJobs',jobId);
  assert.deepEqual(await call('apply-branch-restore',body),applied);
  assert.equal((await getDocument(destination,'systemRestoreJobs',jobId)).__updateTime,job.__updateTime);
}
const repeated = await preview();
assert.equal(repeated.batches.length,0);
assert.equal(repeated.totals.unchanged,exported);
for (const [path,rows] of paths) {
  const ids = rows.map(row=>row.__id);
  for (const db of [source,destination]) {
    const stored = await getDocuments(db,path,ids);
    assert.deepEqual(stored.map(row=>sanitizeBackupDocument(path,row)),rows,path);
  }
}
console.log(`Recovered ${exported} records in ${paths.length} populated collections. ${plan.batches.length} batches replayed without advancing the restore job. Second preview: ${repeated.totals.unchanged} unchanged. Destination: ${live ? 'Hospital Owner Demo / ' + database : 'local Firestore emulator / ' + database}.`);
