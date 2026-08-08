import {
  batchCommitDocuments,
  getDocument,
  listCollection,
  patchDocumentFields,
  requireFirestoreEnv
} from '../lib/firestore.js';
import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import { hashStaffPassword } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function safeStaffId(value) {
  return lower(value).replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

function withoutFirestoreMetadata(document = {}) {
  const value = { ...document };
  delete value.__id;
  delete value.__name;
  delete value.__createTime;
  delete value.__updateTime;
  return value;
}

function organisationCode(name, workspaceId) {
  const initials = clean(name).split(/\s+/).map((part) => part.replace(/[^a-z0-9]/gi, '')[0] || '').join('');
  return (initials || clean(workspaceId).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'ORG').toUpperCase().slice(0, 10);
}

function platformEndpoint(env, request) {
  let central;
  try { central = new URL(clean(env.CANONICAL_PORTAL_URL)); } catch (_error) { central = null; }
  const local = new URL(request.url);
  if (!central || central.protocol !== 'https:' || central.origin === local.origin) {
    const error = new Error('The Dynamax activation service is not configured for this deployment.');
    error.status = 503;
    throw error;
  }
  return new URL('/api/tenant-activation', central.origin);
}

async function platformRequest(env, request, payload) {
  const response = await fetch(platformEndpoint(env, request), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dynamax-Portal': new URL(request.url).hostname
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const error = new Error(data?.message || 'The Dynamax activation service did not accept this request.');
    error.status = response.status || 502;
    error.code = clean(data?.code);
    throw error;
  }
  return data;
}

function validateInput(body) {
  const username = clean(body.username);
  const displayName = clean(body.displayName);
  const password = String(body.password || '');
  if (!/^[a-z0-9][a-z0-9._@-]{2,79}$/i.test(username)) {
    const error = new Error('Username must be 3 to 80 characters and use only letters, numbers, dots, underscores, @ or hyphens.');
    error.status = 400;
    throw error;
  }
  if (!displayName) {
    const error = new Error('Administrator display name is required.');
    error.status = 400;
    throw error;
  }
  if (password.length < 8) {
    const error = new Error('Password must contain at least 8 characters.');
    error.status = 400;
    throw error;
  }
  if (password !== String(body.confirmPassword || '')) {
    const error = new Error('Passwords do not match.');
    error.status = 400;
    throw error;
  }
  return { username, displayName, password };
}

function organizationProfile(claim, identity, existing = {}) {
  const now = new Date().toISOString();
  return {
    ...withoutFirestoreMetadata(existing),
    WorkspaceId: identity.workspaceId,
    Edition: identity.edition,
    OrganisationEdition: identity.edition,
    Name: clean(claim.organisationName),
    OrganisationName: clean(claim.organisationName),
    Code: organisationCode(claim.organisationName, identity.workspaceId),
    OrganisationCode: organisationCode(claim.organisationName, identity.workspaceId),
    ContactName: clean(claim.contactName),
    ContactEmail: lower(claim.email),
    ContactPhone: clean(claim.phone),
    Country: clean(claim.country),
    Plan: clean(claim.plan),
    SubscriptionPlan: clean(claim.plan),
    PlanEntitlements: claim.planEntitlements ?? null,
    PlanCatalogRevision: clean(claim.planCatalogRevision),
    UserLimit: Math.max(1, Number(claim.userLimit || 5) || 5),
    SubscriptionStatus: clean(claim.subscriptionStatus),
    TrialStartedAt: clean(claim.trialStartedAt),
    TrialEndsAt: clean(claim.trialEndsAt),
    CreatedAt: clean(existing.CreatedAt) || now,
    CreatedBy: clean(existing.CreatedBy) || 'Secure tenant activation',
    UpdatedAt: now,
    UpdatedBy: 'Secure tenant activation'
  };
}

async function createFirstAdministrator(env, identity, claim, activationId, account) {
  const bootstrap = await getDocument(env, 'settings', 'firstAdministrator');
  if (bootstrap) {
    if (clean(bootstrap.ActivationId) === clean(activationId)) {
      return { username: clean(bootstrap.Username), alreadyCreated: true };
    }
    const error = new Error('The first administrator has already been created for this workspace. Sign in or use administrator recovery.');
    error.status = 409;
    throw error;
  }
  const existingUsers = await listCollection(env, 'staffUsers', { pageSize: 2, maxPages: 1 });
  if (existingUsers.length) {
    const error = new Error('This workspace already has a staff account. First-account activation has been disabled.');
    error.status = 409;
    throw error;
  }
  if (clean(claim.workspaceId) !== identity.workspaceId || clean(claim.edition) !== identity.edition) {
    const error = new Error('This activation link belongs to a different workspace edition.');
    error.status = 409;
    throw error;
  }
  const staffId = safeStaffId(account.username);
  const existingProfile = await getDocument(env, 'settings', 'organisationProfile');
  if (existingProfile) {
    const storedWorkspace = lower(existingProfile.WorkspaceId);
    const storedEdition = lower(existingProfile.Edition || existingProfile.OrganisationEdition);
    if ((storedWorkspace && storedWorkspace !== identity.workspaceId) || (storedEdition && storedEdition !== identity.edition)) {
      const error = new Error('The saved organisation profile belongs to another deployment.');
      error.status = 409;
      throw error;
    }
  }
  const now = new Date().toISOString();
  const passwordFields = await hashStaffPassword(account.password);
  const profile = organizationProfile(claim, identity, existingProfile || {});
  const auditId = `ACTIVATION-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const writes = [
    {
      collectionPath: 'settings', documentId: 'firstAdministrator', exists: false,
      data: { ActivationId: clean(activationId), Username: account.username, CreatedAt: now, Status: 'Created' }
    },
    {
      collectionPath: 'staffUsers', documentId: staffId, exists: false,
      data: {
        Username: account.username,
        UsernameKey: lower(account.username),
        LoginUsername: account.username,
        LoginUsernameKey: lower(account.username),
        DisplayName: account.displayName,
        Role: 'Super Admin',
        Department: '',
        BranchId: '',
        SchoolSectionAccess: 'All',
        ApprovalEnabled: true,
        Active: true,
        MustChangePassword: false,
        ActivationId: clean(activationId),
        ...passwordFields,
        CreatedAt: now,
        CreatedBy: 'Secure tenant activation',
        UpdatedAt: now
      }
    },
    {
      collectionPath: 'settings', documentId: 'organisationProfile', data: profile,
      ...(existingProfile ? { updateTime: existingProfile.__updateTime } : { exists: false })
    },
    {
      collectionPath: 'staffSecurityAudit', documentId: auditId, exists: false,
      data: {
        Timestamp: now, Action: 'FIRST ADMINISTRATOR ACTIVATED', Username: account.username,
        Role: 'Super Admin', SourcePlatform: 'Secure tenant activation', ActivationId: clean(activationId)
      }
    }
  ];
  await batchCommitDocuments(env, writes);
  return { username: account.username, alreadyCreated: false };
}

export async function onRequestPost({ request, env }) {
  let claim = null;
  let body = null;
  let accountCreated = false;
  try {
    requireFirestoreEnv(env);
    const identity = requiredDeploymentIdentity(env);
    const origin = clean(request.headers.get('Origin'));
    if (origin && origin !== new URL(request.url).origin) {
      const error = new Error('Cross-site activation requests are not allowed.');
      error.status = 403;
      throw error;
    }
    body = await readJsonBody(request, { maxBytes: 32 * 1024 });
    const account = validateInput(body);
    claim = await platformRequest(env, request, {
      action: 'claim', activationId: body.activationId, token: body.token
    });
    const created = await createFirstAdministrator(env, identity, claim, body.activationId, account);
    accountCreated = true;
    const completed = await platformRequest(env, request, {
      action: 'complete', activationId: body.activationId, token: body.token,
      claimId: claim.claimId, username: created.username
    });
    await patchDocumentFields(env, 'settings', 'firstAdministrator', {
      Status: 'Completed', CompletedAt: clean(completed.completedAt) || new Date().toISOString()
    }).catch(() => null);
    const loginUrl = new URL('/admin.html', new URL(request.url).origin);
    loginUrl.searchParams.set('activated', '1');
    loginUrl.searchParams.set('username', created.username);
    return Response.json({
      ok: true,
      message: created.alreadyCreated
        ? 'The administrator account is ready. Sign in with the password you created.'
        : 'Your Super Administrator account has been created successfully.',
      username: created.username,
      loginUrl: loginUrl.href
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (claim?.claimId && body && !accountCreated) {
      await platformRequest(env, request, {
        action: 'release', activationId: body.activationId, token: body.token, claimId: claim.claimId
      }).catch(() => null);
    }
    return Response.json({ ok: false, code: clean(error.code), message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
