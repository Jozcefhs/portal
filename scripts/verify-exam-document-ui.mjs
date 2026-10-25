import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { browserFixture } from '../tests/helpers/portal-cbt-browser-fixture.mjs';
import { secureExamAdminPage } from '../functions/lib/exam-admin-page.js';

const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..'), fixture = browserFixture(), output = resolve(root, 'tmp/exam-document-ui');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/staff-session') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, authenticated: true, user: { username: 'reviewer' }, session: { id: 'fixture', lastActivityAt: Date.now(), expiresAt: Date.now() + 7200000, serverNow: Date.now() } })); return;
    }
    if (req.method === 'POST' && ['/api/portal-cbt', '/api/portal-cbt-manage'].includes(path)) {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw), cookie = /fixture=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
      let data;
      if (path.endsWith('-manage')) data = await fixture.staff[input.action](input);
      else if (input.action === 'login') { data = await fixture.candidate.login(input, cookie); res.setHeader('Set-Cookie', `fixture=${data.session}; HttpOnly; SameSite=Strict; Path=/`); delete data.session; }
      else data = input.action === 'paperPage' ? await fixture.candidate.paperPage(input, cookie) : await fixture.candidate.candidateAction(input, cookie);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return;
    }
    if (!/^\/(exam\.html|exams-admin\.html|js\/[\w-]+\.js|css\/[\w-]+\.css|vendor\/exam-documents\/[\w.-]+)$/.test(path)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(path) ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    const content = await readFile(resolve(root, '.' + path));
    if (path === '/exams-admin.html') {
      const page = await secureExamAdminPage(new Response(content, { headers: { 'Content-Type': 'text/html' } }));
      res.setHeader('Content-Security-Policy', page.headers.get('Content-Security-Policy')); res.end(await page.text());
    } else {
      if (path === '/exam.html') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      res.end(content);
    }
  } catch (error) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, message: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const admin = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  admin.on('pageerror', error => errors.push(error.message));
  await admin.goto(base + '/exams-admin.html'); await admin.locator('#managerStatus').filter({ hasText: 'Examinations loaded.' }).waitFor();
  await admin.locator('#newTest').click(); await admin.locator('#testEditor').waitFor({ state: 'visible' });
  await admin.locator('#admissionSession').fill('2026/2027'); await admin.locator('#applyingClass').fill('Grade 7');
  const wat = value => new Date(value + 3600000).toISOString().slice(0, 16);
  await admin.locator('#startsAt').fill(wat(Date.now() - 60000)); await admin.locator('#endsAt').fill(wat(Date.now() + 3600000));
  await admin.locator('#contentMode').selectOption('document');
  for (const extension of ['pdf', 'docx']) {
    await admin.locator('#paperFile').setInputFiles(resolve(root, `tests/fixtures/entrance-paper.${extension}`));
    await admin.locator('#paperStatus').filter({ hasText: 'pages ready' }).waitFor({ timeout: 60000 });
    assert.equal(await admin.locator('#paperPreview img').count(), 2, `${extension}: both pages rendered`);
    assert.ok(await admin.locator('#paperPreview img').first().evaluate(img => img.complete && img.naturalWidth > 600));
    await admin.locator('#paperPreview').screenshot({ path: resolve(output, `${extension}-preview.png`) });
  }
  await admin.locator('#paperConfirmed').check(); await admin.locator('#documentCount').fill('2'); await admin.locator('#documentKeys').fill('B, D');
  await admin.locator('#testEditor button[type=submit]').click(); await admin.locator('[data-candidate-check]').first().waitFor();
  await admin.locator('[data-candidate-check]').first().check(); await admin.locator('[data-delivery]').selectOption('online'); await admin.locator('[data-enroll]').click();
  await admin.locator('#managerStatus').filter({ hasText: 'Selected candidates registered' }).waitFor();
  await admin.locator('[data-schedule]').click(); await admin.locator('[data-schedule]').waitFor({ state: 'detached' });
  const test = (await fixture.staff.state({ Audience: 'applicant', BranchId: 'main', SchoolSection: 'secondary' })).tests[0];
  const card = (await fixture.staff.cards({ TestId: test.TestId })).cards[0];
  const candidate = await browser.newPage({ viewport: { width: 390, height: 844 } }); candidate.on('pageerror', error => errors.push(error.message));
  await candidate.goto(`${base}/exam.html?test=${test.TestId}`); await candidate.locator('#examReference').fill(card.Reference); await candidate.locator('#examPassword').fill(card.Password);
  await candidate.locator('#examLogin button[type=submit]').click(); await candidate.locator('#startExam').waitFor({ state: 'visible' });
  assert.equal(await candidate.locator('#candidatePaper img').count(), 0);
  await candidate.locator('#startExam').click(); await candidate.locator('#dialogConfirm').click();
  await candidate.waitForFunction(() => document.querySelectorAll('#candidatePaper img').length === 2);
  assert.equal(await candidate.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await candidate.getByRole('button', { name: 'Zoom in', exact: true }).click();
  assert.equal(await candidate.locator('.exam-paper-pages').evaluate(el => el.style.width), '150%');
  assert.ok(await candidate.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await candidate.getByRole('button', { name: 'Fit width', exact: true }).click();
  await candidate.screenshot({ path: resolve(output, 'remote-paper-mobile.png'), fullPage: true });
  await candidate.locator('[name=Q1][value=B]').check(); await candidate.locator('[name=Q2][value=D]').check();
  await candidate.waitForFunction(() => document.querySelector('#saveState').textContent === 'All answers saved online');
  await candidate.locator('#submitExam').click(); await candidate.locator('#dialogConfirm').click(); await candidate.locator('#examDone').waitFor({ state: 'visible' });
  const review = await fixture.staff.review({ TestId: test.TestId, CandidateId: card.CandidateId }); assert.equal(review.candidate.RawScore, 100);
  assert.deepEqual(errors, []);
  console.log('PASS: Word and PDF two-page conversion, paper preview, bulk answer key, saved paper, private remote access, phone layout and automatic marking.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
