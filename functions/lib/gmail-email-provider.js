const clean = (value) => String(value ?? '').trim();
const validEmail = (value) => /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(clean(value));
const MAX_ATTACHMENT_BASE64_LENGTH = 1500000;
const MAX_ATTACHMENT_BYTES = Math.floor(MAX_ATTACHMENT_BASE64_LENGTH * 3 / 4);

function utf8Base64(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function bytesBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64Url(value) {
  return utf8Base64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function wrapBase64(value) {
  return String(value || '').replace(/\s+/g, '').match(/.{1,76}/g)?.join('\r\n') || '';
}

function safeHeader(value) {
  return clean(value).replace(/[\r\n]+/g, ' ');
}

function encodedHeader(value) {
  const header = safeHeader(value);
  return header && /^[\x20-\x7e]+$/.test(header)
    ? header
    : `=?UTF-8?B?${utf8Base64(header)}?=`;
}

function encodedWord(value) {
  return `=?UTF-8?B?${utf8Base64(safeHeader(value))}?=`;
}

function mailbox(name, email) {
  const address = clean(email).toLowerCase();
  const displayName = safeHeader(name);
  const renderedName = /^[a-z0-9 ._'-]+$/i.test(displayName)
    ? displayName
    : encodedWord(displayName);
  return displayName ? `${renderedName} <${address}>` : address;
}

function attachmentContentType(attachment = {}) {
  const configured = clean(attachment.type).split(';')[0].toLowerCase();
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(configured)) return configured;
  const extension = clean(attachment.name).split('.').pop()?.toLowerCase();
  return ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv'
  })[extension] || 'application/octet-stream';
}

function attachmentFailure(message, cause) {
  const error = new Error(message);
  error.status = 400;
  error.code = 'GMAIL_ATTACHMENT_REJECTED';
  error.retrySafe = true;
  if (cause) error.cause = cause;
  return error;
}

