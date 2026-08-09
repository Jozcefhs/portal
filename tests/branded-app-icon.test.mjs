import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('tenant branding updates visible browser icons as well as page logos', async () => {
  const source = await read('js/site-config.js');
  assert.match(source, /link\[rel="icon"\][\s\S]*?link\[rel="apple-touch-icon"\]/);
  assert.match(source, /node\.href = brandLogo/);
  assert.match(source, /node\.removeAttribute\('type'\)/);
});

test('the install manifest uses the deployment brand with a transparent fallback', async () => {
  const source = await read('functions/api/app-manifest.js');
  assert.match(source, /getWebBranding\(context\.env\)/);
  assert.match(source, /branding && clean\(branding\.WebLogoDataUrl\)/);
  assert.match(source, /\/api\/web-logo\?v=/);
  assert.match(source, /\/images\/Logo\.png\?v=20260801-transparent-app-logo/);
  assert.match(source, /purpose: 'any'/);
  assert.doesNotMatch(source, /maskable/);
  assert.match(source, /application\/manifest\+json/);
});
