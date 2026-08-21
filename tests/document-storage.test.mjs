import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteStoredDocument,
  documentStorageConfigured,
  getStoredDocument,
  parseStoredDocumentReference,
  putStoredDocument,
  resolveDocumentStorage
} from '../functions/lib/document-storage.js';

function mockBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, options) {
      const saved = Uint8Array.from(bytes);
      objects.set(key, { bytes: saved, options });
      return { etag: `etag-${saved.byteLength}` };
    },
    async get(key) {
      const saved = objects.get(key);
      if (!saved) return null;
      return {
        body: new Blob([saved.bytes]).stream(),
        async arrayBuffer() { return saved.bytes.buffer.slice(0); },
        httpMetadata: saved.options.httpMetadata,
        customMetadata: saved.options.customMetadata,
        httpEtag: '"etag"'
      };
    },
    async delete(key) { objects.delete(key); }
  };
}

const identity = {
  DYNAMAX_WORKSPACE_ID: 'school',
  ORGANISATION_EDITION: 'school'
};

test('R2 storage is configured only when the deployment binding is usable', async () => {
  assert.equal(documentStorageConfigured({}), false);
  const bucket = mockBucket();
  assert.equal(documentStorageConfigured({ DYNAMAX_DOCUMENTS: bucket }), true);
  assert.deepEqual(await resolveDocumentStorage({ DYNAMAX_DOCUMENTS: bucket }), {
    binding: 'DYNAMAX_DOCUMENTS',
    provider: 'Cloudflare R2',
    configured: true
  });
});

test('R2 writes are deterministic and workspace isolated', async () => {
  const bucket = mockBucket();
  const env = { ...identity, DYNAMAX_DOCUMENTS: bucket };
  const input = {
    category: 'admissions',
    branchId: 'Main Branch',
    schoolSection: 'Secondary',
    ownerId: 'DCA/26/001',
    documentType: 'BirthCertificate',
    operationId: 'upload-operation-1',
    fileName: 'birth.pdf',
    mimeType: 'application/pdf',
    fileBase64: Buffer.from('%PDF-1.7\ntest').toString('base64')
  };
  const first = await putStoredDocument(env, input);
  const second = await putStoredDocument(env, input);
  assert.equal(first.documentUrl, second.documentUrl);
  assert.match(first.documentUrl, /^r2:\/\/dynamax-documents\/v1\/school\/school\/admissions\/main-branch\/secondary\//);
  assert.equal(bucket.objects.size, 1);

  const stored = await getStoredDocument(env, first.documentUrl);
  assert.equal(stored.fileName, 'birth.pdf');
  assert.equal(stored.mimeType, 'application/pdf');
  assert.equal(Buffer.from(await stored.object.arrayBuffer()).toString(), '%PDF-1.7\ntest');

  await assert.rejects(
    () => getStoredDocument({ ...env, DYNAMAX_WORKSPACE_ID: 'another-school' }, first.documentUrl),
    (error) => error.code === 'DOCUMENT_WORKSPACE_MISMATCH'
  );
  await deleteStoredDocument(env, first.documentUrl);
  assert.equal(bucket.objects.size, 0);
});

test('retired Drive URLs fail with an explicit migration error', () => {
  assert.throws(
    () => parseStoredDocumentReference(identity, 'https://drive.google.com/file/d/example/view'),
    (error) => error.code === 'LEGACY_DOCUMENT_NOT_MIGRATED'
  );
});
