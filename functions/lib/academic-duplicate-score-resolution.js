import {queryCollection,getDocuments,getDocument} from './firestore.js';
import {academicAssessmentScheme,calculateAcademicStudentScore} from './academic-scorebook.js';
import {planRestoredScoreReviews} from './academic-score-restoration.js';
import {academicScoreCell,academicDuplicateValue,sameAcademicDuplicateValue,academicDuplicateRecorded,resolvedAcademicScoreEntry} from './academic-duplicate-score-values.js';
import {commitAcademicDuplicateScore} from './academic-duplicate-score-commit.js';

const clean=value=>String(value??'').trim(), lower=value=>clean(value).toLowerCase();
const fail=(message,status=409)=>Object.assign(new Error(message),{status,code:'ACADEMIC_DUPLICATE_SCORE_REVIEW'});
const plain=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('__')));
const active=row=>!['archived','inactive','withdrawn','transferred','expelled','graduated'].includes(lower(row.Status));
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
const id=row=>clean(row.__id||row.ScoreId||row.SheetId||row.MembershipId||row.ResultId);
const patch=(collectionPath,row,data)=>{
  if(!id(row)||!row.__updateTime)throw fail('This record has no current revision. Reload before resolving.');
  return {collectionPath,documentId:id(row),updateTime:row.__updateTime,updateMask:Object.keys(data),data};
};

