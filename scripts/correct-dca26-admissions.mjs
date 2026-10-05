import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// One-off operational repair. It cannot target another school or admission year.
export const PROJECT = 'school-management-suite-27064';
const DB = `projects/${PROJECT}/databases/(default)`;
const BASE = `${DB}/documents`;
const API = 'https://firestore.googleapis.com/v1/';
export const correctedAdmission = value => /^DCA\/26\/0\d{3}$/.test(String(value))
  ? String(value).replace('DCA/26/0', 'DCA/26/') : null;
const str = value => value?.stringValue || '';
const collection = doc => doc.name.split('/').at(-2);
const hash = value => createHash('sha256').update(value).digest('hex');
const safeId = value => value.replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_');
const PLAN_DIR = '.dca26-admission-repair';
const PLAN_FILE = `${PLAN_DIR}/preview.json`;
const protectedCollection = id => /audit|backup|restore|delivery|deliveries|notification|staff|rateLimit|idempotency|passkey|mfa|session|challenge/i.test(id)
  || ['settings', 'schoolBranches', 'organisationBranches', 'parentCredentials', 'desktopDevices', 'desktopPairingRequests'].includes(id);
const identityField = key => /^(?:AdmissionNo|AdmissionNumber|AccountRef|StudentRef|StudentId|StudentAdmissionNo|ApplicationReference|TargetAccountRef|SourceAccountRef|LinkedReferences|StudentRefs|StudentIds|ChildrenRefs|AdmissionNoNormalized|AccountRefNormalized)$/i.test(key);
export function rewrittenFields(fields, map) {
  const changes = [];
  const ignored = [];
  const compactMap = new Map([...map].map(([old, value]) => [old.toLowerCase().replace(/[^a-z0-9]/g, ''), value.toLowerCase().replace(/[^a-z0-9]/g, '')]));
  const lowerMap = new Map([...map].map(([old, value]) => [old.toLowerCase(), value]));
  function visit(value, key, path, enabled = false) {
    const allowed = enabled || identityField(key);
    if (value.stringValue !== undefined) {
      const old = value.stringValue;
      const corrected = /Normalized$/i.test(key) ? compactMap.get(old) : (map.get(old) || lowerMap.get(old.toLowerCase()));
      if (corrected && corrected !== old) {
        if (!allowed) { ignored.push(path); return value; }
        changes.push(path);
        return { stringValue: corrected };
      }
      return value;
    }
    if (value.arrayValue?.values) return { arrayValue: { ...value.arrayValue, values: value.arrayValue.values.map((item, index) => visit(item, key, `${path}[${index}]`, allowed)) } };
    if (value.mapValue?.fields) return { mapValue: { ...value.mapValue, fields: Object.fromEntries(Object.entries(value.mapValue.fields).map(([childKey, item]) => [childKey, visit(item, childKey, `${path}.${childKey}`, allowed)])) } };
    return value;
  }
  const after = Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, visit(value, key, key)]));
  const mask = Object.keys(fields || {}).filter(key => JSON.stringify(after[key]) !== JSON.stringify(fields[key]));
  return { after, mask, changes, ignored };
}
export function destinationName(doc, map) {
  const id = doc.name.split('/').at(-1);
  const type = collection(doc);
  let destinationId = id;
  if (type === 'students') {
    const old = str(doc.fields?.AdmissionNo || doc.fields?.admissionNo);
    const corrected = map.get(old);
    if (corrected) {
      if (id !== safeId(old)) throw new Error('Student document key is not canonical; manual review required.');
      destinationId = safeId(corrected);
    }
  } else if (type === 'accountSummaries' || type === 'accounts') {
    for (const [old, corrected] of map) {
      if (id === safeId(old)) destinationId = safeId(corrected);
    }
  } else if (type === 'studentLoginCredentials') {
    const old = str(doc.fields?.StudentRef);
    if (map.has(old)) {
      if (id !== `student-login-${hash(old.trim().toLowerCase())}`) throw new Error('Student credential key does not match its reference; stopped.');
      destinationId = `student-login-${hash(map.get(old).toLowerCase())}`;
    }
  }
  return doc.name.split('/').slice(0, -1).concat(destinationId).join('/');
}

