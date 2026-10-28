import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.fulfill({status:404,body:''}));
  const css=(await Promise.all(['css/style.css','css/academic-test-review.css'].map(read))).join('\n').replace(/@import[^;]+;/g,'');
  await page.setContent(`<style>${css}</style><body class="staff-page"><button id="open">Open review</button></body>`);
  await page.evaluate(async source=>{
    const module=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
    window.requests=[];window.saved=0;window.active=true;window.failSave=false;
    window.review={RevisionToken:'version-1',candidates:[
      {ScoreId:'former',State:'Numeric',RawScore:50,MaximumScore:100,Classroom:'Genius',CreatedAt:'2026-10-22T22:18:00Z',UpdatedAt:'2026-10-22T22:18:00Z',UpdatedBy:'Music teacher',SourceType:'BuiltInCBT',Allowed:true},
      {ScoreId:'current',State:'Numeric',RawScore:80,MaximumScore:100,Classroom:'Perfection',CurrentClassroom:true,CreatedAt:'2026-10-28T14:45:00Z',UpdatedAt:'2026-10-28T18:53:00Z',UpdatedBy:'ICT officer',SourceType:'ManualCorrection',Allowed:true},
      {ScoreId:'incompatible',State:'Numeric',RawScore:20,MaximumScore:40,Classroom:'Earlier classroom',Allowed:false,BlockedReason:'Different assessment scale'}]};
    document.getElementById('open').onclick=()=>module.openAcademicDuplicateScoreReview({
      scope:{SchoolSection:'secondary',SessionId:'s',TermId:'t',ClassId:'g9',ArmId:'p',StudentRef:'DEMO/1',SubjectId:'music',TestId:'ca1'},
      studentName:'Sample Student',subjectName:'Music',testName:'CA1',isCurrent:()=>active,onSaved:()=>{saved++;},
      request:async(action,payload)=>{requests.push({action,payload});if(action.startsWith('get'))return {ok:true,duplicateReview:structuredClone(review)};
        if(failSave)throw Error('These records changed. Reload the competing marks.');
        await new Promise(resolve=>{window.finishSave=resolve;});return {ok:true,message:'Saved'};}
    });
  },await read('js/academic-duplicate-score-review.js'));
  await page.locator('#open').click();
  const dialog=page.getByRole('dialog',{name:'Resolve duplicate score'}),save=dialog.getByRole('button',{name:'Save resolution'});
  await dialog.getByText('No mark is selected automatically.',{exact:false}).waitFor();
  assert.equal(await dialog.locator('input:checked').count(),0);assert.equal(await save.isDisabled(),true);
  assert.equal(await dialog.locator('[value="incompatible"]').isDisabled(),true);
  assert.match(await dialog.textContent(),/Genius.*22 Oct 2026, 23:18 WAT.*Perfection/s);
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'review fits viewport');
    await page.screenshot({path:`tmp/duplicate-score-review-${width}.png`,fullPage:true});
  }
  await dialog.locator('[value="former"]').check();assert.equal(await save.isDisabled(),true);
  await dialog.getByLabel('Reason for this decision').fill('Restore the verified former classroom mark.');
  await save.click();assert.equal(await save.isDisabled(),true);
  await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true,'cannot cancel an in-flight write');
  await page.evaluate(()=>{document.querySelector('dialog form').requestSubmit();});
  assert.equal(await page.evaluate(()=>requests.filter(r=>r.action==='resolveAcademicDuplicateScore').length),1);
  await page.evaluate(()=>finishSave());await dialog.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>saved),1);
  await page.locator('#open').click();await dialog.getByText('No mark is selected automatically.',{exact:false}).waitFor();
  await page.evaluate(()=>{failSave=true;});
  await dialog.locator('[value="current"]').check();await dialog.getByLabel('Reason for this decision').fill('Retain the verified current mark.');
  await save.click();await dialog.getByRole('button',{name:'Reload competing marks'}).waitFor();
  assert.match(await dialog.locator('[data-message]').textContent(),/records changed/);
  await dialog.getByRole('button',{name:'Reload competing marks'}).click();
  await dialog.getByText('No mark is selected automatically.',{exact:false}).waitFor();
  assert.equal(await dialog.locator('input:checked').count(),0);assert.equal(await save.isDisabled(),true);
  await page.evaluate(()=>{active=false;});
  await dialog.locator('[value="current"]').check();await save.click();
  assert.match(await dialog.locator('[data-message]').textContent(),/academic period changed/);
  assert.equal(await page.evaluate(()=>requests.filter(r=>r.action==='resolveAcademicDuplicateScore').length),2);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log('Duplicate review desktop/mobile, deliberate selection, write locking, stale review and scope change checks passed.');
}finally{await browser.close();}
