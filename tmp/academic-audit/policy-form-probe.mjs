import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeAcademicPolicy } from '../../functions/lib/academic-policy.js';
import { evaluateAcademicResultAccess } from '../../functions/lib/academic-result-access.js';

// Read-only audit: run the actual form serializer against a synthetic DOM model.
const source = await readFile(new URL('../../js/setup.js', import.meta.url), 'utf8');
const start = source.indexOf('function academicPolicyFromForm(');
const end = source.indexOf('function renderAcademicPolicyIssues(', start);
const input = (value = '', checked = false) => ({ value, checked });
const component = (name, midTerm) => ({
  dataset: { policyId: '' },
  children: [input(name), input('50'), input('50'), input('manual'),
    input('', false), input('50'), input('0'), input('', true), input('', midTerm)]
});
const fields = {
  academicComponents: { children: [component('First Test', false), component('Second Test', true)] },
  academicGradeBands: { children: [] },
  academicCumulativeTerms: { children: [] },
  academicMidTermEnabled: input('', true)
};
const context = {
  policyField: id => fields[id] || input(),
  policyNumber: (_id, fallback = null) => fallback,
  policyList: () => []
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const result = normalizeAcademicPolicy(context.academicPolicyFromForm());
assert.equal(result.MidTerm.ComponentIds[0], result.Assessment.Components[0].Id);
assert.notEqual(result.MidTerm.ComponentIds[0], result.Assessment.Components[1].Id);
console.log(JSON.stringify({
  probe: 'new policy selects second component for midterm',
  selectedName: 'Second Test',
  expectedId: result.Assessment.Components[1].Id,
  serializedId: result.MidTerm.ComponentIds[0]
}));

const accessInput = {
  result: { Status: 'Published' }, hasActivePolicy: true,
  student: { BillingCategory: 'Full Scholarship' }, scholarshipFees: [],
  finance: { TotalDebit: 1000, TotalCredit: 0, OutstandingBalance: 1000 },
  policy: { ResultAccess: { VisibilityMode: 'all-published', FinancialClearance: {
    Mode: 'manual-clearance', RecognizeScholarships: false, AllowManualExemptions: false
  } } }
};
const decision = evaluateAcademicResultAccess(accessInput);
assert.equal(decision.Allowed, true);
assert.equal(decision.Code, 'ELIGIBLE_BY_FULL_SCHOLARSHIP');
console.log(JSON.stringify({
  probe: 'scholarship recognition disabled with manual clearance required and no clearance',
  recognizeScholarships: false, decision
}));