async function boundedResponseBytes(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_ATTACHMENT_BYTES) {
    throw attachmentFailure('An email attachment exceeds the configured size limit.');
  }
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw attachmentFailure('An email attachment exceeds the configured size limit.');
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ATTACHMENT_BYTES) {
      await reader.cancel().catch(() => null);
      throw attachmentFailure('An email attachment exceeds the configured size limit.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

function remoteAttachmentUrl(value) {
  let url;
  try { url = new URL(clean(value)); } catch (_error) { url = null; }
  const hostname = clean(url?.hostname).replace(/^\[|\]$/g, '').toLowerCase();
  const privateAddress = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname === 'metadata.google.internal'
    || hostname === '::1'
    || /^127\./.test(hostname)
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^169\.254\./.test(hostname)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
    || /^0\./.test(hostname);
  if (!url || url.protocol !== 'https:' || url.username || url.password
    || (url.port && url.port !== '443') || privateAddress) {
    throw attachmentFailure('The remote email attachment URL is not permitted.');
  }
  return url;
}

async function downloadAttachment(value) {
  let url = remoteAttachmentUrl(value);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    let response;
    try {
      response = await fetch(url, { redirect: 'manual' });
    } catch (cause) {
      throw attachmentFailure('An email attachment could not be downloaded before delivery.', cause);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = clean(response.headers.get('location'));
      if (!location || redirect === 3) {
        throw attachmentFailure('A remote email attachment used too many redirects.');
      }
      url = remoteAttachmentUrl(new URL(location, url).href);
      continue;
    }
    return response;
  }
  throw attachmentFailure('A remote email attachment could not be downloaded.');
}

async function gmailAttachment(attachment = {}) {
  if (clean(attachment.content)) {
    return {
      ...attachment,
      content: clean(attachment.content).replace(/\s+/g, ''),
      type: attachmentContentType(attachment)
    };
  }
  const response = await downloadAttachment(attachment.url);
  if (!response.ok) {
    throw attachmentFailure(`An email attachment could not be downloaded (${response.status}).`);
  }
  const bytes = await boundedResponseBytes(response);
  const content = bytesBase64(bytes);
  if (content.length > MAX_ATTACHMENT_BASE64_LENGTH) {
    throw attachmentFailure('An email attachment exceeds the configured size limit.');
  }
  return {
    ...attachment,
    content,
    type: clean(response.headers.get('content-type')).split(';')[0] || attachmentContentType(attachment)
  };
}

function attachmentHeaders(attachment = {}) {
  const filename = safeHeader(attachment.name).replace(/["\\]/g, '_') || 'attachment';
  const asciiFilename = filename.replace(/[^\x20-\x7e]/g, '_');
  const encodedFilename = encodeURIComponent(filename).replace(/'/g, '%27');
  return [
    `Content-Type: ${attachmentContentType(attachment)}; name="${asciiFilename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
    '',
    wrapBase64(attachment.content)
  ].join('\r\n');
}

export async function buildGmailRawMessage({
  fromEmail,
  fromName,
  replyToEmail,
  replyToName,
  toEmail,
  toName,
  subject,
  textContent,
  htmlContent,
  attachments = []
} = {}) {
  if (!validEmail(fromEmail) || !validEmail(toEmail)) {
    const error = new Error('Gmail requires valid sender and recipient email addresses.');
    error.status = 400;
    error.code = 'GMAIL_REQUEST_REJECTED';
    error.retrySafe = true;
    throw error;
  }
  const resolvedAttachments = await Promise.all((Array.isArray(attachments) ? attachments : []).map(gmailAttachment));
  const alternativeBoundary = `dynamax-alt-${crypto.randomUUID()}`;
  const mixedBoundary = `dynamax-mixed-${crypto.randomUUID()}`;
  const headers = [
    `From: ${mailbox(fromName, fromEmail)}`,
    `To: ${mailbox(toName, toEmail)}`,
    `Subject: ${encodedHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0'
  ];
  if (validEmail(replyToEmail)) headers.splice(2, 0, `Reply-To: ${mailbox(replyToName, replyToEmail)}`);
  const alternative = [
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(utf8Base64(textContent)),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(utf8Base64(htmlContent)),
    `--${alternativeBoundary}--`
  ].join('\r\n');
  let mime;
  if (resolvedAttachments.length) {
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    mime = [
      ...headers,
      '',
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      '',
      alternative,
      ...resolvedAttachments.flatMap((attachment) => [
        `--${mixedBoundary}`,
        attachmentHeaders(attachment)
      ]),
      `--${mixedBoundary}--`,
      ''
    ].join('\r\n');
  } else {
    headers.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`);
    mime = [...headers, '', alternative, ''].join('\r\n');
  }
  return base64Url(mime);
}

function errorText(providerError = {}) {
  const nested = providerError?.error && typeof providerError.error === 'object'
    ? providerError.error
    : providerError;
  return clean([
    nested?.status,
    nested?.message,
    ...(Array.isArray(nested?.errors) ? nested.errors.map((entry) => `${entry?.reason || ''} ${entry?.message || ''}`) : [])
  ].join(' ')).toLowerCase();
}

export function classifyGmailFailure(status = 0, providerError = {}, phase = 'send') {
  const combined = errorText(providerError);
  if ((phase === 'token' && [400, 401].includes(Number(status)))
    || Number(status) === 401
    || /invalid_grant|invalid_client|unauthenticated/.test(combined)) {
    return {
      code: 'GMAIL_CREDENTIAL_INVALID',
      status: 503,
      message: 'Google disconnected or rejected the organisation email account. Reconnect Google Workspace in Email delivery settings.'
    };
  }
  if (Number(status) === 429 || /rate.?limit|quota.*exceed|resource_exhausted/.test(combined)) {
    return {
      code: 'GMAIL_RATE_LIMITED',
      status: 429,
      message: 'Google is temporarily limiting email requests. Wait briefly, then send again.'
    };
  }
  if (Number(status) === 403 || /permission|insufficient.*scope|forbidden/.test(combined)) {
    return {
      code: 'GMAIL_PERMISSION_DENIED',
      status: 503,
      message: 'The connected Google account has not granted permission to send email. Reconnect it and approve email sending.'
    };
  }
  if (Number(status) >= 500 || Number(status) === 0) {
    return {
      code: 'GMAIL_PROVIDER_UNAVAILABLE',
      status: 502,
      message: 'Google Mail is temporarily unavailable. The message was not accepted; try again shortly.'
    };
  }
  if (Number(status) === 400 || /invalid_argument|failed_precondition/.test(combined)) {
    return {
      code: 'GMAIL_REQUEST_REJECTED',
      status: 400,
      message: 'Google rejected the email request. Confirm the connected mailbox, recipient and attachment, then try again.'
    };
  }
  return {
    code: 'GMAIL_DELIVERY_REJECTED',
    status: 502,
    message: 'Google rejected the email before accepting it. Check the connected Google account and try again.'
  };
}

export function gmailFailureError(status, providerError, phase = 'send') {
  const failure = classifyGmailFailure(status, providerError, phase);
  const deliveryUncertain = phase === 'send' && Number(status) >= 500;
  const error = new Error(deliveryUncertain
    ? 'Google returned a temporary error and did not confirm whether it accepted the message. Automatic resend is paused to prevent a duplicate.'
    : failure.message);
  error.status = failure.status;
  error.code = failure.code;
  error.deliveryUncertain = deliveryUncertain;
  error.retrySafe = !deliveryUncertain;
  error.provider = 'gmail';
  return error;
}

export function gmailConfiguration(env = {}) {
  const configuration = {
    clientId: clean(env.GMAIL_OAUTH_CLIENT_ID),
    clientSecret: clean(env.GMAIL_OAUTH_CLIENT_SECRET),
    refreshToken: clean(env.GMAIL_REFRESH_TOKEN),
    connectedEmail: clean(env.GMAIL_CONNECTED_EMAIL).toLowerCase()
  };
  if (!configuration.clientId || !configuration.clientSecret || !configuration.refreshToken
    || !validEmail(configuration.connectedEmail)) {
    const error = new Error('Google email is selected but its secure connection is incomplete. Connect Google Workspace in Email delivery settings.');
    error.status = 503;
    error.code = 'GMAIL_CONFIGURATION_MISSING';
    error.retrySafe = true;
    error.provider = 'gmail';
    throw error;
  }
  return configuration;
}

async function readProviderResponse(response) {
  const raw = await response.text().catch(() => '');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { message: raw };
  } catch {
    return { message: raw.slice(0, 500) };
  }
}

async function gmailAccessToken(configuration) {
  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        refresh_token: configuration.refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    });
  } catch (cause) {
    const error = gmailFailureError(0, { message: clean(cause?.message || cause) }, 'token-network');
    error.cause = cause;
    throw error;
  }
  const result = await readProviderResponse(response);
  if (!response.ok) {
    throw gmailFailureError(response.status, result, 'token');
  }
  if (!clean(result.access_token)) {
    throw gmailFailureError(401, { message: 'The token response did not include an access token.' }, 'token');
  }
  return clean(result.access_token);
}

export async function submitGmailEmail(env = {}, message = {}) {
  const configuration = gmailConfiguration(env);
  const raw = await buildGmailRawMessage({
    ...message,
    fromEmail: configuration.connectedEmail
  });
  const accessToken = await gmailAccessToken(configuration);
  let response;
  try {
    response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ raw })
    });
  } catch (cause) {
    const error = new Error(
      'Google did not confirm whether it accepted this message. Automatic resend is paused to prevent a duplicate.'
    );
    error.status = 503;
    error.code = 'EMAIL_DELIVERY_UNCERTAIN';
    error.deliveryUncertain = true;
    error.retrySafe = false;
    error.provider = 'gmail';
    error.cause = cause;
    throw error;
  }
  const providerResult = await readProviderResponse(response);
  return response.ok
    ? { ok: true, status: response.status, providerResult }
    : { ok: false, status: response.status, providerError: providerResult };
}
