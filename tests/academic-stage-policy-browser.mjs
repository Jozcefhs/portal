import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {normalizeAcademicPolicy} from '../functions/lib/academic-policy.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const [html,js,css]=await Promise.all(['setup.html','js/setup.js','css/style.css'].map(file=>readFile(new URL('../'+file,import.meta.url),'utf8')));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1100,height:900}}),requests=[],errors=[];
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  const section=html.slice(html.indexOf('<section id="academic-policy-settings"'),html.indexOf('<section id="brand-settings"'));
  assert.ok(section.includes('academicNurseryPromotionMode'));
  await page.setContent(`<style>${css}</style>${section}`);
  await page.addScriptTag({content:'let loadedAcademicPolicyView = {};\n'+js.slice(js.indexOf('function setField('),js.indexOf('function renderAcademicPolicyIssues('))});
  const fixture=normalizeAcademicPolicy({Promotion:{Mode:'manual-review',Nursery:{Mode:'manual-review'},Primary:{Mode:'criteria',MinimumOverallAverage:55,MaximumFailedSubjects:0,MinimumAttendancePercentage:75}}});
  await page.evaluate(p=>renderAcademicPolicy(p),fixture);
  assert.equal(await page.locator('#academicPrimaryMaximumFailedSubjects').inputValue(),'0');
  assert.ok(await page.locator('[data-stage-promotion-fields="Nursery"]').isHidden());
  assert.ok(await page.locator('[data-stage-promotion-fields="Primary"]').isVisible());
  await page.locator('#academicPrimaryMinimumOverallAverage').fill('62.5');
  let saved=await page.evaluate(()=>academicPolicyFromForm());
  assert.equal(saved.Promotion.Primary.MinimumOverallAverage,62.5);
  assert.equal(saved.Promotion.Primary.MaximumFailedSubjects,0);
  assert.equal(saved.Promotion.Nursery.Mode,'manual-review');
  await page.evaluate(p=>renderAcademicPolicy(p),normalizeAcademicPolicy(saved));
  assert.equal(await page.locator('#academicPrimaryMinimumOverallAverage').inputValue(),'62.5');
  await page.locator('#academicNurseryPromotionMode').selectOption('criteria');
  await page.evaluate(()=>updateAcademicPolicyConditionalFields());
  await page.locator('#academicNurseryMinimumOverallAverage').fill('40');
  saved=await page.evaluate(()=>academicPolicyFromForm());
  assert.equal(saved.Promotion.Nursery.MinimumOverallAverage,40);
  assert.equal(saved.Promotion.Primary.MinimumOverallAverage,62.5);
  await mkdir(new URL('../tmp/',import.meta.url),{recursive:true});
  for(const width of [1100,390]){
    await page.setViewportSize({width,height:900});
    await page.locator('#academicNurseryPromotionMode').scrollIntoViewIfNeeded();
    await page.screenshot({path:new URL(`../tmp/stage-policy-${width}.png`,import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')});
    const rect=await page.locator('#academicNurseryPromotionMode').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'Editing a draft form needs no database reads or writes');
  console.log('PASS: independent nursery/primary form round trip, zero threshold retained, desktop/mobile fit, no network requests.');
} finally {await browser.close();}