async function context(env,scope,input,db){
  for(const field of ['SessionId','TermId','ClassId','SubjectId','StudentRef','TestId'])if(!clean(input[field])||clean(input[field]).length>1000)throw fail('Choose a student, subject and test from the score register.',400);
  const match=row=>row&&clean(row.BranchId||'main')===scope.branchId
    && (lower(row.SchoolSection)||scope.legacySection||'secondary')===scope.section
    && ['SessionId','TermId','ClassId'].every(field=>row[field]===input[field]);
  const filters=['SessionId','TermId','ClassId'].map(field=>({field,op:'==',value:input[field]}));
  filters.push({field:'BranchId',op:'==',value:scope.branchId},{field:'StudentRef',op:'in',value:[...new Set([clean(input.StudentRef),lower(input.StudentRef),clean(input.StudentRef).toUpperCase()])]});
  const queries=[];
  const read=async(collection,queryFilters,limit=101)=>{
    const rows=await db.queryCollection(env,collection,{filters:queryFilters,limit});
    if(rows.length>=limit)throw fail('Too many competing records to review safely. No partial list was shown.');
    queries.push({collection,filters:queryFilters,limit,rows});return rows;
  };
  const [memberRows,scoreRows,resultRows]=await Promise.all([
    read('academicStudentMemberships',filters),read('academicStudentScores',[...filters,{field:'SubjectId',op:'==',value:input.SubjectId}],21),read('academicResults',filters)
  ]);
  const members=memberRows.filter(row=>match(row)&&active(row));
  if(members.length!==1)throw fail('Resolve this student’s classroom membership first; exactly one current classroom is required.');
  const member=members[0];
  if(!(member.SubjectIds||[]).includes(input.SubjectId))throw fail('This subject is not in the student’s current saved subjects.');
  if(input.ArmId&&input.ArmId!==member.ArmId)throw fail('The student moved to another classroom. Reload the register.');
  const scores=scoreRows.filter(match);
  const current=scores.filter(row=>row.ArmId===member.ArmId);
  if(current.length!==1)throw fail('This case needs one saved score record in the current classroom. Resolve duplicate current-classroom records or load the subject scorebook first.');
  const target=current[0],targetCell=academicScoreCell(target,input.TestId);
  const candidates=scores.map(score=>({score,cell:academicScoreCell(score,input.TestId)})).filter(row=>academicDuplicateRecorded(row.cell));
  if(candidates.length<2||!targetCell)throw fail('There are no longer competing saved marks for this cell. Refresh the register.');
  const entries=candidates.map(({score,cell})=>({...academicDuplicateValue(cell),ScoreId:id(score),ArmId:score.ArmId,Resolutions:score.DuplicateScoreResolutions}));
  if(resolvedAcademicScoreEntry(entries,member,input.TestId))throw fail('This duplicate has already been resolved. Refresh the register.');
  const sheets=(await db.getDocuments(env,'academicScoreSheets',[...new Set(scores.map(s=>s.SheetId))])).filter(Boolean);
  if(sheets.length!==new Set(scores.map(s=>s.SheetId)).size||sheets.some(row=>!match(row)||row.SubjectId!==input.SubjectId))throw fail('A competing score is missing its matching subject sheet.');
  const sheet=sheets.find(row=>row.SheetId===target.SheetId);
  const documents=[...sheets];
  const versions=[...memberRows,...scoreRows,...resultRows,...documents].map(row=>[row.__name,row.__updateTime]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  if(versions.some(row=>!row[0]||!row[1]))throw fail('A current record revision is missing. Reload this review.');
  const revision=await digest([scope.branchId,scope.section,...['SessionId','TermId','ClassId','SubjectId','StudentRef','TestId'].map(key=>input[key]),versions]);
  return {match,read,queries,documents,member,target,targetCell,candidates,sheet,results:resultRows.filter(match),revision};
}

export function planAcademicDuplicateCell({target,source,sheet,testId,actor,resolutionId,candidates,reason}){
  const before=academicScoreCell(target,testId),chosen=academicScoreCell(source,testId);
  if(!before||!academicDuplicateRecorded(chosen)||!Number.isFinite(chosen.MaximumScore)||before.MaximumScore!==chosen.MaximumScore)throw fail('The competing marks use different assessment scales. Correct their layouts before choosing a mark.');
  const changed=!sameAcademicDuplicateValue(before,chosen);
  if(changed&&sheet.Status!=='Draft')throw fail('Reopen the full-term sheet before changing its saved mark. The record has not been changed.');
  let calculated={};
  const changes=changed?[{CellId:testId,Before:academicDuplicateValue(before),After:academicDuplicateValue(chosen),SourceScoreId:id(source),SourceSheetId:source.SheetId,SourceArmId:source.ArmId}]:[];
  if(changed){
    const components=structuredClone(target.ComponentScores);
    Object.assign(academicScoreCell({ComponentScores:components},testId),{State:chosen.State,RawScore:chosen.RawScore??null});
    const scheme=academicAssessmentScheme({Assessment:{Components:sheet.AssessmentComponents,GradeBands:sheet.GradeBands}},{RevisionId:sheet.AssessmentRevisionId});
    calculated=calculateAcademicStudentScore(scheme,components);
    for(const component of target.ComponentScores){
      for(const cell of component.Parts?.length?component.Parts:[component]){
        const key=`${component.ComponentId}${component.Parts?.length?`:${cell.PartId}`:''}`;
        if(!sameAcademicDuplicateValue(academicScoreCell(calculated,key),key===testId?chosen:cell))throw fail('This assessment layout cannot preserve the other saved cells exactly.');
      }
    }
  }
  const resolution={ResolutionId:resolutionId,WorkingScoreId:id(target),SelectedScoreId:id(source),ResolvedAt:actor.timestamp,ResolvedBy:actor.name,ResolvedByUsername:actor.username,Reason:reason,
    Candidates:[...candidates,...(candidates.some(row=>id(row.score)===id(target))?[]:[{score:target,cell:before}])]
      .map(({score,cell})=>({ScoreId:id(score),ArmId:score.ArmId,...academicDuplicateValue(cell)}))};
  return {changed,changes,resolution,data:{...calculated,DuplicateScoreResolutions:{...(target.DuplicateScoreResolutions||{}),[testId]:resolution},
    ...(changed?{SourceType:'ManualCorrection',SourceId:resolutionId,
      ManualScoreCorrections:[...(target.ManualScoreCorrections||[]),...changes.map(change=>({...change,Reason:reason,AuthorisedBy:actor.username,AuthorisedAt:actor.timestamp,CorrectedAt:actor.timestamp,CorrectedBy:actor.name}))]}:{}),
    UpdatedAt:actor.timestamp,UpdatedBy:actor.name,UpdatedByUsername:actor.username}};
}

export async function academicDuplicateScoreResolution(env,scope,input,actor,save=false,dependencies={}){
  const db={queryCollection,getDocuments,getDocument,commit:commitAcademicDuplicateScore,...dependencies};
  const reason=clean(input.Reason);
  if(save&&(!clean(input.RevisionToken)||!clean(input.SelectedScoreId)||reason.length<5||reason.length>1000))throw fail('Choose a saved mark and give a reason of 5–1000 characters.',400);
  const operation=save?`score-resolution-${await digest([scope.branchId,scope.section,input.StudentRef,input.TestId,input.RevisionToken,input.SelectedScoreId,actor.username,reason])}`:'';
  if(save){
    const receipt=await db.getDocument(env,'academicManagementAudit',operation);
    if(receipt){
      if(receipt.BranchId!==scope.branchId||receipt.SchoolSection!==scope.section||receipt.ActorUsername!==actor.username
          || ['SessionId','TermId','ClassId','SubjectId'].some(field=>receipt[field]!==input[field]))throw fail('This resolution receipt belongs to another scope.',403);
      return {ok:true,alreadyResolved:true,message:'This duplicate resolution was already saved. Refresh the register.',resolution:receipt.Resolution};
    }
  }
  const ctx=await context(env,scope,input,db);
  if(!save){
    const arms=await db.getDocuments(env,'academicArms',[...new Set(ctx.candidates.map(row=>row.score.ArmId))]);
    const published=ctx.results.some(row=>['Published','Locked'].includes(row.Status));
    return {ok:true,duplicateReview:{RevisionToken:ctx.revision,StudentRef:ctx.member.StudentRef,WorkingScoreId:id(ctx.target),TestId:input.TestId,
      candidates:ctx.candidates.map(({score,cell})=>{
        const changes=!sameAcademicDuplicateValue(cell,ctx.targetCell);
        const compatible=cell.MaximumScore===ctx.targetCell.MaximumScore;
        return {ScoreId:id(score),...academicDuplicateValue(cell),Classroom:arms.find(row=>row?.ArmId===score.ArmId)?.Name||'Previous classroom',
          CurrentClassroom:score.ArmId===ctx.member.ArmId,CreatedAt:score.CreatedAt||'',UpdatedAt:score.UpdatedAt||'',UpdatedBy:score.UpdatedBy||score.CreatedBy||'',
          SourceType:score.SourceType||'',Allowed:compatible&&(!changes||(ctx.sheet.Status==='Draft'&&!published)),
          BlockedReason:!compatible?'Different assessment scale':changes&&published?'Withdraw this student’s published result before changing the mark':changes&&ctx.sheet.Status!=='Draft'?'Reopen the full-term sheet before changing the mark':''};
      })}};
  }
  if(input.RevisionToken!==ctx.revision)throw fail('The competing marks or placement changed. Reload this review before choosing a mark.');
  const source=ctx.candidates.find(row=>id(row.score)===input.SelectedScoreId)?.score;
  if(!source)throw fail('Choose one of the saved competing marks.');
  const plan=planAcademicDuplicateCell({target:ctx.target,source,sheet:ctx.sheet,testId:input.TestId,actor,resolutionId:operation,candidates:ctx.candidates,reason});
  if(plan.changed&&ctx.results.some(row=>['Published','Locked'].includes(row.Status)))throw fail('Withdraw this student’s published result before changing its underlying mark.');
  const writes=[patch('academicStudentScores',ctx.target,plan.data),patch('academicStudentMemberships',ctx.member,{ScoreHistoryRevision:operation})];
  if(plan.changed){
    const [peers,memberRows]=await Promise.all([
      ctx.read('academicStudentScores',[{field:'SheetId',op:'==',value:ctx.sheet.SheetId}],2001),
      ctx.read('academicStudentMemberships',['BranchId','SessionId','TermId','ClassId','ArmId'].map(field=>({field,op:'==',value:ctx.member[field]})),2001)
    ]);
    if(peers.some(row=>!ctx.match(row)))throw fail('A score sheet contains records outside this review scope.');
    const roster=memberRows.filter(row=>ctx.match(row)&&active(row)&&(row.SubjectIds||[]).includes(input.SubjectId));
    const after=peers.map(row=>id(row)===id(ctx.target)?{...row,...plan.data}:row);
    const reviews=await planRestoredScoreReviews(ctx.sheet,roster,peers,after,[{StudentRef:ctx.member.StudentRef,changes:plan.changes}]);
    writes.push(patch('academicScoreSheets',ctx.sheet,{ComponentReviews:reviews,UpdatedAt:actor.timestamp,UpdatedBy:actor.name,LastSavedAt:actor.timestamp,LastSavedBy:actor.name}));
    for(const result of ctx.results)writes.push(patch('academicResults',result,{SubjectChangeRecalculationRequired:true,UpdatedAt:actor.timestamp,UpdatedBy:actor.name}));
  }
  const audit={AuditId:operation,Timestamp:actor.timestamp,Action:'RESOLVE DUPLICATE SCORE',RecordType:'studentmembership',RecordId:id(ctx.member),
    BranchId:scope.branchId,SchoolSection:scope.section,SessionId:input.SessionId,TermId:input.TermId,ClassId:input.ClassId,ArmId:ctx.member.ArmId,StudentRef:ctx.member.StudentRef,SubjectId:input.SubjectId,
    Actor:actor.name,ActorUsername:actor.username,ActorRole:actor.role,Details:reason,Summary:`${input.TestId}: competing score reviewed; ${plan.changed?'working mark corrected; review required':'current working mark retained'}. Original versions preserved.`,
    Resolution:plan.resolution,ScoresBefore:ctx.candidates.map(row=>plain(row.score)),TargetBefore:plain(ctx.target),TargetAfter:{...plain(ctx.target),...plan.data}};
  if(new TextEncoder().encode(JSON.stringify(audit)).byteLength>700000)throw fail('The score history is too large for one safe resolution. No record was changed.');
  writes.push({collectionPath:'academicManagementAudit',documentId:operation,exists:false,data:audit});
  await db.commit(env,writes,{queries:ctx.queries,documents:ctx.documents});
  return {ok:true,message:plan.changed?'Duplicate resolved. The chosen mark is saved; changed scores still require the normal review and result recalculation.':'Duplicate resolved. The current mark and its approvals are preserved.',resolution:plan.resolution};
}
