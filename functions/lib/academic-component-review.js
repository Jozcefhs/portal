import {academicAssessmentScheme, calculateAcademicStudentScore} from './academic-scorebook.js';

const clean=value=>String(value??'').trim();
const lower=value=>clean(value).toLowerCase();
const fail=(message,code='ACADEMIC_COMPONENT_REVIEW_INVALID')=>Object.assign(new Error(message),{status:409,code});

// Reviews approve a particular saved version of a test. A changed mark, roster
// or assessment definition invalidates that review without erasing its history.
export async function academicComponentReviews(sheet, roster, scores) {
  const scheme=academicAssessmentScheme({Assessment:{Components:sheet.AssessmentComponents||[],GradeBands:sheet.GradeBands||[]}}, {RevisionId:sheet.AssessmentRevisionId});
  const refs=[...new Set(roster.map(row=>lower(row.StudentRef)).filter(Boolean))].sort();
  const byStudent=new Map(refs.map(ref=>[ref,[]]));
  for(const score of scores)if(score.SheetId===sheet.SheetId)byStudent.get(lower(score.StudentRef))?.push(score);
  return Promise.all(scheme.Components.map(async component=>{
    const definition={...component,Required:true};
    const missing=[],snapshot=[];
    for(const ref of refs){
      const records=byStudent.get(ref);
      const cells=records.length===1?(records[0].ComponentScores||[]).filter(cell=>lower(cell.ComponentId)===lower(component.Id)):[];
      let calculated;
      try{calculated=calculateAcademicStudentScore({...scheme,Components:[definition]},cells);}
      catch{calculated=null;}
      if(records.length!==1||!calculated||calculated.UnresolvedComponentIds.length)missing.push(ref);
      snapshot.push([ref,records.length,calculated?.ComponentScores||cells]);
    }
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([sheet.SheetId,definition,snapshot])));
    const digest=[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
    const previous=sheet.ComponentReviews?.[component.Id];
    const unchanged=previous?.ScoreDigest===digest;
    return {ComponentId:component.Id,Name:component.Name,RosterCount:refs.length,CompleteCount:refs.length-missing.length,
      MissingCount:missing.length,Complete:refs.length>0&&!missing.length,ScoreDigest:digest,
      Status:unchanged?previous.Status:'Draft',PreviousStatus:previous?.Status||'',Stale:Boolean(previous&&!unchanged),
      ReviewedBy:unchanged?clean(previous[`${previous.Status}By`]):'',
      AllowPendingStudents:unchanged&&previous?.AllowPendingStudents===true,
      MissingStudentRefs:missing, PendingStudentCount:missing.length};
  }));
}

export function academicComponentReviewTransition(sheet, review, target, permissions={}, actor={}, reason='', allowPending=false) {
  if(!review)throw fail('Choose an assessment test from this score sheet.');
  if(clean(sheet.Status||'Draft')!=='Draft')throw fail('The full score sheet has already been submitted or approved. Reopen it before changing an individual test review.');
  if(!['Draft','Submitted','Approved','Locked'].includes(target))throw fail('Choose a valid test review status.');
  const pendingAllowed = review.CompleteCount > 0 && review.MissingCount > 0;
  if(['Submitted','Approved','Locked'].includes(target)&&!review.Complete&&!pendingAllowed)throw fail(`${review.Name}: ${review.MissingCount} of ${review.RosterCount} students still need required marks. Other tests do not block this test.`, 'ACADEMIC_COMPONENT_INCOMPLETE');
  if(target==='Submitted'&&!permissions.canEnterScores)throw Object.assign(fail('Only an authorised score officer may submit this test.'),{status:403});
  if(target==='Approved'&&!permissions.canReviewScores)throw Object.assign(fail('Only an academic reviewer may approve this test.'),{status:403});
  if(target==='Locked'&&!permissions.canApproveScores)throw Object.assign(fail('Only an academic approver may lock this test.'),{status:403});
  if(target==='Draft'&&(!permissions.canManageScoreCorrections||!clean(reason)))throw Object.assign(fail('An authorised correction officer must give a reason to reopen this test.'),{status:403});
  const current=review.Status;
  if(current===target&&!review.Stale)return null;
  const normal=(current==='Draft'&&target==='Submitted')||(current==='Submitted'&&target==='Approved')||(current==='Approved'&&target==='Locked');
  if(!normal&&!(target==='Draft'&&['Submitted','Approved','Locked'].includes(current)))throw fail(`${review.Name} is ${current}. Submit its current saved marks before approval.`);
  const event=target==='Draft'?'Reopened':target;
  return {...(target==='Submitted'?{}:(sheet.ComponentReviews?.[review.ComponentId]||{})),ComponentId:review.ComponentId,Name:review.Name,Status:target,
    CompleteCount:review.CompleteCount, AllowPendingStudents:pendingAllowed, PendingStudentRefs:pendingAllowed?review.MissingStudentRefs:[],
    ScoreDigest:review.ScoreDigest,RosterCount:review.RosterCount,[`${event}At`]:actor.timestamp,
    [`${event}By`]:actor.name,[`${event}ByUsername`]:actor.username,...(target==='Draft'?{ReopenReason:clean(reason)}:{})};
}
