import { validateAdmissionDocumentFile } from './document-files.js';

const clean = (value) => String(value ?? '').trim();

export function validateAcademicCbtPaper(input = {}) {
  let validated;
  try {
    validated = validateAdmissionDocumentFile({
      fileName: input.FileName || input.fileName,
      fileBase64: input.FileBase64 || input.fileBase64
    });
  } catch (cause) {
    const error = new Error(cause?.message || 'The uploaded CBT question paper is invalid.');
    error.status = /8 MB upload limit/i.test(error.message) ? 413 : 400;
    error.code = 'ACADEMIC_CBT_PAPER_INVALID';
    throw error;
  }
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(validated.mimeType)) {
    const error = new Error('CBT question papers must be PDF, JPG or PNG files.');
    error.status = 400;
    error.code = 'ACADEMIC_CBT_PAPER_INVALID';
    throw error;
  }
  return validated;
}


export async function academicCbtPaperDigest(fileBase64) {
  const encoded = clean(fileBase64);
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
