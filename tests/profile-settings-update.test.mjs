import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mergedProfileText } from '../functions/lib/profile-settings-update.js';

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
