import { batchCommitLiteralDocuments, getDocument } from './firestore.js';
import { hasPlatformFirestoreConfiguration, requirePlatformFirestoreEnv } from './platform-firestore.js';
import { canonicalSubscriptionBridgeConfigured } from './plan-policy-sync.js';

export const HELP_CONFIG_DOCUMENT_ID = 'dynamaxHelpConfig';
export const HELP_CONFIG_MAX_BYTES = 400 * 1024;
export const DEFAULT_HARDWARE_SHOP_URL = 'https://vehiclepass.dynamax.cc/shop';
const OWNER_HOSTS = new Set(['dynamax.cc', 'www.dynamax.cc', 'dynamaxms.pages.dev']);
const DEFAULT_FAQS = Object.freeze([
  Object.freeze({ Question: 'Where can I buy cards and readers?', Answer: 'Use the Buy compatible devices link. Confirm the card type, reader connection and device compatibility with the seller before buying.' }),
  Object.freeze({ Question: 'Who can help with my account or institution records?', Answer: 'Contact your institution administrator for account access, student or staff records, and permissions. Contact platform support for a problem with the software itself.' }),
  Object.freeze({ Question: 'Who handles payment or wallet questions?', Answer: 'Contact your institution accounts team with the payment reference and date. Do not send your password, PIN, card security code or one-time verification code.' }),
  Object.freeze({ Question: 'How do students install the Android CBT app?', Answer: 'Connect to the same Wi-Fi or local network as your school\'s running CBT server. Open the joining address supplied by your school in a browser and choose Download Android app. Android may ask you to allow that browser to install apps. Install only the official download from your school\'s server, then enter the same joining address in the CBT app. Ask your school administrator if the download is not available.' }),
  Object.freeze({ Question: 'What should I include when reporting a software problem?', Answer: 'Describe what you were trying to do, the screen involved, the time of the problem and any error message. Include your device and browser or app version. Remove private student, staff and payment details from screenshots.' })
]);
const clean = value => typeof value === 'string' ? value.trim() : '';
const object = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const failure = (message, status = 400, code = 'INVALID_HELP_CONFIG') => Object.assign(new Error(message), { status, code });

export function isHelpOwnerHost(requestUrl) {
  try { return OWNER_HOSTS.has(new URL(requestUrl).hostname.toLowerCase()); } catch { return false; }
}

