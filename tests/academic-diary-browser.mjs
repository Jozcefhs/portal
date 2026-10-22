// Isolated diary UI regression: no school records or live requests.
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(pathToFileURL(process.env.SUBMISSION_PLAYWRIGHT_MODULE).href);
const sources = Object.fromEntries(await Promise.all(['academic-diary', 'academic-submissions'].map(async name =>
  [`/${name}.js`, await fs.readFile(`js/${name}.js`, 'utf8')])));
const harness = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><button id="open">Open diary</button><script type="module">
import {openAcademicDiary} from '/academic-diary.js';
window.calls=[];
const Classrooms=[{ClassId:'g10',ArmId:'a',Name:'Grade 10 / Brilliance'},{ClassId:'g9',ArmId:'b',Name:'Grade 9 / Excellence'}];
async function request(action,input){
 window.calls.push({action,input});
 if(action==='getAcademicSubmissionSettings')return {settings:{Enabled:false}};
 if(action!=='getAcademicDiary')throw new Error('Unexpected write: '+action);
 if(!input.ClassId)return {diary:{Classrooms}};
 const Subjects=input.ClassId==='g10'?[{SubjectId:'math',Name:'Mathematics'},{SubjectId:'art',Name:'Visual Arts'}]:[{SubjectId:'english',Name:'English'}];
 if(input.SubjectId&&!Subjects.some(row=>row.SubjectId===input.SubjectId))throw new Error('Wrong classroom subject');
 return {diary:{Classrooms,Subjects,OwnSubjects:Subjects.map(row=>row.SubjectId),CanCompile:false,CanReview:true,SessionName:'2026/2027',TermName:'First Term',Weekly:{Entries:[],Status:'Draft',Week:1},Scheme:{Weeks:[]}}};
}
document.querySelector('#open').onclick=()=>openAcademicDiary({request,context:{SessionId:'s',TermId:'t'}});
</script>`;
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
 for(const viewport of [{width:1366,height:900},{width:390,height:844}]){
  const context = await browser.newContext({viewport});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='http://localhost:4198')return route.abort();
   return route.fulfill({contentType:sources[url.pathname]?'application/javascript':'text/html',body:sources[url.pathname]||harness});
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:4198/'); await page.locator('#open').click();
  await page.waitForFunction(()=>document.querySelector('[name=SubjectId]')?.options.length===3);
  await page.locator('[name=SubjectId]').selectOption('math');
  await page.locator('[data-work]').waitFor();
  await page.locator('[data-work]').fill('Unsaved lesson work');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('[name=Classroom]').selectOption('1');
  assert.equal(await page.locator('[name=Classroom]').inputValue(),'0');
  assert.equal(await page.locator('[data-work]').inputValue(),'Unsaved lesson work');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[name=Classroom]').selectOption('1');
  await page.waitForFunction(()=>document.querySelector('[name=SubjectId]')?.options[1]?.value==='english');
  assert.equal(await page.locator('[name=SubjectId]').inputValue(),'');
  assert.equal(await page.locator('[name=SubjectId] option').count(),2);
  await page.locator('[name=SubjectId]').selectOption('english');
  await page.locator('[data-work]').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'tmp/diary-subjects-'+viewport.width+'.png',fullPage:true});
  assert.deepEqual(errors,[]); await context.close();
 }
 console.log('PASS: diary loads subjects initially and on classroom changes, resets stale subjects, protects unsaved edits; desktop/mobile.');
}finally{await browser.close();}
