import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const financeWorkflow = await readFile(new URL('../functions/api/finance-workflow.js', import.meta.url), 'utf8');
const deploymentIdentity = await readFile(new URL('../functions/lib/deployment-identity.js', import.meta.url), 'utf8');
const staffAuth = await readFile(new URL('../functions/lib/staff-auth.js', import.meta.url), 'utf8');
const accountingReferenceCache = await readFile(new URL('../functions/lib/accounting-reference-cache.js', import.meta.url), 'utf8');
const settingsApi = await readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8');
const schoolScope = await readFile(new URL('../functions/lib/school-scope.js', import.meta.url), 'utf8');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('fee mutations use direct reads and one batch write instead of collection scans', () => {
  const singleSave = section(backend, 'async function saveFeeItem(', 'async function saveFeeItems(');
  const batchSave = section(backend, 'async function saveFeeItems(', 'async function deleteFeeItem(');

  assert.match(singleSave, /getDocumentByIdOrField\(env, 'feeItems'/);
  assert.doesNotMatch(singleSave, /listCollection\(env, 'feeItems'/);
  assert.match(batchSave, /batchUpsertDocuments/);
  assert.doesNotMatch(batchSave, /listCollection\(env, 'feeItems'/);
  assert.doesNotMatch(batchSave, /getDocumentByIdOrField\(env, 'feeItems'/);
  assert.match(backend, /case 'saveFeeItems':/);
});

test('record mutations avoid whole accounting collection reads', () => {
  const journalSave = section(backend, 'export async function saveAccountingJournal(', 'async function syncRevenueToAccounting(');
  const desktopImprest = section(backend, 'async function submitAccountingImprest(', 'async function reviewAccountingImprest(');
  const webImprest = section(financeWorkflow, 'async function submitImprest(', 'async function reviewImprest(');

  assert.doesNotMatch(journalSave, /listCollection\(env, 'accountingJournals'/);
  assert.match(desktopImprest, /accountingImprestOpenClaims/);
  assert.doesNotMatch(desktopImprest, /listCollection\(env, 'accountingImprests'/);
  assert.match(webImprest, /accountingImprestOpenClaims/);
  assert.doesNotMatch(webImprest, /listCollection\(env, 'accountingImprests'/);
});

test('journal validation reuses cached chart reference data', () => {
  const journalSave = section(backend, 'export async function saveAccountingJournal(', 'async function syncRevenueToAccounting(');
  const chartSeed = section(backend, 'async function seedAccountingChart(', 'async function accountingPeriodIsClosed(');

  assert.match(journalSave, /getAccountingChartRows\(env\)/);
  assert.doesNotMatch(journalSave, /listCollection\(env, 'chartOfAccounts'/);
  assert.match(chartSeed, /getAccountingChartRows\(env\)/);
  assert.match(chartSeed, /batchUpsertDocuments/);
  assert.match(accountingReferenceCache, /REFERENCE_CACHE_MS = 60 \* 1000/);
  assert.match(accountingReferenceCache, /invalidateAccountingChartRows/);
});

test('stable identity and staff access configuration reuse one-minute isolate caches', () => {
  assert.match(deploymentIdentity, /DEPLOYMENT_IDENTITY_CACHE_MS = 60 \* 1000/);
  assert.match(staffAuth, /ACCESS_CONFIG_CACHE_MS = 60 \* 1000/);
  assert.match(deploymentIdentity, /invalidateDeploymentIdentityCache/);
  assert.match(staffAuth, /invalidateStaffAccessCache/);
  assert.match(settingsApi, /PROFILE_CACHE_MS = 60 \* 1000/);
  assert.match(schoolScope, /SCHOOL_STRUCTURE_CACHE_MS = 60 \* 1000/);
});
