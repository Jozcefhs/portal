import { clean, fail, id, digest, nameKey } from './hospital-model.js';
import { field, medicine, dateFilters } from './hospital-orders-model.js';

// Medicine identity is permanent: changing a strength/unit must never reinterpret stock.
export async function medicineCatalogSnapshot(body, details, BranchId, read) {
  if (!body.MedicineCatalogId) return null;
  const item = await read('MedicineCatalog', id(body.MedicineCatalogId));
  if (!item || item.BranchId !== BranchId || !item.Active) fail('This medicine catalogue item is unavailable. Reload the catalogue.', 409);
  if (body.MedicineCatalogRevision !== item.__updateTime) fail('The medicine catalogue changed. Reload it before continuing.', 409);
  if (['Medicine', 'Strength', 'Form', 'Unit'].some(key => item[key] !== details[key])) fail('The medicine details differ from the selected catalogue item. Reselect it or choose manual entry.', 409);
  return Object.fromEntries(['CatalogId', 'VersionId', 'Code', 'Medicine', 'Strength', 'Form', 'Unit', 'HandlingNotes'].map(key => [key, item[key]]));
}

export function createHospitalMedicinesService(ctx) {
  const { env, db, collection, capabilities, branch, clock, actor, condition, strip, eq, auditWrite, operation, page } = ctx;
  const can = capability => capabilities.includes(capability);
  function access(writing = false) {
    if (!(can('pharmacy.work') || can('pharmacy.configure') || !writing && can('orders.read'))) fail('Your role does not permit this medicine catalogue operation.', 403);
  }
  const view = row => ({ ...strip(row), Revision: row.__updateTime });
  const read = (name, key) => db.getDocument(env, collection(name), key);
  const write = (name, key, data, old) => ({ collectionPath: collection(name), documentId: key, data, currentDocument: condition(old) });
  return {
    async medicineCatalog(body) {
      access(); const BranchId = await branch(body), filters = [eq('BranchId', BranchId)];
      if (body.IncludeInactive !== true) filters.push(eq('Active', true));
      const Query = nameKey(field(body, 'Query', 120));
      if (Query) filters.push({ field: 'SearchName', op: '>=', value: Query }, { field: 'SearchName', op: '<=', value: `${Query}\uf8ff` });
      const result = await page('MedicineCatalog', filters, 'SearchName', body);
      return { ok: true, items: result.rows.map(view), next: result.next };
    },
    async saveMedicineCatalogItem(body) {
      access(true); const BranchId = await branch(body), input = body.Item || {};
      const Code = field(input, 'Code', 40, true).toUpperCase(), details = await medicine(input);
      if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(Code)) fail('Use letters, numbers, hyphens or underscores for the permanent medicine code.');
      if (input.Active !== undefined && typeof input.Active !== 'boolean') fail('Choose whether this medicine is available for new use.');
      const fields = { Code, ...details, HandlingNotes: field(input, 'HandlingNotes', 2000), Active: input.Active !== false };
      return operation(body, 'saveMedicineCatalogItem', async key => {
        const CatalogId = await digest(JSON.stringify([BranchId, Code]));
        if (body.CatalogId && id(body.CatalogId) !== CatalogId) fail('The medicine code and branch cannot change.', 409);
        const old = await read('MedicineCatalog', CatalogId);
        if (old && (!body.CatalogId || clean(body.Revision) !== old.__updateTime)) fail('This medicine code already exists or changed. Load its current record before editing.', 409);
        if (!old && body.CatalogId) fail('This medicine catalogue record is unavailable.', 404);
        if (old && ['Medicine', 'Strength', 'Form', 'Unit'].some(name => old[name] !== fields[name])) fail('Medicine name, strength, form and dispensing unit are permanent. Create a separate item for a different medicine identity.', 409);
        if (old && Object.entries(fields).every(([name, value]) => old[name] === value)) return { writes: [], result: { CatalogId, Unchanged: true, item: view(old) } };
        const identityWrites = [];
        if (!old) {
          const identityId = await digest(JSON.stringify([BranchId, details.MedicineKey]));
          if (await read('MedicineCatalogIdentities', identityId)) fail('This medicine, strength, form and unit already have a catalogue entry. Load that entry, including inactive medicines.', 409);
          identityWrites.push(write('MedicineCatalogIdentities', identityId, { BranchId, CatalogId, MedicineKey: details.MedicineKey }, null));
        }
        const Reason = old ? field(body, 'Reason', 1000, true) : '';
        const row = { CatalogId, BranchId, ...fields, SearchName: nameKey(fields.Medicine), VersionId: key,
          CreatedAt: old?.CreatedAt || clock(), UpdatedAt: clock(), UpdatedBy: actor };
        return { writes: [write('MedicineCatalog', CatalogId, row, old), ...identityWrites,
          write('MedicineCatalogVersions', key, { ...row, CreatedAt: clock(), Reason }, null),
          auditWrite(key, old ? 'Update medicine catalogue' : 'Create medicine catalogue item', BranchId, {}, { MedicineCode: Code, Medicine: fields.Medicine })], result: { CatalogId } };
      });
    },
    async medicineCatalogHistory(body) {
      access(); const filters = dateFilters(body.DateRange), BranchId = await branch(body);
      const row = await read('MedicineCatalog', id(body.CatalogId));
      if (!row || row.BranchId !== BranchId) fail('This medicine is unavailable in this branch.', 404);
      const result = await page('MedicineCatalogVersions', [eq('CatalogId', row.CatalogId), ...filters], 'CreatedAt', body);
      return { ok: true, versions: result.rows.map(view), next: result.next };
    }
  };
}
