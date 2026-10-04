export const BILLING_QUOTA_BLOCK_CODE = 'GOOGLE_BILLING_PROJECT_QUOTA';
export const BILLING_QUOTA_BLOCK_MESSAGE = 'Blocked—Google quota increase required. Google Cloud billing project quota is exhausted; automatic provisioning is paused until an administrator confirms the quota issue is resolved.';

export function isBillingQuotaBlockedRequest(request = {}) {
  return String(request.Status || '').toLowerCase() === 'blocked'
    && request.BlockedCode === BILLING_QUOTA_BLOCK_CODE;
}

// Inspect the provider's diagnostic, not just the generic subprocess exit code.
// Other FAILED_PRECONDITION, permission and temporary errors are not quota blocks.
export function provisioningFailure(error) {
  let current = error;
  let diagnostic = '';
  for (let depth = 0; current && depth < 5; depth += 1, current = current.cause) {
    if (current.code === BILLING_QUOTA_BLOCK_CODE) {
      return { blocked: true, code: BILLING_QUOTA_BLOCK_CODE, message: BILLING_QUOTA_BLOCK_MESSAGE };
    }
    diagnostic += ` ${String(current.message || current).slice(0, 8000)} ${String(current.stderr || '').slice(0, 16000)}`;
  }
  const blocked = /cloud billing quota exceeded|billing_quota_increase/i.test(diagnostic);
  return { blocked, code: blocked ? BILLING_QUOTA_BLOCK_CODE : '',
    message: blocked ? BILLING_QUOTA_BLOCK_MESSAGE : String(error?.message || error || 'Provisioning failed.').slice(0, 2000) };
}
