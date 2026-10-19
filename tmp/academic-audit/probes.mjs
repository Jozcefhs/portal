import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as management from '../../functions/lib/academic-management.js';
import * as scorebook from '../../functions/lib/academic-scorebook.js';
import * as policies from '../../functions/lib/academic-policy.js';
import * as timetable from '../../functions/lib/academic-timetable-attendance.js';
import { calculateAcademicMidTermResultDrafts } from '../../functions/lib/academic-term-results.js';
const source = await readFile(new URL('../../functions/lib/academic-management.js', import.meta.url), 'utf8');
let records = {};
const sandbox = {
  ...scorebook, ...management, ...timetable, TextEncoder, TextDecoder, crypto: webcrypto, console,
  getSchoolStructure: async () => ({ActiveBranchId:'main', Branches:[{Id:'main'}], Sections:['primary','secondary']}),
  enforceActorBranch: (_user, branch) => branch, safeScopeId: String,
  queryCollection: async (_env, collection) => records[collection] || [],
  listCollection: async () => [], listSchoolCollection: async () => [], getDocument: async () => ({})
};
vm.createContext(sandbox);
vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '') + '\nthis.bootstrapAudit = bootstrapAcademicManagement;', sandbox);
const row = (extra) => ({BranchId:'main',SchoolSection:'secondary',Status:'Active',...extra});
records = {academicClasses:[row({ClassId:'secondary-class'}),row({SchoolSection:'primary',ClassId:'primary-class'})]};
const user = {edition:'school', role:'Admin', allowedSections:['academics'], branchId:'main', schoolSectionAccess:'primary'};
const all = await sandbox.bootstrapAudit({}, user, {BranchId:'main', SchoolSection:'all', View:'classrooms', IncludePeople:false, IncludeAssessmentPolicy:false});
console.log(JSON.stringify({probe:'primary-restricted admin requests all sections', returnedClasses:all.classes.map(x=>x.ClassId)}));
records = {
  academicTeacherAllocations:[row({TeacherUsername:'teacher-a',ClassId:'C',ArmId:'A',SubjectId:'math',AllocationRole:'Subject Teacher',SessionId:'old',TermId:'T'})],
  academicStudentMemberships:[row({StudentRef:'student-new',ClassId:'C',ArmId:'A',SubjectIds:['math'],SessionId:'new',TermId:'T'})],
  academicScoreSheets:[row({SheetId:'other-subject-sheet',TeacherUsername:'teacher-b',ClassId:'C',ArmId:'A',SubjectId:'english',SessionId:'new',TermId:'T'})],
  academicStudentScores:[row({SheetId:'other-subject-sheet',StudentRef:'student-new',Percentage:90})]
};
const teacher = await sandbox.bootstrapAudit({}, {...user,role:'Teacher',username:'teacher-a',schoolSectionAccess:'secondary'}, {BranchId:'main',SchoolSection:'secondary',View:'scorebook',IncludePeople:false,IncludeAssessmentPolicy:false});
console.log(JSON.stringify({probe:'old math allocation exposes newer English scores', memberships:teacher.studentMemberships.length, sheets:teacher.scoreSheets.map(x=>x.SheetId), scores:teacher.studentScores.length}));

const client = await readFile(new URL('../../../suite/modules/local_cbt_client/app.js', import.meta.url), 'utf8');
const extract = (start, end) => client.slice(client.indexOf(start), client.indexOf(end, client.indexOf(start)));
const pending = new Map();
let requests = [];
const state = {session:{Attempt:{AttemptId:'attempt'}}, answers:new Map(), revisions:new Map(),saving:new Map()};
const env = {state, activePaperType:()=> 'objective', syncAnswerControls:()=>{}, updateProgress:()=>{},setSaveStatus:()=>{},
  recoveryPut:async row=>pending.set(row.key,row), recoveryDelete:async key=>pending.delete(key),
  request:async (_url,opts)=>new Promise((resolve,reject)=>requests.push({resolve,reject,row:JSON.parse(opts.body)}))};
vm.createContext(env);
vm.runInContext(extract('async function queueAnswer(', 'async function replayPending(')+'\nthis.queue=queueAnswer;',env);
await env.queue('Q1','a');
await env.queue('Q1','b');
await new Promise(resolve=>setImmediate(resolve));
requests[0].resolve({RemainingSeconds:100,ServerSavedAt:new Date().toISOString()});
await new Promise(resolve=>setImmediate(resolve));
requests[1].reject(new Error('network interrupted'));
await new Promise(resolve=>setImmediate(resolve));
console.log(JSON.stringify({probe:'first answer acknowledgement deletes newer offline answer',latestAnswer:state.answers.get('Q1').answer,pendingRecoveryRecords:pending.size}));

