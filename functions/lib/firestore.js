const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
let cachedToken = null;

const DEFAULT_LIST_PAGE_SIZE = 1000;
const MAX_LIST_PAGE_SIZE = 1000;
// Complete-list consumers (catalogues, validation and reports) must never get
// just the first five pages. Interactive histories use listCollectionPage.
const MAX_COMPLETE_LIST_BYTES = 16 * 1024 * 1024;
const MAX_COMPLETE_LIST_ROWS = 100000;

function clean(value) {
  return String(value ?? '').trim();
}

function firestoreEnvironmentKey(env) {
  return `${clean(env.FIREBASE_PROJECT_ID)}|${clean(env.FIREBASE_CLIENT_EMAIL)}`;
}

function firestoreErrorStatus(data, responseStatus) {
  const detail = Array.isArray(data) ? data.find(row => row?.error) : data;
  const upstreamCode = clean(detail?.error?.status).toUpperCase();
  if (upstreamCode === 'RESOURCE_EXHAUSTED') {
    return {
      status: 429,
      code: 'FIRESTORE_QUOTA_EXHAUSTED',
      upstreamCode
    };
  }
  if (['FAILED_PRECONDITION', 'ABORTED', 'ALREADY_EXISTS'].includes(upstreamCode)) {
    return {
      status: 409,
      code: 'FIRESTORE_WRITE_CONFLICT',
      upstreamCode
    };
  }
  return { status: Number(responseStatus || 500), code: '', upstreamCode };
}

function base64Url(input) {
  let bytes;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const clean = String(pem || '')
    .replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function signJwt(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: FIRESTORE_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(signature)}`;
}

export function requireFirestoreEnv(env) {
  const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
    .filter((key) => !String(env[key] || '').trim());
  if (missing.length) {
    throw new Error(`Database is not configured. Missing: ${missing.join(', ')}`);
  }
}

export async function getFirestoreAccessToken(env) {
  requireFirestoreEnv(env);
  const now = Date.now();
  const environmentKey = firestoreEnvironmentKey(env);
  if (cachedToken && cachedToken.environmentKey === environmentKey && cachedToken.expiresAt > now + 60000) {
    return cachedToken.accessToken;
  }
  const assertion = await signJwt(env);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'Could not obtain the database access token.');
  }
  cachedToken = {
    environmentKey,
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
  };
  return cachedToken.accessToken;
}

export function firestoreBaseUrl(env) {
  requireFirestoreEnv(env);
  const projectId = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

export function firestoreDatabaseUrl(env) {
  requireFirestoreEnv(env);
  const projectId = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;
}

export async function listRootCollectionIds(env, options = {}) {
  const token = await getFirestoreAccessToken(env);
  const requestedSize = Number(options.pageSize || 100);
  const pageSize = Math.min(1000, Math.max(1, Number.isFinite(requestedSize) ? Math.floor(requestedSize) : 100));
  const collectionIds = [];
  let pageToken = clean(options.pageToken);
  for (let page = 0; page < 100; page += 1) {
    const response = await fetch(`${firestoreDatabaseUrl(env)}/documents:listCollectionIds`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageSize, ...(pageToken ? { pageToken } : {}) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || `Database collection discovery failed (${response.status})`);
      const normalized = firestoreErrorStatus(data, response.status);
      error.status = normalized.status;
      error.code = normalized.code;
      error.upstreamCode = normalized.upstreamCode;
      throw error;
    }
    collectionIds.push(...(Array.isArray(data.collectionIds) ? data.collectionIds.map(clean).filter(Boolean) : []));
    pageToken = clean(data.nextPageToken);
    if (!pageToken) return [...new Set(collectionIds)].sort((a, b) => a.localeCompare(b));
  }
  const error = new Error('Database collection discovery exceeded the safe pagination limit.');
  error.status = 413;
  error.code = 'FIRESTORE_COLLECTION_DISCOVERY_LIMIT';
  throw error;
}

export async function firestoreRequest(env, path, options = {}) {
  const token = await getFirestoreAccessToken(env);
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const response = await fetch(`${firestoreBaseUrl(env)}/${cleanPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let data;
  try {
    data = await response.json();
  } catch {
    // A truncated/oversized successful read is not an empty database. In
    // particular, callers must not prepare new score writes from missing data.
    const error = new Error('The database response could not be read completely. Retry the request; no empty result was substituted.');
    error.status = response.ok ? 502 : response.status;
    error.code = 'FIRESTORE_RESPONSE_INVALID';
    throw error;
  }
  if (!response.ok) {
    const detail = Array.isArray(data) ? data.find(row => row?.error) : data;
    const message = detail?.error?.message || `Database request failed (${response.status})`;
    const error = new Error(message);
    const normalized = firestoreErrorStatus(data, response.status);
    error.status = normalized.status;
    error.code = normalized.code;
    error.upstreamCode = normalized.upstreamCode;
    error.data = data;
    throw error;
  }
  return data;
}

function cleanImportValue(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value.trim() : value;
}

function looksNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  const text = String(value ?? '').trim();
  return /^-?\d+(\.\d+)?$/.test(text);
}

