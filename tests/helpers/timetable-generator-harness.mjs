import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as generator from '../../functions/lib/academic-timetable-generator.js';

const source = await readFile(new URL('../../functions/lib/academic-management.js', import.meta.url), 'utf8');
const start = source.indexOf('function generationSourceVersion('), end = source.indexOf('export async function updateAcademicTimetableVersion(', start);
const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const recordId = (row) => clean(row?.RecordId || row?.VersionId || row?.EntryId || row?.AllocationId || row?.ClassId || row?.ArmId || row?.SubjectId);
const withoutMetadata = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__') && key !== 'RevisionToken'));

export function timetableHarness(initialState, allowedScope = { branchId: 'main', section: 'secondary' }) {
  const state = structuredClone(initialState);
  let revision = 0, failCommit = false;
  const commits = [];
  const collections = { timetableVersions: 'academicTimetableVersions', timetableEntries: 'academicTimetableEntries', audit: 'academicManagementAudit' };
  const publicRow = (row) => {
    const result = { ...withoutMetadata(row), RevisionToken: row.__updateTime || '' };
    delete result.GenerationPlan;
    return result;
  };
  const get = (collection, id) => Object.values(collections).includes(collection)
    ? (state[Object.keys(collections).find((key) => collections[key] === collection)] || []).find((row) => recordId(row) === id) : null;
  const response = async (_env, _user, _input, scope, message) => ({ ok: true, message, scope,
    ...Object.fromEntries(Object.entries(state).map(([key, rows]) => [key, rows.map(publicRow)])) });
  const context = {
    ...generator, crypto: webcrypto, TextEncoder, clean, lower, recordId, withoutMetadata,
    nowIso: () => new Date().toISOString(), actorName: () => 'Test timetable manager',
    failure: (message, status = 409, code = '') => Object.assign(new Error(message), { status, code }),
    findById: (rows = [], id) => rows.find((row) => lower(recordId(row)) === lower(id)) || null,
    academicId: (...parts) => parts.join('--'),
    ACADEMIC_MANAGEMENT_COLLECTIONS: collections,
    academicOperationalContext: async (_env, user, input, capability) => {
      if (user.role !== 'Super Admin' || user.edition !== 'school' || capability !== 'canManageTimetables') throw new Error('Permission denied');
      if (input.BranchId !== allowedScope.branchId || input.SchoolSection !== allowedScope.section || input.SessionId !== 'session' || input.TermId !== 'term') throw new Error('Scope denied');
      return { state: structuredClone(state), session: { SessionId: 'session' }, term: { TermId: 'term' }, scope: allowedScope };
    },
    writePrecondition: (row, token) => {
      if (token !== row.__updateTime) throw new Error('Revision conflict');
      return { updateTime: token };
    },
    auditWrite: (_user, action, _type, row, notes) => ({ collectionPath: collections.audit, documentId: `audit-${revision}`, data: { RecordId: `audit-${revision}`, Action: action, VersionId: row.VersionId, Notes: notes } }),
    academicOperationalResponse: response,
    getDocument: async (_env, collection, id) => structuredClone(get(collection, id)),
    commitAcademicBatch: async (_env, writes) => {
      if (failCommit) { failCommit = false; throw new Error('Simulated interruption before atomic commit'); }
      for (const write of writes) {
        const existing = get(write.collectionPath, write.documentId);
        if ((write.exists === false && existing) || (write.updateTime && existing?.__updateTime !== write.updateTime)) throw new Error('Revision conflict');
      }
      for (const write of writes) {
        const stateKey = Object.keys(collections).find((key) => collections[key] === write.collectionPath);
        state[stateKey] ||= [];
        const index = state[stateKey].findIndex((row) => recordId(row) === write.documentId);
        const saved = { ...structuredClone(write.data), __updateTime: `revision-${++revision}` };
        if (index < 0) state[stateKey].push(saved); else state[stateKey][index] = saved;
      }
      commits.push(structuredClone(writes));
    }
  };
  const functions = vm.runInNewContext(`${source.slice(start, end).replaceAll('export ', '')}\n({saveAcademicTimetableGenerationRules, previewAcademicTimetableGeneration, saveAcademicTimetableGeneration})`, context);
  const base = { BranchId: allowedScope.branchId, SchoolSection: allowedScope.section, SessionId: 'session', TermId: 'term', VersionId: initialState.timetableVersions[0].VersionId };
  const run = (action, payload = {}, user = { role: 'Super Admin', edition: 'school' }) => functions[action]({}, user, { ...base, ...payload });
  return { state, commits, run, base, interruptNextCommit: () => { failCommit = true; } };
}
