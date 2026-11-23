// Browser-only synthetic checks: no production endpoint or financial mutation.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile('js/history-date-range.js', 'utf8');
const admin = await readFile('js/admin.js', 'utf8');
const adminFunction = name => {
  const start = admin.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  return admin.slice(start, admin.indexOf('\n}', start) + 2);
};
await mkdir('tmp/history-date-range', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } }), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      assert.equal(route.request().url(), 'https://history-fixture.test/');
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main style="max-width:1100px;padding:12px;margin:auto"><h1>School Store</h1><section id="panel"></section></main>' });
    });
    await page.goto('https://history-fixture.test/');
    await page.addStyleTag({ content: (await readFile('css/style.css', 'utf8')).replace(/@import[^;]+;/g, '') });
    await page.addScriptTag({ content: source });
    await page.addScriptTag({ content: `
      window.loads = []; window.branch = 'main';
      window.workspace = DynamaxHistoryDates.createHistoryDateWorkspace({panel:document.getElementById('panel'),scope:()=>branch,
        title:module=>module,load:module=>{loads.push({module,range:workspace.range(module)});draw(module);}});
      window.draw = module => {const allowed=workspace.show(module); if(allowed)document.getElementById('panel').textContent='Current records ready';return allowed;};
      draw('organizationStore');
    ` });
    const history = page.locator('[data-history-options]'), from = page.getByLabel('From', { exact: true }), to = page.getByLabel('To', { exact: true });
    assert.equal(await history.getAttribute('open'), null);
    assert.equal(await from.isVisible(), false); assert.equal(await page.getByRole('button', { name: 'Load selected period' }).isVisible(), false);
    assert.equal(await page.locator('#panel').innerText(), 'Current records ready');
    await page.screenshot({ path: `tmp/history-date-range/${width}.png`, fullPage: true });
    await page.getByText('History by date', { exact: true }).click();
    assert.equal(await from.isVisible(), true); assert.equal(await page.evaluate(() => loads.length), 0);
    await page.getByText('History by date', { exact: true }).click();
    await page.getByText('History by date', { exact: true }).click();
    assert.equal(await page.evaluate(() => loads.length), 0, 'Expanding or collapsing history never loads data');
    await from.fill('2026-11-01'); await to.fill('2026-11-10');
    await page.getByRole('button', { name: 'Load selected period' }).click();
    assert.equal(await page.evaluate(() => loads.length), 1);
    assert.equal(await history.getAttribute('open'), ''); assert.equal(await from.inputValue(), '2026-11-01');
    assert.deepEqual(await page.evaluate(() => loads[0]), {module:'organizationStore',range:{fromDate:'2026-11-01',toDate:'2026-11-10'}});
    await page.evaluate(() => {draw('members');draw('organizationStore');});
    assert.equal(await history.getAttribute('open'), ''); assert.equal(await to.inputValue(), '2026-11-10');
    assert.equal(await page.evaluate(() => loads.length), 1, 'Returning to the loaded range reuses the existing selection');
    await page.evaluate(() => {branch='other';draw('organizationStore');});
    assert.equal(await history.getAttribute('open'), null); assert.equal(await from.inputValue(), '');
    assert.equal(await page.evaluate(() => draw('payroll')), false);
    assert.equal(await page.locator('[data-history-options]').count(), 0); assert.equal(await from.isVisible(), true);
    assert.match(await page.locator('#panel').innerText(), /Choose dates/);
    assert.equal(await page.evaluate(() => draw('financeRequests')), true);
    assert.equal(await from.isVisible(), false); assert.equal(await from.getAttribute('required'), null);
    await page.getByRole('button', { name: 'Completed history', exact: true }).click();
    assert.equal(await from.isVisible(), true); assert.match(await page.locator('#panel').innerText(), /Choose dates/);
    await page.getByRole('button', { name: 'Open requests', exact: true }).click();
    assert.equal(await from.isVisible(), false); assert.equal(await page.locator('#panel').innerText(), 'Current records ready');

    await page.addScriptTag({ content: `
      ${adminFunction('admissionFormPurchaseHeader')}
      ${adminFunction('churchGivingQrHeader')}
      ${adminFunction('bindChurchGivingQr')}
      const churchDonationRequest = async action => { window.givingAction = action; return {}; };
      const showChurchGivingQr = (_result, viewer) => { window.givingOpened = Boolean(viewer); };
      ${adminFunction('bindAdmissionFormPurchaseQr')}
      ${adminFunction('admissionFormPurchasesWorkspace')}
      ${adminFunction('renderSection')}
      const panelEl = document.querySelector('#panel');
      const summaryEl = document.createElement('div');
      const dashboardStatus = document.createElement('div');
      let dashboardData = null;
      const currentUser = { role: 'Super Admin' };
      const legacyDashboardSections = new Set(['formPurchases']);
      const invalidatedDashboardSections = new Set(), dashboardSectionRequests = new Map();
      const staffTabLabel = () => 'Form Purchases', escapeHtml = value => value;
      const table = (_title, rows) => '<p>' + rows[0].ReceiptNo + '</p>';
      const directTransferVerificationWorkspace = () => '';
      const loadDirectTransferVerification = () => {};
      const setButtonLoading = (button, busy) => { button.disabled = busy; };
      const setStatus = (_node, message) => { throw new Error(message); };
      window.qrRequests = [];
      const staffFetch = async (path, options) => {
        qrRequests.push({path, body: JSON.parse(options.body)});
        return {ok:true, json: async () => ({ok:true})};
      };
      window.open = () => ({document:{write(){},close(){}},close(){}});
      const showAdmissionFormPurchaseQr = () => { window.qrShown = true; };
      const historyDateWorkspace = DynamaxHistoryDates.createHistoryDateWorkspace({
        panel: panelEl, scope: () => branch, title: () => 'Purchase history',
        header: module => module === 'formPurchases' ? admissionFormPurchaseHeader() : module === 'donations' ? churchGivingQrHeader() : '',
        load: renderSection
      });
      const loadDashboard = async () => {
        loads.push({ module: 'formPurchases', range: historyDateWorkspace.range('formPurchases') });
        dashboardData.departments.formPurchases = [{ReceiptNo:'Fixture receipt'}];
        renderSection('formPurchases');
      };
      window.workspace.clear();
      window.loads = [];
      renderSection('formPurchases');
    ` });
    const purchaseQr = page.getByRole('button', { name: 'Purchase QR' });
    assert.equal(await purchaseQr.isVisible(), true);
    assert.ok((await purchaseQr.boundingBox()).y < (await from.boundingBox()).y, 'Purchase QR appears above the date fields');
    assert.equal(await page.evaluate(() => loads.length), 0, 'Opening Form Purchases does not request history');
    await purchaseQr.click();
    assert.equal(await page.evaluate(() => window.qrShown), true);
    assert.deepEqual(await page.evaluate(() => qrRequests), [{ path: '/api/staff-admission-forms', body: { action: 'genericQr' } }]);
    assert.equal(await page.evaluate(() => loads.length), 0, 'Opening the QR does not request history');
    await page.evaluate(() => { dashboardData = { departments: {} }; });
    await from.fill('2026-11-01'); await to.fill('2026-11-10');
    await page.getByRole('button', { name: 'Load selected period' }).click();
    await page.getByText('Fixture receipt', { exact: true }).waitFor();
    assert.equal(await purchaseQr.count(), 1);
    assert.deepEqual(await page.evaluate(() => loads), [{ module: 'formPurchases', range: { fromDate: '2026-11-01', toDate: '2026-11-10' } }]);
    await page.evaluate(() => { branch = 'new-branch'; renderSection('formPurchases'); });
    assert.equal(await purchaseQr.isVisible(), true);
    assert.equal(await page.getByText('Fixture receipt', { exact: true }).count(), 0);
    await page.evaluate(() => { dashboardData = null; renderSection('donations'); });
    const givingQr = page.getByRole('button', {name:'Generic Giving QR'});
    assert.equal(await from.inputValue(), '');
    assert.equal(await to.inputValue(), '');
    const beforeGiving = await page.evaluate(() => loads.length);
    await givingQr.click();
    assert.deepEqual(await page.evaluate(() => [givingAction, givingOpened, loads.length]), ['genericqr', true, beforeGiving]);
    assert.deepEqual(errors, []);
    await context.close(); console.log(`History ${width}px: optional disclosure, zero requests on toggle, retained loaded range, isolated branch, required history and pending finance behavior passed.`);
  }
} finally { await browser.close(); }
