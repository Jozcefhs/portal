import {
  createDocumentIfAbsent,
  getDocument,
  listCollection
} from '../functions/lib/firestore.js';
import { requirePlatformFirestoreEnv } from '../functions/lib/platform-firestore.js';

const clean = (value) => String(value ?? '').trim();
const applying = process.argv.includes('--apply');

function requiredEnvironment(keys) {
  const missing = keys.filter((key) => !clean(process.env[key]));
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
}

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

requiredEnvironment([
  'SOURCE_FIREBASE_PROJECT_ID',
  'SOURCE_FIREBASE_CLIENT_EMAIL',
  'SOURCE_FIREBASE_PRIVATE_KEY',
  'SOURCE_WORKSPACE_ID',
  'DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID',
  'DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL',
  'DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY'
]);

const sourceEnv = {
  FIREBASE_PROJECT_ID: clean(process.env.SOURCE_FIREBASE_PROJECT_ID),
  FIREBASE_CLIENT_EMAIL: clean(process.env.SOURCE_FIREBASE_CLIENT_EMAIL),
  FIREBASE_PRIVATE_KEY: clean(process.env.SOURCE_FIREBASE_PRIVATE_KEY)
};
const sourceWorkspaceId = clean(process.env.SOURCE_WORKSPACE_ID).toLowerCase();
const targetEnv = requirePlatformFirestoreEnv({
  FIREBASE_PROJECT_ID: sourceEnv.FIREBASE_PROJECT_ID,
  DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID: process.env.DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID,
  DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL: process.env.DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL,
  DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY: process.env.DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY
});

const catalog = await getDocument(sourceEnv, 'settings', 'dynamaxPlanCatalog');
const registrations = await listCollection(sourceEnv, 'tenantRegistrations', { pageSize: 1000, maxPages: 25 });
const payments = await listCollection(sourceEnv, 'subscriptionPayments', { pageSize: 1000, maxPages: 25 });

const migrationItems = [
  ...(catalog ? [{ collection: 'settings', id: 'dynamaxPlanCatalog', data: catalog }] : []),
  ...registrations.map((document) => {
    const existingWorkspaceId = clean(document.WorkspaceId).toLowerCase();
    if (existingWorkspaceId && existingWorkspaceId !== sourceWorkspaceId) {
      throw new Error(`Registration ${document.__id} belongs to workspace ${existingWorkspaceId}, not ${sourceWorkspaceId}.`);
    }
    return {
      collection: 'tenantRegistrations',
      id: document.__id,
      data: { ...document, WorkspaceId: sourceWorkspaceId }
    };
  }),
  ...payments.map((document) => ({ collection: 'subscriptionPayments', id: document.__id, data: document }))
];

console.log(JSON.stringify({
  mode: applying ? 'apply' : 'dry-run',
  sourceProject: sourceEnv.FIREBASE_PROJECT_ID,
  sourceWorkspaceId,
  targetProject: targetEnv.FIREBASE_PROJECT_ID,
  planCatalogs: catalog ? 1 : 0,
  tenantRegistrations: registrations.length,
  subscriptionPayments: payments.length
}, null, 2));

if (!applying) {
  console.log('Dry run only. Re-run with --apply to copy missing documents. The source database is never deleted or modified.');
  process.exit(0);
}

let created = 0;
let skipped = 0;
for (const item of migrationItems) {
  const result = await createDocumentIfAbsent(
    targetEnv,
    item.collection,
    item.id,
    withoutFirestoreMetadata(item.data)
  );
  if (result.created) created += 1;
  else skipped += 1;
}

console.log(JSON.stringify({ created, skippedExisting: skipped }, null, 2));