function supportEmail(value) {
  if (typeof value !== 'string' || /[\r\n\x00-\x1f\x7f]/.test(value)) throw failure('Enter a plain support email address without a mailto prefix or extra headers.');
  const email = value.trim();
  if (!email) return '';
  const [local, domain, extra] = email.split('@');
  if (email.length > 254 || !local || local.length > 64 || extra !== undefined
      || !/^[A-Za-z0-9.!$'*+_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')
      || !domain || domain.length > 253 || !domain.includes('.')
      || domain.split('.').some(label => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) {
    throw failure('Enter a valid plain support email address, or leave it blank.');
  }
  return email;
}

function shopUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\x00-\x20\x7f]/.test(value.trim())) throw failure('Enter a valid HTTPS shop URL (up to 2048 characters).');
  let url;
  try { url = new URL(value.trim()); } catch { throw failure('Enter a valid HTTPS shop URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || url.href.length > 2048) throw failure('The shop URL must use HTTPS and must not contain credentials.');
  return url.href;
}

function faqEntries(value) {
  if (!Array.isArray(value) || value.length > 30) throw failure('Provide no more than 30 FAQs.');
  return value.map((row, index) => {
    if (!object(row) || typeof row.Question !== 'string' || typeof row.Answer !== 'string') throw failure(`FAQ ${index + 1} needs a question and answer.`);
    const Question = row.Question.trim(), Answer = row.Answer.trim();
    if (!Question || Question.length > 180 || !Answer || Answer.length > 3000
        || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(Question + Answer)) throw failure(`FAQ ${index + 1}: use a question of 1–180 characters and an answer of 1–3000 characters.`);
    return { Question, Answer };
  });
}

export function validateHelpConfig(value) {
  if (!object(value)) throw failure('Help settings must be an object.');
  return { SupportEmail: supportEmail(value.SupportEmail), HardwareShopUrl: shopUrl(value.HardwareShopUrl), Faqs: faqEntries(value.Faqs) };
}

export function normalizeHelpConfig(value = {}) {
  const source = object(value) ? value : {};
  let SupportEmail = '', HardwareShopUrl = DEFAULT_HARDWARE_SHOP_URL, Faqs = DEFAULT_FAQS.map(row => ({ ...row }));
  try { SupportEmail = supportEmail(source.SupportEmail ?? ''); } catch { /* Never expose a malformed contact URI. */ }
  try { HardwareShopUrl = shopUrl(source.HardwareShopUrl ?? DEFAULT_HARDWARE_SHOP_URL); } catch { /* Keep the known shop URL. */ }
  try { if (source.Faqs !== undefined) Faqs = faqEntries(source.Faqs); } catch { /* Malformed saved content falls back to safe guidance. */ }
  return { SupportEmail, HardwareShopUrl, Faqs, UpdatedAt: clean(source.UpdatedAt).slice(0, 40), Revision: Number.isSafeInteger(source.Revision) && source.Revision >= 0 ? source.Revision : 0 };
}

// Count streamed bytes before buffering so missing/false Content-Length cannot bypass the bound.
export async function readHelpConfigJson(message, { maxBytes = HELP_CONFIG_MAX_BYTES } = {}) {
  const declared = Number(message.headers.get('Content-Length') || 0);
  if (declared > maxBytes) throw failure('Help settings exceed the allowed size.', 413, 'HELP_CONFIG_TOO_LARGE');
  if (!message.body) throw failure('The help settings body is empty.');
  const reader = message.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw failure('Help settings exceed the allowed size.', 413, 'HELP_CONFIG_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw failure('The help settings body is not valid JSON.'); }
  if (!object(parsed)) throw failure('Help settings must be an object.');
  return parsed;
}

function bridgeTarget(env, requestUrl) {
  if (isHelpOwnerHost(requestUrl) || !canonicalSubscriptionBridgeConfigured(env)) return null;
  try {
    const target = new URL(env.CANONICAL_PORTAL_URL);
    if (!OWNER_HOSTS.has(target.hostname.toLowerCase()) || target.username || target.password || target.port) return null;
    if (new URL(requestUrl).origin === target.origin) return null;
    return new URL('/api/help-config', target.origin);
  } catch { return null; }
}

export async function loadPublishedHelpConfig(env = {}, requestUrl = '', deps = {}) {
  const get = deps.get || getDocument, fetchImpl = deps.fetch || fetch;
  const fallback = { published: false, config: normalizeHelpConfig(), unavailable: true };
  if (hasPlatformFirestoreConfiguration(env)) {
    try {
      const saved = await get(requirePlatformFirestoreEnv(env), 'settings', HELP_CONFIG_DOCUMENT_ID);
      return { published: Boolean(saved), config: normalizeHelpConfig(saved) };
    } catch { /* Tenant deployments may use the canonical bridge if direct access is unavailable. */ }
  }
  const target = bridgeTarget(env, requestUrl);
  if (!target) return fallback;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    // Public configuration never forwards the caller's cookies, password, session or backend tokens.
    const response = await fetchImpl(target, { headers: { Accept: 'application/json' }, redirect: 'error', signal: controller.signal });
    if (!response.ok || !/\bapplication\/json\b/i.test(response.headers.get('Content-Type') || '')) return fallback;
    const data = await readHelpConfigJson(response);
    if (data.ok !== true || data.unavailable || typeof data.published !== 'boolean' || !object(data.config)) return fallback;
    return { published: data.published, config: normalizeHelpConfig(data.config) };
  } catch { return fallback; } finally { clearTimeout(timer); }
}

export async function saveHelpConfig(env, body, deps = {}) {
  const data = validateHelpConfig(body.config);
  if (!Number.isSafeInteger(body.ExpectedRevision) || body.ExpectedRevision < 0) throw failure('Load the current help settings before publishing.', 428, 'HELP_CONFIG_REVISION_REQUIRED');
  const platformEnv = requirePlatformFirestoreEnv(env);
  const get = deps.get || getDocument, commit = deps.commit || batchCommitLiteralDocuments;
  const saved = await get(platformEnv, 'settings', HELP_CONFIG_DOCUMENT_ID);
  if (normalizeHelpConfig(saved).Revision !== body.ExpectedRevision) throw failure('Help settings changed while you were editing. Load the latest settings and review your changes before publishing again.', 409, 'HELP_CONFIG_CONFLICT');
  if (saved && !saved.__updateTime) throw failure('The current help settings could not be verified. Reload before publishing.', 409, 'HELP_CONFIG_CONFLICT');
  const config = { ...data, UpdatedAt: new Date().toISOString(), Revision: body.ExpectedRevision + 1 };
  if (!Number.isSafeInteger(config.Revision)) throw failure('The help settings revision cannot be incremented.', 409, 'HELP_CONFIG_CONFLICT');
  try {
    await commit(platformEnv, [{ collectionPath: 'settings', documentId: HELP_CONFIG_DOCUMENT_ID,
      ...(saved ? { updateTime: saved.__updateTime } : { exists: false }), data: { ...config, UpdatedBy: 'Dynamax owner' } }]);
  } catch (error) {
    if ([409, 412].includes(error?.status) || error?.code === 'FIRESTORE_WRITE_CONFLICT') throw failure('Help settings changed while you were editing. Load the latest settings and review your changes before publishing again.', 409, 'HELP_CONFIG_CONFLICT');
    throw error;
  }
  return config;
}
