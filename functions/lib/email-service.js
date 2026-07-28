import { getDocument } from './firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
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
  // Prefer the encrypted environment secret. Existing installations may still
  // have a legacy server-side credential while they complete the migration;
  // it is consumed only inside the Worker and is never returned to clients.
  const apiKey = clean(env.BREVO_API_KEY || brevo?.BrevoApiKey);
  const sharedSenderEmail = clean(
    brevo?.BrevoSenderEmail
    || organizationProfile?.BrevoSenderEmail
    || schoolProfile?.BrevoSenderEmail
    || env.BREVO_SENDER_EMAIL
    || env.SCHOOL_EMAIL
  );
  const sharedSenderName = clean(
    brevo?.BrevoSenderName
    || organizationProfile?.BrevoSenderName
    || schoolProfile?.BrevoSenderName
    || env.BREVO_SENDER_NAME
    || organizationProfile?.Name
    || organizationProfile?.OrganisationName
    || schoolProfile?.SchoolName
    || env.SCHOOL_NAME
    || 'Dynamax'
  );
  const useExecutiveProfile = clean(senderProfile).toLowerCase() === 'executive';
  const senderEmail = clean(useExecutiveProfile
    ? (brevo?.ExecutiveSenderEmail || organizationProfile?.ExecutiveSenderEmail || sharedSenderEmail)
    : sharedSenderEmail);
  const senderName = clean(useExecutiveProfile
    ? (brevo?.ExecutiveSenderName || organizationProfile?.ExecutiveSenderName || sharedSenderName)
    : sharedSenderName);
  const replyToEmail = clean(useExecutiveProfile
    ? (brevo?.ExecutiveReplyToEmail || organizationProfile?.ExecutiveReplyToEmail || brevo?.BrevoReplyToEmail || organizationProfile?.BrevoReplyToEmail)
    : (brevo?.BrevoReplyToEmail || organizationProfile?.BrevoReplyToEmail));
  const replyToName = clean(useExecutiveProfile
    ? (brevo?.ExecutiveReplyToName || organizationProfile?.ExecutiveReplyToName || brevo?.BrevoReplyToName || organizationProfile?.BrevoReplyToName || senderName)
    : (brevo?.BrevoReplyToName || organizationProfile?.BrevoReplyToName || senderName));
  if (!apiKey) {
    const err = new Error('The existing email-service credential is unavailable in this portal environment.');
    err.status = 503;
    throw err;
  }
  if (!validEmail(senderEmail)) {
    const err = new Error('The existing sender email could not be resolved for this organisation.');
    err.status = 503;
    throw err;
  }
  const normalizedAttachments = normalizeAttachments(attachments);
  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: recipient, name: clean(toName) || recipient }],
    subject: clean(subject) || 'Message from school',
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
    const err = new Error('The email service could not send this message. Please try again.');
    err.status = 502;
    throw err;
  }
  return { ok: true, status: response.status };
}