// Account mappings are identifiers, while *Cents fields are monetary minor units.
// Keep these explicit: the legacy substring rule also matches the "id" in PaidCents.
function isAccountCodeField(key) { return /account$/i.test(String(key || '')); }
function isMinorUnitsField(key) { return /cents$/i.test(String(key || '')); }

function shouldKeepString(key, value) {
  const name = String(key || '').toLowerCase();
  const text = String(value ?? '').trim();
  if (!text) return true;
  if (isAccountCodeField(key)) return true;
  if (isMinorUnitsField(key)) return false;
  if (/^0\d+/.test(text)) return true;
  return [
    'phone',
    'mobile',
    'email',
    'code',
    'reference',
    'receipt',
    'admission',
    'application',
    'class',
    'term',
    'session',
    'id',
    'no',
    'number',
    'name',
    'status',
    'type',
    'category'
  ].some((part) => name.includes(part));
}

export function toFirestoreValue(value, key = '') {
  const cleaned = cleanImportValue(value);
  if (cleaned === '') return { stringValue: '' };
  if (typeof cleaned === 'boolean') return { booleanValue: cleaned };
  if (cleaned instanceof Date && !Number.isNaN(cleaned.getTime())) {
    return { timestampValue: cleaned.toISOString() };
  }
  if (Array.isArray(cleaned)) {
    // IN/array queries must use the same field type as scalar reads and writes.
    // Dropping the key turns numeric-looking references into rounded numbers
    // (or an invalid INT64), and can miss an existing financial posting.
    return { arrayValue: { values: cleaned.map((item) => toFirestoreValue(item, key)) } };
  }
  if (typeof cleaned === 'object') {
    return { mapValue: { fields: objectToFirestoreFields(cleaned) } };
  }
  if (!shouldKeepString(key, cleaned) && looksNumeric(cleaned)) {
    const number = Number(String(cleaned).replace(/,/g, ''));
    if (Number.isInteger(number)) return { integerValue: String(number) };
    return { doubleValue: number };
  }
  return { stringValue: String(cleaned) };
}

export function objectToFirestoreFields(data) {
  const fields = {};
  Object.entries(data || {}).forEach(([key, value]) => {
    if (key && !String(key).startsWith('__')) {
      fields[key] = toFirestoreValue(value, key);
    }
  });
  return fields;
}

function appendWritePrecondition(params, options = {}) {
  const precondition = options.currentDocument || options.precondition || {};
  const updateTime = clean(options.updateTime || precondition.updateTime);
  const hasExists = options.exists !== undefined || precondition.exists !== undefined;
  if (updateTime) params.set('currentDocument.updateTime', updateTime);
  else if (hasExists) params.set('currentDocument.exists', String(Boolean(options.exists ?? precondition.exists)));
}

function documentWritePath(collectionPath, documentId, options = {}) {
  const cleanCollection = String(collectionPath || '').replace(/^\/+|\/+$/g, '');
  const encodedId = encodeURIComponent(String(documentId || '').trim());
  if (!cleanCollection) throw new Error('Collection path is required.');
  if (!encodedId) throw new Error('Document ID is required.');
  const params = new URLSearchParams();
  appendWritePrecondition(params, options);
  const query = params.toString();
  return `${cleanCollection}/${encodedId}${query ? `?${query}` : ''}`;
}

