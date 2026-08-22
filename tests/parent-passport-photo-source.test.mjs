import test from 'node:test';
import assert from 'node:assert/strict';

import { parentPassportPhotoSource } from '../functions/api/parent-dashboard.js';

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
