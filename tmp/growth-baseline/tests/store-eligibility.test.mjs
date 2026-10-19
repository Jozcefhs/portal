import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeStoreGender, storeGenderMatches, storeItemIsPurchasable } from '../functions/api/init-payment.js';

test('imported gender aliases normalize consistently', () => {
  assert.equal(normalizeStoreGender('F'), 'female');
  assert.equal(normalizeStoreGender('Girl'), 'female');
  assert.equal(normalizeStoreGender('Male Student'), 'male');
});

test('gender-neutral store items remain available to day and boarding students', () => {
  assert.equal(storeGenderMatches('All', 'Female'), true);
  assert.equal(storeGenderMatches('*', 'Male'), true);
  assert.equal(storeGenderMatches('', ''), true);
});

test('gender-specific items accept imported aliases without crossing genders', () => {
  assert.equal(storeGenderMatches('Female', 'Girl'), true);
  assert.equal(storeGenderMatches('Male', 'M'), true);
  assert.equal(storeGenderMatches('Male', 'Female'), false);
});

test('product gender and class describe items without hiding them from another student', () => {
  const maleUniform = { Gender: 'Male', ClassName: 'JSS 2', BranchId: 'main', SchoolSection: 'Secondary' };
  const dayStudent = { Gender: 'Female', ClassName: 'JSS 1', StudentType: 'Day Student', BranchId: 'Main Branch', SchoolSection: 'Secondary' };
  assert.equal(storeItemIsPurchasable(maleUniform, dayStudent), true);
});

test('school section isolation remains enforced for store checkout', () => {
  const secondaryItem = { Gender: 'All', ClassName: 'All', BranchId: 'main', SchoolSection: 'Secondary' };
  const primaryStudent = { ClassName: 'Primary 3', BranchId: 'main', SchoolSection: 'Secondary' };
  assert.equal(storeItemIsPurchasable(secondaryItem, primaryStudent), false);
});
