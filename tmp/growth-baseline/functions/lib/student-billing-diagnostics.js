// Read-only descriptions of configured fees versus posted invoices. A charge
// difference is not a payment, an outstanding balance, or confirmed excess cash.
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

export function billingComponentDiagnostics(row) {
  const issues = [];
  const missing = row.expected > 0 && row.invoiced === 0 && !row.invoiceIds.length;
  if (missing) issues.push('Missing charge — not yet invoiced');
  else if (row.expected === 0 && row.invoiced > 0) issues.push('Posted charge does not apply under the current fee setup');
  else if (Math.abs(row.difference) >= 0.005) issues.push('Posted amount differs from the current fee setup');
  if (row.invoiceIds.length > 1) issues.push(`${row.invoiceIds.length} invoices use this component — check for duplication`);
  return { ...row, missing, conflict: !missing && issues.length > 0,
    review: issues.join('; ') || 'Matches the current fee setup' };
}

export function billingDiagnostics(rows) {
  const missing = rows.filter((row) => row.missing);
  const conflicts = rows.filter((row) => row.conflict);
  return {
    status: missing.length || conflicts.length ? 'needs_review' : 'matched',
    missingCount: missing.length, conflictCount: conflicts.length,
    missingTotal: money(missing.reduce((sum, row) => sum + row.expected, 0)),
    conflictCodes: conflicts.map((row) => row.code)
  };
}

export function parentCreditReview(preview) {
  const review = preview?.billingReview;
  if (!['matched', 'needs_review'].includes(review?.status) || !preview.profile?.AcademicSession || !preview.profile?.Term ||
      String(preview.profile.ProfileCompletionStatus).toLowerCase() !== 'complete' || !preview.rows?.length) {
    return { status: 'unverified', message: 'The fee bill has not been fully verified. This recorded credit is provisional, not confirmed excess money. Please contact the Accounts Office before requesting a transfer or refund.' };
  }
  if (review.status === 'needs_review') {
    return { status: 'needs_review', missingCount: review.missingCount, conflictCount: review.conflictCount,
      message: 'The fee bill has missing or conflicting charges. This recorded credit is provisional, not confirmed excess money. The Accounts Office must review the bill before confirming any excess. Payments already received remain recorded.' };
  }
  return { status: 'matched', message: 'Recorded fee credit is calculated from posted charges and payments. The current period matches the saved fee setup. The Accounts Office must confirm any transferable or refundable excess; future charges may still use this credit.' };
}
