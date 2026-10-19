// Read-only live reconciliation plus execution of the actual parent wallet projection/rendering functions.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { recordMatchesSelectedChildScope, parentChildIdentity } from '../functions/api/parent-dashboard.js';
import { summarizeWalletActivity } from '../functions/api/backend.js';
const previous = JSON.parse(await readFile('tmp/card-refund-verification.json','utf8'));
const batch = previous.batch, refs = [...new Set(batch.Rows.map(r=>r.AdmissionNo))];
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth=require('./auth.js'),{requireAuth}=require('./requireAuth.js'),{Client}=require('./apiv2.js');
const project='school-management-suite-27064',account=auth.getProjectDefaultAccount(process.cwd());
if(!account)throw new Error('Existing Firebase CLI sign-in required.');
await requireAuth({project,...account});
const client=new Client({urlPrefix:'https://firestore.googleapis.com',apiVersion:'v1'});
const base=`/projects/${project}/databases/(default)/documents`;
const readTime=new Date(Date.now()-5000).toISOString();
const beforeTime=new Date(Date.parse(batch.ApprovedAt)-1000).toISOString();
const allowed=new Set(['ledger','students','schoolBranches/main/sections/secondary/students']);
async function query(collection,options={},at=readTime){
  assert(allowed.has(collection)); let startAfterName='';const rows=[];
  for(let page=0;page<30;page++){
    const {endpoint,structuredQuery}=buildStructuredQuery(collection,{...options,orderBy:[{field:'__name__'}],limit:500,...(startAfterName?{startAfterName}:{})});
    assert(endpoint.endsWith(':runQuery'));
    const response=await client.post(`${base}/${endpoint}`,{structuredQuery,readTime:at},{resolveOnHTTPError:true});
    const entries=Array.isArray(response.body)?response.body:[response.body];
    if(response.status>=400||entries.some(r=>r?.error))throw new Error(`Read failed: ${collection}, ${response.status}: ${entries.find(r=>r?.error)?.error?.message||''}`);
    const found=entries.flatMap(r=>r.document?[firestoreDocumentToObject(r.document)]:[]);rows.push(...found);
    if(found.length<500)return rows;
    const next=found.at(-1).__name;assert(next&&next!==startAfterName);startAfterName=next;
  }
  throw new Error('Truncated read refused.');
}
async function parallel(items,fn){const results=[];let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<items.length){let i=next++;results[i]=await fn(items[i]);}}));return results;}
async function readReferences(collection,values,fields,at=readTime,select){
  const chunks=[],size=Math.floor(30/fields.length);for(let i=0;i<values.length;i+=size)chunks.push(values.slice(i,i+size));
  const rows=(await parallel(chunks,values=>query(collection,{filterJoin:'OR',filters:fields.map(field=>({field,op:'in',value:values})),...(select?{select}:{})},at))).flat();
  return [...new Map(rows.map(r=>[r.__name,r])).values()];
}
const profileFields=['AccountRef','AdmissionNo','admissionNo','ApplicationReference','applicationReference','ClassName','BranchId','SchoolSection','ParentEmail','parentEmail','Email','email','VerificationEmail','FatherEmail','MotherEmail','GuardianEmail'];
const profiles=(await parallel(['students','schoolBranches/main/sections/secondary/students'],async path=>(await readReferences(path,refs,['AdmissionNo','admissionNo'],readTime,profileFields)).map(r=>({...r,__scopePath:path})))).flat();
const allRefs=[...new Set([...refs,...profiles.flatMap(r=>[r.AccountRef,r.ApplicationReference,r.applicationReference]).filter(Boolean)])];
const keys=['AccountRef','AdmissionNo','ApplicationReference','accountRef','admissionNo','applicationReference'];
const [before,after]=await Promise.all([readReferences('ledger',allRefs,keys,beforeTime),readReferences('ledger',allRefs,keys)]);
console.log(JSON.stringify({stage:'live-ledgers-loaded',readTime,beforeTime,students:refs.length,profiles:profiles.length,before:before.length,after:after.length}));
const backend=await readFile('functions/api/parent-dashboard.js','utf8');
const frontend=await readFile('js/parent-dashboard.js','utf8');
const publicResponse=await fetch('https://destinychristianacademy.pages.dev/js/parent-dashboard.js',{cache:'no-store'});
assert(publicResponse.ok,'Public parent renderer unavailable');
const publicJs=await publicResponse.text();
const normalizeSource=s=>s.replace(/\r\n/g,'\n').trim();
assert.equal(normalizeSource(publicJs),normalizeSource(frontend),'The deployed parent renderer differs from the code under verification.');
function extracted(source,name){
  const start=source.search(new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${name}\\(`));
  assert(start>=0,`Missing ${name}`);
  const beginning=source.slice(start).replace(/^\n/,'');
  const end=beginning.slice(1).search(/\n(?:export )?(?:async )?function /);
  return (end<0?beginning:beginning.slice(0,end+1)).replace(/^export /,'');
}
const apiContext={};
const names=['clean','lower','pick','asMoneyNumber','parseFlexibleDate','toDisplayDate','referenceIdentityKey','financialKeys','financialReferenceMatches','accountKeys','normalizeLedger','walletBalance'];
vm.runInNewContext(names.map(n=>extracted(backend,n)).join('\n')+`\nthis.helpers={${names.join(',')}};`,apiContext);
const h=apiContext.helpers;
function element(){return {children:[],innerHTML:'',textContent:'',value:'',appendChild(child){this.children.push(child);}};}
const dom={walletSummary:element(),walletLedger:element(),walletStatus:element(),txnLimit:element(),dailyLimit:element(),pinThreshold:element(),document:{createElement:element},dashboard:{walletActivity:{}}};
vm.createContext(dom);
vm.runInContext(['money','childIdentity','childResult','renderWallet'].map(n=>extracted(frontend,n)).join('\n'),dom);
const flatten=node=>(node.innerHTML||'')+(node.textContent||'')+(node.children||[]).map(flatten).join('');
const cents=v=>Math.round(Number(v||0)*100);
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const results=[];
for(const ref of refs){
  const expected=batch.Rows.filter(r=>r.AdmissionNo===ref),profileCandidates=profiles.filter(r=>(r.AdmissionNo||r.admissionNo)===ref);
  const profile=profileCandidates.find(r=>r.__scopePath.includes('/sections/'))||profileCandidates[0];
  assert(profile,`Missing student profile ${ref}`);
  const child={...profile,AccountRef:profile.AccountRef||profile.AdmissionNo||profile.admissionNo||profile.__id,AdmissionNo:profile.AdmissionNo||profile.admissionNo||profile.__id};
  const scope={branchId:'main',schoolSection:'secondary'};
  const rawFor=rows=>rows.filter(r=>recordMatchesSelectedChildScope(r,scope)&&h.financialReferenceMatches(h.normalizeLedger(r).AccountRef,child));
  const projected=rows=>rawFor(rows).map(h.normalizeLedger).filter(r=>h.lower(r.FeeCategory)==='wallet').sort((a,b)=>h.clean(b.Date).localeCompare(h.clean(a.Date)));
  const oldEntries=projected(before),entries=projected(after),refunds=entries.filter(r=>r.Reference===batch.BatchId);
  const oldRaw=rawFor(before),newRaw=rawFor(after),beforeMap=new Map(oldRaw.map(r=>[r.__name,r]));
  const additions=newRaw.filter(r=>!beforeMap.has(r.__name));
  const changed=oldRaw.filter(r=>!newRaw.some(n=>n.__name===r.__name&&canonical(n)===canonical(r)));
  const nonRefundMovements=additions.filter(r=>r.Reference!==batch.BatchId&&h.lower(r.FeeCategory)==='wallet');
  const otherCents=nonRefundMovements.reduce((s,r)=>s+cents(r.Credit)-cents(r.Debit),0);
  const priorBalance=cents(h.walletBalance(oldEntries)),currentBalance=cents(h.walletBalance(entries));
  const refundCents=refunds.reduce((s,r)=>s+cents(r.Credit)-cents(r.Debit),0),expectedCents=expected.length*350000;
  const independentBalance=newRaw.filter(r=>String(r.FeeCategory||'').toLowerCase()==='wallet').reduce((s,r)=>s+cents(r.Credit)-cents(r.Debit),0);
  child.WalletBalance=currentBalance/100;
  dom.walletLedger.children=[];dom.walletSummary.children=[];
  dom.dashboard.walletActivity={[parentChildIdentity(child)]:entries};
  dom.renderWallet(child);
  const html=flatten(dom.walletLedger),label='Refund: 4k RFID S70 NFC Card - sales approval under review';
  const renderedRefundCount=html.split(label).length-1;
  const inDisplay=entries.slice(0,entries.length>5?100:20).filter(r=>r.Reference===batch.BatchId);
  const checks={
    correctRefund:refunds.length===expected.length&&refundCents===expectedCents&&refunds.every(r=>r.Credit===3500&&r.Debit===0&&r.EntryType==='Wallet Refund'),
    parentHistoryVisible:inDisplay.length===expected.length&&renderedRefundCount===expected.length&&html.includes('+₦3,500.00'),
    balanceReconciled:currentBalance===priorBalance+expectedCents+otherCents&&currentBalance===independentBalance&&cents(summarizeWalletActivity(newRaw,ref).balance)===currentBalance,
    renderedBalance:dom.walletSummary.innerHTML.includes(dom.money(currentBalance/100)),
    existingHistoryUnchanged:changed.length===0,
    parentQueryCanRetrieveRefunds:expected.every(e=>newRaw.some(r=>r.LedgerNo===`WALLET-${e.RefundId}`&&h.accountKeys(child).includes(r.AccountRef))),
    historyWithinReadLimit:entries.length<2000
  };
  results.push({admissionNo:ref,name:expected[0].StudentName,purchases:expected.length,refund:refundCents/100,beforeWallet:priorBalance/100,currentWallet:currentBalance/100,otherWalletMovement:otherCents/100,activityCount:entries.length,renderedRefundCount,activityCollapsed:entries.length>5,profilePaths:profileCandidates.map(r=>r.__scopePath),parentLinked:profileCandidates.some(r=>profileFields.filter(k=>/email/i.test(k)).some(k=>r[k])),checks,allPassed:Object.values(checks).every(Boolean)});
}
const summary={readOnly:true,readTime,beforeTime,batchId:batch.BatchId,deployedFrontendMatches:true,students:results.length,purchases:results.reduce((s,r)=>s+r.purchases,0),totalRefund:results.reduce((s,r)=>s+r.refund,0),allPassed:results.every(r=>r.allPassed),oneCardStudents:results.filter(r=>r.purchases===1).length,doubleCardStudents:results.filter(r=>r.purchases===2).length,parentsLinked:results.filter(r=>r.parentLinked).length,collapsedHistories:results.filter(r=>r.activityCollapsed).length,otherMovementAccounts:results.filter(r=>r.otherWalletMovement!==0).length,maxWalletActivities:Math.max(...results.map(r=>r.activityCount)),failures:results.filter(r=>!r.allPassed),doubleBuyers:results.filter(r=>r.purchases===2).map(({name,admissionNo,beforeWallet,refund,currentWallet,otherWalletMovement})=>({name,admissionNo,beforeWallet,refund,currentWallet,otherWalletMovement})),liveBrowserChild:results.find(r=>r.admissionNo==='DCA/26/097')};
await writeFile('tmp/parent-refund-wallet-verification.json',JSON.stringify({summary,results,before,after},null,2));
console.log(JSON.stringify(summary,null,2));
if(!summary.allPassed)process.exitCode=2;
