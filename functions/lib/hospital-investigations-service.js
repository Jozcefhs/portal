import { clean, fail, id, digest, nameKey } from './hospital-model.js';
import { field, dateFilters } from './hospital-orders-model.js';

export function createHospitalInvestigationsService(ctx) {
  const { env, db, collection, capabilities, branch, clock, actor, condition, strip, eq, auditWrite, operation, page } = ctx;
  const can = capability => capabilities.includes(capability);
  function access(Kind, writing = false) {
    if (!['Laboratory', 'Imaging'].includes(Kind)) fail('Choose Laboratory or Imaging.');
    const worker = can(Kind === 'Laboratory' ? 'laboratory.work' : 'imaging.work');
    if (!(worker || can(Kind === 'Laboratory' ? 'laboratory.configure' : 'imaging.configure') || !writing && can('orders.read'))) fail('Your role does not permit this investigation catalogue operation.', 403);
  }
  const view = row => ({ ...strip(row), Revision: row.__updateTime });
  const write = (name, key, data, old) => ({ collectionPath: collection(name), documentId: key, data, currentDocument: condition(old) });
  return {
    async investigationCatalog(body) {
      access(body.Kind); const BranchId = await branch(body);
      const filters = [eq('BranchId', BranchId), eq('Kind', body.Kind)];
      if (body.IncludeInactive !== true) filters.push(eq('Active', true));
      const Query = nameKey(field(body, 'Query', 120));
      if (Query) filters.push({ field: 'SearchName', op: '>=', value: Query }, { field: 'SearchName', op: '<=', value: `${Query}\uf8ff` });
      const result = await page('InvestigationCatalog', filters, 'SearchName', body);
      // Configuration contains no patient data; paging it is not a clinical access event.
      return { ok: true, items: result.rows.map(view), next: result.next };
    },
    async saveInvestigationCatalogItem(body) {
      const Kind = field(body, 'Kind', 30, true); access(Kind, true); const BranchId = await branch(body);
      const input = body.Item || {}, Code = field(input, 'Code', 40, true).toUpperCase();
      if (input.Active !== undefined && typeof input.Active !== 'boolean') fail('Choose whether this service is available for new orders.');
      if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(Code)) fail('Use letters, numbers, hyphens or underscores for the permanent service code.');
      const fields = { Code, Kind, Name: field(input, 'Name', 200, true), Specimen: field(input, 'Specimen', 200, Kind === 'Laboratory'),
        Preparation: field(input, 'Preparation', 2000), Instructions: field(input, 'Instructions', 2000), Active: input.Active !== false };
      return operation(body, 'saveInvestigationCatalogItem', async key => {
        const CatalogId = await digest(JSON.stringify([BranchId, Kind, Code]));
        if (body.CatalogId && id(body.CatalogId) !== CatalogId) fail('The service code, type and branch cannot change. Create a separate catalogue item instead.', 409);
        const old = await db.getDocument(env, collection('InvestigationCatalog'), CatalogId);
        if (old && (!body.CatalogId || clean(body.Revision) !== old.__updateTime)) fail('This catalogue code already exists or changed. Load its current record before editing.', 409);
        if (!old && body.CatalogId) fail('This catalogue record is unavailable.', 404);
        if (old && Object.entries(fields).every(([name, value]) => old[name] === value)) return { writes: [], result: { CatalogId, Unchanged: true, item: view(old) } };
        const Reason = old ? field(body, 'Reason', 1000, true) : '';
        const row = { CatalogId, BranchId, ...fields, SearchName: nameKey(fields.Name), VersionId: key,
          CreatedAt: old?.CreatedAt || clock(), UpdatedAt: clock(), UpdatedBy: actor };
        return { writes: [write('InvestigationCatalog', CatalogId, row, old),
          write('InvestigationCatalogVersions', key, { ...row, CreatedAt: clock(), Reason }, null),
          auditWrite(key, old ? 'Update investigation catalogue' : 'Create investigation catalogue item', BranchId, {}, { ServiceCode: Code, ServiceName: fields.Name, Kind })],
        result: { CatalogId } };
      });
    },
    async investigationCatalogHistory(body) {
      const filters = dateFilters(body.DateRange); const BranchId = await branch(body);
      const row = await db.getDocument(env, collection('InvestigationCatalog'), id(body.CatalogId));
      if (!row || row.BranchId !== BranchId) fail('This catalogue record is unavailable in this branch.', 404);
      access(row.Kind);
      const result = await page('InvestigationCatalogVersions', [eq('CatalogId', row.CatalogId), ...filters], 'CreatedAt', body);
      return { ok: true, versions: result.rows.map(view), next: result.next };
    }
  };
}
