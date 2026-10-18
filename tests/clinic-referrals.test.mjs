import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { clinicReferralService, normalizeClinicReferral, clinicParentEmail } from '../functions/lib/clinic-referrals.js';
import { createClinicReferralPdf } from '../functions/lib/clinic-referral-pdf.js';
import { prepareSecurityAudit } from '../functions/lib/security-audit.js';

const draft = { AccountRef: 'TEST/001', VisitId: 'CLN-001', ReferralDate: '2026-10-16', Hospital: 'Example Hospital',
  Reason: 'Further assessment requested by the clinic.', Observations: 'Sample observation.', Treatment: 'Sample recorded care.',
  ClinicianTitle: 'Clinic officer', ClinicContact: 'clinic@example.org', Instructions: 'Please contact the clinic after the visit.' };
const staff = { username: 'nurse', displayName: 'Test Clinic Officer', edition: 'school', branchId: 'main',
  schoolSectionAccess: 'Secondary', allowedSections: ['clinic'] };
function fixture(extra = {}) {
  let version = 1;
  const data = new Map();
  const key = (collection, id) => `${collection}/${id}`;
  const get = (collection, id) => structuredClone(data.get(key(collection, id)) || null);
  const put = (collection, id, row) => { const saved = { ...structuredClone(row), __id: id, __updateTime: `v${version++}` }; data.set(key(collection, id), saved); return get(collection, id); };
  const student = { AdmissionNo: 'TEST/001', DisplayName: 'Sample Student', ClassName: 'Grade 10', ParentEmail: 'parent@example.org',
    BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: 'school' };
  put('clinicRecords', 'CLN-001', { AdmissionNo: 'TEST/001', Date: '2026-10-16', Complaint: 'Sample observation.', Treatment: 'Sample recorded care.',
    BranchId: 'main', SchoolSection: 'Secondary', OrganisationEdition: 'school', Status: 'Active' });
  const deliveries = [], pdfProfiles = [], pdfSignatures = [], signatureUsers = [];
  const deps = {
    getDocument: async (_, collection, id) => get(collection, id),
    listCollection: async (_, collection) => [...data].filter(([name]) => name.startsWith(`${collection}/`)).map(([, row]) => structuredClone(row)),
    queryCollection: async (_, collection, options) => {
      assert.ok(!options.select.includes('PdfBase64'), 'history queries must not fetch all PDFs');
      return [...data].filter(([name, row]) => name.startsWith(`${collection}/`) && row.AccountRef === options.filters[0].value)
        .map(([, row]) => Object.fromEntries(options.select.map(field => [field, row[field]])));
    },
    createDocumentIfAbsent: async (_, collection, id, row) => {
      if (get(collection, id)) return { created: false, document: get(collection, id) };
      return { created: true, document: put(collection, id, row) };
    },
    updateDocumentIfCurrent: async (_, collection, id, row, previous) => {
      if (get(collection, id)?.__updateTime !== previous.__updateTime) throw Object.assign(new Error('Write conflict'), { status: 409 });
      return put(collection, id, row);
    },
    batchCommitLiteralDocuments: async (_, writes) => {
      for (const write of writes) {
        const before = get(write.collectionPath, write.documentId);
        if (write.exists === false ? before : before?.__updateTime !== write.updateTime) throw new Error('Batch conflict');
      }
      for (const write of writes) put(write.collectionPath, write.documentId, write.data);
    },
    requiredDeploymentIdentity: () => ({ edition: 'school', workspaceId: 'test-school' }),
    loadStaffPosition: async () => ({ Username: 'nurse', Position: 'School Nurse', IssuerTitle: 'School Nurse' }),
    getDocumentBranding: async () => ({ DocumentLogoDataUrl: 'branded-logo', DocumentSignatureDataUrl: 'principal-signature' }),
    documentBrandingMatchesDeployment: () => true,
    effectiveBranchProfile: async (_, defaults, branch) => ({ ...defaults, SchoolName: `School ${branch}` }),
    loadStaffApprovalProfile: async (_, username) => { signatureUsers.push(username); return get('staffApprovalProfiles', username); },
    createClinicReferralPdf: async (profile, letter, options) => { pdfProfiles.push(profile); pdfSignatures.push(options.signatureDataUrl); return new TextEncoder().encode(`%PDF-sample-${letter.ReferralId}`); },
    sendConfiguredEmail: async (_, payload) => { deliveries.push(payload); return { ok: true, provider: 'test', providerMessageId: 'message-1' }; },
    ...extra
  };
  const handle = clinicReferralService(deps);
  const request = (action, body = {}, user = staff) => handle({}, user, { action, ...body }, async account => account === student.AdmissionNo ? student : null);
  const preview = (body = {}) => request('previewClinicReferral', { ...draft, ...body });
  const send = row => request('sendClinicReferral', { ReferralId: row.ReferralId, ConfirmSend: true, ConfirmedParentEmail: row.ParentEmail });
  return { data, get, put, student, request, preview, send, deliveries, pdfProfiles, pdfSignatures, signatureUsers };
}

const signatureImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

test('referrals use only the issuing officer signature and keep saved PDFs immutable', async () => {
  const f = fixture();
  f.put('staffApprovalProfiles', 'nurse', { SignatureDataUrl: signatureImage });
  const first = (await f.preview({ SignatureDataUrl: 'ATTACKER', PreparedByUsername: 'principal', SignatureApplied: false })).referral;
  assert.equal(first.SignatureApplied, true);
  assert.equal(first.PreparedBy, 'Test Clinic Officer');
  assert.deepEqual(f.signatureUsers, ['nurse']);
  assert.equal(f.pdfSignatures[0], signatureImage);
  assert.equal(f.pdfProfiles[0].DocumentSignatureDataUrl, '');
  assert.equal(Object.hasOwn(f.get('clinicReferrals', first.ReferralId), 'SignatureDataUrl'), false);
  assert.equal(Object.hasOwn(first, 'SignatureFingerprint'), false);
  f.put('staffApprovalProfiles', 'nurse', { SignatureDataUrl: '' });
  const second = (await f.preview()).referral;
  assert.notEqual(second.ReferralId, first.ReferralId);
  assert.equal(second.SignatureApplied, false);
  const historic = (await f.request('loadClinicReferral', { ReferralId: first.ReferralId })).referral;
  assert.equal(historic.PdfBase64, first.PdfBase64);
  assert.equal(historic.SignatureApplied, true);
  const sent = await f.send(first);
  assert.equal(sent.referral.PdfBase64, first.PdfBase64);
  assert.equal(f.deliveries[0].attachments[0].content, first.PdfBase64);
});

test('unavailable or legacy-incompatible signatures do not silently become unsigned referrals', async () => {
  const unavailable = fixture({ loadStaffApprovalProfile: async () => { throw new Error('Signature lookup unavailable'); } });
  await assert.rejects(unavailable.preview(), /Signature lookup unavailable/);
  const legacy = fixture({ loadStaffApprovalProfile: async () => ({ SignatureDataUrl: 'data:image/webp;base64,UklGRg==' }) });
  await assert.rejects(legacy.preview(), /Open My signature settings/);
  assert.equal(legacy.data.size, 1);
});

test('PDF embeds the officer signature with the referral date, never a blank closing date', async (t) => {
  const texts = [], images = [];
  const drawText = PDFPage.prototype.drawText, drawImage = PDFPage.prototype.drawImage;
  t.mock.method(PDFPage.prototype, 'drawText', function (text, options) {
    texts.push({ page: this, text, ...options }); return drawText.call(this, text, options);
  });
  t.mock.method(PDFPage.prototype, 'drawImage', function (image, options) {
    images.push({ page: this, ...options }); return drawImage.call(this, image, options);
  });
  const row = { ...draft, PreparedBy: 'Clinic Officer', ReferralId: 'REF-signed', StudentName: 'Sample Student', VisitDate: draft.ReferralDate };
  const profile = { SchoolName: 'Example', DocumentSignatureDataUrl: 'invalid-principal-signature' };
  const bytes = await createClinicReferralPdf(profile, row, { signatureDataUrl: signatureImage });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  assert.equal(images.length, 1);
  assert.ok(images[0].width <= 150 && images[0].height <= 48);
  assert.ok(images[0].y >= 82, 'signature is clear of the footer');
  assert.ok(texts.some(row => row.text === "Issuing officer's signature | Date: 2026-10-16"));
  assert.ok(texts.every(row => !row.text.includes('Date: ___')));
  await assert.rejects(createClinicReferralPdf(profile, row, { signatureDataUrl: 'data:image/png;base64,YmFk' }), /could not be added/);
  texts.length = 0; images.length = 0;
  await createClinicReferralPdf(profile, row);
  assert.equal(images.length, 0, 'without the officer signature, never inherit the principal signature');
  assert.ok(texts.some(row => row.text === 'Clinic signature: ______________________ | Date: 2026-10-16'));
  texts.length = 0; images.length = 0;
  await createClinicReferralPdf(profile, { ...row, Observations: 'Long observations. '.repeat(120),
    PreparedBy: 'W'.repeat(180), ClinicianTitle: 'W'.repeat(100), ClinicContact: 'W'.repeat(160) }, { signatureDataUrl: signatureImage });
  const prepared = texts.find(row => row.text.startsWith('Prepared by:'));
  const signed = texts.find(row => row.text.startsWith("Issuing officer's signature"));
  assert.equal(prepared.page, signed.page, 'long officer details stay with the signature and date');
  assert.equal(images[0].page, signed.page);
  assert.ok(signed.y >= 82);
});

