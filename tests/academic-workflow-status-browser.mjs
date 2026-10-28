import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.fulfill({status:404,body:''}));
  const css=(await Promise.all(['css/style.css','css/academic-test-review.css'].map(read))).join('\n').replace(/@import[^;]+;/g,'');
  await page.setContent(`<style>${css}main{padding:20px}.academic-batch-controls{display:flex;flex-wrap:wrap;gap:12px}table{width:100%}</style><body class="staff-page"><main id="workspace"></main></body>`);
  await page.addScriptTag({content:await read('js/academic-workflow-status.js')});
  const admin=await read('js/admin.js');
  await page.addScriptTag({content:`
    window.panelEl=document.getElementById('workspace');
    window.academicScorebookDraft={};window.academicResultDraft={armId:'a1'};
    window.academicCurrentRows=data=>data;
    window.escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    window.academicLabel=(rows,id)=>rows.find(row=>[row.ClassId,row.ArmId].includes(id))?.Name||id;
    window.academicManagementData={classes:[{ClassId:'c1',Name:'Grade 10'}],arms:[{ArmId:'a1',Name:'Genius'},{ArmId:'a2',Name:'Brilliance'}],scoreSheets:[
      {SheetId:'s1',ClassId:'c1',ArmId:'a1',Status:'Draft',AssessmentComponents:[{Id:'ca1',Name:'CA1'},{Id:'exam',Name:'Exam'}],ComponentReviews:{ca1:{Status:'Submitted'},exam:{Status:'Draft'}}},
      {SheetId:'s2',ClassId:'c1',ArmId:'a1',Status:'Draft',AssessmentComponents:[{Id:'ca1',Name:'CA1'}],ComponentReviews:{ca1:{Status:'Approved',PendingStudentRefs:['student-2']}}},
      {SheetId:'s3',ClassId:'c1',ArmId:'a2',Status:'Locked',AssessmentComponents:[{Id:'ca1',Name:'CA1'}]}
    ],termResults:[
      {ResultId:'r1',ArmId:'a1',Status:'Reviewed',ResultType:'Mid-Term'},
      {ResultId:'r2',ArmId:'a1',Status:'Approved',ResultType:'Mid-Term'},
      {ResultId:'r3',ArmId:'a1',Status:'Published',ResultType:'Mid-Term'},
      {ResultId:'r4',ArmId:'a1',Status:'Locked',ResultType:'End of Term'},
      {ResultId:'r5',ArmId:'a1',Status:'Calculated Draft',CalculationPending:true,ResultType:'Mid-Term'},
      {ResultId:'r6',ArmId:'a2',Status:'Approved',ResultType:'Mid-Term'}]};
    window.requestCount=0;window.fetch=()=>{requestCount++;throw Error('Filtering must not read records');};
    ${admin.match(/function bindAcademicWorkflowFilters\([\s\S]*?\n}/)[0]}
    window.draw=()=>{
      panelEl.innerHTML='<h2>Subject review</h2><div class="academic-batch-controls"><label>Review scope<select data-academic-review-scope></select></label><label>Classroom<select data-academic-review-room></select></label></div><div data-academic-score-workflow-filter></div><div class="academic-score-workflow-table"><table><thead><tr><th>Subject sheet</th></tr></thead><tbody>'+academicManagementData.scoreSheets.map(row=>'<tr><td data-workflow-id="'+row.SheetId+'">'+row.SheetId+'</td></tr>').join('')+'</tbody></table></div><h2>Result publication</h2><label>Report type<select data-academic-result-workflow-type><option value="">All report types</option><option>Mid-Term</option><option>End of Term</option></select></label><div data-academic-result-workflow-filter></div><div class="academic-result-workflow-table"><table><thead><tr><th>Student result</th></tr></thead><tbody>'+academicManagementData.termResults.filter(row=>row.ArmId===academicResultDraft.armId).map(row=>'<tr><td data-workflow-id="'+row.ResultId+'">'+row.ResultId+'</td></tr>').join('')+'</tbody></table></div>';
      bindAcademicWorkflowFilters();
    };draw();
  `});
  const score=page.locator('[data-academic-score-workflow-filter]');
  const result=page.locator('[data-academic-result-workflow-filter]');
  const visibleIds=selector=>page.locator(`${selector} tr:not([hidden]) [data-workflow-id]`).evaluateAll(nodes=>nodes.map(node=>node.dataset.workflowId));
  assert.match(await score.locator('[data-workflow-stage="Approved"]').textContent(),/Approved 2/);
  assert.equal(await score.locator('[data-workflow-arm-count="All"]').textContent(),'2 arms');
  assert.equal(await score.locator('[data-workflow-arm-count="Approved"]').textContent(),'2 arms');
  assert.equal(await score.locator('[data-workflow-arm-count="Submitted"]').textContent(),'1 arm');
  assert.match(await score.locator('option[value="Approved"]').textContent(),/2 subjects, 2 arms/);
  await page.screenshot({path:'tmp/workflow-arm-counts-1280.png',fullPage:true});
  await score.getByLabel('Workflow status').selectOption('Submitted');
  assert.deepEqual(await visibleIds('.academic-score-workflow-table'),['s1']);
  await page.evaluate(()=>{academicManagementData.scoreSheets[0].ComponentReviews.ca1.Status='Approved';document.querySelector('[data-academic-score-workflow-filter]').refreshWorkflow();});
  assert.deepEqual(await visibleIds('.academic-score-workflow-table'),[]);
  assert.equal(await score.locator('[data-workflow-arm-count="Submitted"]').textContent(),'0 arms');
  assert.match(await score.locator('[data-workflow-summary]').textContent(),/Showing 0 of 3/);
  await score.locator('[data-workflow-stage="Approved"]').click();
  assert.deepEqual(await visibleIds('.academic-score-workflow-table'),['s1','s2','s3']);
  await page.locator('[data-academic-review-room]').selectOption('a1');
  assert.deepEqual(await visibleIds('.academic-score-workflow-table'),['s1','s2']);
  assert.equal(await score.locator('[data-workflow-arm-count="All"]').textContent(),'1 arm');
  assert.equal(await score.locator('[data-workflow-arm-count="Approved"]').textContent(),'1 arm');
  await page.locator('[data-academic-review-scope]').selectOption('');
  assert.deepEqual(await visibleIds('.academic-score-workflow-table'),[],'CA1 approval must not imply whole-term approval');
  assert.equal(await score.locator('[data-workflow-arm-count="Approved"]').textContent(),'0 arms');
  await score.locator('[data-workflow-stage="Draft"]').click();
  assert.deepEqual(await visibleIds('.academic-score-workflow-table'),['s1','s2']);
  await result.getByLabel('Workflow status').selectOption('Approved');
  assert.deepEqual(await visibleIds('.academic-result-workflow-table'),['r2']);
  await page.evaluate(()=>{academicManagementData.termResults[1].Status='Published';draw();});
  assert.deepEqual(await visibleIds('.academic-result-workflow-table'),[],'Published results leave the approved view after redraw');
  assert.equal(await result.getByLabel('Workflow status').inputValue(),'Approved');
  await result.locator('[data-workflow-stage="Published"]').click();
  assert.deepEqual(await visibleIds('.academic-result-workflow-table'),['r2','r3','r4']);
  await page.locator('[data-academic-result-workflow-type]').selectOption('Mid-Term');
  assert.deepEqual(await visibleIds('.academic-result-workflow-table'),['r2','r3']);
  await result.locator('[data-workflow-stage="Pending"]').click();
  assert.deepEqual(await visibleIds('.academic-result-workflow-table'),['r5']);
  assert.equal(await page.evaluate(()=>requestCount),0);
  assert.equal(await page.evaluate(()=>academicManagementData.termResults.length),6);
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
    await page.screenshot({path:`tmp/workflow-status-${width}.png`,fullPage:true});
  }
  // Exercise the actual batch dialog: approving a submitted test removes it
  // from that view, preserves its pending learner, and never resubmits it.
  await page.evaluate(async source=>{
    const module=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
    window.batchCalls=[];
    const sheet={SheetId:'batch',Status:'Draft',ClassId:'c1',ArmId:'a1',SubjectId:'math',RevisionToken:'v1',AssessmentComponents:[{Id:'ca1',Name:'CA1'}],ComponentReviews:{ca1:{Status:'Submitted'}}};
    module.openAcademicBatchReview({sheets:[sheet],scope:{},label:()=> 'Grade 10 / Genius · Mathematics',request:async(action,payload)=>{
      batchCalls.push({action,payload});return {batchReview:[{SheetId:sheet.SheetId,ok:true,message:'Approved; 1 pending',sheet:{...sheet,RevisionToken:'v2',ComponentReviews:{ca1:{Status:'Approved',PendingStudentRefs:['student-2']}}}}]};
    }});
  },await read('js/academic-batch-review.js'));
  let dialog=page.getByRole('dialog');
  assert.equal(await dialog.locator('[data-workflow-arm-count="Submitted"]').textContent(),'1 arm');
  await dialog.locator('[data-search]').fill('No matching classroom');
  assert.equal(await dialog.locator('[data-workflow-arm-count="All"]').textContent(),'0 arms');
  await dialog.locator('[data-search]').fill('');
  await dialog.getByLabel('Workflow status').selectOption('Submitted');
  await dialog.getByRole('button',{name:'Select visible subjects'}).click();
  await dialog.locator('[data-apply]').click();
  await dialog.locator('[data-status]').filter({hasText:'1 processed'}).waitFor();
  assert.equal(await dialog.locator('[data-sheet]').count(),0);
  await dialog.getByLabel('Workflow status').selectOption('Approved');
  assert.match(await dialog.locator('[data-list]').textContent(),/1 pending/);
  assert.equal(await dialog.locator('[data-sheet]').isDisabled(),true);
  await dialog.getByRole('button',{name:'Select visible subjects'}).click();
  assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>batchCalls.length),1);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(async source=>{
    const module=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
    const row={ResultId:'publish',StudentRef:'TEST/1',Status:'Approved',ResultType:'Mid-Term',RevisionToken:'v1'};
    module.openAcademicResultBatch({results:[row],memberships:[{StudentRef:'TEST/1'}],label:()=> 'Sample student',scope:{},title:'Grade 10 / Genius',permissions:{canPublishResults:true},request:async(action,payload)=>{
      batchCalls.push({action,payload});return {batchResults:[{ResultId:row.ResultId,Outcome:'Updated',message:'Published',result:{...row,Status:'Published',RevisionToken:'v2'}}]};
    }});
  },await read('js/academic-result-batch.js'));
  dialog=page.getByRole('dialog');
  await dialog.getByLabel('Workflow status').selectOption('Approved');
  await dialog.getByRole('button',{name:'Select eligible visible students'}).click();
  await dialog.locator('[data-apply]').click();
  await dialog.locator('[data-status]').filter({hasText:'1 advanced'}).waitFor();
  assert.equal(await dialog.locator('[data-result]').count(),0);
  await dialog.getByLabel('Workflow status').selectOption('Published');
  assert.equal(await dialog.locator('[data-result]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>batchCalls.length),2);
  assert.deepEqual(errors,[]);
  console.log('PASS: status counts, immediate approval/publication removal, test vs term, classroom/report scope, pending students, cached redraw, zero filter requests, no duplicate actions and desktop/mobile layouts.');
} finally {await browser.close();}
