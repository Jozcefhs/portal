import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fixture, runtime } from './helpers/academic-archived-memberships-fixture.mjs';
import { extractFunction } from './helpers/academic-register-fixture.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
await mkdir(new URL('../tmp/archived-memberships/', import.meta.url), { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<body class="staff-page"><main id="panel" style="margin:20px"><section class="academic-management-workspace" data-academic-view="students"></section></main></body>');
  for (const path of ['css/style.css', 'css/academic-archived-memberships.css']) {
    await page.addStyleTag({ content: await readFile(new URL(`../${path}`, import.meta.url), 'utf8') });
  }
  await page.addScriptTag({ content: `${runtime}
    const panelEl = document.getElementById('panel');
    const academicManagementTaskViews = {};
    const updateTutorialControls = () => {};
    const { data, rows } = ${JSON.stringify(fixture())};
    ${['academicRegisterCards', 'academicTaskDefinitions', 'showAcademicManagementTask', 'organizeAcademicManagementWorkspace',
      'applyAdminListSearch', 'applyAdminListSort', 'renumberAdminListRows'].map(extractFunction).join('\n')}
    const root = document.querySelector('[data-academic-view]');
    root.innerHTML = table('Student Class & Subject Memberships', [], []) + academicArchivedMembershipWorkspace(data, rows);
    organizeAcademicManagementWorkspace('students');
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-academic-task]');
      if (button) showAcademicManagementTask('students', button.dataset.academicTask);
    });
    document.addEventListener('input', event => { if (event.target.matches('[data-admin-list-search]')) applyAdminListSearch(event.target); });
    document.addEventListener('change', event => { if (event.target.matches('[data-admin-list-sort]')) applyAdminListSort(event.target); });
  ` });
  const archive = page.locator('[data-academic-archived-memberships]');
  assert.equal(await archive.isVisible(), false);
  await page.getByRole('tab', { name: /Archived memberships/ }).click();
  assert.equal(await archive.isVisible(), true);
  assert.equal(await archive.locator('[data-list-row]').count(), 2);
  const first = archive.locator('[data-list-row]').first();
  assert.match(await first.textContent(), /Ada Test.*TEST\/001.*Grade 10 \/ Reserved.*Grade 10 \/ Perfection.*Active/);
  const search = archive.getByRole('searchbox');
  await search.fill('TEST/002');
  assert.equal(await archive.locator('[data-list-row]:visible').count(), 1);
  assert.match(await archive.locator('[data-list-row]:visible').textContent(), /Withdrawn/);
  await search.fill('Perfection');
  assert.equal(await archive.locator('[data-list-row]:visible').count(), 1);
  await search.fill('does-not-exist');
  assert.equal(await archive.locator('[data-list-row]:visible').count(), 0);
  assert.equal(await archive.locator('[data-list-search-empty]').isVisible(), true);
  await search.fill('');
  await archive.getByRole('combobox').selectOption('name-desc');
  assert.match(await first.textContent(), /Bayo Example/);
  await archive.getByRole('combobox').selectOption('default');
  await page.screenshot({ path: fileURLToPath(new URL('../tmp/archived-memberships/desktop.png', import.meta.url)), fullPage: true });

  await page.getByRole('tab', { name: /Student register/ }).click();
  assert.equal(await archive.isVisible(), false);
  await page.getByRole('tab', { name: /Archived memberships/ }).click();
  assert.equal(await archive.isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No page-wide horizontal overflow on mobile');
  const scroller = archive.locator('.admin-table-wrap');
  assert.ok(await scroller.evaluate(el => el.scrollWidth > el.clientWidth), 'Wide table scrolls inside its container');
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  assert.ok(await scroller.evaluate(el => el.scrollLeft > 0));
  await scroller.evaluate(el => { el.scrollLeft = 0; });
  await page.screenshot({ path: fileURLToPath(new URL('../tmp/archived-memberships/mobile.png', import.meta.url)), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Archived memberships: navigation, search, sort, read-only rows, desktop and mobile layout passed.');
} finally {
  await browser.close();
}