export async function upsertDocument(env, collectionPath, documentId, data, options = {}) {
  return firestoreRequest(env, documentWritePath(collectionPath, documentId, options), {
    method: 'PATCH',
    body: JSON.stringify({ fields: objectToFirestoreFields(data) })
  });
}

export async function patchDocumentFields(env, collectionPath, documentId, data, options = {}) {
  const fields = objectToFirestoreFields(data);
  const fieldPaths = Object.keys(fields);
  if (!fieldPaths.length) throw new Error('At least one document field is required.');
  const cleanCollection = String(collectionPath || '').replace(/^\/+|\/+$/g, '');
  const encodedId = encodeURIComponent(String(documentId || '').trim());
  if (!cleanCollection) throw new Error('Collection path is required.');
  if (!encodedId) throw new Error('Document ID is required.');
  const params = new URLSearchParams();
  fieldPaths.forEach((fieldPath) => params.append('updateMask.fieldPaths', fieldPath));
  appendWritePrecondition(params, options);
  return firestoreRequest(env, `${cleanCollection}/${encodedId}?${params.toString()}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
}

function collectionQueryLocation(collectionPath) {
  const cleanPath = String(collectionPath || '').replace(/^\/+|\/+$/g, '');
  const parts = cleanPath.split('/').filter(Boolean);
  if (!parts.length || parts.length % 2 === 0) throw new Error('A database collection path is required.');
  return {
    collectionId: parts.pop(),
    parentPath: parts.join('/')
  };
}

function structuredFieldFilter(filter = {}) {
  const opMap = {
    '==': 'EQUAL',
    '=': 'EQUAL',
    '!=': 'NOT_EQUAL',
    '<': 'LESS_THAN',
    '<=': 'LESS_THAN_OR_EQUAL',
    '>': 'GREATER_THAN',
    '>=': 'GREATER_THAN_OR_EQUAL',
    in: 'IN',
    'not-in': 'NOT_IN',
    'array-contains': 'ARRAY_CONTAINS',
    'array-contains-any': 'ARRAY_CONTAINS_ANY'
  };
  const field = String(filter.field || filter.fieldPath || '').trim();
  const op = opMap[String(filter.op || '==').trim().toLowerCase()];
  if (!field || !op) throw new Error('A supported database query field and operator are required.');
  return {
    fieldFilter: {
      field: { fieldPath: field },
      op,
      value: toFirestoreValue(filter.value, field)
    }
  };
}

export function buildStructuredQuery(collectionPath, options = {}) {
  const location = collectionQueryLocation(collectionPath);
  const filters = Array.isArray(options.filters) ? options.filters.filter(Boolean) : [];
  const orderBy = Array.isArray(options.orderBy) ? options.orderBy.filter(Boolean) : [];
  const select = Array.isArray(options.select) ? options.select.map((field) => String(field || '').trim()).filter(Boolean) : [];
  const structuredQuery = {
    from: [{ collectionId: location.collectionId }]
  };
  if (select.length) structuredQuery.select = { fields: select.map((fieldPath) => ({ fieldPath })) };
  if (filters.length === 1) {
    structuredQuery.where = structuredFieldFilter(filters[0]);
  } else if (filters.length > 1) {
    structuredQuery.where = {
      compositeFilter: {
        op: String(options.filterJoin || 'AND').trim().toUpperCase() === 'OR' ? 'OR' : 'AND',
        filters: filters.map(structuredFieldFilter)
      }
    };
  }
  if (orderBy.length) {
    structuredQuery.orderBy = orderBy.map((item) => ({
      field: { fieldPath: String(item.field || item.fieldPath || '').trim() },
      direction: String(item.direction || 'ASCENDING').toUpperCase() === 'DESCENDING' ? 'DESCENDING' : 'ASCENDING'
    })).filter((item) => item.field.fieldPath);
  }
  const startAfterName = String(options.startAfterName || '').trim();
  if (startAfterName) {
    const orderedFields = (structuredQuery.orderBy || []).map((item) => item.field.fieldPath);
    if (orderedFields.at(-1) !== '__name__' || orderedFields.length > 2) {
      throw new Error('A document cursor requires ordering by __name__.');
    }
    const values = orderedFields.length === 2
      ? [toFirestoreValue(options.startAfterFieldValue, orderedFields[0])]
      : [];
    structuredQuery.startAt = { values: [...values, { referenceValue: startAfterName }], before: false };
  }
  const limit = Number(options.limit || 0);
  if (Number.isInteger(limit) && limit > 0) structuredQuery.limit = limit;
  const endpoint = location.parentPath ? `${location.parentPath}:runQuery` : ':runQuery';
  return { endpoint, structuredQuery };
}

// Aggregations return a scalar and snapshot, never document bodies. Reject an
// incomplete response instead of turning a failed read into an empty count.
export async function countCollection(env, collectionPath, options = {}) {
  const { endpoint, structuredQuery } = buildStructuredQuery(collectionPath, options);
  const rows = await firestoreRequest(env, endpoint.replace(':runQuery', ':runAggregationQuery'), {
    method: 'POST', body: JSON.stringify({
      structuredAggregationQuery: { structuredQuery, aggregations: [{ alias: 'total', count: {} }] },
      ...(options.readTime ? { readTime: options.readTime } : {})
    })
  });
  const results = Array.isArray(rows) ? rows.filter(row => row?.result) : [];
  const upstream = Array.isArray(rows) ? rows.find(row => row?.error) : rows;
  const value = results[0]?.result?.aggregateFields?.total?.integerValue;
  const count = Number(value);
  const readTime = results[0]?.readTime || options.readTime;
  if (upstream?.error || results.length !== 1 || !/^\d+$/.test(String(value))
    || !Number.isSafeInteger(count) || !readTime || !Number.isFinite(Date.parse(readTime))) {
    const error = new Error(upstream?.error?.message || 'The database count response was incomplete. Retry loading the workspace.');
    error.status = 502; error.code = 'FIRESTORE_COUNT_RESPONSE_INVALID'; throw error;
  }
  return { count, readTime };
}

export async function queryCollection(env, collectionPath, options = {}) {
  const { endpoint, structuredQuery } = buildStructuredQuery(collectionPath, options);
  const rows = await firestoreRequest(env, endpoint, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery, ...(options.readTime ? { readTime: options.readTime } : {}) })
  });
  const upstreamError = Array.isArray(rows) ? rows.find(row => row?.error) : rows;
  if (!Array.isArray(rows) || upstreamError?.error) {
    const normalized = firestoreErrorStatus(upstreamError, 502);
    const error = new Error(upstreamError?.error?.message || 'The database query response was incomplete. No partial records were returned.');
    error.status = normalized.status;
    error.code = normalized.code || 'FIRESTORE_QUERY_RESPONSE_INVALID';
    throw error;
  }
  return rows
    .map((row) => row && row.document)
    .filter(Boolean)
    .map(firestoreDocumentToObject);
}

// Query only the requested indexed slice. Never silently return partial finance totals.
export async function queryCollectionPages(env, collectionPath, options = {}) {
  const pageSize = Math.max(1, Math.min(1000, Math.floor(Number(options.pageSize) || 500)));
  const maxRows = Math.max(pageSize, Math.floor(Number(options.maxRows) || 10000));
  const rows = [];
  let startAfterName = '';
  let startAfterFieldValue;
  const cursorField = String(options.cursorField || '').trim();
  const orderBy = cursorField ? [{ field: cursorField }, { field: '__name__' }] : [{ field: '__name__' }];
  while (true) {
    const limit = Math.min(pageSize, maxRows - rows.length + 1);
    const page = await queryCollection(env, collectionPath, {
      ...options,
      orderBy,
      limit,
      ...(startAfterName ? { startAfterName, startAfterFieldValue } : {})
    });
    rows.push(...page);
    if (rows.length > maxRows) {
      const error = new Error(`The selected ${collectionPath} period is too large for one report. Choose a shorter date range; no partial totals were shown.`);
      error.status = 413;
      error.code = 'FIRESTORE_QUERY_REPORT_LIMIT';
      throw error;
    }
    if (page.length < limit) return rows;
    const nextName = String(page.at(-1)?.__name || '').trim();
    if (!nextName || nextName === startAfterName) throw new Error(`The database cursor stalled for "${collectionPath}".`);
    startAfterName = nextName;
    if (cursorField) startAfterFieldValue = page.at(-1)[cursorField];
  }
}

export async function findOneByField(env, collectionPath, field, value) {
  const rows = await queryCollection(env, collectionPath, {
    filters: [{ field, op: '==', value }],
    limit: 1
  });
  return rows[0] || null;
}

export async function createDocumentIfAbsent(env, collectionPath, documentId, data) {
  const location = collectionQueryLocation(collectionPath);
  const id = String(documentId || '').trim();
  if (!id) throw new Error('Document ID is required.');
  const prefix = location.parentPath ? `${location.parentPath}/` : '';
  try {
    const document = await firestoreRequest(env, `${prefix}${location.collectionId}?documentId=${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ fields: objectToFirestoreFields(data) })
    });
    return { created: true, document: firestoreDocumentToObject(document) };
  } catch (error) {
    if (error && (error.upstreamCode === 'ALREADY_EXISTS' ||
      (!error.upstreamCode && [409, 412].includes(Number(error.status))))) {
      return { created: false, document: await getDocument(env, collectionPath, id) };
    }
    throw error;
  }
}

