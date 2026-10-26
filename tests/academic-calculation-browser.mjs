import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const admin=await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
const functions=['academicManagementRequest','mergeAcademicScorebookSnapshot','mergeAcademicResultCalculation']
  .map(name=>admin.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`))[0]).join('\n');
const start=admin.indexOf("  resultCalculator?.addEventListener('submit', async (event) => {");
const end=admin.indexOf("  panelEl.querySelectorAll('[data-academic-result-status]')",start);
assert.ok(start>0&&end>start);
const handler=admin.slice(start,end);
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.fulfill({status:404,body:''}));
  await page.setContent(`<main><p id="academicManagementStatus"></p><form data-academic-result-calculator>
    <input name="ArmId" value="a1"><input name="AttendanceMode" value="Daily">
    <input type="checkbox" name="AllowPartialResults" checked>
    <input type="checkbox" name="NotTaughtSubjectIds" value="trade" checked><input name="NotTaughtReason" value="Lessons have not started">
    <button type="submit">Calculate end-of-term results</button>
    <button type="submit" data-result-calculation="mid-term">Recalculate mid-term Drafts</button>
  </form></main>`);
  await page.evaluate(({functions,handler})=>{
    window.clean=value=>String(value??'').trim();window.selectedBranchId='main';window.currentUser={username:'reviewer'};
    window.academicManagementView='results';window.activeSection='academics';
    window.academicManagementFilters={section:'secondary',sessionId:'s1',termId:'t1'};window.academicResultDraft={armId:'a1'};
    window.academicManagementData={arms:[{ArmId:'a1',ClassId:'c1'}],students:[{StudentRef:'keep'}],
      workspaceRecordSelection:{ClassId:'c1'},termResults:[{ResultId:'preserved',Status:'Published'}],resultEvents:[]};
    window.requests=[];window.renders=[];window.failures=[];window.nextResponse=null;window.deferResponse=false;
    window.academicFind=(rows,id)=>rows.find(row=>row.ArmId===id);
    window.DynamaxDialogs={confirm:async()=>true};
    window.runButtonAction=async(button,label,action)=>{
      if(button.disabled)return;const old=button.textContent;button.disabled=true;button.textContent=label;
      try{await action();}finally{button.disabled=false;button.textContent=old;}
    };
    window.showAcademicCalculationFailure=async(_status,error)=>failures.push(error.message);
    window.renderAcademicManagement=(data,message)=>{academicManagementData=data;renders.push(data);document.querySelector('#academicManagementStatus').textContent=message;};
    window.staffFetch=async(_url,options)=>{
      requests.push(JSON.parse(options.body));
      if(deferResponse)await new Promise(resolve=>window.releaseResponse=resolve);
      const index=requests.length;
      return {status:200,json:async()=>nextResponse||({ok:true,partialAcademicManagement:true,message:'1 result calculated; 1 student pending.',
        resultCalculationPending:[{StudentRef:'pending'}],resultCalculationPreserved:1,
        resultCalculationUpdate:{results:[{ResultId:'calculated',RevisionToken:`commit-${index}`,Status:'Calculated Draft'}],
          events:[{ResultEventId:`event-${index}`}]}})};
    };
    (0,eval)(functions);
    (0,eval)(`{const resultCalculator=document.querySelector('[data-academic-result-calculator]');${handler}}`);
  },{functions,handler});
  await page.getByRole('button',{name:'Recalculate mid-term Drafts'}).click();
  await page.waitForFunction(()=>renders.length===1);
  const first=await page.evaluate(()=>({request:requests[0],data:academicManagementData}));
  assert.equal(first.request.ResultResponseMode,'delta');assert.equal(first.request.AllowPartialResults,true);
  assert.equal(first.request.action,'calculateAcademicMidTermResults');assert.deepEqual(first.request.NotTaughtSubjectIds,['trade']);
  assert.equal(first.data.termResults.find(row=>row.ResultId==='preserved').Status,'Published');
  assert.equal(first.data.termResults.find(row=>row.ResultId==='calculated').RevisionToken,'commit-1');
  assert.equal(first.data.students[0].StudentRef,'keep');assert.equal(first.data.resultCalculationPending.length,1);
  assert.equal(await page.evaluate(()=>requests.length),1,'No workspace reload after calculation');
  await page.getByRole('button',{name:'Calculate end-of-term results'}).click();
  await page.waitForFunction(()=>renders.length===2);
  assert.equal(await page.evaluate(()=>requests[1].action),'calculateAcademicTermResults');
  assert.equal(await page.evaluate(()=>requests[1].NotTaughtSubjectIds),undefined);
  // Changing branch or classroom during the request must not replace the new screen.
  await page.evaluate(()=>deferResponse=true);
  await page.getByRole('button',{name:'Recalculate mid-term Drafts'}).click();
  await page.waitForFunction(()=>typeof releaseResponse==='function');
  await page.evaluate(()=>{selectedBranchId='another-branch';academicResultDraft.armId='a2';releaseResponse();});
  await page.waitForFunction(()=>!document.querySelector('[data-result-calculation]').disabled);
  assert.equal(await page.evaluate(()=>renders.length),2);
  assert.equal(await page.evaluate(()=>requests.length),3);
  assert.deepEqual(await page.evaluate(()=>failures),[]);assert.deepEqual(errors,[]);
  console.log('PASS: mid-term and end-of-term Calculate actions use one request, preserve loaded records, show pending students, and ignore stale responses after navigation.');
} finally {await browser.close();}
