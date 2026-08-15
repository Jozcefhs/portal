const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

const DOCUMENT_TYPES = Object.freeze({
  'expense-requisition': Object.freeze({
    collection: 'accountingExpenses',
    referenceFields: Object.freeze(['ExpenseNo'])
  }),
  'material-requisition': Object.freeze({
    collection: 'accountingExpenses',
    referenceFields: Object.freeze(['ExpenseNo'])
  }),
  'imprest-receipt': Object.freeze({
    collection: 'accountingImprests',
    referenceFields: Object.freeze(['ImprestNo']),
    lineCollection: 'RetirementLines',
    urlField: 'ReceiptUrl'
  })
});

export function safeFinanceDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 140);
}

export function financeDocumentDefinition(value) {
  return DOCUMENT_TYPES[lower(value)] || null;
}

export function financeDocumentReferenceMatches(record = {}, definition = null, requestedReference = '') {
  const wanted = lower(requestedReference);
  if (!wanted || !definition) return false;
  return definition.referenceFields.some((field) => lower(record[field]) === wanted)
    || lower(record.__id) === lower(safeFinanceDocumentId(requestedReference));
}

function userDepartment(user = {}) {
  const explicit = clean(user.department);
  if (explicit) return explicit;
  return {
    'Admissions Officer': 'Admissions',
    'Accounts Officer': 'Accounts',
    Management: 'Management',
    'Tuck Shop User': 'Tuck Shop',
    'Clinic User': 'Clinic',
    'Kitchen User': 'Kitchen',
    'Front Desk': 'Front Desk',
    'Super Admin': 'Administration'
  }[clean(user.role)] || '';
}

export function staffCanAccessFinanceDocument(user = {}, record = {}) {
  const userBranch = lower(user.branchId);
  const recordBranch = lower(record.BranchId || 'main');
  if (userBranch && userBranch !== 'all' && userBranch !== recordBranch) return false;

  const userSection = lower(user.schoolSectionAccess || 'all');
  const recordSection = lower(record.SchoolSection || 'secondary');
  if (userSection && userSection !== 'all' && userSection !== recordSection) return false;

  if (['super admin', 'management', 'accounts officer'].includes(lower(user.role))) return true;
  return Boolean(userDepartment(user)) && lower(userDepartment(user)) === lower(record.Department);
}

export function storedFinanceDocumentUrl(record = {}, definition = null, lineIndex = '') {
  if (!definition) return '';
  if (!definition.lineCollection) return clean(record.AttachmentUrl);

  const indexText = clean(lineIndex);
  if (!/^\d+$/.test(indexText)) return '';
  const index = Number(indexText);
  const lines = Array.isArray(record[definition.lineCollection]) ? record[definition.lineCollection] : [];
  if (!Number.isSafeInteger(index) || index < 0 || index >= lines.length) return '';
  return clean(lines[index]?.[definition.urlField]);
}