function batchWritePrecondition(item = {}) {
  const precondition = item.currentDocument || item.precondition || {};
  const updateTime = clean(item.updateTime || precondition.updateTime);
  const hasExists = item.exists !== undefined || precondition.exists !== undefined;
  if (updateTime) return { updateTime };
  if (hasExists) return { exists: Boolean(item.exists ?? precondition.exists) };
  return null;
}

export async function batchCommitDocuments(env, writes, options = {}) {
  const items = Array.isArray(writes) ? writes : [];
  if (!items.length) return { writeResults: [] };
  // Firestore removed its 500-write Commit limit in March 2023. Opt in only
  // for workflows that need one atomic reservation; never split money writes.
  if (items.length > 500 && options.allowLargeAtomicBatch !== true) throw new Error('A database batch may contain at most 500 writes.');
  const token = await getFirestoreAccessToken(env);
  const base = firestoreBaseUrl(env);
  // Firestore commit write names are resource names (projects/.../documents/...),
  // not REST URLs. Supplying the full https URL triggers "lacks projects at index 0".
  const resourceBase = base.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, '');
  const body = {
    ...(options.transaction ? { transaction: options.transaction } : {}),
    writes: items.map((item) => {
      const collection = String(item.collectionPath || '').replace(/^\/+|\/+$/g, '');
      const documentId = String(item.documentId || '').trim();
      // Keep legacy callers' persisted IDs stable. New/compatible storage uses
      // literal resource IDs: URL encoding belongs only in the HTTP URL.
      const literalDocumentId = options.literalDocumentIds === true || item.literalDocumentId === true;
      const id = literalDocumentId ? documentId : encodeURIComponent(documentId);
      if (!collection || !id) throw new Error('Every batch write requires a collection path and document ID.');
      if (literalDocumentId && (id.includes('/') || id === '.' || id === '..')) {
        throw new Error('A literal batch document ID must be a single document path segment.');
      }
      const resourceName = `${resourceBase}/${collection}/${id}`;
      const operation = clean(item.operation || item.type).toLowerCase();
      const write = operation === 'delete' || item.delete === true
        ? { delete: resourceName }
        : {
            update: {
              name: resourceName,
              fields: objectToFirestoreFields(item.data || {})
            }
          };
      const precondition = batchWritePrecondition(item);
      if (precondition) write.currentDocument = precondition;
      if (Array.isArray(item.updateMask) && write.update) write.updateMask = { fieldPaths: item.updateMask };
      return write;
    })
  };
  const serialized = JSON.stringify(body);
  if (options.allowLargeAtomicBatch === true) {
    const encoder = new TextEncoder();
    if (encoder.encode(serialized).byteLength > 8 * 1024 * 1024
        || body.writes.some(write => write.update && encoder.encode(JSON.stringify(write.update)).byteLength > 900 * 1024)) {
      const error = new Error('The request exceeds the database document or transaction size limit. Nothing was posted. Accounts must review the request size.');
      error.status = 413;
      error.code = 'DATABASE_ATOMIC_SIZE_LIMIT';
      throw error;
    }
  }
  const response = await fetch(`${base}:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: serialized
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Database batch request failed (${response.status})`);
    const normalized = firestoreErrorStatus(data, response.status);
    error.status = normalized.status;
    error.code = normalized.code;
    error.upstreamCode = normalized.upstreamCode;
    throw error;
  }
  return data;
}

