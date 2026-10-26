import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
try{
  const css=(await Promise.all(['css/style.css','css/module-audit.css','css/academic-result-preview.css'].map(read))).join('\n').replace(/@import[^;]+;/g,'');
  const admin=await read('js/admin.js');
  const weighted=await read('js/academic-result-template.js');
  const sample=admin.slice(admin.indexOf('function printAcademicResultSample('),admin.indexOf('function academicAnalysisSelectOptions('));
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.fulfill({status:404,body:''}));
  await page.setContent(`<style>${css}</style><body class="staff-page"><main id="audit"></main></body>`);
  await page.evaluate(code=>{
    window.escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.academicManagementData={reportProfile:{SchoolName:'Test School'}};
    (0,eval)(code);
  },weighted+sample);
  for(const stage of ['nursery','primary','secondary','secondary']){
    await page.evaluate(s=>printAcademicResultSample(s),stage);
    const preview=page.locator('#academicResultSampleDialog[open]');await preview.waitFor();
    const frame=page.frameLocator('#academicResultSampleDialog[open] iframe');
    await frame.locator('.subject-table tbody tr').first().waitFor();
    assert.equal(await frame.locator('.subject-table tbody tr').count(),4);
    assert.equal(await frame.getByText(/NOT AN OFFICIAL RESULT/).count(),1);
    assert.equal(page.context().pages().length,1,'Preview must not create a transient popup');
    await frame.locator('body').evaluate(body=>{window.print=()=>{body.dataset.printed='yes';};});
    await frame.getByRole('button',{name:'Print preview'}).click();
    assert.equal(await frame.locator('body').getAttribute('data-printed'),'yes');
  }
  await page.screenshot({path:'tmp/result-sample-preview.png'});
  await page.setViewportSize({width:390,height:844});
  const bounds=await page.locator('#academicResultSampleDialog[open]').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=391);
  await page.getByRole('button',{name:'Close preview'}).click();
  await page.locator('#academicResultSampleDialog').waitFor({state:'detached'});
  const audit=await read('js/academic-audit-log.js');
  await page.evaluate(async source=>{
    const module=await import(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
    window.reads=0;module.mountAcademicAuditLog(document.querySelector('#audit'),{scopeKey:'style-test',request:async()=>{window.reads++;return {academicAudit:{rows:Array.from({length:12},(_,i)=>({Timestamp:'2026-10-26T13:00:00Z',Action:i?'SAVE DRAFT':'CLASSROOM TRANSFER REQUESTED',SubjectDisplay:'Test student',StudentRef:'DCA/26/001',Actor:'Test officer',SummaryDisplay:'Scores and records preserved.',DetailsDisplay:'A long detailed explanation '.repeat(18)})),nextCursor:null}};}});
  },audit);
  assert.equal(await page.evaluate(()=>window.reads),0);
  await page.getByLabel('From',{exact:true}).fill('2026-10-26');await page.getByLabel('To',{exact:true}).fill('2026-10-26');
  await page.getByRole('button',{name:'Load academic history'}).click();await page.locator('[data-audit-row]').first().waitFor();
  for(const width of [390,1280]){
    await page.setViewportSize({width,height:900});
    const result=await page.evaluate(()=>{
      const table=document.querySelector('.module-audit-table'),wrap=table.parentElement,td=table.querySelector('td');
      return {pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,wrap:wrap.getBoundingClientRect().width,scroll:wrap.scrollWidth,header:getComputedStyle(table.querySelector('th')).position,padding:getComputedStyle(td).paddingTop};
    });
    assert.ok(result.pageWidth<=width+2,JSON.stringify(result));assert.equal(result.header,'sticky');assert.ok(parseFloat(result.padding)>=10);
    await page.screenshot({path:`tmp/shared-audit-${width}.png`});
  }
  await page.getByRole('searchbox').fill('no matching student');
  assert.equal(await page.locator('[data-audit-row]:visible').count(),0);assert.equal(await page.evaluate(()=>window.reads),1);
  assert.deepEqual(errors,[]);
  console.log('PASS: all sample stages persist, repeat clicks and printing; responsive shared audit styling and local search without extra reads.');
}finally{await browser.close();}
