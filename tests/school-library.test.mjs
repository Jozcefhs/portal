import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { normalizeLibraryPolicy } from '../functions/lib/school-library.js';
import { featureFlagsForEdition, filterSectionsForFeatures } from '../functions/lib/organization-config.js';
import { defaultModulesForRole } from '../functions/lib/role-module-access.js';
import {
  SUBSCRIPTION_FLEX_PRICE_ESTIMATES_USD,
  defaultSubscriptionPlanCatalog,
  normalizeSubscriptionPlanCatalog,
  subscriptionFlexQuote,
  subscriptionModulesForEdition
} from '../functions/lib/subscription-plans.js';

const root = new URL('../', import.meta.url);
const [service, endpoint, desktopEndpoint, admin, parentApi, parentJs, parentHtml, scheduler, css] = await Promise.all([
  'functions/lib/school-library.js', 'functions/api/staff-library.js', 'functions/api/backend.js', 'js/admin.js',
  'functions/api/parent-dashboard.js', 'js/parent-dashboard.js', 'parent-dashboard.html',
  'functions/api/notification-scheduler.js', 'css/style.css'
].map((path) => readFile(new URL(path, root), 'utf8')));

test('Library is school-only, licensed separately and priced on Flex', () => {
  const school = subscriptionModulesForEdition('school');
  assert.equal(SUBSCRIPTION_FLEX_PRICE_ESTIMATES_USD.library, 3);
  assert.deepEqual(school.find((row) => row.Key === 'library')?.Requires, ['students']);
  assert.equal(subscriptionModulesForEdition('faith').some((row) => row.Key === 'library'), false);
  assert.equal(featureFlagsForEdition('school').library, true);
  assert.equal(featureFlagsForEdition('faith').library, false);
  assert.deepEqual(filterSectionsForFeatures(['library'], featureFlagsForEdition('faith')), []);
  assert.ok(defaultModulesForRole('Librarian', { edition: 'school', featureFlags: featureFlagsForEdition('school') }).includes('library'));
  assert.equal(defaultModulesForRole('Librarian', { edition: 'faith', featureFlags: featureFlagsForEdition('faith') }).includes('library'), false);
  const fresh = defaultSubscriptionPlanCatalog();
  assert.deepEqual(fresh.Plans.Flex.ModulePricesByEdition.school.library, { MonthlyAmount: 4050, YearlyAmount: 40500 });
  assert.ok(fresh.Plans.Professional.EntitlementsByEdition.school.includes('library'));
  assert.ok(fresh.Plans.Enterprise.EntitlementsByEdition.school.includes('library'));
  assert.equal(fresh.Plans.Standard.EntitlementsByEdition.school.includes('library'), false);
  const old = normalizeSubscriptionPlanCatalog({
    ModuleCatalogVersion: 9, Currency: 'NGN', UsdToNgnRate: 1350,
    Plans: { Flex: { Active: true, MonthlyAmount: 1000, YearlyAmount: 10000 } }
  });
  assert.deepEqual(old.Plans.Flex.ModulePricesByEdition.school.library, { MonthlyAmount: 4050, YearlyAmount: 40500 });
  const quote = subscriptionFlexQuote(old, 'school', ['library'], 1, 'monthly');
  assert.equal(quote.Amount, 5050 + old.Plans.Flex.ModulePricesByEdition.school.students.MonthlyAmount);
});

test('lending rules reject invalid limits', () => {
  assert.deepEqual(normalizeLibraryPolicy(), {
    StudentLoanDays: 14, StudentLoanLimit: 3, StaffLoanDays: 21,
    StaffLoanLimit: 5, MaxRenewals: 1
  });
  assert.throws(() => normalizeLibraryPolicy({ StudentLoanDays: 0 }), /greater than zero/i);
  assert.throws(() => normalizeLibraryPolicy({ StudentLoanLimit: 1.5 }), /valid student loan limit/i);
  assert.throws(() => normalizeLibraryPolicy({ MaxRenewals: 51 }), /valid max renewals/i);
});

test('library mutations are authenticated, branch-scoped, versioned and atomic', () => {
  assert.match(endpoint, /requireStaffSession\(env, request\)/);
  assert.match(endpoint, /handleSchoolLibraryAction\(env, user, body\)/);
  assert.match(desktopEndpoint, /case 'getSchoolLibrary':/);
  assert.match(desktopEndpoint, /staffAccessFor\(env,/);
  assert.match(desktopEndpoint, /case 'checkoutLibraryCopy':/);
  assert.match(service, /allowedSections \|\| \[\]\)\.includes\('library'\)/);
  assert.match(service, /enforceActorBranch\(/);
  assert.match(service, /batchCommitDocuments\(env, \[/);
  assert.match(service, /write\('copies', copy\.CopyId, nextCopy, current\(copy\)\)/);
  assert.match(service, /write\('loans', LoanId, loan, \{ exists: false \}\)/);
  assert.match(service, /write\('borrowers', borrowerId, nextState, state \? current\(state\) : \{ exists: false \}\)/);
  assert.match(service, /if \(copy\.Status !== 'Available'\)/);
  assert.match(service, /if \(loan\.Status !== 'On Loan'\)/);
  assert.match(service, /audit\(user, branchId, 'Check out book copy'/);
  assert.match(service, /branchCollection\(env, 'loans', branchId\)/);
});

test('staff and parent surfaces show the same scoped loans with due reminders', () => {
  assert.match(admin, /\['library', 'School Library'\]/);
  assert.match(admin, /data-library-action="checkout"/);
  assert.match(admin, /data-library-return=/);
  assert.match(admin, /loadSchoolLibrary\(\)/);
  assert.match(css, /\.school-library-summary/);
  assert.match(parentApi, /queryRowsForReferences\(env, 'libraryLoans', \['BorrowerRef'\], keys\)/);
  assert.match(parentApi, /recordMatchesSelectedChildScope\(row, selectedScope\)/);
  assert.match(parentHtml, /id="parentLibraryLoans"/);
  assert.match(parentJs, /renderLibraryLoans\(child\)/);
  assert.match(scheduler, /processLibraryDueReminders/);
  assert.match(service, /\[3, 1, 0, -1, -7\]/);
});