export async function batchCommitLiteralDocuments(env, writes) {
  return batchCommitDocuments(env, writes, { literalDocumentIds: true });
}

export async function batchUpsertDocuments(env, writes) {
  return batchCommitDocuments(env, writes);
}

export async function deleteDocument(env, collectionPath, documentId, options = {}) {
  return firestoreRequest(env, documentWritePath(collectionPath, documentId, options), {
    method: 'DELETE'
  });
}

export async function updateDocumentIfCurrent(env, collectionPath, documentId, data, currentDocument = {}) {
  const updateTime = clean(currentDocument.__updateTime || currentDocument.updateTime);
  if (!updateTime) {
    const error = new Error('The current database document version is required for a conditional update.');
    error.status = 428;
    error.code = 'FIRESTORE_VERSION_REQUIRED';
    throw error;
  }
  try {
    return await upsertDocument(env, collectionPath, documentId, data, { updateTime });
  } catch (error) {
    if ([409, 412].includes(Number(error?.status))) {
      error.status = 409;
      error.code = 'FIRESTORE_WRITE_CONFLICT';
      error.message = 'This record changed while you were editing it. Reload and try again.';
    }
    throw error;
  }
}

export async function patchDocumentFieldsIfCurrent(env, collectionPath, documentId, data, currentDocument = {}) {
  const updateTime = clean(currentDocument.__updateTime || currentDocument.updateTime);
  if (!updateTime) {
    const error = new Error('The current database document version is required for a conditional update.');
    error.status = 428;
    error.code = 'FIRESTORE_VERSION_REQUIRED';
    throw error;
  }
  try {
    return await patchDocumentFields(env, collectionPath, documentId, data, { updateTime });
  } catch (error) {
    if ([409, 412].includes(Number(error?.status))) {
      error.status = 409;
      error.code = 'FIRESTORE_WRITE_CONFLICT';
      error.message = 'This record changed while you were editing it. Reload and try again.';
    }
    throw error;
  }
}

