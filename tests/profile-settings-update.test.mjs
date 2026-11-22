import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mergedProfileText } from '../functions/lib/profile-settings-update.js';
import {
  applyPublicPortalContent,
  publicPortalContent
} from '../functions/lib/public-portal-content.js';

test('a partial desktop profile update preserves web-only landing content', () => {
  const existing = {
    PortalHeadline: 'Welcome to our admissions portal',
    PortalSubheading: 'Applications are currently open.',
    PortalNotice: 'Admission closes on Friday.'
  };
  assert.equal(mergedProfileText(existing, {}, 'PortalHeadline', 'portalHeadline'), existing.PortalHeadline);
  assert.equal(mergedProfileText(existing, {}, 'PortalSubheading', 'portalSubheading'), existing.PortalSubheading);
  assert.equal(mergedProfileText(existing, {}, 'PortalNotice', 'portalNotice'), existing.PortalNotice);
});

test('an explicitly submitted landing value updates or clears the saved value', () => {
  const existing = { PortalNotice: 'Old notice' };
  assert.equal(mergedProfileText(existing, { PortalNotice: 'New notice' }, 'PortalNotice', 'portalNotice'), 'New notice');
  assert.equal(mergedProfileText(existing, { portalNotice: '' }, 'PortalNotice', 'portalNotice'), '');
});

test('desktop profile persistence merges the stored profile before applying supplied fields', async () => {
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.match(backend, /getDocument\(env, 'settings', 'schoolProfile'\)/);
  assert.match(backend, /\.\.\.withoutFirestoreMetadata\(existingProfile \|\| \{\}\)/);
  assert.match(backend, /PortalNotice: mergedProfileText\(existingProfile, body, 'PortalNotice', 'portalNotice'\)/);
});

test('web settings keep landing content in a dedicated canonical document', async () => {
  const settingsApi = await readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8');
  assert.match(settingsApi, /getDocument\(env, 'settings', PUBLIC_PORTAL_CONTENT_DOCUMENT\)/);
  assert.match(settingsApi, /patchDocumentFields\(env, 'settings', PUBLIC_PORTAL_CONTENT_DOCUMENT/);
  assert.match(settingsApi, /PortalNotice: mergedProfileText\(existing, incoming, 'PortalNotice'\)/);
});

test('canonical landing content survives a later incomplete profile synchronization', () => {
  const canonical = publicPortalContent({
    PortalHeadline: 'Welcome',
    PortalSubheading: 'Applications are open.',
    PortalNotice: 'Admission into JSS 1 closes on Friday.'
  });
  const effective = applyPublicPortalContent({
    SchoolName: 'Example Academy',
    PortalHeadline: '',
    PortalSubheading: '',
    PortalNotice: ''
  }, canonical);

  assert.equal(effective.PortalNotice, 'Admission into JSS 1 closes on Friday.');
  assert.equal(effective.PortalHeadline, 'Welcome');
  assert.equal(effective.SchoolName, 'Example Academy');
});

test('an intentionally cleared canonical notice remains cleared', () => {
  const effective = applyPublicPortalContent({
    PortalNotice: 'Old notice'
  }, {
    PortalNotice: ''
  });

  assert.equal(effective.PortalNotice, '');
});

test('desktop organisation settings sync with first-time and partial document branding', async t => {
  const { generateKeyPairSync } = await import('node:crypto');
  const { onRequestPost } = await import('../functions/api/backend.js');
  const env = {
    FIREBASE_PROJECT_ID:'profile-sync-fixture', FIREBASE_CLIENT_EMAIL:'fixture@example.test',
    FIREBASE_PRIVATE_KEY:generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey,
    ORGANISATION_EDITION:'school', DYNAMAX_WORKSPACE_ID:'profile-sync-fixture', BACKEND_SHARED_SECRET:'fixture'
  };
  const documents = new Map();
  t.mock.method(globalThis,'fetch',async (url,options={})=>{
    const endpoint=new URL(url);
    if (endpoint.hostname==='oauth2.googleapis.com') return Response.json({access_token:'fixture',expires_in:3600});
    assert.equal(endpoint.hostname,'firestore.googleapis.com');
    const id=endpoint.pathname.split('/documents/settings/')[1];
    assert.ok(id,'Only settings documents may be accessed');
    if (options.method==='PATCH') {
      const {fields}=JSON.parse(options.body);
      const saved=documents.get(id);
      documents.set(id,{fields:endpoint.searchParams.has('updateMask.fieldPaths')?{...saved?.fields,...fields}:fields,
        name:endpoint.pathname,updateTime:new Date().toISOString()});
    }
    return documents.has(id) ? Response.json(documents.get(id)) : Response.json({error:{status:'NOT_FOUND'}},{status:404});
  });
  const logo='data:image/png;base64,TE9HTw==', stamp='data:image/png;base64,U1RBTVA=';
  async function save(assets) {
    const body={Action:'saveSchoolProfile',ExpectedWorkspaceId:env.DYNAMAX_WORKSPACE_ID,ExpectedOrganisationEdition:'school',Secret:'fixture',SettingsScope:'organisation',SchoolName:'Fixture School',
      SchoolBranches:[{Id:'main',Name:'Main Branch'}],ActiveBranchId:'main',EnableMedicalReport:'NO',...assets};
    const response=await onRequestPost({env,request:new Request('https://school.example.test/api/backend',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const result=await response.json();
    assert.equal(response.status,200,result.message);
    assert.equal(result.ok,true);
  }
  await save({DocumentLogoDataUrl:logo});
  assert.equal(documents.get('admissionDocuments').fields.Enabled.mapValue.fields.MedicalReport.booleanValue,false);
  await save({DocumentStampDataUrl:stamp});
  assert.equal(documents.get('documentBranding').fields.DocumentLogoDataUrl.stringValue,logo);
  assert.equal(documents.get('documentBranding').fields.DocumentStampDataUrl.stringValue,stamp);
});
