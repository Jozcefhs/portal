import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeTutorialLinks,
  normalizeYouTubeTutorialUrl
} from '../functions/api/backend.js';
import { loadPublishedTutorials, normalizeTutorialCatalog, tutorialsForEdition } from '../functions/lib/tutorial-catalog.js';
import { onRequestPost as saveTutorialCatalog } from '../functions/api/tutorial-catalog.js';

const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8');
const adminApiSource = await readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
const adminHtml = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const adminJs = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const setupHtml = await readFile(new URL('../setup.html', import.meta.url), 'utf8');
const setupJs = await readFile(new URL('../js/setup.js', import.meta.url), 'utf8');
const parentHtml = await readFile(new URL('../parent-dashboard.html', import.meta.url), 'utf8');
const parentJs = await readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8');
const parentApiSource = await readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8');
const ownerHtml = await readFile(new URL('../plan-management.html', import.meta.url), 'utf8');
const ownerJs = await readFile(new URL('../js/plan-management.js', import.meta.url), 'utf8');
const moduleCatalogSource = await readFile(new URL('../js/tutorial-module-catalogue.js', import.meta.url), 'utf8');
const catalogApiSource = await readFile(new URL('../functions/api/tutorial-catalog.js', import.meta.url), 'utf8');

test('tutorial settings accept only secure YouTube destinations', () => {
  assert.equal(normalizeYouTubeTutorialUrl('https://youtu.be/abc123'), 'https://youtu.be/abc123');
  assert.equal(normalizeYouTubeTutorialUrl('https://www.youtube.com/@DynamaxVendmac'), 'https://www.youtube.com/@DynamaxVendmac');
  assert.throws(() => normalizeYouTubeTutorialUrl('https://example.com/tutorial'), /YouTube/);
  assert.throws(() => normalizeYouTubeTutorialUrl('http://youtube.com/watch?v=abc'), /HTTPS YouTube/);
});

