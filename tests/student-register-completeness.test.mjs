import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [adminApiSource, adminSource] = await Promise.all([
  readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8')
]);

test('Students workspace returns the complete selected branch and section register', () => {
  assert.match(
    adminApiSource,
    /students: publicRows\(sortRecent\(visibleStudents,[\s\S]{0,100}visibleStudents\.length\)/
  );
  assert.doesNotMatch(
    adminApiSource,
    /students: publicRows\(sortRecent\(visibleStudents,[\s\S]{0,100},\s*80\)/
  );
});

test('Student metric cards use full server totals instead of a displayed-row limit', () => {
  assert.match(adminApiSource, /summary\.students = visibleStudents\.length/);
  assert.match(adminApiSource, /summary\.activeStudents = visibleStudents\.filter/);
  assert.match(adminApiSource, /summary\.dayStudents = visibleStudents\.length - summary\.boardingStudents/);
  assert.match(adminSource, /label: 'Students', value: summary\.students \?\? rows\.length/);
  assert.match(adminSource, /label: 'Active', value: summary\.activeStudents \?\?/);
  assert.match(adminSource, /label: 'Day Students', value: summary\.dayStudents \?\?/);
  assert.match(adminSource, /label: 'Boarding', value: summary\.boardingStudents \?\?/);
});
