import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(`<style>${(await read('css/style.css')).replace(/@import[^;]+;/g,'')}\n${await read('css/academic-test-review.css')}</style><body><table class="admin-table"><thead><tr><th>Subject</th><th>Test reviews</th><th>Full-term status</th></tr></thead><tbody><tr><td>Financial Accounting</td><td data-academic-test-review-status="sheet"></td><td>Draft</td></tr><tr><td>Civic Education</td><td data-academic-test-review-status="other">Unchanged</td><td>Draft</td></tr></tbody></table><input id="unsaved" value="Unsaved work"><button data-academic-id="sheet" data-academic-revision="old">Full term</button></body>`);
  const admin=await read('js/admin.js');
  await page.evaluate(source=>{
    window.escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    (0,eval)(source);
  },admin.match(/function academicTestReviewStatusMarkup\([\s\S]*?\n}/)[0]+admin.match(/function refreshAcademicTestReviewRow\([\s\S]*?\n}/)[0]);
  await page.evaluate(async source=>{
    const {openAcademicTestReviews}=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
    window.calls=[];window.current=true;window.testStatus='Draft';window.version=1;
    window.show=()=>openAcademicTestReviews({sheet:{SheetId:'sheet',Status:'Draft'},title:'Grade 10 · Brilliance · Financial Accounting',
      permissions:{canEnterScores:true,canReviewScores:true,canApproveScores:true},isCurrent:()=>window.current,
      onLoaded:result=>refreshAcademicTestReviewRow(document,result.scorebookSnapshot.sheet),
      payload:(sheet,extra={})=>({SheetId:sheet.SheetId,RevisionToken:sheet.RevisionToken,...extra}),
      request:async(action,payload)=>{
        calls.push({action,payload});
        if(action==='getAcademicScorebookContext')return {scorebookSnapshot:{sheet:{SheetId:'sheet',Status:'Draft',RevisionToken:`v${version}`,TestReviewStatus:[{ComponentId:'ca1',Name:'CA1',Status:testStatus}]}},
          componentReviews:[{ComponentId:'ca1',Name:'CA1',Status:testStatus,Complete:false,CompleteCount:24,RosterCount:25,MissingCount:1},
            {ComponentId:'exam',Name:'Exam',Status:'Draft',Complete:false,CompleteCount:0,RosterCount:25,MissingCount:25}]};
        await new Promise(resolve=>setTimeout(resolve,40));
        if(payload.RevisionToken!==`v${version}`)throw Error('stale revision');
        window.testStatus=payload.Status;window.version++;return {message:`CA1 moved to ${testStatus}.`};
      }});
    await show();
  },await read('js/academic-component-review.js'));
  assert.equal(await page.getByRole('button',{name:'Submit CA1',exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Submit Exam',exact:true}).isEnabled(),false);
  await page.getByRole('button',{name:'Submit CA1',exact:true}).evaluate(button=>{button.click();button.click();});
  await page.getByRole('button',{name:'Approve CA1',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='changeAcademicScoreSheetStatus').length),1);
  await page.getByRole('button',{name:'Approve CA1',exact:true}).click();
  await page.getByRole('button',{name:'Lock CA1',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>calls.map(c=>c.action)),['getAcademicScorebookContext','changeAcademicScoreSheetStatus','getAcademicScorebookContext','changeAcademicScoreSheetStatus','getAcademicScorebookContext']);
  assert.equal(await page.evaluate(()=>calls[3].payload.RevisionToken),'v2');
  assert.equal(await page.evaluate(()=>calls[3].payload.AllowPendingStudents),true);
  assert.match(await page.locator('[data-academic-test-review-status="sheet"]').textContent(),/CA1 · Approved/);
  assert.equal(await page.locator('[data-academic-id="sheet"]').getAttribute('data-academic-revision'),'v3');
  assert.equal(await page.locator('[data-academic-test-review-status="other"]').textContent(),'Unchanged');
  assert.equal(await page.locator('#unsaved').inputValue(),'Unsaved work');
  await page.setViewportSize({width:390,height:844});
  const box=await page.locator('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);
  await page.screenshot({path:'tmp/individual-test-review.png'});
  await page.evaluate(()=>window.current=false);
  await page.getByRole('button',{name:'Lock CA1',exact:true}).click();
  assert.equal(await page.evaluate(()=>calls.length),5,'workspace change must not submit a review');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('dialog').count(),0);assert.deepEqual(errors,[]);
  await page.setViewportSize({width:1200,height:800});
  await page.screenshot({path:'tmp/approval-status-table.png'});
  console.log('PASS: completed-test submission and approval, fresh revisions, missing-test block, duplicate-click guard, narrow reads, branch guard and mobile dialog.');
}finally{await browser.close();}
