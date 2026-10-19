import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.RECOVERY_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless:true, channel:'msedge' });
try {
  const page = await browser.newPage();
  const sent = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://localhost:4198') return route.abort();
    if (url.pathname === '/api/staff-password-recovery') {
      sent.push(route.request().postDataJSON());
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,message:'Test reset complete'})});
    }
    const assets = ['staff-password-recovery.html','css/style.css','css/staff-password-recovery.css','css/app-dialogs.css','js/app-dialogs.js','js/staff-password-recovery.js'];
    const file = url.pathname.slice(1);
    if (!assets.includes(file)) return route.abort();
    return route.fulfill({body:await fs.readFile(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  });
  for (const width of [390,1280]) {
    await page.setViewportSize({width,height:900});
    await page.goto('http://localhost:4198/staff-password-recovery.html');
    assert.equal(await page.getByLabel('New password (6–128 characters)',{exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#recoveryCode').fill('a'.repeat(48));
    await page.locator('#newPassword').fill('abc12');
    await page.locator('#confirmPassword').fill('abc12');
    const before = sent.length;
    await page.getByRole('button',{name:'Reset password',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(sent.length,before);
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('#newPassword').fill('abc123');
    await page.locator('#confirmPassword').fill('abc123');
    await page.getByRole('button',{name:'Reset password',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(sent.length,before+1);
    assert.equal(sent.at(-1).password,'abc123');
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.screenshot({path:`tmp/recovery-six-character-${width}.png`,fullPage:true});
  }
  console.log('Recovery UI passed on mobile and desktop: 5 rejected, 6 submitted, updated label, no overflow. All API calls mocked.');
} finally { await browser.close(); }
