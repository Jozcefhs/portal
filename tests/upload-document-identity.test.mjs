import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  applicationUploadReferenceMatches,
  applicationUploadIdentityMatches,
  canResumeSavedUploadOperation,
  findFirestoreApplication,
  linkedUploadApplication,
  studentUploadIdentityMatches
} from '../functions/api/upload-document.js';

function queryMatches(row, query = {}) {
  if (query.scopePath && String(row.__scopePath || '') !== String(query.scopePath)) return false;
  const filters = Array.isArray(query.filters) ? query.filters : [];
  const matches = filters.map(({ field, op, value }) => {
    const actual = String(row[field] ?? '');
    if (op === 'in') return (value || []).some((candidate) => actual === String(candidate));
    return actual === String(value ?? '');
  });
  const matched = String(query.filterJoin || 'AND').toUpperCase() === 'OR'
    ? matches.some(Boolean)
    : matches.every(Boolean);
  return matched;
}

test('application upload identity checks every supported email alias', () => {
  const application = {
    VerificationEmail: 'admissions@example.test',
    ParentEmail: 'parent@example.test',
    VerificationCode: 'FORM-742'
  };
  assert.equal(applicationUploadIdentityMatches(application, 'parent@example.test', 'form-742'), true);
  assert.equal(applicationUploadIdentityMatches(application, 'wrong@example.test', 'FORM-742'), false);
});

test('student parent login identity links back to its application', () => {
  const student = {
    ParentEmail: 'parent@example.test',
    ParentLoginCode: 'PARENT-918',
    ApplicationReference: 'DCA/26/0007'
  };
  const application = {
    __id: 'DCA-26-0007',
    ApplicationReference: 'DCA/26/0007'
  };
  assert.equal(studentUploadIdentityMatches(student, 'parent@example.test', 'parent-918'), true);
  assert.equal(linkedUploadApplication([application], student), application);
  assert.equal(applicationUploadReferenceMatches(application, 'DCA/26/0007'), true);
});

test('application lookup supports parent login credentials without accepting an admission number alone', async () => {
  const application = {
    __id: 'DCA-26-0007',
    ApplicationReference: 'DCA/26/0007',
    VerificationEmail: 'admissions@example.test',
    ParentEmail: 'parent@example.test',
    VerificationCode: 'FORM-742',
    __scopePath: 'applications'
  };
  const student = {
    ParentEmail: 'parent@example.test',
    ParentLoginCode: 'PARENT-918',
    AdmissionNo: 'DCA/26/007',
    ApplicationReference: 'DCA/26/0007',
    __scopePath: 'students'
  };
  const records = { applications: [application], students: [student] };
  const options = {
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      return records[collection].filter((row) => queryMatches(row, query));
    }
  };

  assert.equal(
    await findFirestoreApplication({}, 'parent@example.test', 'PARENT-918', options),
    application
  );
  assert.equal(
    await findFirestoreApplication({}, 'parent@example.test', 'DCA/26/007', options),
    null
  );
});

test('legacy lowercase identity fields remain upload compatible', async () => {
  const application = {
    __id: 'legacy-app',
    applicationReference: 'LEGACY/1',
    parentEmail: 'legacy@example.test',
    verificationCode: 'legacy-code'
  };
  const options = {
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      if (collection !== 'applications') return [];
      return queryMatches(application, query) ? [application] : [];
    }
  };
  assert.equal(
    await findFirestoreApplication({}, 'legacy@example.test', 'LEGACY-CODE', options),
    application
  );
});

test('credential-only upload fails closed when more than one application matches', async () => {
  const applications = [
    {
      __id: 'first-child',
      ApplicationReference: 'DCA/26/0101',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'SHARED-CODE',
      __scopePath: 'schoolBranches/main/sections/primary/applications'
    },
    {
      __id: 'second-child',
      ApplicationReference: 'DCA/26/0102',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'SHARED-CODE',
      __scopePath: 'schoolBranches/main/sections/secondary/applications'
    }
  ];
  const options = {
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      if (collection !== 'applications') return [];
      return applications.filter((application) => queryMatches(application, query));
    }
  };

  await assert.rejects(
    () => findFirestoreApplication({}, 'parent@example.test', 'SHARED-CODE', options),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'UPLOAD_CHILD_SELECTION_REQUIRED');
      assert.match(error.message, /parent dashboard.+select the child/i);
      return true;
    }
  );
});

