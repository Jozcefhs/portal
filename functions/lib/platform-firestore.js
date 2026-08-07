const PLATFORM_FIRESTORE_KEYS = Object.freeze({
  FIREBASE_PROJECT_ID: 'DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID',
  FIREBASE_CLIENT_EMAIL: 'DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL',
  FIREBASE_PRIVATE_KEY: 'DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY'
});

const clean = (value) => String(value ?? '').trim();

export function hasPlatformFirestoreConfiguration(env = {}) {
  return Object.values(PLATFORM_FIRESTORE_KEYS).some((key) => Boolean(clean(env[key])));
}

export function requirePlatformFirestoreEnv(env = {}) {
  const missing = Object.values(PLATFORM_FIRESTORE_KEYS)
    .filter((key) => !clean(env[key]));
  if (missing.length) {
    const error = new Error(`Dynamax subscriber database is not configured. Missing: ${missing.join(', ')}`);
    error.status = 503;
    error.code = 'DYNAMAX_PLATFORM_DATABASE_NOT_CONFIGURED';
    throw error;
  }

  const projectId = clean(env.DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID);
  const tenantProjectId = clean(env.FIREBASE_PROJECT_ID);
  if (tenantProjectId && tenantProjectId.toLowerCase() === projectId.toLowerCase()) {
    const error = new Error('The Dynamax subscriber database must use a different Firestore project from the organisation database.');
    error.status = 503;
    error.code = 'DYNAMAX_PLATFORM_DATABASE_TENANT_CONFLICT';
    throw error;
  }

  return {
    ...env,
    FIREBASE_PROJECT_ID: projectId,
    FIREBASE_CLIENT_EMAIL: clean(env.DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: clean(env.DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY)
  };
}

