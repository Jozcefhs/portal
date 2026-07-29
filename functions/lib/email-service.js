import { getDocument } from './firestore.js';
import { resolveOrganizationConfig } from './organization-config.js';

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
        brevo?.OrganisationSenderEmail
        || organizationProfile?.OrganisationSenderEmail
        || env.ORGANISATION_SENDER_EMAIL
        || env.ORGANIZATION_SENDER_EMAIL
        || env.CHURCH_EMAIL
      )
    : (
        brevo?.BrevoSenderEmail
        || schoolProfile?.BrevoSenderEmail
        || env.BREVO_SENDER_EMAIL
        || env.SCHOOL_EMAIL
      ));
  const sharedSenderName = clean(organisationScoped
    ? (
        brevo?.OrganisationSenderName
        || organizationProfile?.OrganisationSenderName
        || env.ORGANISATION_SENDER_NAME
        || env.ORGANIZATION_SENDER_NAME
        || organization.Name
      )
    : (
        brevo?.BrevoSenderName
        || schoolProfile?.BrevoSenderName
        || env.BREVO_SENDER_NAME
        || schoolProfile?.SchoolName
        || env.SCHOOL_NAME
        || organization.Name
      )) || 'Dynamax';
  const useExecutiveProfile = clean(senderProfile).toLowerCase() === 'executive';
  const senderEmail = clean(useExecutiveProfile
    ? (organisationScoped
        ? (brevo?.OrganisationExecutiveSenderEmail || organizationProfile?.OrganisationExecutiveSenderEmail || sharedSenderEmail)
        : (brevo?.ExecutiveSenderEmail || schoolProfile?.ExecutiveSenderEmail || sharedSenderEmail))
    : sharedSenderEmail);
  const senderName = clean(useExecutiveProfile
    ? (organisationScoped
        ? (brevo?.OrganisationExecutiveSenderName || organizationProfile?.OrganisationExecutiveSenderName || sharedSenderName)
        : (brevo?.ExecutiveSenderName || schoolProfile?.ExecutiveSenderName || sharedSenderName))
    : sharedSenderName);
  const replyToEmail = clean(useExecutiveProfile
    ? (organisationScoped
        ? (
            brevo?.OrganisationExecutiveReplyToEmail
            || organizationProfile?.OrganisationExecutiveReplyToEmail
            || brevo?.OrganisationReplyToEmail
            || organizationProfile?.OrganisationReplyToEmail
          )
        : (
            brevo?.ExecutiveReplyToEmail
            || schoolProfile?.ExecutiveReplyToEmail
            || brevo?.BrevoReplyToEmail
            || schoolProfile?.BrevoReplyToEmail
          ))
    : (organisationScoped
        ? (brevo?.OrganisationReplyToEmail || organizationProfile?.OrganisationReplyToEmail)
        : (brevo?.BrevoReplyToEmail || schoolProfile?.BrevoReplyToEmail)));
  const replyToName = clean(useExecutiveProfile
    ? (organisationScoped
        ? (
            brevo?.OrganisationExecutiveReplyToName
            || organizationProfile?.OrganisationExecutiveReplyToName
            || brevo?.OrganisationReplyToName
            || organizationProfile?.OrganisationReplyToName
            || senderName
          )
        : (
            brevo?.ExecutiveReplyToName
            || schoolProfile?.ExecutiveReplyToName
            || brevo?.BrevoReplyToName
            || schoolProfile?.BrevoReplyToName
            || senderName
          ))
    : (organisationScoped
        ? (brevo?.OrganisationReplyToName || organizationProfile?.OrganisationReplyToName || senderName)
        : (brevo?.BrevoReplyToName || schoolProfile?.BrevoReplyToName || senderName)));
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

