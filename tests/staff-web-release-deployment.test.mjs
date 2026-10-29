import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStaffWebRelease } from '../scripts/verify-staff-web-release.mjs';
import { assertWebReleaseMetadata } from '../scripts/check-web-release-metadata.mjs';
import { readFile } from 'node:fs/promises';
const source = path => path === 'admin.html' ? '<meta name="dynamax-web-release" content="dynamax-v523-test">'
  : path === 'sw.js' ? "const CACHE = 'dynamax-v523-test';" : path;
test('release verification accepts line-ending differences and checks deployed staff assets',async()=>{
  const calls=[];
  const result=await verifyStaffWebRelease('https://school.invalid',{read:async path=>`${source(path)}\r\n`,fetcher:async url=>{
    calls.push(url.pathname);return new Response(source(url.pathname.slice(1))+'\n');}});
  assert.equal(result.verified.length,23);assert.ok(calls.includes('/js/admin.js'));assert.ok(calls.includes('/css/teacher-homework.css'));assert.ok(calls.includes('/css/academic-class-score-register.css'));assert.ok(calls.includes('/js/academic-audit-log.js'));assert.ok(calls.includes('/css/module-audit.css'));assert.ok(calls.includes('/css/academic-result-preview.css'));
  assert.ok(calls.includes('/js/academic-workflow-status.js'));assert.ok(calls.includes('/js/academic-batch-review.js'));assert.ok(calls.includes('/js/academic-duplicate-score-review.js'));
  assert.ok(calls.includes('/js/staff-meetings.js'));assert.ok(calls.includes('/css/staff-meetings.css'));assert.ok(calls.includes('/js/academic-result-template.js'));assert.ok(calls.includes('/js/parent-dashboard.js'));
});
test('a successful deployment with stale staff JavaScript fails verification',async()=>{
  await assert.rejects(verifyStaffWebRelease('https://school.invalid',{read:async path=>source(path),
    fetcher:async url=>new Response(url.pathname==='/js/admin.js'?'older interface':source(url.pathname.slice(1)))}),/admin.js.*differs/);
});

test('identical but inconsistent source assets cannot pass release verification or trigger remote reads', async () => {
  let calls = 0;
  await assert.rejects(verifyStaffWebRelease('https://school.invalid', {
    read: async path => source(path).replace(path === 'admin.html' ? 'v523' : 'unchanged', 'v522'),
    fetcher: async () => { calls++; return new Response(''); }
  }), /Web release mismatch/);
  assert.equal(calls, 0);
  for (const html of ['', source('admin.html') + source('admin.html')]) {
    assert.throws(() => assertWebReleaseMetadata(html, source('sw.js')), /Web release mismatch/);
  }
});

test('every Pages deployment gates prepared files before publishing', async () => {
  for (const name of ['deploy-organisation', 'deploy-platform', 'deploy-tenant-pool']) {
    const workflow = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    const gate = workflow.indexOf('node scripts/check-web-release-metadata.mjs --root .pages-deploy');
    assert.ok(gate > workflow.indexOf('cp app-icon.svg manifest.webmanifest sw.js version.json'));
    assert.ok(gate < workflow.indexOf('command: pages deploy'));
  }
});
