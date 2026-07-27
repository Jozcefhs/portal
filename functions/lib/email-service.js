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

export async function sendConfiguredEmail(env, { toEmail, toName, subject, textContent, htmlContent }) {
  const recipient = clean(toEmail);
  if (!validEmail(recipient)) {
    const err = new Error('A valid recipient email address is required.');
    err.status = 400;
    throw err;
  }
  const [brevo, profile] = await Promise.all([
    getDocument(env, 'settings', 'brevo').catch(() => ({})),
    getDocument(env, 'settings', 'schoolProfile').catch(() => ({}))
  ]);
  const apiKey = clean(brevo?.BrevoApiKey || env.BREVO_API_KEY);
  const senderEmail = clean(brevo?.BrevoSenderEmail || env.BREVO_SENDER_EMAIL || env.SCHOOL_EMAIL);
  const senderName = clean(brevo?.BrevoSenderName || env.BREVO_SENDER_NAME || profile?.SchoolName || env.SCHOOL_NAME || 'DIGC Suite');
  if (!apiKey || !validEmail(senderEmail)) {
    const err = new Error('Email sending is not configured. Add the sender email and email-service credentials in Settings.');
    err.status = 503;
    throw err;
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: recipient, name: clean(toName) || recipient }],
      subject: clean(subject) || 'Message from school',
      textContent: clean(textContent),
      htmlContent: clean(htmlContent)
    })
  });
  if (!response.ok) {
    const err = new Error('The email service could not send this message. Please try again.');
    err.status = 502;
    throw err;
  }
  return { ok: true, status: response.status };
}
