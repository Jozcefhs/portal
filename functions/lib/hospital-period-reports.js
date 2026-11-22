import { fail } from './hospital-model.js';
import { dateFilters, watDay } from './hospital-orders-model.js';

function waitingGroups(rows, snapshot) {
  const groups = new Map();
  for (const row of rows) {
    const label = row.Department || 'Unspecified department';
    const group = groups.get(label) || {label, measured:0, waiting:0, cancelled:0, unknown:0, totalMs:0, longestMs:0};
    groups.set(label, group);
    const start = Date.parse(row.CreatedAt);
    const end = Date.parse(row.QueueStartedAt);
    if (row.Status === 'Cancelled') group.cancelled++;
    else if (row.Status === 'Waiting' && !row.QueueStartedAt) group.waiting++;
    else if (['Completed','In progress'].includes(row.Status) && end >= start && end <= snapshot) {
      const duration = end - start;
      group.measured++;
      group.totalMs += duration;
      group.longestMs = Math.max(group.longestMs, duration);
    } else group.unknown++;
  }
  return [...groups.values()];
}

function revenueGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    // Each Hospital Invoice journal credits revenue once; a Hospital Credit debits it once.
    const value = row.TotalCredit;
    const cents = Math.round(value * 100);
    if (typeof value !== 'number' || !Number.isSafeInteger(cents) || value < 0 ||
        Math.abs(value - cents / 100) > 0.000001 || row.TotalDebit !== value || row.Currency !== 'NGN') {
      fail('A posted hospital journal needs finance review before this report can be totalled.', 409);
    }
    const group = groups.get(row.Date) || {label:row.Date, invoices:0, credits:0, billed:0, credited:0};
    if (row.Source === 'Hospital Invoice') {
      group.invoices++; group.billed += cents;
    } else if (row.Source === 'Hospital Credit') {
      group.credits++; group.credited += cents;
    } else fail('Unexpected journal source.', 409);
    groups.set(row.Date, group);
  }
  return [...groups.values()];
}

export function createPeriodReports({requireCapability, branch, workspaceId, clock, page, journalPage, eq}) {
  return async function hospitalPeriodReport(body) {
    const waiting = body.Report === 'waiting';
    if (!waiting && body.Report !== 'revenue') fail('Choose a hospital period report.');
    requireCapability(waiting ? 'visits.read' : 'billing.read');
    const dates = dateFilters(body.DateRange);
    const branchId = await branch(body);
    const now = clock();
    const readTime = body.Cursor ? body.ReadTime : now;
    const instant = Date.parse(readTime);
    if (!Number.isFinite(instant) || new Date(instant).toISOString() !== readTime ||
        instant > Date.parse(now) || Date.parse(now)-instant > 55*60000) fail('Refresh the report to start a new snapshot.',409);

    if (waiting) {
      const {rows,next} = await page('Visits',[eq('BranchId',branchId),...dates],'CreatedAt',body,
        {select:['CreatedAt','QueueStartedAt','Status','Department'],readTime});
      return {ok:true,groups:waitingGroups(rows,instant),count:rows.length,next,readTime};
    }
    const filters = [eq('WorkspaceId',workspaceId),eq('BranchId',branchId),eq('Status','Posted'),
      {field:'Source',op:'in',value:['Hospital Invoice','Hospital Credit']},
      {field:'Date',op:'>=',value:watDay(dates[0].value)},{field:'Date',op:'<',value:watDay(dates[1].value)}];
    const {rows,next} = await journalPage(filters,'Date',body,{select:['Date','Source','Currency','TotalDebit','TotalCredit'],readTime});
    return {ok:true,groups:revenueGroups(rows),count:rows.length,next,readTime};
  };
}
