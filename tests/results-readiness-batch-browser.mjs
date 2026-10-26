import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.fulfill({status:404,body:''}));
  const css=(await Promise.all(['css/style.css','css/module-audit.css','css/academic-result-preview.css','css/academic-test-review.css'].map(read))).join('\n').replace(/@import[^;]+;/g,'');
  await page.setContent(`<style>${css}</style><body class="staff-page"><main id="workspace"></main></body>`);
  const admin=await read('js/admin.js');
  const functions=['academicResultsReadinessWorkspace','academicRecordLoadForm'].map(name=>admin.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n}`))[0]).join('\n');
  await page.evaluate(source=>{
    window.escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.academicManagementView='readiness';(0,eval)(source);
    const data={classes:[{ClassId:'class_internal',Name:'Grade 10'}],workspaceRecordSelection:{ClassId:'class_internal',ResultType:'Mid-Term'},
      resultsReadiness:{Status:'Some students need attention',Scope:{ClassName:'Grade 10',Term:'First Term',AcademicSession:'2026/2027',ResultType:'Mid-Term'},
        Counts:{Students:25,Blockers:1,Warnings:1,NextSteps:24,ReadyToPublish:0,Published:0,UntaughtSubjects:1},
        Blockers:[{Code:'CALCULATION_BLOCKED',RecordLabel:'Student pending · Grade 10 / Brilliance',Message:'Missing Mathematics CA1. Other complete students may proceed.'}],
        Warnings:[{Code:'HISTORICAL_MEMBERSHIP',RecordLabel:'Former placement',Message:'Archived membership retained for history.'}],
        NextSteps:[{Code:'CALCULATE',RecordLabel:'Complete student',Message:'Calculate this student’s results.'}],
        UntaughtSubjects:[{SubjectName:'Computer Hardware and GSM Repairs',RecordLabel:'Complete student',Message:'Not taught this mid-term; excluded from average.'}]}};
    document.querySelector('#workspace').innerHTML=academicRecordLoadForm(data,'Results readiness')+academicResultsReadinessWorkspace(data);
  },functions);
  assert.equal(await page.locator('option[value="*"]').count(),0);
  assert.equal(await page.getByRole('button',{name:'Check results readiness'}).count(),1);
  assert.equal(await page.locator('select[name="ReadinessResultType"]').inputValue(),'Mid-Term');
  assert.equal(await page.locator('.academic-readiness-warnings').getAttribute('open'),null);
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Report must fit viewport');
    await page.screenshot({path:`tmp/results-readiness-${width}.png`});
  }
  await page.getByText('Historical and advisory warnings (1)').click();
  assert.equal(await page.getByText('Archived membership retained for history.').isVisible(),true);
  await page.evaluate(async source=>{
    const module=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
    window.requests=[];window.scopeCurrent=true;
    const sheets=Array.from({length:27},(_,i)=>({SheetId:`sheet-${i}`,ClassId:'c1',ArmId:'a1',SubjectId:`subject-${i}`,RevisionToken:'v1',Status:'Draft',
      AssessmentComponents:[{Id:'ca1',Name:'CA1'}],ComponentReviews:{ca1:{Status:'Submitted'}}}));
    module.openAcademicBatchReview({sheets,scope:{SchoolSection:'secondary',SessionId:'s1',TermId:'t1'},label:sheet=>`Grade 10 / Brilliance · Subject ${sheet.SubjectId}`,
      isCurrent:()=>window.scopeCurrent,
      request:async(action,payload)=>{
        window.requests.push({action,payload});await new Promise(resolve=>setTimeout(resolve,50));
        return {batchReview:payload.Items.map(item=>({SheetId:item.SheetId,ok:item.SheetId!=='sheet-26',
          message:item.SheetId==='sheet-26'?'Submit current saved marks first.':'Approved; one student pending.',
          ...(item.SheetId==='sheet-26'?{}:{sheet:{...sheets.find(sheet=>sheet.SheetId===item.SheetId),RevisionToken:'v2',ComponentReviews:{ca1:{Status:'Approved',PendingStudentRefs:['TEST/1']}}}})}))};
      }});
  },await read('js/academic-batch-review.js'));
  const dialog=page.getByRole('dialog',{name:'Batch approve scores'});
  assert.equal(await page.evaluate(()=>window.requests.length),0);
  await dialog.getByLabel('Find classroom or subject').fill('subject-1');
  assert.equal(await page.evaluate(()=>window.requests.length),0);
  await dialog.getByLabel('Find classroom or subject').fill('');
  await dialog.getByRole('button',{name:'Select visible subjects'}).click();
  await page.evaluate(()=>{const button=document.querySelector('[data-apply]');button.click();button.click();});
  await dialog.locator('[data-status]').filter({hasText:'26 processed; 1 need attention'}).waitFor();
  const requests=await page.evaluate(()=>window.requests);
  assert.equal(requests.length,2,'bounded batches, no double-click replay');
  assert.deepEqual(requests.map(row=>row.payload.Items.length),[25,2]);
  assert.ok(requests.every(row=>row.payload.Status==='Approved'&&row.payload.AllowPendingStudents===true));
  assert.equal(await dialog.locator('input[data-sheet]:checked').count(),1);
  await page.setViewportSize({width:390,height:844});
  const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391);
  await page.screenshot({path:'tmp/batch-review-mobile.png'});
  await page.evaluate(()=>window.scopeCurrent=false);
  await dialog.getByRole('button',{name:'Approve selected (1)'}).click();
  assert.match(await dialog.locator('[data-status]').textContent(),/branch, user or academic period changed/);
  assert.equal(await page.evaluate(()=>window.requests.length),2);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log('PASS: scoped readiness controls, separate warnings, responsive report, explicit bounded batch approval, pending students and scope guards.');
} finally {await browser.close();}
