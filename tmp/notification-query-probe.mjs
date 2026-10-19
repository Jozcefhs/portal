// Read-only diagnostic. Reuses Firebase CLI authentication, never prints credentials or records.
import { createRequire } from 'node:module';
import { buildStructuredQuery } from '../functions/lib/firestore.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js');
const { requireAuth } = require('./requireAuth.js');
const { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Firebase CLI sign-in required.');
await requireAuth({ project, ...account });
const client = new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const cases = [
  ['school-fee-credit-candidates','accountSummaries',{filters:[{field:'CreditBalance',op:'>',value:0}]}],
  ['scheduled-fee-reminders','invoices',{filters:[{field:'ReminderEligible',op:'==',value:true},{field:'NextReminderDate',op:'<=',value:'2026-10-13'}],orderBy:[{field:'NextReminderDate',direction:'ASCENDING'}]}],
  ['legacy-fee-reminders','invoices',{filters:[{field:'DueDate',op:'>=',value:'2026-09-13'},{field:'DueDate',op:'<=',value:'2026-10-27'}],orderBy:[{field:'DueDate',direction:'ASCENDING'}]}]
];
for (const [name,collection,options] of cases) {
  const {endpoint,structuredQuery} = buildStructuredQuery(collection,{...options,limit:1,select:['__name__']});
  try {
    const result = await client.post(`/projects/${project}/databases/(default)/documents/${endpoint}`, {structuredQuery}, {resolveOnHTTPError:true});
    const body = result.body;
    const failure = (Array.isArray(body)?body: [body]).find(row=>row.error)?.error;
    console.log(JSON.stringify({name,status:result.status,message:failure?.message||'Query accepted',code:failure?.status||'OK'}));
  } catch(error) {
    console.log(JSON.stringify({name,error:error.message}));
  }
}
