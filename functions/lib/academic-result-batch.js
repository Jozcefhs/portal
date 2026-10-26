import {buildAcademicResultsReadiness} from './academic-results-readiness.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const stages = ['Calculated Draft', 'Reviewed', 'Approved', 'Published', 'Locked'];
const active = row => !['archived','inactive','withdrawn','transferred'].includes(lower(row.Status));
const sameScope = (row, scope) => ['SessionId','TermId','ClassId','ArmId'].every(key => row[key] === scope[key])
  && lower(row.BranchId || 'main') === lower(scope.BranchId)
  && lower(row.SchoolSection || 'secondary') === lower(scope.SchoolSection)
  && lower(row.ResultType || 'End of Term') === lower(scope.ResultType);

// Validate each selected student independently. This plans status/metadata
// changes only; calculation snapshots, marks and memberships are never altered.
export function planAcademicResultBatch(state, scope, items, action, relatedMemberships = []) {
  const target = action === 'ReviewApprovePublish' ? 'Published' : action;
  if (!['Reviewed','Approved','Published'].includes(target)) throw new Error('Choose review, approval or publication.');
  const selected = new Set(items.map(item => item.ResultId));
  const records = new Map(state.termResults.filter(row => sameScope(row,scope)).map(row => [row.ResultId,row]));
  const refs = new Set([...records.values()].filter(row => selected.has(row.ResultId)).map(row => lower(row.StudentRef)));
  const readiness = buildAcademicResultsReadiness({...state,
    studentMemberships:state.studentMemberships.filter(row => refs.has(lower(row.StudentRef)))}, scope, {}, [], relatedMemberships);
  const changes = [], outcomes = [];
  for (const item of items) {
    const row = records.get(item.ResultId);
    const outcome = {ResultId:item.ResultId,Outcome:'Pending',message:''};
    outcomes.push(outcome);
    if (!row) {outcome.Outcome='Not eligible';outcome.message='This result is outside the selected classroom, term or report type.';continue;}
    outcome.StudentRef=row.StudentRef;outcome.result=row;
    const index=stages.indexOf(row.Status), targetIndex=stages.indexOf(target);
    if (index >= targetIndex) {outcome.Outcome='Already complete';outcome.message=`Already ${row.Status.toLowerCase()}; unchanged.`;continue;}
    if (index < 0 || (action !== 'ReviewApprovePublish' && index !== targetIndex-1)) {
      outcome.Outcome='Not eligible';outcome.message='Complete the preceding result workflow stage first. Withdrawn results must be reopened separately.';continue;
    }
    if (!clean(item.RevisionToken) || clean(item.RevisionToken) !== clean(row.__updateTime)) {
      outcome.Outcome='Conflict';outcome.message='This result changed since it was loaded. Review the latest result before trying again.';continue;
    }
    const membership = state.studentMemberships.find(member => active(member) && lower(member.StudentRef) === lower(row.StudentRef)
      && ['SessionId','TermId','ClassId','ArmId'].every(key => member[key] === row[key]));
    const issues = [...new Set(readiness.Blockers.filter(issue => !issue.StudentRef || lower(issue.StudentRef) === lower(row.StudentRef))
      .map(issue => issue.Message))];
    if (!membership) issues.push('No active membership matches this result’s classroom and term. Review the placement before proceeding.');
    if (issues.length) {
      outcome.message=issues.join(' ');
      // Preserve reviewed snapshots too, but block their publication until the
      // existing correction/recalculation workflow has resolved the missing marks.
      if (!row.CalculationPending) changes.push({previous:row,pendingIssues:issues,stages:[]});
      continue;
    }
    outcome.Outcome='Updated';outcome.message=`${target}${action==='ReviewApprovePublish'?' through review and approval':''}.`;
    changes.push({previous:row,stages:stages.slice(index+1,targetIndex+1)});
  }
  return {changes,outcomes,target};
}
