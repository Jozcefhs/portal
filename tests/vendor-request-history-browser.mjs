// Synthetic scoped records only; all traffic is intercepted and no payment endpoint exists.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
await mkdir('tmp/vendor-request-history-ui',{recursive:true});
try {
  for(const width of [390,1280]) {
    const page=await browser.newPage({viewport:{width,height:850}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.fulfill({status:404,body:''}));
    await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body class="staff-page"><main style="padding:12px;max-width:1120px;margin:auto"><div id="root"></div></main></body>');
    for(const file of ['css/style.css','css/vendor-settlements.css']) await page.addStyleTag({content:(await readFile(file,'utf8')).replace(/@import[^;]+;/g,'')});
    await page.addScriptTag({content:await readFile('js/vendor-settlements.js','utf8')});
    await page.evaluate(()=>{
      window.calls=[];
      const base={VendorId:'sample',VendorName:'Sample vendor',Revision:1,Amount:500,Paid:0,Unpaid:500,From:'2026-10-01',To:'2026-10-31',RequestedAt:'2026-10-12',History:[]};
      DynamaxVendors.mount(document.getElementById('root'),async(action,body)=>{
        calls.push({action,body});
        if(action==='bootstrap')return {vendors:[{VendorId:'sample',Name:'Sample vendor'}],balances:[],products:[],requests:[{...base,SettlementId:'PENDING-ONE',Status:'Submitted',PaymentStatus:'Awaiting approval'}],settings:{Enabled:true,AccountingConfirmed:true},capabilities:{vendor:true,products:true}};
        if(action==='requestHistory')return {ok:true,from:body.From,to:body.To,requests:[{...base,SettlementId:'PAID-ONE',Status:'Approved',PaymentStatus:'Paid',Paid:500,Unpaid:0}]};
        throw new Error('Unexpected fixture action '+action);
      });
    });
    await page.locator('[data-tab="requests"]').click();
    assert.match(await page.locator('[data-panel]').textContent(),/Current requests \(1\)/);
    assert.equal(await page.locator('[data-request-history]').isVisible(),false);
    assert.equal(await page.evaluate(()=>calls.length),1);
    await page.getByText('Completed request history',{exact:true}).click();
    assert.equal(await page.evaluate(()=>calls.length),1);
    await page.locator('[data-request-history] [name="From"]').fill('2026-10-01');
    await page.locator('[data-request-history] [name="To"]').fill('2026-10-31');
    await page.getByRole('button',{name:'Load completed requests',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-panel]').textContent.includes('Loaded request dates:'));
    assert.equal(await page.evaluate(()=>calls.filter(row=>row.action==='requestHistory').length),1);
    await page.locator('[data-tab="products"]').click();await page.locator('[data-tab="requests"]').click();
    await page.getByRole('button',{name:'Load completed requests',exact:true}).click();
    assert.equal(await page.evaluate(()=>calls.filter(row=>row.action==='requestHistory').length),1);
    assert.match(await page.locator('[data-panel]').textContent(),/PENDING-ONE/);
    assert.match(await page.locator('[data-panel]').textContent(),/PAID-ONE/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
    assert.deepEqual(errors,[]);
    await page.screenshot({path:`tmp/vendor-request-history-ui/${width}.png`,fullPage:true});await page.close();
  }
  console.log('PASS: vendor current queue, explicit completed history, retained date snapshot, zero browsing writes and responsive 390/1280px layout');
} finally {await browser.close();}
