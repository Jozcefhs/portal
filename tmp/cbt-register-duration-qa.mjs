import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/DYNAMAX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const admin=(await readFile('js/admin.js','utf8')).replaceAll('\r\n','\n');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1000,height:850}});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<!doctype html><main id="qa"></main>');
 await page.addStyleTag({content:await readFile('css/style.css','utf8')});
 await page.addScriptTag({content:await readFile('js/list-sorting.js','utf8')});
 const tableCode=admin.slice(admin.indexOf('const {\n  modes: ADMIN_LIST_SORT_MODES'),admin.indexOf('function workspaceViewStorageKey('));
 const registerStart=admin.indexOf("  const register = table('Scheduled CBT Tests'");
 const registerCode=admin.slice(registerStart,admin.indexOf('\n  return `${editor}',registerStart));
 const dialogCode=admin.slice(admin.indexOf('function openAcademicCbtRescheduleDialog('),admin.indexOf('async function boundedAcademicGenerationRequest('));
 await page.addScriptTag({content:`const clean=v=>String(v??'').trim(); const escapeHtml=v=>clean(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'); const activeSection='academics'; const DynamaxTime={formatDateTime:v=>v,formatCell:v=>v}; const academicLabel=(_rows,id,fallback)=>fallback||id; const academicCbtStatus=()=>({label:'Scheduled',className:'scheduled'}); const academicCbtHasCloudPapers=()=>false; ${tableCode}
 const rows={classes:[],subjects:[],cbtTests:[{CbtTestId:'math',SubjectName:'Mathematics',ClassId:'Grade 8',StartsAt:'2099-01-01',AssessmentComponentName:'CA1',Status:'Scheduled'},{CbtTestId:'english',SubjectName:'English',ClassId:'Grade 9',StartsAt:'2099-01-01',AssessmentComponentName:'CA1',Status:'Scheduled'}]}; ${registerCode} document.getElementById('qa').innerHTML=register;
 const academicCbtLocalParts=()=>({date:'2099-01-01',time:'09:00'}); const setStatus=(node,text)=>node.textContent=text; const runButtonAction=async(_b,_l,fn)=>fn(); const academicManagementFilters={section:'secondary'}; const academicManagementData={}; const calls=[]; const academicManagementRequest=async(action,payload)=>{calls.push({action,payload});return {};}; const mergeAcademicCbtTest=()=>{}; const renderAcademicManagement=()=>{}; ${dialogCode}`});
 assert.deepEqual(errors,[]);
 const search=page.locator('[data-admin-list-search]'); await search.fill('math');
 assert.equal(await page.locator('[data-list-row]:visible').count(),1); assert.match(await page.locator('[data-list-row]:visible').textContent(),/Mathematics/);
 await search.fill('missing'); assert.equal(await page.locator('[data-list-search-empty]').isVisible(),true);
 await search.fill(''); assert.equal(await page.locator('[data-list-row]:visible').count(),2);
 for (const split of [false,true,false]) {
  await page.evaluate(split=>openAcademicCbtRescheduleDialog({CbtTestId:'test',RevisionToken:'known',DurationMinutes:40,PaperMode:split?'split':'single',TheoryDurationMinutes:60}),split);
  assert.equal(await page.locator('[name=TheoryDurationMinutes]').isVisible(),split);
  assert.equal(await page.locator('[name=DurationMinutes]').inputValue(),'40');
  await page.locator('[name=DurationMinutes]').fill('55');
  if(split) await page.locator('[name=TheoryDurationMinutes]').fill('75');
  await page.locator('dialog button[type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  const payload=await page.evaluate(()=>calls.at(-1).payload);
  assert.equal(payload.DurationMinutes,55); assert.equal(payload.TheoryDurationMinutes,split?75:0); assert.equal(payload.RevisionToken,'known');
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>openAcademicCbtRescheduleDialog({DurationMinutes:40,PaperMode:'split',TheoryDurationMinutes:60}));
 await page.screenshot({path:'tmp/cbt-duration-mobile.png'});
 assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
 assert.deepEqual(errors,[]);
 console.log('PASS automatic register search, empty/clear, single/split/reused duration dialogs, submission payload and mobile layout');
} finally {await browser.close();}
