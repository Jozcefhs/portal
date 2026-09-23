import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeTutorialLinks,
  normalizeYouTubeTutorialUrl
} from '../functions/api/backend.js';

const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8');
const adminApiSource = await readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
const adminHtml = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const adminJs = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const setupHtml = await readFile(new URL('../setup.html', import.meta.url), 'utf8');
const setupJs = await readFile(new URL('../js/setup.js', import.meta.url), 'utf8');

test('tutorial settings accept only secure YouTube destinations', () => {
  assert.equal(normalizeYouTubeTutorialUrl('https://youtu.be/abc123'), 'https://youtu.be/abc123');
  assert.equal(normalizeYouTubeTutorialUrl('https://www.youtube.com/@DynamaxVendmac'), 'https://www.youtube.com/@DynamaxVendmac');
  assert.throws(() => normalizeYouTubeTutorialUrl('https://example.com/tutorial'), /YouTube/);
  assert.throws(() => normalizeYouTubeTutorialUrl('http://youtube.com/watch?v=abc'), /HTTPS YouTube/);
});

test('tutorial catalogue drops blank links and persists through the school profile', () => {
  assert.deepEqual(normalizeTutorialLinks({
    Accounts: 'https://youtu.be/accounts',
    Students: ''
  }), { Accounts: 'https://youtu.be/accounts' });
  assert.match(backendSource, /TutorialLinks: normalizeTutorialLinks\(/);
  assert.match(backendSource, /TutorialChannelUrl: normalizeYouTubeTutorialUrl\(/);
});

test('organisation settings expose and persist the YouTube tutorial catalogue', () => {
  assert.match(setupHtml, /id="tutorial-settings"/);
  assert.match(setupHtml, /id="tutorialChannelUrl"/);
  assert.match(setupHtml, /id="tutorialLinksList"/);
  assert.match(setupJs, /TutorialLinks: tutorialLinksFromForm\(\)/);
  assert.match(setupJs, /TutorialChannelUrl: data\.get\('TutorialChannelUrl'\)/);
  assert.match(settingsSource, /TutorialLinks: normalizeTutorialLinks\(/);
  assert.match(settingsSource, /TutorialChannelUrl: normalizeYouTubeTutorialUrl\(/);
});

test('staff companion exposes the tutorial for the active module on desktop and mobile', () => {
  assert.match(adminHtml, /id="staffTutorialButton"/);
  assert.match(adminHtml, /id="staffTutorialMenu"/);
  assert.match(adminHtml, /id="staffTutorialSettings"/);
  assert.match(adminJs, /function openCurrentTutorial\(\)/);
  assert.match(adminJs, /const tutorialStorageKeys = Object\.freeze/);
  assert.match(adminApiSource, /tutorials:\s*\{/);
  assert.match(adminApiSource, /links: normalizeTutorialLinks\(/);
});
