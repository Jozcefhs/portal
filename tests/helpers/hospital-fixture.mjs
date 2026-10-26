import assert from 'node:assert/strict';
import { createHospitalService } from '../../functions/lib/hospital-service.js';

export const env = { ORGANISATION_EDITION: 'hospital', DYNAMAX_WORKSPACE_ID: 'test-hospital', FIREBASE_PROJECT_ID: 'hospital-fixture' };
export const actor = { username: 'reception', displayName: 'Reception Officer', role: 'Registration Officer', edition: 'hospital',
  branchAccess: 'selected', assignedBranchIds: ['main'], subscriptionActive: true, allowedSections: ['hospitalPatients', 'hospitalReception'] };
export const profile = { FirstName: 'Test', LastName: 'Patient', DateOfBirth: '2000-01-02', Sex: 'Female', Phone: '08000000000' };
export const request = (extra = {}) => ({ BranchId: 'main', RequestId: crypto.randomUUID(), ...extra });

export function fixture(user = actor, environment = env) {
  const store = new Map(), reads = [], queries = [], commits = [];
  let revision = 0;
  const db = {
    now: () => new Date('2026-10-26T12:00:00Z'),
    getSchoolStructure: async () => ({ Branches: [{ Id: 'main', Name: 'Main Hospital' }, { Id: 'north', Name: 'North Clinic' }] }),
    getDocument: async (_env, path, id) => { reads.push([path, id]); return structuredClone(store.get(`${path}/${id}`) || null); },
    queryCollection: async (_env, path, options) => {
      queries.push({ path, ...options });
      let rows = [...store.entries()].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(([, row]) => row);
      for (const filter of options.filters || []) rows = rows.filter(row => {
        const value = row[filter.field];
        if (filter.op === 'ARRAY_CONTAINS') return value?.includes(filter.value);
        if (filter.op === '==') return value === filter.value;
        if (filter.op === '>=') return value >= filter.value;
        if (filter.op === '<=') return value <= filter.value;
        if (filter.op === '<') return value < filter.value;
        throw new Error(`Unhandled filter ${filter.op}`);
      });
      const field = options.orderBy?.[0]?.field;
      rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])) || a.__id.localeCompare(b.__id));
      if (options.startAfterName) {
        const last = options.startAfterName.split('/').at(-1);
        rows = rows.filter(row => row[field] > options.startAfterFieldValue || row[field] === options.startAfterFieldValue && row.__id > last);
      }
      return structuredClone(rows.slice(0, options.limit));
    },
    batchCommitLiteralDocuments: async (_env, writes) => {
      for (const write of writes) {
        const current = store.get(`${write.collectionPath}/${write.documentId}`), expected = write.currentDocument;
        assert.ok(expected, 'every hospital write has a precondition');
        if (expected.exists === false && current || expected.updateTime && expected.updateTime !== current?.__updateTime) throw Object.assign(new Error('conflict'), { status: 409 });
      }
      for (const write of writes) store.set(`${write.collectionPath}/${write.documentId}`, {
        ...structuredClone(write.data), __id: write.documentId, __updateTime: `revision-${++revision}`
      });
      commits.push(structuredClone(writes));
    }
  };
  const service = createHospitalService(environment, user, db);
  const rows = suffix => [...store.entries()].filter(([key]) => key.includes(`/hospital${suffix}/`)).map(([, row]) => row);
  const register = (extra = {}) => service.savePatient(request({ Patient: profile, ...extra }));
  const details = async PatientId => (await service.details(request({ PatientId }))).patient;
  return { service, store, db, reads, queries, commits, rows, register, details };
}

