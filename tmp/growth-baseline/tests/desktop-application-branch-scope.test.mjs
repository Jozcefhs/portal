import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const backendSource = fs.readFileSync(new URL('../functions/api/backend.js', import.meta.url), 'utf8');

test('desktop application refresh is constrained to its selected branch and school section', () => {
  const route = backendSource.slice(
    backendSource.indexOf("case 'getApplications':"),
    backendSource.indexOf("case 'getStudents':")
  );
  assert.match(route, /listSchoolCollection\(env, 'applications', requestedStudentScope\(body\)\)/);
});
