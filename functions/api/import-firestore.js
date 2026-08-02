import { batchUpsertDocuments, requireFirestoreEnv } from '../lib/firestore.js';
import { requireConfiguredDesktopSecret, verifyDesktopSecret } from '../lib/backend-security.js';
import { finishRequestMetric, startRequestMetric } from '../lib/request-metrics.js';
import { readJsonBody } from '../lib/request-security.js';

const MAX_IMPORT_ROWS = 250;
const IMPORT_BATCH_SIZE = 100;
const MAX_IMPORT_BODY_BYTES = 2_000_000;
const MAX_ROW_FIELDS = 200;
const MAX_ROW_CHARACTERS = 100_000;

const COLLECTION_ALIASES = {
  applications: 'applications',
  application: 'applications',
  students: 'students',
  student: 'students',
  feeitems: 'feeItems',
  fees: 'feeItems',
  feesetup: 'feeItems',
  fee_setup: 'feeItems',
  accounts: 'accounts',
  account: 'accounts',
  invoices: 'invoices',
  invoice: 'invoices',
  payments: 'payments',
  payment: 'payments',
  ledger: 'ledger',
  ledgers: 'ledger',
  formsales: 'formSales',
  form_sales: 'formSales',
  admissionformsales: 'formSales',
  admission_form_sales: 'formSales',
  admissionclasses: 'settings/admission/classes',
  admission_classes: 'settings/admission/classes',
  schoolclasses: 'settings/academics/classes',
  school_classes: 'settings/academics/classes',
  clinicrecords: 'clinicRecords',
  clinic_records: 'clinicRecords',
  clinicinventory: 'clinicInventory',
  clinic_inventory: 'clinicInventory',
  clinicmovements: 'clinicMovements',
  clinic_movements: 'clinicMovements',
  kitcheninventory: 'kitchenInventory',
  kitchen_inventory: 'kitchenInventory',
  kitchenmovements: 'kitchenMovements',
  kitchen_movements: 'kitchenMovements',
  restaurantinventory: 'restaurantInventory',
  restaurant_inventory: 'restaurantInventory',
  restaurantmovements: 'restaurantMovements',
  restaurant_movements: 'restaurantMovements',
  organizationcommercesales: 'organizationCommerceSales',
  organisationcommercesales: 'organizationCommerceSales',
  organization_commerce_sales: 'organizationCommerceSales',
  organizationcommercemovements: 'organizationCommerceMovements',
  organisationcommercemovements: 'organizationCommerceMovements',
  organization_commerce_movements: 'organizationCommerceMovements',
  organizationcommerceemaildeliveries: 'organizationCommerceEmailDeliveries',
  organisationcommerceemaildeliveries: 'organizationCommerceEmailDeliveries',
  organization_commerce_email_deliveries: 'organizationCommerceEmailDeliveries',
  auditlogs: 'auditLogs',
  audit_logs: 'auditLogs'
};

const ID_FIELDS = {
  applications: ['ApplicationReference', 'ApplicationID', 'Reference', 'VerificationCode'],
  students: ['AdmissionNo', 'AccountRef', 'StudentID'],
  accounts: ['AccountRef', 'AdmissionNo', 'ApplicationReference'],
  invoices: ['InvoiceId', 'InvoiceID', 'InvoiceNo', 'Reference'],
  payments: ['PaymentId', 'PaymentID', 'Reference', 'TransactionReference'],
  ledger: ['LedgerNo', 'LedgerId', 'LedgerID', 'Reference'],
  formSales: ['ReceiptNo', 'ReceiptNumber', 'Reference', 'VerificationCode'],
  'settings/admission/classes': ['ClassName'],
  'settings/academics/classes': ['ClassName'],
  clinicRecords: ['RecordId', 'RecordID', 'Reference'],
  clinicInventory: ['ItemName', 'ItemCode', 'SKU'],
  clinicMovements: ['MovementNo', 'MovementId', 'MovementID', 'Reference'],
  kitchenInventory: ['ItemName', 'ItemCode', 'SKU'],
  kitchenMovements: ['MovementNo', 'MovementId', 'MovementID', 'Reference'],
  restaurantInventory: ['ItemName', 'ItemCode', 'SKU'],
  restaurantMovements: ['MovementNo', 'MovementId', 'MovementID', 'Reference'],
  organizationCommerceSales: ['SaleNo', 'SaleId', 'Reference', 'PaymentReference'],
  organizationCommerceMovements: ['MovementNo', 'SaleNo', 'Reference'],
  organizationCommerceEmailDeliveries: ['DeliveryId', 'SaleNo'],
  auditLogs: ['LogId', 'LogID', 'Reference']
};

const COMPOSITE_FIELDS = {
  feeItems: ['FeeCode', 'FeeName', 'ClassName', 'StudentType', 'BillingCategory', 'AcademicSession', 'Term']
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeKey(value) {
  return clean(value).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function normalizeCollection(value) {
  const key = normalizeKey(value);
  return COLLECTION_ALIASES[key] || '';
}

function pick(row, keys) {
  for (const key of keys || []) {
    if (row[key] !== undefined && clean(row[key]) !== '') return clean(row[key]);
  }
  return '';
}

function safeDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

function fallbackDocumentId(row, index) {
  const pieces = [
    row.Name,
    row.ApplicantName,
    row.StudentName,
    row.Email,
    row.ParentEmail,
    row.Phone,
    row.CreatedAt,
    row.SubmittedAt,
    index + 1
  ].map(clean).filter(Boolean);
  return `row-${safeDocumentId(pieces.join('-'))}`;
}

function documentIdFor(collection, row, index) {
  const composite = COMPOSITE_FIELDS[collection];
  if (composite) {
    const value = composite.map((field) => pick(row, [field]) || 'All').join('__');
    return safeDocumentId(value);
  }
  const direct = pick(row, ID_FIELDS[collection]);
  return safeDocumentId(direct || fallbackDocumentId(row, index));
}

function normalizeRow(row) {
  const out = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    const cleanKey = clean(key);
    if (cleanKey) out[cleanKey] = typeof value === 'string' ? value.trim() : value;
  });
  return out;
}

