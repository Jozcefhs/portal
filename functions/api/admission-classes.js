// Cloudflare Pages Function: /api/admission-classes
// Returns classes currently open for admission.

import { getAdmissionClasses } from './backend.js';
import { requireFirestoreEnv } from '../lib/firestore.js';

function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestGet(context) {
  try {
    const { env } = context;
    requireFirestoreEnv(env);
    const data = await getAdmissionClasses(env);
    return json({
      ok: true,
      classes: data.openClassOptions || data.openClasses || [],
      openClasses: data.openClasses || [],
      allClasses: data.classes || [],
      formAmount: data.formAmount || '',
      backend: 'firestore'
    });
  } catch (err) {
    return json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