test('tutorial catalogue drops blank links and keeps legacy profile links read-only', () => {
  assert.deepEqual(normalizeTutorialLinks({
    Accounts: 'https://youtu.be/accounts',
    Students: ''
  }), { Accounts: 'https://youtu.be/accounts' });
  assert.match(backendSource, /TutorialLinks: normalizeTutorialLinks\(existingProfile\.TutorialLinks/);
  assert.match(backendSource, /TutorialChannelUrl: normalizeYouTubeTutorialUrl\(existingProfile\.TutorialChannelUrl/);
});

test('only owner plan management edits and publishes tutorial links', () => {
  assert.doesNotMatch(setupHtml, /id="tutorial-settings"|id="tutorialChannelUrl"/);
  assert.doesNotMatch(setupJs, /tutorialLinksFromForm|TutorialChannelUrl: data\.get/);
  assert.doesNotMatch(adminHtml, /id="staffTutorialSettings"/);
  assert.match(ownerHtml, /id="ownerTutorialSettings"/);
  assert.match(ownerHtml, /id="ownerTutorialEdition"/);
  assert.match(ownerHtml, /id="ownerTutorialLinksList"/);
  assert.match(ownerHtml, /id="retryOwnerTutorials"/);
  assert.match(ownerHtml, /Each module has its own YouTube link/);
  assert.match(ownerHtml, /js\/tutorial-module-catalogue\.js/);
  assert.match(ownerJs, /ownerTutorialRequest\(\{ password: unlockedPassword, catalog: ownerTutorialCatalog \}\)/);
  assert.match(ownerJs, /ownerTutorialCatalog = tutorialCatalogDraft\(\);[\s\S]*?setOwnerTutorialEditorReady\(false\);\s*renderOwnerTutorialLinks\(\);\s*try \{/);
  assert.match(ownerJs, /input\.disabled = !ownerTutorialCatalogReady/);
  assert.match(catalogApiSource, /requirePlatformAdmin\(env, body\.password\)/);
  assert.match(settingsSource, /TutorialLinks: normalizeTutorialLinks\(existing\.TutorialLinks/);
  assert.match(settingsSource, /TutorialChannelUrl: normalizeYouTubeTutorialUrl\(existing\.TutorialChannelUrl/);
  assert.match(settingsSource, /await loadPublishedTutorials\(context\.env, storedProfile\.OrganisationEdition, storedProfile\)/);
});

test('owner catalogue exposes edition-specific YouTube fields for Church and desktop modules', () => {
  [
    ['Departments & Members', 'faith'],
    ['Services & Attendance', 'faith'],
    ['Funds & Mappings', 'faith'],
    ['Offerings', 'faith'],
    ['Donations', 'faith'],
    ['Organisation Store', 'faith'],
    ['Restaurant', 'faith'],
    ['Hotel Services', 'faith'],
    ['Bulk Email', 'faith']
  ].forEach(([storageKey, edition]) => {
    const escaped = storageKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(moduleCatalogSource, new RegExp(`storageKey: '${escaped}'[\\s\\S]*?editions: \\[[^\\]]*'${edition}'`));
  });
  assert.match(moduleCatalogSource, /key: 'schoolInsights', storageKey: 'School Insights'/);
  assert.match(adminJs, /schoolInsights: 'School Insights'/);
  assert.match(ownerJs, /faith: 'Church modules'/);
});

test('staff companion exposes the tutorial for the active module on desktop and mobile', () => {
  assert.match(adminHtml, /id="staffTutorialButton"/);
  assert.match(adminHtml, /id="staffTutorialMenu"/);
  assert.doesNotMatch(adminHtml, /id="staffTutorialSettings"/);
  assert.match(adminJs, /function openCurrentTutorial\(\)/);
  assert.match(adminJs, /const tutorialStorageKeys = Object\.freeze/);
  assert.match(adminApiSource, /const tutorials = await loadPublishedTutorials\(env, user\.edition, tutorialProfile \|\| \{\}\)/);
  assert.match(adminApiSource, /tutorials,/);
});

test('parent portal exposes a contextual tutorial for every parent operation', () => {
  assert.match(parentHtml, /id="parentTutorialButton"/);
  assert.match(parentJs, /const parentTutorialContexts = Object\.freeze/);
  [
    'Parent Portal - Sign In',
    'Parent Portal - Student Profile Setup',
    'Parent Portal - Overview',
    'Parent Portal - Payments',
    'Parent Portal - Optional Payments',
    'Parent Portal - Results',
    'Parent Portal - Schedule & Attendance',
    'Parent Portal - Documents',
    'Parent Portal - Wallet',
    'Parent Portal - Clinic',
    'Parent Portal - School Store',
    'Parent Portal - Notifications',
    'Parent Portal - Change Password'
  ].forEach((key) => {
    assert.match(moduleCatalogSource, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(parentJs, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
  assert.match(parentJs, /function currentParentTutorialContext\(\)/);
  assert.match(parentJs, /function openParentTutorial\(event\)/);
  assert.match(parentApiSource, /tutorials: await loadPublishedTutorials\(env, 'school', schoolProfile\)/);
  assert.match(settingsSource, /'TutorialLinks', 'TutorialChannelUrl'/);
});

test('owner catalogue keeps editions independent and validates URLs', () => {
  const catalog = normalizeTutorialCatalog({
    ChannelUrl: 'https://www.youtube.com/@DynamaxVendmac',
    Editions: {
      school: { Links: { Accounts: 'https://youtu.be/school' } },
      faith: { Links: { Accounts: 'https://youtu.be/church' } }
    }
  });
  assert.equal(tutorialsForEdition(catalog, 'school').links.Accounts, 'https://youtu.be/school');
  assert.equal(tutorialsForEdition(catalog, 'faith').links.Accounts, 'https://youtu.be/church');
  assert.deepEqual(tutorialsForEdition(catalog, 'organization').links, {});
  assert.throws(() => normalizeTutorialCatalog({ Editions: { school: { Links: { Accounts: 'https://example.com/video' } } } }), /YouTube/);
});

test('tenant reads the published owner catalogue and falls back to legacy links before publication', async () => {
  const env = {
    ALLOW_CANONICAL_API_PROXY: 'true',
    CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions',
    CANONICAL_PORTAL_URL: 'https://dynamax.cc'
  };
  const legacy = { TutorialLinks: { Overview: 'https://youtu.be/legacy' } };
  const published = await loadPublishedTutorials(env, 'faith', legacy, async () => Response.json({
    ok: true,
    published: true,
    catalog: { Editions: { faith: { Links: { Overview: 'https://youtu.be/owner' } } } }
  }));
  assert.equal(published.links.Overview, 'https://youtu.be/owner');
  const fallback = await loadPublishedTutorials(env, 'faith', legacy, async () => Response.json({
    ok: true, published: false, catalog: {}
  }));
  assert.equal(fallback.links.Overview, 'https://youtu.be/legacy');
  const partialCredentials = await loadPublishedTutorials({
    ...env,
    DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID: 'incomplete-owner-configuration'
  }, 'faith', legacy, async () => Response.json({
    ok: true,
    published: true,
    catalog: { Editions: { faith: { Links: { Overview: 'https://youtu.be/owner' } } } }
  }));
  assert.equal(partialCredentials.links.Overview, 'https://youtu.be/owner');
});

test('desktop profile reads owner tutorials only for responses, not unrelated backend operations', () => {
  assert.match(backendSource, /if \(!options\.includeTutorials\) return \{ ok: true, profile: scopedProfile \}/);
  assert.match(backendSource, /case 'getSchoolProfile':\s*return getSchoolProfile\(env, \{ \.\.\.body, includeTutorials: true \}\)/);
});

test('subscriber password cannot publish the owner catalogue', async () => {
  const request = new Request('https://dynamax.cc/api/tutorial-catalog', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'subscriber-password', catalog: {} })
  });
  const response = await saveTutorialCatalog({ request, env: { ADMIN_WEB_PASSWORD: 'owner-password' } });
  assert.equal(response.status, 401);
  const tenantRequest = new Request('https://subscriber.example/api/tutorial-catalog', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'owner-password', catalog: {} })
  });
  const tenantResponse = await saveTutorialCatalog({ request: tenantRequest, env: { ADMIN_WEB_PASSWORD: 'owner-password' } });
  assert.equal(tenantResponse.status, 403);
});
