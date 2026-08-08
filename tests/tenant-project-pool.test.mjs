import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeTenantPoolPolicy,
  publicTenantProjectSlot
} from '../functions/lib/tenant-project-pool.js';

const poolSource = await readFile(new URL('../functions/lib/tenant-project-pool.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../functions/api/tenant-project-pool.js', import.meta.url), 'utf8');
const paymentSource = await readFile(new URL('../functions/api/verify-subscription-payment.js', import.meta.url), 'utf8');

test('pool policy maintains a safe ready target for every organisation edition', () => {
  assert.deepEqual(normalizeTenantPoolPolicy({}), {
    TargetReadyPerEdition: { school: 2, faith: 2, organization: 2 },
    DefaultRegion: 'eur3',
    ProjectPrefix: 'dynamax-tenant',
    UpdatedAt: ''
  });
  assert.deepEqual(normalizeTenantPoolPolicy({
    TargetReadyPerEdition: { school: 4, faith: 0, organization: 99 },
    DefaultRegion: 'us-central1',
    ProjectPrefix: 'My Project Pool'
  }).TargetReadyPerEdition, { school: 4, faith: 2, organization: 20 });
});

test('public project slots expose assignment state without credentials', () => {
  const result = publicTenantProjectSlot({
    __id: 'slot-1',
    Edition: 'church',
    Status: 'Ready',
    FirebaseProjectId: 'tenant-1',
    FIREBASE_PRIVATE_KEY: 'must-not-leak'
  });
  assert.equal(result.Id, 'slot-1');
  assert.equal(result.Edition, 'faith');
  assert.equal(result.FirebaseProjectId, 'tenant-1');
  assert.equal('FIREBASE_PRIVATE_KEY' in result, false);
});

test('assignment is concurrency-safe and payment remains recoverable when capacity is empty', () => {
  assert.match(poolSource, /batchCommitDocuments/);
  assert.match(poolSource, /updateTime: candidate\.__updateTime/);
  assert.match(poolSource, /updateTime: registration\.__updateTime/);
  assert.match(poolSource, /FIRESTORE_WRITE_CONFLICT/);
  assert.match(poolSource, /Waiting for ready project/);
  assert.match(poolSource, /ensureTenantPoolCapacity/);
  assert.match(paymentSource, /reserveTenantProjectSlot/);
  assert.match(paymentSource, /workspacePending/);
});

test('tenant pool administration is protected and supports worker lifecycle states', () => {
  assert.match(apiSource, /requirePlatformAdmin/);
  assert.match(apiSource, /claim-next/);
  assert.match(apiSource, /finish-request/);
  assert.match(apiSource, /ensure-capacity/);
  assert.match(apiSource, /issueTenantActivation/);
});
