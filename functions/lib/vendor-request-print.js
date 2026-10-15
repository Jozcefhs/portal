// Report only: never use these display totals to authorise a payment.
export function vendorRequestPrintReport(request) {
  const allocations = new Map((request.Allocations || []).map(a => [a.LotId, Number(a.AmountCents)]));
  const total = { Count: 0, Gross: 0, Refund: 0, Charge: 0, Net: 0, Claimed: 0 };
  const rows = (request.Snapshot || []).map((sale, index) => {
    const row = { ...sale, Serial: index + 1, Claimed: (allocations.get(sale.LotId) || 0) / 100 };
    for (const key of ['Gross','Refund','Charge','Net','Claimed']) {
      const minor = Math.round(Number(row[key] || 0) * 100);
      if (!Number.isSafeInteger(minor)) throw new Error('Invalid saved vendor request amount.');
      total[key] += minor;
    }
    total.Count += 1;
    return row;
  });
  for (const key of ['Gross','Refund','Charge','Net','Claimed']) total[key] /= 100;
  return { rows, total };
}
