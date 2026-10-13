// Never include upstream free text: it can contain document values or credentials.
const DATABASE_CODES = new Set(['INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'PERMISSION_DENIED',
  'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED', 'NOT_FOUND', 'ABORTED', 'ALREADY_EXISTS',
  'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL', 'UNKNOWN']);

export function notificationSchedulerDiagnostic(stage, error = {}) {
  const data = error?.data;
  // Firestore runQuery errors may arrive in an array, unlike document errors.
  const upstream = (Array.isArray(data) ? data.find(row => row?.error)?.error : data?.error) || {};
  const candidate = String(upstream.status || error?.upstreamCode || '').toUpperCase();
  const databaseCode = DATABASE_CODES.has(candidate) ? candidate : '';
  const upstreamText = String(upstream.message || '').toLowerCase();
  let issue = 'STAGE_FAILED', reason = 'The operation failed; no private error payload is included.';
  if (databaseCode || error?.data) {
    issue = 'DATABASE_REQUEST_REJECTED'; reason = 'Firestore rejected the database request.';
    if (/index/.test(upstreamText) && ['FAILED_PRECONDITION', 'INVALID_ARGUMENT'].includes(databaseCode)) {
      issue = 'DATABASE_INDEX'; reason = 'A required database index is missing, unavailable, or still building.';
    } else if (['PERMISSION_DENIED', 'UNAUTHENTICATED'].includes(databaseCode)) {
      issue = 'DATABASE_AUTHORIZATION'; reason = 'Firestore rejected the service identity or its permissions.';
    } else if (databaseCode === 'RESOURCE_EXHAUSTED') {
      issue = 'DATABASE_QUOTA'; reason = 'A database quota or resource limit was exceeded.';
    } else if (databaseCode === 'NOT_FOUND') {
      issue = 'DATABASE_NOT_FOUND'; reason = 'The requested database resource was not found.';
    } else if (databaseCode === 'INVALID_ARGUMENT') {
      issue = 'DATABASE_INVALID_REQUEST'; reason = 'Firestore rejected the query or write format, field values, or request limits.';
    } else if (['ABORTED', 'ALREADY_EXISTS', 'FAILED_PRECONDITION'].includes(databaseCode)) {
      issue = 'DATABASE_PRECONDITION'; reason = 'A database precondition or concurrent-write check failed.';
    } else if (['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL'].includes(databaseCode)) {
      issue = 'DATABASE_UNAVAILABLE'; reason = 'The database service was unavailable or did not complete the request in time.';
    }
  }
  return { stage, issue, ...(databaseCode ? { databaseCode } : {}), reason };
}
