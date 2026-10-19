// Read-only queries for the six entries reported on 16 October 2026.
// Do not print credentials, student identities, IP addresses or whole documents.
import { createRequire } from 'node:module';
import { buildStructuredQuery } from '../functions/lib/firestore.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js');
const { requireAuth } = require('./requireAuth.js');
const { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Firebase CLI sign-in required for read-only audit lookup.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const decode = field => field?.stringValue ?? field?.integerValue ?? field?.timestampValue ?? '';
for (const collection of ['platformSecurityAudit', 'staffRecordsAudit']) {
  const { endpoint, structuredQuery } = buildStructuredQuery(collection, {
    filters: [{ field: 'Timestamp', op: '>=', value: '2026-10-15T23:44:00.000Z' },
      { field: 'Timestamp', op: '<=', value: '2026-10-15T23:59:00.000Z' }],
    orderBy: [{ field: 'Timestamp', direction: 'ASCENDING' }], limit: 500,
    select: ['Timestamp', 'Action', 'Route', 'Method', 'HttpStatus', 'ActorUsername', 'BranchId', 'Before', 'After']
  });
  const result = await client.post(`/projects/${project}/databases/(default)/documents/${endpoint}`,
    { structuredQuery }, { resolveOnHTTPError: true });
  const entries = Array.isArray(result.body) ? result.body : [result.body];
  const failure = entries.find(row => row?.error)?.error;
  if (failure || result.status >= 400) {
    console.log(JSON.stringify({ collection, status: result.status, error: failure?.status || 'Query rejected' }));
    continue;
  }
  const rows = entries.flatMap(row => row.document ? [row.document.fields] : []);
  const relevant = rows.filter(row => decode(row.ActorUsername) === 'admin' &&
    (decode(row.Route) === '/api/passport-photo' || /profile.defaults/i.test(decode(row.Action))));
  console.log(JSON.stringify({ collection, totalInWindow: rows.length, capped: rows.length >= 500,
    relevant: relevant.map(row => ({ time: decode(row.Timestamp), action: decode(row.Action),
      route: decode(row.Route), method: decode(row.Method), status: decode(row.HttpStatus),
      changedFields: Object.keys(row.After?.mapValue?.fields || {}) })) }));
}
