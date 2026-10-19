import { firestoreRequest, requireFirestoreEnv } from '../lib/firestore.js';

export async function onRequestGet(context) {
  try {
    const { env } = context;
    requireFirestoreEnv(env);
    let documentFound = false;
    try {
      await firestoreRequest(env, 'system/health');
      documentFound = true;
    } catch (err) {
      if (err.status !== 404) {
        throw err;
      }
    }
    return Response.json({
      ok: true,
      message: 'Firestore connection is configured.',
      projectId: env.FIREBASE_PROJECT_ID,
      healthDocumentFound: documentFound
    });
  } catch (err) {
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, { status: 500 });
  }
}
