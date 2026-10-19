import { deleteDocument, getDocument, listCollection, queryCollection, upsertDocument } from './firestore.js';
import { normalizeClassKey } from './class-names.js';

function clean(value) { return String(value ?? '').trim(); }

let cachedStructure = null;
let cachedStructureUntil = 0;

export function safeScopeId(value, fallback = 'main') {
  return clean(value || fallback).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}

export function schoolSectionFor(row = {}) {
  const explicit = clean(row.SchoolSection || row.schoolSection).toLowerCase();
  if (['primary', 'nursery', 'early years', 'early-years'].includes(explicit)) return 'primary';
  if (['secondary', 'junior secondary', 'senior secondary'].includes(explicit)) return 'secondary';
  const normalizedClass = normalizeClassKey(row.ClassApplyingFor || row.ClassName || row.Class || row.CurrentClass);
  if (/^(creche|prenursery|nursery[1-3]|primary[1-6])$/.test(normalizedClass)) return 'primary';
  if (/^(jss[1-3]|ss[1-3])$/.test(normalizedClass)) return 'secondary';
  const className = clean(row.ClassApplyingFor || row.ClassName || row.Class || row.CurrentClass).toLowerCase();
  return /(creche|crèche|pre[ -]?nursery|nursery|primary|grade\s*[1-6]\b)/i.test(className) ? 'primary' : 'secondary';
}

export async function getSchoolStructure(env) {
  if (cachedStructure && Date.now() < cachedStructureUntil) return cachedStructure;
  const saved = await getDocument(env, 'settings', 'schoolStructure').catch(() => null);
  const branches = Array.isArray(saved?.Branches) && saved.Branches.length
    ? saved.Branches.map((row) => typeof row === 'string' ? { Id: safeScopeId(row), Name: clean(row) } : {
      Id: safeScopeId(row.Id || row.id || row.Name || row.name), Name: clean(row.Name || row.name || row.Id || row.id)
    }).filter((row) => row.Id)
    : [{ Id: 'main', Name: 'Main Branch' }];
  const sections = Array.isArray(saved?.Sections) && saved.Sections.length
    ? saved.Sections.map((value) => safeScopeId(typeof value === 'string' ? value : value.Id || value.id)).filter((value) => ['primary', 'secondary'].includes(value))
    : ['primary', 'secondary'];
  cachedStructure = {
    Branches: branches,
    Sections: [...new Set(sections.length ? sections : ['primary', 'secondary'])],
    ActiveBranchId: safeScopeId(saved?.ActiveBranchId || branches[0]?.Id || 'main')
  };
  cachedStructureUntil = Date.now() + 15000;
  return cachedStructure;
}

export function scopedCollectionPath(collection, branchId, section) {
  return `schoolBranches/${safeScopeId(branchId)}/sections/${schoolSectionFor({ SchoolSection: section })}/${clean(collection)}`;
}

export async function listSchoolCollection(env, collection) {
  const structure = await getSchoolStructure(env);
  const paths = [clean(collection)];
  structure.Branches.forEach((branch) => structure.Sections.forEach((section) => {
    paths.push(scopedCollectionPath(collection, branch.Id, section));
  }));
  const groups = await Promise.all(paths.map((path) => listCollection(env, path).catch(() => [])));
  return groups.flatMap((rows, index) => rows.map((row) => ({ ...row, __scopePath: paths[index] })));
}

export async function schoolCollectionPaths(env, collection) {
  const structure = await getSchoolStructure(env);
  const paths = [clean(collection)];
  structure.Branches.forEach((branch) => structure.Sections.forEach((section) => {
    paths.push(scopedCollectionPath(collection, branch.Id, section));
  }));
  return [...new Set(paths)];
}

export async function getSchoolDocumentById(env, collection, documentId) {
  const paths = await schoolCollectionPaths(env, collection);
  const groups = await Promise.all(paths.map(async (path) => {
    const row = await getDocument(env, path, documentId).catch(() => null);
    return row ? { ...row, __scopePath: path } : null;
  }));
  return groups.find(Boolean) || null;
}

export async function querySchoolCollection(env, collection, options = {}) {
  const paths = await schoolCollectionPaths(env, collection);
  const groups = await Promise.all(paths.map(async (path) => {
    const rows = await queryCollection(env, path, options).catch(() => []);
    return rows.map((row) => ({ ...row, __scopePath: path }));
  }));
  return groups.flat();
}

export async function upsertSchoolDocument(env, collection, documentId, data) {
  const structure = await getSchoolStructure(env);
  const copy = { ...(data || {}) };
  const existingPath = clean(copy.__scopePath);
  delete copy.__scopePath;
  delete copy.__name;
  const branchId = safeScopeId(copy.BranchId || copy.branchId || structure.ActiveBranchId);
  const section = schoolSectionFor(copy);
  copy.BranchId = branchId;
  copy.SchoolSection = section;
  const path = existingPath || scopedCollectionPath(collection, branchId, section);
  await upsertDocument(env, path, documentId, copy);
  return { ...copy, __scopePath: path };
}

export async function deleteSchoolDocument(env, collection, documentId, row = {}) {
  const path = clean(row.__scopePath) || scopedCollectionPath(collection, row.BranchId, schoolSectionFor(row));
  return deleteDocument(env, path, documentId);
}
