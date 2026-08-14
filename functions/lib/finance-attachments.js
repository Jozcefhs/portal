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

function safeReference(value, fallback = 'pending') {
  return clean(value)
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || fallback;
}

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

export function financeAttachmentStoragePayload(input = {}) {
  const definition = financeAttachmentDefinition(input.kind);
  if (!definition) throw new Error('Choose a valid finance document type.');
  const operationId = clean(input.operationId);
  const branchId = safeReference(input.branchId, 'main');
  const recordId = safeReference(input.recordId, 'pending');
  const originalName = clean(input.fileName);
  return {
    Secret: clean(input.secret),
    Action: 'uploadParentDocument',
    StorageOnly: 'YES',
    OperationId: operationId,
    UploadOperationId: operationId,
    StorageOperationId: operationId,
    UploadAttemptId: clean(input.uploadAttemptId),
    ApplicationReference: `FINANCE-${branchId}-${recordId}-${safeReference(operationId, 'upload')}`.slice(0, 220),
    // The existing Apps Script storage action recognises this document slot.
    // StorageOnly prevents admission data from being changed; the finance type
    // remains explicit in the unique file name and in the accounting audit log.
    DocumentType: 'AcceptanceForm',
    FileName: `${definition.filePrefix}-${recordId}-${originalName}`.slice(0, 240),
    MimeType: clean(input.mimeType),
    FileBase64: clean(input.fileBase64),
    ReplaceExisting: 'NO',
    ExistingUrl: ''
  };
}