export async function deleteDocumentIfCurrent(env, collectionPath, documentId, currentDocument = {}) {
  const updateTime = clean(currentDocument.__updateTime || currentDocument.updateTime);
  if (!updateTime) {
    const error = new Error('The current database document version is required for a conditional delete.');
    error.status = 428;
    error.code = 'FIRESTORE_VERSION_REQUIRED';
    throw error;
  }
  try {
    return await deleteDocument(env, collectionPath, documentId, { updateTime });
  } catch (error) {
    if ([409, 412].includes(Number(error?.status))) {
      error.status = 409;
      error.code = 'FIRESTORE_WRITE_CONFLICT';
      error.message = 'This record changed before it could be deleted. Reload and try again.';
    }
    throw error;
  }
}

function fromFirestoreValue(value, key = '') {
  if (!value || typeof value !== 'object') return '';
  if ('stringValue' in value) return isMinorUnitsField(key) && looksNumeric(value.stringValue) ? Number(value.stringValue) : value.stringValue;
  // Read old numeric mappings compatibly; no migration or historical rewrite is needed.
  if ('integerValue' in value) return isAccountCodeField(key) ? String(value.integerValue) : Number(value.integerValue);
  if ('doubleValue' in value) return isAccountCodeField(key) ? String(value.doubleValue) : Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return '';
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(item => fromFirestoreValue(item));
  }
  if ('mapValue' in value) {
    const out = {};
    Object.entries(value.mapValue.fields || {}).forEach(([key, item]) => {
      out[key] = fromFirestoreValue(item, key);
    });
    return out;
  }
  return '';
}

