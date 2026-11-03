import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve(import.meta.dirname, '..'), output = resolve(root, 'tmp/local-answer-ui');
await mkdir(output, { recursive: true });
let lists = 0, reviews = 0, empty = false;
const copyId = 'a'.repeat(64), candidate = { AttemptId: 'one', Reference: 'DCA/001', DisplayName: 'Example Learner', Status: 'Submitted' };
const files = new Set(['/cbt-answers.html', '/js/local-cbt-answers.js', '/js/cbt-answer-comparison.js', '/css/portal-cbt.css', '/css/cbt-answer-comparison.css', '/js/staff-idle-session.js']);
for (const path of ['/exams-admin.html', '/js/portal-cbt-manager.js', '/js/app-dialogs.js', '/css/app-dialogs.css', '/js/exam-document-upload.js', '/js/exam-paper-viewer.js']) files.add(path);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/api/local-cbt-answers') {
      let raw = ''; for await (const part of request) raw += part;
      const input = JSON.parse(raw);
      assert.equal(input.BranchId, 'main'); assert.equal(input.SchoolSection, 'secondary'); assert.equal(input.CbtTestId, 'geography');
      let body;
      if (input.action === 'list') {
        lists++; body = { ok: true, title: 'CA1 Geography Grade 12', nextAfter: '', copies: empty ? [] : [{ CopyId: copyId, UploadedAt: '2026-11-03T10:00:00Z', Candidates: [candidate] }] };
      } else {
        assert.equal(input.action, 'review'); assert.equal(input.CopyId, copyId); assert.equal(input.AttemptId, 'one'); reviews++;
        body = { ok: true, test: { Title: 'CA1 Geography Grade 12' }, candidate, Questions: [{ QuestionId: 'q1', Ordinal: 1, QuestionType: 'single', Prompt: { Text: 'Choose a river.' }, Options: [{ Id: 'A', Text: 'Niger' }, { Id: 'B', Text: 'Everest' }], AnswerKey: 'A', MaximumScore: 1 }], Answers: { q1: 'B' }, QuestionMarks: { q1: 0 } };
      }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(body)); return;
    }
    if (path === '/api/staff-session') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, authenticated: true, user: { username: 'reviewer' }, session: { id: 'test', lastActivityAt: Date.now(), expiresAt: Date.now() + 7200000, serverNow: Date.now() } })); return;
    }
    if (!files.has(path)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'");
    response.end(await readFile(resolve(root, '.' + path)));
  } catch (error) { response.writeHead(500); response.end(JSON.stringify({ ok: false, message: error.message })); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/exams-admin.html?audience=student&branch=main&section=secondary&source=geography`);
  await page.getByRole('button', { name: 'Load answers', exact: true }).waitFor();
  assert.ok(page.url().includes('/cbt-answers.html?'), 'legacy Answers / print links redirect to the new page');
  assert.equal(lists, 1); assert.equal(reviews, 0);
  await page.getByRole('button', { name: 'Load answers', exact: true }).click();
  await page.getByRole('button', { name: 'Preview / print answers', exact: true }).waitFor();
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Preview / print answers', exact: true }).click();
  const popup = await opened;
  await popup.getByText('B — Everest', { exact: true }).waitFor();
  assert.equal(await popup.getByText('A — Niger', { exact: true }).count(), 1);
  assert.equal(await popup.getByText('Incorrect', { exact: true }).count(), 1);
  await popup.emulateMedia({ media: 'print' });
  await popup.screenshot({ path: resolve(output, 'print.png'), fullPage: true });
  await popup.close();
  await page.getByRole('button', { name: 'Load answers', exact: true }).click();
  assert.equal(reviews, 1, 'reopening an immutable copy reuses loaded answers');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  empty = true;
  await page.getByRole('button', { name: 'Refresh answer list' }).click();
  await page.getByText(/No local answer copies have been uploaded/).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, lists, reviews, printedSavedOptions: true, mobileFits: true }));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
