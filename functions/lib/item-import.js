import { batchCommitDocuments, getDocument, listCollection, queryCollection } from './firestore.js';
import { enforceActorBranch } from './branch-scope.js';
import { schoolSectionFor } from './school-scope.js';
import { requireSchoolLibraryAccess } from './school-library.js';
import { categoryApplies, categoryKey } from './store-categories.js';
import { canonicalConfiguredClass } from './class-names.js';
import { ITEM_IMPORT_LIMITS, ITEM_IMPORT_MODULES, normalizeItemImportRow, duplicateItemImportRows, itemImportKey } from '../../js/item-import-csv.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const safeId = value => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
const collections = { clinic: 'clinicInventory', kitchen: 'kitchenInventory', bookstore: 'storeItems', uniformStore: 'storeItems', library: 'libraryCopies' };
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
function requireAccess(user, section) {
  if (!Object.hasOwn(ITEM_IMPORT_MODULES, section) || !(user.allowedSections || []).includes(section)) throw fail('This item module is not enabled for your account.', 403);
  if (user.subscriptionActive === false || user.subscriptionReadOnly === true) throw fail('Item imports are read-only until the subscription is renewed.', 403);
  if (section === 'library') requireSchoolLibraryAccess(user, true);
}

export async function handleItemImport(env, user, body) {
  const section = clean(body.section), action = clean(body.action);
  requireAccess(user, section);
  if (!['preview', 'import'].includes(action)) throw fail('Choose preview or import.');
  if (!Array.isArray(body.Rows) || !body.Rows.length || body.Rows.length > ITEM_IMPORT_LIMITS.batch) throw fail('Send 1–20 item rows per batch.');
  const branchId = enforceActorBranch(user, body.BranchId, '', 'main');
  if (!/^[a-z0-9._-]{1,80}$/.test(branchId)) throw fail('Choose a valid branch.');
  const edition = lower(user.edition || user.OrganisationEdition) || 'school';
  const defaultSection = ['primary', 'secondary'].includes(lower(user.schoolSectionAccess)) ? clean(user.schoolSectionAccess) : 'Secondary';
  const normalized = body.Rows.map(raw => normalizeItemImportRow(raw, section));
  for (const { row, errors } of normalized) if (section !== 'library') {
    row.SchoolSection ||= defaultSection;
    row.SchoolSection = lower(row.SchoolSection) === 'primary' ? 'Primary' : 'Secondary';
    if (['primary', 'secondary'].includes(lower(user.schoolSectionAccess)) && lower(row.SchoolSection) !== lower(user.schoolSectionAccess)) errors.push('This row is outside your permitted school section.');
  }
  const duplicates = duplicateItemImportRows(normalized.map(({ row }) => row), section, defaultSection);
  for (const { row, errors } of normalized) if (duplicates.has(row.RowNumber)) errors.push('Duplicate item in this batch. Keep one row per item / barcode.');
  const actor = clean(user.username), PreviewDigest = await digest({ section, branchId, edition, actor, rows: normalized.map(value => value.row) });
  let batchId = '';
  if (action === 'import') {
    if (body.Confirmed !== true || clean(body.PreviewDigest) !== PreviewDigest) throw fail('Preview these rows and confirm them before importing.', 409);
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(clean(body.RequestId))) throw fail('A unique import request ID is required.');
    batchId = await digest({ actor, branchId, section, request: body.RequestId });
    const previous = await getDocument(env, 'itemImportBatches', batchId);
    if (previous) {
      if (previous.PreviewDigest !== PreviewDigest) throw fail('This request ID belongs to a different import.', 409);
      return { ...previous.Result, replayed: true };
    }
  }
  const rows = section === 'library'
    ? await queryCollection(env, collections[section], { filters: [{ field: 'BranchId', op: '==', value: branchId }] })
    : (await listCollection(env, collections[section])).filter(row => lower(row.BranchId || 'main') === branchId && (!row.OrganisationEdition || lower(row.OrganisationEdition) === edition));
  const storeType = section === 'uniformStore' ? 'Uniform Store' : 'Bookstore';
  const titles = section === 'library' ? await queryCollection(env, 'libraryTitles', { filters: [{ field: 'BranchId', op: '==', value: branchId }] }) : [];
  const categories = ['bookstore', 'uniformStore'].includes(section) ? await listCollection(env, 'storeCategories') : [];
  const classes = ['bookstore', 'uniformStore'].includes(section) ? await listCollection(env, 'settings/academics/classes') : [];
  const writes = new Map(), views = [], timestamp = new Date().toISOString();
  const add = (collectionPath, documentId, data) => writes.set(`${collectionPath}/${documentId}`, { collectionPath, documentId, data, exists: false });
  for (const { row, errors } of normalized) {
    const view = { RowNumber: row.RowNumber, ItemName: row.ItemName || row.Title, Reference: row.ItemCode || row.Barcode || row.ItemName, Quantity: section === 'library' ? 1 : row.Quantity, SchoolSection: row.SchoolSection || '', Errors: errors, Status: 'Create' };
    views.push(view);
    if (errors.length) { view.Status = 'Error'; continue; }
    if (section === 'library') {
      const isbn = lower(row.ISBN).replace(/[\s-]/g, '');
      const titleKey = itemImportKey(`${row.Title}|${row.Author}`);
      const matches = titles.filter(title => isbn ? lower(title.ISBN).replace(/[\s-]/g, '') === isbn : itemImportKey(`${title.Title}|${title.Author}`) === titleKey);
      if (matches.length > 1 || (matches[0] && (itemImportKey(matches[0].Title) !== itemImportKey(row.Title) || (row.Author && matches[0].Author && itemImportKey(matches[0].Author) !== itemImportKey(row.Author))))) { errors.push('Ambiguous or conflicting book title / ISBN. Review the catalogue first.'); view.Status = 'Error'; continue; }
      const TitleId = matches[0]?.TitleId || `LIB-IMPORT-${await digest({ branchId, title: isbn || titleKey })}`;
      const CopyId = `${branchId}--${row.Barcode}`;
      const existing = rows.find(copy => lower(copy.Barcode) === lower(row.Barcode) || copy.CopyId === CopyId || copy.__id === CopyId);
      if (existing) {
        if (existing.TitleId !== TitleId) { errors.push('This barcode already belongs to a different book.'); view.Status = 'Error'; }
        else view.Status = 'Skip existing';
        continue;
      }
      if (!matches.length) {
        const title = { TitleId, BranchId: branchId, Title: row.Title, Author: row.Author, ISBN: row.ISBN, Publisher: row.Publisher, Category: row.Category, RecommendedClass: row.RecommendedClass, Description: row.Description, CreatedAt: timestamp, UpdatedAt: timestamp };
        add('libraryTitles', TitleId, title); titles.push(title);
      }
      add('libraryCopies', CopyId, { CopyId, TitleId, Title: row.Title, BranchId: branchId, Barcode: row.Barcode, Shelf: row.Shelf, Condition: row.Condition, Status: 'Available', AcquiredAt: row.AcquiredAt, CreatedAt: timestamp, UpdatedAt: timestamp });
    } else {
      const store = ['bookstore', 'uniformStore'].includes(section);
      const existing = rows.find(item => schoolSectionFor(item) === lower(row.SchoolSection) && (!store || item.StoreType === storeType) && itemImportKey(store ? item.ItemCode : item.ItemName) === itemImportKey(store ? row.ItemCode : row.ItemName));
      if (existing) { view.Status = 'Skip existing'; continue; }
      const scope = { BranchId: branchId, SchoolSection: row.SchoolSection, OrganisationEdition: edition };
      let data, documentId;
      if (store) {
        const category = categories.find(value => categoryApplies(value, storeType) && categoryKey(value.Name) === categoryKey(row.Category) && clean(value.Active || 'YES') !== 'NO');
        data = { ...scope, StoreType: storeType, ItemCode: row.ItemCode, ItemName: row.ItemName, Category: category?.Name || row.Category, CategoryId: category?.CategoryId || '', Size: row.Size, Gender: row.Gender, ClassName: canonicalConfiguredClass(row.ClassName, classes), Price: row.Price, Quantity: row.Quantity, Active: row.Active, UpdatedAt: timestamp, UpdatedBy: user.displayName || actor };
        documentId = safeId(`${storeType}-${row.ItemCode}-${branchId}-${row.SchoolSection}`);
      } else {
        data = { ...scope, ItemName: row.ItemName, Category: row.Category, Unit: row.Unit, Quantity: row.Quantity, ReorderLevel: row.ReorderLevel, Notes: row.Notes, Price: 0, Active: '', LastUpdated: timestamp, UpdatedBy: user.displayName || actor };
        documentId = safeId(`${branchId}-${row.SchoolSection}-${row.ItemName}`);
      }
      // Use the established single-item ID so both entry paths collide safely.
      if (writes.has(`${collections[section]}/${documentId}`)) { errors.push('Two item names resolve to the same stock identity. Use distinct names.'); view.Status = 'Error'; continue; }
      add(collections[section], documentId, data);
    }
  }
  const valid = views.every(row => !row.Errors.length);
  const result = { ok: true, valid, PreviewDigest, rows: views, created: views.filter(row => row.Status === 'Create').length, skipped: views.filter(row => row.Status === 'Skip existing').length };
  if (action === 'preview') return result;
  if (!valid) throw fail('Correct all highlighted rows before importing. Nothing in this batch was saved.');
  result.message = `Complete: ${result.created} items added, ${result.skipped} existing items kept unchanged.`;
  add('itemImportBatches', batchId, { BranchId: branchId, SchoolSection: defaultSection, Section: section, ActorUsername: actor, Action: 'Batch item import', Timestamp: timestamp, PreviewDigest, Result: result });
  if (section === 'library') add('libraryAudit', `LIB-AUD-IMPORT-${batchId}`, { AuditId: `LIB-AUD-IMPORT-${batchId}`, BranchId: branchId, Actor: user.displayName || actor, ActorUsername: actor, ActorRole: user.assignedRole || user.role, Action: 'Batch import physical copies', Timestamp: timestamp, Details: { Created: result.created, Skipped: result.skipped, ImportId: batchId } });
  try { await batchCommitDocuments(env, [...writes.values()]); }
  catch (error) {
    if ([409, 412].includes(Number(error.status))) {
      const saved = await getDocument(env, 'itemImportBatches', batchId);
      if (saved?.PreviewDigest === PreviewDigest) return { ...saved.Result, replayed: true };
      throw fail('Stock changed during import. Preview again; existing items will not be overwritten.', 409);
    }
    throw error;
  }
  return result;
}