const policy = policies.defaultAcademicPolicy();
policy.Position.Mode = 'none';
policy.MidTerm = {Enabled:true,ComponentIds:['exam']};
policy.Assessment.Components = [{Id:'exam',Name:'Exam',MaximumScore:100,WeightPercentage:100,Required:true,ScoreEntryMode:'objective-theory',ObjectiveMaximumScore:50,TheoryMaximumScore:50}];
policy.Assessment.GradeBands = [{Grade:'A',MinimumPercentage:70,MaximumPercentage:100},{Grade:'B',MinimumPercentage:50,MaximumPercentage:69.99},{Grade:'F',MinimumPercentage:0,MaximumPercentage:49.99}];
const scheme = scorebook.academicAssessmentScheme(policy,{RevisionId:'r1'});
const computed = scorebook.calculateAcademicStudentScore(scheme,[{ComponentId:'exam',Parts:[{PartId:'objective',State:'Numeric',RawScore:50},{PartId:'theory',State:'Exempt'}]}]);
const classroom = {SessionId:'s1',TermId:'t1',ClassId:'c1',ArmId:'a1'};
const midterm = calculateAcademicMidTermResultDrafts({...classroom,Policy:policy,
  Memberships:[{...classroom,StudentRef:'S1',SubjectIds:['math'],Status:'Active'}],
  Subjects:[{SubjectId:'math',Name:'Mathematics'}],
  ScoreSheets:[{...classroom,SheetId:'sheet',SubjectId:'math',Status:'Approved',AssessmentRevisionId:'r1'}],
  StudentScores:[{...computed,ScoreId:'score',SheetId:'sheet',StudentRef:'S1',SubjectId:'math',AssessmentRevisionId:'r1'}]
});
console.log(JSON.stringify({probe:'exempt theory part in midterm',scorebookPercentage:computed.Percentage,midtermReady:midterm.Ready,midtermPercentage:midterm.Results[0]?.OverallAverage}));

let submittedWithUnsentAnswer = false;
const submitState = {token:'token',autoSubmitting:false,saving:new Map(),session:{Attempt:{AttemptId:'A'}},answers:new Map(),revisions:new Map()};
const unsentRows = [{key:'A:Q1',QuestionId:'Q1',ClientRevision:2,Response:{answer:'b'}}];
const submitEnv = {state:submitState,$:()=>({}),activePaperType:()=> 'objective',setSaveStatus:()=>{},
  recoveryRows:async()=>unsentRows,recoveryDelete:async()=>{},syncAnswerControls:()=>{},updateProgress:()=>{},
  request:async(url)=>{if(url==='/api/responses') throw new Error('answer write failed');submittedWithUnsentAnswer=true;return {};},finishSubmission:async()=>{}};
vm.createContext(submitEnv);
vm.runInContext(extract('async function replayPending(', 'function scheduleHeartbeat(')+extract('async function submitExam(', 'function updateTimer(')+'\nthis.submit=submitExam;',submitEnv);
await submitEnv.submit();
console.log(JSON.stringify({probe:'submission has no unsent-answer guard',submittedWithUnsentAnswer,unsentRecoveryRows:unsentRows.length}));

const uploadSource = await readFile(new URL('../../functions/api/staff-cbt-paper.js',import.meta.url),'utf8');
let persistedExam = null;
const deleted = [];
const uploadEnv = {Response,console,
  requiredDeploymentIdentity:()=>({edition:'school'}),requireFirestoreEnv:()=>{},requireStaffSession:async()=>({username:'reviewer'}),
  readJsonBody:async()=>({Files:[{FileName:'paper.pdf',FileBase64:'synthetic'}]}),
  validateAcademicCbtTestInput:async()=>({context:{scope:{branchId:'main',section:'primary'}},record:{CbtTestId:'test'}}),
  validateAcademicCbtPaper:()=>({mimeType:'application/pdf',byteLength:1,fileName:'paper.pdf'}),
  academicCbtPaperDigest:async()=> 'digest',beginIdempotentRequest:async()=>({enabled:true,owner:true,documentId:'op'}),
  resolveDocumentStorage:async()=>({configured:true}),putStoredDocument:async()=>({documentUrl:'r2://synthetic-paper'}),
  saveAcademicCbtTest:async(_env,_user,input)=>{persistedExam=input;throw Object.assign(new Error('commit response lost'),{status:503,outcomeUncertain:true});},
  deleteStoredDocument:async(_env,url)=>deleted.push(url),failIdempotentRequest:async()=>{}
};
vm.createContext(uploadEnv);
vm.runInContext(uploadSource.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,''),uploadEnv);
await uploadEnv.onRequestPost({request:{},env:{}});
console.log(JSON.stringify({probe:'upload cleanup after database commit acknowledgement is lost',persistedPaper:persistedExam.PaperUrl,deleted}));

