import {queryCollectionPages} from './firestore.js';
import {scopedCollectionPath} from './school-scope.js';
import {academicPolicyIssues, academicPolicyScopeChain} from './academic-policy.js';
import {loadAcademicPolicyView} from './academic-policy-store.js';
import {calculateAcademicMidTermResultDrafts, calculateAcademicTermResultDrafts} from './academic-term-results.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const active = row => !['archived', 'inactive', 'withdrawn', 'transferred'].includes(lower(row.Status));
const id = row => clean(row.RecordId || row.MembershipId || row.ResultId || row.__id);
const ids = values => [...new Set((values || []).map(lower).filter(Boolean))].sort();
const reference = row => clean(row.StudentRef || row.AdmissionNo || row.AccountRef);
const kind = row => lower(row.ResultType || 'End of Term');
const sameScope = (row, scope) => lower(row.BranchId || 'main') === lower(scope.BranchId)
  && lower(row.SchoolSection || 'secondary') === lower(scope.SchoolSection);
const samePeriod = (row, scope) => sameScope(row, scope) && row.SessionId === scope.SessionId && row.TermId === scope.TermId;
const inClass = (row, scope) => samePeriod(row, scope) && row.ClassId === scope.ClassId;
const displayName = row => clean(row?.DisplayName || row?.StudentName || row?.FullName || row?.Name
  || [row?.FirstName, row?.MiddleName, row?.Surname || row?.LastName].filter(Boolean).join(' '));
const scoreSignature = subjects => JSON.stringify((subjects || []).map(subject => [lower(subject.SubjectId),
  Number(subject.Total ?? subject.WeightedTotal), (subject.ComponentScores || []).map(component => [lower(component.ComponentId),
    component.State, component.RawScore, (component.Parts || []).map(part => [part.PartId, part.State, part.RawScore])])
]).sort((a, b) => a[0].localeCompare(b[0])));

