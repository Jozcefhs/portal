import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=new URL('../',import.meta.url);
const server=createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(!/^\/(css\/[^/]+\.css|js\/[^/]+\.js|tests\/fixtures\/vendor-store-sales\.html)$/.test(path)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');
    res.end(await readFile(new URL(path.slice(1),root)));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
try {
  for(const edition of ['faith','organization','school'])for(const width of [390,1280]){
    const page=await browser.newPage({viewport:{width,height:850}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/vendor-store-sales.html?edition=${edition}`);
    const toggle=page.locator('[data-organisation-sales]');
    await toggle.waitFor();assert.match(await toggle.innerText(),/Disable/);
    await toggle.click();await page.waitForFunction(()=>document.querySelector('[data-organisation-sales]')?.textContent.startsWith('Enable'));
    assert.equal(await toggle.getAttribute('aria-pressed'),'false');
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-organisation-sales]')?.textContent.startsWith('Enable'));
    await toggle.click();await page.waitForFunction(()=>document.querySelector('[data-organisation-sales]')?.textContent.startsWith('Disable'));
    await page.evaluate(()=>{failNext=true;});await toggle.click();
    await page.getByText('Test save failed. Setting unchanged.',{exact:true}).waitFor();
    assert.match(await toggle.innerText(),/Disable/);assert.equal(await toggle.isEnabled(),true);
    await page.locator('[data-edit-vendor]').click();
    const checkbox=page.locator('input[name="OrganisationSalesEnabled"]');await checkbox.waitFor();assert.equal(await checkbox.isChecked(),true);
    await checkbox.uncheck();await page.locator('dialog button[type="submit"]').click();
    await page.waitForFunction(()=>!document.querySelector('dialog[open]')&&document.querySelector('[data-organisation-sales]')?.textContent.startsWith('Enable'));
    const calls=await page.evaluate(()=>testCalls);assert.equal(calls.at(-1).OrganisationSalesEnabled,false);assert.equal(calls.at(-1).PosEnabled,true);
    const bounds=await toggle.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width,`Toggle fits ${width}px`);
    assert.deepEqual(errors,[]);
    if(width===390)await page.screenshot({path:fileURLToPath(new URL(`../tmp/vendor-store-${edition}-390.png`,import.meta.url)),fullPage:true});
    await page.close();console.log(`${edition} ${width}px: toggle, persistence, error recovery and edit form passed`);
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
