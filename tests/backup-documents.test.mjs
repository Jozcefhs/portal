import test from 'node:test';
import assert from 'node:assert/strict';
import {backupDocuments} from '../functions/lib/backup-documents.js';
import {collectDocumentIndex,writeDocumentArchive,readBackupFile,extractDocument} from '../js/document-backup.js';
import {requiredDeploymentIdentity} from '../functions/lib/deployment-identity.js';

function setup(edition,branchId) {
  const env={DYNAMAX_WORKSPACE_ID:'demo',ORGANISATION_EDITION:edition};
  const objects=new Map(), reads=[];
  const root='v1/'+edition+'/demo/';
  function add(branch,name,bytes,extra={}) {
    const key=root+'finance/'+branch+'/all/owner/file/'+name;
    objects.set(key,{key,customMetadata:{workspaceId:'demo',edition,branchId:branch,fileName:name,...extra},size:bytes.length,
      version:'v1',etag:'test-tag',body:bytes}); return key;
  }
  const bytes=Uint8Array.from({length:1024*1024+11},(_,i)=>i%251);
  const key=add(branchId || 'west','proof.pdf',bytes);
  const other=add('east','east.pdf',new Uint8Array([8]));
  const empty=add(branchId || 'west','empty.pdf',new Uint8Array());
  const invalid=add(branchId || 'west','conflict.pdf',bytes,{workspaceId:'foreign'});
  const row={__id:'paid',BranchId:branchId||'west',files:['r2://dynamax-documents/'+key,'r2://dynamax-documents/'+key]};
  const database={getDocument:async()=>({Branches:['main','west','east']}),getDocuments:async(_,path,ids)=>ids.map(id=>path==='payments' && id==='paid'?row:null)};
  env.DYNAMAX_DOCUMENTS={
    list:async({prefix})=>({objects:[...objects.values()].filter(o=>o.key.startsWith(prefix)),truncated:false}),
    head:async k=>objects.get(k),
    get:async(k,options)=>{reads.push(k); const o=objects.get(k); return o?.etag===options.onlyIf.etagMatches?o:null;}
  };
  const call=(action,body)=>backupDocuments(env,{branchId:'all'},action,body,database);
  const payload={format:'dynamax-organization-backup',formatVersion:3,createdAt:new Date().toISOString(),workspaceId:'demo',edition,
    ...(branchId?{branchId}:{}),collections:{payments:[row]}};
  return {call,payload,bytes,key,other,empty,invalid,reads,objects};
}

for (const edition of ['school','faith','organization','hospital']) {
  let supported=true;
  try {requiredDeploymentIdentity({DYNAMAX_WORKSPACE_ID:'demo',ORGANISATION_EDITION:edition});} catch {supported=false;}
  for (const branch of ['west','main','']) test(edition+' document backup '+(branch||'whole organisation'),{skip:!supported},async()=>{
    const f=setup(edition,branch), index=await collectDocumentIndex(f.payload,f.call,()=>{});
    assert.ok(index.files.some(o=>o.key===f.key));
    assert.equal(index.files.some(o=>o.key===f.other),!branch);
    assert.equal(index.files.some(o=>o.key===f.empty),branch!=='main');
    assert.ok(!index.files.some(o=>o.key===f.invalid));
    assert.equal(index.files.filter(o=>o.key===f.key).length,1);
    const body={...index.scope,key:f.key,etag:'test-tag',version:'v1',owner:{path:'payments',id:'paid'}};
    const response=await f.call('read-backup-document',body);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);
    if(branch) await assert.rejects(f.call('read-backup-document',{...body,key:f.other}),/outside/);
    if(branch==='main') await assert.rejects(f.call('read-backup-document',{...body,key:f.empty}),/no longer linked/);
    await assert.rejects(f.call('read-backup-document',{...body,version:'stale'}),/changed/);
  });
}

test('school paper files and missing links are resolved within the branch and workspace',async()=>{
  const f=setup('school','main'), paper='private-portal-cbt/demo/test/source.pdf';
  const missing='v1/school/demo/finance/main/all/owner/file/removed.pdf';
  f.objects.set(paper,{key:paper,size:3,version:'one',etag:'paper-tag',body:Uint8Array.of(1,2,3)});
  f.payload.collections.payments[0].files.push(paper,'r2://dynamax-documents/'+missing);
  const index=await collectDocumentIndex(f.payload,f.call,()=>{});
  assert.deepEqual(index.missing,[missing]);
  assert.ok(index.files.some(row=>row.key===paper));
  await assert.rejects(f.call('read-backup-document',{...index.scope,key:paper,etag:'paper-tag',version:'one'}),/verified branch/);
  await assert.rejects(f.call('read-backup-document',{...index.scope,key:'private-portal-cbt/other/test/source.pdf'}),/outside/);
});

test('encrypted archive round trip, tamper detection and interrupted download',async()=>{
  const f=setup('school','west'), index=await collectDocumentIndex(f.payload,f.call,()=>{});
  async function derive(password,salt) {
    const raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:1000},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  const encrypt=async(payload,password)=>{
    const salt=crypto.getRandomValues(new Uint8Array(16)), iv=crypto.getRandomValues(new Uint8Array(12));
    const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await derive(password,salt),new TextEncoder().encode(JSON.stringify(payload)));
    return {format:'dynamax-encrypted-backup',salt:[...salt],iv:[...iv],ciphertext:Buffer.from(data).toString('base64')};
  };
  const decrypt=async(h,p)=>JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(h.iv)},await derive(p,Uint8Array.from(h.salt)),Buffer.from(h.ciphertext,'base64'))));
  const parts=[]; let closed=0,aborted=0;
  const handle={createWritable:async()=>({write:async p=>parts.push(p),close:async()=>closed++,abort:async()=>aborted++})};
  const options={payload:f.payload,password:'demo passphrase',index,derive,encrypt,handle,progress:()=>{},
    read:async b=>(await f.call('read-backup-document',b)).blob()};
  await writeDocumentArchive(options);
  const file=new Blob(parts), opened=await readBackupFile(file,options.password,decrypt);
  assert.equal(closed,1); assert.equal(aborted,0);
  assert.deepEqual(opened.payload.collections,f.payload.collections);
  assert.ok(!Buffer.from(await file.arrayBuffer()).includes(Buffer.from('proof.pdf')));
  await assert.rejects(readBackupFile(file,'incorrect',decrypt));
  for (const [i,entry] of index.files.entries()) {
    const doc=await extractDocument(file,opened,i,options.password,derive);
    assert.deepEqual(new Uint8Array(await doc.arrayBuffer()),f.objects.get(entry.key).body);
  }
  const corrupt=new Uint8Array(await file.arrayBuffer()); corrupt[opened.offsets[0]]^=1;
  await assert.rejects(extractDocument(new Blob([corrupt]),opened,0,options.password,derive));
  await assert.rejects(readBackupFile(file.slice(0,-1),options.password,decrypt));
  await assert.rejects(writeDocumentArchive({...options,read:async()=>{throw Error('changed');}}),/changed/);
  assert.equal(aborted,1); assert.equal(closed,1);
});