const storeSource = await readFile(new URL('../../functions/lib/academic-policy-store.js',import.meta.url),'utf8');
const assignment = {ActiveRevisionId:'old-active',DraftRevisionId:'reviewed-draft'};
const revisions = {};
const policyEnv = {...policies,crypto:webcrypto,
  getDocument:async(_env,collection,id)=>collection==='academicPolicyAssignments'?{...assignment}:revisions[id]||null,
  createDocumentIfAbsent:async(_env,_collection,id,revision)=>{
    revisions[id]=revision;
    // An activation commits after saveDraft has read its snapshot.
    assignment.ActiveRevisionId='newly-activated'; assignment.DraftRevisionId='';
    return {created:true};
  },
  upsertDocument:async(_env,_collection,_id,data)=>Object.assign(assignment,data)
};
vm.createContext(policyEnv);
vm.runInContext(storeSource.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,''),policyEnv);
await policyEnv.saveAcademicPolicyDraft({}, {scope:{Type:'organisation'},period:{Session:'2026/2027',Term:'First Term'},policy});
console.log(JSON.stringify({probe:'draft save races with policy activation',activePolicyAfterSave:assignment.ActiveRevisionId}));

records = {
  academicSessions:[row({SessionId:'s1',Name:'2026/2027'})],
  academicTerms:[row({SessionId:'s1',TermId:'t1',Name:'First Term',StartDate:'2026-09-01',EndDate:'2026-12-31'})],
  academicClasses:[row({ClassId:'c1'})],academicArms:[row({ArmId:'a1',ClassId:'c1'})]
};
let writes = [];
sandbox.batchCommitDocuments = async(_env,changes)=>{writes.push(...changes);return {};};
await sandbox.saveAcademicStudentAttendance({}, {...user,role:'Super Admin',schoolSectionAccess:'secondary'}, {...classroom,BranchId:'main',SchoolSection:'secondary',AttendanceDate:'2026-10-09',Mode:'Daily',Entries:[{StudentRef:'not-in-roster',Status:'Present'}]});
console.log(JSON.stringify({probe:'empty classroom roster accepts arbitrary student',savedStudent:writes.find(x=>x.collectionPath==='academicStudentAttendance')?.data.StudentRef}));

const v = row({...classroom,VersionId:'v1',Status:'Draft',Days:[{DayCode:'MON'}],Periods:[{PeriodCode:'P1',Name:'First',StartTime:'08:00',EndTime:'09:00',Kind:'Lesson',SortOrder:1,DayCodes:['ALL']}],__updateTime:'version-1'});
records.academicTimetableVersions = [v];
records.academicSubjects = [row({SubjectId:'math'})];
records.academicTeacherAllocations = [row({...classroom,TeacherUsername:'teacher',SubjectId:'math',AllocationRole:'Subject Teacher'})];
records.academicTimetableEntries = [];
const commits = [];
sandbox.batchCommitDocuments = async(_env,changes)=>new Promise(resolve=>{
  commits.push({changes,resolve});
  if(commits.length===2){for(const c of commits){records.academicTimetableEntries.push(...c.changes.filter(x=>x.collectionPath==='academicTimetableEntries').map(x=>x.data)); c.resolve({});}}
});
const lesson = {...classroom,BranchId:'main',SchoolSection:'secondary',VersionId:'v1',SubjectId:'math',TeacherUsername:'teacher',DayCode:'MON',StartPeriodCode:'P1'};
await Promise.all([sandbox.saveAcademicTimetableEntry({}, {...user,role:'Super Admin',schoolSectionAccess:'secondary'}, {...lesson}),sandbox.saveAcademicTimetableEntry({}, {...user,role:'Super Admin',schoolSectionAccess:'secondary'}, {...lesson})]);
console.log(JSON.stringify({probe:'concurrent timetable entries double-book the same slot',savedEntries:records.academicTimetableEntries.length,conflicts:timetable.academicTimetableConflicts(records.academicTimetableEntries[0],records.academicTimetableEntries).length}));
