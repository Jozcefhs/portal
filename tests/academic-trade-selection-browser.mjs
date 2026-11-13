import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const [source, css] = await Promise.all(['js/admin.js','css/style.css'].map(path => readFile(new URL('../'+path, import.meta.url),'utf8')));
const render = source.slice(source.indexOf('function academicOfferingsWorkspace('), source.indexOf('function academicTeacherWorkspace('));
const payload = source.slice(source.indexOf('function academicWorkflowPayload('), source.indexOf('function populateAcademicMovementForm('));
const browser = await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome',headless:true});
try {
  const page = await browser.newPage(), requests = [], errors = [];
  page.on('request',request => requests.push(request.url()));
  page.on('pageerror',error => errors.push(error.message));
  await page.setContent(`<style>${css}</style><main id="panel"></main>`);
  await page.addScriptTag({content:`
    const clean = value => String(value ?? '').trim();
    const escapeHtml = clean, academicIsActive = () => true;
    const academicManagementFilters = {section:'secondary',sessionId:'s',termId:'t'};
    const academicFind = () => null, academicSelectOptions = () => '';
    const academicCheckboxField = () => '', table = () => '';
    const validateAcademicCheckboxFields = () => {};
    ${render}\n${payload}
    function showSaved(required) {
      const data = {permissions:{canManageStructure:true},curriculumSettings:{RequireTradeSubject:required},
        sessions:[],terms:[],classes:[],arms:[],subjects:[],departments:[],offerings:[]};
      document.getElementById('panel').innerHTML = academicOfferingsWorkspace(data,data);
    }
  `});
  for (const width of [1100,390]) {
    await page.setViewportSize({width,height:900});
    for (const required of [false,true,false]) {
      await page.evaluate(value => showSaved(value), required);
      const select = page.locator('[name="RequireTradeSubject"]');
      assert.equal(await select.inputValue(),String(required));
      assert.match(await page.locator('[data-academic-trade-active]').innerText(),
        required ? /Active setting: Compulsory/ : /Active setting: Optional/);
      await select.selectOption(String(!required));
      assert.match(await page.locator('[data-academic-trade-active]').innerText(),
        required ? /Active setting: Compulsory/ : /Active setting: Optional/, 'unsaved edit must not claim to be active');
      const sent = await page.evaluate(() => academicWorkflowPayload(document.querySelector('[data-academic-senior-choice-subjects]')));
      assert.equal(sent.RequireTradeSubject, String(!required));
      const box = await select.boundingBox();
      assert.ok(box.x >= 0 && box.x+box.width <= width+1);
    }
  }
  assert.deepEqual(errors,[]);
  assert.deepEqual(requests,[], 'rendering or editing the selection does not read or write records');
  console.log('PASS: active Trade selection, unsaved changes, real form payload, desktop/mobile and zero network requests.');
} finally { await browser.close(); }
