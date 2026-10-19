// Verification only. The only remote operation is a timestamp-pinned runQuery.
import { createRequire } from 'node:module';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { accountRefsFrom, normalizeInvoice, normalizePayment, buildPaymentAccountingJournal,
  calculateAccountFinancialSummary, isSchoolFeeInvoice, sameFinancialPeriod } from '../functions/api/backend.js';

const verifySecondBatch = process.argv.includes('--second-batch');
const eligible = new Map((verifySecondBatch ? [254,255,262,265,266,268,269,271,272,274,275,276] : [256,257,258,259,260,261,263,264,267,270,273]).map(n => [`DCA/26/${n}`, n === 266 ? 115600 : n < 267 ? 128030 : 158060]));
const blocked = (verifySecondBatch ? [] : [254,255,262,265,266,268,269,271,272,274,275,276]).map(n => `DCA/26/${n}`);
const otherExcluded = ['DCA/22/1144','DCA/22/1181','DCA/22/1212','DCA/22/1238','DCA/22/1574','DCA/24/1788','DCA/24/1812','DCA/25/2111'];
const references = [...eligible.keys(), ...blocked, ...otherExcluded];
const beforeTime = verifySecondBatch ? '2026-10-16T16:54:50.602Z' : '2026-10-16T16:14:57.972Z';
const afterTime = verifySecondBatch ? new Date(Date.now()-5000).toISOString() : '2026-10-16T16:32:34.560Z';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), { requireAuth } = require('./requireAuth.js'), { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Existing Firebase CLI sign-in required.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix:'https://firestore.googleapis.com', apiVersion:'v1' });
const base = `/projects/${project}/databases/(default)/documents`;
const keys = ['AccountRef','AdmissionNo','ApplicationReference','accountRef','admissionNo','applicationReference'];
const unique = rows => [...new Map(rows.map(row => [row.__name, row])).values()];
const clean = value => String(value ?? '').trim();
const sum = (rows, field) => Math.round(rows.reduce((total,row) => total + Number(row[field] || 0), 0) * 100) / 100;
const allowed = new Set(['students','schoolBranches/main/sections/secondary/students','invoices','payments','ledger','accountSummaries','accountingAdjustments','accountingJournals','accountingAudit']);
async function query(collection, options, readTime) {
  if (!allowed.has(collection)) throw new Error('Out-of-scope collection refused.');
  const { endpoint, structuredQuery } = buildStructuredQuery(collection, {...options, limit:3000});
  if (!endpoint.endsWith(':runQuery')) throw new Error('Write operation refused.');
  const response = await client.post(`${base}/${endpoint}`, {structuredQuery,readTime}, {resolveOnHTTPError:true});
  const entries = Array.isArray(response.body) ? response.body : [response.body];
  if (response.status >= 400 || entries.some(row => row?.error)) throw new Error(`Read failed: ${collection} (${response.status}).`);
  const rows = entries.flatMap(row => row.document ? [firestoreDocumentToObject(row.document)] : []);
  if (rows.length >= 3000) throw new Error('Truncated verification rejected.');
  return rows;
}
async function queryRefs(collection, refs, readTime, fields=keys, select) {
  const rows = [];
  const chunkSize = Math.floor(30 / fields.length);
  for (let index=0; index<refs.length; index+=chunkSize) {
    rows.push(...await query(collection, {filterJoin:'OR', filters:fields.map(field=>({field,op:'in',value:refs.slice(index,index+chunkSize)})), ...(select?{select}: {})}, readTime));
  }
  return unique(rows);
}
const aliases = new Map(references.map(ref=>[ref,new Set([ref])]));
for (const readTime of [beforeTime,afterTime]) {
  for (const path of ['students','schoolBranches/main/sections/secondary/students']) {
    const students = await queryRefs(path,references,readTime,keys,[...keys,'ApplicationID','AdmissionNumber','BranchId','SchoolSection']);
    for (const student of students) {
      const refs = [...accountRefsFrom(student), ...keys.map(key=>clean(student[key]))].filter(Boolean);
      for (const ref of references) if (refs.includes(ref)) refs.forEach(value=>aliases.get(ref).add(value));
    }
  }
}
const allRefs = [...new Set([...aliases.values()].flatMap(values=>[...values]))];
const inScope = row => clean(row.BranchId || row.branchId || 'main').toLowerCase()==='main'
  && (!clean(row.SchoolSection || row.schoolSection) || clean(row.SchoolSection || row.schoolSection).toLowerCase()==='secondary');
