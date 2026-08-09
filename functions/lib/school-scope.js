import { deleteDocument, getDocument, listCollection, queryCollection, upsertDocument } from './firestore.js';
import { normalizeClassKey } from './class-names.js';

function clean(value) { return String(value ?? '').trim(); }

let cachedStructure = null;
let cachedStructureUntil = 0;
let cachedStructureKey = '';

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
  const environmentKey = clean(env.FIREBASE_PROJECT_ID);
  if (cachedStructure && cachedStructureKey === environmentKey && Date.now() < cachedStructureUntil) return cachedStructure;
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
  cachedStructureKey = environmentKey;
  cachedStructureUntil = Date.now() + 15000;
  return cachedStructure;
}

export function invalidateSchoolStructureCache() {
  cachedStructure = null;
  cachedStructureKey = '';
  cachedStructureUntil = 0;
}

export function scopedCollectionPath(collection, branchId, section) {
  return `schoolBranches/${safeScopeId(branchId)}/sections/${schoolSectionFor({ SchoolSection: section })}/${clean(collection)}`;
}

function accessScope(scope = {}) {
  const branchId = clean(scope.branchId || scope.BranchId);
  const rawSection = clean(scope.schoolSectionAccess || scope.SchoolSectionAccess || scope.section).toLowerCase();
  const section = ['primary', 'secondary'].includes(rawSection) ? rawSection : '';
  return {
    branchId: branchId && branchId.toLowerCase() !== 'all' ? safeScopeId(branchId) : '',
    section
  };
}

function legacyRowAllowed(row, scope) {
  if (scope.branchId && safeScopeId(row.BranchId || row.branchId || 'main') !== scope.branchId) return false;
  if (scope.section && schoolSectionFor(row) !== scope.section) return false;
  return true;
}

export async function listSchoolCollection(env, collection, requestedScope = null) {
  const scope = accessScope(requestedScope || {});
  const uniquePaths = await schoolCollectionPaths(env, collection, scope);
  const groups = await Promise.all(uniquePaths.map((path) => listCollection(env, path)));
  return groups.flatMap((rows, index) => rows
    .filter((row) => index !== 0 || legacyRowAllowed(row, scope))
    .map((row) => ({ ...row, __scopePath: uniquePaths[index] })));
}

export async function schoolCollectionPaths(env, collection, requestedScope = null) {
  const structure = await getSchoolStructure(env);
  const scope = accessScope(requestedScope || {});
  const branches = scope.branchId
    ? [{ Id: scope.branchId, Name: scope.branchId }]
    : structure.Branches;
  const sections = scope.section ? [scope.section] : structure.Sections;
  const paths = [clean(collection)];
  branches.forEach((branch) => sections.forEach((section) => {
    paths.push(scopedCollectionPath(collection, branch.Id, section));
  }));
  return [...new Set(paths)];
}

export async function getSchoolDocumentsById(env, collection, documentId, requestedScope = null) {
  const paths = await schoolCollectionPaths(env, collection, requestedScope);
  const groups = await Promise.all(paths.map(async (path) => {
    const row = await getDocument(env, path, documentId).catch(() => null);
    return row ? { ...row, __scopePath: path } : null;
  }));
  return groups.filter(Boolean);
}

export async function getSchoolDocumentById(env, collection, documentId, requestedScope = null) {
  const matches = await getSchoolDocumentsById(env, collection, documentId, requestedScope);
  return matches[0] || null;
}

function validatedCollectionScopePath(value, collection) {
  const path = clean(value).replace(/^\/+|\/+$/g, '');
  const collectionName = clean(collection);
  if (!path) return '';
  if (path === collectionName) return path;
  const escapedCollection = collectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `^schoolBranches/[a-z0-9._-]+/sections/(?:primary|secondary)/${escapedCollection}$`,
    'i'
  );
  return pattern.test(path) ? path : '';
}

export async function querySchoolCollection(env, collection, options = {}) {
  const requestedScopePath = clean(options.scopePath);
  const scopePath = validatedCollectionScopePath(requestedScopePath, collection);
  if (requestedScopePath && !scopePath) {
    throw new Error(`Invalid ${clean(collection)} collection scope.`);
  }
  const requestedScope = options.scope || {
    branchId: options.branchId,
    schoolSectionAccess: options.schoolSectionAccess || options.schoolSection || options.section
  };
  const paths = scopePath ? [scopePath] : await schoolCollectionPaths(env, collection, requestedScope);
  const queryOptions = { ...options };
  delete queryOptions.scopePath;
  delete queryOptions.scope;
  delete queryOptions.branchId;
  delete queryOptions.schoolSectionAccess;
  delete queryOptions.schoolSection;
  delete queryOptions.section;
  const groups = await Promise.all(paths.map(async (path) => {
    const rows = await queryCollection(env, path, queryOptions);
    return rows.map((row) => ({ ...row, __scopePath: path }));
  }));
  return groups.flat();
}

export async function upsertSchoolDocument(env, collection, documentId, data, options = {}) {
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
  await upsertDocument(env, path, documentId, copy, options);
  return { ...copy, __scopePath: path };
}

export async function deleteSchoolDocument(env, collection, documentId, row = {}) {
  const path = clean(row.__scopePath) || scopedCollectionPath(collection, row.BranchId, schoolSectionFor(row));
  return deleteDocument(env, path, documentId);
}
