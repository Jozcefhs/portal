import test from 'node:test';
import assert from 'node:assert/strict';

import { studentMatchesEnrollmentApplication } from '../functions/api/backend.js';


test('enrollment reconciliation accepts the assigned student with an added middle name', () => {
  assert.equal(studentMatchesEnrollmentApplication({
    FirstName: 'Adira',
    MiddleName: 'Nneka',
    Surname: 'El-kanah',
    DisplayName: 'Adira Nneka El-kanah',
    DateOfBirth: '2012-06-03'
  }, {
    FirstName: 'Adira',
    Surname: 'El-kanah',
    ApplicantName: 'Adira El-kanah',
    DateOfBirth: '2012-06-03'
  }), true);
});

test('enrollment reconciliation rejects an admission number owned by another person', () => {
  assert.equal(studentMatchesEnrollmentApplication({
    FirstName: 'Greg',
    Surname: 'Emmanuel',
    DisplayName: 'Greg Emmanuel'
  }, {
    FirstName: 'Dean',
    Surname: 'John',
    ApplicantName: 'Dean John'
  }), false);
});

test('enrollment reconciliation rejects a conflicting date of birth', () => {
  assert.equal(studentMatchesEnrollmentApplication({
    FirstName: 'Adira',
    Surname: 'El-kanah',
    DateOfBirth: '2011-06-03'
  }, {
    FirstName: 'Adira',
    Surname: 'El-kanah',
    DateOfBirth: '2012-06-03'
  }), false);
});