export function firestoreDocumentToObject(document) {
  const out = {};
  Object.entries((document && document.fields) || {}).forEach(([key, value]) => {
    out[key] = fromFirestoreValue(value, key);
  });
  if (document && document.name) {
    out.__name = document.name;
    out.__id = document.name.split('/').pop();
  }
  if (document && document.createTime) out.__createTime = document.createTime;
  if (document && document.updateTime) out.__updateTime = document.updateTime;
  return out;
}

function listOptions(value) {
  if (typeof value === 'string') return { query: value };
  return value && typeof value === 'object' ? value : {};
}

function listQueryParams(options = {}) {
  const params = new URLSearchParams(clean(options.query));
  const requestedSize = Number(options.pageSize || params.get('pageSize') || DEFAULT_LIST_PAGE_SIZE);
  params.set('pageSize', String(Math.min(MAX_LIST_PAGE_SIZE, Math.max(1, Number.isFinite(requestedSize) ? Math.floor(requestedSize) : DEFAULT_LIST_PAGE_SIZE))));
  const pageToken = clean(options.pageToken);
  if (pageToken) params.set('pageToken', pageToken);
  else if (options.pageToken === '') params.delete('pageToken');
  return params;
}

export async function listCollectionPage(env, collectionPath, options = {}) {
  const normalized = listOptions(options);
  const params = listQueryParams(normalized);
  const data = await firestoreRequest(env, `${collectionPath}?${params.toString()}`);
  const documents = (data.documents || []).map(firestoreDocumentToObject);
  return {
    documents,
    rows: documents,
    nextPageToken: clean(data.nextPageToken),
    count: documents.length
  };
}

export async function listCollection(env, collectionPath, query = '') {
  const options = listOptions(query);
  const explicitToken = options.pageToken !== undefined || new URLSearchParams(clean(options.query)).has('pageToken');
  if (explicitToken || options.singlePage) {
    return (await listCollectionPage(env, collectionPath, options)).documents;
  }
  const params = new URLSearchParams(clean(options.query));
  // Use one snapshot across pages so concurrent additions cannot move rows
  // between pages or change the validation/financial total mid-read.
  if (!params.has('readTime')) params.set('readTime', new Date().toISOString());
  return collectWorkspaceCollectionPages(
    pageToken => listCollectionPage(env, collectionPath, { ...options, query: params.toString(), pageToken }),
    collectionPath, options
  );
}

export async function collectWorkspaceCollectionPages(fetchPage, collectionPath, options = {}) {
  const maxPages = Math.min(200, options.maxPages == null ? 200 : Math.max(1, Math.floor(Number(options.maxPages) || 1)));
  const maxBytes = Math.min(MAX_COMPLETE_LIST_BYTES, Math.max(1, Number(options.maxBytes) || MAX_COMPLETE_LIST_BYTES));
  const maxRows = Math.min(MAX_COMPLETE_LIST_ROWS, Math.max(1, Number(options.maxRows) || MAX_COMPLETE_LIST_ROWS));
  const documents = [];
  const seenTokens = new Set();
  const seenDocuments = new Set();
  let bytes = 0;
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(pageToken);
    if (!Array.isArray(result.documents) || typeof result.nextPageToken !== 'string') throw new Error(`Incomplete database page for "${collectionPath}".`);
    for (const row of result.documents) {
      const key = clean(row?.__name || row?.__id);
      if (key && seenDocuments.has(key)) throw new Error(`The database repeated a record in "${collectionPath}". No partial records or totals were returned.`);
      if (key) seenDocuments.add(key);
    }
    bytes += new TextEncoder().encode(JSON.stringify(result.documents)).byteLength;
    if (bytes > maxBytes || documents.length + result.documents.length > maxRows) break;
    documents.push(...result.documents);
    const next = clean(result.nextPageToken);
    if (next && (next === pageToken || seenTokens.has(next))) throw new Error(`The database returned a repeated page token for "${collectionPath}".`);
    if (next) seenTokens.add(next);
    pageToken = next;
    if (!pageToken) return documents;
  }
  const error = new Error(`The selected "${collectionPath}" data exceeds the safe complete-read budget. Narrow the period or use paged history. No partial records or totals were returned. Use listCollectionPage with nextPageToken.`);
  error.status = 413;
  error.code = 'FIRESTORE_PAGINATION_REQUIRED';
  error.nextPageToken = pageToken;
  error.partialCount = documents.length;
  throw error;
}