// Pure projection: it neither repairs records nor advances any approval state.
export function buildAcademicResultsReadiness(state, scope, policyView = {}, students = [], relatedMemberships = []) {
  const resultType = scope.ResultType === 'Mid-Term' ? 'Mid-Term' : 'End of Term';
  const midTerm = resultType === 'Mid-Term';
  const schoolClass = (state.classes || []).find(row => row.ClassId === scope.ClassId);
  const session = (state.sessions || []).find(row => row.SessionId === scope.SessionId);
  const term = (state.terms || []).find(row => row.TermId === scope.TermId && row.SessionId === scope.SessionId);
  const memberships = (state.studentMemberships || []).filter(row => inClass(row, scope));
  const current = memberships.filter(active);
  const arms = new Map((state.arms || []).map(row => [row.ArmId, row]));
  const subjects = new Map((state.subjects || []).flatMap(row => ['SubjectId','RecordId','__id','Id']
    .filter(field => clean(row[field])).map(field => [lower(row[field]), row])));
  const people = new Map(students.map(row => [lower(reference(row)), row]));
  const results = (state.termResults || []).filter(row => inClass(row, scope) && kind(row) === lower(resultType));
  const allMemberships = [...new Map([...memberships, ...relatedMemberships].filter(row => samePeriod(row, scope))
    .map(row => [id(row) || `${row.StudentRef}|${row.ClassId}|${row.ArmId}|${row.Status}`, row])).values()];
  const blockers = [], warnings = [], nextSteps = [], untaught = [], seen = new Set();
  const label = row => {
    const ref = reference(row), name = displayName(people.get(lower(ref))) || displayName(row);
    return [name, ref, arms.get(row.ArmId)?.Name || (row.ArmId ? 'Unknown classroom' : 'Classroom not assigned')].filter(Boolean).join(' · ');
  };
  const add = (list, code, message, row = {}) => {
    const key = [list === blockers ? 'blocker' : list === warnings ? 'warning' : 'step', code, id(row), reference(row), message].join('|');
    if (seen.has(key)) return;
    seen.add(key);list.push({Code:code, Message:message, StudentRef:reference(row), RecordId:id(row),
      RecordLabel:reference(row) ? label(row) : schoolClass?.Name || 'Selected class'});
  };
  if (!schoolClass || !session || !term) add(blockers, 'INVALID_PERIOD', 'Choose a valid class, academic session and a term belonging to that session.');
  if (!current.length) add(blockers, 'NO_CURRENT_STUDENTS', 'No active student memberships are assigned to this class in the selected term.');
  for (const membership of memberships.filter(row => !active(row))) {
    add(warnings, 'HISTORICAL_MEMBERSHIP', `${membership.Status || 'Inactive'} membership retained for history. It is excluded from current result checks.`, membership);
  }
  const policy = policyView.ActivePolicy || {};
  const policyProblems = !(policyView.Sources || []).some(row => row.RevisionId)
    ? ['Activate the academic policy for this class and term before calculating results.']
    : academicPolicyIssues(policy, {forActivation:true}).map(row => row.message);
  let ready = 0, published = 0;
  for (const membership of current) {
    const start = blockers.length, studentRef = lower(membership.StudentRef);
    const matching = results.filter(row => lower(row.StudentRef) === studentRef);
    const result = matching[0];
    const isPublished = ['published', 'locked'].includes(lower(result?.Status));
    if (result?.CalculationPending) add(blockers,'STUDENT_PENDING','This student remains pending after calculation. Complete the missing tests and recalculate this student’s draft; other complete students can proceed.',membership);
    const duplicates = allMemberships.filter(row => active(row) && lower(row.StudentRef) === studentRef);
    if (!studentRef) add(blockers, 'MISSING_STUDENT_REFERENCE', 'Link this current membership to the correct student.', membership);
    if (duplicates.length > 1) add(blockers, 'DUPLICATE_CURRENT_MEMBERSHIP', 'This student has more than one active membership in the selected period. Resolve the current placement while preserving membership history and scores.', membership);
    if (!arms.has(membership.ArmId) || arms.get(membership.ArmId)?.ClassId !== membership.ClassId) {
      add(blockers, 'CURRENT_CLASSROOM_REQUIRED', 'Assign this student to their actual classroom in this class. An unassigned or mismatched arm cannot produce a classroom result.', membership);
    }
    if (matching.length > 1) add(blockers, 'DUPLICATE_CURRENT_RESULT', `More than one ${resultType.toLowerCase()} result exists for this student and classroom. Review the snapshots without deleting scores.`, membership);
    if (!people.has(studentRef)) add(warnings, 'PROFILE_LOOKUP', 'No matching profile was returned for this admission number. Verify the student profile; this is not a missing-mark finding.', membership);
    const assigned = membership.SubjectIds || [];
    for (const subjectId of assigned) if (!subjects.has(lower(subjectId))) add(blockers, 'MISSING_SUBJECT_REFERENCE', 'A currently assigned subject is missing from the catalogue. Restore or correctly relink the subject; preserve its existing scores.', membership);
    const hasTrade = assigned.some(subjectId => lower(subjects.get(lower(subjectId))?.SeniorChoiceRole) === 'trade');
    if (/senior/i.test(membership.SchoolStage || schoolClass?.SchoolStage || '') && !hasTrade) {
      add(warnings, 'TRADE_SELECTION_REVIEW', 'No assigned subject is currently classified as Trade. Review the saved choices; a Trade subject already selected but not taught should remain selected.', membership);
    }
    if (/pending/i.test(clean(membership.CurriculumStatus))) {
      add(warnings, 'SAVED_CURRICULUM_FLAG', `Saved curriculum flag: ${membership.CurriculumStatus}. Actual subject and mark checks below determine readiness; this flag alone does not block results.`, membership);
    }
    if (result && (result.ArmId !== membership.ArmId || result.SubjectChangeRecalculationRequired || (result.SubjectSelectionSnapshot &&
      ['SubjectIds', 'CoreSubjectIds', 'TradeSubjectIds', 'OptionalSubjectIds'].some(field => JSON.stringify(ids(membership[field])) !== JSON.stringify(ids(result.SubjectSelectionSnapshot[field])))))) {
      add(blockers, 'RESULT_SUBJECTS_CHANGED', 'Subject selections changed after calculation. Recalculate the draft; published results require controlled withdrawal before correction.', membership);
    }
    if (result && !isPublished && academicPolicyIssues(result.PolicySnapshot || {}, {forActivation:true}).length) {
      add(blockers, 'RESULT_POLICY_INCOMPLETE', 'The saved result has an incomplete policy snapshot. Activate the policy and recalculate the draft before publication.', membership);
    }
    const notTaught = midTerm ? result?.NotTaughtSubjects || [] : [];
    const sheets = (state.scoreSheets || []).filter(row => inClass(row, scope) && row.ArmId === membership.ArmId);
    const sheetIds = new Set(sheets.map(row => row.SheetId));
    const scores = (state.studentScores || []).filter(row => lower(row.StudentRef) === studentRef && sheetIds.has(row.SheetId));
    if (!isPublished && new Set(scores.map(row => row.SheetId)).size !== scores.length) {
      add(blockers, 'DUPLICATE_SCORE', 'More than one score record exists for this student and subject sheet. Review the duplicate references without deleting marks.', membership);
    }
    let untaughtValid = isPublished;
    if (blockers.length === start && !isPublished) {
      if (policyProblems.length && !result) {
        for (const message of policyProblems) add(blockers, 'CALCULATION_POLICY', message);
      } else {
        const input = {...scope, ArmId:membership.ArmId, Memberships:[membership],
          ScoreSheets:sheets, StudentScores:scores,
          Subjects:state.subjects, Policy:result?.PolicySnapshot || policy, ResultType:resultType,
          NotTaughtSubjectIds:notTaught.map(row => row.SubjectId), NotTaughtReason:notTaught.map(row => row.Reason).filter(Boolean).join('; ').slice(0,1000)};
        let calculation;
        try { calculation = (midTerm ? calculateAcademicMidTermResultDrafts : calculateAcademicTermResultDrafts)(input); }
        catch (error) { calculation = {Ready:false,Issues:[`Review this student's saved assessments: ${error.message}`],Results:[]}; }
        untaughtValid = calculation.Ready;
        for (const message of calculation.Issues) add(blockers, 'CALCULATION_BLOCKED', message, membership);
        if (calculation.Ready && result && scoreSignature(result.Subjects) !== scoreSignature(calculation.Results[0].Subjects)) {
          add(blockers, 'RESULT_MARKS_CHANGED', 'The saved result differs from the current eligible marks. Reopen if necessary and recalculate the draft before approval or publication.', membership);
        }
      }
    }
    for (const subject of notTaught) untaught.push({StudentRef:membership.StudentRef, RecordLabel:label(membership),
      SubjectName:subject.SubjectName || subjects.get(lower(subject.SubjectId))?.Name || 'Subject',
      Message:untaughtValid ? 'Not taught this mid-term. Excluded from the average; subject selection and scores are retained.'
        : 'Saved untaught-subject decision. Resolve the result blockers above before relying on this exception.'});
    if (blockers.length > start || policyProblems.length && !isPublished && !result) continue;
    if (isPublished) { published++;continue; }
    const next = !result ? ['CALCULATE', 'Calculate the mid-term or end-of-term results in Results → Calculate results.']
      : lower(result.Status) === 'calculated draft' ? ['REVIEW', 'Review the calculated result, then approve and publish it.']
        : lower(result.Status) === 'reviewed' ? ['APPROVE', 'Approve the reviewed result, then publish it.']
          : lower(result.Status) === 'withdrawn' ? ['REOPEN', 'Reopen the withdrawn result through the controlled workflow, recalculate if needed, then review and approve it.']
            : lower(result.Status) === 'approved' ? null : ['CHECK_STATUS', 'Review the saved result status before publication.'];
    if (next) add(nextSteps, next[0], next[1], membership); else ready++;
  }
  const currentRefs = new Set(current.map(row => lower(row.StudentRef)));
  for (const result of results.filter(row => !currentRefs.has(lower(row.StudentRef)))) add(warnings, 'HISTORICAL_RESULT', 'Result retained for a student without an active membership in this class and term. It does not block current students.', result);
  return {Scope:{...scope, ResultType:resultType, ClassName:schoolClass?.Name || '', AcademicSession:session?.Name || '', Term:term?.Name || ''},
    Status:blockers.length ? (blockers.every(row=>row.StudentRef) && (ready || published || nextSteps.length) ? 'Some students need attention' : 'Blocked') : nextSteps.length ? 'Workflow steps remaining' : ready ? 'Ready to publish' : published ? 'Published' : 'Not ready',
    Blockers:blockers, Warnings:warnings, NextSteps:nextSteps, UntaughtSubjects:untaught,
    Counts:{Students:new Set(current.map(row => lower(row.StudentRef))).size, Blockers:blockers.length, Warnings:warnings.length,
      NextSteps:nextSteps.length, ReadyToPublish:ready, Published:published, UntaughtSubjects:untaught.length}};
}

