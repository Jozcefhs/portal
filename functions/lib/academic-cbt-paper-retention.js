import { batchCommitDocuments, getDocument, queryCollection } from './firestore.js';
import { deleteStoredDocument, parseStoredDocumentReference } from './document-storage.js';

export const CBT_PAPER_CLEANUP_JOBS = 'academicCbtPaperCleanupJobs';
const TERMS = 'academicTerms', TESTS = 'academicCbtTests', AUDIT = 'academicManagementAudit';
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const data = row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__')));
const fail = message => Object.assign(new Error(message), {status:409, code:'ACADEMIC_CBT_RETENTION_CONFLICT'});
const sameScope = (a,b) => lower(a.BranchId || 'main') === lower(b.BranchId || 'main')
  && lower(a.SchoolSection) === lower(b.SchoolSection);
const id = row => clean(row.RecordId || row.CbtTestId || row.TermId || row.JobId || row.__id);
const version = row => { if (!clean(row?.__updateTime)) throw fail('Reload the academic record before cleaning up its papers.'); return row.__updateTime; };
const write = (collectionPath, row, patch) => ({collectionPath, documentId:id(row),
  data:{...data(row),...patch}, updateTime:version(row)});

// These writes join the term activation's atomic commit. No file deletion is
// performed by activation, and a failed activation cannot enqueue a cleanup.
export async function academicCbtRetentionActivationWrites(record, existing, terms, actor, timestamp) {
  if (record.Status !== 'Active' || existing?.Status === 'Active') return [];
  const eligible = terms.filter(term => term.TermId !== record.TermId && sameScope(term,record)
    && term.Status === 'Closed' && /^\d{4}-\d{2}-\d{2}$/.test(term.EndDate || '')
    && /^\d{4}-\d{2}-\d{2}$/.test(record.StartDate || '') && term.EndDate < record.StartDate
    && !['Pending','Complete'].includes(term.CbtPaperCleanupStatus));
  if (eligible.length > 200) throw fail('Too many closed terms need paper cleanup; review the academic calendar first.');
  const writes = [];
  for (const term of eligible) {
    const material = JSON.stringify([lower(term.BranchId),lower(term.SchoolSection),term.SessionId,term.TermId,timestamp]);
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material));
    const JobId = `cbt-retention-${[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
    writes.push(write(TERMS,term,{CbtPaperCleanupStatus:'Pending',CbtPaperCleanupJobId:JobId,
      CbtPaperCleanupRequestedAt:timestamp,CbtPaperCleanupRequestedBy:actor}));
    writes.push({collectionPath:CBT_PAPER_CLEANUP_JOBS,documentId:JobId,exists:false,data:{
      RecordId:JobId,JobId,Status:'Pending',BranchId:term.BranchId,SchoolSection:term.SchoolSection,
      SessionId:term.SessionId,TermId:term.TermId,TermRecordId:id(term),ActivatedTermId:record.TermId,
      RequestedAt:timestamp,RequestedBy:actor,Cursor:'',PendingTestId:'',PendingUrls:[],
      TestsCleaned:0,FilesRemoved:0,LastError:''
    }});
  }
  return writes;
}

export function assertAcademicTermRetentionEdit(existing, record) {
  if (existing?.CbtPaperCleanupStatus !== 'Pending') return;
  if (record.Status !== 'Closed' || ['SessionId','TermId','StartDate','EndDate','BranchId','SchoolSection']
      .some(key => clean(existing[key]) !== clean(record[key]))) {
    throw fail('Question-paper cleanup is pending for this closed term. Let it finish before reopening or moving the term. Scores and results are preserved.');
  }
}

function paperUrls(row) {
  return [...new Set([...(row.PaperFiles || []),...(row.TheoryPaperFiles || [])]
    .map(file=>clean(file.Url || file.PaperUrl)).concat([clean(row.PaperUrl),clean(row.TheoryPaperUrl)]).filter(Boolean))];
}
const segment = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9._-]+/g,'-').replace(/^[._-]+|[._-]+$/g,'').slice(0,96);

export function assertAcademicCbtRetentionUrls(env, row, urls) {
  if (urls.length > 24) throw fail('This test has too many stored paper references for automatic cleanup.');
  for (const url of urls) {
    const {key} = parseStoredDocumentReference(env,url);
    const parts = key.split('/');
    if (parts.length !== 9 || parts[3] !== 'academic-cbt'
      || parts[4] !== segment(row.BranchId || 'main') || parts[5] !== segment(row.SchoolSection)
      || parts[6] !== segment(row.CbtTestId)) {
      throw fail('A paper reference is not owned by this test. No unrelated storage will be removed.');
    }
  }
}

function assertClosedTerm(term,job) {
  if (!term || term.Status !== 'Closed' || term.SessionId !== job.SessionId || term.TermId !== job.TermId
      || !sameScope(term,job) || term.CbtPaperCleanupStatus !== 'Pending' || term.CbtPaperCleanupJobId !== job.JobId) {
    throw fail('The closed-term cleanup authorization changed. Paper deletion was stopped.');
  }
}

async function advance(env,original,db) {
  let job = await db.getDocument(env,CBT_PAPER_CLEANUP_JOBS,original.JobId);
  if (!job || job.Status !== 'Pending') return {complete:true};
  const term = await db.getDocument(env,TERMS,job.TermRecordId);
  assertClosedTerm(term,job);
  if (!job.PendingTestId) {
    const rows = await db.queryCollection(env,TESTS,{filters:[{field:'TermId',op:'EQUAL',value:job.TermId}],
      orderBy:[{field:'__name__'}],limit:1,...(job.Cursor?{startAfterName:job.Cursor}:{})});
    if (!rows.length) {
      const timestamp = new Date().toISOString();
      await db.batchCommitDocuments(env,[write(CBT_PAPER_CLEANUP_JOBS,job,{Status:'Complete',CompletedAt:timestamp,LastError:''}),
        write(TERMS,term,{CbtPaperCleanupStatus:'Complete',CbtPaperCleanupCompletedAt:timestamp,
          CbtPaperCleanupTests:job.TestsCleaned,CbtPaperCleanupFiles:job.FilesRemoved})]);
      return {complete:true};
    }
    const row = rows[0];
    if (!clean(row.__name) || row.__name === job.Cursor) throw fail('The paper-cleanup cursor did not advance.');
    const urls = paperUrls(row);
    if (!sameScope(row,job) || row.SessionId !== job.SessionId || !urls.length) {
      await db.batchCommitDocuments(env,[write(CBT_PAPER_CLEANUP_JOBS,job,{Cursor:row.__name,LastError:''})]);
      return {skipped:true};
    }
    // Validate every object before claiming or deleting any object.
    db.assertUrls(env,row,urls);
    await db.batchCommitDocuments(env,[
      write(TESTS,row,{CloudPaperRemovalStatus:'Pending',CloudPaperCleanupJobId:job.JobId}),
      write(CBT_PAPER_CLEANUP_JOBS,job,{PendingTestId:row.CbtTestId,PendingCursor:row.__name,PendingUrls:urls,LastError:''}),
      write(TERMS,term,{CbtPaperCleanupStatus:'Pending'})
    ]);
    job = await db.getDocument(env,CBT_PAPER_CLEANUP_JOBS,job.JobId);
  }
  const row = await db.getDocument(env,TESTS,job.PendingTestId);
  if (!row || !sameScope(row,job) || row.SessionId !== job.SessionId || row.TermId !== job.TermId
    || row.CloudPaperCleanupJobId !== job.JobId || row.CloudPaperRemovalStatus !== 'Pending'
    || JSON.stringify(paperUrls(row)) !== JSON.stringify(job.PendingUrls)) throw fail('The claimed paper changed. Cleanup paused for review.');
  db.assertUrls(env,row,job.PendingUrls);
  // R2 deletion is idempotent. Retain all URLs until every delete succeeds;
  // retries after a timeout or lost commit response can safely repeat them.
  for (const url of job.PendingUrls) await db.deleteStoredDocument(env,url);
  const timestamp = new Date().toISOString();
  const cleared = {PaperFiles:[],PaperUrl:'',PaperFileName:'',PaperMimeType:'',PaperByteLength:0,
    TheoryPaperFiles:[],TheoryPaperUrl:'',TheoryPaperFileName:'',TheoryPaperMimeType:'',TheoryPaperByteLength:0,
    CloudPaperRemovalStatus:'Complete',CloudPaperRemovedAt:timestamp,CloudPaperRemovedBy:'System — closed-term retention',
    CloudPaperRemovalReason:`Closed term; next term ${job.ActivatedTermId} activated`,CloudPaperObjectCount:job.PendingUrls.length};
  const AuditId = `CBT-RETENTION-${job.JobId}-${row.CbtTestId}`;
  await db.batchCommitDocuments(env,[write(TESTS,row,cleared),
    write(CBT_PAPER_CLEANUP_JOBS,job,{Cursor:job.PendingCursor,PendingTestId:'',PendingCursor:'',PendingUrls:[],
      TestsCleaned:job.TestsCleaned+1,FilesRemoved:job.FilesRemoved+job.PendingUrls.length,LastError:''}),
    {collectionPath:AUDIT,documentId:AuditId,exists:false,data:{AuditId,Timestamp:timestamp,
      Action:'DELETE_CLOUD_PAPERS',RecordType:'cbtTests',RecordId:row.CbtTestId,BranchId:job.BranchId,
      SchoolSection:job.SchoolSection,SessionId:job.SessionId,TermId:job.TermId,
      Actor:'System — closed-term retention',ActorUsername:'system:cbt-retention',ActorRole:'System',
      Details:`Removed ${job.PendingUrls.length} closed-term paper files after next-term activation. Answers, scores and results preserved.`}}
  ]);
  return {cleaned:true};
}

// Called by the existing authenticated scheduler, never by public page reads.
export async function processAcademicCbtPaperRetention(env,options={}) {
  const db = {getDocument,queryCollection,batchCommitDocuments,deleteStoredDocument,assertUrls:assertAcademicCbtRetentionUrls,...options.db};
  const jobs = await db.queryCollection(env,CBT_PAPER_CLEANUP_JOBS,{filters:[{field:'Status',op:'EQUAL',value:'Pending'}],limit:5});
  const result = {ok:true,processed:0,cleaned:0,completed:0,failed:0};
  const started = Date.now();
  for (const job of jobs) {
    try {
      for (let step=0;step<5 && Date.now()-started<12_000;step++) {
        const next = await advance(env,job,db);
        result.processed++;
        if (next.cleaned) result.cleaned++;
        if (next.complete) {result.completed++;break;}
      }
    } catch(error) {
      result.ok=false;result.failed++;
      const current = await db.getDocument(env,CBT_PAPER_CLEANUP_JOBS,job.JobId).catch(()=>null);
      if (current?.Status==='Pending') {
        await db.batchCommitDocuments(env,[write(CBT_PAPER_CLEANUP_JOBS,current,
          {LastError:clean(error.message).slice(0,500),LastAttemptAt:new Date().toISOString()})]).catch(()=>{});
      }
    }
    if (Date.now()-started>=12_000) break;
  }
  return result;
}
