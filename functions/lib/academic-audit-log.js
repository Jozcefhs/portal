import { queryCollection } from './firestore.js';
import { securityAuditDisplayLabels } from './security-audit-labels.js';

const clean = value => String(value ?? '').trim();
const fail = message => Object.assign(new Error(message), {status:400, code:'ACADEMIC_AUDIT_FILTER_INVALID'});
const COLLECTION = 'academicManagementAudit';
export function academicAuditPeriod(input = {}) {
  const from = clean(input.FromDate), to = clean(input.ToDate);
  for (const date of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date) throw fail('Choose valid From and To dates before loading academic history.');
  }
  if (from > to) throw fail('The From date must not be after the To date.');
  return {from, to, start:new Date(`${from}T00:00:00+01:00`).toISOString(), end:new Date(`${to}T23:59:59.999+01:00`).toISOString()};
}

// Permission and scope are supplied only by the checked Academic Management
// handler. One explicit page, never a scan or a write on opening the module.
export async function loadAcademicAuditLog(env, scope, input = {}, dependencies = {}) {
  const db = {queryCollection, securityAuditDisplayLabels, ...dependencies};
  const period = academicAuditPeriod(input);
  const context = [scope.branchId, scope.section, period.from, period.to].join('|');
  const cursor = input.Cursor;
  if (cursor && (cursor.context !== context
    || !/^projects\/[^/]+\/databases\/[^/]+\/documents\/academicManagementAudit\/[^/]+$/.test(clean(cursor.name))
    || !Number.isFinite(Date.parse(cursor.timestamp)) || cursor.timestamp < period.start || cursor.timestamp > period.end)) {
    throw fail('The audit page does not match these dates and branch. Load the first page again.');
  }
  const raw = await db.queryCollection(env, COLLECTION, {
    filters:[{field:'BranchId',op:'==',value:scope.branchId},
      {field:'Timestamp',op:'>=',value:period.start},{field:'Timestamp',op:'<=',value:period.end}],
    orderBy:[{field:'Timestamp',direction:'DESCENDING'},{field:'__name__',direction:'DESCENDING'}], limit:51,
    ...(cursor ? {startAfterName:cursor.name,startAfterFieldValue:cursor.timestamp} : {})
  });
  const page = raw.slice(0,50);
  const configuredSections = [...new Set((scope.structure?.Sections || []).filter(value => ['primary','secondary'].includes(value)))];
  const sectionFor = row => ['primary','secondary'].includes(clean(row.SchoolSection).toLowerCase())
    ? clean(row.SchoolSection).toLowerCase() : configuredSections.length === 1 ? configuredSections[0] : 'secondary';
  const visible = page.filter(row => row.BranchId === scope.branchId && sectionFor(row) === scope.section);
  const rows = await db.securityAuditDisplayLabels(env, visible.map(row => ({
    AuditId:row.AuditId || row.__id, Timestamp:row.Timestamp, Action:row.Action, RecordType:row.RecordType,
    Subject:row.RecordLabel || row.RecordId, EntityId:row.RecordId, StudentRef:row.StudentRef || '',
    BranchId:row.BranchId, SchoolSection:sectionFor(row), Actor:row.Actor || row.ActorUsername,
    Details:row.Details, Summary:row.Summary
  })));
  const last = page.at(-1);
  return {ok:true, academicAudit:{rows, from:period.from, to:period.to, scanned:page.length,
    nextCursor:raw.length > 50 && last ? {context,name:last.__name,timestamp:last.Timestamp} : null}};
}
