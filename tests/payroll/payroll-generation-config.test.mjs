import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { getPayrollTaxConfiguration, PAYROLL_TAX_COLLECTIONS } from '../../functions/lib/payroll/tax-config-service.js';
import { assertPayrollCanRegenerate } from '../../functions/lib/payroll/payroll-run-guards.js';
import * as branch from '../../functions/lib/accounting-branch-scope.js';

const backend = await readFile(new URL('../../functions/api/backend.js', import.meta.url), 'utf8');
const start = backend.indexOf('async function generatePayrollRun(');
const end = backend.indexOf('\nasync function savePayrollRunStatus(', start);
const handler = backend.slice(start, end);
const collections = [...Object.values(PAYROLL_TAX_COLLECTIONS), 'payrollRuns', 'payrollItems'];

test('strict payroll configuration reads fail closed while preview compatibility is retained', async () => {
  for (const failed of collections) {
    const listCollection = async (_env, collection) => { if (collection === failed) throw new Error(`Unavailable ${failed}`); return []; };
    await assert.rejects(getPayrollTaxConfiguration({}, { strictReads: true, listCollection }), new RegExp(`Unavailable ${failed}`));
    const preview = await getPayrollTaxConfiguration({}, { listCollection });
    assert.deepEqual(preview.overrides, []);
  }
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: generation never clears an approved override or writes payroll after a required configuration read fails`, async () => {
    for (const failed of collections) {
      const run = { RunId: 'R1', BranchId: 'main', Status: 'Draft', RequiresRecalculation: 'YES' };
      const profile = { EmployeeId: 'E1', BranchId: 'main', Active: 'YES', CalculationMode: 'CONFIGURABLE_PAYE' };
      let writes = 0, calculations = 0, strict = false;
      const clean = value => String(value ?? '').trim();
      const context = {
        withStaffEmployment: async (_env, rows) => rows, employmentPayrollProfile: row => row,
        ...branch, clean, lower: value => clean(value).toLowerCase(), assertPayrollCanRegenerate,
        sameText: (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase(), safeDocumentId: clean,
        requireAccountingRole: () => {}, yesNo: value => clean(value).toUpperCase(), PAYROLL_GENERATION_PROFILE_LIMIT: 250,
        listCollection: async (_env, collection) => collection === 'payrollRuns' ? [run] : collection === 'payrollProfiles' ? [profile] : [],
        getPayrollTaxConfiguration: async (env, options) => {
          strict = options?.strictReads;
          return getPayrollTaxConfiguration(env, { ...options, listCollection: async (_env, collection) => {
            if (collection === failed) throw new Error(`Unavailable ${failed}`);
            return collection === PAYROLL_TAX_COLLECTIONS.overrides ? [{ OverrideId: 'OVR1', RunId: 'R1', EmployeeId: 'E1', Status: 'Approved', OverridePaye: 5 }] : [];
          } });
        },
        calculateConfigurablePayroll: () => { calculations += 1; },
        commitPayrollMutation: async () => { writes += 1; }
      };
      const generate = vm.runInNewContext(`(${handler})`, context);
      await assert.rejects(generate({ ORGANIZATION_EDITION: edition }, { RunId: 'R1', Month: '2026-10', BranchId: 'main', UserBranchId: 'main' }), new RegExp(`Unavailable ${failed}`));
      assert.equal(strict, true); assert.equal(writes, 0); assert.equal(calculations, 0); assert.equal(run.RequiresRecalculation, 'YES');
    }
  });
}
