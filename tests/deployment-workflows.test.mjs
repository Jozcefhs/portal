import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const reusable = await readFile(
  new URL('../.github/workflows/deploy-firestore-indexes.yml', import.meta.url),
  'utf8'
);
const school = await readFile(new URL('../.github/workflows/deploy-school.yml', import.meta.url), 'utf8');
const church = await readFile(new URL('../.github/workflows/deploy-digc-suite.yml', import.meta.url), 'utf8');
const schoolConfig = JSON.parse(await readFile(new URL('../firebase.school.json', import.meta.url), 'utf8'));
const churchConfig = JSON.parse(await readFile(new URL('../firebase.church.json', import.meta.url), 'utf8'));
const schoolIndexes = JSON.parse(await readFile(new URL('../firestore.school.indexes.json', import.meta.url), 'utf8'));
const churchIndexes = JSON.parse(await readFile(new URL('../firestore.church.indexes.json', import.meta.url), 'utf8'));

function indexFields(index) {
  return (index.fields || []).map((field) => field.fieldPath).join('|');
}

test('the reusable workflow deploys only checked-in Firestore indexes with short-lived credentials', () => {
  assert.match(reusable, /workflow_call:/);
  assert.match(reusable, /google-github-actions\/auth@v3/);
  assert.match(reusable, /id-token: write/);
  assert.match(reusable, /firebase-tools@15\.24\.0 deploy/);
  assert.match(reusable, /--only firestore:indexes/);
  assert.match(reusable, /--config "\$\{FIREBASE_CONFIG\}"/);
  assert.match(reusable, /--force/);
  assert.match(reusable, /--non-interactive/);
  assert.match(reusable, /inputs\.firebase_config/);
  assert.doesNotMatch(reusable, /FIREBASE_TOKEN|credentials_json|private[_ -]?key/i);
});

test('school and church use separate Firebase configurations and index files', async () => {
  assert.equal(schoolConfig.firestore.indexes, 'firestore.school.indexes.json');
  assert.equal(churchConfig.firestore.indexes, 'firestore.church.indexes.json');
  assert.equal(schoolIndexes.indexes.length, 23);
  assert.equal(churchIndexes.indexes.length, 11);
  await assert.rejects(access(new URL('../firebase.json', import.meta.url)));
  await assert.rejects(access(new URL('../firestore.indexes.json', import.meta.url)));
});

test('church indexes cover member notifications without carrying school-only composites', () => {
  const churchFields = churchIndexes.indexes.map(indexFields);
  const churchCollections = new Set(churchIndexes.indexes.map((index) => index.collectionGroup));
  assert.ok(churchFields.includes('TargetEmails|BranchId|CreatedAt'));
  assert.equal(churchFields.some((fields) => fields.includes('SchoolSection')), false);
  assert.equal(churchFields.some((fields) => fields.includes('TargetAccountRefs')), false);
  assert.equal(churchCollections.has('invoices'), false);
  assert.equal(churchCollections.has('payments'), false);
  assert.equal(churchCollections.has('storeOrders'), false);
});

test('school indexes retain school finance and section-scoped notification queries', () => {
  const schoolFields = schoolIndexes.indexes.map(indexFields);
  const schoolCollections = new Set(schoolIndexes.indexes.map((index) => index.collectionGroup));
  assert.ok(schoolFields.some((fields) => fields.includes('SchoolSection')));
  assert.ok(schoolFields.some((fields) => fields.includes('TargetAccountRefs')));
  assert.equal(schoolCollections.has('invoices'), true);
  assert.equal(schoolCollections.has('payments'), true);
  assert.equal(schoolCollections.has('storeOrders'), true);
});

test('school deployment is blocked until its Firestore indexes deploy', () => {
  assert.match(school, /firestore-indexes:/);
  assert.match(school, /SCHOOL_FIREBASE_PROJECT_ID/);
  assert.match(school, /SCHOOL_GCP_WIF_PROVIDER/);
  assert.match(school, /SCHOOL_GCP_INDEX_SERVICE_ACCOUNT/);
  assert.match(school, /firebase_config: firebase\.school\.json/);
  assert.match(school, /needs: firestore-indexes/);
  assert.ok(school.indexOf('needs: firestore-indexes') < school.indexOf('cloudflare/wrangler-action@v3'));
});

test('church deployment is blocked until its Firestore indexes deploy', () => {
  assert.match(church, /firestore-indexes:/);
  assert.match(church, /CHURCH_FIREBASE_PROJECT_ID/);
  assert.match(church, /CHURCH_GCP_WIF_PROVIDER/);
  assert.match(church, /CHURCH_GCP_INDEX_SERVICE_ACCOUNT/);
  assert.match(church, /firebase_config: firebase\.church\.json/);
  assert.match(church, /needs: firestore-indexes/);
  assert.ok(church.indexOf('needs: firestore-indexes') < church.indexOf('cloudflare/wrangler-action@v3'));
});
