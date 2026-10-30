import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertServiceWorkerCacheVersion } from './helpers/service-worker-cache-version.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('entrance results use the combined label without changing the saved score field', () => {
  const source = read('../js/parent-dashboard.js');
  assert.ok(source.includes('(record.EntranceSubjectScores || []).map'));
  assert.ok(source.includes('escapeHtml(subject.name)'));
  assert.ok(source.includes('subject.score == null'));
  assert.ok(read('../functions/lib/entrance-subjects.js').includes("name: 'Interview/General knowledge'"));
  assert.ok(!source.includes('Interview / General:'));
  const api = read('../functions/api/parent-dashboard.js');
  assert.match(api, /InterviewScore: pick\(row, \['InterviewScore', 'interviewScore', 'GeneralPaperScore', 'generalPaperScore'\]\)/);
  assert.match(api, /InterviewScore: pick\(application, \['InterviewScore', 'interviewScore', 'GeneralPaperScore', 'generalPaperScore'\]\)/);
});

test('parent dashboard refreshes cached assets for the updated admissions label', () => {
  assert.match(read('../parent-dashboard.html'), /parent-dashboard\.js\?v=20261030-parent-recovery-result-download/);
  assertServiceWorkerCacheVersion(read('../sw.js'), 450);
});
