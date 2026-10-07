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
  imports.forEach((match)=>assert.match(match[1],/20261007-human-directions-quick-lookup-auto-start$/));
  assert.match(html,/js\/admin\.js\?v=[^"]*20261007-face-directions-quick-lookup-auto-start/);
});
test('only assisted lookup uses quick capture; enrollment and attendance retain guided capture and manual confirmation',()=>{
  const lookup = ui.slice(ui.indexOf('export async function openStudentFaceLookup'), ui.indexOf('async function staffAttendanceFaceRequest'));
  const attendance = ui.slice(ui.indexOf('export function captureStaffAttendanceFace'));
  assert.match(lookup,/const descriptor = mode === 'lookup'\s*\? await captureLookupDescriptor\(dialog, human\)\s*: await captureDescriptor\(dialog, human, sampleCount\)/);
  assert.match(lookup,/renderPossibleMatch\(dialog, result\.match, options\.onMatch, options\.confirmText\)/);
  assert.match(lookup,/mode === 'lookup' \|\| options\.allowCameraSelection !== false/);
  assert.match(attendance,/await captureDescriptor\(dialog, human, sampleCount, \{/);
  assert.match(attendance,/onLivenessEvidence: \(evidence\) => \{ livenessEvidence = evidence; \}/);
  assert.match(attendance,/LivenessChallengeToken: activeChallenge\?\.challengeToken/);
  assert.match(attendance,/LivenessEvidence: livenessEvidence/);
  assert.doesNotMatch(attendance,/captureLookupDescriptor|quickLookup: true/);
  const quick = ui.slice(ui.indexOf('export async function captureLookupDescriptor'),ui.indexOf('export async function captureDescriptor'));
  assert.doesNotMatch(quick,/onLivenessEvidence|livenessConfirmed|actionObserved|staffAttendanceFaceRequest/);
  assert.match(ui,/not a live-person check\. Staff must confirm the possible match/);
  assert.match(ui,/\[data-face-confirm\]'\)\?\.addEventListener\('click'/);
});
