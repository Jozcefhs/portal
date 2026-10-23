import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {buildStructuredQuery,firestoreDocumentToObject} from '../functions/lib/firestore.js';
const require=createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth=require('./auth.js'),{requireAuth}=require('./requireAuth.js'),{Client}=require('./apiv2.js');
const project='school-management-suite-27064',account=auth.getProjectDefaultAccount(process.cwd());
assert(account); await requireAuth({project,...account});
const client=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const {endpoint,structuredQuery}=buildStructuredQuery('platformSecurityAudit',{
  select:['Timestamp','Action','HttpStatus','DurationMs','EntityId','Route'],
  filters:[{field:'Timestamp',op:'>=',value:'2026-10-22T04:00:00.000Z'}],
  orderBy:[{field:'Timestamp',direction:'DESCENDING'}],limit:4000});
assert(endpoint.endsWith(':runQuery'));
const response=await client.post(`/projects/${project}/databases/(default)/documents/${endpoint}`,{structuredQuery},{resolveOnHTTPError:true});
const entries=Array.isArray(response.body)?response.body:[response.body];
assert(response.status<400&&!entries.some(r=>r?.error),'Read failed');
const all=entries.filter(r=>r.document).map(r=>firestoreDocumentToObject(r.document));
const selected=all.filter(r=>/cbt.*score|score.*cbt/i.test(r.Action));
const counts={}; for(const r of selected) counts[r.HttpStatus]=(counts[r.HttpStatus]||0)+1;
console.log(JSON.stringify({readRows:all.length,oldestRead:all.at(-1)?.Timestamp,scoreUploadRequests:selected.length,statusCounts:counts,
  newestRead:all.at(0)?.Timestamp,
  hourly:Object.entries(Object.groupBy(selected,r=>r.Timestamp.slice(0,13))).map(([hour,rows])=>({hour,total:rows.length,ok:rows.filter(r=>r.HttpStatus==='200').length,rejected:rows.filter(r=>r.HttpStatus==='409').length})),
  lastRequests:selected.slice(0,6).map(r=>({status:r.HttpStatus,time:r.Timestamp,class:r.EntityId}))},null,2));
