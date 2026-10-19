// Live diagnostic: GET only, with masked document fields. No financial writes.
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), { requireAuth } = require('./requireAuth.js'), { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Firebase CLI sign-in required.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const readTime = new Date(Date.now() - 5000).toISOString();
async function page(collection, orderBy, pageToken = '') {
  const query = new URLSearchParams({ pageSize: '3', readTime, 'mask.fieldPaths': 'BranchId' });
  if (orderBy) query.set('orderBy', orderBy);
  if (pageToken) query.set('pageToken', pageToken);
  const response = await client.get(`/projects/${project}/databases/(default)/documents/${collection}?${query}`, { resolveOnHTTPError: true });
  const body = response.body;
  console.log(JSON.stringify({ readOnly: true, collection, order: orderBy || 'default', continuation: Boolean(pageToken),
    status: response.status, count: body.documents?.length ?? null, more: Boolean(body.nextPageToken),
    missingIndex: /requires an index/i.test(body.error?.message || '') }));
  return body;
}
await page('tuckShopMovements', '__name__ desc');
for (const collection of ['tuckShopMovements', 'ledger', 'organizationCommerceSales', 'clinicRecords', 'clinicMovements', 'kitchenMovements', 'restaurantMovements', 'storeOrders']) {
  const first = await page(collection);
  if (first.error) throw new Error(`${collection}: default-order read failed.`);
  if (first.nextPageToken) {
    const next = await page(collection, '', first.nextPageToken);
    if (next.error) throw new Error(`${collection}: continuation failed.`);
    const names = new Set(first.documents.map(doc => doc.name));
    if (next.documents?.some(doc => names.has(doc.name))) throw new Error(`${collection}: duplicate page records.`);
  }
}
