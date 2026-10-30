// Isolated browser fixture. No live records, storage or credentials are used.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const admin=await read('js/admin.js');
const {chromium}=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir('tmp/finance-attachment-ui',{recursive:true});
const declaration=name=>admin.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0];
try {
 const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><main id="panel"></main>'}));
 await page.goto('http://finance-fixture.test');
 await page.addStyleTag({content:(await read('css/style.css')).replace(/@import[^;]+;/g,'')});
 await page.addScriptTag({content:`
 const clean=v=>String(v??'').trim(), pick=(r,fields)=>fields.map(f=>r[f]).find(Boolean)||'', money=v=>'NGN '+Number(v||0).toFixed(2);
 const escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const protectedFilePreviewObjectUrls=new WeakMap(), panelEl=document.getElementById('panel'), dashboardStatus=document.createElement('p');
 window.calls=[];window.deny=false;window.revoked=[];
 const originalRevoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{revoked.push(url);originalRevoke(url);};
 const setButtonLoading=(b,loading,text)=>{b.disabled=loading;if(loading)b.textContent=text;};
 const setStatus=(el,text)=>{if(el)el.textContent=text;};const showLogin=text=>{throw Error(text);};
 const staffFetch=async url=>{calls.push(url);return deny?new Response(JSON.stringify({message:'Access denied'}),{status:403}):new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY2kAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png','Content-Disposition':'inline; filename="Evidence.png"'}});};
 const materialItemsTable=()=>'', DynamaxTime={formatDateTime:v=>v};
 ${['protectedFileName','clearProtectedFilePreview','ensureProtectedFilePreviewDialog','prepareProtectedFilePreview','showProtectedFilePreview','showProtectedFilePreviewError','openProtectedFile','bindProtectedFileEvents','protectedFinanceDocumentUrl','financeWorkflowStatus','financeRequisitionStageHelp','financeRecordAttachmentActions','financeRecordRow','approvalEndorsementBlock','requisitionEditHistoryBlock','openFinanceRecordPrint'].map(declaration).join('\n')}
 window.record={ExpenseNo:'REQ-1',Status:'Posted',AdminReviewedAt:'2026-10-30',Department:'ICT',AttachmentUrl:'r2://private-secret/key',Description:'Completed requisition',Amount:25};
 window.render=(status='Posted',type='requisition',attachment=true)=>{record.Status=status;record.AttachmentUrl=attachment?'r2://private-secret/key':'';panelEl.innerHTML='<table><tbody>'+financeRecordRow(record,type,{canEditRequisitions:false})+'</tbody></table><button id="preview">View and print</button>';bindProtectedFileEvents(panelEl);document.getElementById('preview').onclick=()=>{const p=window.open('','_blank','width=900,height=720');p.document.write('<p>Loading document...</p>');openFinanceRecordPrint(record,type,{},p);};};render();
 `});
 for(const status of ['Submitted','Accounts Confirmed','Approved','Posted','Paid','Rejected']) {
   await page.evaluate(status=>render(status),status);
   assert.equal(await page.locator('[data-edit-requisition]').count(),0);
   assert.equal(await page.locator('[data-protected-file]').count(),2);
 }
 assert.equal(await page.evaluate(()=>calls.length),0,'Rendering must not fetch files');
 assert.doesNotMatch(await page.locator('#panel').innerHTML(),/r2:\/\//);
 await page.getByRole('button',{name:'View attachment for REQ-1',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-protected-file-preview-frame]')?.src.startsWith('blob:'));
 assert.equal(await page.evaluate(()=>calls.length),1);
 await page.getByRole('button',{name:'Close document preview'}).click();await page.waitForFunction(()=>revoked.length===1);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download attachment for REQ-1',exact:true}).click();
 assert.equal((await download).suggestedFilename(),'Evidence.png');
 assert.equal(await page.evaluate(()=>calls.length),2);
 const opened=page.waitForEvent('popup');await page.locator('#preview').click();const preview=await opened;
 await preview.waitForSelector('.finance-supporting-document');assert.doesNotMatch(await preview.locator('body').innerText(),/Loading document/);assert.equal(await preview.locator('[data-protected-file]').count(),2);
 await preview.getByRole('button',{name:'View attachment for REQ-1',exact:true}).click();
 await preview.waitForFunction(()=>document.querySelector('[data-protected-file-preview-frame]')?.src.startsWith('blob:'));
 assert.equal(await preview.locator('dialog[open]').count(),1);assert.equal(await page.locator('dialog[open]').count(),0,'Preview opens in the document window');
 await preview.getByRole('button',{name:'Close document preview'}).click();
 const previewDownload=preview.waitForEvent('download');await preview.getByRole('button',{name:'Download attachment for REQ-1',exact:true}).click();assert.equal((await previewDownload).suggestedFilename(),'Evidence.png');
 await preview.screenshot({path:'tmp/finance-attachment-ui/preview-desktop.png',fullPage:true});
 await preview.setViewportSize({width:390,height:844});
 await preview.locator('.finance-supporting-document').screenshot({path:'tmp/finance-attachment-ui/preview-mobile.png'});
 assert.ok(await preview.locator('.finance-supporting-document').evaluate(el=>el.scrollWidth<=el.clientWidth));
 await preview.emulateMedia({media:'print'});assert.equal(await preview.locator('.finance-supporting-document').isVisible(),false);
 await page.evaluate(()=>{deny=true;});await page.getByRole('button',{name:'View attachment for REQ-1',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-protected-file-preview-status]').textContent==='Access denied');
 await page.getByRole('button',{name:'Close document preview'}).click();await page.evaluate(()=>render('Posted','requisition',false));
 assert.equal(await page.locator('[data-protected-file]').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: read-only/locked request controls, on-demand preview/download, protected URLs, print-window preview, mobile layout and access errors');
} finally {await browser.close();}