export function admissionMap(students) {
  const seen = new Set();
  const map = new Map();
  for (const doc of students) {
    const admission = str(doc.fields?.AdmissionNo || doc.fields?.admissionNo);
    if (!admission) continue;
    if (seen.has(admission)) throw new Error('Duplicate admission number found; repair stopped.');
    seen.add(admission);
    const corrected = correctedAdmission(admission);
    if (corrected) map.set(admission, corrected);
  }
  for (const corrected of map.values()) {
    if (seen.has(corrected)) throw new Error('Corrected admission number already belongs to a student; repair stopped.');
  }
  return map;
}

let accessToken = '';
let tokenAt = 0;
function token() {
  if (!accessToken || Date.now() - tokenAt > 40 * 60_000) {
    accessToken = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    tokenAt = Date.now();
  }
  return accessToken;
}
async function request(path, method = 'GET', body) {
  const readOnly = method === 'GET' || /:(?:batchGet|runQuery|listCollectionIds)$/.test(path);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(API + path, {
        method, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`Firestore ${method} failed (${response.status}, ${data.error?.status || 'unknown'}). No secrets or document contents are logged.`);
      return data;
    } catch (error) {
      if (!readOnly || attempt >= 3 || error.message.startsWith('Firestore')) {
        throw new Error(`${error.message} (${error.cause?.code || error.name || 'network'}); document contents and credentials are not logged.`);
      }
      console.log(`Retrying read-only ${path.split(':').at(-1).split('?')[0].split('/').at(-1)} check (${attempt + 1}/3; ${error.cause?.code || error.name}).`);
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}
async function readDocuments(names) {
  const results = new Map();
  for (let index = 0; index < names.length; index += 200) {
    const rows = await request(BASE + ':batchGet', 'POST', { documents: names.slice(index, index + 200) });
    for (const row of rows) results.set(row.found?.name || row.missing, row.found || null);
  }
  return results;
}
async function collectionIds(parent = BASE) {
  const ids = [];
  let pageToken;
  do {
    const data = await request(parent + ':listCollectionIds', 'POST', { pageSize: 1000, ...(pageToken ? { pageToken } : {}) });
    ids.push(...(data.collectionIds || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return ids;
}
async function list(path, { missing = false } = {}) {
  const docs = [];
  let pageToken;
  do {
    const query = new URLSearchParams({ pageSize: '1000', ...(missing ? { showMissing: 'true' } : {}), ...(pageToken ? { pageToken } : {}) });
    const data = await request(`${BASE}/${path}?${query}`);
    docs.push(...(data.documents || []));
    pageToken = data.nextPageToken;
    if (docs.length > 150_000) throw new Error('Collection exceeds inspection safety limit.');
  } while (pageToken);
  return docs;
}
async function studentRows() {
  const rows = await request(BASE + ':runQuery', 'POST', { structuredQuery: { from: [{ collectionId: 'students', allDescendants: true }] } });
  return rows.filter(row => row.document).map(row => row.document);
}
async function collectionGroup(id) {
  const rows = await request(BASE + ':runQuery', 'POST', { structuredQuery: { from: [{ collectionId: id, allDescendants: true }] } });
  return rows.filter(row => row.document).map(row => row.document);
}
async function preview() {
  const students = await studentRows();
  const map = admissionMap(students);
  if (map.size !== 271) throw new Error('Affected count changed from the reviewed 271; stopped for review.');
  const rootIds = await collectionIds();
  const ids = new Set(rootIds.filter(id => !protectedCollection(id)));
  // Discover existing nested school collections, including missing branch/section containers.
  const branches = await list('schoolBranches', { missing: true });
  for (const branch of branches) {
    const branchIds = await collectionIds(branch.name);
    branchIds.filter(id => !protectedCollection(id) && id !== 'sections').forEach(id => ids.add(id));
    const sections = await list(branch.name.split('/documents/')[1] + '/sections', { missing: true });
    for (const section of sections) (await collectionIds(section.name)).filter(id => !protectedCollection(id)).forEach(id => ids.add(id));
  }
  ['students', 'applications', 'studentLoginCredentials', 'studentConductCases'].forEach(id => ids.add(id));
  // Face enrollment deletion is separately backed up and explicitly approved.
  // Never rewrite an encrypted template's authenticated student reference.
  ids.delete('studentFaceTemplates');
  const documents = new Map(students.map(doc => [doc.name, doc]));
  for (const id of [...ids].sort()) {
    if (id === 'students') continue;
    const docs = await collectionGroup(id);
    for (const doc of docs) documents.set(doc.name, doc);
    console.log(`Inspected ${id}: ${docs.length} records`);
  }
  const operations = [];
  const ignored = {};
  const byCollection = {};
  for (const doc of documents.values()) {
    const rewrite = rewrittenFields(doc.fields, map);
    if (rewrite.ignored.length) ignored[collection(doc)] = [...new Set([...(ignored[collection(doc)] || []), ...rewrite.ignored])];
    if (!rewrite.mask.length) continue;
    if (/face|biometric/i.test(collection(doc)) || Object.keys(doc.fields || {}).some(key => /Encrypted|Ciphertext/i.test(key))) {
      throw new Error('An encrypted identity-linked record needs separate key-aware handling; stopped before writes.');
    }
    const destination = destinationName(doc, map);
    if (destination !== doc.name && documents.has(destination)) throw new Error('Destination document already exists; stopped before writes.');
    operations.push({ before: doc, destination, fields: rewrite.after, mask: rewrite.mask });
    byCollection[collection(doc)] = (byCollection[collection(doc)] || 0) + 1;
  }
  const destinations = operations.map(op => op.destination);
  if (new Set(destinations).size !== destinations.length) throw new Error('Multiple sources target one document; stopped.');
  const plan = { project: PROJECT, createdAt: new Date().toISOString(), studentCount: students.length,
    map: [...map], collectionIds: [...ids].sort(), operations,
    summary: { correctedStudents: map.size, scannedRecords: documents.size, affectedRecords: operations.length,
      movedDocuments: operations.filter(op => op.destination !== op.before.name).length, byCollection,
      ignoredReferenceFields: ignored, collisions: 0, databaseWrites: 0 } };
  mkdirSync(PLAN_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(PLAN_FILE, JSON.stringify(plan), { mode: 0o600 });
  console.log('PREVIEW ' + JSON.stringify(plan.summary));
}

export function validatePlan(plan, expectedCount = 271) {
  if (plan.project !== PROJECT || plan.map.length !== expectedCount) throw new Error('Unexpected repair plan identity/count.');
  const map = new Map(plan.map);
  if (map.size !== expectedCount || new Set(map.values()).size !== expectedCount) throw new Error('Repair mapping is not one-to-one.');
  for (const [old, corrected] of map) if (correctedAdmission(old) !== corrected) throw new Error('Mapping changes more than the approved extra zero.');
  for (const op of plan.operations) {
    if (!op.before.name.startsWith(BASE + '/') || !op.before.updateTime) throw new Error('Missing source identity/version.');
    if (protectedCollection(collection(op.before)) && collection(op.before) !== 'studentLoginCredentials') throw new Error('Protected collection in repair plan.');
    const expected = rewrittenFields(op.before.fields, map);
    if (!expected.mask.length || JSON.stringify(op.fields) !== JSON.stringify(expected.after)
        || JSON.stringify(op.mask) !== JSON.stringify(expected.mask) || op.destination !== destinationName(op.before, map)) {
      throw new Error('Plan contents differ from the restricted reference-only repair.');
    }
  }
  const movedStudents = plan.operations.filter(op => collection(op.before) === 'students');
  if (movedStudents.length !== expectedCount) throw new Error('Plan does not contain every affected student exactly once.');
  if (new Set(plan.operations.map(op => op.before.name)).size !== plan.operations.length
      || new Set(plan.operations.map(op => op.destination)).size !== plan.operations.length) throw new Error('Duplicate document in repair plan.');
  return map;
}
export function repairBatches(plan) {
  // Records referencing multiple children join the same atomic component. Never
  // separate a student's identity move from that student's linked records.
  const map = new Map(plan.map);
  const parent = new Map([...map.keys()].map(key => [key, key]));
  const root = key => parent.get(key) === key ? key : (parent.set(key, root(parent.get(key))), parent.get(key));
  const lookup = new Map();
  for (const [old] of map) {
    lookup.set(old.toLowerCase(), old);
    lookup.set(old.toLowerCase().replace(/[^a-z0-9]/g, ''), old);
  }
  function refs(value, found = new Set()) {
    if (value && typeof value === 'object') for (const child of Object.values(value)) refs(child, found);
    else if (typeof value === 'string' && lookup.has(value.toLowerCase())) found.add(lookup.get(value.toLowerCase()));
    return found;
  }
  const related = new Map();
  for (const op of plan.operations) {
    const keys = [...refs(op.before.fields)];
    if (!keys.length) throw new Error('An operation is not linked to an affected student.');
    for (const key of keys.slice(1)) parent.set(root(key), root(keys[0]));
    related.set(op, keys[0]);
  }
  const groups = new Map();
  for (const op of plan.operations) {
    const key = root(related.get(op));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(op);
  }
  const batches = [];
  let batch = [];
  let count = 0;
  for (const group of groups.values()) {
    const writes = group.reduce((sum, op) => sum + (op.destination === op.before.name ? 1 : 2), 0);
    if (writes > 450 || Buffer.byteLength(JSON.stringify(group)) > 7_000_000) throw new Error('An atomic student group exceeds the safe batch size.');
    if (count + writes > 450 || Buffer.byteLength(JSON.stringify([...batch, ...group])) > 7_000_000) {
      batches.push(batch); batch = []; count = 0;
    }
    batch.push(...group); count += writes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function forwardWrites(batch) {
  return batch.flatMap(op => op.destination === op.before.name ? [{
    update: { name: op.before.name, fields: op.fields }, updateMask: { fieldPaths: op.mask }, currentDocument: { updateTime: op.before.updateTime }
  }] : [{ update: { name: op.destination, fields: op.fields }, currentDocument: { exists: false } },
    { delete: op.before.name, currentDocument: { updateTime: op.before.updateTime } }]);
}
function sameFields(a, b) {
  const sorted = value => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]))
    : Array.isArray(value) ? value.map(sorted) : value;
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}
async function rollbackBatch(batch) {
  const live = await readDocuments([...new Set(batch.flatMap(op => [op.before.name, op.destination]))]);
  const writes = [];
  for (const op of batch) {
    const current = live.get(op.destination);
    if (!current || !sameFields(current.fields, op.fields)) throw new Error('Concurrent changes prevent automatic rollback; original backup is retained.');
    if (op.before.name === op.destination) writes.push({
      update: { name: op.before.name, fields: op.before.fields }, updateMask: { fieldPaths: op.mask }, currentDocument: { updateTime: current.updateTime }
    });
    else {
      if (live.get(op.before.name)) throw new Error('Old document was recreated; stopped rather than overwriting it.');
      writes.push({ update: { name: op.before.name, fields: op.before.fields }, currentDocument: { exists: false } },
        { delete: op.destination, currentDocument: { updateTime: current.updateTime } });
    }
  }
  await request(BASE + ':commit', 'POST', { writes });
}
async function verify(plan) {
  validatePlan(plan);
  const names = [...new Set(plan.operations.flatMap(op => [op.before.name, op.destination]))];
  console.log(`Verifying ${names.length} corrected source/destination identities.`);
  const live = await readDocuments(names);
  let concurrentUpdates = 0;
  for (const op of plan.operations) {
    const current = live.get(op.destination);
    if (!current || op.mask.some(key => !sameFields(current.fields[key], op.fields[key]))) throw new Error('Corrected document/reference verification failed.');
    if (op.before.name !== op.destination && live.get(op.before.name)) throw new Error('An obsolete document still exists.');
    if (!sameFields(current.fields, op.fields)) concurrentUpdates += 1;
  }
  const students = await studentRows();
  if (students.length !== plan.studentCount || admissionMap(students).size !== 0) throw new Error('Student count/admission verification failed.');
  const numbers = new Set(students.map(doc => str(doc.fields?.AdmissionNo)));
  if (plan.map.some(([, corrected]) => !numbers.has(corrected))) throw new Error('An expected corrected admission is missing.');
  console.log('VERIFIED ' + JSON.stringify({ project: PROJECT, correctedStudents: plan.map.length,
    verifiedLinkedRecords: plan.operations.length, studentCount: students.length, remainingExtraZero: 0,
    parentPasswordsReset: 0, concurrentUpdates, financialAmountsChangedByRepair: 0 }));
}
async function apply() {
  if (process.argv[3] !== 'DCA/26/271') throw new Error('Exact reviewed scope confirmation is required.');
  const plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8'));
  validatePlan(plan);
  if (Date.now() - Date.parse(plan.createdAt) > 60 * 60_000) throw new Error('Preview is stale; run a new preview.');
  const batches = repairBatches(plan);
  const students = await studentRows();
  if (JSON.stringify([...admissionMap(students)].sort()) !== JSON.stringify([...plan.map].sort())) throw new Error('Student mapping changed after preview.');
  const names = [...new Set(plan.operations.flatMap(op => [op.before.name, op.destination]))];
  const live = await readDocuments(names);
  for (const op of plan.operations) {
    if (live.get(op.before.name)?.updateTime !== op.before.updateTime) throw new Error('A source record changed after preview; stopped before writes.');
    if (op.destination !== op.before.name && live.get(op.destination)) throw new Error('A destination appeared after preview; stopped before writes.');
  }
  // Firestore deleting a document does not move its subcollections. Refuse any
  // move with child collections rather than leaving data under an obsolete key.
  const moved = plan.operations.filter(op => op.destination !== op.before.name);
  console.log(`Checking child collections for ${moved.length} moved documents before writes.`);
  for (let index = 0; index < moved.length; index += 1) {
    const op = moved[index];
    if ((await collectionIds(op.before.name)).length || (await collectionIds(op.destination)).length) {
      throw new Error('A moved document has subcollections; separate migration is required. No writes performed.');
    }
    if ((index + 1) % 50 === 0 || index + 1 === moved.length) console.log(`Child-collection checks: ${index + 1}/${moved.length}; no writes yet.`);
  }
  const backupDir = `${PLAN_DIR}/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  mkdirSync(backupDir, { mode: 0o700 });
  writeFileSync(`${backupDir}/before-and-plan.json`, JSON.stringify(plan), { flag: 'wx', mode: 0o600 });
  const journal = { project: PROJECT, status: 'Prepared', backupDir, committed: [] };
  const saveJournal = () => writeFileSync(`${backupDir}/journal.json`, JSON.stringify(journal), { mode: 0o600 });
  saveJournal();
  console.log(`BACKUP retained privately at ${backupDir}/before-and-plan.json`);
  try {
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      journal.status = 'Applying'; journal.pendingBatch = index; saveJournal();
      try { await request(BASE + ':commit', 'POST', { writes: forwardWrites(batch) }); }
      catch (error) {
        // A response can be lost after an atomic commit. Inspect the destination
        // state before deciding whether this batch belongs in rollback.
        const current = await readDocuments(batch.map(op => op.destination));
        if (batch.every(op => current.get(op.destination) && sameFields(current.get(op.destination).fields, op.fields))) journal.committed.push(index);
        else if (!batch.every(op => op.destination === op.before.name
          ? sameFields(current.get(op.destination)?.fields, op.before.fields) : !current.get(op.destination))) {
          journal.status = 'Uncertain'; saveJournal();
          throw new Error('Commit outcome needs review; retained backup and journal identify the pending batch.');
        }
        throw error;
      }
      journal.committed.push(index); delete journal.pendingBatch; saveJournal();
      console.log(`Committed atomic batch ${index + 1}/${batches.length}`);
    }
    await verify(plan);
    journal.status = 'Verified'; saveJournal();
  } catch (error) {
    if (journal.status === 'Uncertain') throw error;
    journal.status = 'RollingBack'; saveJournal();
    for (const index of [...journal.committed].reverse()) {
      await rollbackBatch(batches[index]);
      journal.committed = journal.committed.filter(value => value !== index); saveJournal();
    }
    journal.status = 'RolledBack'; saveJournal();
    throw new Error(`Repair stopped and committed batches were rolled back: ${error.message}`);
  }
}
async function inspect() {
  const students = await studentRows();
  const map = admissionMap(students);
  const rootCollections = await collectionIds();
  console.log(JSON.stringify({ project: PROJECT, studentCount: students.length, correctionCount: map.size,
    alreadyCorrect: students.filter(doc => /^DCA\/26\/\d{3}$/.test(str(doc.fields?.AdmissionNo))).length,
    rootCollections, studentPaths: [...new Set(students.map(doc => doc.name.split('/documents/')[1].split('/').slice(0, -1).join('/')))],
    sampleFieldNames: Object.keys(students.find(doc => correctedAdmission(str(doc.fields?.AdmissionNo)))?.fields || {}),
    collisions: 0, databaseWrites: 0 }, null, 2));
}

async function previewFaces() {
  const faces = await collectionGroup('studentFaceTemplates');
  if (faces.length !== 2) throw new Error('Face enrollment count differs from the reviewed two; stopped.');
  for (const doc of faces) {
    if (!doc.name.startsWith(BASE + '/schoolBranches/main/sections/')) throw new Error('Unexpected face enrollment scope; stopped.');
    if ((await collectionIds(doc.name)).length) throw new Error('Face enrollment has child collections; stopped.');
  }
  mkdirSync(PLAN_DIR, { recursive: true, mode: 0o700 });
  const file = `${PLAN_DIR}/face-enrollments-before.json`;
  writeFileSync(file, JSON.stringify({ project: PROJECT, createdAt: new Date().toISOString(), faces }), { flag: 'wx', mode: 0o600 });
  console.log('FACE PREVIEW ' + JSON.stringify({ project: PROJECT, enrollments: faces.length, backup: file, databaseWrites: 0 }));
}
async function deleteFaces() {
  if (process.argv[3] !== 'DELETE-TWO-ENROLLMENTS') throw new Error('Explicit face deletion confirmation required.');
  const saved = JSON.parse(readFileSync(`${PLAN_DIR}/face-enrollments-before.json`, 'utf8'));
  if (saved.project !== PROJECT || saved.faces.length !== 2 || Date.now() - Date.parse(saved.createdAt) > 60 * 60_000) throw new Error('Invalid/stale face deletion backup.');
  const faces = await collectionGroup('studentFaceTemplates');
  if (faces.length !== 2 || faces.some(doc => !saved.faces.some(old => old.name === doc.name && old.updateTime === doc.updateTime && sameFields(old.fields, doc.fields)))) throw new Error('Face enrollments changed after backup; stopped.');
  await request(BASE + ':commit', 'POST', { writes: saved.faces.map(doc => ({ delete: doc.name, currentDocument: { updateTime: doc.updateTime } })) });
  if ((await collectionGroup('studentFaceTemplates')).length) throw new Error('Face deletion verification failed.');
  console.log('FACE DELETION VERIFIED: 2 enrollments removed; private recovery backup retained.');
}

async function main() {
  const account = execFileSync('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], { encoding: 'utf8' }).trim().toLowerCase();
  if (!['jozcefhse@gmail.com', 'dynamaxj7@gmail.com'].includes(account)) throw new Error('Unexpected active Cloud Shell account; stopped.');
  const mode = process.argv[2] || 'inspect';
  if (mode === 'inspect') return inspect();
  if (mode === 'preview-faces') return previewFaces();
  if (mode === 'delete-faces') return deleteFaces();
  if (mode === 'preview') return preview();
  if (mode === 'apply') return apply();
  if (mode === 'verify') return verify(JSON.parse(readFileSync(PLAN_FILE, 'utf8')));
  throw new Error('Use inspect, preview, apply or verify.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
