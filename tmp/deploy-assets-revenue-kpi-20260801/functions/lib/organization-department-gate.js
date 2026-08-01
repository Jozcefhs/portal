const clean = (value) => String(value ?? '').trim();

const ORGANIZATION_DEPARTMENT_EDITIONS = new Set(['faith', 'organization']);

function canonicalEdition(value) {
  const edition = clean(value).toLowerCase();
  if ([
    'church',
    'religious',
    'religious body',
    'religious organisation',
    'religious organization'
  ].includes(edition)) return 'faith';
  if (['organisation', 'other'].includes(edition)) return 'organization';
  return edition;
}

function accessError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

/**
 * Guards the organisation department service at its request boundary.
 *
 * `identity` must come from loadDeploymentIdentity (web) or the already
 * verified deployment identity passed into the desktop backend router. Actor
 * edition values are never accepted as a substitute for that deployment
 * identity.
 */
export function assertOrganizationDepartmentWorkspaceAccess(identity = {}, actor = {}) {
  const workspaceId = clean(identity.workspaceId);
  const edition = canonicalEdition(identity.edition);
  if (!workspaceId || !edition) {
    throw accessError(
      'The organisation department workspace identity could not be verified.',
      503,
      'ORGANIZATION_DEPARTMENT_IDENTITY_REQUIRED'
    );
  }
  if (!ORGANIZATION_DEPARTMENT_EDITIONS.has(edition)) {
    throw accessError(
      'Departments and organisation members are not available in this deployment edition.',
      403,
      'ORGANIZATION_DEPARTMENT_EDITION_FORBIDDEN'
    );
  }

  const actorEdition = canonicalEdition(
    actor.edition || actor.OrganisationEdition || actor.OrganizationEdition
  );
  if (!actorEdition) {
    throw accessError(
      'Your staff session is not bound to an organisation edition. Please sign in again.',
      403,
      'ORGANIZATION_DEPARTMENT_SESSION_EDITION_REQUIRED'
    );
  }
  if (actorEdition !== edition) {
    throw accessError(
      'Your staff session belongs to a different organisation edition.',
      403,
      'ORGANIZATION_DEPARTMENT_SESSION_EDITION_MISMATCH'
    );
  }

  const featureFlags = actor.featureFlags || actor.FeatureFlags;
  if (featureFlags && (featureFlags.members !== true || featureFlags.departments !== true)) {
    throw accessError(
      'Departments and organisation members are disabled for this workspace.',
      403,
      'ORGANIZATION_DEPARTMENT_FEATURE_DISABLED'
    );
  }

  return Object.freeze({ workspaceId, edition });
}
