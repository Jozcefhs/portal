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
const Classrooms=[{ClassId:'g10',ArmId:'a',Name:'Grade 10 / Brilliance'},
 {ClassId:'g10',ArmId:'b',Name:'Grade 10 / Excellence'},{ClassId:'g9',ArmId:'a',Name:'Grade 9 / Brilliance'}];
const saved={};
async function request(action,input){
 window.calls.push({action,input});
 if(action==='getAcademicSubmissionSettings')return {settings:{Enabled:false}};
 if(!input.ClassId)return {diary:{Classrooms,DiaryScope:'Classroom'}};
 if(!input.ArmId)throw new Error('Missing arm');
 const key=input.ClassId+'/'+input.ArmId;
 const Subjects=input.ClassId==='g10'?(input.ArmId==='a'?[{SubjectId:'math',Name:'Mathematics'},{SubjectId:'art',Name:'Visual Arts'}]:[{SubjectId:'math',Name:'Mathematics'}]):[{SubjectId:'english',Name:'English'}];
 if(input.SubjectId&&!Subjects.some(row=>row.SubjectId===input.SubjectId))throw new Error('Wrong classroom subject');
 if(action==='saveAcademicDiaryEntry')saved[key]=[{SubjectId:input.SubjectId,WorkCompleted:input.WorkCompleted,Status:'Draft'}];
 else if(action!=='getAcademicDiary')throw new Error('Unexpected write: '+action);
 return {message:'Diary record saved.',diary:{Classrooms,DiaryScope:'Classroom',Subjects,OwnSubjects:Subjects.map(row=>row.SubjectId),CanCompile:input.ArmId==='a',CanReview:true,CanViewLegacyClassRecords:true,SessionName:'2026/2027',TermName:'First Term',Weekly:{Entries:saved[key]||[],Status:'Draft',Week:1},Scheme:{Weeks:[]},
 LegacyClassRecords:input.IncludeLegacyClassRecords?[{Name:'Grade 10',Weekly:{RecordId:'old-week',Week:1,Status:'Approved',Entries:[{SubjectId:'math',WorkCompleted:'Historical work',TeacherUsername:'old.teacher',Status:'Submitted'}]}}]:undefined}};
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
  assert.deepEqual(await page.locator('[name=Classroom] option').allTextContents(),['Grade 10 / Brilliance','Grade 10 / Excellence','Grade 9 / Brilliance']);
  assert.equal(await page.locator('[name=ClassId]').count(),0);
  await page.locator('[name=SubjectId]').selectOption('math');
  await page.locator('[data-work]').waitFor();
  await page.locator('[data-work]').fill('Unsaved lesson work');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.locator('[name=Classroom]').selectOption(JSON.stringify(['g10','b']));
  assert.equal(await page.locator('[name=Classroom]').inputValue(),JSON.stringify(['g10','a']));
  assert.equal(await page.locator('[data-work]').inputValue(),'Unsaved lesson work');
  await page.locator('[data-legacy] summary').click();
  await page.locator('[data-load-legacy]').click();
  await page.locator('[data-legacy-records]').getByText('Historical work',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-work]').inputValue(),'Unsaved lesson work');
  const popupPromise=page.waitForEvent('popup');
  await page.locator('[data-print=legacy]').click();
  const popup=await popupPromise;
  await popup.getByText('Historical work',{exact:true}).waitFor();
  assert.match(await popup.locator('body').innerText(),/Grade 10/);
  assert.doesNotMatch(await popup.locator('body').innerText(),/Grade 10 \/ Brilliance/);
  await popup.close();
  await page.locator('[data-action=saveAcademicDiaryEntry]').click();
  await page.getByRole('status').filter({hasText:'Diary record saved.'}).waitFor();
  await page.locator('[name=Classroom]').selectOption(JSON.stringify(['g10','b']));
  await page.waitForFunction(()=>document.querySelector('[name=SubjectId]')?.options.length===2);
  assert.equal(await page.locator('[name=SubjectId]').inputValue(),'');
  await page.locator('[data-body] h3').filter({hasText:'Grade 10 / Excellence'}).waitFor();
  assert.equal(await page.locator('[data-action=submitAcademicDiary]').count(),0);
  await page.locator('[name=SubjectId]').selectOption('math');
  await page.locator('[data-work]').waitFor();
  assert.equal(await page.locator('[data-work]').inputValue(),'');
  await page.locator('[data-work]').fill('Excellence lesson');
  await page.locator('[data-action=saveAcademicDiaryEntry]').click();
  await page.getByRole('status').filter({hasText:'Diary record saved.'}).waitFor();
  await page.locator('[name=Classroom]').selectOption(JSON.stringify(['g10','a']));
  await page.waitForFunction(()=>document.querySelector('[name=SubjectId]')?.options.length===3);
  await page.locator('[name=SubjectId]').selectOption('math');
  await page.locator('[data-work]').waitFor();
  assert.equal(await page.locator('[data-work]').inputValue(),'Unsaved lesson work');
  await page.locator('[data-work]').fill('Edits to discard');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[name=Classroom]').selectOption(JSON.stringify(['g9','a']));
  await page.waitForFunction(()=>document.querySelector('[name=SubjectId]')?.options[1]?.value==='english');
  assert.equal(await page.locator('[name=SubjectId]').inputValue(),'');
  assert.equal(await page.locator('[name=SubjectId] option').count(),2);
  await page.locator('[name=SubjectId]').selectOption('english');
  await page.locator('[data-work]').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.ok(await page.evaluate(()=>window.calls.filter(row=>row.input.ClassId).every(row=>!!row.input.ArmId)));
  assert.deepEqual(await page.evaluate(()=>window.calls.filter(row=>row.action==='saveAcademicDiaryEntry').map(row=>row.input.ArmId)),['a','b']);
  await page.screenshot({path:'tmp/diary-classroom-'+viewport.width+'.png',fullPage:true});
  await page.locator('[data-close]').click();
  assert.equal(await page.locator('dialog').count(),0);
  assert.deepEqual(errors,[]); await context.close();
 }
 console.log('PASS: class/arm choices, subject refresh, separate saved work, compiler controls, unsaved edits, read-only class-wide preview and Close; desktop/mobile.');
}finally{await browser.close();}
