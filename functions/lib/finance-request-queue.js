import { queryCollection } from './firestore.js';
import { createSnapshotBranchPlanner } from './branch-reads.js';
import { historyDateRange, historyQueryOptions } from './history-date-range.js';

export const FINANCE_QUEUES = Object.freeze({requisitions:'accountingExpenses', bills:'accountingSupplierBills', imprests:'accountingImprests'});
const closed = ['Posted','Paid','Processed','Retired','Closed','Cancelled','Canceled','Voided','Completed'];
const terminalStatuses = kind => [...closed.filter(s=>kind!=='bills'||s!=='Posted'), ...(kind==='imprests'?['Rejected']:[])];
const clean = value => String(value ?? '').trim();
const branchReadPlan = createSnapshotBranchPlanner();
export function completedFinanceRequest(kind, row) {
  return terminalStatuses(kind).some(value => value.toLowerCase() === clean(row.Status).toLowerCase());
}

// Read a bounded queue, never the complete financial history. The caller's
// existing branch, section and officer permissions remain authoritative.
export async function financeRequestPage(env, user, kind, body = {}, visible = rows => rows, overrides = {}) {
  const db = {queryCollection, branchReadPlan, now:()=>new Date().toISOString(), ...overrides};
  const collection = Object.hasOwn(FINANCE_QUEUES,kind) ? FINANCE_QUEUES[kind] : '';
  if (!collection) throw Object.assign(new Error('Choose a valid request queue.'), {status:400});
  const range = body.HistoryDateRange || {}, view = range.view || (range.fromDate || range.toDate ? 'completed' : 'pending');
  if (!['pending','completed'].includes(view)) throw Object.assign(new Error('Choose open requests or completed history.'), {status:400});
  const dates = view === 'completed' ? historyDateRange(range) : {};
  const branch = clean(user.branchId).toLowerCase(), field = view === 'pending' ? 'Status' : 'Date';
  const scope = JSON.stringify([collection,branch,user.username,user.role,user.assignedRole,user.department,user.schoolSectionAccess,view,dates]);
  let cursor;
  if (body.QueueCursor) {
    try {cursor = JSON.parse(body.QueueCursor);} catch { /* rejected below */ }
    if (cursor?.scope !== scope || !Number.isFinite(Date.parse(cursor.readTime)) || typeof cursor.value !== 'string'
      || typeof cursor.name !== 'string' || !cursor.name.includes(`/documents/${collection}/`)
      || Date.parse(db.now()) - Date.parse(cursor.readTime) > 55*60*1000 || Date.parse(cursor.readTime)>Date.parse(db.now())) {
      throw Object.assign(new Error('This request page has expired or belongs to another view. Refresh requests.'), {status:400});
    }
  }
  const readTime = cursor?.readTime || db.now();
  const plan = await db.branchReadPlan(env, collection, branch, {readTime});
  if (plan.mode === 'empty') return {rows:[],next:'',view};
  const terminal = terminalStatuses(kind);
  const values = view === 'pending' ? terminal : [...new Set(terminal.flatMap(s=>[s,s.toLowerCase(),s.toUpperCase()]))];
  const filters = [ ...(plan.mode === 'indexed' ? [{field:'BranchId',op:'==',value:branch}] : []),
    {field:'Status',op:view === 'pending' ? 'not-in' : 'in',value:values},
    ...(view === 'completed' ? historyQueryOptions(dates,'Date').filters : []) ];
  const rows = []; let next = '', scanned = 0;
  do {
    const batch = await db.queryCollection(env, collection, {filters, readTime, orderBy:[{field},{field:'__name__'}], limit:51,
      ...(cursor ? {startAfterName:cursor.name,startAfterFieldValue:cursor.value} : {})});
    const page = batch.slice(0,50); scanned += page.length;
    const permitted = new Set(visible(page));
    let consumed = 0;
    for (const row of page) {consumed++; if (permitted.has(row) && completedFinanceRequest(kind,row) === (view === 'completed')) rows.push(row); if(rows.length===50)break;}
    const last = page[consumed-1];
    const more = consumed < page.length || batch.length > 50;
    if (more && (!last?.__name || typeof last[field] !== 'string')) throw new Error('The request queue cursor is missing. Refresh requests.');
    cursor = more ? {scope,readTime,name:last.__name,value:last[field]} : null;
    next = cursor ? JSON.stringify(cursor) : '';
  } while (next && rows.length<50 && scanned<250);
  return {rows,next,view};
}
