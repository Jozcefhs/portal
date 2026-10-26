import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.setContent('<main id="audit"></main>');
  const source=await readFile(new URL('../js/academic-audit-log.js',import.meta.url),'utf8');
  await page.evaluate(async text=>{
    const module=await import(URL.createObjectURL(new Blob([text],{type:'text/javascript'})));
    window.calls=[]; window.mount=key=>module.mountAcademicAuditLog(document.querySelector('#audit'),{scopeKey:key,
      request:async input=>{window.calls.push(input);return {academicAudit:{rows:[{Timestamp:'2026-10-26T13:00:00Z',Action:'RESTORE SUBJECTS',SubjectDisplay:'Test student',Actor:'Officer',SummaryDisplay:input.Cursor?'Second page':'Original scores preserved'}],nextCursor:input.Cursor?null:{context:'test',name:'next'}}};}});
    window.mount('main|secondary');
  },source);
  assert.equal(await page.evaluate(()=>window.calls.length),0);
  await page.getByLabel('From',{exact:true}).fill('2026-10-26');
  await page.getByLabel('To',{exact:true}).fill('2026-10-26');
  await page.getByRole('button',{name:'Load academic history'}).click();
  await page.getByText('Original scores preserved',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.length),1);
  await page.getByRole('button',{name:'Next page'}).click();
  await page.getByText('Second page',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.length),2);
  await page.getByRole('button',{name:'Previous page'}).click();
  await page.getByRole('button',{name:'Next page'}).click();
  assert.equal(await page.evaluate(()=>window.calls.length),2);
  await page.evaluate(()=>window.mount('main|secondary'));
  await page.getByText('Second page',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.length),2);
  await page.evaluate(()=>window.mount('other|primary'));
  assert.equal(await page.getByText('Test student',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.calls.length),2);
  console.log('PASS: no automatic reads, explicit dates, bounded next page, cached back/forward/reopen, branch isolation.');
} finally {await browser.close();}
