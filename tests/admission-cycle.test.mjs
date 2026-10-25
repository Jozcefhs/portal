import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  createAdmissionCycleService, admissionCycleId, admissionCycleScope, applicantProtection,
  retentionDays, compactApplicant, requireAdmissionCycleAdministrator, activeAdmissionRows,
  admissionSubmissionFence, publicAdmissionPreview
} from '../functions/lib/admission-cycle.js';

const scope = { AcademicSession: '2026/2027', Term: 'First Term' };
const actor = { username: 'admin', role: 'Super Admin', canSwitchBranches: true, schoolSectionAccess: 'All' };
const applicationPath = 'schoolBranches/main/sections/secondary/applications';
const studentPath = 'schoolBranches/main/sections/secondary/students';
const applicant = (id, extra = {}) => ({ ApplicationReference: `DCA/26/${id}`, ApplicantName: `Applicant ${id}`,
  ...scope, BranchId: 'main', SchoolSection: 'secondary', Status: 'Submitted',
  ResidentialAddress: 'Private address', MedicalCondition: 'Private health detail', NIN: '12345678901',
  EnglishScore: '0', MathematicsScore: 45, InterviewScore: '7.5', TotalScore: '52.5',
  EntranceSubjectScores: [{ id: 'art', name: 'Art', maxScore: 80, score: '0' }],
  Answers: { first: 'B' }, ReceiptNo: 'REC-12', VerificationEmail: 'parent@example.test',
  documents: { PassportPhotograph: { url: 'r2://dynamax-documents/v1/school/school-a/a.jpg' } },
  DocumentUploadHistory: 'Original history', CustomUnknownField: { keep: true }, ...extra });

function fixture() {
  let revision = 0;
  let time = Date.parse('2026-10-24T09:00:00Z');
  const db = new Map();
  const objects = new Map();
  const events = [];
  const env = { ORGANISATION_EDITION: 'school', DYNAMAX_WORKSPACE_ID: 'school-a' };
  const put = (path, id, row) => { const saved = { ...structuredClone(row), __id: id, __updateTime: `r${++revision}` }; db.set(`${path}/${id}`, saved); return saved; };
  const get = async (_env, path, id) => structuredClone(db.get(`${path}/${id}`) || null);
  const list = async (_env, path) => [...db.entries()].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(([, row]) => structuredClone(row));
  const paths = async (_env, collection) => [collection, collection === 'applications' ? applicationPath : studentPath];
  const page = async (_env, path, options = {}) => {
    const all = await list(_env, path);
    const start = Number(options.pageToken || 0);
    return { documents: all.slice(start, start + 2), nextPageToken: start + 2 < all.length ? String(start + 2) : '' };
  };
  const commit = async (_env, writes) => {
    events.push({ type: 'commit', writes: structuredClone(writes) });
    for (const write of writes) {
      const current = db.get(`${write.collectionPath}/${write.documentId}`);
      if ((write.exists === false && current) || (write.updateTime && write.updateTime !== current?.__updateTime))
        throw Object.assign(new Error('Conflict'), { status: 409 });
    }
    for (const write of writes) {
      let data = write.data;
      if (write.updateMask) {
        data = structuredClone(db.get(`${write.collectionPath}/${write.documentId}`));
        for (const key of write.updateMask) {
          if (Object.hasOwn(write.data, key)) data[key] = structuredClone(write.data[key]);
          else delete data[key];
        }
      }
      put(write.collectionPath, write.documentId, data);
    }
  };
  env.DYNAMAX_DOCUMENTS = {
    put: async (key, bytes, options) => { events.push({ type: 'backup-write', key, options }); objects.set(key, new Uint8Array(bytes)); return { etag: 'etag' }; },
    get: async key => { events.push({ type: 'backup-read', key }); const bytes = objects.get(key); return bytes ? { size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer } : null; },
    delete: async () => { throw new Error('No existing documents may be deleted'); }
  };
  const dependencies = { get, list, paths, page, commit, now: () => time };
  const service = createAdmissionCycleService(env, actor, dependencies);
  return { env, db, objects, events, put, get, list, dependencies, service,
    advance: days => { time += days * 86400000; },
    async policy(days) { const current = await service.policy(); return service.savePolicy({ days, revision: current.revision }); },
    async close() { const p = await service.preview(scope); return service.close({ ...scope, fingerprint: p.fingerprint, confirmation: 'CLOSE 2026/2027 First Term' }); },
    async clean() { const p = await service.preview(scope); return service.cleanup({ ...scope, fingerprint: p.fingerprint, confirmation: 'CLEAN 2026/2027 First Term' }); }
  };
}

