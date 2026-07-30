import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findParentOwnedApplication,
  getSelectedIdentityRow
} from '../functions/api/parent-dashboard.js';

const legacyPath = 'applications';
const primaryPath = 'schoolBranches/main/sections/primary/applications';
const westPath = 'schoolBranches/west/sections/primary/applications';

function identityOptions(rows = []) {
  return {
    schoolCollectionPaths: async () => [legacyPath, primaryPath, westPath],
    getDocument: async (_env, path, documentId) => rows.find((row) => (
      row.__scopePath === path && row.__id === documentId
    )) || null,
    querySchoolCollection: async (_env, _collection, options = {}) => {
      const wantedPath = options.scopePath || '';
      const filter = options.filters?.[0] || {};
      const wantedValues = Array.isArray(filter.value) ? filter.value : [filter.value];
      return rows.filter((row) => (
        (!wantedPath || row.__scopePath === wantedPath) &&
        wantedValues.includes(row[filter.field])
      ));
    }
  };
}

test('unscoped admission lookup preserves a single legacy application', async () => {
  const application = {
    __id: 'DCA-26-000001',
    __scopePath: legacyPath,
    ApplicationReference: 'DCA/26/000001',
    VerificationEmail: 'parent@example.com'
  };

  assert.deepEqual(
    await getSelectedIdentityRow(
      {},
      'applications',
      application.ApplicationReference,
      '',
      identityOptions([application])
    ),
    application
  );
});

test('unscoped admission lookup fails closed for the same document id in two workspaces', async () => {
  const rows = [primaryPath, westPath].map((scopePath) => ({
    __id: 'DCA-26-000002',
    __scopePath: scopePath,
    ApplicationReference: 'DCA/26/000002',
    VerificationEmail: 'parent@example.com',
    VerificationCode: 'DIRECT2'
  }));

  assert.equal(
    await getSelectedIdentityRow(
      {},
      'applications',
      'DCA/26/000002',
      '',
      identityOptions(rows)
    ),
    null
  );
});

test('unscoped admission lookup detects a duplicate reference stored under different document ids', async () => {
  const rows = [{
    __id: 'DCA-26-000003',
    __scopePath: primaryPath,
    ApplicationReference: 'DCA/26/000003',
    VerificationEmail: 'parent@example.com',
    VerificationCode: 'DIRECT3'
  }, {
    __id: 'imported-record-3',
    __scopePath: westPath,
    ApplicationReference: 'DCA/26/000003',
    VerificationEmail: 'parent@example.com',
    VerificationCode: 'DIRECT3'
  }];

  assert.equal(
    await getSelectedIdentityRow(
      {},
      'applications',
      'DCA/26/000003',
      '',
      identityOptions(rows)
    ),
    null
  );
});

test('an explicit admission scope resolves only its unique application', async () => {
  const rows = [primaryPath, westPath].map((scopePath) => ({
    __id: 'DCA-26-000004',
    __scopePath: scopePath,
    ApplicationReference: 'DCA/26/000004',
    VerificationEmail: 'parent@example.com'
  }));

  assert.deepEqual(
    await getSelectedIdentityRow(
      {},
      'applications',
      'DCA/26/000004',
      westPath,
      identityOptions(rows)
    ),
    rows[1]
  );
});

test('family-authenticated application selection also rejects duplicate references', () => {
  const rows = [{
    __id: 'one',
    __scopePath: primaryPath,
    ApplicationReference: 'DCA/26/000005',
    VerificationEmail: 'parent@example.com'
  }, {
    __id: 'two',
    __scopePath: primaryPath,
    ApplicationReference: 'DCA/26/000005',
    VerificationEmail: 'parent@example.com'
  }];

  assert.equal(
    findParentOwnedApplication(rows, 'DCA/26/000005', 'parent@example.com', primaryPath),
    null
  );
  assert.equal(
    findParentOwnedApplication([rows[0]], 'DCA/26/000005', 'parent@example.com'),
    rows[0]
  );
});

test('identity lookup fails closed if its reference uniqueness query cannot complete', async () => {
  const application = {
    __id: 'DCA-26-000006',
    __scopePath: legacyPath,
    ApplicationReference: 'DCA/26/000006'
  };
  const options = identityOptions([application]);
  options.querySchoolCollection = async () => {
    throw new Error('query unavailable');
  };

  assert.equal(
    await getSelectedIdentityRow({}, 'applications', 'DCA/26/000006', '', options),
    null
  );
});
