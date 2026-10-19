import { getDocument, patchDocumentFields } from './firestore.js';
import { hashTenantActivationToken } from './tenant-activation.js';

export const REGISTRATION_ONBOARDING_TTL_HOURS = 7 * 24;

const encoder = new TextEncoder();
const clean = (value) => String(value ?? '').trim();

function bytesToBase64Url(value) {
  let binary = '';
  new Uint8Array(value).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function secureEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function onboardingError(message, status = 400, code = 'REGISTRATION_ONBOARDING_INVALID') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export async function issueRegistrationOnboarding(platformEnv, registrationReference, requestUrl) {
  const reference = clean(registrationReference);
  const registration = reference
    ? await getDocument(platformEnv, 'tenantRegistrations', reference)
    : null;
  if (!registration) return {};

  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64Url(tokenBytes);
  const tokenHash = await hashTenantActivationToken(token);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + REGISTRATION_ONBOARDING_TTL_HOURS * 60 * 60 * 1000);
  await patchDocumentFields(platformEnv, 'tenantRegistrations', reference, {
    OnboardingStatusTokenHash: tokenHash,
    OnboardingStatusTokenExpiresAt: expiresAt.toISOString(),
    OnboardingStatusTokenIssuedAt: issuedAt.toISOString(),
    UpdatedAt: issuedAt.toISOString()
  });

  const onboardingUrl = new URL('/onboarding-status.html', requestUrl);
  onboardingUrl.hash = new URLSearchParams({ reference, token }).toString();
  return { onboardingUrl: onboardingUrl.href, onboardingExpiresAt: expiresAt.toISOString() };
}

export async function inspectRegistrationOnboarding(platformEnv, registrationReference, token) {
  const reference = clean(registrationReference);
  const registration = reference
    ? await getDocument(platformEnv, 'tenantRegistrations', reference)
    : null;
  const suppliedHash = await hashTenantActivationToken(clean(token));
  if (!registration || !clean(token)
      || !secureEqual(suppliedHash, clean(registration.OnboardingStatusTokenHash))) {
    throw onboardingError('This onboarding status link is invalid.', 404, 'REGISTRATION_ONBOARDING_NOT_FOUND');
  }
  if (Date.parse(clean(registration.OnboardingStatusTokenExpiresAt)) <= Date.now()) {
    throw onboardingError(
      'This onboarding status link has expired. Submit the organisation registration again to receive a fresh link.',
      410,
      'REGISTRATION_ONBOARDING_EXPIRED'
    );
  }
  return registration;
}