test('only school-wide administrators can manage cleanup; scope is explicit and tenant-specific', async () => {
  for (const user of [{ ...actor, role: 'ICT' }, { ...actor, assignedBranchId: 'main' }, { ...actor, schoolSectionAccess: 'Primary' }])
    assert.throws(() => requireAdmissionCycleAdministrator(user), /school-wide/);
  assert.throws(() => createAdmissionCycleService({ ORGANISATION_EDITION: 'faith', DYNAMAX_WORKSPACE_ID: 'x' }, actor), /only to schools/);
  assert.throws(() => admissionCycleScope({ AcademicSession: '2026/2027' }), /explicit/);
  assert.throws(() => admissionCycleScope({ ...scope, Term: 'constructor' }), /explicit/);
  assert.equal(admissionCycleScope({ ...scope, Term: '' }, false), null);
  assert.throws(() => admissionCycleScope({ ...scope, AcademicSession: '2026/2028' }), /explicit/);
  const f = fixture();
  assert.notEqual(await admissionCycleId(f.env, scope), await admissionCycleId({ ...f.env, DYNAMAX_WORKSPACE_ID: 'school-b' }, scope));
});

test('retention is explicit, configurable and defaults to indefinite; malformed periods fail closed', async () => {
  const f = fixture();
  assert.equal((await f.service.policy()).days, null);
  for (const value of [-1, 1.5, 36501, '', undefined, false, {}, 'bad']) assert.throws(() => retentionDays(value));
  assert.equal(retentionDays(0), 0);
  assert.equal(retentionDays('365'), 365);
  assert.equal(retentionDays('never'), null);
  await f.policy(30);
  assert.equal((await f.service.policy()).days, 30);
  await assert.rejects(f.service.savePolicy({ days: 0, revision: 'stale' }), /changed/);
});

test('closing neither removes records nor creates a deletion backup; immutable retention starts at closure', async () => {
  const f = fixture();
  f.put(applicationPath, 'a', applicant('a'));
  const before = structuredClone(f.db.get(`${applicationPath}/a`));
  await f.policy(30); await f.close();
  assert.deepEqual(f.db.get(`${applicationPath}/a`), before);
  assert.equal(f.objects.size, 0);
  await f.policy(0);
  assert.equal((await f.service.preview(scope)).cycle.RetentionDays, 30);
  await assert.rejects(f.clean(), /retention period has not ended/);
  f.advance(30);
  assert.equal((await f.clean()).cleaned, 1);
});

test('indefinite cycles cannot be cleaned even after the school default changes', async () => {
  const f = fixture(); f.put(applicationPath, 'a', applicant('a')); await f.close();
  await f.policy(0); f.advance(4000);
  await assert.rejects(f.clean(), /retained indefinitely/);
  assert.equal(f.objects.size, 0);
});

test('full pagination includes legacy collections; wrong session/term and unassigned records are excluded', async () => {
  const f = fixture();
  for (let i = 0; i < 7; i++) f.put(applicationPath, `a${i}`, applicant(`a${i}`));
  f.put('applications', 'legacy', applicant('legacy'));
  f.put(applicationPath, 'other', applicant('other', { Term: 'Second Term' }));
  f.put(applicationPath, 'unknown', applicant('unknown', { Term: '' }));
  const p = await f.service.preview(scope);
  assert.equal(p.total, 8); assert.equal(p.eligible, 8); assert.equal(p.unassigned, 1);
  assert.equal(Object.hasOwn(publicAdmissionPreview(p), '_sources'), false);
  assert.equal(JSON.stringify(publicAdmissionPreview(p)).includes('Private health detail'), false);
});

