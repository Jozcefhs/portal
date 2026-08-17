import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('staff companion forces the current branch profile to refresh with its dashboard', async () => {
  const [admin, siteConfig, settings] = await Promise.all([
    source('js/admin.js'),
    source('js/site-config.js'),
    source('functions/api/settings.js')
  ]);
  assert.match(admin, /if \(mode === 'shell'\) await refreshStaffSiteProfile\(\)/);
  assert.match(admin, /branchId: branchId && branchId !== 'all' \? branchId : ''/);
  assert.match(siteConfig, /\/api\/settings\?\$\{params\.toString\(\)\}/);
  assert.match(siteConfig, /force: true/);
  assert.match(siteConfig, /fetchCache: 'no-store'/);
  assert.match(settings, /getProfile\(context\.env, \{ branchId, fresh \}\)/);
  assert.match(settings, /readStaffSession\(context\.env, context\.request\)/);
  assert.match(settings, /const fresh = Boolean\(staff\)/);
  assert.match(settings, /freshRequested \? 'no-store'/);
});

test('saving settings invalidates this tab and refreshes an open companion tab', async () => {
  const [setup, admin] = await Promise.all([
    source('js/setup.js'),
    source('js/admin.js')
  ]);
  assert.match(setup, /startsWith\('dynamax-public-api:settings'\)/);
  assert.match(setup, /localStorage\.setItem\('dynamax:settings-revision'/);
  assert.match(admin, /event\.key !== 'dynamax:settings-revision'/);
  assert.match(admin, /await refreshStaffSiteProfile\(\)/);
  assert.match(admin, /activeSection === 'academics'/);
  assert.match(admin, /await loadAcademicManagement\(\{ message: 'Academic policy and records refreshed\.' \}\)/);
});