test('referral fields are bounded, required and calendar-validated', () => {
  assert.equal(normalizeClinicReferral(draft).Hospital, 'Example Hospital');
  for (const input of [{ Hospital: '' }, { Reason: '' }, { ClinicianTitle: '' }, { ReferralDate: '2026-02-30' },
    { ReferralDate: 'invalid' }, { Treatment: 'x'.repeat(2401) }, { Reason: 'bad\u0000text' }]) {
    assert.throws(() => normalizeClinicReferral({ ...draft, ...input }));
  }
  assert.equal(clinicParentEmail({ ParentEmail: 'invalid', GuardianEmail: ' PARENT@example.org ' }), 'parent@example.org');
  assert.equal(clinicParentEmail({ Email: 'student@example.org' }), '', 'student email is never guessed as parent');
});

test('preview uses authoritative identity and branding and preserves the visit and stock', async () => {
  const f = fixture(), before = f.get('clinicRecords', 'CLN-001');
  const result = await f.preview({ ParentEmail: 'attacker@example.org', PreparedBy: 'Principal', StudentName: 'Changed', BranchId: 'other' });
  assert.equal(result.referral.ParentEmail, 'parent@example.org');
  assert.equal(result.referral.StudentName, 'Sample Student');
  assert.equal(result.referral.PreparedBy, 'Test Clinic Officer');
  assert.equal(result.referral.Status, 'Draft');
  assert.equal(f.pdfProfiles[0].DocumentLogoDataUrl, 'branded-logo');
  assert.equal(f.pdfProfiles[0].DocumentSignatureDataUrl, '');
  assert.equal(f.pdfProfiles[0].SchoolName, 'School main');
  assert.deepEqual(f.get('clinicRecords', 'CLN-001'), before);
  assert.equal(f.deliveries.length, 0);
  assert.equal(f.data.size, 2);
});

test('concurrent identical previews create one immutable document and reuse PDF bytes', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.preview(), f.preview()]);
  assert.equal(a.referral.ReferralId, b.referral.ReferralId);
  assert.equal(a.referral.PdfBase64, b.referral.PdfBase64);
  assert.equal(f.data.size, 2);
  assert.equal((await f.preview()).referral.PdfBase64, a.referral.PdfBase64);
  assert.notEqual((await f.preview({ Reason: 'Another reason' })).referral.ReferralId, a.referral.ReferralId);
});

test('clinic permissions, subscription and edition are enforced', async () => {
  const f = fixture();
  for (const changes of [{ allowedSections: ['accounts'] }, { username: '' }, { edition: 'faith' },
    { subscriptionReadOnly: true }, { subscriptionActive: false }]) {
    await assert.rejects(f.request('previewClinicReferral', draft, { ...staff, ...changes }), error => error.status === 403);
  }
  const other = fixture({ requiredDeploymentIdentity: () => ({ edition: 'faith', workspaceId: 'faith' }) });
  await assert.rejects(other.preview(), error => error.status === 403);
  assert.equal(f.data.size, 1);
});

test('foreign visits, sections, students and cancelled visits cannot be referred', async () => {
  for (const changes of [{ BranchId: 'other' }, { SchoolSection: 'Primary' }, { AdmissionNo: 'TEST/002' },
    { OrganisationEdition: 'faith' }, { Status: 'Cancelled' }]) {
    const f = fixture();
    f.put('clinicRecords', 'CLN-001', { ...f.get('clinicRecords', 'CLN-001'), ...changes });
    await assert.rejects(f.preview());
    assert.equal(f.data.size, 1);
  }
  await assert.rejects(fixture().preview({ VisitId: '../private' }));
  await assert.rejects(fixture().preview({ AccountRef: 'UNKNOWN' }));
});

