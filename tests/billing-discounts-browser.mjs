// Exercise the Accounts button and dialog using synthetic branch data.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { billingDiscountId, handleBillingDiscounts } from '../functions/lib/billing-category-discounts.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const [admin, discounts, style] = await Promise.all(['js/admin.js', 'js/billing-discounts.js', 'css/style.css'].map(file => readFile(file, 'utf8')));
const start = admin.indexOf('    if (', admin.indexOf("const clubMembers = mountClubMemberRegister(panelEl);"));
const end = admin.indexOf("      if (resolveDashboardEdition() === 'school')", start);
assert.ok(start >= 0 && end >= 0);
const launcher = 'export function render() {\n' + admin.slice(start, end) + '\n}\n}';
await mkdir('tmp/billing-discount-ui', { recursive: true });

try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await context.newPage(), calls = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const classes = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4'];
    const archived = { RateId: 'older', DiscountType: 'Fixed amount', DiscountValue: 950,
      ClassScope: 'Selected', ClassNames: ['Transition'], TermScope: 'Selected', TermNames: ['Autumn Term'] };
    const documents = new Map();
    for (const policy of [{ Name: 'Church Staff Child', DiscountType: 'Percentage', DiscountValue: 15 },
      { Name: 'Sponsored', DiscountType: 'None', DiscountValue: 0, Rates: [archived] }]) {
      documents.set(await billingDiscountId('annex', policy.Name), { ...policy, BranchId: 'annex', __updateTime: 'v1' });
    }
    let nextError = '', incompleteList = false, supported = true, version = 1;
    const deps = {
      listCollection: async () => [],
      queryCollection: async (_env, path, query) => {
        assert.deepEqual(query.filters, [{ field: 'BranchId', op: '==', value: 'annex' }]);
        if (path === 'billingCategoryDiscounts') return [...documents.values()];
        assert.equal(path, 'academicTerms');
        return [{ BranchId: 'annex', Name: 'Summer Term', Status: 'Active' }];
      },
      getSchoolClasses: async (_env, options) => {
        assert.deepEqual(options, { BranchId: 'annex', IncludeAcademicClasses: true });
        return { classes: classes.map(ClassName => ({ ClassName, Active: 'YES' })) };
      },
      getDocument: async (_env, path, id) => {
        assert.equal(path, 'billingCategoryDiscounts'); return documents.get(id);
      },
      batchCommitLiteralDocuments: async (_env, [write, audit]) => {
        assert.equal(write.collectionPath, 'billingCategoryDiscounts'); assert.equal(audit.collectionPath, 'accountingAudit');
        const existing = documents.get(write.documentId);
        if (existing) assert.equal(write.updateTime, existing.__updateTime); else assert.equal(write.exists, false);
        const updateTime = 'v' + ++version;
        documents.set(write.documentId, { ...write.data, __updateTime: updateTime });
        return { writeResults: [{ updateTime }, { updateTime }] };
      }
    };
    await context.route('**/*', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/js/billing-discounts.js' || path === '/js/test-launcher.js') return route.fulfill({
        contentType: 'text/javascript', body: path.includes('test-launcher') ? launcher : discounts
      });
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body class="staff-page"><main><div class="workflow-intro"></div></main>' });
      assert.equal(path, '/api/billing-discounts');
      const input = route.request().postDataJSON();
      assert.equal(input.BranchId, 'annex');
      calls.push(input);
      if (nextError) {
        const message = nextError; nextError = '';
        return route.fulfill({ status: 409, json: { ok: false, message } });
      }
      const user = { ...await page.evaluate(() => window.currentUser), username: 'finance', branchId: 'annex', BranchIds: ['annex'] };
      try {
        const data = await handleBillingDiscounts({}, user, input, deps);
        if (input.action === 'list') {
          assert.equal(input.IncludeOptions, true);
          if (incompleteList) delete data.terms;
          if (!supported) delete data.scopedRatesVersion;
        }
        return route.fulfill({ json: data });
      } catch (error) {
        if (!error.status) throw error;
        return route.fulfill({ status: error.status, json: { ok: false, message: error.message } });
      }
    });
    await page.goto('https://discount-fixture.test/');
    await page.addStyleTag({ content: style.replace(/@import[^;]+;/g, '') });
    await page.evaluate(async () => {
      window.panelEl = document.querySelector('main');
      window.selectedBranchId = 'all'; window.activeSection = 'accounts';
      window.availableBranches = [{ id: 'annex', name: 'Annex Campus' }];
      window.staffSessionAbortController = new AbortController();
      window.staffFetch = (...args) => fetch(...args);
      window.alert = message => { window.lastAlert = message; };
      window.DynamaxDialogs = { confirm: async () => window.confirmRemoval };
      const { render } = await import('/js/test-launcher.js');
      window.launchAs = (role, readOnly = false) => {
        window.currentUser = { assignedRole: role, allowedSections: ['accounts'], subscriptionReadOnly: readOnly };
        panelEl.querySelector('.workflow-intro').replaceChildren();
        render();
      };
      launchAs('Teacher');
    });
    const launcherButton = page.getByRole('button', { name: 'Billing categories & discounts', exact: true });
    assert.equal(await launcherButton.count(), 0);
    await page.evaluate(() => launchAs('Accounts Officer'));
    await launcherButton.click();
    assert.match(await page.evaluate(() => window.lastAlert), /one working branch/);
    assert.equal(calls.length, 0);
    await page.evaluate(() => { window.selectedBranchId = 'annex'; });
    await launcherButton.click();
    const label = text => page.getByLabel(text, { exact: true });
    const button = text => page.getByRole('button', { name: text, exact: true });
    const status = text => page.getByRole('status').filter({ hasText: text }).waitFor();
    const category = async text => { await label('Billing category').fill(text); await label('Billing category').press('Tab'); };
    const save = button('Save total-fee discount'), add = button('Add rate'), remove = button('Remove rate');
    const close = button('Close'), reload = button('Reload settings');
    const type = label('Discount on total school fees'), value = label('Value (% or NGN)');
    await page.getByText('Branch: Annex Campus', { exact: true }).waitFor();
    assert.equal(await type.inputValue(), 'Percentage');
    assert.equal(await value.inputValue(), '15');
    for (const name of ['Classes', 'Terms']) assert.equal(await label(name).inputValue(), 'All', 'legacy defaults retain all coverage');
    await category('Sibling Discount');
    for (const name of ['Classes', 'Terms']) assert.equal(await label(name).inputValue(), 'Selected');
    await type.selectOption('Percentage'); await value.fill('10');
    await save.click(); await status('Choose at least one class');
    await label('Grade 1').check(); await label('Grade 2').check();
    await save.click(); await status('Choose at least one term');
    await label('First Term').check(); await label('Third Term').check();
    assert.equal(calls.length, 1, 'editing and validation use options from the one list request');
    nextError = 'Temporary save error';
    await save.click(); await status('Temporary save error');
    await save.evaluate(element => { element.click(); element.click(); }); await status('Discount saved');
    const first = calls.at(-1);
    assert.match(first.RateId, /^[0-9a-f-]{36}$/);
    assert.equal(first.RateId, calls.at(-2).RateId, 'retry must reuse its draft id');
    assert.equal(calls.length, 3, 'double click must only send one save');
    assert.deepEqual(first.ClassNames, ['Grade 1', 'Grade 2']);
    assert.deepEqual(first.TermNames, ['First Term', 'Third Term']);
    await add.click();
    await type.selectOption('Fixed amount'); await value.fill('12000');
    await label('Grade 3').check(); await label('Terms').selectOption('All');
    await save.click(); await status('Discount saved');
    const second = calls.at(-1);
    assert.notEqual(second.RateId, first.RateId);
    assert.equal(second.TermScope, 'All'); assert.deepEqual(second.TermNames, []);
    const siblingId = await billingDiscountId('annex', 'Sibling Discount');
    const sibling = () => documents.get(siblingId);
    assert.equal(sibling().Rates.length, 2);
    await button('10% · Grade 1, Grade 2 · First Term, Third Term').click();
    assert.equal(await label('Grade 2').isChecked(), true); assert.equal(await label('Third Term').isChecked(), true);
    sibling().__updateTime = 'other-editor';
    await value.fill('11'); await save.click(); await status('Reload its settings');
    assert.equal(sibling().Rates.find(row => row.RateId === first.RateId).DiscountValue, 10);
    await reload.click(); await button('10% · Grade 1, Grade 2 · First Term, Third Term').click();
    await value.fill('11'); await save.click(); await status('Discount saved');
    assert.equal(calls.at(-1).RateId, first.RateId); assert.equal(sibling().Rates.length, 2);
    await button('Category default · No discount · All classes, all terms').click();
    await type.selectOption('Percentage'); await value.fill('4');
    await save.click(); await status('Discount saved');
    assert.equal(calls.at(-1).RateId, 'default'); assert.equal(sibling().Rates.length, 2);
    await add.click(); await type.selectOption('Percentage'); await value.fill('9');
    await label('Grade 1').check(); await label('First Term').check();
    await save.click(); await status('overlaps another saved rate');
    assert.equal(await value.inputValue(), '9'); assert.equal(sibling().Rates.length, 2);
    await reload.click(); await page.getByRole('button', { name: /^11%/ }).click();
    await remove.click(); assert.equal(calls.at(-1).action, 'list', 'cancelled removal never writes');
    await page.evaluate(() => { window.confirmRemoval = true; });
    await remove.click(); await status('Rate removed');
    assert.equal(calls.at(-1).RateId, first.RateId); assert.equal(calls.at(-1).RemoveRate, true);
    assert.deepEqual(sibling().Rates.map(row => row.RateId), [second.RateId]); assert.equal(sibling().DiscountValue, 4);
    await category('Sponsored');
    assert.equal(await label('Transition (no longer offered)').isChecked(), true);
    assert.equal(await label('Autumn Term (no longer offered)').isChecked(), true);
    await value.fill('975'); await save.click(); await status('Discount saved');
    assert.deepEqual(calls.at(-1).ClassNames, archived.ClassNames); assert.deepEqual(calls.at(-1).TermNames, archived.TermNames);
    await category('Founders'); await type.selectOption('Percentage'); await value.fill('3');
    await label('Classes').selectOption('All'); await label('Second Term').check();
    await save.click(); await status('Discount saved');
    assert.equal(calls.at(-1).ClassScope, 'All'); assert.deepEqual(calls.at(-1).ClassNames, []);
    assert.deepEqual(calls.at(-1).TermNames, ['Second Term']);
    await add.click(); await type.selectOption('Percentage'); await value.fill('2');
    await label('Classes').selectOption('All'); await label('Terms').selectOption('All');
    await save.click(); await status('Discount saved'); assert.equal(calls.at(-1).RateId, 'default');
    await category('Sibling Discount');
    await add.click();
    const dialog = page.getByRole('dialog');
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), 'no horizontal scrolling');
    await save.scrollIntoViewIfNeeded();
    const bounds = await save.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 850, 'save reachable at this viewport');
    await dialog.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `tmp/billing-discount-ui/${width}.png` });
    const previous = calls.length;
    await page.evaluate(() => { window.activeSection = 'students'; });
    await save.click(); assert.equal(calls.length, previous);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('dynamax:staff-branch-changed')));
    await dialog.waitFor({ state: 'detached' });
    await page.evaluate(() => { window.activeSection = 'accounts'; launchAs('Director', true); });
    await launcherButton.click(); await status('Read-only access');
    await category('Sibling Discount');
    assert.equal(await save.isDisabled(), true); assert.equal(await add.isVisible(), false);
    assert.equal(await remove.isVisible(), false); await close.click();
    incompleteList = true; await launcherButton.click(); await status('Could not load terms');
    assert.equal(await save.isDisabled(), true); incompleteList = false;
    await reload.click(); await status('Read-only access'); await close.click();
    supported = false; await page.evaluate(() => launchAs('Accounts Officer'));
    await launcherButton.click(); await status('service needs an update');
    assert.equal(await save.isDisabled(), true);
    const unsupported = calls.length; await page.locator('form').evaluate(form => form.requestSubmit());
    assert.equal(calls.length, unsupported, 'new controls cannot save against an old service'); await close.click();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS: Accounts permissions and branches, desktop/mobile rates, defaults, multi-class/term rounds, editing, retry, overlap errors, removal, inactive selections and read-only access.');
} finally { await browser.close(); }
