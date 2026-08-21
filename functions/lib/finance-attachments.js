import { validateAdmissionDocumentFile } from './document-files.js';

const clean = (value) => String(value ?? '').trim();

const ATTACHMENT_TYPES = Object.freeze({
  'expense-requisition': {
    label: 'Expense requisition supporting document',
    filePrefix: 'Expense-Requisition'
  },
  'material-requisition': {
    label: 'Material requisition supporting document',
    filePrefix: 'Material-Requisition'
  },
  'imprest-receipt': {
    label: 'Imprest retirement receipt',
    filePrefix: 'Imprest-Receipt'
  }
});

export function financeAttachmentDefinition(value) {
  return ATTACHMENT_TYPES[clean(value).toLowerCase()] || null;
}

export function validateFinanceAttachment(input = {}) {
  const kind = clean(input.kind).toLowerCase();
  const definition = financeAttachmentDefinition(kind);
  if (!definition) {
    const error = new Error('Choose a valid finance document type.');
    error.status = /exceeds the 8 MB upload limit/i.test(error.message) ? 413 : 400;
    throw error;
  }
  let validated;
  try {
    validated = validateAdmissionDocumentFile({
      fileName: input.fileName,
      fileBase64: input.fileBase64
    });
  } catch (cause) {
    const error = new Error(cause?.message || 'The uploaded finance document is invalid.');
    error.status = 400;
    error.code = 'INVALID_FINANCE_ATTACHMENT';
    throw error;
  }
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(validated.mimeType)) {
    const error = new Error('Finance documents must be PDF, JPG or PNG files.');
    error.status = 400;
    throw error;
  }
  return { kind, definition, ...validated };
}
