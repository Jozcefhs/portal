import { getDocuments } from './firestore.js';
import { getSchoolStructure, scopedCollectionPath, schoolSectionFor } from './school-scope.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const internal = /\b(?:student|class|subject|arm|session|term)__[a-zA-Z0-9_.-]*[a-zA-Z0-9_-]/g;
const collections = {student:'academicStudentMemberships', class:'academicClasses',
  subject:'academicSubjects', arm:'academicArms', session:'academicSessions', term:'academicTerms'};
const recordName = row => clean(row?.Name || row?.DisplayName || row?.ApplicantName || row?.StudentName || row?.FullName
  || [row?.FirstName, row?.MiddleName, row?.Surname || row?.LastName].filter(Boolean).join(' '));
const fallback = id => {
  const kind = id.split('__')[0];
  const grade = id.match(/__(grade-\d+)$/i);
  return grade ? grade[1].replace('-', ' ').replace(/^g/, 'G')
    : `${kind[0].toUpperCase()}${kind.slice(1)} record (name unavailable)`;
};
const safeStudentId = value => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/-+/g, '-').slice(0,140);

// Enrich only references in the authorised, date-filtered batch. Never scan
// student/catalogue collections or rewrite immutable audit evidence.
export async function securityAuditDisplayLabels(env, rows, options = {}) {
  if (!rows.length) return rows;
  const db = {getDocuments, getSchoolStructure, ...options.db};
  const groups = new Map(), records = new Map(), labels = new Map();
  const idsByRow = new Map(rows.map(row => [row, [...new Set(
    [row.Subject, row.EntityId, row.Details, row.Summary, row.ActionContext].join(' ').match(internal) || [])]]));
  for (const ids of idsByRow.values()) for (const id of ids) {
    const collection = id.startsWith('class__') && id.includes('__arm_') ? 'academicArms' : collections[id.split('__')[0]];
    if (!groups.has(collection)) groups.set(collection, new Set());
    groups.get(collection).add(id);
  }
  await Promise.all([...groups].map(async ([collection, set]) => {
    const ids = [...set];
    try { (await db.getDocuments(env, collection, ids)).forEach((row, i) => { if (row) records.set(ids[i], row); }); }
    catch { /* Keep the audit usable; show an honest unavailable-name label. */ }
  }));
  const sameBranch = (record, row) => lower(record?.BranchId || 'main') === lower(row.BranchId || 'main');
  const students = new Map();
  for (const [row, ids] of idsByRow) for (const id of ids) {
    const record = records.get(id);
    if (!record || !sameBranch(record, row)) continue;
    if (!id.startsWith('student__')) { if (recordName(record)) labels.set(`${row.BranchId}|${id}`, recordName(record)); continue; }
    if (recordName(record)) { labels.set(`${row.BranchId}|${id}`, recordName(record)); continue; }
    const ref = clean(record.StudentRef || record.AdmissionNo);
    if (!ref) continue;
    const key = `${lower(row.BranchId || 'main')}|${schoolSectionFor(record)}|${ref}`;
    if (!students.has(key)) students.set(key, {ref, branch:row.BranchId || 'main', section:schoolSectionFor(record), targets:[]});
    students.get(key).targets.push(`${row.BranchId}|${id}`);
  }
  const studentGroups = new Map();
  for (const entry of students.values()) {
    const path = scopedCollectionPath('students', entry.branch, entry.section);
    if (!studentGroups.has(path)) studentGroups.set(path, []);
    studentGroups.get(path).push(entry);
  }
  await Promise.all([...studentGroups].map(async ([path, entries]) => {
    const ids = entries.map(entry => safeStudentId(entry.ref));
    let found = [];
    try { found = await db.getDocuments(env, path, ids); } catch {}
    const missing = entries.map((entry,i) => ({entry,i})).filter(({i}) => !found[i]);
    if (missing.length) try {
      const legacy = await db.getDocuments(env, 'students', missing.map(({entry}) => safeStudentId(entry.ref)));
      missing.forEach(({i}, j) => { found[i] = legacy[j]; });
    } catch {}
    entries.forEach((entry,i) => {
      const person = found[i];
      if (!person || lower(person.BranchId || 'main') !== lower(entry.branch) || schoolSectionFor(person) !== entry.section) return;
      const name = recordName(person);
      if (name) for (const key of entry.targets) labels.set(key, `${name} (${entry.ref})`);
    });
  }));
  let structure = {};
  try { structure = await db.getSchoolStructure(env); } catch {}
  return rows.map(row => {
    const display = text => clean(text).replace(internal, id => labels.get(`${row.BranchId}|${id}`) || fallback(id));
    const branch = (structure.Branches || []).find(branch => lower(branch.Id) === lower(row.BranchId || 'main'));
    return {...row, SubjectDisplay: display(row.Subject), EntityDisplay: display(row.EntityId),
      DetailsDisplay: display(row.Details), SummaryDisplay: display(row.Summary),
      BranchDisplay: branch?.Name || (lower(row.BranchId || 'main') === 'main' ? 'Main Branch' : 'Branch (name unavailable)')};
  });
}
