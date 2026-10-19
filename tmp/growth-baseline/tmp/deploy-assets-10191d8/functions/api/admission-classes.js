// Cloudflare Pages Function: /api/admission-classes
// Returns classes currently open for admission.

import { getAdmissionClasses } from './backend.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';

const FALLBACK_CLASSES = [
  'Creche',
  'Pre Nursery',
  'Nursery 1',
  'Nursery 2',
  'Nursery 3',
  'Primary 1',
  'Primary 2',
  'Primary 3',
  'Primary 4',
  'Primary 5',
  'Primary 6',
  'JSS 1 / Grade 7',
  'JSS 2 / Grade 8',
  'JSS 3 / Grade 9',
  'SS 1 / Grade 10',
  'SS 2 / Grade 11',
  'SS 3 / Grade 12'
];

export async function onRequestGet(context) {
  try {
    const { env } = context;
    try {
      requireFirestoreEnv(env);
      const firestoreData = await getAdmissionClasses(env);
      return Response.json({
        ok: true,
        classes: firestoreData.openClassOptions || firestoreData.openClasses || [],
        openClasses: firestoreData.openClasses || [],
        allClasses: firestoreData.classes || [],
        formAmount: firestoreData.formAmount || '',
        backend: 'firestore'
      });
    } catch (firestoreErr) {
      if (!legacyGoogleDataEnabled(env)) {
        return Response.json({ ok: false, message: firestoreErr.message || String(firestoreErr) }, { status: firestoreErr.status || 500 });
      }
    }

    if (!legacyGoogleDataEnabled(env) || !env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return Response.json({ ok: true, classes: FALLBACK_CLASSES, fallback: true });
    }

    const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
    url.searchParams.set('action', 'getAdmissionClasses');
    url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);

    const response = await fetch(url.toString());
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_err) {
      return Response.json({ ok: true, classes: FALLBACK_CLASSES, fallback: true, message: 'Admission classes fallback used because the Apps Script response was not JSON.' });
    }
    if (!data.ok) {
      return Response.json(data, { status: 400 });
    }

    return Response.json({
      ok: true,
      classes: data.openClassOptions || data.openClasses || [],
      openClasses: data.openClasses || [],
      allClasses: data.classes || [],
      formAmount: data.formAmount || ''
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
