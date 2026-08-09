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
  assert.match(settingsApi, /upsertDocument\(env, 'settings', PUBLIC_PORTAL_CONTENT_DOCUMENT/);
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