test('enrolled, admitted, accepted, admission-number assigned, held and linked applicants are protected', async () => {
  const f = fixture();
  const cases = [{ Enrolled: 'YES' }, { Status: 'Enrolled' }, { ResultStatus: 'Admitted' }, { ResultStatus: 'Probation' },
    { AdmissionNo: 'DCA/26/001' }, { OfferSent: 'YES' }, { AcceptanceFeePaid: 'YES' }, { AcceptanceFeeAmount: 1200 },
    { AdmissionLetterSent: 'YES' }, { RetentionHold: 'YES' }, { RetentionHoldReason: 'Pending review' }];
  cases.forEach((extra, index) => { const row = applicant(index, extra); assert.ok(applicantProtection(row)); f.put(applicationPath, String(index), row); });
  f.put(applicationPath, 'linked', applicant('linked'));
  // Student protection must see later pages, not only the first page.
  for (let i = 0; i < 6; i++) f.put(studentPath, `s${i}`, { AdmissionNo: `S${i}` });
  f.put(studentPath, 'linked', { ApplicationReference: 'DCA/26/linked' });
  f.put(applicationPath, 'eligible', applicant('eligible'));
  const before = structuredClone([...f.db]);
  await f.policy(0); await f.close();
  const result = await f.clean(); assert.equal(result.cleaned, 1);
  for (const [key, row] of before.filter(([key]) => !key.endsWith('/eligible'))) assert.deepEqual(f.db.get(key), row);
});

test('successful cleanup verifies full bytes then removes only masked personal fields without rewriting scores', async () => {
  const f = fixture(); const original = applicant('a'); f.put(applicationPath, 'a', original);
  f.put('payments', 'payment', { Amount: 600, ReceiptNo: 'REC-12' });
  await f.policy(0); await f.close(); f.events.length = 0;
  const result = await f.clean(); assert.equal(result.cleaned, 1);
  assert.deepEqual(f.events.map(event => event.type), ['backup-write', 'backup-read', 'commit']);
  const writes = f.events.at(-1).writes;
  const write = writes.find(item => item.collectionPath === applicationPath);
  assert.equal(Object.hasOwn(write.data, 'EnglishScore'), false);
  assert.equal(write.updateMask.includes('EnglishScore'), false);
  assert.equal(write.updateMask.includes('ResidentialAddress'), true);
  assert.equal(write.updateTime.startsWith('r'), true);
  assert.deepEqual(writes.map(item => item.collectionPath), [applicationPath, 'admissionCycleBackups', 'admissionCycles']);
  const saved = f.db.get(`${applicationPath}/a`);
  for (const key of ['EnglishScore', 'MathematicsScore', 'InterviewScore', 'TotalScore', 'EntranceSubjectScores', 'Answers', 'documents', 'DocumentUploadHistory', 'ReceiptNo', 'CustomUnknownField']) assert.deepEqual(saved[key], original[key]);
  assert.equal(Object.hasOwn(saved, 'MedicalCondition'), false);
  assert.equal(f.db.get('payments/payment').Amount, 600);
  const archive = JSON.parse(new TextDecoder().decode([...f.objects.values()][0]));
  assert.deepEqual(archive.documents[0].data, original);
  const download = await f.service.download({ ...scope, backupId: result.backupId });
  assert.equal(download.status, 200); assert.match(download.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await download.json(), archive);
  assert.equal((await f.clean()).cleaned, 0);
});

test('bounded cleanup batches are repeatable with complete original backups', async () => {
  const f = fixture(); for (let i = 0; i < 23; i++) f.put(applicationPath, `a${i}`, applicant(i));
  await f.policy(0); await f.close();
  assert.equal((await f.service.preview(scope)).batch.length, 20);
  const first = await f.clean(); assert.equal(first.cleaned, 20); assert.equal(first.remaining, 3);
  const second = await f.clean(); assert.equal(second.cleaned, 3); assert.equal(second.remaining, 0);
  assert.equal((await f.service.backups(scope)).backups.length, 2);
});

