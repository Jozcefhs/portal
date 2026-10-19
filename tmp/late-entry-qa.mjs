import {chromium} from 'file:///C:/Users/DYNAMAX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const source=await readFile('js/admin.js','utf8'), css=await readFile('css/style.css','utf8');
const start=source.indexOf('function openAcademicCbtLateEntryDialog(');
const code=source.slice(start,source.indexOf('function openAcademicCbtRescheduleDialog(',start));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:850});
    await page.setContent(`<style>${css}</style>`);
    await page.evaluate(code=>{
      window.escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
      window.academicCbtLocalParts=value=>({date:value.slice(0,10)});
      window.academicManagementFilters={section:'secondary'};window.academicManagementData={};
      window.calls=[];window.allowConfirm=false;window.merged=null;
      window.academicManagementRequest=async(action,payload)=>{
        calls.push({action,payload});
        if(action==='previewAcademicCbtLateEntry')return {lateEntryReview:{Eligible:['NEW/001','NEW/002'],Excluded:[{StudentRef:'OLD/001'}],
          StudentRefs:payload.StudentRefs??['NEW/001','NEW/002'],StartsAt:payload.StartsAt,PreviewToken:'review-token',RevisionToken:'revision'}};
        return {cbtTest:{CbtTestId:'late'},message:'Scheduled'};
      };
      window.runButtonAction=async(button,text,fn)=>{button.disabled=true;try{return await fn();}finally{button.disabled=false;}};
      window.setStatus=(node,text)=>node.textContent=text;
      window.DynamaxDialogs={confirm:async()=>allowConfirm};window.DynamaxTime={formatDateTime:value=>value};
      window.mergeAcademicCbtTest=result=>{window.merged=result;};window.renderAcademicManagement=()=>{};
      (0,eval)(code);
      openAcademicCbtLateEntryDialog({CbtTestId:'original',Title:'Grade 7 Mathematics — CA1',SessionId:'s',TermId:'t',DurationMinutes:30});
    },code);
    await page.click('[data-late-review]');
    assert.equal(await page.locator('[data-late-student]').count(),2);
    assert.match(await page.locator('[data-late-status]').textContent(),/2 eligible newcomers; 1/);
    await page.uncheck('[data-late-student][value="NEW/002"]');
    await page.click('button[type=submit]');
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.action==='createAcademicCbtLateEntry').length),0);
    assert.ok(await page.evaluate(()=>{const d=document.querySelector('dialog');return d.scrollWidth<=d.clientWidth+1;}));
    await page.screenshot({path:`tmp/late-entry-${width}.png`,fullPage:true});
    await page.evaluate(()=>{allowConfirm=true;});
    await page.click('button[type=submit]');
    await page.waitForFunction(()=>window.merged);
    const posts=await page.evaluate(()=>calls.filter(c=>c.action==='createAcademicCbtLateEntry'));
    assert.equal(posts.length,1);assert.deepEqual(posts[0].payload.StudentRefs,['NEW/001']);
    assert.equal(posts[0].payload.PreviewToken,'review-token');
  }
  assert.deepEqual(errors,[]);console.log('Late-entry browser checks passed at 390px and 1280px; review, deselection, cancellation and confirmed posting verified.');
} finally {await browser.close();}
