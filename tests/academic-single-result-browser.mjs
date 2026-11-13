import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const source=await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
const code=['academicTermResultActions','bindAcademicResultRecalculation'].map(name=>
  source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n}`))[0]).join('\n');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.fulfill({status:404,body:''}));
  await page.setContent('<main><p id="academicManagementStatus"></p><section id="results"></section></main>');
  await page.evaluate(code=>{
    window.clean=value=>String(value??'').trim();window.escapeHtml=clean;
    window.selectedBranchId='main';window.currentUser={username:'reviewer'};
    window.activeSection='academics';window.academicManagementView='results';
    window.academicManagementFilters={section:'secondary',sessionId:'session',termId:'term'};
    window.academicResultDraft={armId:'brilliance'};
    window.academicManagementData={students:[],permissions:{canCalculateResults:true,canReviewResults:true},termResults:[{
      ResultId:'selected-result',StudentRef:'DEMO/001',RevisionToken:'v1',SessionId:'session',TermId:'term',ClassId:'grade10',ArmId:'brilliance',
      ResultType:'Mid-Term',Status:'Calculated Draft',SubjectChangeRecalculationRequired:true,
      NotTaughtSubjects:[{SubjectId:'trade',SubjectName:'Trade',Reason:'Lessons not started'}]
    },{ResultId:'preserved-result',StudentRef:'DEMO/002',Status:'Published'}]};
    window.academicFind=(rows,id)=>rows.find(row=>row.ResultId===id);
    window.academicLabel=()=> 'Sample learner';
    window.requests=[];window.renders=[];window.confirmations=[];window.failures=[];window.defer=false;
    window.DynamaxDialogs={confirm:async options=>{confirmations.push(options);return true;}};
    window.runButtonAction=async(button,label,action)=>{
      if(button.disabled)return;button.disabled=true;const previous=button.textContent;button.textContent=label;
      try{await action();}finally{button.disabled=false;button.textContent=previous;}
    };
    window.academicManagementRequest=async(action,input)=>{
      requests.push({action,...input});
      if(defer)await new Promise(resolve=>window.release=resolve);
      return {...academicManagementData,message:'1 result recalculated; other results preserved.'};
    };
    window.renderAcademicManagement=(data,message)=>renders.push({data,message});
    window.showAcademicCalculationFailure=async(_status,error)=>failures.push(error.message);
    (0,eval)(code);
    const panel=document.querySelector('#results');
    panel.innerHTML=academicManagementData.termResults.map(row=>academicTermResultActions(row,academicManagementData.permissions)).join('');
    bindAcademicResultRecalculation(panel);
  },code);
  assert.equal(await page.getByRole('button',{name:'Recalculate result',exact:true}).count(),1);
  assert.equal(await page.locator('[data-academic-result-status="Reviewed"]').count(),0);
  await page.getByRole('button',{name:'Recalculate result',exact:true}).click();
  await page.waitForFunction(()=>renders.length===1);
  const actual=await page.evaluate(()=>({request:requests[0],confirmation:confirmations[0],data:renders[0].data}));
  assert.equal(actual.request.action,'calculateAcademicMidTermResults');
  assert.equal(actual.request.ResultId,'selected-result');assert.equal(actual.request.RevisionToken,'v1');
  assert.equal(actual.request.ArmId,'brilliance');assert.equal(actual.request.ResultResponseMode,'delta');
  assert.deepEqual(actual.request.NotTaughtSubjectIds,['trade']);assert.equal(actual.request.NotTaughtReason,'Lessons not started');
  assert.match(actual.confirmation.message,/Other students’ results stay unchanged/);
  assert.equal(actual.data.termResults[1].Status,'Published');
  // A repeated click while the request is pending cannot submit again.
  await page.evaluate(()=>defer=true);
  await page.getByRole('button',{name:'Recalculate result',exact:true}).click();
  await page.waitForFunction(()=>typeof release==='function');
  await page.locator('[data-academic-result-recalculate]').dispatchEvent('click');
  assert.equal(await page.evaluate(()=>requests.length),2);
  await page.evaluate(()=>{selectedBranchId='another-branch';release();});
  await page.waitForFunction(()=>!document.querySelector('[data-academic-result-recalculate]').disabled);
  assert.equal(await page.evaluate(()=>renders.length),1,'late response cannot overwrite the new branch');
  await page.evaluate(()=>{academicManagementData.permissions.canCalculateResults=false;});
  await page.getByRole('button',{name:'Recalculate result',exact:true}).click();
  assert.equal(await page.evaluate(()=>requests.length),2);
  assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>failures),[]);
  console.log('PASS: stale result row recalculates one draft, preserves exclusions and classmates, prevents repeat requests, and ignores responses after navigation.');
} finally {await browser.close();}
