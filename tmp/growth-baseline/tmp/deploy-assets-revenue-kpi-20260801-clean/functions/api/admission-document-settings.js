import { getDocument, requireFirestoreEnv } from '../lib/firestore.js';

const DOCUMENTS = [
  { key: 'BirthCertificate', label: 'Birth Certificate', accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' },
  { key: 'PreviousSchoolReport', label: 'Previous School Report', accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' },
  { key: 'PassportPhotograph', label: 'Passport Photograph', accept: '.pdf,.jpg,.jpeg,.png' },
  { key: 'MedicalReport', label: 'Medical Report', accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' },
  { key: 'TransferCertificateDoc', label: 'Transfer Certificate', accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' },
  { key: 'AcceptanceForm', label: 'Acceptance Form', accept: '.pdf,.jpg,.jpeg,.png,.doc,.docx' }
];

export async function onRequestGet({ env }) {
  try {
    requireFirestoreEnv(env);
    const settings = await getDocument(env, 'settings', 'admissionDocuments').catch(() => null);
    const enabled = settings?.Enabled && typeof settings.Enabled === 'object' ? settings.Enabled : {};
    return Response.json({ ok: true, documents: DOCUMENTS.filter((item) => enabled[item.key] !== false) }, {
      headers: { 'Cache-Control': 'public, max-age=60' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error), documents: DOCUMENTS }, { status: 500 });
  }
}
