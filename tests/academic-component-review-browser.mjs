import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.setContent(`<style>${(await read('css/style.css')).replace(/@import[^;]+;/g,'')}\n${await read('css/academic-test-review.css')}</style><body></body>`);
  await page.evaluate(async source=>{
    const {openAcademicTestReviews}=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
    window.calls=[];window.current=true;window.testStatus='Draft';window.version=1;
    window.show=()=>openAcademicTestReviews({sheet:{SheetId:'sheet',Status:'Draft'},title:'Grade 10 · Brilliance · Financial Accounting',
      permissions:{canEnterScores:true,canReviewScores:true,canApproveScores:true},isCurrent:()=>window.current,
      payload:(sheet,extra={})=>({SheetId:sheet.SheetId,RevisionToken:sheet.RevisionToken,...extra}),
      request:async(action,payload)=>{
        calls.push({action,payload});
        if(action==='getAcademicScorebookContext')return {scorebookSnapshot:{sheet:{SheetId:'sheet',Status:'Draft',RevisionToken:`v${version}`}},
          componentReviews:[{ComponentId:'ca1',Name:'CA1',Status:testStatus,Complete:true,CompleteCount:25,RosterCount:25,MissingCount:0},
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
  await page.setViewportSize({width:390,height:844});
  const box=await page.locator('dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391);
  await page.screenshot({path:'tmp/individual-test-review.png'});
  await page.evaluate(()=>window.current=false);
  await page.getByRole('button',{name:'Lock CA1',exact:true}).click();
  assert.equal(await page.evaluate(()=>calls.length),5,'workspace change must not submit a review');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('dialog').count(),0);assert.deepEqual(errors,[]);
  console.log('PASS: completed-test submission and approval, fresh revisions, missing-test block, duplicate-click guard, narrow reads, branch guard and mobile dialog.');
}finally{await browser.close();}