// Financial reports retain their explicit complete-report contract and budget.
// Never substitute a history window for the rows used to compute totals.
export async function collectCollectionPages(fetchPage, collectionPath, options = {}) {
  const maxPages = Math.max(1, Math.min(40, Math.floor(Number(options.maxPages) || 40)));
  const documents = [];
  const seenTokens = new Set();
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchPage(pageToken);
    documents.push(...(result.documents || []));
    const nextPageToken = clean(result.nextPageToken);
    if (!nextPageToken) return documents;
    if (nextPageToken === pageToken || seenTokens.has(nextPageToken)) {
      throw new Error(`The database returned a repeated page token for "${collectionPath}".`);
    }
    seenTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  const error = new Error(`The database collection "${collectionPath}" exceeds the safe finance-report read limit. Narrow the report period or contact support; no partial totals were shown.`);
  error.status = 413;
  error.code = 'FIRESTORE_REPORT_LIMIT';
  throw error;
}

export async function listCollectionForReport(env, collectionPath, options = {}) {
  const { pageSize = DEFAULT_LIST_PAGE_SIZE, maxPages = 40, readTime = '' } = options;
  const query = readTime ? `readTime=${encodeURIComponent(readTime)}` : '';
  return collectCollectionPages(
    (pageToken) => listCollectionPage(env, collectionPath, { pageSize, pageToken, query }),
    collectionPath,
    { maxPages }
  );
}

// Fetch only the requested documents, in bounded network batches. REST batchGet
// does not preserve order; explicitly distinguish missing documents from a
// truncated response so callers never validate a partial selection.
export async function getDocuments(env, collectionPath, documentIds) {
  const collection = String(collectionPath || '').replace(/^\/+|\/+$/g, '');
  if (!collection || collection.split('/').length % 2 !== 1 || collection.split('/').some(part => !part || part === '.' || part === '..'))
    throw new Error('A valid collection path is required.');
  if (!Array.isArray(documentIds)) throw new Error('Document IDs must be an array.');
  const ids = documentIds.map(value => String(value ?? '').trim());
  if (ids.some(id => !id || id.includes('/') || id === '.' || id === '..')) throw new Error('Every document ID must be a single path segment.');
  if (!ids.length) return [];
  const token = await getFirestoreAccessToken(env), base = firestoreBaseUrl(env);
  const resourceBase = base.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, '');
  const names = ids.map(id => `${resourceBase}/${collection}/${id}`), distinct = [...new Set(names)], found = new Map();
  for (let offset = 0; offset < distinct.length; offset += 25) {
    const documents = distinct.slice(offset, offset + 25);
    const response = await fetch(`${base}:batchGet`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ documents }) });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data?.error?.message || `Database batch read failed (${response.status})`);
      Object.assign(error, firestoreErrorStatus(data, response.status));
      throw error;
    }
    if (!Array.isArray(data)) throw new Error('The database batch read was incomplete.');
    const expected = new Set(documents);
    for (const entry of data) {
      const name = entry.found?.name || entry.missing;
      if (!expected.has(name) || found.has(name)) throw new Error('The database batch read returned an unexpected document.');
      found.set(name, entry.found ? firestoreDocumentToObject(entry.found) : null);
    }
    if (documents.some(name => !found.has(name))) throw new Error('The database batch read was incomplete.');
  }
  return names.map(name => found.get(name));
}

export async function getDocument(env, collectionPath, documentId) {
  const cleanCollection = String(collectionPath || '').replace(/^\/+|\/+$/g, '');
  const encodedId = encodeURIComponent(String(documentId || '').trim());
  if (!cleanCollection) throw new Error('Collection path is required.');
  if (!encodedId) throw new Error('Document ID is required.');
  try {
    return firestoreDocumentToObject(await firestoreRequest(env, `${cleanCollection}/${encodedId}`));
  } catch (error) {
    if (error && error.status === 404) return null;
    throw error;
  }
}
