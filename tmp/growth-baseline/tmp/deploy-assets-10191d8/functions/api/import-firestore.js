import { requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';

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

function getSecret(env) {
  return clean(env.BACKEND_SHARED_SECRET || env.GOOGLE_APPS_SCRIPT_SECRET);
}

async function readRequestBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return request.json();
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

export async function onRequestPost({ request, env }) {
  try {
    requireFirestoreEnv(env);
    const body = await readRequestBody(request);
    const expectedSecret = getSecret(env);
    const providedSecret = clean(
      body.Secret ||
      body.secret ||
      request.headers.get('x-backend-secret') ||
      request.headers.get('x-import-secret')
    );
    if (expectedSecret && providedSecret !== expectedSecret) {
      return json({ ok: false, message: 'Unauthorized.' }, 401);
    }

    const collection = normalizeCollection(body.collection || body.Collection);
    if (!collection) {
      return json({ ok: false, message: 'Unknown or unsupported collection.' }, 400);
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      return json({ ok: false, message: 'No rows were supplied.' }, 400);
    }

    const dryRun = Boolean(body.dryRun || body.DryRun);
    const imported = [];
    const failures = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = normalizeRow(rows[index]);
      const documentId = documentIdFor(collection, row, index);
      const payload = {
        ...row,
        UpdatedAt: row.UpdatedAt || new Date().toISOString()
      };
      if (dryRun) {
        imported.push({ index, documentId });
        continue;
      }
      try {
        await upsertDocument(env, collection, documentId, payload);
        imported.push({ index, documentId });
      } catch (error) {
        failures.push({ index, documentId, message: error.message || String(error) });
      }
    }

    return json({
      ok: failures.length === 0,
      collection,
      dryRun,
      received: rows.length,
      imported: imported.length,
      failed: failures.length,
      failures: failures.slice(0, 20)
    }, failures.length ? 207 : 200);
  } catch (error) {
    return json({ ok: false, message: error.message || String(error) }, 500);
  }
}

export async function onRequestGet({ env }) {
  try {
    requireFirestoreEnv(env);
    return json({
      ok: true,
      message: 'Firestore import endpoint is ready.',
      collections: Object.values(COLLECTION_ALIASES).filter((value, index, list) => list.indexOf(value) === index)
    });
  } catch (error) {
    return json({ ok: false, message: error.message || String(error) }, 500);
  }
}
