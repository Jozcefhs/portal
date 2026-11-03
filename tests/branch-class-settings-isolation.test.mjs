import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function normalizeAdmissionClass('), source.indexOf('export function feeCodeRenameAllowed(')).replaceAll('export ', '');

function fixture() {
  const rows = new Map(), reads = [], writes = [];
  const put = (path, id, data) => rows.set(`${path}/${id}`, { ...structuredClone(data), __id: id });
  const list = path => [...rows].filter(([key]) => key.slice(0, key.lastIndexOf('/')) === path).map(([, value]) => structuredClone(value));
  const clean = value => String(value ?? '').trim();
  const bindings = {
    clean, safeScopeId: clean, safeDocumentId: name => name.toLowerCase().replaceAll(' ', '-'),
    asMoneyNumber: value => Number(value) || 0, nowIso: () => '2026-11-03T12:00:00Z',
    yesNo: value => clean(value).toUpperCase() === 'YES' ? 'YES' : 'NO',
    pick: (row, keys, fallback = '') => keys.map(key => row[key]).find(value => value !== undefined && value !== '') ?? fallback,
    normalizeMinimumAdmissionAge: value => clean(value) && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 120 ? Number(value) : null,
    invalidateConfiguredClassCache: () => {},
    assertConfiguredProfileBranch: async (_env, id) => {
      if (!['main', 'area-1-primary'].includes(id)) throw Error('Unknown branch');
      return { id, name: id === 'main' ? 'Main Branch' : 'Area 1 Primary' };
    },
    getDocument: async (_env, path, id) => { reads.push({ path, id }); return structuredClone(rows.get(`${path}/${id}`) || null); },
    listCollection: async (_env, path) => { reads.push({ path }); return list(path); },
    queryCollection: async (_env, path, options) => {
      reads.push({ path, ...options });
      return list(path).filter(row => options.filters.every(filter => row[filter.field] === filter.value)).slice(0, options.limit);
    },
    upsertDocument: async (_env, path, id, data) => { writes.push({ path, id }); put(path, id, data); },
    deleteDocument: async (_env, path, id) => { writes.push({ path, id, delete: true }); rows.delete(`${path}/${id}`); }
  };
  const load = overrides => {
    const deps = { ...bindings, ...overrides };
    return new Function(...Object.keys(deps), code + '\nreturn {getSchoolClasses, saveSchoolClasses, getAdmissionClasses, saveAdmissionClasses, resetSchoolClasses, resetAdmissionClasses};')(...Object.values(deps));
  };
  put('settings/academics/classes', 'grade-10', { ClassName: 'Grade 10', Active: 'YES' });
  put('settings/admission/classes', 'grade-10', { ClassName: 'Grade 10', Active: 'YES', FormAmount: 15000 });
  put('branchSchoolSettings', 'area-1-primary', { ClassSetupMode: 'independent', AdmissionSetupMode: 'independent' });
  put('organisationBranches/area-1-primary/schoolClasses', 'grade-1', { ClassName: 'Grade 1', Active: 'YES' });
  put('organisationBranches/area-1-primary/admissionClasses', 'grade-1', { ClassName: 'Grade 1', Active: 'YES', FormAmount: 5000 });
  put('academicClasses', 'nursery', { Name: 'Nursery 2', BranchId: 'area-1-primary', Status: 'Active' });
  put('academicClasses', 'primary', { Name: 'Grade 1', BranchId: 'area-1-primary', Status: 'Active' });
  put('academicClasses', 'secondary', { Name: 'Grade 10', BranchId: 'main', Status: 'Active' });
  put('academicClasses', 'archived', { Name: 'Old nursery', BranchId: 'area-1-primary', Status: 'Archived' });
  return { rows, reads, writes, put, load, api: load() };
}

test('fee setup reads only its branch, appends missing active academic classes once and writes nothing', async () => {
  const f = fixture(), before = structuredClone([...f.rows]);
  const result = await f.api.getSchoolClasses({}, { BranchId: 'area-1-primary', IncludeAcademicClasses: true });
  assert.deepEqual(result.classes.map(row => row.ClassName), ['Grade 1', 'Nursery 2']);
  assert.equal(f.reads.length, 3); // One metadata document, one small setup list and one bounded catalogue query.
  assert.deepEqual(f.reads[2].filters, [{ field: 'BranchId', op: '==', value: 'area-1-primary' }]);
  assert.equal(f.reads[2].limit, 500);
  assert.deepEqual([...f.rows], before);
  assert.equal(f.writes.length, 0);
});

test('ordinary class loading does not query academics and explicit inactive classes stay inactive', async () => {
  const f = fixture();
  await f.api.getSchoolClasses({}, { BranchId: 'area-1-primary' });
  assert.equal(f.reads.length, 2);
  f.put('organisationBranches/area-1-primary/schoolClasses', 'nursery-2', { ClassName: 'Nursery 2', Active: 'NO' });
  const result = await f.api.getSchoolClasses({}, { BranchId: 'area-1-primary', IncludeAcademicClasses: true });
  assert.equal(result.classes.filter(row => row.ClassName === 'Nursery 2').length, 1);
  assert.equal(result.classes.find(row => row.ClassName === 'Nursery 2').Active, 'NO');
});

test('legacy unscoped saves and resets cannot alter organisation defaults or any branch', async () => {
  const f = fixture(), before = structuredClone([...f.rows]);
  for (const action of ['saveSchoolClasses', 'saveAdmissionClasses', 'resetSchoolClasses', 'resetAdmissionClasses']) {
    await assert.rejects(f.api[action]({}, { SettingsScope: 'organisation', Classes: [{ ClassName: 'Grade 1' }] }), /Select a branch/);
  }
  assert.equal(f.reads.length, 0);
  assert.equal(f.writes.length, 0);
  assert.deepEqual([...f.rows], before);
});

test('branch saves preserve shared defaults, the other branch and unrelated records', async () => {
  const f = fixture();
  f.put('studentScores', 'keep', { score: 73 });
  const before = structuredClone([...f.rows].filter(([path]) => !path.includes('area-1-primary')));
  const body = { BranchId: 'area-1-primary', SettingsScope: 'organisation', Classes: [{ ClassName: 'Grade 1', Active: 'YES', Arms: 'Excellence', FormAmount: 7500 }] };
  const classes = await f.api.saveSchoolClasses({}, body);
  const admissions = await f.api.saveAdmissionClasses({}, body);
  assert.equal(classes.settingsScope, 'branch');
  assert.equal(admissions.settingsScope, 'branch');
  assert.equal(admissions.classes[0].FormAmount, 7500);
  assert.deepEqual([...f.rows].filter(([path]) => !path.includes('area-1-primary')), before);
  assert.ok(f.writes.every(write => write.path.includes('area-1-primary') || write.id === 'area-1-primary'));
});

test('assignment mismatch or failed metadata read cannot fall back to global defaults or write', async () => {
  const f = fixture();
  await assert.rejects(f.api.saveSchoolClasses({}, { BranchId: 'main', UserBranchId: 'area-1-primary', Classes: [{ ClassName: 'Grade 1' }] }), /assigned branch/);
  const failing = f.load({ getDocument: async () => { throw Error('Database unavailable'); } });
  await assert.rejects(failing.getSchoolClasses({}, { BranchId: 'area-1-primary' }), /Database unavailable/);
  await assert.rejects(failing.saveSchoolClasses({}, { BranchId: 'area-1-primary', Classes: [{ ClassName: 'Grade 1' }] }), /Database unavailable/);
  assert.equal(f.writes.length, 0);
});