test('credential-only upload fails closed when a parent login matches multiple students', async () => {
  const students = [
    {
      __id: 'student-one',
      AdmissionNo: 'DCA/26/101',
      ApplicationReference: 'DCA/26/0101',
      ParentEmail: 'parent@example.test',
      ParentLoginCode: 'FAMILY-CODE',
      __scopePath: 'schoolBranches/main/sections/primary/students'
    },
    {
      __id: 'student-two',
      AdmissionNo: 'DCA/26/102',
      ApplicationReference: 'DCA/26/0102',
      ParentEmail: 'parent@example.test',
      ParentLoginCode: 'FAMILY-CODE',
      __scopePath: 'schoolBranches/main/sections/secondary/students'
    }
  ];
  const records = { applications: [], students };
  const options = {
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      return records[collection].filter((row) => queryMatches(row, query));
    }
  };

  await assert.rejects(
    () => findFirestoreApplication({}, 'parent@example.test', 'FAMILY-CODE', options),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, 'UPLOAD_CHILD_SELECTION_REQUIRED');
      assert.match(error.message, /parent dashboard.+select the child/i);
      return true;
    }
  );
});

test('selected sibling application is resolved only after family authentication', async () => {
  const applications = [
    {
      ApplicationReference: 'DCA/26/0007',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'FORM-ONE'
    },
    {
      ApplicationReference: 'DCA/26/0008',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'FORM-TWO'
    }
  ];
  const options = {
    targetReference: 'DCA/26/0008',
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      if (collection !== 'applications') return [];
      return applications.filter((application) => queryMatches(application, query));
    }
  };
  assert.equal(
    await findFirestoreApplication({}, 'parent@example.test', 'FORM-ONE', options),
    applications[1]
  );
  assert.equal(
    await findFirestoreApplication({}, 'outsider@example.test', 'FORM-ONE', options),
    null
  );
});

test('an invalid selected sibling never falls back to the first authenticated application', async () => {
  const application = {
    ApplicationReference: 'DCA/26/0007',
    ParentEmail: 'parent@example.test',
    VerificationCode: 'FORM-ONE'
  };
  const options = {
    targetReference: 'DCA/26/9999',
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      if (collection !== 'applications') return [];
      return queryMatches(application, query) ? [application] : [];
    }
  };
  assert.equal(
    await findFirestoreApplication({}, 'parent@example.test', 'FORM-ONE', options),
    null
  );
});

test('post-Drive metadata lookup remains pinned to the selected application', async () => {
  const source = await readFile(new URL('../functions/api/upload-document.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /const latestApplication = await findFirestoreApplication\(env, email, code, \{\s*targetReference: applicationReference,\s*targetScopePath: applicationScopePath,\s*authenticated: true\s*\}\)/
  );
});

test('a metadata conflict resumes only when its saved Drive URL can be attached safely', () => {
  const operation = {
    Status: 'MetadataConflict',
    OperationId: 'upload-operation-1',
    DocumentUrl: 'https://drive.google.com/file/d/saved-file/view'
  };
  assert.equal(
    canResumeSavedUploadOperation(operation, {}, 'PreviousSchoolReport'),
    true
  );
  assert.equal(
    canResumeSavedUploadOperation(operation, {
      documents: {
        PreviousSchoolReport: {
          url: operation.DocumentUrl,
          uploadOperationId: operation.OperationId
        }
      }
    }, 'PreviousSchoolReport'),
    true
  );
  assert.equal(
    canResumeSavedUploadOperation(operation, {
      documents: {
        PreviousSchoolReport: {
          url: 'https://drive.google.com/file/d/newer-file/view',
          uploadOperationId: 'newer-operation'
        }
      }
    }, 'PreviousSchoolReport'),
    false
  );
  assert.equal(
    canResumeSavedUploadOperation({ ...operation, DocumentUrl: '' }, {}, 'PreviousSchoolReport'),
    false
  );
  assert.equal(
    canResumeSavedUploadOperation({ ...operation, Status: 'UploadUncertain' }, {}, 'PreviousSchoolReport'),
    false
  );
});

test('duplicate references are resolved only within the selected child scope', async () => {
  const applications = [
    {
      ApplicationReference: 'DCA/26/0042',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'FORM-ONE',
      __scopePath: 'schoolBranches/main/sections/secondary/applications'
    },
    {
      ApplicationReference: 'DCA/26/0042',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'FORM-TWO',
      __scopePath: 'schoolBranches/west/sections/primary/applications'
    }
  ];
  const options = {
    targetReference: 'DCA/26/0042',
    targetScopePath: 'schoolBranches/west/sections/primary/students',
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      if (collection !== 'applications') return [];
      return applications.filter((application) => queryMatches(application, query));
    }
  };
  assert.equal(
    await findFirestoreApplication({}, 'parent@example.test', 'FORM-ONE', options),
    applications[1]
  );
});

