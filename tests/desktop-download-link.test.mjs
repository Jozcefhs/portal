import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';


const indexSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const launcherSource = fs.readFileSync(new URL('../js/launcher.js', import.meta.url), 'utf8');
const releaseManifest = JSON.parse(fs.readFileSync(new URL('../version.json', import.meta.url), 'utf8'));


test('Dynamax landing page exposes the desktop installer download', () => {
  assert.match(indexSource, /id="downloadDesktopInstaller"/);
  assert.match(indexSource, />Download Dynamax Desktop<\/a>/);
});


test('desktop download resolves the current public release manifest', () => {
  assert.match(launcherSource, /fetch\('version\.json', \{ cache: 'no-store' \}\)/);
  assert.match(launcherSource, /candidate\.protocol !== 'https:'/);
  assert.match(launcherSource, /window\.location\.assign\(installerUrl\)/);
});


test('public release manifest includes a verified stable installer', () => {
  assert.equal(releaseManifest.channel, 'stable');
  assert.equal(
    releaseManifest.installer_url,
    'https://github.com/Jozcefhs/portal/releases/download/desktop-stable/Dynamax_Setup.exe',
  );
  assert.match(releaseManifest.sha256, /^[a-f0-9]{64}$/);
});


test('landing-page installer link uses the same public stable asset', () => {
  assert.match(
    indexSource,
    /href="https:\/\/github\.com\/Jozcefhs\/portal\/releases\/download\/desktop-stable\/Dynamax_Setup\.exe"/,
  );
});
