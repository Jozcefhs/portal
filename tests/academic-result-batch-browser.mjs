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
  let dialog=page.getByRole('dialog',{name:'Batch review, approve and publish results'});
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
  assert.deepEqual(errors,[]);
  console.log('PASS: batch results dialog preserves pending students, scopes report types, sends bounded explicit batches, prevents double submission, keeps failed selections, checks permissions and fits desktop/mobile screens.');
}finally{await browser.close();}
