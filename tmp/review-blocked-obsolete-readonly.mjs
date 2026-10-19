// Read-only diagnosis. Hypothetical profile changes below exist only in memory.
import { createRequire } from 'node:module';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { billingPreviewStudent } from '../functions/api/student-billing-preview.js';
import { studentBillingIdentity } from '../functions/lib/student-billing-profile.js';
import { accountRefsFrom, normalizePayment, normalizeInvoice, buildPaymentAccountingJournal, financialRowMatchesAccount } from '../functions/api/backend.js';
import { obsoleteSchoolChargeReversalPlan } from '../functions/lib/obsolete-school-charge-reversal.js';
import { feeRowsForBranch } from '../functions/lib/fee-branch-scope.js';
const references = [254,255,262,265,266,268,269,271,272,274,275,276].map(n=>`DCA/26/${n}`);
const readTime = new Date(Date.now()-5000).toISOString();
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), { requireAuth } = require('./requireAuth.js'), { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Existing Firebase CLI sign-in required.');
await requireAuth({project,...account});
const client = new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const base = `/projects/${project}/databases/(default)/documents`;
const keys=['AdmissionNo','admissionNo','AccountRef','accountRef','ApplicationReference','applicationReference'];
const fields=[...keys,'ApplicationID','AdmissionNumber','DisplayName','displayName','FirstName','firstName','MiddleName','middleName','Surname','surname',
  'ClassName','className','ClassAdmitted','classAdmitted','ClassArm','AcademicSession','academicSession','Term','term','StudentType','studentType',
  'Gender','gender','Sex','sex','BillingCategory','billingCategory','EnrollmentCategory','enrollmentCategory','IntakeCategory','StudentEntryType',
  'AcademicProgress','academicProgress','ProgressCategory','RepeaterStatus','ProfileCompletionStatus','profileCompletionStatus','Status',
  'BranchId','branchId','SchoolSection','schoolSection','UpdatedAt','updatedAt','ParentOnboardingProfileCompletedAt'];
const clean=v=>String(v??'').trim();
const unique=rows=>[...new Map(rows.map(row=>[row.__name,row])).values()];
async function query(collection,options={}) {
  if (!/^(students|schoolBranches\/main\/sections\/(primary|secondary)\/students|invoices|payments|ledger|accountSummaries|feeItems|accountingJournals)$/.test(collection)) throw new Error('Out-of-scope read refused.');
  const {endpoint,structuredQuery}=buildStructuredQuery(collection,{...options,limit:2000});
  if (!endpoint.endsWith(':runQuery')) throw new Error('Writes are forbidden.');
  const response=await client.post(`${base}/${endpoint}`,{structuredQuery,readTime},{resolveOnHTTPError:true});
  const entries=Array.isArray(response.body)?response.body:[response.body];
  if(response.status>=400||entries.some(row=>row?.error))throw new Error(`Read failed: ${collection} (${response.status}).`);
  const rows=entries.flatMap(row=>row.document?[firestoreDocumentToObject(row.document)]:[]);
  if(rows.length>=2000)throw new Error('Partial data rejected.');
  return rows;
}
async function queryRefs(collection,refs,queryFields=keys,select) {
  const rows=[],chunk=Math.floor(30/queryFields.length);
  for(let index=0;index<refs.length;index+=chunk)rows.push(...await query(collection,{filterJoin:'OR',filters:queryFields.map(field=>({field,op:'in',value:refs.slice(index,index+chunk)})),...(select?{select}:{})}));
  return unique(rows);
}
const copies=(await Promise.all(['students','schoolBranches/main/sections/secondary/students','schoolBranches/main/sections/primary/students'].map(async path=>
  (await queryRefs(path,references,keys,fields)).map(row=>({...row,__scopePath:path}))))).flat();
const students=references.map(ref=>billingPreviewStudent(copies,{branchId:'main',schoolSectionAccess:'All'},ref));
const selected=students.map(student=>({...student,AccountRef:student.AdmissionNo||student.admissionNo||student.AccountRef}));
const allRefs=[...new Set(selected.flatMap(accountRefsFrom))];
const schoolResponse=await client.get(`${base}/settings/schoolProfile?readTime=${encodeURIComponent(readTime)}`,{resolveOnHTTPError:true});
if(schoolResponse.status!==200)throw new Error('School settings read failed.');
const common={schoolProfile:firestoreDocumentToObject(schoolResponse.body),feeItems:feeRowsForBranch(await query('feeItems'),'main')};
const finances={};
await Promise.all(['invoices','payments','ledger','accountSummaries'].map(async collection=>{finances[collection]=await queryRefs(collection,allRefs);}));
const candidateIds=[...new Set(finances.invoices.map(normalizeInvoice).filter(row=>/^(TXT(?:_|$)|LEG$)/i.test(row.FeeCode)||/\b(textbooks?|yearbook)\b/i.test(row.FeeName)).map(row=>row.InvoiceId))];
const paymentJournalNos=[...new Set(finances.payments.map(row=>buildPaymentAccountingJournal(normalizePayment(row))?.JournalNo).filter(Boolean))];
const journals=unique([
  ...await queryRefs('accountingJournals',candidateIds,['SourceId']),
  ...(paymentJournalNos.length?await queryRefs('accountingJournals',paymentJournalNos,['JournalNo']):[])
]);
console.log(JSON.stringify({stage:'loaded',readOnly:true,readTime,students:students.length,financialCounts:Object.fromEntries(Object.entries(finances).map(([key,rows])=>[key,rows.length]))}));
const results=[];
for(const student of selected) {
  const ref=student.AccountRef;
  const matches=row=>clean(row.BranchId||'main').toLowerCase()==='main'&&(!clean(row.SchoolSection||row.schoolSection)||clean(row.SchoolSection||row.schoolSection).toLowerCase()===student.SchoolSection)
    &&financialRowMatchesAccount({...row,AccountRef:row.AccountRef||row.accountRef,AdmissionNo:row.AdmissionNo||row.admissionNo,ApplicationReference:row.ApplicationReference||row.applicationReference},student);
  const data={...common,...Object.fromEntries(Object.entries(finances).map(([key,rows])=>[key,rows.filter(matches)]))};
  const invoiceIds=new Set(data.invoices.map(normalizeInvoice).map(row=>row.InvoiceId));
  const receiptJournals=new Set(data.payments.map(row=>buildPaymentAccountingJournal(normalizePayment(row))?.JournalNo).filter(Boolean));
  data.journals=journals.filter(row=>invoiceIds.has(row.SourceId)||receiptJournals.has(row.JournalNo));
  const plan=await obsoleteSchoolChargeReversalPlan(student,data);
  const required=['ClassName','StudentType','AcademicSession','Term'];
  const saved=Object.fromEntries([...required,'ClassArm','Gender','BillingCategory','EnrollmentCategory','AcademicProgress','ProfileCompletionStatus'].map(key=>[key,clean(student[key]||student[key[0].toLowerCase()+key.slice(1)])]));
  const missing=required.filter(key=>!saved[key]);
  const scenarios=[];
  if(!plan.ready&&missing.length) {
    for(const type of (missing.includes('StudentType')?['Day Student','Boarding Student']:[saved.StudentType])) {
      const patch=Object.fromEntries(missing.map(key=>[key,key==='StudentType'?type:plan.profile[key]]));
      if(Object.values(patch).some(value=>!clean(value)))continue;
      const hypothetical=await obsoleteSchoolChargeReversalPlan({...student,...patch},data);
      scenarios.push({hypotheticalOnly:true,unsavedValues:patch,ready:hypothetical.ready,reason:hypothetical.reason,amount:hypothetical.amount,
        releasedCredit:hypothetical.releasedCredit,baselineJournalCount:hypothetical.baselineJournals.length,writeCount:hypothetical.writeCount});
    }
  }
  const sourceCopies=copies.filter(row=>studentBillingIdentity(row).reference===ref.toLowerCase()).map(row=>({path:row.__scopePath,
    selected:row.__name===student.__name,savedValues:Object.fromEntries([...required,'Gender','ProfileCompletionStatus'].map(key=>[key,clean(row[key]||row[key[0].toLowerCase()+key.slice(1)])]))}));
  const result={reference:ref,name:plan.profile.DisplayName,saved,missing,reason:plan.reason,currentlyReady:plan.ready,
    profileUsedByPreview:plan.profile,amount:plan.amount,releasedCredit:plan.releasedCredit,
    charges:plan.charges.map(row=>({code:row.code,amount:row.amount,allocatedCredit:row.releasedCredit,reason:row.reason})),
    paymentCount:data.payments.length,sourceCopies,scenarios};
  results.push(result);console.log(JSON.stringify({stage:'account',readOnly:true,...result}));
}
console.log(JSON.stringify({stage:'complete',readOnly:true,readTime,students:results.length,currentlyReady:results.filter(row=>row.currentlyReady).length,
  candidateAmount:results.reduce((sum,row)=>sum+row.amount,0),releasedAllocations:results.reduce((sum,row)=>sum+row.releasedCredit,0),
  missingFields:[...new Set(results.flatMap(row=>row.missing))]}));