async function resolveBrevoDeliverySender(apiKey, profile) {
  if (!profile.useExecutiveProfile
    || clean(profile.senderEmail).toLowerCase() === clean(profile.fallbackSenderEmail).toLowerCase()) {
    return {
      senderEmail: profile.senderEmail,
      senderName: profile.senderName,
      replyToEmail: profile.replyToEmail,
      replyToName: profile.replyToName
    };
  }
  try {
    const response = await fetch('https://api.brevo.com/v3/senders', {
      headers: { accept: 'application/json', 'api-key': apiKey }
    });
    if (!response.ok) return profile;
    const data = await response.json().catch(() => ({}));
    const selected = selectActiveBrevoSender(profile, data?.senders);
    if (selected.verified) return selected;
    const err = new Error(
      'The Executive sender is not validated in Brevo, and no validated organisation sender is available.'
    );
    err.status = 503;
    throw err;
  } catch (error) {
    if (error?.status) throw error;
    return profile;
  }
}

export async function sendConfiguredEmail(env, {
  toEmail,
  toName,
  subject,
  textContent,
  htmlContent,
  attachments = [],
  senderProfile = ''
}) {
  const recipient = clean(toEmail);
  if (!validEmail(recipient)) {
    const err = new Error('A valid recipient email address is required.');
    err.status = 400;
    throw err;
  }
  const [brevo, organizationProfile, schoolProfile] = await Promise.all([
    getDocument(env, 'settings', 'brevo').catch(() => ({})),
    getDocument(env, 'settings', 'organisationProfile').catch(() => ({})),
    getDocument(env, 'settings', 'schoolProfile').catch(() => ({}))
  ]);
  // Sender identities are deliberately scoped by edition. A faith or generic
  // organisation deployment never falls through to school sender fields.
  const senderProfileConfig = resolveEmailSenderProfile(env, {
    brevo,
    organizationProfile,
    schoolProfile,
    senderProfile
  });
  const { organization } = senderProfileConfig;
  // Prefer the encrypted environment secret. Existing installations may still
  // have a legacy server-side credential while they complete the migration;
  // it is consumed only inside the Worker and is never returned to clients.
  const apiKey = clean(env.BREVO_API_KEY || brevo?.BrevoApiKey);
  if (!apiKey) {
    const err = new Error('The existing email-service credential is unavailable in this portal environment.');
    err.status = 503;
    throw err;
  }
  if (!validEmail(senderProfileConfig.senderEmail)) {
    const err = new Error('The existing sender email could not be resolved for this organisation.');
    err.status = 503;
    throw err;
  }
  const {
    senderEmail,
    senderName,
    replyToEmail,
    replyToName
  } = await resolveBrevoDeliverySender(apiKey, senderProfileConfig);
  const normalizedAttachments = normalizeAttachments(attachments);
  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: recipient, name: clean(toName) || recipient }],
    subject: clean(subject) || `Message from ${organization.Name || 'Dynamax'}`,
    textContent: clean(textContent),
    htmlContent: clean(htmlContent)
  };
  if (validEmail(replyToEmail)) payload.replyTo = { email: replyToEmail, name: replyToName || senderName };
  if (normalizedAttachments.length) payload.attachment = normalizedAttachments;
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const providerError = await response.json().catch(() => ({}));
    const providerMessage = clean(providerError?.message).toLowerCase();
    const invalidSender = /sender/.test(providerMessage)
      && /(invalid|validat|authenticat|not valid)/.test(providerMessage);
    console.error(JSON.stringify({
      event: 'email_provider_rejected',
      status: response.status,
      code: clean(providerError?.code).slice(0, 80) || 'unknown',
      senderProfile: clean(senderProfile) || 'default',
      attachmentCount: normalizedAttachments.length,
      invalidSender
    }));
    const err = new Error(invalidSender
      ? 'The configured sender is not validated in Brevo. Verify that sender or use the organisation sender.'
      : 'The email service could not send this message. Please try again.');
    err.status = 502;
    throw err;
  }
  return { ok: true, status: response.status };
}
