const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
let cachedToken = null;

const DEFAULT_LIST_PAGE_SIZE = 1000;
const MAX_LIST_PAGE_SIZE = 1000;
const DEFAULT_MAX_LIST_PAGES = 5;

function clean(value) {
  return String(value ?? '').trim();
}

function firestoreEnvironmentKey(env) {
  return `${clean(env.FIREBASE_PROJECT_ID)}|${clean(env.FIREBASE_CLIENT_EMAIL)}`;
}

function firestoreErrorStatus(data, responseStatus) {
  const upstreamCode = clean(data?.error?.status).toUpperCase();
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
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && data.error && data.error.message ? data.error.message : `Database request failed (${response.status})`;
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

function shouldKeepString(key, value) {
  const name = String(key || '').toLowerCase();
  const text = String(value ?? '').trim();
  if (!text) return true;
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
    return { arrayValue: { values: cleaned.map((item) => toFirestoreValue(item)) } };
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
  const structuredQuery = {
    from: [{ collectionId: location.collectionId }]
  };
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
  const limit = Number(options.limit || 0);
  if (Number.isInteger(limit) && limit > 0) structuredQuery.limit = limit;
  const endpoint = location.parentPath ? `${location.parentPath}:runQuery` : ':runQuery';
  return { endpoint, structuredQuery };
}

export async function queryCollection(env, collectionPath, options = {}) {
  const { endpoint, structuredQuery } = buildStructuredQuery(collectionPath, options);
  const rows = await firestoreRequest(env, endpoint, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery })
  });
  return (Array.isArray(rows) ? rows : [])
    .map((row) => row && row.document)
    .filter(Boolean)
    .map(firestoreDocumentToObject);
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

export async function batchCommitDocuments(env, writes) {
  const items = Array.isArray(writes) ? writes : [];
  if (!items.length) return { writeResults: [] };
  if (items.length > 500) throw new Error('A database batch may contain at most 500 writes.');
  const token = await getFirestoreAccessToken(env);
  const base = firestoreBaseUrl(env);
  // Firestore commit write names are resource names (projects/.../documents/...),
  // not REST URLs. Supplying the full https URL triggers "lacks projects at index 0".
  const resourceBase = base.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, '');
  const body = {
    writes: items.map((item) => {
      const collection = String(item.collectionPath || '').replace(/^\/+|\/+$/g, '');
      const id = encodeURIComponent(String(item.documentId || '').trim());
      if (!collection || !id) throw new Error('Every batch write requires a collection path and document ID.');
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
      return write;
    })
  };
  const response = await fetch(`${base}:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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

function fromFirestoreValue(value) {
  if (!value || typeof value !== 'object') return '';
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return '';
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in value) {
    const out = {};
    Object.entries(value.mapValue.fields || {}).forEach(([key, item]) => {
      out[key] = fromFirestoreValue(item);
    });
    return out;
  }
  return '';
}

export function firestoreDocumentToObject(document) {
  const out = {};
  Object.entries((document && document.fields) || {}).forEach(([key, value]) => {
    out[key] = fromFirestoreValue(value);
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
  const maxPagesValue = Number(options.maxPages || DEFAULT_MAX_LIST_PAGES);
  const maxPages = Math.min(25, Math.max(1, Number.isFinite(maxPagesValue) ? Math.floor(maxPagesValue) : DEFAULT_MAX_LIST_PAGES));
  const documents = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const result = await listCollectionPage(env, collectionPath, { ...options, pageToken });
    documents.push(...result.documents);
    pageToken = result.nextPageToken;
    if (!pageToken) return documents;
  }
  const error = new Error(`The database collection "${collectionPath}" is too large for an unpaginated request. Use listCollectionPage with nextPageToken.`);
  error.status = 413;
  error.code = 'FIRESTORE_PAGINATION_REQUIRED';
  error.nextPageToken = pageToken;
  error.partialCount = documents.length;
  throw error;
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