const forAccount = (rows,ref) => rows.filter(row=>inScope(row)&&keys.some(key=>aliases.get(ref).has(clean(row[key]))));
const snapshots = {};
for (const [label,readTime] of [['before',beforeTime],['after',afterTime]]) {
  const data = {};
  for (const collections of [['invoices','payments','ledger'],['accountSummaries','accountingAdjustments','accountingAudit']]) {
    await Promise.all(collections.map(async collection => {
      data[collection] = (await queryRefs(collection,allRefs,readTime)).filter(inScope);
    }));
  }
  const sourceIds = [...new Set(data.invoices.map(row=>clean(row.InvoiceId || row.invoiceId || row.__id)))];
  const journalNos = [...new Set(data.payments.map(row=>buildPaymentAccountingJournal(normalizePayment(row))?.JournalNo).filter(Boolean))];
  data.accountingJournals = unique([
    ...await queryRefs('accountingJournals',sourceIds,readTime,['SourceId']),
    ...(journalNos.length ? await queryRefs('accountingJournals',journalNos,readTime,['JournalNo']) : [])
  ]).filter(inScope);
  snapshots[label] = data;
  console.log(JSON.stringify({stage:'snapshot',readOnly:true,label,readTime,counts:Object.fromEntries(Object.entries(data).map(([key,rows])=>[key,rows.length]))}));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key=>!key.startsWith('__')).map(key=>[key,stable(value[key])]));
  return value;
}
const equal = (a,b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
function diff(before,after) {
  const prior = new Map(before.map(row=>[row.__name,row]));
  const current = new Map(after.map(row=>[row.__name,row]));
  return {removed:before.filter(row=>!current.has(row.__name)).map(row=>row.__id),
    changed:before.filter(row=>current.has(row.__name)&&!equal(row,current.get(row.__name))).map(row=>row.__id),
    added:after.filter(row=>!prior.has(row.__name)).map(row=>row.__id)};
}
const noDiff = comparison => Object.values(comparison).every(rows=>rows.length===0);
const expectedFields = new Set(['FeeChargeReversed','FeeChargeReversalId','FeeChargeReversalAmount','FeeChargeReleasedCredit','FeeChargeReversedAt','FeeChargeReversedBy','FeeChargeReversalReason']);
const results = [];
for (const ref of references) {
  const before = Object.fromEntries(Object.entries(snapshots.before).filter(([key])=>key!=='accountingJournals').map(([key,rows])=>[key,forAccount(rows,ref)]));
  const after = Object.fromEntries(Object.entries(snapshots.after).filter(([key])=>key!=='accountingJournals').map(([key,rows])=>[key,forAccount(rows,ref)]));
  const invoiceIds = new Set([...before.invoices,...after.invoices].map(row=>clean(row.InvoiceId||row.invoiceId||row.__id)));
  const paymentJournalNos = new Set([...before.payments,...after.payments].map(row=>buildPaymentAccountingJournal(normalizePayment(row))?.JournalNo).filter(Boolean));
  for (const [label,data] of [['before',before],['after',after]]) data.accountingJournals=snapshots[label].accountingJournals.filter(row=>invoiceIds.has(row.SourceId)||paymentJournalNos.has(row.JournalNo));
  const differences=Object.fromEntries(Object.keys(before).map(key=>[key,diff(before[key],after[key])]));
  const reversals=after.accountingAdjustments.filter(row=>differences.accountingAdjustments.added.includes(row.__id)&&row.Type==='Student charge reversal');
  const reversedInvoices=after.invoices.filter(row=>clean(row.FeeChargeReversed).toUpperCase()==='YES'&&new Date(row.FeeChargeReversedAt)>new Date(beforeTime));
  const newJournals=after.accountingJournals.filter(row=>differences.accountingJournals.added.includes(row.__id));
  const reverseJournals=newJournals.filter(row=>row.Source==='Student Invoice Charge Reversal');
  const releaseJournals=newJournals.filter(row=>row.Source==='Student Invoice Credit Release');
  const audits=after.accountingAudit.filter(row=>differences.accountingAudit.added.includes(row.__id)&&clean(row.Action).toUpperCase()==='REVERSE OBSOLETE SCHOOL FEE CHARGE');
  const originalInvoiceFieldsIntact=before.invoices.every(row=>{
    const current=after.invoices.find(item=>item.__name===row.__name);
    if (!current) return false;
    return equal(Object.fromEntries(Object.entries(row).filter(([key])=>!expectedFields.has(key))),Object.fromEntries(Object.entries(current).filter(([key])=>!expectedFields.has(key))));
  });
  const journalPreservation=differences.accountingJournals.removed.length===0&&differences.accountingJournals.changed.length===0;
  const journalBalance=newJournals.every(row=>Math.abs(sum(row.Lines||[],'Debit')-sum(row.Lines||[],'Credit'))<0.005);
  const linkage=reversals.every(row=>reversedInvoices.some(invoice=>invoice.FeeChargeReversalId===row.AdjustmentNo&&invoice.InvoiceId===row.Reference)
    &&reverseJournals.some(journal=>journal.ReversalId===row.AdjustmentNo&&journal.SourceId===row.Reference&&journal.TotalDebit===row.Amount&&journal.TotalCredit===row.Amount)
    &&audits.some(audit=>audit.ReversalId===row.AdjustmentNo&&audit.Amount===row.Amount)
    &&before.invoices.some(invoice=>invoice.InvoiceId===row.Reference&&equal(invoice,row.OriginalInvoice)));
  const periodTotal=rows=>rows.map(normalizeInvoice).filter(row=>sameFinancialPeriod(row,'2026/2027','First Term')&&isSchoolFeeInvoice(row)).reduce((total,row)=>total+row.Debit,0);
  const beforeTotal=periodTotal(before.invoices),afterTotal=periodTotal(after.invoices);
  const summary=calculateAccountFinancialSummary(after.invoices,after.ledger,ref,afterTime.slice(0,10));
  const summaryFields=['TotalDebit','TotalCredit','OutstandingBalance','CreditBalance','WalletBalance','AccountCreditDebits'];
  const summaryMatches=after.accountSummaries.length===1&&summaryFields.every(key=>Number(after.accountSummaries[0][key]||0)===Number(summary[key]||0));
  const result={reference:ref,eligible:eligible.has(ref),requestedBlocked:blocked.includes(ref),reversalCount:reversals.length,
    reversalAmount:sum(reversals,'Amount'),reversedInvoiceCount:reversedInvoices.length,reverseJournalCount:reverseJournals.length,auditCount:audits.length,
    releasedCredit:sum(reversals,'ReleasedCredit'),releaseJournalAmount:sum(releaseJournals,'TotalDebit'),
    beforeCharges:beforeTotal,afterCharges:afterTotal,invoiceReduction:beforeTotal-afterTotal,paymentCount:after.payments.length,
    paymentsAndReceiptFieldsUnchanged:noDiff(differences.payments),ledgerUnchanged:noDiff(differences.ledger),
    originalInvoiceFieldsIntact,existingJournalsIntact:journalPreservation,newJournalsBalanced:journalBalance,linkageVerified:linkage,
    summaryMatches,blockedFinancialRecordsUnchanged:eligible.has(ref)?null:Object.values(differences).every(noDiff),
    blockedRevisionsUnchanged:eligible.has(ref)?null:Object.entries(before).every(([key,rows])=>rows.every(row=>
      after[key].some(current=>current.__name===row.__name&&current.__updateTime===row.__updateTime))),
    postedAt:[...new Set(reversals.map(row=>row.PostedAt))],postedBy:[...new Set(reversals.map(row=>row.PostedBy))],
    financialSummary:Object.fromEntries(summaryFields.map(key=>[key,summary[key]])),
    unexpectedDifferences:Object.fromEntries(Object.entries(differences).filter(([key,value])=>
      !eligible.has(ref)?!noDiff(value):(['payments','ledger'].includes(key)&&!noDiff(value))))};
  result.verified=eligible.has(ref)?result.reversalAmount===eligible.get(ref)&&result.invoiceReduction===eligible.get(ref)
    &&reversals.length===2&&reversedInvoices.length===2&&reverseJournals.length===2&&audits.length===2
    &&result.paymentsAndReceiptFieldsUnchanged&&result.ledgerUnchanged&&originalInvoiceFieldsIntact&&journalPreservation&&journalBalance&&linkage&&summaryMatches
    &&result.releasedCredit===result.releaseJournalAmount:result.blockedFinancialRecordsUnchanged&&result.blockedRevisionsUnchanged;
  results.push(result);
  console.log(JSON.stringify({stage:'account',readOnly:true,...result}));
}
console.log(JSON.stringify({stage:'complete',readOnly:true,beforeTime,afterTime,allVerified:results.every(row=>row.verified),
  eligibleStudents:results.filter(row=>row.eligible&&row.verified).length,totalReversed:sum(results.filter(row=>row.eligible),'reversalAmount'),
  requestedBlockedUnchanged:results.filter(row=>row.requestedBlocked&&row.blockedFinancialRecordsUnchanged).length,
  otherExcludedUnchanged:results.filter(row=>!row.eligible&&!row.requestedBlocked&&row.blockedFinancialRecordsUnchanged).length,
  paymentsIntact:results.every(row=>row.paymentsAndReceiptFieldsUnchanged),existingJournalsIntact:results.every(row=>row.existingJournalsIntact),
  totalReleasedCredit:sum(results.filter(row=>row.eligible),'releasedCredit')}));
