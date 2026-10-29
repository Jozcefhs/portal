import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStaffWebRelease } from '../scripts/verify-staff-web-release.mjs';
test('release verification accepts line-ending differences and checks deployed staff assets',async()=>{
  const calls=[];
  const result=await verifyStaffWebRelease('https://school.invalid',{read:async path=>`${path}\r\n`,fetcher:async url=>{
    calls.push(url.pathname);return new Response(url.pathname.slice(1)+'\n');}});
  assert.equal(result.verified.length,23);assert.ok(calls.includes('/js/admin.js'));assert.ok(calls.includes('/css/teacher-homework.css'));assert.ok(calls.includes('/css/academic-class-score-register.css'));assert.ok(calls.includes('/js/academic-audit-log.js'));assert.ok(calls.includes('/css/module-audit.css'));assert.ok(calls.includes('/css/academic-result-preview.css'));
  assert.ok(calls.includes('/js/academic-workflow-status.js'));assert.ok(calls.includes('/js/academic-batch-review.js'));assert.ok(calls.includes('/js/academic-duplicate-score-review.js'));
  assert.ok(calls.includes('/js/staff-meetings.js'));assert.ok(calls.includes('/css/staff-meetings.css'));assert.ok(calls.includes('/js/academic-result-template.js'));assert.ok(calls.includes('/js/parent-dashboard.js'));
});
test('a successful deployment with stale staff JavaScript fails verification',async()=>{
  await assert.rejects(verifyStaffWebRelease('https://school.invalid',{read:async path=>path,
    fetcher:async url=>new Response(url.pathname==='/js/admin.js'?'older interface':url.pathname.slice(1))}),/admin.js.*differs/);
});