test('student search includes older visits, excludes foreign/cancelled visits and returns only letter summaries', async () => {
  const f = fixture();
  const old = f.get('clinicRecords', 'CLN-001');
  for (let i = 0; i < 105; i++) f.put('clinicRecords', `CLN-${i + 10}`, { ...old, Date: '2025-01-01' });
  f.put('clinicRecords', 'CLN-foreign', { ...old, BranchId: 'other' });
  f.put('clinicRecords', 'CLN-cancelled', { ...old, Status: 'Cancelled' });
  await f.preview();
  const result = await f.request('prepareClinicReferral', { AccountRef: 'TEST/001' });
  assert.equal(result.visits.length, 106);
  assert.equal(result.referrals.length, 1);
  assert.equal(Object.hasOwn(result.referrals[0], 'PdfBase64'), false);
  assert.equal(Object.hasOwn(result.referrals[0], 'Observations'), false);
});

test('PDF remains printable without parent email, but cannot be sent', async () => {
  const f = fixture(); f.student.ParentEmail = ''; f.student.Email = 'child@example.org';
  const { referral } = await f.preview();
  assert.ok(referral.PdfBase64);
  await assert.rejects(f.send(referral), /parent email/);
  assert.equal(f.deliveries.length, 0);
});

test('sender must confirm and email only the reviewed PDF to the current saved parent', async () => {
  const f = fixture(), { referral } = await f.preview();
  await assert.rejects(f.request('sendClinicReferral', { ReferralId: referral.ReferralId }), /confirm/);
  f.student.ParentEmail = 'new@example.org';
  await assert.rejects(f.send(referral), /changed/);
  f.student.ParentEmail = referral.ParentEmail;
  await assert.rejects(f.request('sendClinicReferral', { ReferralId: referral.ReferralId, ConfirmSend: true, ConfirmedParentEmail: 'other@example.org' }));
  const sent = await f.send(referral);
  assert.equal(sent.referral.Status, 'Sent');
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].toEmail, 'parent@example.org');
  assert.equal(f.deliveries[0].requireAttachments, true);
  assert.deepEqual(f.deliveries[0].attachments, [{ name: referral.FileName, content: referral.PdfBase64 }]);
  assert.doesNotMatch(f.deliveries[0].textContent, /Sample observation|Sample recorded care/);
  const audit = f.get('departmentMessages', referral.ReferralId);
  assert.equal(audit.Status, 'Accepted by email provider');
  assert.equal(audit.ProviderMessageId, 'message-1');
  assert.doesNotMatch(JSON.stringify(audit), /Sample observation|PdfBase64|Reason/);
  await f.send(referral);
  assert.equal(f.deliveries.length, 1, 'replay does not send again');
});

test('changed or cancelled visit blocks sending an old preview', async () => {
  for (const changes of [{ Treatment: 'Corrected treatment' }, { Status: 'Cancelled' }]) {
    const f = fixture(), { referral } = await f.preview();
    f.put('clinicRecords', 'CLN-001', { ...f.get('clinicRecords', 'CLN-001'), ...changes });
    await assert.rejects(f.send(referral));
    assert.equal(f.deliveries.length, 0);
  }
});

test('stored PDFs cannot be read across workspace, branch or section', async () => {
  for (const changes of [{ WorkspaceId: 'other' }, { BranchId: 'other' }, { SchoolSection: 'Primary' }]) {
    const f = fixture(), { referral } = await f.preview();
    f.put('clinicReferrals', referral.ReferralId, { ...f.get('clinicReferrals', referral.ReferralId), ...changes });
    await assert.rejects(f.request('loadClinicReferral', { ReferralId: referral.ReferralId }));
  }
});

test('simultaneous send clicks dispatch at most one email', async () => {
  const f = fixture(), { referral } = await f.preview();
  const results = await Promise.allSettled([f.send(referral), f.send(referral)]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal(f.deliveries.length, 1);
});

test('ambiguous failures and post-send persistence failures block automatic resend', async () => {
  for (const mode of ['provider', 'storage', 'attachment']) {
    let attempts = 0;
    const extra = { sendConfiguredEmail: async () => {
      attempts++;
      if (mode === 'provider') throw new TypeError('Connection reset');
      return { ok: true, attachmentFallback: mode === 'attachment', provider: 'test' };
    } };
    if (mode === 'storage') extra.batchCommitLiteralDocuments = async () => { throw new Error('Storage unavailable'); };
    const f = fixture(extra), { referral } = await f.preview();
    await assert.rejects(f.send(referral));
    await assert.rejects(f.send(referral), /blocked/);
    assert.equal(attempts, 1);
  }
});

test('a definite rejection is retained as Failed and may be retried after review', async () => {
  let attempts = 0;
  const f = fixture({ sendConfiguredEmail: async () => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('Provider rejected'), { retrySafe: true, status: 400 });
    return { ok: true, provider: 'test' };
  } }), { referral } = await f.preview();
  await assert.rejects(f.send(referral), /review and retry/);
  assert.equal(f.get('clinicReferrals', referral.ReferralId).Status, 'Failed');
  assert.equal((await f.send(referral)).referral.Status, 'Sent');
  assert.equal(attempts, 2);
});

