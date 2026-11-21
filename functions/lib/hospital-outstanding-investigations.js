import { fail } from './hospital-model.js';
import { dateFilters } from './hospital-orders-model.js';

const departments = ['Laboratory', 'Imaging'];
const stages = {
  Requested: 'Requested',
  'Specimen rejected': 'Recollection needed',
  'Specimen collected': 'Specimen collected',
  'Specimen received': 'Specimen received',
  'Result draft': 'Awaiting verification',
  Verified: 'Awaiting release'
};

export function createInvestigationReport({ capabilities, branch, clock, page, eq, auditRead }) {
  const has = name => capabilities.includes(name);
  const details = kind => has('orders.read') || has(kind.toLowerCase() + '.work');
  const allowed = departments.filter(kind => details(kind) || has(kind.toLowerCase() + '.configure'));
  return async function getOutstandingInvestigations(body) {
    const selected = body.Kind === 'All' ? allowed : [body.Kind];
    if (!selected.length || selected.some(kind => !allowed.includes(kind))) fail('This investigation department is outside your access.', 403);
    const allDates = body.AllOrderDates === true;
    if (allDates && body.DateRange != null) fail('Choose either all order dates or a date range.');
    const dates = allDates ? [] : dateFilters(body.DateRange);
    const branchId = await branch(body);
    const now = Date.parse(clock());
    const readTime = body.Cursor ? body.ReadTime : new Date(now).toISOString();
    const time = Date.parse(readTime);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== readTime || time > now || now-time > 55*60000) {
      fail('This report snapshot has expired. Refresh the report to continue.', 409);
    }
    const kindFilter = selected.length === 1 ? eq('Kind', selected[0]) : { field:'Kind', op:'in', value:selected };
    const select = ['Kind', 'Status', 'CreatedAt', 'Fields.Priority'];
    if (selected.some(details)) select.push('OrderNumber', 'Fields.Service', 'PatientName', 'HospitalNumber', 'EmergencyReference');
    const outstanding = {field:'Status', op:'in', value:Object.keys(stages)};
    const { rows, next } = await page('Orders', [eq('BranchId', branchId), kindFilter, outstanding, ...dates], 'CreatedAt', body, { select, readTime });
    const counts = new Map(), orders = [];
    for (const row of rows) {
      const stage = stages[row.Status];
      const key = row.Kind + '/' + stage;
      const group = counts.get(key) || { kind:row.Kind, stage, count:0, urgent:0 };
      group.count++;
      const urgent = row.Fields?.Priority === 'Urgent';
      if (urgent) group.urgent++;
      counts.set(key, group);
      if (details(row.Kind)) orders.push({ id:row.__id, number:row.OrderNumber || row.__id, patient:row.PatientName || '',
        reference:row.EmergencyReference || row.HospitalNumber || '', kind:row.Kind, stage,
        service:row.Fields?.Service || '', created:row.CreatedAt, urgent });
    }
    if (orders.length) await auditRead(body, 'View outstanding investigation worklist', branchId, {}, { ResultCount:orders.length, Departments:selected.join(', ') });
    return { ok:true, departments:selected, summaryOnly:selected.filter(kind => !details(kind)), groups:[...counts.values()], orders, next, readTime };
  };
}
