// Diagnosis only: authenticated Firestore reads, aggregate output, no writes/PII.
import { createRequire } from 'node:module';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { searchLibraryBorrowers } from '../functions/lib/school-library.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js');
const { requireAuth } = require('./requireAuth.js');
const { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Firebase CLI sign-in required.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix: 'https://firestore.googleapis.com', apiVersion: 'v1' });
async function read(collection, select) {
  const {endpoint, structuredQuery} = buildStructuredQuery(collection, {select, limit:2000});
  const response = await client.post(`/projects/${project}/databases/(default)/documents/${endpoint}`, {structuredQuery}, {resolveOnHTTPError:true});
  const entries = Array.isArray(response.body) ? response.body : [response.body];
  if (response.status >= 400 || entries.some(x => x?.error)) throw new Error(`Read failed (${response.status})`);
  return entries.flatMap(row => row.document ? [firestoreDocumentToObject(row.document)] : []);
}
const counts = (rows, field) => rows.reduce((out,row) => {const k=String(row[field] || '(empty)');out[k]=(out[k]||0)+1;return out;},{});
const staff = await read('staffUsers',['Username','Role','Department','BranchId','SchoolSectionAccess','Active']);
const vendors = await read('commerceVendors',['LoginUsername','ScopeKey','SchoolSection','Active','PosEnabled']);
console.log(JSON.stringify({vendorScopes:vendors.filter(row=>row.LoginUsername).map(row=>{
  const login=staff.find(person=>String(person.Username || person.__id).toLowerCase()===String(row.LoginUsername).toLowerCase());
  return {ScopeKey:row.ScopeKey,SchoolSection:row.SchoolSection,Active:row.Active,PosEnabled:row.PosEnabled,
    loginFound:!!login,role:login?.Role,branch:login?.BranchId,sectionAccess:login?.SchoolSectionAccess};
})}));
for (const path of ['students','schoolBranches/main/sections/primary/students','schoolBranches/main/sections/secondary/students']) {
  const rows = await read(path,['AdmissionNo','AccountRef','DisplayName','StudentName','ApplicantName','WalletCardId','Status','StudentStatus','BranchId','SchoolSection','ClassName']);
  const withAdmission = rows.filter(row=>row.AdmissionNo);
  const sample = withAdmission.find(row=>!['inactive','withdrawn','deleted','archived'].includes(String(row.Status || row.StudentStatus).toLowerCase()));
  console.log(JSON.stringify({path,count:rows.length,branches:counts(rows,'BranchId'),sections:counts(rows,'SchoolSection'),statuses:counts(rows,'Status'),withAdmission:withAdmission.length,withCard:rows.filter(row=>row.WalletCardId).length,sampleExactMatchCount:sample ? searchLibraryBorrowers(sample.AdmissionNo,'Student',rows,[]).length : null}));
}
