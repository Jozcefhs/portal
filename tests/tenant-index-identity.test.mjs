import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tenantIndexIdentity } from '../scripts/tenant-index-identity.mjs';

const defaults = {
  projectId: 'dynamax-organisation-bootstrap',
  serviceAccount: 'github-tenant-provisioner@dynamax-organisation-bootstrap.iam.gserviceaccount.com'
};

test('legacy tenants use their existing index deployment identity', () => {
  for (const suffix of ['002', '003', '004', '006', '007', '009']) {
    assert.deepEqual(tenantIndexIdentity(`dynamax-tenant-${suffix}`, defaults), {
      projectId: 'digc-suite',
      serviceAccount: 'github-firestore-indexes@digc-suite.iam.gserviceaccount.com'
    });
  }
});

test('other tenants keep the provisioner identity without prefix-based legacy matching', () => {
  for (const project of ['dynamax-tenant-001', 'dynamax-tenant-org-72593c178d', 'dynamax-tenant-002-other']) {
    assert.deepEqual(tenantIndexIdentity(project, defaults), defaults);
  }
});

test('index identity selection rejects malformed output and unrelated project targets', () => {
  assert.throws(() => tenantIndexIdentity('digc-suite', defaults), /valid tenant/);
  assert.throws(() => tenantIndexIdentity('dynamax-tenant-002\nother', defaults), /valid tenant/);
  assert.throws(() => tenantIndexIdentity('dynamax-tenant-001'), /not configured/);
  assert.throws(() => tenantIndexIdentity('dynamax-tenant-001', { ...defaults, serviceAccount: defaults.serviceAccount + '\nextra=bad' }), /not configured/);
});

test('tenant workflow uses the selected identity and keeps the target project separate', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-tenant-pool.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: node scripts\/tenant-index-identity\.mjs/);
  assert.match(workflow, /project_id: \$\{\{ steps\.index_identity\.outputs\.project_id \}\}/);
  assert.match(workflow, /service_account: \$\{\{ steps\.index_identity\.outputs\.service_account \}\}/);
  assert.match(workflow, /--project "\$\{FIREBASE_PROJECT_ID\}"/);
  assert.match(workflow, /git diff --quiet[^\n]+scripts\/tenant-index-identity\.mjs/);
  assert.doesNotMatch(workflow, /set-iam-policy|add-iam-policy-binding/);
});