export async function loadAcademicResultsReadiness(env, state, scope, options = {}) {
  const read = options.read || queryCollectionPages;
  const readPolicy = options.readPolicy || loadAcademicPolicyView;
  const session = state.sessions.find(row => row.SessionId === scope.SessionId);
  const term = state.terms.find(row => row.TermId === scope.TermId && row.SessionId === scope.SessionId);
  const schoolClass = state.classes.find(row => row.ClassId === scope.ClassId);
  if (!session || !term || !schoolClass) return buildAcademicResultsReadiness(state, scope);
  const selected = state.studentMemberships.filter(row => inClass(row, scope));
  const refs = [...new Set(selected.map(row => clean(row.StudentRef)).filter(Boolean))];
  const students = [], related = [];
  for (let offset = 0; offset < refs.length; offset += 10) {
    const batch = refs.slice(offset, offset + 10);
    const query = {filters:[{field:'AdmissionNo',op:'in',value:batch}],pageSize:100,maxRows:1000,
      select:['AdmissionNo','AccountRef','DisplayName','StudentName','Name','FirstName','MiddleName','Surname','LastName','BranchId','SchoolSection']};
    const scoped = await read(env, scopedCollectionPath('students', scope.BranchId, scope.SchoolSection), query);
    students.push(...scoped.filter(row => sameScope({...row, BranchId:row.BranchId || scope.BranchId, SchoolSection:row.SchoolSection || scope.SchoolSection}, scope)));
    const missing = batch.filter(ref => !students.some(row => lower(reference(row)) === lower(ref)));
    if (missing.length) students.push(...(await read(env,'students',{...query,filters:[{field:'AdmissionNo',op:'in',value:missing},
      ...(scope.BranchId === 'main' ? [] : [{field:'BranchId',op:'==',value:scope.BranchId}])]})).filter(row => sameScope(row,scope)));
    // Look for duplicate placements only for these students, never every branch membership.
    related.push(...await read(env, 'academicStudentMemberships', {filters:[{field:'BranchId',op:'==',value:scope.BranchId},
      {field:'SessionId',op:'==',value:scope.SessionId},{field:'TermId',op:'==',value:scope.TermId},
      {field:'StudentRef',op:'in',value:batch}],pageSize:100,maxRows:1000}));
  }
  const chain = academicPolicyScopeChain({BranchId:scope.BranchId,SectionId:scope.SchoolSection,ClassId:scope.ClassId});
  const policyView = await readPolicy(env,{scope:chain.at(-1),scopeChain:chain,period:{Session:session.Name,Term:term.Name}});
  return {...buildAcademicResultsReadiness(state,scope,policyView,students,related),CheckedAt:new Date().toISOString()};
}
