import test from 'node:test';
import assert from 'node:assert/strict';

import { parentCanAccessPassportApplication } from '../functions/api/passport-photo.js';

const application = {
  ApplicationReference: 'DCA/26/000001',
  VerificationEmail: 'parent@example.test',
  VerificationCode: 'APPLICATION-CODE',
  __scopePath: 'schoolBranches/main/sections/secondary/applications'
};

test('passport photos accept the original application verification code', async () => {
  let resolverCalled = false;
  const allowed = await parentCanAccessPassportApplication(
    {},
    application,
    'parent@example.test',
    'APPLICATION-CODE',
    {
      async findFirestoreApplication() {
        resolverCalled = true;
        return null;
      }
    }
  );
  assert.equal(allowed, true);
  assert.equal(resolverCalled, false);
});

test('passport photos accept a family login resolved to the same scoped application', async () => {
  let lookupOptions = null;
  const allowed = await parentCanAccessPassportApplication(
    {},
    application,
    'parent@example.test',
    'PARENT-LOGIN-CODE',
    {
      async findFirestoreApplication(_env, email, code, options) {
        assert.equal(email, 'parent@example.test');
        assert.equal(code, 'PARENT-LOGIN-CODE');
        lookupOptions = options;
        return application;
      }
    }
  );
  assert.equal(allowed, true);
  assert.deepEqual(lookupOptions, {
    targetReference: 'DCA/26/000001',
    targetScopePath: 'schoolBranches/main/sections/secondary/applications'
  });
});

test('family login cannot supply a passport photo from another scope', async () => {
  const allowed = await parentCanAccessPassportApplication(
    {},
    application,
    'parent@example.test',
    'PARENT-LOGIN-CODE',
    {
      async findFirestoreApplication() {
        return {
          ...application,
          __scopePath: 'schoolBranches/west/sections/secondary/applications'
        };
      }
    }
  );
  assert.equal(allowed, false);
});

test('failed family identity resolution leaves the passport private', async () => {
  const allowed = await parentCanAccessPassportApplication(
    {},
    application,
    'outsider@example.test',
    'WRONG-CODE',
    {
      async findFirestoreApplication() {
        return null;
      }
    }
  );
  assert.equal(allowed, false);
});

test('imported student passport photos accept the parent login identity in the student scope', async () => {
  const student = {
    AdmissionNo: 'DCA/26/000099',
    ParentEmail: 'parent@example.test',
    ParentLoginCode: 'PARENT-IMPORTED',
    __scopePath: 'schoolBranches/main/sections/secondary/students',
    __uploadCollection: 'students'
  };
  const allowed = await parentCanAccessPassportApplication(
    {},
    student,
    'parent@example.test',
    'PARENT-IMPORTED'
  );
  assert.equal(allowed, true);
});
