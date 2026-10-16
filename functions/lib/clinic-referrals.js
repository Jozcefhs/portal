import { getDocument, listCollection, queryCollection, createDocumentIfAbsent, updateDocumentIfCurrent, batchCommitLiteralDocuments } from './firestore.js';
import { getDocumentBranding, documentBrandingMatchesDeployment } from './document-branding.js';
import { effectiveBranchProfile } from './branch-profile-settings.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { schoolSectionFor } from './school-scope.js';
import { isActiveClinicVisit } from './clinic-stock-usage.js';
import { sendConfiguredEmail, escapeEmailHtml } from './email-service.js';
import { createClinicReferralPdf } from './clinic-referral-pdf.js';
import { loadStaffApprovalProfile, validateApprovalImage } from './staff-approval-profile.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const ref = value => lower(value).replace(/[^a-z0-9]/g, '');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const plain = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
const collection = 'clinicReferrals';
const studentRef = row => clean(row.AdmissionNo || row.AccountRef || row.ApplicationReference || row.Reference);

export function clinicParentEmail(student) {
  return [student.ParentEmail, student.VerificationEmail, student.FatherEmail, student.MotherEmail, student.GuardianEmail]
    .map(lower).find(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || '';
}

export function normalizeClinicReferral(input) {
  const fields = {};
  for (const [key, maximum] of Object.entries({ Hospital: 180, Reason: 1800, Observations: 2400,
    Treatment: 2400, Instructions: 1800, ClinicianTitle: 100, ClinicContact: 160, ReferralDate: 10 })) {
    fields[key] = clean(input[key]);
    if (fields[key].length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(fields[key])) {
      throw fail(`${key}: use at most ${maximum} characters without control characters.`);
    }
  }
  if (!fields.Hospital || !fields.Reason || !fields.ClinicianTitle) throw fail('Enter the receiving hospital, referral reason and clinic staff role.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.ReferralDate) || !Number.isFinite(Date.parse(fields.ReferralDate))
    || new Date(fields.ReferralDate).toISOString().slice(0, 10) !== fields.ReferralDate) throw fail('Choose a valid referral date.');
  return fields;
}

function sameScope(row, student) {
  return lower(row.BranchId || 'main') === lower(student.BranchId || 'main')
    && schoolSectionFor(row) === schoolSectionFor(student)
    && (!row.OrganisationEdition || lower(row.OrganisationEdition) === 'school');
}
function summary(row) {
  return { ...Object.fromEntries(['ReferralId', 'ReferralDate', 'VisitId', 'VisitDate', 'StudentName', 'AccountRef', 'ClassName',
    'ParentEmail', 'Hospital', 'Status', 'PreparedBy', 'CreatedAt', 'SentAt', 'FileName'].map(key => [key, row[key] || ''])),
    SignatureApplied: row.SignatureApplied === true };
}
function documentResult(row) {
  return { ...summary(row), PdfBase64: row.PdfBase64 };
}
async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// Dependency injection keeps tests entirely offline: no real patients or email deliveries.
export function clinicReferralService(overrides = {}) {
  const db = { getDocument, listCollection, queryCollection, createDocumentIfAbsent, updateDocumentIfCurrent,
    batchCommitLiteralDocuments, getDocumentBranding, documentBrandingMatchesDeployment,
    effectiveBranchProfile, requiredDeploymentIdentity, sendConfiguredEmail, createClinicReferralPdf, loadStaffApprovalProfile, ...overrides };
  return async function handle(env, user, body, findStudent) {
    const identity = db.requiredDeploymentIdentity(env);
    if (identity.edition !== 'school' || lower(user.edition || 'school') !== 'school'
      || !(user.allowedSections || []).includes('clinic') || !clean(user.username)) throw fail('Clinic access is required.', 403);
    const action = lower(body.action);
    if (['previewclinicreferral', 'sendclinicreferral'].includes(action)
      && (user.subscriptionReadOnly === true || user.subscriptionActive === false)) throw fail('Clinic letters are read-only until the subscription is renewed.', 403);
    const resolveStudent = async account => {
      const student = await findStudent(account);
      if (!student) throw fail('Student not found in your permitted branch and school section.', 404);
      return student;
    };
    const visitFor = async (id, student) => {
      if (!/^[A-Za-z0-9_.-]{1,140}$/.test(clean(id)) || ['.', '..'].includes(id)) throw fail('Select a saved clinic visit.');
      const visit = await db.getDocument(env, 'clinicRecords', id);
      if (!visit || !sameScope(visit, student) || !ref(visit.AdmissionNo || visit.AccountRef)
        || ref(visit.AdmissionNo || visit.AccountRef) !== ref(studentRef(student))) throw fail('This clinic visit is not available for this student.', 404);
      if (!isActiveClinicVisit(visit)) throw fail('A cancelled clinic visit cannot be used for a hospital referral.', 409);
      return visit;
    };
    if (action === 'prepareclinicreferral') {
      const student = await resolveStudent(body.AccountRef);
      const [visits, letters] = await Promise.all([db.listCollection(env, 'clinicRecords'), db.queryCollection(env, collection, {
        filters: [{ field: 'AccountRef', op: '==', value: studentRef(student) }],
        select: ['WorkspaceId', 'OrganisationEdition', 'BranchId', 'SchoolSection', 'ReferralId', 'ReferralDate', 'VisitId', 'VisitDate',
          'StudentName', 'AccountRef', 'ClassName', 'ParentEmail', 'Hospital', 'Status', 'PreparedBy', 'CreatedAt', 'SentAt', 'FileName', 'SignatureApplied']
      })]);
      return { ok: true, student: { AccountRef: studentRef(student), StudentName: clean(student.DisplayName || student.StudentName || student.ApplicantName),
        ClassName: clean(student.ClassName || student.ClassAdmitted), ParentEmail: clinicParentEmail(student) },
      visits: visits.filter(row => sameScope(row, student) && isActiveClinicVisit(row)
        && ref(row.AdmissionNo || row.AccountRef) === ref(studentRef(student)))
        .sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)))
        .map(row => ({ VisitId: row.__id || row.RecordId, Date: row.Date, Complaint: row.Complaint, Treatment: row.Treatment, Disposition: row.Disposition })),
      referrals: letters.filter(row => row.WorkspaceId === identity.workspaceId && sameScope(row, student)
        && ref(row.AccountRef) === ref(studentRef(student))).map(summary).sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt)),
      message: 'Choose the clinic visit, then review the referral details.' };
    }
    if (action === 'previewclinicreferral') {
      const fields = normalizeClinicReferral(body);
      const student = await resolveStudent(body.AccountRef);
      const visit = await visitFor(body.VisitId, student);
      // Resolve only the authenticated officer's signature, never a submitted
      // username/image or the school's principal/admissions signature.
      const approval = await db.loadStaffApprovalProfile(env, user.username);
      const signatureDataUrl = validateApprovalImage(approval?.SignatureDataUrl, 'Your saved signature');
      if (signatureDataUrl && !/^data:image\/(?:png|jpe?g);base64,/i.test(signatureDataUrl)) {
        throw fail('Your saved signature needs a PDF-compatible copy. Open My signature settings and click Save user settings, then generate the referral again.');
      }
      const snapshot = { ...fields, PdfTemplateVersion: 2,
        SignatureApplied: Boolean(signatureDataUrl), SignatureFingerprint: signatureDataUrl ? await digest(signatureDataUrl) : '',
        WorkspaceId: identity.workspaceId, OrganisationEdition: 'school',
        BranchId: clean(student.BranchId) || 'main', SchoolSection: schoolSectionFor(student),
        AccountRef: studentRef(student), StudentName: clean(student.DisplayName || student.StudentName || student.ApplicantName),
        ClassName: clean(student.ClassName || student.ClassAdmitted), ParentEmail: clinicParentEmail(student),
        VisitId: body.VisitId, VisitDate: clean(visit.Date), VisitVersion: clean(visit.__updateTime || visit.UpdatedAt),
        PreparedBy: clean(user.displayName || user.username), PreparedByUsername: lower(user.username) };
      const id = `REF-${(await digest(snapshot)).slice(0, 32)}`;
      const existing = await db.getDocument(env, collection, id);
      if (existing) return { ok: true, referral: documentResult(existing), message: 'Existing referral PDF loaded. No email was sent.' };
      const [defaults, branding] = await Promise.all([db.getDocument(env, 'settings', 'schoolProfile'), db.getDocumentBranding(env)]);
      const profile = await db.effectiveBranchProfile(env, defaults || {}, snapshot.BranchId);
      const validBranding = db.documentBrandingMatchesDeployment(env, branding) ? branding : {};
      const row = { ...snapshot, ReferralId: id, Status: 'Draft', CreatedAt: new Date().toISOString(), FileName: `${id}.pdf` };
      row.PdfBase64 = base64(await db.createClinicReferralPdf({ ...profile, DocumentLogoDataUrl: validBranding?.DocumentLogoDataUrl || '',
        DocumentSignatureDataUrl: '' }, row, { signatureDataUrl }));
      // The immutable PDF and letter fit safely inside a single Firestore document.
      if (row.PdfBase64.length > 700000) throw fail('The PDF is too large to retain and email. Reduce the configured document logo size and preview again.');
      const saved = await db.createDocumentIfAbsent(env, collection, id, row);
      return { ok: true, referral: documentResult(saved.document || row), message: 'Referral PDF saved for review. No email was sent.' };
    }
    if (!['loadclinicreferral', 'sendclinicreferral'].includes(action)) throw fail('Choose a valid clinic referral action.');
    const id = clean(body.ReferralId);
    if (!/^REF-[a-f0-9]{32}$/.test(id)) throw fail('Choose a saved referral letter.');
    const row = await db.getDocument(env, collection, id);
    if (!row || row.WorkspaceId !== identity.workspaceId || row.OrganisationEdition !== 'school') throw fail('Referral letter not found.', 404);
    const student = await resolveStudent(row.AccountRef);
    if (!sameScope(row, student)) throw fail('The referral belongs to a different branch or school section.', 403);
    if (action === 'loadclinicreferral') return { ok: true, referral: documentResult(row), message: 'Saved referral loaded.' };
    if (body.ConfirmSend !== true) throw fail('Review the PDF and confirm the parent recipient before sending.');
    if (row.Status === 'Sent') return { ok: true, referral: documentResult(row), message: 'This referral was already accepted by the email provider. It has not been sent again.' };
    if (!['Draft', 'Failed'].includes(row.Status)) throw fail('Delivery is in progress or its outcome is uncertain. Check the provider log before any further sending; automatic resend is blocked.', 409);
    if (!row.ParentEmail || row.ParentEmail !== clinicParentEmail(student) || lower(body.ConfirmedParentEmail) !== row.ParentEmail) {
      throw fail('The saved parent email is missing or changed. Find the student and preview a new letter before sending.', 409);
    }
    const visit = await visitFor(row.VisitId, student);
    if (clean(visit.__updateTime || visit.UpdatedAt) !== row.VisitVersion) throw fail('The clinic visit has changed. Prepare and review a new referral before sending.', 409);
    if (!row.PdfBase64 || row.PdfBase64.length > 700000) throw fail('The saved PDF is unavailable. Nothing was sent.', 409);
    // A persistent compare-and-swap claim blocks concurrent sends across browsers/staff.
    await db.updateDocumentIfCurrent(env, collection, id, { ...plain(row), Status: 'Sending', SendStartedAt: new Date().toISOString() }, row);
    let claimed = await db.getDocument(env, collection, id);
    let delivery;
    try {
      const text = `Dear Parent / Guardian,\n\nPlease find attached the clinic hospital referral letter for ${row.StudentName}. Please read the letter and contact the clinic regarding the arrangements for further medical attention.\n\nReference: ${row.ReferralId}\n\nClinic department`;
      delivery = await db.sendConfiguredEmail(env, { toEmail: row.ParentEmail, toName: `Parent / Guardian of ${row.StudentName}`,
        subject: `Clinic hospital referral - ${row.AccountRef}`, textContent: text,
        htmlContent: `<div style="font-family:Arial,sans-serif;white-space:pre-line">${escapeEmailHtml(text)}</div>`,
        attachments: [{ name: row.FileName, content: row.PdfBase64 }], requireAttachments: true, branchId: row.BranchId });
      if (!delivery?.ok || delivery.attachmentFallback) throw fail('The provider did not confirm acceptance of the email with its PDF attachment.', 503);
    } catch (error) {
      const status = error.retrySafe === true ? 'Failed' : 'Uncertain';
      await db.updateDocumentIfCurrent(env, collection, id, { ...plain(claimed), Status: status, LastFailureCode: clean(error.code) || 'EMAIL_NOT_CONFIRMED' }, claimed);
      throw fail(status === 'Failed' ? `${error.message} The referral remains available for review and retry.`
        : 'Email acceptance could not be confirmed. Check the provider log; resend is blocked to prevent duplicate letters.', error.status || 503);
    }
    const sent = { ...plain(claimed), Status: 'Sent', SentAt: new Date().toISOString(), SentBy: clean(user.displayName || user.username),
      Provider: clean(delivery.provider), ProviderMessageId: clean(delivery.providerMessageId) };
    try {
      await db.batchCommitLiteralDocuments(env, [
        { collectionPath: collection, documentId: id, data: sent, updateTime: claimed.__updateTime },
        { collectionPath: 'departmentMessages', documentId: id, exists: false, data: {
          MessageId: id, Type: 'Clinic hospital referral', Department: 'Clinic', BranchId: row.BranchId,
          SchoolSection: row.SchoolSection, OrganisationEdition: 'school', AccountRef: row.AccountRef,
          RecipientEmail: row.ParentEmail, SentAt: sent.SentAt, SentBy: sent.SentBy,
          ReferralId: id, ProviderMessageId: sent.ProviderMessageId, Status: 'Accepted by email provider' } }
      ]);
    } catch {
      throw fail('The provider accepted the referral email, but the local delivery record could not be confirmed. Do not resend; check the provider log.', 503);
    }
    return { ok: true, referral: documentResult(sent), message: `Referral PDF accepted by the email provider for ${row.ParentEmail}. This is not confirmation that it has been read or that the student reached hospital.` };
  };
}

export const handleClinicReferral = clinicReferralService();
