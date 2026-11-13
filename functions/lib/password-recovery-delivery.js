import { batchCommitLiteralDocuments } from './firestore.js';
import { sendConfiguredEmail } from './email-service.js';

// Recovery records already exist before sending. Attach the provider receipt to
// that record so failures can be diagnosed without storing codes or email bodies.
// Never automatically resend when acceptance is uncertain.
export async function deliverPasswordRecovery(env, collectionPath, documentId, message, dependencies = {}) {
  const send = dependencies.sendConfiguredEmail || sendConfiguredEmail;
  const commit = dependencies.batchCommitLiteralDocuments || batchCommitLiteralDocuments;
  let delivery, failure;
  try { delivery = await send(env, message); }
  catch (error) { failure = error; }
  const safeCode = value => /^(?:BREVO|GMAIL|EMAIL)_[A-Z_]+$/.test(String(value || '')) ? value : 'EMAIL_DELIVERY_UNCONFIRMED';
  const data = {
    DeliveryStatus: failure ? failure.retrySafe === true ? 'Rejected' : 'Unconfirmed' : 'Accepted',
    DeliveryCheckedAt: new Date().toISOString(),
    DeliveryProvider: ['brevo','gmail'].includes(delivery?.provider || failure?.provider) ? (delivery?.provider || failure?.provider) : '',
    DeliveryMessageId: String(delivery?.providerMessageId || '').slice(0, 300),
    DeliveryFailureCode: failure ? safeCode(failure.code) : ''
  };
  try {
    await commit(env, [{ collectionPath, documentId, exists: true, data, updateMask: Object.keys(data) }]);
  } catch {
    // A receipt-write failure must not trigger a second email or invalidate a
    // code already delivered. Do not overwrite UsedAt during concurrent resets.
    console.error(JSON.stringify({event:'password_recovery_receipt_unconfirmed',kind:collectionPath}));
  }
  if (failure) {
    console.error(JSON.stringify({event:'password_recovery_delivery_failed',kind:collectionPath,
      status:data.DeliveryStatus,provider:data.DeliveryProvider,failureCode:data.DeliveryFailureCode}));
    throw failure;
  }
  return delivery;
}
