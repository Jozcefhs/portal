import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyStaffWebRelease } from '../scripts/verify-staff-web-release.mjs';
test('release verification accepts line-ending differences and checks deployed staff assets',async()=>{
  const calls=[];
  const result=await verifyStaffWebRelease('https://school.invalid',{read:async path=>`${path}\r\n`,fetcher:async url=>{
    calls.push(url.pathname);return new Response(url.pathname.slice(1)+'\n');}});
  assert.equal(result.verified.length,7);assert.ok(calls.includes('/js/admin.js'));assert.ok(calls.includes('/css/academic-class-score-register.css'));assert.ok(calls.includes('/js/academic-audit-log.js'));
});
test('a successful deployment with stale staff JavaScript fails verification',async()=>{
  await assert.rejects(verifyStaffWebRelease('https://school.invalid',{read:async path=>path,
    fetcher:async url=>new Response(url.pathname==='/js/admin.js'?'older interface':url.pathname.slice(1))}),/admin.js.*differs/);
});
