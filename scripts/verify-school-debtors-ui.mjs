import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { schoolDebtorsReport } from '../functions/lib/school-debtors-report.js';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const renderer = admin.slice(admin.indexOf('function renderSchoolInsights()'), admin.indexOf('async function requestHotelServices('));
const rows = Array.from({ length: 215 }, (_, i) => ({ AccountRef: `SAMPLE/${i + 1}`, DisplayName: i === 214 ? '<script>throw Error("unsafe")</script>' : `Sample Learner ${String(i + 1).padStart(3, '0')}`,
  ClassName: i < 110 ? 'Grade 7' : 'Grade 8', StudentType: i < 50 ? 'Boarding Student' : 'Day Student', TotalDebit: 1000, TotalCredit: 100, OutstandingBalance: 900 }));
const report = schoolDebtorsReport(rows, { available: true, schoolName: 'Sample Academy', readTime: '2026-11-15T10:00:00Z', academicSession: '2026/2027' });
const harness = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/css/school-debtors.css"></head><body><main id="panel" style="padding:15px"></main><script src="/js/school-debtors.js"></script><script>
const clean=v=>String(v??'').trim(),escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const panelEl=document.getElementById('panel'),currentUser={schoolSectionAccess:'All'},selectedBranchId='main',availableBranches=[{id:'main',name:'Sample Main Branch'}];
const dashboardData={departments:{schoolInsights:{defaulters:[],debtorsReport:${JSON.stringify(report).replaceAll('<', '\\u003c')}}}};
const schoolInsightChartCards=()=>'',table=()=>'',loadDashboard=()=>{throw Error('Unexpected reload')};
${renderer}
renderSchoolInsights();</script></body></html>`;
const unexpected = [], errors = [], requests = [];
const assets = new Set(['/js/school-debtors.js', '/css/style.css', '/css/app-dialogs.css', '/css/school-debtors.css']);
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end(harness); return; }
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!assets.has(path)) { unexpected.push(path); res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css');
  res.end(await readFile(new URL('..' + path, import.meta.url)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await mkdir('tmp/school-debtors-ui', { recursive: true });
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const countBefore = requests.length;
    await page.getByRole('button', { name: 'View all debtors (215)', exact: true }).click();
    await page.locator('dialog[open]').waitFor();
    assert.equal(await page.locator('[data-table] tbody tr').count(), 100);
    assert.match(await page.locator('[data-summary]').textContent(), /215 of 215/);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await page.locator('[data-table] tbody tr').count(), 15);
    await page.locator('[data-filter="className"]').selectOption('grade7');
    await page.locator('[data-filter="studentType"]').selectOption('boarding student');
    assert.match(await page.locator('[data-summary]').textContent(), /50 of 215/);
    await page.locator('[data-filter="search"]').fill('SAMPLE/2');
    assert.match(await page.locator('[data-summary]').textContent(), /11 of 215/);
    await page.locator('[data-reset]').click();
    await page.locator('dialog').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `tmp/school-debtors-ui/list-${width}.png`, fullPage: true });
    const bounds = await page.locator('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'dialog fits viewport');
    await page.locator('[data-preview]').click();
    await page.waitForFunction(() => !document.querySelector('[data-print]').disabled);
    const frame = page.frames().find(candidate => candidate.parentFrame());
    assert.equal(await frame.locator('tbody tr').count(), 215, 'print includes ALL filtered rows, not just the screen page');
    assert.equal(await frame.locator('script').count(), 0, 'names cannot insert scripts');
    assert.match(await frame.locator('body').textContent(), /193,500.00/);
    await frame.evaluate(() => { window.print = () => { window.printCalled = true; }; });
    await page.locator('[data-print]').click();
    assert.equal(await frame.evaluate(() => window.printCalled), true);
    await page.locator('[data-back]').click();
    assert.equal(await page.locator('iframe').count(), 0);
    await page.locator('[data-filter="className"]').selectOption('grade8');
    await page.locator('[data-preview]').click();
    await page.waitForFunction(() => !document.querySelector('[data-print]').disabled);
    assert.equal(await page.frames().find(candidate => candidate.parentFrame()).locator('tbody tr').count(), 105);
    await page.screenshot({ path: `tmp/school-debtors-ui/preview-${width}.png` });
    await page.locator('[data-dismiss]').click();
    assert.equal(await page.locator('dialog').count(), 0);
    await page.getByRole('button', { name: 'View all debtors (215)', exact: true }).click();
    assert.match(await page.locator('[data-summary]').textContent(), /215 of 215/);
    await page.evaluate(() => { document.getElementById('panel').replaceChildren(); });
    assert.equal(await page.locator('dialog,iframe').count(), 0, 'branch/workspace replacement removes sensitive preview');
    assert.equal(requests.length, countBefore, 'filtering, paging and printing make no network requests');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await page.evaluate(() => DynamaxSchoolDebtors.open(document.getElementById('panel'), { available: false }));
    assert.equal(await page.locator('[data-preview],[data-print]').count(), 0);
    await page.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  await writeFile('tmp/school-debtors-ui/verification.json', JSON.stringify({ passed: true, widths: [1366,390], fixtureRows: 215, fullPrint: true, scopedPrint: true, extraRequests: 0, browserStorageWrites: 0, errors }, null, 2));
  console.log('PASS: real School Insights entry, complete/filtered printing, paging, mobile fit, escaping, scope cleanup, no extra reads/writes or browser storage (synthetic data).');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
