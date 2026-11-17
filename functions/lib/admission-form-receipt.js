const code = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function admissionFormReceiptNumber(reference, schoolCode, checkoutDate) {
  const date = new Date(checkoutDate);
  const year = Number.isNaN(date.getTime()) ? new Date().getUTCFullYear() : date.getUTCFullYear();
  const suffix = code(reference).slice(-6);
  if (!suffix) throw new Error('The admission form receipt requires a payment reference.');
  return `${code(schoolCode) || 'ORG'}/FORM/${year}/${suffix}`;
}

export async function resolveAdmissionFormReceipt({ reference, intent, paymentDate, lookupExisting, lookupCode }) {
  const saved = String(intent?.ReceiptNo || '').trim();
  if (saved) return saved;

  // Check older checkouts for a recorded sale even if their intent was never completed.
  // New checkouts reserve the number in the intent before contacting the gateway.
  const existing = await lookupExisting(reference);
  if (existing) return existing;

  const prefix = /^([A-Z0-9]+)-FORM-/i.exec(reference)?.[1];
  return admissionFormReceiptNumber(reference, prefix || await lookupCode(), intent?.CreatedAt || paymentDate);
}
