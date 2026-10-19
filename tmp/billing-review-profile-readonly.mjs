// Diagnostic only: projected student identity/revision reads, never financial writes.
import { createRequire } from 'node:module';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { selectStudentBillingProfiles, studentBillingIdentity, studentProfileValue } from '../functions/lib/student-billing-profile.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), { requireAuth } = require('./requireAuth.js'), { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Firebase CLI sign-in required.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
const paths = ['students', 'schoolBranches/main/sections/secondary/students', 'schoolBranches/main/sections/primary/students'];
const fields = ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef', 'BranchId', 'branchId', 'SchoolSection',
  'ClassName', 'className', 'ClassAdmitted', 'classAdmitted', 'ProfileCompletionStatus', 'profileCompletionStatus',
  'UpdatedAt', 'updatedAt', 'ParentOnboardingProfileCompletedAt'];
const keys = ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef'];
const referenceFor = (row) => studentProfileValue(row, 'AdmissionNo', ['admissionNo', 'AccountRef', 'accountRef', '__id']);
const permitted = (row) => studentBillingIdentity(row).branch === 'main';
async function query(path, filters = [], limit = 3000) {
  const { endpoint, structuredQuery } = buildStructuredQuery(path, { limit, select: fields, filters });
  if (!endpoint.endsWith(':runQuery')) throw new Error('Only read queries are allowed.');
  const response = await client.post(`/projects/${project}/databases/(default)/documents/${endpoint}`, { structuredQuery }, { resolveOnHTTPError: true });
  const entries = Array.isArray(response.body) ? response.body : [response.body];
  if (response.status >= 400 || entries.some((row) => row.error)) throw new Error(`Read failed (${response.status}).`);
  const rows = entries.flatMap((row) => row.document ? [{ ...firestoreDocumentToObject(row.document), __scopePath: path }] : []);
  if (rows.length >= limit) throw new Error('Query reached its limit; partial results rejected.');
  return rows;
}
const raw = (await Promise.all(paths.map((path) => query(path)))).flat();
const roster = selectStudentBillingProfiles(raw).filter(permitted);
const complete = roster.filter((row) => String(row.ProfileCompletionStatus || '').trim().toLowerCase() === 'complete');
const mismatches = [];
for (const row of complete) {
  const reference = referenceFor(row);
  const candidates = selectStudentBillingProfiles(raw.filter((item) => keys.some((key) => item[key] === reference)))
    .filter(permitted).filter((item) => studentBillingIdentity(item).reference === reference.toLowerCase());
  if (candidates.length !== 1 || candidates[0].__updateTime !== row.__updateTime ||
      String(candidates[0].ProfileCompletionStatus || '').trim().toLowerCase() !== 'complete') {
    mismatches.push({ reference, path: row.__scopePath, id: row.__id, revision: row.__updateTime,
      exactLookupMatches: candidates.length, selectedRevision: candidates[0]?.__updateTime || '',
      storedReferences: Object.fromEntries(keys.filter((key) => Object.hasOwn(row, key)).map((key) => [key, row[key]])) });
  }
}
// Confirm any deterministic mismatch against the same exact-match queries used
// by the review, instead of inferring it solely from the initial roster read.
for (const item of mismatches.slice(0, 5)) {
  const queried = (await Promise.all(paths.flatMap((path) => keys.map((field) => query(path, [{ field, op: 'in', value: [item.reference] }], 21))))).flat();
  item.confirmedExactMatches = selectStudentBillingProfiles(queried).filter(permitted)
    .filter((row) => studentBillingIdentity(row).reference === item.reference.toLowerCase()).length;
}
console.log(JSON.stringify({ readOnly: true, checkedAt: new Date().toISOString(), profiles: roster.length,
  completed: complete.length, deterministicMismatches: mismatches.length, mismatches,
  recentlyChanged: complete.filter((row) => Date.parse(row.__updateTime) > Date.now() - 30 * 60 * 1000)
    .map((row) => ({ reference: referenceFor(row), revision: row.__updateTime })) }, null, 2));
