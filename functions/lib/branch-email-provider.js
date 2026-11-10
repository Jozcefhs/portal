const clean = value => String(value ?? '').trim();
const fail = message => Object.assign(new Error(message), { status: 503, code: 'BRANCH_EMAIL_CONFIGURATION_INVALID', retrySafe: true });

export function emailProviderBranchId(value = '') {
  const branch = clean(value).toLowerCase();
  if (branch && !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(branch)) {
    throw Object.assign(new Error('Choose a valid configured branch for email delivery.'), { status: 400 });
  }
  return branch;
}

export async function branchEmailSecretName(value) {
  const branch = emailProviderBranchId(value);
  if (!branch) throw Object.assign(new Error('A branch is required for an independent email provider.'), { status: 400 });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(branch));
  return `BRANCH_EMAIL_${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export async function branchEmailSecretValues(workspaceId, branchId, provider, requestedAt, credentials = {}) {
  const branch = emailProviderBranchId(branchId), chosen = clean(provider).toLowerCase();
  if (!['inherit', 'brevo', 'gmail'].includes(chosen) || !clean(workspaceId) || !Number.isFinite(Date.parse(requestedAt))) {
    throw Object.assign(new Error('The branch email-provider transition is incomplete.'), { status: 400 });
  }
  const record = { Version: 1, WorkspaceId: clean(workspaceId).toLowerCase(), BranchId: branch, Provider: chosen, RequestedAt: requestedAt };
  if (chosen === 'brevo') {
    record.BrevoApiKey = clean(credentials.brevoApiKey);
    if (!record.BrevoApiKey || record.BrevoApiKey.length > 4096) throw Object.assign(new Error('Enter the branch Brevo API key.'), { status: 400 });
  }
  if (chosen === 'gmail') {
    Object.assign(record, { GmailClientId: clean(credentials.clientId), GmailClientSecret: clean(credentials.clientSecret),
      GmailRefreshToken: clean(credentials.refreshToken), GmailConnectedEmail: clean(credentials.connectedEmail).toLowerCase() });
    if (!record.GmailClientId || !record.GmailClientSecret || !record.GmailRefreshToken || !record.GmailConnectedEmail) throw fail('The branch Google connection is incomplete.');
  }
  return { [await branchEmailSecretName(branch)]: JSON.stringify(record) };
}

// An absent override inherits. A present but invalid override never silently
// falls through to another branch's or the organisation's sending account.
export async function resolveBranchEmailEnvironment(env = {}, value = '') {
  const branchId = emailProviderBranchId(value);
  const inherited = { env, branchId, mode: 'inherit', provider: 'inherit', requestedAt: '' };
  if (!branchId) return inherited;
  const raw = clean(env[await branchEmailSecretName(branchId)]);
  if (!raw) return inherited;
  let record;
  try { record = JSON.parse(raw); } catch { throw fail('The branch email connection is invalid. Reconnect it in branch settings.'); }
  if (record.Version !== 1 || record.BranchId !== branchId || record.WorkspaceId !== clean(env.DYNAMAX_WORKSPACE_ID).toLowerCase()
      || !['inherit', 'brevo', 'gmail'].includes(record.Provider) || !Number.isFinite(Date.parse(record.RequestedAt))) {
    throw fail('The branch email connection does not match this workspace. Reconnect it in branch settings.');
  }
  if (record.Provider === 'inherit') return { ...inherited, requestedAt: record.RequestedAt };
  if (record.Provider === 'brevo' && !clean(record.BrevoApiKey)) throw fail('The branch Brevo credential is missing. Reconnect it in branch settings.');
  if (record.Provider === 'gmail' && (!clean(record.GmailClientId) || !clean(record.GmailClientSecret) || !clean(record.GmailRefreshToken)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(record.GmailConnectedEmail)))) throw fail('The branch Google credential is incomplete. Reconnect it in branch settings.');
  return { branchId, mode: 'independent', provider: record.Provider, requestedAt: record.RequestedAt, env: {
    ...env, EMAIL_PROVIDER: record.Provider, EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT: record.RequestedAt,
    BREVO_API_KEY: record.Provider === 'brevo' ? record.BrevoApiKey : '',
    GMAIL_OAUTH_CLIENT_ID: record.GmailClientId || '', GMAIL_OAUTH_CLIENT_SECRET: record.GmailClientSecret || '',
    GMAIL_REFRESH_TOKEN: record.GmailRefreshToken || '', GMAIL_CONNECTED_EMAIL: record.GmailConnectedEmail || '',
    DYNAMAX_BRANCH_EMAIL_INDEPENDENT: true
  } };
}
