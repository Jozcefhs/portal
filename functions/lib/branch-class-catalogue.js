import { getDocument, queryCollectionPages } from './firestore.js';
import { safeScopeId, schoolSectionFor } from './school-scope.js';
import { normalizeClassKey } from './class-names.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const active = row => !['archived', 'inactive', 'disabled', 'deleted'].includes(lower(row.Status));
const dataOnly = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
const defaults = { getDocument, queryCollectionPages };

export function branchClassNameKey(name) { return normalizeClassKey(name); }
export function branchArmNameKey(name) { return lower(name).replace(/\s+/g, ' '); }

function selectedBranch(value) {
  const branchId = clean(value);
  if (!branchId || lower(branchId) === 'all') {
    throw Object.assign(new Error('Select one branch to load its classes and arms.'), { status: 400 });
  }
  return safeScopeId(branchId);
}

export async function readBranchClassCatalogueRevision(env, branchId, overrides = {}) {
  return ({ ...defaults, ...overrides }).getDocument(env, 'branchSchoolSettings', selectedBranch(branchId));
}

// Every academic structure mutation takes this guard BEFORE reading its working
// snapshot, then commits it alongside the changed definitions. Readers do not write.
export function branchClassCatalogueRevisionWrite(branchId, snapshot, actor = 'Academic Management', timestamp = new Date().toISOString()) {
  if (snapshot && !clean(snapshot.__updateTime)) throw new Error('The class catalogue revision is missing. Reload before saving.');
  return {
    collectionPath: 'branchSchoolSettings', documentId: selectedBranch(branchId),
    ...(snapshot ? { updateTime: snapshot.__updateTime } : { exists: false }),
    data: { ...dataOnly(snapshot), BranchId: selectedBranch(branchId), ClassSetupMode: 'academic',
      ClassCatalogueRevision: crypto.randomUUID(), UpdatedAt: timestamp,
      UpdatedBy: typeof actor === 'string' ? actor : clean(actor.displayName || actor.username) || 'Academic Management' }
  };
}

export function projectBranchClassCatalogue(classRows = [], armRows = [], options = {}) {
  const branchId = selectedBranch(options.branchId || options.BranchId);
  const section = lower(options.section || options.SchoolSection);
  const classes = classRows.filter(row => lower(row.BranchId) === branchId)
    .filter(row => !section || section === 'all' || schoolSectionFor({ ...row, ClassName: row.Name }) === section)
    .filter(row => options.includeInactive !== false || active(row))
    .map(row => {
      const classId = clean(row.ClassId || row.RecordId || row.__id);
      const arms = armRows.filter(arm => lower(arm.BranchId) === branchId && clean(arm.ClassId) === classId && active(arm))
        .sort((a, b) => Number(a.SortOrder || 100) - Number(b.SortOrder || 100)
          || clean(a.Name).localeCompare(clean(b.Name), undefined, { numeric: true, sensitivity: 'base' }));
      return {
        ClassName: clean(row.Name || row.ClassName), Arms: [...new Set(arms.map(arm => clean(arm.Name)))].join(', '),
        Active: active(row) ? 'YES' : 'NO', SortOrder: Number(row.SortOrder || 100),
        BranchId: branchId, SchoolSection: schoolSectionFor({ ...row, ClassName: row.Name }),
        SchoolStage: clean(row.SchoolStage), AcademicClassId: classId, ClassId: classId,
        LegacyDocumentId: clean(row.LegacyDocumentId),
        RevisionToken: clean(row.__updateTime),
        ArmRecords: arms.map(arm => ({ ArmId: clean(arm.ArmId || arm.RecordId || arm.__id),
          Name: clean(arm.Name), RevisionToken: clean(arm.__updateTime) }))
      };
    }).sort((a, b) => a.SortOrder - b.SortOrder || a.ClassName.localeCompare(b.ClassName, undefined, { numeric: true, sensitivity: 'base' }));
  return classes;
}

// This is the only operational Settings catalogue. Organisation defaults and
// retired branch-schoolClasses snapshots are not silently merged back in: doing
// that would resurrect classes or arms removed in Academic Management.
export async function getBranchClassCatalogue(env, options = {}, overrides = {}) {
  const db = { ...defaults, ...overrides };
  const branchId = selectedBranch(options.branchId || options.BranchId);
  const filters = [{ field: 'BranchId', op: '==', value: branchId }];
  const metadata = options.metadata !== undefined ? options.metadata : await db.getDocument(env, 'branchSchoolSettings', branchId);
  const [classes, arms] = await Promise.all([
    db.queryCollectionPages(env, 'academicClasses', { filters, maxRows: 1000, pageSize: 250 }),
    options.includeArms === false ? [] : db.queryCollectionPages(env, 'academicArms', { filters, maxRows: 5000, pageSize: 500 })
  ]);
  return { classes: projectBranchClassCatalogue(classes, arms, { ...options, branchId }),
    catalogueRevision: clean(metadata?.ClassCatalogueRevision), canonicalSource: 'academic' };
}
