import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import {
  buildDeploymentMatrix,
  validateOrganisationRegistry
} from '../scripts/organisation-deployment-matrix.mjs';
import {
  validateDeploymentPayload,
  validateSubscriptionBridgePayload
} from '../scripts/verify-organisation-deployment.mjs';

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
const organizationConfig = JSON.parse(await readFile(new URL('../firebase.organization.json', import.meta.url), 'utf8'));
const platformConfig = JSON.parse(await readFile(new URL('../firebase.platform.json', import.meta.url), 'utf8'));
const schoolIndexes = JSON.parse(await readFile(new URL('../firestore.school.indexes.json', import.meta.url), 'utf8'));
const churchIndexes = JSON.parse(await readFile(new URL('../firestore.church.indexes.json', import.meta.url), 'utf8'));
const organizationIndexes = JSON.parse(await readFile(new URL('../firestore.organization.indexes.json', import.meta.url), 'utf8'));
const platformIndexes = JSON.parse(await readFile(new URL('../firestore.platform.indexes.json', import.meta.url), 'utf8'));
const tenantProvisioner = await readFile(new URL('../.github/workflows/provision-tenant-pool.yml', import.meta.url), 'utf8');
const tenantFleet = await readFile(new URL('../.github/workflows/deploy-tenant-pool.yml', import.meta.url), 'utf8');
const tenantProvisionerScript = await readFile(new URL('../scripts/provision-tenant-projects.mjs', import.meta.url), 'utf8');

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

test('other organisations have an independent deployment profile', () => {
  const withOtherOrganisation = structuredClone(registry);
  withOtherOrganisation.organisations.push({
    id: 'example-civic-office',
    name: 'Example Civic Office',
    edition: 'organization',
    indexProfile: 'organization',
    githubEnvironment: 'production-example-civic-office',
    cloudflareAccountId: 'b5aa57ffa1fd00e4fd98e78ee7d32f02',
    cloudflareProject: 'example-civic-office',
    workspaceId: 'example-civic-office',
    enabled: true,
    rolloutOrder: 30
  });
  const rows = validateOrganisationRegistry(withOtherOrganisation);
  assert.equal(rows[2].firebaseConfig, 'firebase.organization.json');
  const mismatched = structuredClone(withOtherOrganisation);
  mismatched.organisations[2].indexProfile = 'church';
  assert.throws(() => validateOrganisationRegistry(mismatched), /must use the organization index profile/);
});

test('deployment verification requires the central subscription bridge', async () => {
  const catalog = { Currency: 'NGN', Plans: {} };
  assert.equal(validateSubscriptionBridgePayload({ ok: true, catalog }), catalog);
  assert.throws(
    () => validateSubscriptionBridgePayload({ ok: false, message: 'not configured' }),
    /three subscription bridge variables/i
  );
  assert.match(reusable, /verify-organisation-deployment\.mjs/);
  assert.match(await readFile(new URL('../scripts/verify-organisation-deployment.mjs', import.meta.url), 'utf8'), /api\/plan-catalog/);
});

test('school, church, other organisations and the Dynamax control plane use separate Firebase configurations', async () => {
  assert.equal(schoolConfig.firestore.indexes, 'firestore.school.indexes.json');
  assert.equal(churchConfig.firestore.indexes, 'firestore.church.indexes.json');
  assert.equal(organizationConfig.firestore.indexes, 'firestore.organization.indexes.json');
  assert.equal(platformConfig.firestore.indexes, 'firestore.platform.indexes.json');
  assert.equal(schoolIndexes.indexes.length, 23);
  assert.equal(churchIndexes.indexes.length, 11);
  assert.equal(organizationIndexes.indexes.length, 11);
  assert.deepEqual(platformIndexes, { indexes: [], fieldOverrides: [] });
  await assert.rejects(access(new URL('../firebase.json', import.meta.url)));
  await assert.rejects(access(new URL('../firestore.indexes.json', import.meta.url)));
});

test('the tenant pool provisioner is opt-in, uses WIF and creates isolated deployments without platform database keys', () => {
  assert.match(tenantProvisioner, /workflow_dispatch:/);
  assert.match(tenantProvisioner, /TENANT_POOL_AUTOMATION_ENABLED == 'true'/);
  assert.match(tenantProvisioner, /google-github-actions\/auth@v3/);
  assert.match(tenantProvisioner, /DYNAMAX_PROVISION_SERVICE_ACCOUNT/);
  assert.match(tenantProvisioner, /claim-next/);
  assert.match(tenantProvisionerScript, /projects', 'create'/);
  assert.match(tenantProvisionerScript, /projects\/\$\{projectId\}:addFirebase/);
  assert.match(tenantProvisionerScript, /firebase\.organization\.json/);
  assert.match(tenantProvisionerScript, /secret_text/);
  assert.match(tenantProvisionerScript, /wrangler@4\.61\.0/);
  assert.doesNotMatch(tenantProvisionerScript, /DYNAMAX_PLATFORM_FIREBASE_(?:PRIVATE_KEY|CLIENT_EMAIL)/);
  assert.match(tenantFleet, /TENANT_POOL_FLEET_DEPLOY_ENABLED == 'true'/);
  assert.match(tenantFleet, /fromJSON\(needs\.inventory\.outputs\.projects\)/);
  assert.match(tenantFleet, /firebase\.organization\.json/);
  assert.match(tenantFleet, /max-parallel: 3/);
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
