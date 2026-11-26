import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.fulfill({status:404,body:''}));
  const css=(await Promise.all(['css/style.css','css/academic-test-review.css'].map(read))).join('\n').replace(/@import[^;]+;/g,'');
  await page.setContent(`<style>${css}</style><body class="staff-page"><main id="workspace"></main></body>`);
  await page.addScriptTag({content:await read('js/academic-workflow-status.js')});
  await page.evaluate(async source=>{
    const module=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
    window.openBatch=module.openAcademicResultBatch;window.requests=[];window.saved=[];window.scopeCurrent=true;
    window.records=Array.from({length:28},(_,i)=>({ResultId:`result-${i}`,StudentRef:`TEST/${i}`,ResultType:'Mid-Term',
      Status:'Calculated Draft',RevisionToken:'v1',...(i===27?{CalculationPending:true}:{})}));
    records.push({ResultId:'end-term',StudentRef:'TEST/0',ResultType:'End of Term',Status:'Reviewed',RevisionToken:'v1'});
    window.settings={results:records,memberships:Array.from({length:29},(_,i)=>({StudentRef:`TEST/${i}`})),
      scope:{SchoolSection:'secondary',SessionId:'s',TermId:'t',ClassId:'c',ArmId:'a'},title:'Grade 7 / Brilliance · First Term',
      label:row=>`Student ${row.StudentRef}`,permissions:{canReviewResults:true,canPublishResults:true},
      isCurrent:()=>scopeCurrent,onSaved:data=>saved.push(data),request:async(action,payload)=>{
        requests.push({action,payload});await new Promise(resolve=>setTimeout(resolve,50));
        return {ok:true,batchResults:payload.Items.map(item=>{
          const pending=item.ResultId==='result-26',row=records.find(row=>row.ResultId===item.ResultId);
          return {ResultId:item.ResultId,Outcome:pending?'Pending':'Updated',message:pending?'Missing Mathematics assessment.':'Published.',
            result:{...row,RevisionToken:'v2',...(pending?{CalculationPending:true}:{Status:'Published',PublicationStatus:'Published'})}};
        })};
      }};
    openBatch(settings);
  },await read('js/academic-result-batch.js'));
  let dialog=page.getByRole('dialog',{name:'Batch result actions'});
  assert.equal(await page.evaluate(()=>requests.length),0);
  assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);
  assert.match(await dialog.locator('[data-pending]').textContent(),/1 results pending.*1 students have no calculated/);
  await dialog.getByLabel('Report type').selectOption('End of Term');
  assert.equal(await dialog.locator('[data-result]').count(),1);
  await dialog.getByLabel('Report type').selectOption('Mid-Term');
  await dialog.getByLabel('Find student').fill('TEST/26');assert.equal(await dialog.locator('[data-result]').count(),1);
  await dialog.getByLabel('Find student').fill('');assert.equal(await page.evaluate(()=>requests.length),0);
  await dialog.getByLabel('Action',{exact:true}).selectOption('ReviewApprovePublish');
  await dialog.getByRole('button',{name:'Select eligible visible students'}).click();
  assert.equal(await dialog.locator('[data-result]:checked').count(),27);
  assert.equal(await dialog.locator('[data-result="result-27"]').isDisabled(),true);
  await page.evaluate(()=>{const button=document.querySelector('[data-apply]');button.click();button.click();});
  await dialog.locator('[data-status]').filter({hasText:'26 advanced; 1 pending'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>requests.map(row=>row.payload.Items.length)),[25,2]);
  assert.ok((await page.evaluate(()=>requests)).every(row=>row.action==='batchChangeAcademicResultStatus'&&row.payload.Status==='ReviewApprovePublish'));
  assert.equal(await page.evaluate(()=>saved.length),2);assert.equal(await dialog.locator('[data-result]:checked').count(),0);
  assert.equal(await dialog.locator('[data-result="result-26"]').isDisabled(),true);
  assert.equal(await dialog.locator('[data-apply]').isDisabled(),true);
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:900});
    const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2),'Only the table should scroll horizontally');
    await page.screenshot({path:`tmp/result-batch-${width}.png`});
  }
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  // A changed workspace must never submit the old classroom's selections.
  await page.evaluate(()=>{scopeCurrent=true;openBatch({...settings,results:[{ResultId:'ready',StudentRef:'TEST/1',ResultType:'Mid-Term',Status:'Calculated Draft',RevisionToken:'v1'}]});});
  dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Select eligible visible students'}).click();
  await page.evaluate(()=>scopeCurrent=false);await dialog.locator('[data-apply]').click();
  assert.match(await dialog.locator('[data-status]').textContent(),/workspace|branch, classroom, user or academic period changed/);
  assert.equal(await page.evaluate(()=>requests.length),2);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  // Review-only officers see no publish action. An incomplete response is not success.
  await page.evaluate(()=>{scopeCurrent=true;openBatch({...settings,permissions:{canReviewResults:true},
    results:[{ResultId:'ready',StudentRef:'TEST/1',ResultType:'Mid-Term',Status:'Calculated Draft',RevisionToken:'v1'}],
    request:async()=>({batchResults:[]})});});
  dialog=page.getByRole('dialog');assert.equal(await dialog.locator('[data-action] option').count(),2);
  await dialog.getByRole('button',{name:'Select eligible visible students'}).click();await dialog.locator('[data-apply]').click();
  assert.match(await dialog.locator('[data-status]').textContent(),/did not confirm every selected student/);
  assert.equal(await dialog.locator('[data-result]:checked').count(),1);assert.equal(await page.evaluate(()=>saved.length),2);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.addScriptTag({content:await read('js/app-dialogs.js')});
  await page.evaluate(()=>{
    requests.length=0;
    openBatch({...settings,results:[
      {ResultId:'one',StudentRef:'P1',Status:'Published',RevisionToken:'v1'},
      {ResultId:'two',StudentRef:'P2',Status:'Locked',RevisionToken:'v2'},
      {ResultId:'three',StudentRef:'P3',Status:'Approved',RevisionToken:'v3'}],
      request:async(action,payload)=>{
        requests.push({action,payload});
        if(action==='previewAcademicTermResultWithdrawal')return {resultWithdrawalPreview:{ResultIds:payload.ResultIds},message:'Parent access will be removed.'};
        return {resultWorkflowOutcomes:payload.ResultIds.map(ResultId=>({ResultId,Outcome:'Updated'}))};
      }});
  });
  dialog=page.getByRole('dialog',{name:'Batch result actions'});
  await dialog.getByLabel('Action',{exact:true}).selectOption('Withdrawn');
  await dialog.getByRole('button',{name:'Select eligible visible students'}).click();
  assert.equal(await dialog.locator('[data-result]:checked').count(),2);
  assert.equal(await dialog.locator('[data-result="three"]').isDisabled(),true);
  await dialog.locator('[data-apply]').click();
  const confirmation=page.getByRole('dialog',{name:'Withdraw 2 published results?'});
  assert.equal(await confirmation.locator('li').count(),2);
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>requests.map(r=>r.action)),['previewAcademicTermResultWithdrawal']);
  await dialog.locator('[data-apply]').click(); await confirmation.getByLabel('Withdrawal reason').fill('Correction approved');
  await confirmation.getByRole('button',{name:'Withdraw selected results'}).click(); await dialog.waitFor({state:'detached'});
  const withdrawal=await page.evaluate(()=>requests.at(-1));
  assert.equal(withdrawal.action,'changeAcademicTermResultStatus');
  assert.deepEqual(withdrawal.payload.ResultIds,['one','two']);
  assert.deepEqual(withdrawal.payload.RevisionTokens,{one:'v1',two:'v2'});
  assert.equal(withdrawal.payload.Reason,'Correction approved');assert.equal(withdrawal.payload.ImpactAcknowledged,true);

  const adminSource=await read('js/admin.js');
  const subjectFunctions=adminSource.slice(adminSource.indexOf('function academicSubjectChangeRequests('),adminSource.indexOf('function academicArmSubjectRegister('))
    +adminSource.slice(adminSource.indexOf('function bindAcademicSubjectBatch('),adminSource.indexOf('function bindAcademicManagement('));
  await page.addScriptTag({content:subjectFunctions});
  await page.evaluate(()=>{
    const filters={section:'secondary',sessionId:'s',termId:'t'};
    Object.assign(window,{currentUser:{username:'admin'},academicManagementFilters:filters,selectedBranchId:'main',activeSection:'academics',
      academicManagementView:'students',academicManagementData:{workspaceRecordSelection:{ClassId:'c'}},clean:v=>String(v??'').trim(),
      academicRecordId:r=>r.MembershipId,escapeHtml:v=>String(v??''),academicLabel:(_rows,id)=>id,
      academicManagementRequest:async(action,payload)=>{
        requests.push({action,payload});return {subjectReviewOutcomes:payload.Items.map(i=>({RequestId:i.RequestId,Outcome:'Approved'}))};
      },loadAcademicManagement:async(options)=>saved.push(options)});
    requests.length=0;
    const data={permissions:{canApproveSubjectChanges:true},studentMemberships:['P1','P2','Own','Transfer'].map(id=>({
      SessionId:'s',TermId:'t',StudentRef:id,MembershipId:id,SchoolSection:'secondary',RevisionToken:'rev-'+id,
      PendingSubjectChange:{RequestId:'req-'+id,RequestedByUsername:id==='Own'?'admin':'teacher',Kind:id==='Transfer'?'Classroom transfer':'Subject change'}
    }))};
    const root=document.getElementById('workspace');root.innerHTML=academicSubjectChangeRequests(data);
    bindAcademicSubjectBatch(root.querySelector('[data-academic-subject-change-requests]'));
  });
  const selectAll=page.getByLabel('Select all eligible subject requests');
  await selectAll.check();
  assert.equal(await page.locator('[data-subject-batch-item]:checked').count(),2);
  const approve=page.getByRole('button',{name:'Approve selected (2)',exact:true});
  await approve.click();
  const subjectPrompt=page.getByRole('dialog',{name:'Approve selected subject requests'});
  await subjectPrompt.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>requests.length),0);
  await approve.click();await subjectPrompt.getByLabel(/Approval reason/).fill('Reviewed both requests');
  await subjectPrompt.getByRole('button',{name:'Approve selected requests'}).click();
  await page.waitForFunction(()=>saved.at(-1)?.message?.includes('2 approved'));
  const subjectRequest=await page.evaluate(()=>requests[0]);
  assert.equal(subjectRequest.action,'batchApproveAcademicSubjectChanges');
  assert.deepEqual(subjectRequest.payload.Items.map(r=>r.RequestId),['req-P1','req-P2']);
  assert.deepEqual(errors,[]);
  console.log('PASS: batch results dialog preserves pending students, scopes report types, sends bounded explicit batches, prevents double submission, keeps failed selections, checks permissions and fits desktop/mobile screens.');
}finally{await browser.close();}
