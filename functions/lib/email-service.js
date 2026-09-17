import { getDocument } from './firestore.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { effectiveBranchProfile } from './branch-profile-settings.js';
import {
  classifyGmailFailure,
  gmailFailureError,
  submitGmailEmail
} from './gmail-email-provider.js';

function clean(value) {
  return String(value ?? '').trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
}

export function resolveEmailSenderProfile(env = {}, {
  brevo = {},
  organizationProfile = {},
  schoolProfile = {},
  senderProfile = ''
} = {}) {
  const organization = resolveOrganizationConfig({
    env,
    organizationProfile,
    legacyProfile: schoolProfile
  });
  const organisationScoped = organization.Edition !== 'school';
  const sharedSenderEmail = clean(organisationScoped
    ? (
        organizationProfile?.OrganisationSenderEmail
        || brevo?.OrganisationSenderEmail
        || env.ORGANISATION_SENDER_EMAIL
        || env.ORGANIZATION_SENDER_EMAIL
        || env.DYNAMAX_SENDER_EMAIL
        || env.CHURCH_EMAIL
      )
    : (
        schoolProfile?.BrevoSenderEmail
        || brevo?.BrevoSenderEmail
        || env.DYNAMAX_SENDER_EMAIL
        || env.BREVO_SENDER_EMAIL
        || env.SCHOOL_EMAIL
      ));
  const sharedSenderName = clean(organisationScoped
    ? (
        organizationProfile?.OrganisationSenderName
        || brevo?.OrganisationSenderName
        || env.ORGANISATION_SENDER_NAME
        || env.ORGANIZATION_SENDER_NAME
        || env.DYNAMAX_SENDER_NAME
        || organization.Name
      )
    : (
        schoolProfile?.BrevoSenderName
        || brevo?.BrevoSenderName
        || env.DYNAMAX_SENDER_NAME
        || env.BREVO_SENDER_NAME
        || schoolProfile?.SchoolName
        || env.SCHOOL_NAME
        || organization.Name
      )) || 'Dynamax';
  const useExecutiveProfile = clean(senderProfile).toLowerCase() === 'executive';
  const senderEmail = clean(useExecutiveProfile
    ? (organisationScoped
        ? (organizationProfile?.OrganisationExecutiveSenderEmail || brevo?.OrganisationExecutiveSenderEmail || sharedSenderEmail)
        : (schoolProfile?.ExecutiveSenderEmail || brevo?.ExecutiveSenderEmail || sharedSenderEmail))
    : sharedSenderEmail);
  const senderName = clean(useExecutiveProfile
    ? (organisationScoped
        ? (organizationProfile?.OrganisationExecutiveSenderName || brevo?.OrganisationExecutiveSenderName || sharedSenderName)
        : (schoolProfile?.ExecutiveSenderName || brevo?.ExecutiveSenderName || sharedSenderName))
    : sharedSenderName);
  const replyToEmail = clean(useExecutiveProfile
    ? (organisationScoped
        ? (
            organizationProfile?.OrganisationExecutiveReplyToEmail
            || brevo?.OrganisationExecutiveReplyToEmail
            || organizationProfile?.OrganisationReplyToEmail
            || brevo?.OrganisationReplyToEmail
          )
        : (
            schoolProfile?.ExecutiveReplyToEmail
            || brevo?.ExecutiveReplyToEmail
            || schoolProfile?.BrevoReplyToEmail
            || brevo?.BrevoReplyToEmail
            || schoolProfile?.SchoolEmail
          ))
    : (organisationScoped
        ? (organizationProfile?.OrganisationReplyToEmail || brevo?.OrganisationReplyToEmail || organizationProfile?.SchoolEmail)
        : (schoolProfile?.BrevoReplyToEmail || brevo?.BrevoReplyToEmail || schoolProfile?.SchoolEmail)));
  const replyToName = clean(useExecutiveProfile
    ? (organisationScoped
        ? (
            organizationProfile?.OrganisationExecutiveReplyToName
            || brevo?.OrganisationExecutiveReplyToName
            || organizationProfile?.OrganisationReplyToName
            || brevo?.OrganisationReplyToName
            || senderName
          )
        : (
            schoolProfile?.ExecutiveReplyToName
            || brevo?.ExecutiveReplyToName
            || schoolProfile?.BrevoReplyToName
            || brevo?.BrevoReplyToName
            || schoolProfile?.SchoolName
            || senderName
          ))
    : (organisationScoped
        ? (organizationProfile?.OrganisationReplyToName || brevo?.OrganisationReplyToName || organizationProfile?.SchoolName || senderName)
        : (schoolProfile?.BrevoReplyToName || brevo?.BrevoReplyToName || schoolProfile?.SchoolName || senderName)));
  return {
    senderEmail,
    senderName,
    fallbackSenderEmail: sharedSenderEmail,
    fallbackSenderName: sharedSenderName,
    replyToEmail,
    replyToName,
    organization,
    scope: organisationScoped ? 'organisation' : 'school',
    useExecutiveProfile
  };
}

