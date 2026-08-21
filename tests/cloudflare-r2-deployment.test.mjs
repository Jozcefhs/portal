import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ensureCloudflareR2Storage,
  r2BucketNameForProject
} from '../scripts/cloudflare-r2.mjs';

test('tenant R2 bucket names are deterministic and within Cloudflare limits', () => {
  assert.equal(r2BucketNameForProject('destinychristianacademy'), 'destinychristianacademy-documents');
  const long = r2BucketNameForProject('a'.repeat(80));
  assert.ok(long.length <= 63);
  assert.match(long, /^[a-z0-9][a-z0-9-]+[a-z0-9]$/);
  assert.equal(long, r2BucketNameForProject('a'.repeat(80)));
});

test('deployment automation creates a missing bucket and preserves Pages configuration', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/r2/buckets/academy-documents') && !options.method) {
      return Response.json({ success: false, errors: [{ message: 'not found' }] }, { status: 404 });
    }
    if (url.endsWith('/r2/buckets') && options.method === 'POST') {
      return Response.json({ success: true, result: { name: 'academy-documents' } });
    }
    if (url.endsWith('/pages/projects/academy') && !options.method) {
      return Response.json({
        success: true,
        result: {
          deployment_configs: {
            preview: {
              env_vars: { EXISTING: { type: 'plain_text', value: 'yes' } },
              ai_bindings: { AI: { project_id: 'existing-ai' } }
            },
            production: { compatibility_date: '2026-08-01', limits: { cpu_ms: 50 } }
          }
        }
      });
    }
    if (url.endsWith('/pages/projects/academy') && options.method === 'PATCH') {
      return Response.json({ success: true, result: {} });
    }
    throw new Error(`Unexpected request: ${options.method || 'GET'} ${url}`);
  };

  const result = await ensureCloudflareR2Storage({
    accountId: 'account', token: 'token', projectName: 'academy', fetchImpl
  });
  assert.equal(result.bucketName, 'academy-documents');
  const patchCall = calls.find((call) => call.options.method === 'PATCH');
  const body = JSON.parse(patchCall.options.body);
  assert.equal(body.deployment_configs.preview.env_vars.EXISTING.value, 'yes');
  assert.equal(body.deployment_configs.preview.ai_bindings.AI.project_id, 'existing-ai');
  assert.equal(body.deployment_configs.production.limits.cpu_ms, 50);
  assert.deepEqual(body.deployment_configs.preview.r2_buckets.DYNAMAX_DOCUMENTS, { name: 'academy-documents' });
  assert.deepEqual(body.deployment_configs.production.r2_buckets.DYNAMAX_DOCUMENTS, { name: 'academy-documents' });
});

test('all deployment paths ensure the R2 binding before Pages deployment', async () => {
  const [organizationWorkflow, poolWorkflow, provisioner] = await Promise.all([
    readFile(new URL('../.github/workflows/deploy-organisation.yml', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/deploy-tenant-pool.yml', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/provision-tenant-projects.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(organizationWorkflow, /ensure-r2-storage\.mjs/);
  assert.match(poolWorkflow, /ensure-r2-storage\.mjs/);
  assert.match(provisioner, /ensureCloudflareR2Storage/);
});