for (const failure of ['missing-binding', 'write-rejected', 'missing-read', 'corrupt-read', 'read-error']) {
  test(`backup failure ${failure} leaves all original data and scores untouched`, async () => {
    const f = fixture(); f.put(applicationPath, 'a', applicant('a')); await f.policy(0); await f.close();
    const before = structuredClone([...f.db]);
    if (failure === 'missing-binding') delete f.env.DYNAMAX_DOCUMENTS;
    if (failure === 'write-rejected') f.env.DYNAMAX_DOCUMENTS.put = async () => null;
    if (failure === 'missing-read') f.env.DYNAMAX_DOCUMENTS.get = async () => null;
    if (failure === 'read-error') f.env.DYNAMAX_DOCUMENTS.get = async () => { throw new Error('read failed'); };
    if (failure === 'corrupt-read') {
      const read = f.env.DYNAMAX_DOCUMENTS.get;
      f.env.DYNAMAX_DOCUMENTS.get = async key => { const value = await read(key); const bytes = new Uint8Array(await value.arrayBuffer()); bytes[10] ^= 1; return { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }; };
    }
    await assert.rejects(f.clean());
    assert.deepEqual([...f.db], before);
  });
}

test('changes before cleanup, during verification or during final commit never remove new marks', async () => {
  for (const timing of ['before', 'during-backup', 'before-commit']) {
    const f = fixture(); f.put(applicationPath, 'a', applicant('a')); await f.policy(0); await f.close();
    const p = await f.service.preview(scope);
    const edit = () => f.put(applicationPath, 'a', applicant('a', { EnglishScore: 99 }));
    if (timing === 'before') edit();
    if (timing === 'during-backup') {
      const read = f.env.DYNAMAX_DOCUMENTS.get;
      f.env.DYNAMAX_DOCUMENTS.get = async key => { edit(); return read(key); };
    }
    let service = f.service;
    if (timing === 'before-commit') service = createAdmissionCycleService(f.env, actor, { ...f.dependencies, commit: async (...args) => { edit(); return f.dependencies.commit(...args); } });
    await assert.rejects(service.cleanup({ ...scope, fingerprint: p.fingerprint, confirmation: 'CLEAN 2026/2027 First Term' }));
    const saved = f.db.get(`${applicationPath}/a`);
    assert.equal(saved.EnglishScore, 99); assert.equal(saved.MedicalCondition, 'Private health detail');
    assert.equal((await f.service.backups(scope)).backups.length, 0);
  }
});

test('a newly discovered student link during backup cancels cleanup', async () => {
  const f = fixture(); f.put(applicationPath, 'a', applicant('a')); await f.policy(0); await f.close();
  const read = f.env.DYNAMAX_DOCUMENTS.get;
  f.env.DYNAMAX_DOCUMENTS.get = async key => { f.put(studentPath, 'a', { ApplicationReference: 'DCA/26/a' }); return read(key); };
  await assert.rejects(f.clean(), /changed during backup/);
  assert.equal(f.db.get(`${applicationPath}/a`).NIN, '12345678901');
});

test('false confirmation and stale preview are rejected before any backup or destructive write', async () => {
  const f = fixture(); f.put(applicationPath, 'a', applicant('a')); await f.policy(0);
  const p = await f.service.preview(scope);
  await assert.rejects(f.service.close({ ...scope, fingerprint: p.fingerprint, confirmation: 'yes' }), /confirmation/);
  await f.close(); const next = await f.service.preview(scope);
  await assert.rejects(f.service.cleanup({ ...scope, fingerprint: 'fake', confirmation: 'CLEAN 2026/2027 First Term' }), /changed/);
  await assert.rejects(f.service.cleanup({ ...scope, fingerprint: next.fingerprint, confirmation: 'yes' }), /confirmation/);
  assert.equal(f.objects.size, 0);
});

test('private downloads reject foreign school/cycle receipts and altered backup bytes', async () => {
  const f = fixture(); f.put(applicationPath, 'a', applicant('a')); await f.policy(0); await f.close(); const result = await f.clean();
  await assert.rejects(f.service.download({ ...scope, Term: 'Second Term', backupId: result.backupId }), /not found/);
  const other = createAdmissionCycleService({ ...f.env, DYNAMAX_WORKSPACE_ID: 'school-b' }, actor, f.dependencies);
  assert.equal((await other.state()).cycles.length, 0);
  await assert.rejects(other.download({ ...scope, backupId: result.backupId }), /not found/);
  assert.equal((await other.backups(scope)).backups.length, 0);
  const bytes = [...f.objects.values()][0]; bytes[0] ^= 1;
  await assert.rejects(f.service.download({ ...scope, backupId: result.backupId }), /integrity/);
});

