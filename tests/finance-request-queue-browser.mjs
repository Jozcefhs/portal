import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8'), admin=await read('js/admin.js');
const {chromium}=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await chromium.launch({channel:'chrome',headless:true});
await mkdir('tmp/finance-request-queue-ui',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1366,height:960}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.fulfill({status:404,body:''}));
 await page.setContent(`<style>${(await read('css/style.css')).replace(/@import[^;]+;/g,'')}main{padding:16px;max-width:1200px;margin:auto}[hidden]{display:none!important}</style><body class="staff-page"><main><div id="panel"></div></main></body>`);
 await page.addScriptTag({content:await read('js/history-date-range.js')});
 const fn=name=>admin.match(new RegExp('function '+name+'\\([^]*?\\n}'))[0];
 await page.addScriptTag({content:`
 window.panelEl=document.getElementById('panel');window.activeSection='financeRequests';window.currentUser={username:'reviewer'};window.selectedBranchId='main';window.financeData=null;window.calls=[];window.rev=0;
 window.clean=v=>String(v??'').trim();window.escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.money=v=>'₦'+Number(v).toFixed(2);window.financeWorkflowStatus=r=>r.Status;
 window.staffWorkspaceReads={version:()=>rev,clear:()=>rev++};window.renderModuleSummary=()=>{};window.mountWorkspaceTabs=()=>{};window.configureRequisitionApprovals=()=>{};window.imprestRetirementEntryRow=()=>'';
 window.runButtonAction=async(b,t,fn)=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}};
 window.bindFinanceWorkflowEvents=()=>{document.getElementById('refreshFinanceWorkflow').onclick=()=>loadFinanceWorkflow({refresh:true});};
 window.financeRecordRow=r=>'<tr><td>'+r.ExpenseNo+'</td><td>Expense</td><td>Fixture request</td><td>10</td><td>Office</td><td>'+r.Date+'</td><td>Supplier</td><td>'+r.Status+'</td><td>Review</td></tr>';window.imprestRecordRow=()=>'';
 window.historyDateWorkspace=DynamaxHistoryDates.createHistoryDateWorkspace({panel:panelEl,scope:()=>JSON.stringify([currentUser.username,selectedBranchId]),title:()=> 'Finance requests',load:()=>draw()});
 window.financeRequest=async(action,payload={})=>{calls.push({action,payload,range:historyDateWorkspace.range('financeRequests')});await new Promise(r=>setTimeout(r,20));const history=historyDateWorkspace.range('financeRequests').view==='completed';const offset=payload.QueueCursor?50:0;return {ok:true,capabilities:{canSubmit:false},department:'Office',queueView:history?'completed':'pending',queuePages:{requisitions:history||offset?'':'page2',bills:'',imprests:''},requisitions:history?[{ExpenseNo:'DONE',Status:'Posted',Date:'2026-10-30',Amount:10}]:Array.from({length:offset?3:50},(_,i)=>({ExpenseNo:'OPEN-'+(i+offset),Status:'Submitted',Date:'2020-01-01',Amount:10})),bills:[],imprests:[],imprestSummary:{}};};
 ${fn('financeRecordsSection')}
 ${fn('imprestRecordsSection')}
 ${fn('renderFinanceWorkflow')}
 ${admin.slice(admin.indexOf('const financeWorkflowSnapshots = new Map();'),admin.indexOf('\nasync function dataBackupRequest('))}
 window.draw=()=>{if(historyDateWorkspace.show('financeRequests'))return loadFinanceWorkflow();};draw();
 `});
 await page.waitForFunction(()=>document.querySelectorAll('[data-finance-more]').length===1);
 assert.equal(await page.locator('[name=fromDate]').isVisible(),false);assert.equal(await page.evaluate(()=>calls.length),1);
 assert.match(await page.locator('#panel').textContent(),/OPEN-0/);assert.doesNotMatch(await page.locator('#panel').textContent(),/DONE/);
 await page.locator('[data-finance-more=requisitions]').click();await page.waitForFunction(()=>document.querySelector('#panel').textContent.includes('OPEN-52'));assert.equal(await page.evaluate(()=>calls.length),2);
 await page.evaluate(()=>draw());assert.equal(await page.evaluate(()=>calls.length),2);assert.match(await page.locator('#panel').textContent(),/OPEN-52/);
 await page.locator('[data-queue-view=completed]').click();assert.equal(await page.evaluate(()=>calls.length),2);assert.match(await page.locator('#panel').textContent(),/Choose dates/);
 await page.locator('[name=fromDate]').fill('2026-10-01');await page.locator('[name=toDate]').fill('2026-10-30');await page.locator('.history-date-range button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#panel').textContent.includes('DONE'));assert.equal(await page.evaluate(()=>calls.length),3);
 assert.doesNotMatch(await page.locator('#panel').textContent(),/OPEN-0/);
 await page.locator('[data-queue-view=pending]').click();await page.waitForFunction(()=>document.querySelector('#panel').textContent.includes('OPEN-52'));assert.equal(await page.evaluate(()=>calls.length),3);
 await page.locator('#refreshFinanceWorkflow').click();await page.waitForFunction(()=>calls.length===4&&document.querySelectorAll('[data-finance-more]').length===1);
 await page.screenshot({path:'tmp/finance-request-queue-ui/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'tmp/finance-request-queue-ui/mobile.png',fullPage:true});
 await page.evaluate(()=>{selectedBranchId='east';draw();});await page.waitForFunction(()=>calls.length===5&&document.querySelectorAll('[data-finance-more]').length===1);
 assert.deepEqual(errors,[]);console.log('PASS: automatic pending queue, dated completion history, retained pages, refresh, branch isolation and mobile layout');
} finally {await browser.close();}
