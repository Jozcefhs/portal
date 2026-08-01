function clean(value) {
  return String(value ?? '').trim();
}

function intentRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function paymentIntentType(value) {
  const intent = intentRecord(value);
  return clean(intent.PaymentType || intent.paymentType || intent.IntentType || intent.intentType);
}

export function paymentIntentReference(value) {
  const intent = intentRecord(value);
  return clean(intent.Reference || intent.reference || intent.PaymentReference || intent.paymentReference);
}