test('closed admissions are removed from active list but unassigned and other cycles remain', async () => {
  const f = fixture(); await f.close();
  const rows = [applicant('closed'), applicant('other', { Term: 'Second Term' }), applicant('unknown', { Term: '' })];
  assert.deepEqual((await activeAdmissionRows(f.env, rows, f.dependencies)).map(row => row.ApplicationReference), ['DCA/26/other', 'DCA/26/unknown']);
  assert.equal(f.db.has(`${applicationPath}/closed`), false);
});

test('new submissions join the same atomic cycle fence and cannot write through a concurrent closure', async () => {
  const f = fixture();
  const fence = await admissionSubmissionFence(f.env, applicant('a'), f.dependencies);
  assert.equal(fence.exists, false);
  await f.dependencies.commit(f.env, [fence]);
  const next = await admissionSubmissionFence(f.env, applicant('a'), f.dependencies);
  assert.ok(next.updateTime);
  await f.close();
  await assert.rejects(f.dependencies.commit(f.env, [next]), /Conflict/);
  await assert.rejects(admissionSubmissionFence(f.env, applicant('a'), f.dependencies), /closed/);
});

test('compaction never mutates its input and leaves decision, document, finance and score fields unchanged', () => {
  const row = applicant('a'); const before = structuredClone(row);
  const result = compactApplicant(row, { at: 'now', actor: 'admin', backupId: 'id', sha256: 'digest', cycleId: 'cycle' });
  assert.deepEqual(row, before);
  assert.equal(result.ResidentialAddress, undefined);
  assert.equal(result.EnglishScore, '0');
  assert.deepEqual(result.documents, row.documents);
});

test('UI invalidates previews, escapes applicant content, manages busy state and closes cleanly', () => {
  const js = readFileSync(new URL('../js/admission-cycles.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
  assert.match(js, /escape\(record\.name\)/);
  assert.match(js, /addEventListener\('input', invalidate\)/);
  assert.match(js, /if \(busy\) event\.preventDefault\(\)/);
  assert.match(js, /dialog\.remove\(\); returnFocus\?\.focus\(\)/);
  assert.match(js, /fingerprint: preview\.fingerprint/);
  assert.match(js, /result\.remaining/);
  assert.match(html, /js\/admission-cycles\.js\?v=20261024/);
});

test('incomplete student protection reads fail closed, with no backup or cleanup writes', async () => {
  const f = fixture(); f.put(applicationPath, 'a', applicant('a')); await f.policy(0); await f.close();
  const p = await f.service.preview(scope);
  const before = structuredClone([...f.db]);
  const service = createAdmissionCycleService(f.env, actor, { ...f.dependencies,
    page: async (env, path, options) => { if (path === studentPath) throw new Error('Student read unavailable'); return f.dependencies.page(env, path, options); } });
  await assert.rejects(service.cleanup({ ...scope, fingerprint: p.fingerprint, confirmation: 'CLEAN 2026/2027 First Term' }), /Student read unavailable/);
  assert.equal(f.objects.size, 0); assert.deepEqual([...f.db], before);
});

test('API rejects missing sessions, cross-origin requests and invalid actions before any cleanup', async () => {
  const source = readFileSync(new URL('../functions/api/admission-cycles.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /export async function onRequestGet/);
  let serviceCalls = 0;
  let unauthenticated = false;
  const handler = vm.runInNewContext(source.replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function') + '\nonRequestPost', {
    Response, URL, requireFirestoreEnv: () => {},
    requireStaffSession: async () => { if (unauthenticated) throw Object.assign(new Error('Sign in'), { status: 401 }); return actor; },
    readJsonBody: request => request.json(),
    createAdmissionCycleService: () => { serviceCalls++; return { cleanup: async () => { throw new Error('Must not run'); } }; },
    publicAdmissionPreview: value => value
  });
  const req = (origin, action = 'cleanup') => ({ env: {}, request: new Request('https://school.example/api/admission-cycles', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ action }) }) });
  const crossSite = await handler(req('https://attacker.example'));
  assert.equal(crossSite.status, 403); assert.equal(serviceCalls, 0);
  unauthenticated = true;
  const noSession = await handler(req('https://school.example'));
  assert.equal(noSession.status, 401); assert.equal(serviceCalls, 0);
  unauthenticated = false;
  const invalid = await handler(req('https://school.example', 'constructor'));
  assert.equal(invalid.status, 400);
  assert.match(invalid.headers.get('cache-control'), /no-store/);
});