export function escapeEmailHtml(value) {
  return clean(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function normalizeAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : []).slice(0, 6).map((attachment) => {
    const name = clean(attachment?.name).replace(/[\\/:*?"<>|]/g, '-').slice(0, 120);
    const content = clean(attachment?.content).replace(/\s+/g, '');
    const url = clean(attachment?.url);
    if (!name || content.length > 1500000 || (content && !/^[a-z0-9+/]*={0,2}$/i.test(content))
      || (!content && !/^https:\/\//i.test(url))) return null;
    return content ? { name, content } : { name, url };
  }).filter(Boolean);
}

export function resolveEmailProvider(env = {}, providerOverride = '') {
  const provider = clean(providerOverride || env.EMAIL_PROVIDER).toLowerCase();
  if (!provider) return 'brevo';
  if (provider === 'brevo' || provider === 'gmail') return provider;
  const error = new Error(`The configured email provider "${provider}" is not supported.`);
  error.status = 503;
  error.code = 'EMAIL_PROVIDER_UNSUPPORTED';
  error.retrySafe = true;
  throw error;
}

export function selectActiveBrevoSender(profile = {}, senders = []) {
  const activeEmails = new Set((Array.isArray(senders) ? senders : [])
    .filter((sender) => sender?.active === true && validEmail(sender?.email))
    .map((sender) => clean(sender.email).toLowerCase()));
  const senderEmail = clean(profile.senderEmail);
  const fallbackSenderEmail = clean(profile.fallbackSenderEmail);
  if (activeEmails.has(senderEmail.toLowerCase())) {
    return {
      senderEmail,
      senderName: clean(profile.senderName),
      replyToEmail: clean(profile.replyToEmail),
      replyToName: clean(profile.replyToName),
      usedFallback: false,
      verified: true
    };
  }
  if (validEmail(fallbackSenderEmail) && activeEmails.has(fallbackSenderEmail.toLowerCase())) {
    return {
      senderEmail: fallbackSenderEmail,
      senderName: clean(profile.senderName) || clean(profile.fallbackSenderName),
      replyToEmail: clean(profile.replyToEmail) || senderEmail,
      replyToName: clean(profile.replyToName) || clean(profile.senderName),
      usedFallback: true,
      verified: true
    };
  }
  return {
    senderEmail,
    senderName: clean(profile.senderName),
    replyToEmail: clean(profile.replyToEmail),
    replyToName: clean(profile.replyToName),
    usedFallback: false,
    verified: false
  };
}

export function classifyBrevoFailure(status = 0, providerError = {}) {
  const providerCode = clean(providerError?.code).toLowerCase();
  const providerMessage = clean(providerError?.message).toLowerCase();
  const combined = `${providerCode} ${providerMessage}`;
  if (Number(status) === 401 || /\bunauthori[sz]ed\b|invalid api key|authentication/.test(combined)) {
    return {
      code: 'BREVO_CREDENTIAL_INVALID',
      status: 503,
      message: 'Brevo rejected the Cloudflare email credential. Replace the encrypted BREVO_API_KEY secret, then redeploy the portal.'
    };
  }
  if (Number(status) === 403 || /permission_denied|permission denied|access denied/.test(combined)) {
    return {
      code: 'BREVO_PERMISSION_DENIED',
      status: 503,
      message: 'The Brevo credential does not have permission to send transactional email.'
    };
  }
  if (/account_under_validation|account.*validation|account.*review/.test(combined)) {
    return {
      code: 'BREVO_ACCOUNT_UNDER_VALIDATION',
      status: 503,
      message: 'Brevo has placed this sender account under validation. Complete the account review in Brevo before sending again.'
    };
  }
  if (/not_enough_credit|insufficient.*credit|not enough.*credit|quota.*exceed|credit.*exhaust/.test(combined)) {
    return {
      code: 'BREVO_CREDIT_EXHAUSTED',
      status: 503,
      message: 'The Brevo transactional-email credit is exhausted. Add email credit or upgrade the Brevo plan, then try again.'
    };
  }
  if (/sender/.test(combined) && /(invalid|validat|authenticat|not valid|not found)/.test(combined)) {
    return {
      code: 'BREVO_SENDER_NOT_VALIDATED',
      status: 503,
      message: 'The configured sender is not active in Brevo. Validate it there or select another active organisation sender.'
    };
  }
  if (/attachment/.test(combined) && /(invalid|size|large|limit|base64)/.test(combined)) {
    return {
      code: 'BREVO_ATTACHMENT_REJECTED',
      status: 400,
      message: 'Brevo rejected a signature or stamp attachment. Save a smaller PNG or JPG in User settings and send again.'
    };
  }
  if (Number(status) === 429 || /rate.?limit|too many requests/.test(combined)) {
    return {
      code: 'BREVO_RATE_LIMITED',
      status: 429,
      message: 'Brevo is temporarily limiting email requests. Wait briefly, then send again.'
    };
  }
  if (Number(status) >= 500) {
    return {
      code: 'BREVO_PROVIDER_UNAVAILABLE',
      status: 502,
      message: 'Brevo returned a temporary error and did not confirm whether it accepted the message. Automatic resend is paused to prevent a duplicate.'
    };
  }
  if (Number(status) === 400 || /invalid_parameter|missing_parameter|not_acceptable/.test(combined)) {
    return {
      code: 'BREVO_REQUEST_REJECTED',
      status: 400,
      message: 'Brevo rejected the email request. Confirm the recipient and active sender addresses, then try again.'
    };
  }
  return {
    code: 'BREVO_DELIVERY_REJECTED',
    status: 502,
    message: 'Brevo rejected the email before accepting it. Check the Brevo transactional log and try again.'
  };
}

async function readBrevoError(response) {
  const raw = await response.text().catch(() => '');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { message: raw };
  } catch {
    return { message: raw.slice(0, 500) };
  }
}

function brevoFailureError(status, providerError) {
  const failure = classifyBrevoFailure(status, providerError);
  const error = new Error(failure.message);
  error.status = failure.status;
  error.code = failure.code;
  error.deliveryUncertain = Number(status) >= 500;
  error.retrySafe = !error.deliveryUncertain;
  error.provider = 'brevo';
  return error;
}

function configuredDeliverySender(profile, useFallback = false) {
  const senderEmail = clean(useFallback ? profile.fallbackSenderEmail : profile.senderEmail);
  if (!validEmail(senderEmail)) return null;
  return {
    senderEmail,
    // Preserve the Executive/Principal office display name even when the
    // already-working shared organisation address is used for delivery.
    senderName: clean(profile.senderName)
      || clean(useFallback ? profile.fallbackSenderName : profile.senderName),
    replyToEmail: clean(profile.replyToEmail)
      || (useFallback ? clean(profile.senderEmail) : ''),
    replyToName: clean(profile.replyToName) || clean(profile.senderName),
    usedFallback: useFallback,
    verified: false
  };
}

async function resolveBrevoDeliverySender(apiKey, profile) {
  const configured = configuredDeliverySender(profile);
  const fallback = configuredDeliverySender(profile, true);
  const sameAsShared = clean(profile.senderEmail).toLowerCase()
    === clean(profile.fallbackSenderEmail).toLowerCase();
  // Most Executive offices intentionally reuse the organisation sender. That
  // address is already proven by every other email workflow, so do not make
  // this one feature depend on Brevo's separate sender-list permission.
  if (!profile.useExecutiveProfile || sameAsShared) {
    return configured;
  }
  try {
    const response = await fetch('https://api.brevo.com/v3/senders', {
      headers: { accept: 'application/json', 'api-key': apiKey }
    });
    if (!response.ok) {
      // Some restricted transactional keys can send email but cannot list
      // account senders. Use the known shared sender and let the SMTP endpoint
      // provide the authoritative result.
      if (fallback) return fallback;
      if (response.status === 429 || response.status >= 500) return configured;
      throw brevoFailureError(response.status, await readBrevoError(response));
    }
    const data = await response.json().catch(() => ({}));
    const selected = selectActiveBrevoSender(profile, data?.senders);
    if (selected.verified) return selected;
    if (fallback) return fallback;
    const err = new Error(
      'The Executive sender is not validated in Brevo, and no validated organisation sender is available.'
    );
    err.status = 503;
    err.code = 'BREVO_SENDER_NOT_VALIDATED';
    err.retrySafe = true;
    err.provider = 'brevo';
    throw err;
  } catch (error) {
    if (error?.status) throw error;
    return fallback || configured;
  }
}

async function submitBrevoEmail(apiKey, payload) {
  let response;
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (cause) {
    const error = new Error(
      'The email provider did not confirm whether it accepted this message. Automatic resend is paused to prevent a duplicate.'
    );
    error.status = 503;
    error.code = 'EMAIL_DELIVERY_UNCERTAIN';
    error.deliveryUncertain = true;
    error.retrySafe = false;
    error.provider = 'brevo';
    error.cause = cause;
    throw error;
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      providerError: await readBrevoError(response)
    };
  }
  return {
    ok: true,
    status: response.status,
    providerResult: await response.json().catch(() => ({}))
  };
}

export async function sendConfiguredEmail(env, {
  toEmail,
  toName,
  subject,
  textContent,
  htmlContent,
  attachments = [],
  senderProfile = '',
  branchId = '',
  providerOverride = '',
  senderOverride = null
}) {
  const recipient = clean(toEmail);
  if (!validEmail(recipient)) {
    const err = new Error('A valid recipient email address is required.');
    err.status = 400;
    err.code = 'EMAIL_RECIPIENT_INVALID';
    err.retrySafe = true;
    throw err;
  }
  const [brevo, organizationProfile, defaultSchoolProfile] = await Promise.all([
    getDocument(env, 'settings', 'brevo').catch(() => ({})),
    getDocument(env, 'settings', 'organisationProfile').catch(() => ({})),
    getDocument(env, 'settings', 'schoolProfile').catch(() => ({}))
  ]);
  const schoolProfile = await effectiveBranchProfile(env, defaultSchoolProfile, branchId);
  const effectiveOrganizationProfile = branchId
    ? { ...organizationProfile, ...schoolProfile }
    : organizationProfile;
  // Sender identities are deliberately scoped by edition. A faith or generic
  // organisation deployment never falls through to school sender fields.
  let senderProfileConfig = resolveEmailSenderProfile(env, {
    brevo,
    organizationProfile: effectiveOrganizationProfile,
    schoolProfile,
    senderProfile
  });
  const overrideEmail = clean(senderOverride?.email);
  if (overrideEmail) {
    if (!validEmail(overrideEmail)) {
      const err = new Error('The explicit sender email address is invalid.');
      err.status = 400;
      err.code = 'EMAIL_SENDER_INVALID';
      err.retrySafe = true;
      throw err;
    }
    senderProfileConfig = {
      ...senderProfileConfig,
      senderEmail: overrideEmail,
      senderName: clean(senderOverride?.name) || senderProfileConfig.senderName,
      fallbackSenderEmail: overrideEmail,
      fallbackSenderName: clean(senderOverride?.name) || senderProfileConfig.fallbackSenderName,
      replyToEmail: clean(senderOverride?.replyToEmail),
      replyToName: clean(senderOverride?.replyToName)
    };
  }
  const { organization } = senderProfileConfig;
  const provider = resolveEmailProvider(env, providerOverride);
  if (provider === 'gmail' && !validEmail(senderProfileConfig.senderEmail)
    && validEmail(env.GMAIL_CONNECTED_EMAIL)) {
    senderProfileConfig = {
      ...senderProfileConfig,
      senderEmail: clean(env.GMAIL_CONNECTED_EMAIL).toLowerCase(),
      fallbackSenderEmail: clean(env.GMAIL_CONNECTED_EMAIL).toLowerCase()
    };
  }
  const normalizedAttachments = normalizeAttachments(attachments);
  const resolvedSubject = clean(subject) || `Message from ${organization.Name || 'Dynamax'}`;
  if (!validEmail(senderProfileConfig.senderEmail)) {
    const err = new Error(`The ${provider === 'gmail' ? 'Google' : 'Brevo'} sender email could not be resolved for this organisation.`);
    err.status = 503;
    err.code = 'EMAIL_SENDER_UNAVAILABLE';
    err.retrySafe = true;
    err.provider = provider;
    throw err;
  }

  if (provider === 'gmail') {
    const connectedEmail = clean(env.GMAIL_CONNECTED_EMAIL).toLowerCase();
    const configuredSenderDiffers = validEmail(connectedEmail)
      && connectedEmail !== clean(senderProfileConfig.senderEmail).toLowerCase();
    const gmailMessage = {
      fromName: clean(senderProfileConfig.senderName) || clean(senderProfileConfig.fallbackSenderName),
      replyToEmail: configuredSenderDiffers
        ? senderProfileConfig.senderEmail
        : senderProfileConfig.replyToEmail,
      replyToName: configuredSenderDiffers
        ? senderProfileConfig.senderName
        : senderProfileConfig.replyToName,
      toEmail: recipient,
      toName: clean(toName) || recipient,
      subject: resolvedSubject,
      textContent: clean(textContent),
      htmlContent: clean(htmlContent),
      attachments: normalizedAttachments
    };
    let delivery;
    let attachmentFallback = false;
    try {
      delivery = await submitGmailEmail(env, gmailMessage);
    } catch (error) {
      if (normalizedAttachments.length && error?.code === 'GMAIL_ATTACHMENT_REJECTED') {
        console.warn(JSON.stringify({
          event: 'email_attachment_fallback',
          provider: 'gmail',
          status: Number(error?.status || 0),
          senderProfile: clean(senderProfile) || 'default',
          attachmentCount: normalizedAttachments.length,
          failureCode: error.code
        }));
        delivery = await submitGmailEmail(env, { ...gmailMessage, attachments: [] });
        attachmentFallback = delivery.ok;
      } else {
        throw error;
      }
    }
    if (!delivery.ok && normalizedAttachments.length) {
      const initialFailure = classifyGmailFailure(delivery.status, delivery.providerError);
      if (initialFailure.code === 'GMAIL_REQUEST_REJECTED') {
        console.warn(JSON.stringify({
          event: 'email_attachment_fallback',
          provider: 'gmail',
          status: delivery.status,
          senderProfile: clean(senderProfile) || 'default',
          attachmentCount: normalizedAttachments.length,
          failureCode: initialFailure.code
        }));
        delivery = await submitGmailEmail(env, { ...gmailMessage, attachments: [] });
        attachmentFallback = delivery.ok;
      }
    }
    if (!delivery.ok) {
      const failure = classifyGmailFailure(delivery.status, delivery.providerError);
      console.error(JSON.stringify({
        event: 'email_provider_rejected',
        provider: 'gmail',
        status: delivery.status,
        senderProfile: clean(senderProfile) || 'default',
        attachmentCount: normalizedAttachments.length,
        failureCode: failure.code
      }));
      throw gmailFailureError(delivery.status, delivery.providerError);
    }
    return {
      ok: true,
      status: delivery.status,
      provider: 'gmail',
      providerMessageId: clean(delivery.providerResult?.id),
      attachmentFallback
    };
  }

  // Prefer the encrypted environment secret. Existing installations may still
  // have a legacy server-side credential while they complete the migration;
  // it is consumed only inside the Worker and is never returned to clients.
  const apiKey = clean(env.BREVO_API_KEY || brevo?.BrevoApiKey);
  if (!apiKey) {
    const err = new Error('The Brevo email credential is unavailable in this portal environment.');
    err.status = 503;
    err.code = 'BREVO_CONFIGURATION_MISSING';
    err.retrySafe = true;
    err.provider = 'brevo';
    throw err;
  }
  const {
    senderEmail,
    senderName,
    replyToEmail,
    replyToName
  } = await resolveBrevoDeliverySender(apiKey, senderProfileConfig);
  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: recipient, name: clean(toName) || recipient }],
    subject: resolvedSubject,
    textContent: clean(textContent),
    htmlContent: clean(htmlContent)
  };
  if (validEmail(replyToEmail)) payload.replyTo = { email: replyToEmail, name: replyToName || senderName };
  if (normalizedAttachments.length) payload.attachment = normalizedAttachments;
  let delivery = await submitBrevoEmail(apiKey, payload);
  let attachmentFallback = false;
  if (!delivery.ok && normalizedAttachments.length) {
    const initialFailure = classifyBrevoFailure(delivery.status, delivery.providerError);
    if (['BREVO_REQUEST_REJECTED', 'BREVO_ATTACHMENT_REJECTED'].includes(initialFailure.code)) {
      console.warn(JSON.stringify({
        event: 'email_attachment_fallback',
        status: delivery.status,
        senderProfile: clean(senderProfile) || 'default',
        attachmentCount: normalizedAttachments.length,
        failureCode: initialFailure.code
      }));
      const fallbackPayload = { ...payload };
      delete fallbackPayload.attachment;
      delivery = await submitBrevoEmail(apiKey, fallbackPayload);
      attachmentFallback = delivery.ok;
    }
  }
  if (!delivery.ok) {
    const providerError = delivery.providerError;
    const failure = classifyBrevoFailure(delivery.status, providerError);
    console.error(JSON.stringify({
      event: 'email_provider_rejected',
      status: delivery.status,
      code: clean(providerError?.code).slice(0, 80) || 'unknown',
      senderProfile: clean(senderProfile) || 'default',
      attachmentCount: normalizedAttachments.length,
      failureCode: failure.code
    }));
    throw brevoFailureError(delivery.status, providerError);
  }
  return {
    ok: true,
    status: delivery.status,
    provider: 'brevo',
    providerMessageId: clean(delivery.providerResult?.messageId),
    attachmentFallback
  };
}
