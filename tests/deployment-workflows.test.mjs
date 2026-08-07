import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import {
  buildDeploymentMatrix,
  validateOrganisationRegistry
} from '../scripts/organisation-deployment-matrix.mjs';
import { validateDeploymentPayload } from '../scripts/verify-organisation-deployment.mjs';

const reusable = await readFile(
  new URL('../.github/workflows/deploy-organisation.yml', import.meta.url),
  'utf8'
);
const coordinator = await readFile(
  new URL('../.github/workflows/deploy-organisations.yml', import.meta.url),
  'utf8'
);
const registry = JSON.parse(await readFile(new URL('../deploy/organisations.json', import.meta.url), 'utf8'));
const schoolConfig = JSON.parse(await readFile(new URL('../firebase.school.json', import.meta.url), 'utf8'));
const churchConfig = JSON.parse(await readFile(new URL('../firebase.church.json', import.meta.url), 'utf8'));
const platformConfig = JSON.parse(await readFile(new URL('../firebase.platform.json', import.meta.url), 'utf8'));
const schoolIndexes = JSON.parse(await readFile(new URL('../firestore.school.indexes.json', import.meta.url), 'utf8'));
const churchIndexes = JSON.parse(await readFile(new URL('../firestore.church.indexes.json', import.meta.url), 'utf8'));
const platformIndexes = JSON.parse(await readFile(new URL('../firestore.platform.indexes.json', import.meta.url), 'utf8'));

function indexFields(index) {
  return (index.fields || []).map((field) => field.fieldPath).join('|');
}

test('the organisation registry validates and builds an edition-aware deployment matrix', () => {
  const organisations = validateOrganisationRegistry(registry);
  assert.equal(organisations.length, 2);
  assert.deepEqual(organisations.map((row) => row.id), ['destinychristianacademy', 'digc-suite']);
  assert.equal(organisations[0].firebaseConfig, 'firebase.school.json');
  assert.equal(organisations[1].firebaseConfig, 'firebase.church.json');
  assert.equal(organisations[1].cloudflareAccountId, 'a5aa57ffa1fd00e4fd98e78ee7d32f01');
  assert.deepEqual(buildDeploymentMatrix(registry, { target: 'digc-suite' }).map((row) => row.id), ['digc-suite']);
  assert.equal(buildDeploymentMatrix(registry, { target: 'all' }).length, 2);
});

test('the registry rejects duplicate deployment boundaries and invalid edition profiles', () => {
  const duplicate = structuredClone(registry);
  duplicate.organisations[1].cloudflareProject = duplicate.organisations[0].cloudflareProject;
  assert.throws(() => validateOrganisationRegistry(duplicate), /Cloudflare Pages project/);

  const mismatched = structuredClone(registry);
  mismatched.organisations[0].indexProfile = 'church';
  assert.throws(() => validateOrganisationRegistry(mismatched), /must use the school index profile/);
});

test('the reusable workflow deploys indexes and Pages with short-lived, environment-scoped credentials', () => {
  assert.match(reusable, /workflow_call:/);
  assert.match(reusable, /environment:[\s\S]*inputs\.github_environment/);
  assert.match(reusable, /google-github-actions\/auth@v3/);
  assert.match(reusable, /id-token: write/);
  assert.match(reusable, /vars\.FIREBASE_PROJECT_ID/);
  assert.match(reusable, /vars\.GCP_WIF_PROVIDER/);
  assert.match(reusable, /vars\.GCP_INDEX_SERVICE_ACCOUNT/);
  assert.match(reusable, /firebase-tools@15\.24\.0 deploy/);
  assert.match(reusable, /--only firestore:indexes/);
  assert.match(reusable, /--config "\$\{FIREBASE_CONFIG\}"/);
  assert.match(reusable, /cloudflare\/wrangler-action@v3/);
  assert.match(reusable, /inputs\.cloudflare_account_id/);
  assert.match(reusable, /--project-name=\$\{\{ inputs\.cloudflare_project \}\}/);
  assert.match(reusable, /verify-organisation-deployment\.mjs/);
  assert.doesNotMatch(reusable, /FIREBASE_TOKEN|credentials_json|private[_ -]?key/i);
});

test('the coordinator can deploy one or all organisations without cancelling unaffected tenants', () => {
  assert.match(coordinator, /workflow_dispatch:/);
  assert.match(coordinator, /vars\.MULTI_ORG_DEPLOY_ENABLED == 'true'/);
  assert.match(coordinator, /organisation-deployment-matrix\.mjs --target/);
  assert.match(coordinator, /fail-fast: false/);
  assert.match(coordinator, /max-parallel: 3/);
  assert.match(coordinator, /fromJSON\(needs\.validate\.outputs\.organisations\)/);
  assert.match(coordinator, /matrix\.organisation\.cloudflareAccountId/);
  assert.match(coordinator, /uses: \.\/\.github\/workflows\/deploy-organisation\.yml/);
  assert.match(coordinator, /secrets: inherit/);
});

test('deployed organisation identity must match its registry boundary', () => {
  assert.deepEqual(validateDeploymentPayload({
    ok: true,
    profile: { WorkspaceId: 'digc-suite', OrganisationEdition: 'faith' }
  }, { workspaceId: 'DIGC-SUITE', edition: 'faith' }), {
    workspaceId: 'digc-suite',
    edition: 'faith'
  });
  assert.throws(() => validateDeploymentPayload({
    ok: true,
    profile: { WorkspaceId: 'another-school', OrganisationEdition: 'school' }
  }, { workspaceId: 'digc-suite', edition: 'faith' }), /workspace mismatch/);
});

test('school, church and the Dynamax control plane use separate Firebase configurations', async () => {
  assert.equal(schoolConfig.firestore.indexes, 'firestore.school.indexes.json');
  assert.equal(churchConfig.firestore.indexes, 'firestore.church.indexes.json');
  assert.equal(platformConfig.firestore.indexes, 'firestore.platform.indexes.json');
  assert.equal(schoolIndexes.indexes.length, 23);
  assert.equal(churchIndexes.indexes.length, 11);
  assert.deepEqual(platformIndexes, { indexes: [], fieldOverrides: [] });
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
