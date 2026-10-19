import { buildStudentBillingPreview } from '../api/backend.js';
import { loadBranchFinanceRows } from './finance-branch-reads.js';
import { feeRowsForBranch } from './fee-branch-scope.js';
import { parentCreditReview } from './student-billing-diagnostics.js';
import { queryCollectionPages } from './firestore.js';

// Financial reads must finish completely or fail, not silently become empty
// after a database error or stop at the first page of a long payment history.
export async function queryParentFinancialRows(env, collection, references, overrides = {}) {
  const db = { queryCollectionPages, ...overrides };
  const values = [...new Set(references.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!['ledger', 'invoices', 'payments'].includes(collection) || values.length > 30) {
    throw new Error('The selected child’s financial history could not be verified. Contact the Accounts Office.');
  }
  const rows = new Map();
  for (let offset = 0; offset < values.length; offset += 10) {
    const groups = await Promise.all(['AccountRef', 'AdmissionNo', 'ApplicationReference', 'accountRef', 'admissionNo', 'applicationReference'].map((field) =>
      db.queryCollectionPages(env, collection, { filters: [{ field, op: 'in', value: values.slice(offset, offset + 10) }], pageSize: 250, maxRows: 2000 })));
    for (const row of groups.flat()) rows.set(row.__name || row.__id || JSON.stringify(row), row);
  }
  return [...rows.values()];
}

// Called only after the parent and selected child's branch/section are verified.
// Reuse those scoped financial rows. No writes or school-wide financial scans.
export async function reviewParentFeeCredit(env, child, summary, data, overrides = {}) {
  if (!(summary.CreditBalance > 0)) return null;
  const deps = { loadBranchFinanceRows, buildStudentBillingPreview, ...overrides };
  if (child.SourceType === 'Application' || !child.BranchId || child.BranchId === 'all' ||
      !child.AcademicSession || !child.Term || String(child.ProfileCompletionStatus).toLowerCase() !== 'complete') return parentCreditReview(null);
  try {
    const fees = await deps.loadBranchFinanceRows(env, 'feeItems', child.BranchId, { report: true });
    const preview = await deps.buildStudentBillingPreview(child, { ...data,
      feeItems: feeRowsForBranch(fees, child.BranchId) });
    // Expose only the status and explanation, not invoice IDs or fee catalogue.
    return parentCreditReview(preview);
  } catch {
    // A missing/failed catalogue check must never label credit as verified.
    return parentCreditReview(null);
  }
}