test('integration guards preserve parent access and reject document replacements before storage deletion', () => {
  const staff = readFileSync(new URL('../functions/api/staff-document.js', import.meta.url), 'utf8');
  assert.ok(staff.indexOf('if (application.AdmissionDetailsRemovedAt)') < staff.indexOf('await deleteStoredDocument(env, storedUrl)'));
  const uploads = readFileSync(new URL('../functions/api/upload-document.js', import.meta.url), 'utf8');
  assert.match(uploads, /ADMISSION_HISTORY_READ_ONLY/);
  const parent = readFileSync(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8');
  assert.match(parent, /if \(!application.AdmissionDetailsRemovedAt\) await upsertSchoolDocument/);
  const school = readFileSync(new URL('../functions/lib/school-scope.js', import.meta.url), 'utf8');
  assert.match(school, /if \(current\?\.AdmissionDetailsRemovedAt\)/);
  assert.match(school, /updateTime: options.updateTime \|\| copy.__updateTime \|\| current.__updateTime/);
});

test('new form checkout checks cycle closure and preserves intake attribution through payment settlement', () => {
  const init = readFileSync(new URL('../functions/api/init-form-payment.js', import.meta.url), 'utf8');
  assert.ok(init.indexOf('await admissionSubmissionFence(env, intake)') < init.indexOf('await fetch(PAYSTACK_INIT_URL'));
  assert.match(init, /ClassApplyingFor: classApplyingFor,\s+\.\.\.intake/);
  const settled = readFileSync(new URL('../functions/api/verify-form-payment.js', import.meta.url), 'utf8');
  assert.match(settled, /AcademicSession: intent\?\.AcademicSession/);
  assert.match(settled, /Term: intent\?\.Term/);
  assert.doesNotMatch(settled, /admissionSubmissionFence/);
  const submit = readFileSync(new URL('../functions/api/submit-application.js', import.meta.url), 'utf8');
  assert.match(submit, /await batchUpsertDocuments\(env, \[\s+cycleFence,/);
});

test('ordinary applicant edits return the new revision and cannot resurrect cleaned details', async () => {
  const source = readFileSync(new URL('../functions/lib/school-scope.js', import.meta.url), 'utf8');
  const start = source.indexOf('export async function upsertSchoolDocument');
  const end = source.indexOf('export async function deleteSchoolDocument', start);
  let current = { __updateTime: 'before' };
  let writes = 0;
  const save = vm.runInNewContext('(' + source.slice(start, end).trim().replace('export ', '') + ')', {
    getSchoolStructure: async () => ({ ActiveBranchId: 'main' }),
    safeScopeId: value => value, schoolSectionFor: () => 'secondary', scopedCollectionPath: () => applicationPath,
    clean: value => String(value ?? '').trim(),
    getDocument: async () => current,
    upsertDocument: async (_env, _path, _id, _data, options) => {
      assert.equal(options.updateTime, current.__updateTime);
      writes++; current = { __updateTime: `after-${writes}` }; return { updateTime: current.__updateTime };
    }
  });
  const first = await save({}, 'applications', 'a', { ...applicant('a'), __updateTime: 'before' });
  assert.equal(first.__updateTime, 'after-1');
  const second = await save({}, 'applications', 'a', first);
  assert.equal(second.__updateTime, 'after-2');
  current.AdmissionDetailsRemovedAt = '2026-10-24';
  await assert.rejects(save({}, 'applications', 'a', second), /retained as admission history/);
  assert.equal(writes, 2);
});
