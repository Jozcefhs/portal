import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichChildrenWithLinkedPassportPhotos,
  parentPassportPhotoSource
} from '../functions/api/parent-dashboard.js';

test('linked application passports retain their application scope for the image proxy', () => {
  const source = parentPassportPhotoSource({
    __id: 'DCA-24-101',
    __scopePath: 'schoolBranches/main/sections/secondary/applications',
    ApplicationReference: 'DCA/24/101',
    documents: {
      PassportPhotograph: {
        url: 'r2://dynamax-documents/v1/school/school/admissions/main/secondary/dca-24-101/passport/file.jpg'
      }
    }
  });

  assert.deepEqual(source, {
    PassportPhotoAvailable: true,
    PassportPhotoApplicationReference: 'DCA/24/101',
    PassportPhotoScopePath: 'schoolBranches/main/sections/secondary/applications'
  });
});

test('enrolled student passports retain their student scope', () => {
  const source = parentPassportPhotoSource({
    __id: 'DCA-24-101',
    __scopePath: 'schoolBranches/main/sections/secondary/students',
    AdmissionNo: 'DCA/24/101',
    DocPassportPhotographUrl: 'r2://dynamax-documents/v1/school/school/admissions/main/secondary/dca-24-101/passport/file.jpg'
  });

  assert.equal(source.PassportPhotoAvailable, true);
  assert.equal(source.PassportPhotoApplicationReference, 'DCA/24/101');
  assert.equal(source.PassportPhotoScopePath, 'schoolBranches/main/sections/secondary/students');
});

test('records without a passport stay unavailable while keeping a stable lookup target', () => {
  const source = parentPassportPhotoSource({
    __id: 'DCA-25-006',
    __scopePath: 'schoolBranches/main/sections/secondary/students',
    AdmissionNo: 'DCA/25/006'
  });

  assert.equal(source.PassportPhotoAvailable, false);
  assert.equal(source.PassportPhotoApplicationReference, 'DCA/25/006');
  assert.equal(source.PassportPhotoScopePath, 'schoolBranches/main/sections/secondary/students');
});

test('an enrolled child inherits a passport from its exact scoped admission record', async () => {
  const child = {
    __id: 'DCA-24-101',
    __scopePath: 'schoolBranches/main/sections/secondary/students',
    AdmissionNo: 'DCA/24/101',
    AccountRef: 'DCA/24/101',
    DisplayName: 'Emmanuel Peter',
    ParentEmail: 'parent@example.com',
    PassportPhotoAvailable: false
  };
  const reads = [];

  await enrichChildrenWithLinkedPassportPhotos({}, [child], [], {
    getDocument: async (_env, scopePath, documentId) => {
      reads.push({ scopePath, documentId });
      return {
        __id: 'DCA-24-101',
        AdmissionNo: 'DCA/24/101',
        ApplicantName: 'Emmanuel Peter',
        VerificationEmail: 'Parent@Example.com',
        documents: {
          PassportPhotograph: {
            url: 'r2://dynamax-documents/v1/school/school/admissions/main/secondary/dca-24-101/passport/file.jpg'
          }
        }
      };
    }
  });

  assert.deepEqual(reads, [{
    scopePath: 'schoolBranches/main/sections/secondary/applications',
    documentId: 'DCA-24-101'
  }]);
  assert.equal(child.PassportPhotoAvailable, true);
  assert.equal(child.PassportPhotoApplicationReference, 'DCA/24/101');
  assert.equal(child.PassportPhotoScopePath, 'schoolBranches/main/sections/secondary/applications');
});

test('linked passport fallback never reads outside the selected child scope', async () => {
  const child = {
    __id: 'DCA-25-006',
    __scopePath: 'schoolBranches/main/sections/secondary/students',
    AdmissionNo: 'DCA/25/006',
    AccountRef: 'DCA/25/006',
    PassportPhotoAvailable: false
  };
  const reads = [];

  await enrichChildrenWithLinkedPassportPhotos({}, [child], [], {
    getDocument: async (_env, scopePath, documentId) => {
      reads.push({ scopePath, documentId });
      return null;
    }
  });

  assert.ok(reads.length >= 1);
  assert.ok(reads.every((read) => read.scopePath === 'schoolBranches/main/sections/secondary/applications'));
  assert.equal(child.PassportPhotoAvailable, false);
});
