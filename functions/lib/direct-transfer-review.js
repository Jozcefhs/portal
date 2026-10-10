import { batchCommitDocuments, updateDocumentIfCurrent } from './firestore.js';
import { createNotification, normalizeNotification, parentTransferRejectionNotification } from './notifications.js';

const clean = value => String(value ?? '').trim();
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// The caller must authenticate the officer and verify the transfer's scope.
export async function rejectDirectTransfer(env, reference, transfer, user, inputReason, options = {}) {
  const reason = clean(inputReason).slice(0, 500);
  if (!reason) throw fail('Enter the reason for rejecting this transfer.');
  const alreadyRejected = clean(transfer.Status) === 'Rejected';
  if (!alreadyRejected && clean(transfer.Status) !== 'Awaiting Verification') throw fail('This transfer has already been processed.', 409);
  if (!alreadyRejected && clean(transfer.VerificationError)) throw fail('This transfer has a previous approval attempt. Retry approval so its dependent records can be completed.', 409);
  if (alreadyRejected && reason !== clean(transfer.RejectionReason)) throw fail('This transfer was already rejected. Its saved rejection reason cannot be replaced.', 409);
  const reviewed = { ...transfer };
  for (const key of Object.keys(reviewed)) if (key.startsWith('__')) delete reviewed[key];
  reviewed.Reference ||= reference;
  if (!alreadyRejected) Object.assign(reviewed, {
    Status: 'Rejected', RejectionReason: reason,
    ReviewedAt: options.now || new Date().toISOString(),
    ReviewedBy: clean(user.displayName || user.username),
    UpdatedAt: options.now || new Date().toISOString()
  });
  const parentEvent = reviewed.Context === 'school-payment' ? parentTransferRejectionNotification(reviewed) : null;
  if (!alreadyRejected) {
    if (parentEvent) {
      const updateTime = clean(transfer.__updateTime || transfer.updateTime);
      if (!updateTime) throw fail('Reload this transfer before rejecting it.', 428);
      const notice = normalizeNotification({ ...parentEvent, SchoolId: env.DYNAMAX_WORKSPACE_ID });
      // Persist the rejection and parent inbox notice together. A racing approval
      // or a failed commit cannot leave a rejected payment without its notice.
      await (options.batchCommitDocuments || batchCommitDocuments)(env, [
        { collectionPath: 'directTransferRequests', documentId: reference, data: reviewed, updateTime },
        { collectionPath: 'notifications', documentId: notice.NotificationId, data: notice, exists: false }
      ]);
    } else await (options.updateDocumentIfCurrent || updateDocumentIfCurrent)(env, 'directTransferRequests', reference, reviewed, transfer);
  }
  let notification = null;
  if (parentEvent) {
    try {
      // Reuses the same event on retry. The push engine also deduplicates each
      // recipient/device delivery; the rejected transfer is never re-posted.
      notification = await (options.createNotification || createNotification)(env, parentEvent);
    } catch (error) {
      notification = { ok: false, message: clean(error.message || error) };
    }
  }
  const noticeSaved = !alreadyRejected || Boolean(notification?.notification);
  const pushNeedsAttention = notification?.ok === false || notification?.pushDeliveries?.some(row => clean(row.status).toLowerCase() === 'failed');
  const noticeMessage = !parentEvent ? '' : !noticeSaved
    ? ' The rejection is saved, but the parent notification could not be saved. Retry the rejection with the same reason.'
    : pushNeedsAttention
    ? ' The parent rejection notice is available in the dashboard; browser push needs attention.'
    : ' The parent rejection notice is available in the dashboard. Browser push follows their notification settings.';
  return { ok: true, alreadyRejected, notification, message: `Transfer rejected. No receipt or accounting entry was created.${noticeMessage}` };
}