test('scoped sibling lookup consolidates aliases and sends the exact application scope to the query layer', async () => {
  const applications = [
    {
      ApplicationReference: 'DCA/26/0007',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'FORM-ONE',
      __scopePath: 'schoolBranches/main/sections/secondary/applications'
    },
    {
      ApplicationReference: 'DCA/26/0008',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'FORM-TWO',
      __scopePath: 'schoolBranches/west/sections/primary/applications'
    }
  ];
  const calls = [];
  const options = {
    targetReference: 'DCA/26/0008',
    targetScopePath: 'schoolBranches/west/sections/primary/students',
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      calls.push({ collection, query });
      return applications.filter((application) => queryMatches(application, query));
    }
  };

  assert.equal(
    await findFirestoreApplication({}, 'parent@example.test', 'FORM-ONE', options),
    applications[1]
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].query.scopePath, 'schoolBranches/west/sections/primary/applications');
  assert.equal(calls[1].query.filterJoin, 'OR');
  assert.equal(calls[1].query.filters.length, 9);
  assert.ok(calls[1].query.filters.length * calls[1].query.filters[0].value.length <= 30);
});

test('unscoped duplicate target references fail closed after family authentication', async () => {
  const applications = [
    {
      ApplicationReference: 'DCA/26/AUTH',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'FORM-ONE',
      __scopePath: 'applications'
    },
    {
      ApplicationReference: 'DCA/26/0042',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'FORM-TWO',
      __scopePath: 'schoolBranches/main/sections/secondary/applications'
    },
    {
      ApplicationReference: 'DCA/26/0042',
      ParentEmail: 'parent@example.test',
      VerificationCode: 'FORM-THREE',
      __scopePath: 'schoolBranches/west/sections/primary/applications'
    }
  ];
  const options = {
    targetReference: 'DCA/26/0042',
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      if (collection !== 'applications') return [];
      return applications.filter((application) => queryMatches(application, query));
    }
  };

  assert.equal(
    await findFirestoreApplication({}, 'parent@example.test', 'FORM-ONE', options),
    null
  );
});

test('student linkage stays in the authenticated scope and chunks alias queries below Firestore DNF limits', async () => {
  const student = {
    ParentEmail: 'parent@example.test',
    ParentLoginCode: 'PARENT-918',
    ApplicationReference: 'DCA/26/0007',
    AdmissionNo: 'DCA/26/007',
    __scopePath: 'schoolBranches/west/sections/primary/students'
  };
  const wrongScope = {
    ApplicationReference: 'DCA/26/0007',
    ParentEmail: 'other@example.test',
    __scopePath: 'schoolBranches/main/sections/secondary/applications'
  };
  const linked = {
    ApplicationReference: 'DCA/26/0007',
    ParentEmail: 'parent@example.test',
    __scopePath: 'schoolBranches/west/sections/primary/applications'
  };
  const records = { applications: [wrongScope, linked], students: [student] };
  const applicationQueries = [];
  const options = {
    requireFirestoreEnv() {},
    async querySchoolCollection(_env, collection, query) {
      if (collection === 'applications' && query.scopePath) applicationQueries.push(query);
      return records[collection].filter((row) => queryMatches(row, query));
    }
  };

  assert.equal(
    await findFirestoreApplication({}, 'parent@example.test', 'PARENT-918', options),
    linked
  );
  assert.equal(applicationQueries.length, 2);
  assert.ok(applicationQueries.every((query) =>
    query.scopePath === 'schoolBranches/west/sections/primary/applications'
      && query.filters.length * (Array.isArray(query.filters[0].value) ? query.filters[0].value.length : 1) <= 30
  ));
});

test('targeted upload lookup uses bounded field queries instead of a collection scan', async () => {
  const source = await readFile(new URL('../functions/api/upload-document.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /listSchoolCollection/);
  assert.match(source, /targetScopePath/);
  assert.match(source, /Math\.floor\(30 \/ fields\.length\)/);
  assert.match(source, /filterJoin: 'OR'/);
});
