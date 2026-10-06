import { getDocument, patchDocumentFields } from './firestore.js';
import { canonicalSchoolBranchId, invalidateSchoolStructureCache, normalizeSchoolStructure } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();
export function normalizeSchoolSectionMode(value) {
  const mode = clean(value).toLowerCase();
  return ['primary', 'secondary', 'mixed'].includes(mode) ? mode : '';
}

// Names are editable labels. Never reconstruct a known branch's identity from
// its name, and never let an older profile save erase its presentation setting.
export function mergeSchoolBranchMetadata(incoming, existing = []) {
  const previous = normalizeSchoolStructure({ Branches: existing }).Branches;
  if (!Array.isArray(incoming)) return previous;
  const rows = incoming.map((value) => {
    const object = value && typeof value === 'object' ? value : null;
    const name = clean(object ? object.Name || object.name : value);
    const id = clean(object?.Id || object?.id);
    const saved = previous.find((row) => id
      ? row.Id === canonicalSchoolBranchId(id)
      : clean(row.Name).toLowerCase() === name.toLowerCase());
    const row = { ...(saved || {}), Id: saved?.Id || canonicalSchoolBranchId(id || name), Name: name || saved?.Name || id };
    if (object && Object.hasOwn(object, 'SchoolSectionMode')) {
      const mode = clean(object.SchoolSectionMode).toLowerCase();
      if (mode && !normalizeSchoolSectionMode(mode)) throw Object.assign(new Error('Choose Primary/Nursery, Secondary or Mixed.'), { status: 400 });
      if (mode !== clean(saved?.SchoolSectionMode).toLowerCase()) {
        throw Object.assign(new Error('Branch terminology changed or was submitted through a profile save. Reload the online profile and use Save branch terminology.'), { status: 409 });
      }
      row.SchoolSectionMode = mode;
    }
    return row;
  }).filter((row) => row.Name);
  if (new Set(rows.map((row) => row.Id)).size !== rows.length) {
    throw Object.assign(new Error('Branch IDs must be unique.'), { status: 400 });
  }
  if (incoming.some((value) => typeof value === 'string') && existing.length
    && rows.some((row) => !previous.some((saved) => saved.Id === row.Id))
    && previous.some((saved) => !rows.some((row) => row.Id === saved.Id))) {
    throw Object.assign(new Error('Renaming branches requires their saved branch IDs. Load the online profile and edit branch names by ID, rather than replacing the comma-separated list.'), { status: 400 });
  }
  return rows;
}

export function withBranchSchoolSection(structure, update = {}) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw Object.assign(new Error('Choose a configured branch and school section type.'), { status: 400 });
  // A terminology update must not repair/reassign even a legacy active ID.
  const normalized = normalizeSchoolStructure({ ...structure, ActiveBranchId: '' });
  normalized.ActiveBranchId = canonicalSchoolBranchId(structure?.ActiveBranchId || normalized.ActiveBranchId);
  const id = canonicalSchoolBranchId(update.Id || update.id || '');
  const mode = clean(update.SchoolSectionMode).toLowerCase();
  if (!clean(update.Id || update.id) || !normalized.Branches.some((row) => row.Id === id)) {
    throw Object.assign(new Error('Choose a configured branch.'), { status: 400 });
  }
  if (mode && !normalizeSchoolSectionMode(mode)) {
    throw Object.assign(new Error('Choose Primary/Nursery, Secondary or Mixed.'), { status: 400 });
  }
  normalized.Branches = normalized.Branches.map((row) => row.Id === id ? { ...row, SchoolSectionMode: mode } : row);
  return normalized;
}

export async function saveBranchSchoolSection(env, update, updatedBy = '') {
  const existing = await getDocument(env, 'settings', 'schoolStructure');
  const structure = withBranchSchoolSection(existing || {}, update);
  await patchDocumentFields(env, 'settings', 'schoolStructure', {
    Branches: structure.Branches, UpdatedAt: new Date().toISOString(), UpdatedBy: clean(updatedBy)
  }, existing?.__updateTime ? { updateTime: existing.__updateTime } : { exists: false });
  invalidateSchoolStructureCache();
  return structure;
}
