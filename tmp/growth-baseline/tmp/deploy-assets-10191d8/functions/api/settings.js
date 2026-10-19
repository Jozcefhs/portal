import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeSchoolCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DCA';
}

function requireAdmin(env, password) {
  const expected = clean(env.ADMIN_WEB_PASSWORD);
  if (!expected) {
    const err = new Error('Setup login is not configured. Add ADMIN_WEB_PASSWORD in Cloudflare.');
    err.status = 500;
    throw err;
  }
  if (clean(password) !== expected) {
    const err = new Error('Invalid setup password.');
    err.status = 401;
    throw err;
  }
}

function defaultProfile(env) {
  return {
    SchoolName: clean(env.SCHOOL_NAME) || 'Integrated School Management Suite',
    SchoolCode: normalizeSchoolCode(env.SCHOOL_CODE),
    SchoolAddress: clean(env.SCHOOL_ADDRESS) || '',
    SchoolPhone: clean(env.SCHOOL_PHONE) || '',
    SchoolEmail: clean(env.SCHOOL_EMAIL) || '',
    SchoolSignatoryName: clean(env.SCHOOL_SIGNATORY_NAME) || '',
    SchoolSignatoryTitle: clean(env.SCHOOL_SIGNATORY_TITLE) || '',
    ResultSignatoryName: clean(env.RESULT_SIGNATORY_NAME) || '',
    ResultSignatoryTitle: clean(env.RESULT_SIGNATORY_TITLE) || '',
    OfferSignatoryName: clean(env.OFFER_SIGNATORY_NAME) || '',
    OfferSignatoryTitle: clean(env.OFFER_SIGNATORY_TITLE) || '',
    AdmissionSignatoryName: clean(env.ADMISSION_SIGNATORY_NAME) || '',
    AdmissionSignatoryTitle: clean(env.ADMISSION_SIGNATORY_TITLE) || '',
    EmailGreetingTemplate: clean(env.EMAIL_GREETING_TEMPLATE) || 'Dear Parent/Guardian,',
    NameFormat: clean(env.NAME_FORMAT) || 'Surname, first name, middle name',
    PortalHeadline: clean(env.PORTAL_HEADLINE) || 'Admissions and parent services in one place',
    PortalSubheading: clean(env.PORTAL_SUBHEADING) || 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.',
    PortalNotice: clean(env.PORTAL_NOTICE) || '',
    WebLogoUrl: '',
    WebLogoConfigured: false,
    ResultDisplayMode: clean(env.RESULT_DISPLAY_MODE) || 'subjects',
    ShowResultsOnline: clean(env.SHOW_RESULTS_ONLINE) || 'NO',
    CurrentAcademicSession: clean(env.CURRENT_ACADEMIC_SESSION) || '',
    CurrentTerm: clean(env.CURRENT_TERM) || 'First Term',
    DeclarationStatement: clean(env.DECLARATION_STATEMENT) || 'I declare that the information supplied in this application is complete and correct.',
    ProductKeyMode: clean(env.PRODUCT_KEY_MODE) || 'off',
    UpdatedAt: ''
  };
}

async function getProfile(env) {
  let profile = defaultProfile(env);
  try {
    requireFirestoreEnv(env);
    const rows = await listCollection(env, 'settings');
    const saved = rows.find((row) => row.__id === 'schoolProfile') || rows.find((row) => clean(row.SchoolName));
    if (saved) {
      profile = { ...profile, ...saved };
    }
    const branding = rows.find((row) => row.__id === 'webBranding');
    if (branding && clean(branding.WebLogoDataUrl)) {
      profile.WebLogoConfigured = true;
      profile.WebLogoUrl = `/api/web-logo?v=${encodeURIComponent(clean(branding.UpdatedAt))}`;
    }
  } catch (_err) {
    // Public pages should still load with environment/default values if Firestore is unavailable.
  }
  delete profile.__name;
  delete profile.__id;
  return profile;
}

export async function onRequestGet(context) {
  const profile = await getProfile(context.env);
  return Response.json({ ok: true, profile });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    requireAdmin(env, body.password);
    if (clean(body.action || body.Action) === 'load') {
      const profile = await getProfile(env);
      return Response.json({ ok: true, profile });
    }
    requireFirestoreEnv(env);

    const incoming = body.profile || {};
    const existing = await getProfile(env);
    const profile = {
      ...defaultProfile(env),
      ...existing,
      SchoolName: clean(incoming.SchoolName) || 'Integrated School Management Suite',
      SchoolCode: normalizeSchoolCode(incoming.SchoolCode),
      SchoolAddress: clean(incoming.SchoolAddress),
      SchoolPhone: clean(incoming.SchoolPhone),
      SchoolEmail: clean(incoming.SchoolEmail),
      SchoolSignatoryName: clean(incoming.SchoolSignatoryName),
      SchoolSignatoryTitle: clean(incoming.SchoolSignatoryTitle),
      ResultSignatoryName: clean(incoming.ResultSignatoryName),
      ResultSignatoryTitle: clean(incoming.ResultSignatoryTitle),
      OfferSignatoryName: clean(incoming.OfferSignatoryName),
      OfferSignatoryTitle: clean(incoming.OfferSignatoryTitle),
      AdmissionSignatoryName: clean(incoming.AdmissionSignatoryName),
      AdmissionSignatoryTitle: clean(incoming.AdmissionSignatoryTitle),
      EmailGreetingTemplate: clean(incoming.EmailGreetingTemplate) || 'Dear Parent/Guardian,',
      NameFormat: clean(incoming.NameFormat) || 'Surname, first name, middle name',
      PortalHeadline: clean(incoming.PortalHeadline),
      PortalSubheading: clean(incoming.PortalSubheading),
      PortalNotice: clean(incoming.PortalNotice),
      ResultDisplayMode: ['subjects', 'percentage'].includes(clean(incoming.ResultDisplayMode)) ? clean(incoming.ResultDisplayMode) : 'subjects',
      ShowResultsOnline: ['YES', 'NO'].includes(clean(incoming.ShowResultsOnline).toUpperCase()) ? clean(incoming.ShowResultsOnline).toUpperCase() : 'NO',
      CurrentAcademicSession: clean(incoming.CurrentAcademicSession),
      CurrentTerm: clean(incoming.CurrentTerm) || 'First Term',
      DeclarationStatement: clean(incoming.DeclarationStatement) || 'I declare that the information supplied in this application is complete and correct.',
      ProductKeyMode: ['off', 'required'].includes(clean(incoming.ProductKeyMode)) ? clean(incoming.ProductKeyMode) : 'off',
      UpdatedAt: new Date().toISOString()
    };
    if (incoming.WebLogoDataUrl !== undefined) {
      const webLogo = clean(incoming.WebLogoDataUrl);
      if (webLogo && (!/^data:image\/(png|jpeg|webp);base64,/i.test(webLogo) || webLogo.length > 750000)) {
        const error = new Error('The web logo must be a resized PNG, JPG, or WebP image below the allowed size.');
        error.status = 400;
        throw error;
      }
      await upsertDocument(env, 'settings', 'webBranding', { WebLogoDataUrl: webLogo, UpdatedAt: new Date().toISOString() });
    }
    delete profile.WebLogoUrl;
    delete profile.WebLogoConfigured;
    await upsertDocument(env, 'settings', 'schoolProfile', profile);
    return Response.json({ ok: true, message: 'School setup saved.', profile: await getProfile(env) });
  } catch (err) {
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, { status: err.status || 500 });
  }
}
