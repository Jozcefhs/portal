import { fail } from './hospital-model.js';
import { dateFilters } from './hospital-orders-model.js';
import { balances, netPaid } from './hospital-billing-model.js';

const payers = ['Patient', 'Hmo', 'Corporate'];
const invoiceFields = payers.flatMap(payer =>
  ['Cents', 'CreditCents', 'PaidCents', 'RefundCents', 'AllocationReturnCents'].map(field => payer + field));

export function createBillingReport({ requireCapability, branch, clock, page, eq }) {
  return async function billingReport(body) {
    const claims = body.Report === 'claims';
    if (!claims && body.Report !== 'invoices') fail('Choose a billing report.');
    requireCapability(claims ? 'hmo.work' : 'billing.read');
    const dates = dateFilters(body.DateRange);
    const branchId = await branch(body);
    const now = clock();
    const readTime = body.Cursor ? body.ReadTime : now;
    const instant = Date.parse(readTime);
    if (!Number.isFinite(instant) || new Date(instant).toISOString() !== readTime ||
        instant > Date.parse(now) || Date.parse(now) - instant > 55 * 60000) {
      fail('Refresh the report to start a new snapshot.', 409);
    }
    const fields = claims ? ['Insurer', 'Status', 'AmountCents', 'SettledCents'] : invoiceFields;
    const { rows, next } = await page(claims ? 'Claims' : 'Invoices',
      [eq('BranchId', branchId), ...dates], 'CreatedAt', body, { select: ['CreatedAt', ...fields], readTime });
    const groups = new Map();
    let unpaid = 0;
    for (const row of rows) {
      if (claims) {
        const insurer = row.Insurer || 'Unspecified insurer';
        const status = row.Status || 'Unspecified status';
        const key = JSON.stringify([insurer, status]);
        const group = groups.get(key) || { label: insurer, status, count: 0, claimed: 0, settled: 0 };
        group.count++;
        group.claimed += row.AmountCents || 0;
        group.settled += row.SettledCents || 0;
        groups.set(key, group);
      } else {
        const due = balances(row);
        let owes = false;
        for (const payer of payers) {
          const group = groups.get(payer) || { label: payer === 'Hmo' ? 'HMO' : payer, billed: 0, credits: 0, applied: 0, outstanding: 0, overpaid: 0 };
          const balance = due[payer+'BalanceCents'];
          if (!Number.isSafeInteger(balance)) fail('An invoice balance needs review before this report can be totalled.', 409);
          group.billed += row[payer+'Cents'] || 0;
          group.credits += row[payer+'CreditCents'] || 0;
          group.applied += netPaid(row, payer);
          group.outstanding += Math.max(balance, 0);
          group.overpaid += Math.max(-balance, 0);
          if (balance > 0) owes = true;
          groups.set(payer, group);
        }
        if (owes) unpaid++;
      }
    }
    return { ok: true, groups: [...groups.values()], count: rows.length, unpaid, next, readTime };
  };
}
