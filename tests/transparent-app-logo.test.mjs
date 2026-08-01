import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('installed app logo remains transparent instead of requesting a maskable icon plate', async () => {
  const [manifestSource, iconSource] = await Promise.all([
    read('manifest.webmanifest'),
    read('app-icon.svg')
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.icons[0].purpose, 'any');
  assert.doesNotMatch(manifest.icons[0].purpose, /maskable/);
  assert.match(manifest.icons[0].src, /transparent-app-logo/);
  assert.doesNotMatch(iconSource, /<rect\b/);
});

test('visible product logo wrappers have no supplied card background', async () => {
  const [styleSource, indexSource, schoolSource, parentSource] = await Promise.all([
    read('css/style.css'),
    read('index.html'),
    read('school.html'),
    read('parent-dashboard.html')
  ]);

  assert.match(styleSource, /\.launcher-logo\{[^}]*border:0[^}]*background:transparent[^}]*box-shadow:none/);
  assert.match(styleSource, /\.settings-logo-wrap\{[^}]*border:0[^}]*background:transparent[^}]*box-shadow:none/);
  for (const source of [indexSource, schoolSource, parentSource]) {
    assert.match(source, /manifest\.webmanifest\?v=20260801-transparent-app-logo/);
    assert.match(source, /images\/Logo\.png\?v=20260801-transparent-app-logo/);
  }
});
