// Synthetic data only. No requests leave this fixture and no financial records are written.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/js/school-fee-payment-plans.js')return route.fulfill({contentType:'text/javascript',body:await readFile('js/school-fee-payment-plans.js','utf8')});
      assert.equal(path,'/');return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body class="staff-page"></body>'});
    });
    await page.goto('https://plan-fixture.test/');await page.addStyleTag({content:(await readFile('css/style.css','utf8')).replace(/@import[^;]+;/g,'')});
    await page.evaluate(async()=>{
      const {openSchoolFeePaymentPlans}=await import('/js/school-fee-payment-plans.js');
      window.calls=[];window.current=true;window.owner={};window.openPlans=readOnly=>openSchoolFeePaymentPlans(async payload=>{
        calls.push(payload);if(payload.action==='list')return {ok:true,branchId:'main',rules:[],categories:['Regular','Church Staff Child'],recordVersion:'v1'};
        await new Promise(resolve=>setTimeout(resolve,70));return {ok:true,rule:payload,recordVersion:'v'+calls.length,message:'Plan saved. Existing charges and payments are unchanged.'};
      },{scopeOwner:owner,branchId:'main',isCurrent:()=>window.current,readOnly});
      await openPlans();
    });
    const mode=page.getByLabel('Plan type',{exact:true}),save=page.getByRole('button',{name:'Save part-payment plan',exact:true});
    await mode.selectOption('Percentage');await page.getByLabel('Minimum value',{exact:true}).fill('25');
    await page.getByLabel('Total school fees after discounts',{exact:true}).fill('1000');await page.getByLabel('Already paid or credited',{exact:true}).fill('600');
    assert.match(await page.locator('[data-example]').innerText(),/250\.00/);
    await page.getByLabel('Percentage basis',{exact:true}).selectOption('Outstanding balance');
    assert.match(await page.locator('[data-example]').innerText(),/100\.00/);
    await save.evaluate(button=>{button.click();button.click();});await page.getByRole('status').filter({hasText:'Plan saved'}).waitFor();
    assert.equal(await page.evaluate(()=>calls.filter(row=>row.action==='save').length),1);
    assert.equal(await page.evaluate(()=>calls[1].recordVersion),'v1');
    await mode.selectOption('Equal installments');await page.getByLabel('Number of installments',{exact:true}).fill('3');await page.getByLabel('Set installment due dates',{exact:true}).check();
    const due=page.locator('[data-dates] input');
    for(let i=0;i<3;i++)await due.nth(i).fill(`2026-12-${String(i+1).padStart(2,'0')}`);
    await save.click();assert.match(await page.getByRole('status').innerText(),/specific session and term/);
    assert.equal(await page.evaluate(()=>calls.length),2);
    await page.getByLabel('Academic session',{exact:true}).fill('2026/2027');await page.getByLabel('Term',{exact:true}).selectOption('First Term');
    await save.click();await page.getByRole('status').filter({hasText:'Plan saved'}).waitFor();
    const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,3);assert.equal(calls[2].recordVersion,'v2');assert.equal(calls[2].DueDates.length,3);
    const bounds=await page.getByRole('dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
    const saveBounds=await save.boundingBox();assert.ok(saveBounds.y>=0&&saveBounds.y+saveBounds.height<=850,'Save footer remains visible');
    assert.equal(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Dialog has no horizontal overflow');
    await page.screenshot({path:`tmp/part-payment-plans-${width}.png`});
    await page.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>openPlans());
    assert.equal(await page.evaluate(()=>calls.length),3,'Same user/branch reopening reuses loaded settings');
    await page.evaluate(()=>window.current=false);await save.click();assert.equal(await page.evaluate(()=>calls.length),3,'No save after scope change');
    await page.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>{window.current=true;return openPlans(true);});assert.equal(await save.isDisabled(),true);
    await page.getByRole('button',{name:'Reload settings',exact:true}).click();await page.getByRole('status').filter({hasText:'Read-only access'}).waitFor();
    assert.equal(await page.evaluate(()=>calls.filter(row=>row.action==='list').length),2,'Reload is explicit');
    assert.deepEqual(errors,[]);await context.close();console.log(`Part-payment plans ${width}px: percentage/fixed controls, dated installments, single save, versions, scope, cache, read-only and footer passed.`);
  }
}finally{await browser.close();}
