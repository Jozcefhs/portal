// Only selected profile/link fields are read; no credentials and no database writes.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { findScopedChildApplication } from '../functions/api/parent-dashboard.js';
const v=JSON.parse(await readFile('tmp/parent-refund-wallet-verification.json','utf8'));
const refs=v.results.map(r=>r.admissionNo),readTime=new Date(Date.now()-5000).toISOString();
const require=createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth=require('./auth.js'),{requireAuth}=require('./requireAuth.js'),{Client}=require('./apiv2.js');
const project='school-management-suite-27064',account=auth.getProjectDefaultAccount(process.cwd());
if(!account)throw new Error('Existing Firebase CLI sign-in required.');
await requireAuth({project,...account});
const client=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const allowed=new Set(['schoolBranches/main/sections/secondary/students','schoolBranches/main/sections/secondary/applications']);
const emails=['ParentEmail','parentEmail','Email','email','VerificationEmail','verificationEmail','FatherEmail','MotherEmail','GuardianEmail'];
const fields=['AccountRef','AdmissionNo','admissionNo','ApplicationReference','applicationReference','ApplicationID','applicationId','BranchId','SchoolSection','ProfileCompletionStatus','ParentOnboardingStatus',...emails];
async function query(path,values,keys){
  if(!allowed.has(path))throw new Error('Out of scope');
  if(!values.length)return [];
  const output=[],size=Math.floor(30/keys.length);
  for(let i=0;i<values.length;i+=size){
    const {endpoint,structuredQuery}=buildStructuredQuery(path,{filters:keys.map(field=>({field,op:'in',value:values.slice(i,i+size)})),filterJoin:'OR',select:fields,limit:500});
    if(!endpoint.endsWith(':runQuery'))throw new Error('Writes refused');
    const r=await client.post(`/projects/${project}/databases/(default)/documents/${endpoint}`,{structuredQuery,readTime},{resolveOnHTTPError:true});
    const entries=Array.isArray(r.body)?r.body:[r.body];
    if(r.status>=400||entries.some(e=>e?.error))throw new Error(`Read failed ${r.status}`);
    const rows=entries.flatMap(e=>e.document?[{...firestoreDocumentToObject(e.document),__scopePath:path}]:[]);
    if(rows.length>=500)throw new Error('Incomplete read refused');
    output.push(...rows);
  }
  return [...new Map(output.map(r=>[r.__name,r])).values()];
}
const students=await query('schoolBranches/main/sections/secondary/students',refs,['AdmissionNo','admissionNo']);
const missing=students.filter(r=>!emails.some(k=>r[k]));
const applicationRefs=[...new Set(missing.flatMap(r=>[r.ApplicationReference,r.applicationReference,r.ApplicationID,r.applicationId]).filter(Boolean))];
const apps=await query('schoolBranches/main/sections/secondary/applications',applicationRefs,['ApplicationReference','applicationReference','ApplicationID','applicationId']);
const results=students.map(child=>{
  const linked=findScopedChildApplication(apps,child);
  return{admissionNo:child.AdmissionNo||child.admissionNo,directEmail:emails.some(k=>child[k]),linkedApplicationEmail:Boolean(linked&&emails.some(k=>linked[k])),profileStatus:child.ProfileCompletionStatus||'',onboardingStatus:child.ParentOnboardingStatus||''};
});
const unresolved=results.filter(r=>!r.directEmail&&!r.linkedApplicationEmail);
const summary={readOnly:true,readTime,students:results.length,directParentEmail:results.filter(r=>r.directEmail).length,linkedViaApplication:results.filter(r=>!r.directEmail&&r.linkedApplicationEmail).length,noParentEmailFound:unresolved.length,noEmailByProfileStatus:unresolved.reduce((s,r)=>(s[r.profileStatus||'(unset)']=(s[r.profileStatus||'(unset)']||0)+1,s),{}),doubleBuyerLinks:results.filter(r=>v.results.some(x=>x.admissionNo===r.admissionNo&&x.purchases===2))};
await writeFile('tmp/refund-parent-link-check.json',JSON.stringify({summary,results},null,2));
console.log(JSON.stringify(summary,null,2));
