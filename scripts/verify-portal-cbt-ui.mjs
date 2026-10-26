import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { browserFixture } from '../tests/helpers/portal-cbt-browser-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fixture = browserFixture(), root = resolve(import.meta.dirname, '..'), output = resolve(root, 'tmp/portal-cbt-ui');
await mkdir(output, { recursive: true });
const files = new Set(['/exam.html', '/exams-admin.html', '/js/portal-cbt-candidate.js', '/js/portal-cbt-manager.js', '/js/exam-document-upload.js', '/css/portal-cbt.css', '/js/app-dialogs.js', '/css/app-dialogs.css', '/js/staff-idle-session.js']);
files.add('/js/exam-paper-viewer.js'); files.add('/vendor/exam-documents/pdf.min.mjs'); files.add('/vendor/exam-documents/pdf.worker.min.mjs');
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/staff-session') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, authenticated: true, user: { username: 'reviewer' },
        session: { id: 'fixture-session', lastActivityAt: Date.now(), expiresAt: Date.now() + 7200000, serverNow: Date.now() } })); return;
    }
    if (req.method === 'POST' && ['/api/portal-cbt', '/api/portal-cbt-manage'].includes(path)) {
      let raw = ''; for await (const part of req) raw += part;
      const input = JSON.parse(raw), cookie = /fixture=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
      let data;
      if (path.endsWith('-manage')) data = await fixture.staff[input.action](input);
      else if (input.action === 'login') {
        data = await fixture.candidate.login(input, cookie); res.setHeader('Set-Cookie', `fixture=${data.session}; HttpOnly; SameSite=Strict; Path=/`); delete data.session;
      } else data = input.action === 'paperPage' ? await fixture.candidate.paperPage(input, cookie) : await fixture.candidate.candidateAction(input, cookie);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); return;
    }
    if (!files.has(path)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', /\.m?js$/.test(path) ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(resolve(root, '.' + path)));
  } catch (error) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, message: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const admin = await browser.newPage({ viewport: { width: 1366, height: 900 } }), errors = [];
  admin.on('pageerror', error => errors.push(error.message));
  await admin.goto(`${base}/exams-admin.html`); await admin.locator('#managerStatus').filter({ hasText: 'Examinations loaded.' }).waitFor();
  await admin.locator('#newTest').click(); await admin.locator('#testEditor').waitFor({ state: 'visible' });
  await admin.locator('#admissionSession').fill('2026/2027'); await admin.locator('#applyingClass').fill('Grade 7');
  const wat = value => new Date(value + 3600000).toISOString().slice(0, 16);
  await admin.locator('#startsAt').fill(wat(Date.now() - 60000)); await admin.locator('#endsAt').fill(wat(Date.now() + 3600000));
  const q1 = admin.locator('.question-editor').first();
  await q1.locator('[data-marks]').fill('60'); await q1.locator('[data-prompt]').fill('2 + 2?'); await q1.locator('[data-options]').fill('3\n4'); await q1.locator('[data-key]').selectOption('B');
  await admin.locator('#addQuestion').click(); const q2 = admin.locator('.question-editor').nth(1);
  await q2.locator('[data-type]').selectOption('extended'); await q2.locator('[data-marks]').fill('40'); await q2.locator('[data-prompt]').fill('Explain your answer.');
  await admin.screenshot({ path: resolve(output, 'staff-authoring.png'), fullPage: true });
  await admin.locator('#testEditor button[type=submit]').click(); await admin.locator('[data-candidate-check]').first().waitFor();
  await admin.locator('[data-select-all]').click(); await admin.locator('[data-delivery]').selectOption('online'); await admin.locator('[data-enroll]').click();
  await admin.locator('#testDetails tbody').filter({ hasText: 'APP/002' }).waitFor();
  await admin.locator('[data-schedule]').click(); await admin.locator('[data-schedule]').waitFor({ state: 'detached' });
  const state = await fixture.staff.state({ Audience: 'applicant', BranchId: 'main', SchoolSection: 'secondary' }), test = state.tests[0];
  const cards = (await fixture.staff.cards({ TestId: test.TestId })).cards;
  await admin.locator('[data-cards]').click(); await admin.locator('#accessCards').waitFor({ state: 'visible' });
  assert.equal(await admin.locator('.access-card').count(), 2);
  await admin.emulateMedia({ media: 'print' }); await admin.pdf({ path: resolve(output, 'access-cards.pdf'), format: 'A4' }); await admin.emulateMedia({ media: 'screen' });
  await admin.locator('[data-close]').click();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/exam.html?test=${test.TestId}`); await page.locator('#examReference').fill(cards[0].Reference); await page.locator('#examPassword').fill(cards[0].Password);
  await page.locator('#showPassword').click(); assert.equal(await page.locator('#examPassword').getAttribute('type'), 'text'); await page.locator('#showPassword').click();
  await page.screenshot({ path: resolve(output, 'candidate-login-mobile.png'), fullPage: true });
  await page.locator('#examLogin button[type=submit]').click(); await page.locator('#startExam').waitFor({ state: 'visible' });
  await page.locator('#startExam').click(); await page.locator('#dialogClose').click(); assert.equal(await page.locator('#examDialog').isVisible(), false);
  await page.locator('#startExam').click(); await page.keyboard.press('Escape'); assert.equal(await page.locator('#examDialog').isVisible(), false);
  await page.locator('#startExam').click(); await page.locator('#dialogConfirm').click(); await page.locator('[name=Q1][value=B]').check();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'All answers saved online');
  let disconnect = true, blockedAction = 'save';
  await page.route('**/api/portal-cbt', route => disconnect && route.request().postDataJSON().action === blockedAction ? route.abort() : route.continue());
  await page.locator('#questions textarea').fill(' 0012\nFour.'); await page.waitForFunction(() => document.querySelector('#saveState').textContent.includes('Not yet saved'));
  assert.match(await page.locator('#examStatus').innerText(), /Keep this page open/);
  disconnect = false;
  page.on('dialog', dialog => dialog.accept()); await page.reload(); await page.locator('#examWork').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'All answers saved online');
  assert.equal(await page.locator('#questions textarea').inputValue(), ' 0012\nFour.');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(output, 'candidate-exam-mobile.png'), fullPage: true });
  disconnect = true;
  await page.locator('#questions textarea').fill('My unconfirmed answer');
  await page.waitForFunction(() => document.querySelector('#saveState').textContent.includes('Not yet saved'));
  const cookies = await page.context().cookies(), session = cookies.find(row => row.name === 'fixture').value;
  const ClientId = await page.evaluate(() => sessionStorage.getItem('exam-client'));
  const identity = { CandidateId: cards[0].CandidateId, ClientId };
  const current = (await fixture.candidate.candidateAction({ ...identity, action: 'session' }, session)).attempt;
  await fixture.candidate.candidateAction({ ...identity, action: 'save', BaseVersion: current.SaveVersion, SaveVersion: current.SaveVersion + 1,
    Answers: { ...current.Answers, Q2: 'Saved in the second tab' } }, session);
  disconnect = false; await page.reload(); await page.locator('#examRecovery').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#questions textarea').inputValue(), 'Saved in the second tab');
  assert.match(await page.locator('#recoveryAnswers').inputValue(), /My unconfirmed answer/);
  await page.locator('#dialogClose').click(); await page.locator('#closeRecovery').click();
  await page.locator('#questions textarea').fill(' 0012\nFour.');
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'All answers saved online');
  await page.locator('#submitExam').click(); await page.locator('#dialogClose').click(); assert.equal(await page.locator('#examDone').isVisible(), false);
  disconnect = true; blockedAction = 'submit';
  await page.locator('#submitExam').click(); await page.locator('#dialogConfirm').click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent.includes('Not yet saved'));
  disconnect = false; await page.reload(); await page.locator('#examDone').waitFor({ state: 'visible' });
  await admin.locator('[data-refresh]').click(); await admin.locator('[data-review]').first().click(); await admin.locator('[data-mark=Q2]').fill('35');
  await admin.locator('[data-approve]').click(); await admin.locator('[data-post]').first().click();
  await admin.locator('#managerStatus').filter({ hasText: 'Entrance score saved' }).waitFor();
  await admin.screenshot({ path: resolve(output, 'staff-results.png'), fullPage: true });
  assert.equal(fixture.db.get(`${fixture.source}/app-1`).EntranceSubjectScores[0].score, 95);
  await admin.locator('#audience').selectOption('student'); await admin.locator('#newTest').click();
  await admin.waitForFunction(() => document.querySelectorAll('#academicComponent option').length === 2);
  await admin.locator('#academicComponent').selectOption('ca1:theory'); assert.match(await admin.locator('#questionTotal').innerText(), /60 marks/);
  const paper = await browser.newPage(); await paper.setContent('<h1>Logic test</h1><p>1. Choose B.</p><p>2. Choose D.</p>');
  await fixture.seedUploadedStudentExam(await paper.pdf({ format: 'A4' })); await paper.close();
  let uploadedReads = 0;
  admin.on('request', request => { if (request.url().endsWith('/api/portal-cbt-manage') && request.postDataJSON()?.action === 'uploadedTests') uploadedReads++; });
  await admin.locator('#useUploaded').click(); await admin.locator('#uploadedClass').selectOption('grade7');
  assert.equal(uploadedReads, 0, 'No uploaded tests read before a class is selected and loaded');
  await admin.locator('#loadUploaded').click(); await admin.locator('[data-use-upload]').waitFor();
  await admin.locator('#uploadedClass').selectOption('grade8'); await admin.locator('#loadUploaded').click();
  await admin.locator('#uploadedList').filter({ hasText: 'No uploaded papers' }).waitFor();
  await admin.locator('#uploadedClass').selectOption('grade7'); await admin.locator('#loadUploaded').click(); await admin.locator('[data-use-upload]').waitFor();
  assert.equal(uploadedReads, 2, 'Returning to a loaded class reuses the cached list');
  await admin.locator('[data-use-upload]').click(); await admin.locator('#remotePart').selectOption('objective');
  await admin.locator('#remoteStart').fill(wat(Date.now() - 60000)); await admin.locator('#remoteEnd').fill(wat(Date.now() + 3600000));
  await admin.locator('#remoteSchedule button[type=submit]').click(); await admin.locator('#testDetails').filter({ hasText: 'All eligible active students' }).waitFor();
  assert.equal(await admin.locator('[data-enroll]').count(), 0);
  await admin.locator('[data-schedule]').click(); await admin.locator('[data-schedule]').waitFor({ state: 'detached' });
  const studentTest = (await fixture.staff.state({ Audience: 'student', BranchId: 'main', SchoolSection: 'secondary' })).tests[0];
  const student = await browser.newPage({ viewport: { width: 390, height: 844 } }); student.on('pageerror', error => errors.push(error.message));
  await student.goto(`${base}/exam.html?test=${studentTest.TestId}`); await student.locator('#examReference').fill('ST/001'); await student.locator('#examPassword').fill('StudentPass1!');
  await student.locator('#examLogin button[type=submit]').click(); await student.locator('#startExam').click(); await student.locator('#dialogConfirm').click();
  await student.locator('#candidatePaper img').waitFor();
  await student.waitForFunction(() => [...document.querySelectorAll('#candidatePaper img')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await student.screenshot({ path: resolve(output, 'uploaded-paper-student-mobile.png'), fullPage: true });
  await student.locator('[name=Q1][value=B]').check(); await student.locator('[name=Q2][value=D]').check();
  await student.locator('#submitExam').click(); await student.locator('#dialogConfirm').click(); await student.locator('#examDone').waitFor({ state: 'visible' });
  await admin.locator('[data-refresh]').click(); await admin.locator('[data-review]').click();
  assert.match(await admin.locator('#resultReview').innerText(), /20 \/ 20/);
  await admin.setViewportSize({ width: 390, height: 844 });
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await admin.screenshot({ path: resolve(output, 'automatic-student-access-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: authoring, access cards/print, candidate login, modal close/Escape, save, disconnect/reload recovery, submit, written marking, application posting and Objective/Theory selectors.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