test('oversized PDF cannot silently lose its email attachment', async () => {
  const f = fixture({ createClinicReferralPdf: async () => new Uint8Array(600000) });
  await assert.rejects(f.preview(), /too large/);
  assert.equal(f.data.size, 1);
});

test('referral PDFs paginate long content and never inherit principal signature', async () => {
  const profile = { SchoolName: 'Example School', SchoolAddress: '1 Example Road', DocumentSignatureDataUrl: 'not-a-real-signature' };
  const row = { ...draft, ReferralId: 'REF-example', StudentName: 'Sample Student', PreparedBy: 'Clinic Officer', VisitDate: draft.ReferralDate };
  const one = await PDFDocument.load(await createClinicReferralPdf(profile, row));
  assert.equal(one.getPageCount(), 1);
  const long = await PDFDocument.load(await createClinicReferralPdf(profile, { ...row, Observations: 'Sample observation. '.repeat(120), Treatment: 'X'.repeat(2400), Instructions: 'Follow-up.\n'.repeat(100) }));
  assert.ok(long.getPageCount() >= 3);
});

test('referral heading and continuation text leave a visible gap below the letterhead logo', async (t) => {
  const drawings = [];
  const drawText = PDFPage.prototype.drawText;
  const drawImage = PDFPage.prototype.drawImage;
  t.mock.method(PDFPage.prototype, 'drawText', function (text, options) {
    drawings.push({ page: this, text, ...options });
    return drawText.call(this, text, options);
  });
  t.mock.method(PDFPage.prototype, 'drawImage', function (image, options) {
    drawings.push({ page: this, image: true, ...options });
    return drawImage.call(this, image, options);
  });
  const logo = await readFile(new URL('../images/Logo.png', import.meta.url));
  const bytes = await createClinicReferralPdf({ SchoolName: 'Example School',
    DocumentLogoDataUrl: `data:image/png;base64,${logo.toString('base64')}` }, {
    ...draft, ReferralId: 'REF-spacing', StudentName: 'Sample Student', PreparedBy: 'Clinic Officer',
    VisitDate: draft.ReferralDate, Observations: 'Sample observation. '.repeat(120)
  });
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
  const heading = drawings.find(row => row.text === 'CLINIC HOSPITAL REFERRAL');
  assert.ok(heading, 'the referral title must be drawn');
  for (const logoDrawing of drawings.filter(row => row.image && row.x === 48)) {
    const body = drawings.filter(row => row.page === logoDrawing.page && row.text && row.x === 58 && row.y > 51);
    assert.ok(body.length, 'every letter page contains body text');
    assert.ok(logoDrawing.y - Math.max(...body.map(row => row.y + row.size)) >= 30,
      'leave at least 30pt between the logo and referral body on every page');
  }
});

test('security audit captures precise referral actions without medical notes or PDF bytes', async () => {
  const record = await prepareSecurityAudit(new Request('https://example.org/api/staff-departments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, section: 'clinic',
      action: 'previewClinicReferral', Reason: 'PRIVATE_REASON', Treatment: 'PRIVATE_TREATMENT', PdfBase64: 'PRIVATE_PDF' })
  }), '/api/staff-departments');
  assert.match(record.action, /hospital referral PDF/i);
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE_REASON|PRIVATE_TREATMENT|PRIVATE_PDF/);
});

test('web referral workspace uses reviewed snapshots, confirmations, PDF download and no local storage', async () => {
  const ui = await readFile(new URL('../js/clinic-referrals.js', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /key: 'referrals', label: 'Hospital referrals'/);
  assert.match(ui, /window\.DynamaxDialogs\.confirm/);
  assert.match(ui, /ConfirmedParentEmail: saved\.ParentEmail/);
  assert.match(ui, /new Blob\(\[bytes\], \{ type: 'application\/pdf' \}\)/);
  assert.match(ui, /URL\.revokeObjectURL/);
  assert.match(ui, /form\.addEventListener\('input', \(\) => \{ invalidate\(\)/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage/);
});
