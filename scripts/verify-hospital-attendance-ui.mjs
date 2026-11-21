import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {hospitalBrowserAssets} from './helpers/hospital-browser-assets.mjs';
import {fixture,actor,env} from '../tests/helpers/hospital-fixture.mjs';
import {hospitalCollectionPath} from '../functions/lib/hospital-storage.js';

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
try{
  for(const width of [1280,390]){
    const user={...actor,assignedBranchIds:['main','north']},f=fixture(user);
    const path=hospitalCollectionPath(env,'Visits'),assets=hospitalBrowserAssets();
    for(let i=0;i<66;i++){
      const key='visit-'+String(i).padStart(4,'0');
      f.store.set(path+'/'+key,{__id:key,__updateTime:'v1',...(i?{VisitId:key}:{}),BranchId:i===65?'north':'main',
        PatientId:'p-'+(i%8),PatientName:'Synthetic patient '+i,Department:i%2?'Clinic A':'Clinic B',Status:i%10?'Completed':'Cancelled',CreatedAt:'2026-10-26T12:00:00.000Z'});
    }
    const page=await browser.newPage({viewport:{width,height:850}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let failPage=false,requests=0,previousVisit;
    await page.route('https://hospital.test/**',async route=>{
      const url=new URL(route.request().url()).pathname;
      if(url==='/api/staff-session')return route.fulfill({json:{ok:true,authenticated:true,user,session:{id:'test',lastActivityAt:Date.now(),expiresAt:Date.now()+7200000,serverNow:Date.now()}}});
      if(url==='/api/staff-hospital'){
        const body=route.request().postDataJSON();
        if(body.action==='visits'){
          requests++;
          if(failPage && body.Cursor?.id==='visit-0059'){failPage=false;return route.fulfill({status:503,json:{message:'Synthetic temporary failure'}});}
        }
        try{
          const result=await f.service[body.action](body);
          // Replay a row at a page boundary to verify a partial retry cannot inflate attendance.
          if(body.action==='visits'){
            if(body.Cursor && previousVisit)result.visits.unshift(previousVisit);
            previousVisit=result.visits.at(-1);
          }
          return await route.fulfill({json:result});
        }
        catch(e){return route.fulfill({status:e.status||500,json:{message:e.message}});}
      }
      if(!assets.has(url))return route.fulfill({status:404});
      return route.fulfill({body:await readFile(new URL('..'+url,import.meta.url)),contentType:url.endsWith('.js')?'text/javascript':url.endsWith('.css')?'text/css':'text/html'});
    });
    await page.goto('https://hospital.test/hospital.html?task=reception');
    const summary=page.locator('#visitAttendance summary'),body=page.locator('#attendanceBody');
    await summary.click();await body.getByText(/Choose dates/).waitFor();assert.equal(requests,0);
    await page.locator('#visitFrom').fill('2026-10-26');await page.locator('#visitTo').fill('2026-10-26');
    await page.getByRole('button',{name:'Load visits',exact:true}).click();
    await body.getByText('Partial report',{exact:true}).waitFor();assert.match(await body.innerText(),/27 attended visits/);
    await page.evaluate(()=>{window.print=()=>{window.printedAttendance=document.getElementById('cardPrint').innerText||document.getElementById('cardPrint').textContent;};});
    await page.locator('#attendancePrint').click();
    assert.match(await page.evaluate(()=>window.printedAttendance),/Partial report/);
    failPage=true;
    await page.locator('#attendanceRest').click();await page.locator('#status').getByText('Synthetic temporary failure').waitFor();
    assert.match(await body.innerText(),/60 loaded reception visits/);
    await page.locator('#attendanceRest').click();await body.getByText('Full selected period',{exact:true}).waitFor();
    assert.match(await body.innerText(),/58 attended visits.*8 distinct patients.*7 cancelled visits/);
    assert.equal(requests,4);
    await summary.click();await summary.click();await page.locator('#attendancePrint').click();
    const printed=await page.evaluate(()=>window.printedAttendance);assert.match(printed,/Full selected period/);assert.ok(!printed.includes('Synthetic patient'));assert.equal(requests,4);
    await page.locator('#visitFrom').fill('2026-10-25');await body.getByText(/Choose dates/).waitFor();
    assert.equal(await page.locator('#attendancePrint').isVisible(),false);
    await page.locator('#branch').selectOption('north');await page.locator('#status').getByText(/Branch changed/).waitFor();
    await summary.click();await page.locator('#visitFrom').fill('2026-10-26');await page.locator('#visitTo').fill('2026-10-26');
    await page.getByRole('button',{name:'Load visits',exact:true}).click();await body.getByText('Full selected period',{exact:true}).waitFor();
    assert.match(await body.innerText(),/1 attended visit .*1 distinct patient /);
    assert.equal(f.queries.filter(q=>q.path===path).length,4);
    assert.ok(f.commits.flat().every(w=>w.collectionPath===hospitalCollectionPath(env,'Audit')));
    assert.deepEqual(errors,[]);await page.close();console.log('Attendance reports, retry, printing and branch changes passed at '+width+'px.');
  }
}finally{await browser.close();}
