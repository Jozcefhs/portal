import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const [ui,endpoint,admin,html] = await Promise.all(['js/student-face-lookup.js','functions/api/staff-face-lookup.js','js/admin.js','admin.html'].map(path=>readFile(new URL(`../${path}`,import.meta.url),'utf8')));
test('head-turn comparisons use Human signed yaw without lowering match thresholds',()=>{
  assert.match(ui,/challenge\.action === 'TURN_LEFT'\s*\? yawDelta <= -TURN_YAW_THRESHOLD\s*: yawDelta >= TURN_YAW_THRESHOLD/);
  assert.match(ui,/if \(result\?\.error\) throw new Error/);
  assert.match(ui,/detectionQueue = detection\.catch\(\(\) => \{\}\)/);
});
test('deleted or absent student enrollments have actionable lookup feedback',()=>{
  assert.match(endpoint,/!candidates\.length[\s\S]*?No active student face enrollments[\s\S]*?Records Desk first/);
});
test('every shared face import requests the repaired module',()=>{
  const imports=[...admin.matchAll(/student-face-lookup\.js\?v=([^']+)/g)];
  assert.equal(imports.length,3);
  imports.forEach((match)=>assert.match(match[1],/20261007-human-directions$/));
  assert.match(html,/js\/admin\.js\?v=[^"]*20261007-face-directions/);
});
