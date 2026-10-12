import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const css = await readFile(new URL('css/style.css', root), 'utf8');

test('registration has a named onboarding card before the existing workspaces', async () => {
  const card = html.match(/<section class="launcher-registration"[\s\S]*?<\/section>/)?.[0];
  assert.ok(card);
  assert.match(card, /aria-labelledby="registrationTitle"/);
  assert.match(card, /<h3 id="registrationTitle">New to Dynamax\?<\/h3>/);
  assert.match(card, /class="launcher-registration-button" href="register-organization\.html"/);
  assert.match(card, /Register &amp; choose a plan/);
  assert.ok(html.indexOf(card) < html.indexOf('class="launcher-channels"'));
  assert.equal((html.match(/href="register-organization\.html"/g) || []).length, 1);
  assert.match(html, /Already registered\? Choose your workspace/);
  assert.ok((await readFile(new URL('register-organization.html', root), 'utf8')).includes('<form'));
});

test('Help and desktop download remain secondary without changing workspace destinations', () => {
  const actions = html.match(/<div class="launcher-public-actions">[\s\S]*?<\/div>/)?.[0];
  assert.match(actions, /href="help\.html"/);
  assert.match(actions, /id="downloadDesktopInstaller"/);
  assert.doesNotMatch(actions, /register-organization/);
  for (const href of ['school.html', 'admin.html?workspace=faith', 'admin.html?workspace=organization']) {
    assert.ok(html.includes(`href="${href}"`));
  }
  assert.match(html, /id="openServices"/);
  assert.match(html, /css\/style\.css\?v=[^"]*20261012-registration-card/);
});

test('registration supports mobile, keyboard, dark mode and vertically scrolling layouts', () => {
  assert.match(css, /\.launcher-registration-button\{[^}]*min-height:48px/);
  assert.match(css, /\.launcher-registration-button:focus-visible\{[^}]*outline:3px/);
  const mobileStart = css.indexOf('@media (max-width:560px)');
  assert.ok(mobileStart >= 0);
  assert.match(css.slice(mobileStart), /\.launcher-registration-button\{grid-column:1\/-1;justify-self:stretch;width:100%\}/);
  assert.match(css, /html\[data-theme="dark"\] \.launcher-registration\{/);
  assert.match(css, /\.suite-launcher-page\{[^}]*height:auto;[^}]*overflow-y:auto/);
  assert.match(css, /\.suite-launcher-page\.launcher-modal-open\{overflow:hidden\}/);
});