async function readRequestBody(request) {
  return readJsonBody(request, { maxBytes: MAX_IMPORT_BODY_BYTES });
}

function validateRow(row, index) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`Row ${index + 1} must be an object.`);
  }
  if (Object.keys(row).length > MAX_ROW_FIELDS) {
    throw new Error(`Row ${index + 1} contains too many fields.`);
  }
  if (JSON.stringify(row).length > MAX_ROW_CHARACTERS) {
    throw new Error(`Row ${index + 1} is too large.`);
  }
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

export async function onRequestPost({ request, env }) {
  const metric = startRequestMetric(request, '/api/import-firestore');
  let received = 0;
  try {
    requireFirestoreEnv(env);
    const body = await readRequestBody(request);
    const providedSecret = clean(
      body.Secret ||
      body.secret ||
      request.headers.get('x-backend-secret') ||
      request.headers.get('x-import-secret')
    );
    verifyDesktopSecret(env, providedSecret, 'database import endpoint');

    const collection = normalizeCollection(body.collection || body.Collection);
    if (!collection) {
      const error = new Error('Unknown or unsupported collection.');
      error.status = 400;
      throw error;
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    received = rows.length;
    if (!rows.length) {
      const error = new Error('No rows were supplied.');
      error.status = 400;
      throw error;
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      const error = new Error(`Import at most ${MAX_IMPORT_ROWS} rows per request. Split this file into smaller batches.`);
      error.status = 413;
      throw error;
    }

    const dryRun = Boolean(body.dryRun || body.DryRun);
    const imported = [];
    const failures = [];
    const writes = [];
    for (let index = 0; index < rows.length; index += 1) {
      try {
        validateRow(rows[index], index);
        const row = normalizeRow(rows[index]);
        const documentId = documentIdFor(collection, row, index);
        if (!documentId) throw new Error('A document identifier could not be generated.');
        const payload = {
          ...row,
          UpdatedAt: row.UpdatedAt || new Date().toISOString()
        };
        if (dryRun) imported.push({ index, documentId });
        else writes.push({ index, documentId, collectionPath: collection, data: payload });
      } catch (error) {
        failures.push({ index, documentId: '', message: error.message || 'The row is invalid.' });
      }
    }

    if (!dryRun) {
      for (const group of chunk(writes, IMPORT_BATCH_SIZE)) {
        try {
          await batchUpsertDocuments(env, group);
          group.forEach(({ index, documentId }) => imported.push({ index, documentId }));
        } catch (error) {
          console.error('Database import batch failed', {
            collection,
            firstRow: group[0]?.index,
            count: group.length,
            status: Number(error?.status || 500)
          });
          group.forEach(({ index, documentId }) => failures.push({
            index,
            documentId,
            message: 'This import batch could not be saved. Correct the data or retry this batch.'
          }));
        }
      }
    }

    const status = failures.length ? 207 : 200;
    finishRequestMetric(metric, {
      status,
      action: dryRun ? 'dry-run' : `import:${collection}`,
      received: rows.length,
      processed: imported.length,
      outcome: failures.length ? 'partial' : 'ok'
    });
    return json({
      ok: failures.length === 0,
      collection,
      dryRun,
      received: rows.length,
      imported: imported.length,
      failed: failures.length,
      batchSize: IMPORT_BATCH_SIZE,
      limits: { maxRows: MAX_IMPORT_ROWS, maxBodyBytes: MAX_IMPORT_BODY_BYTES },
      failures: failures.sort((left, right) => left.index - right.index).slice(0, 20)
    }, status);
  } catch (error) {
    const status = Number(error?.status || 500);
    finishRequestMetric(metric, { status, action: 'import', received, outcome: error?.code || 'error' });
    return json({ ok: false, message: error.message || String(error), ...(error?.code ? { code: error.code } : {}) }, status);
  }
}

export async function onRequestGet({ request, env }) {
  const metric = startRequestMetric(request, '/api/import-firestore');
  try {
    requireFirestoreEnv(env);
    requireConfiguredDesktopSecret(env, 'database import endpoint');
    finishRequestMetric(metric, { status: 200, action: 'readiness' });
    return json({
      ok: true,
      message: 'Database import endpoint is ready.',
      collections: Object.values(COLLECTION_ALIASES).filter((value, index, list) => list.indexOf(value) === index),
      limits: { maxRows: MAX_IMPORT_ROWS, batchSize: IMPORT_BATCH_SIZE, maxBodyBytes: MAX_IMPORT_BODY_BYTES }
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    finishRequestMetric(metric, { status, action: 'readiness', outcome: error?.code || 'error' });
    return json({ ok: false, message: error.message || String(error), ...(error?.code ? { code: error.code } : {}) }, status);
  }
}
