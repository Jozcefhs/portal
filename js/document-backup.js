// Layout: magic, 32-bit encrypted JSON header length, header, then independently
// authenticated 1 MiB file chunks. The existing database envelope protects the index.
const magic = new TextEncoder().encode('DYNAMAX-DOCS-1\n');
const chunkSize = 1024 * 1024;
const headerLimit = 250 * 1024 * 1024;
const chunks = size => Math.max(1, Math.ceil(size / chunkSize));
const storedLength = size => size + 16 * chunks(size);
const iv = (file, part) => {
  const bytes = new Uint8Array(12), view = new DataView(bytes.buffer);
  view.setUint32(4,file); view.setUint32(8,part);
  return bytes;
};
const bytesOf = buffer => new Uint8Array(buffer);
const invalid = () => new Error('The document archive is incomplete or invalid.');

export async function collectDocumentIndex(payload, request, progress) {
  const {workspaceId,edition,branchId} = payload;
  const scope = {workspaceId,edition,scope:branchId ? 'branch':'organisation', ...(branchId ? {branchId}:{})};
  const listed = new Map(), owners = new Map(), seenPages = new Set();
  let page = {index:0}, skipped = 0;
  do {
    const token = JSON.stringify(page);
    if (seenPages.has(token)) throw invalid();
    seenPages.add(token);
    const result = await request('list-backup-documents',{...scope,...page});
    if (!Array.isArray(result.files)) throw invalid();
    for (const file of result.files) {
      if (listed.has(file.key) && listed.get(file.key).version !== file.version) throw new Error('A document changed during backup.');
      listed.set(file.key,file);
    }
    skipped += result.skipped;
    page = result.next;
  } while (page);
  const prefix = 'v1/' + edition + '/' + workspaceId + '/';
  const papers = 'private-portal-cbt/' + workspaceId + '/';
  const excluded = new Set();
  function inspect(value, owner) {
    if (value && typeof value === 'object') {
      for (const v of Object.values(value)) inspect(v,owner);
    } else if (typeof value === 'string') {
      const reference = 'r2://dynamax-documents/';
      const key = value.startsWith(reference) ? value.slice(reference.length) : value;
      if (!(key.startsWith(prefix) || edition === 'school' && key.startsWith(papers))) return;
      if (branchId && key.startsWith(prefix) && key.slice(prefix.length).split('/')[1] !== branchId) { excluded.add(key); return; }
      if (!owners.has(key)) owners.set(key,owner);
    }
  }
  for (const [path,rows] of Object.entries(payload.collections)) {
    for (const row of rows) inspect(row,{path,id:row.__id});
  }
  const missing = [];
  for (const [key,owner] of owners) {
    if (listed.has(key)) continue;
    const result = await request('inspect-backup-document',{...scope,key,...(branchId ? {owner}:{})});
    if (result.missing) { missing.push(key); continue; }
    if (result.excluded) { excluded.add(key); continue; }
    if (result.file?.key !== key) throw invalid();
    listed.set(key,result.file);
  }
  const files = [...listed.values()];
  if (files.some(f=>!f.version || !f.etag || !Number.isSafeInteger(f.size) || f.size<0 || chunks(f.size)>0xffffffff)) throw invalid();
  progress(files.length);
  return {scope,files,owners,missing,skipped:skipped+excluded.size};
}

export function saveArchiveBlob(blob,name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export async function writeDocumentArchive({payload,password,index,encrypt,derive,read,progress,handle,filename}) {
  const {files,scope,owners,missing,skipped} = index;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await derive(password,salt);
  const header = await encrypt({...payload, documentArchive:{version:1,salt:Array.from(salt),files,missing,skipped}},password);
  const data = new TextEncoder().encode(JSON.stringify(header));
  if (data.length > headerLimit) throw new Error('The encrypted database exceeds the 250 MB browser limit. Choose a smaller branch.');
  const length = new DataView(new ArrayBuffer(4));
  length.setUint32(0,data.length);
  const sink = handle ? await handle.createWritable() : null;
  const blobs = [];
  async function write(part) {
    if (sink) await sink.write(part);
    else blobs.push(new Blob([part]));
  }
  try {
    await write(magic); await write(length.buffer); await write(data);
    for (const [number,file] of files.entries()) {
      progress(number+1,files.length);
      const owner = owners.get(file.key);
      const source = await read({...scope,key:file.key,etag:file.etag,version:file.version,...(scope.branchId && owner ? {owner}:{})});
      if (source.size !== file.size) throw invalid();
      for (let part=0; part<chunks(file.size); part++) {
        const plain = await source.slice(part*chunkSize,(part+1)*chunkSize).arrayBuffer();
        await write(await crypto.subtle.encrypt({name:'AES-GCM',iv:iv(number,part)},key,plain));
      }
    }
    if (sink) await sink.close();
    else saveArchiveBlob(new Blob(blobs,{type:'application/octet-stream'}),filename);
  } catch (error) {
    if (sink) await sink.abort().catch(()=>{});
    throw error;
  }
}

export async function readBackupFile(file,password,decrypt) {
  const prefix = bytesOf(await file.slice(0,magic.length+4).arrayBuffer());
  if (!magic.every((byte,i)=>byte===prefix[i])) {
    if (file.size>headerLimit) throw new Error('The database backup exceeds the 250 MB browser limit.');
    return {payload:await decrypt(JSON.parse(await file.text()),password)};
  }
  if (prefix.length!==magic.length+4) throw invalid();
  const length = new DataView(prefix.buffer).getUint32(magic.length);
  const offset=prefix.length+length;
  if (!length || length>headerLimit || offset>file.size) throw invalid();
  const envelope=JSON.parse(await file.slice(prefix.length,offset).text());
  if (envelope.format!=='dynamax-encrypted-backup') throw invalid();
  const payload=await decrypt(envelope,password), archive=payload.documentArchive;
  if (archive?.version!==1 || !Array.isArray(archive.files) || !Array.isArray(archive.salt) || archive.salt.length!==16) throw invalid();
  let end=offset;
  const offsets=archive.files.map(f=>{
    if (!Number.isSafeInteger(f.size) || f.size<0 || typeof f.name!=='string') throw invalid();
    const start=end; end+=storedLength(f.size); return start;
  });
  if (!Number.isSafeInteger(end) || end!==file.size) throw invalid();
  return {payload,offsets};
}

export async function extractDocument(file,opened,number,password,derive) {
  const archive=opened.payload.documentArchive, entry=archive.files[number];
  const key=await derive(password,Uint8Array.from(archive.salt));
  const pieces=[];
  let offset=opened.offsets[number];
  for (let part=0;part<chunks(entry.size);part++) {
    const length=Math.min(chunkSize,entry.size-part*chunkSize)+16;
    const cipher=await file.slice(offset,offset+length).arrayBuffer();
    pieces.push(new Blob([await crypto.subtle.decrypt({name:'AES-GCM',iv:iv(number,part)},key,cipher)]));
    offset+=length;
  }
  return new Blob(pieces,{type:'application/octet-stream'});
}
