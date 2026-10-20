const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const fail = (message, code = 'ACADEMIC_CBT_LATE_ENTRY_INVALID') => Object.assign(new Error(message), { status:409, code });
const refs = values => [...new Map(values.map(clean).filter(Boolean).map(ref => [lower(ref), ref])).values()].sort((a,b)=>a.localeCompare(b));

export function sameCbtAssessmentPeriod(row, source) {
  return row.SessionId === source.SessionId && row.TermId === source.TermId && row.SubjectId === source.SubjectId
    && lower(row.BranchId || 'main') === lower(source.BranchId || 'main') && row.SchoolSection === source.SchoolSection;
}

// The issued package remains immutable; reviewed additions are a separate roster.
export function academicCbtAllStudentRefs(record) {
  return refs([...(record.StudentRefs || []), ...(record.AdditionalStudentRefs || [])]);
}

export function academicCbtNewcomers(source, roster, tests, scores, memberships = roster) {
  const blocked = new Map();
  for (const test of tests.filter(row => sameCbtAssessmentPeriod(row, source)
      && ((row.AssessmentComponentId && row.AssessmentComponentId === source.AssessmentComponentId)
        || (clean(row.AssessmentComponentName) && lower(row.AssessmentComponentName) === lower(source.AssessmentComponentName))))) {
    for (const ref of academicCbtAllStudentRefs(test)) blocked.set(lower(ref), 'Already included in this assessment or an earlier sitting');
  }
  for (const ref of academicCbtAllStudentRefs(source)) blocked.set(lower(ref), 'Already in this test');
  for (const score of scores.filter(row => sameCbtAssessmentPeriod(row, source))) {
    const component = (score.ComponentScores || []).find(row => row.ComponentId === source.AssessmentComponentId);
    const cells = component?.Parts?.length ? component.Parts : [component];
    if (cells.some(cell => ['Numeric','Absent','Exempt'].includes(cell?.State))) {
      blocked.set(lower(score.StudentRef), 'An assessment mark or attendance decision is already recorded');
    }
  }
  const counts = new Map();
  for (const row of memberships) counts.set(lower(row.StudentRef), (counts.get(lower(row.StudentRef)) || 0) + 1);
  const Eligible = [], Excluded = [];
  for (const ref of refs(roster.map(row => row.StudentRef))) {
    const reason = counts.get(lower(ref)) > 1 ? 'Duplicate active class memberships need review' : blocked.get(lower(ref));
    if (reason) Excluded.push({ StudentRef:ref, Reason:reason }); else Eligible.push(ref);
  }
  return {Eligible, Excluded};
}

// Add a separate, linked sitting without reissuing eligibility to previous candidates.
export function academicCbtLateEntryPlan(source, roster, tests, scores, input = {}, now = Date.now(), memberships = roster) {
  if (!source || source.LateEntryParentId || lower(source.Status) === 'superseded') {
    throw fail('Choose the original, non-superseded test for late entry.');
  }
  if (!clean(source.LocalDownloadedAt || source.LocalPackageIssuedAt) && Date.parse(source.StartsAt) > now) {
    throw fail('This test has not started or been downloaded. Use Refresh student list instead.');
  }
  if (source.CloudPaperRemovedAt || !(source.PaperUrl || source.PaperFiles?.length)) {
    throw fail('The original cloud paper is no longer available. It must be restored before creating a late-entry sitting.');
  }
  const start = Date.parse(input.StartsAt);
  const duration = Number(source.ObjectiveDurationMinutes || source.DurationMinutes);
  const theory = source.PaperMode === 'split' ? Number(source.TheoryDurationMinutes) : 0;
  if (!Number.isFinite(start) || start <= now || !Number.isInteger(duration) || duration < 1 || duration > 480
      || !Number.isInteger(theory) || theory < 0 || theory > 480 || (source.PaperMode === 'split' && !theory)) {
    throw fail('Choose a future sitting date and time. The original paper must have a valid duration.');
  }
  const {Eligible:eligible, Excluded:excluded} = academicCbtNewcomers(source, roster, tests, scores, memberships);
  const selected = input.StudentRefs === undefined ? eligible : refs(Array.isArray(input.StudentRefs) ? input.StudentRefs : []);
  const eligibleSet = new Set(eligible.map(lower));
  if (selected.some(ref => !eligibleSet.has(lower(ref)))) throw fail('The selected students are no longer eligible. Review again.', 'ACADEMIC_CBT_LATE_ENTRY_CHANGED');
  if (selected.length > 1000) throw fail('Select no more than 1,000 late-entry students per sitting.');
  const canonical = new Map(eligible.map(ref => [lower(ref), ref]));
  return { Eligible:eligible, Excluded:excluded, StudentRefs:selected.map(ref=>canonical.get(lower(ref))),
    StartsAt:new Date(start).toISOString(), EndsAt:new Date(start + (duration + theory) * 60000).toISOString(),
    DurationMinutes:duration, TheoryDurationMinutes:theory };
}

export function academicCbtLateEntryRecord(source, plan, id, actor, timestamp) {
  const copy = Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('__')
    && !/^(Local|CloudPaperRemoved|Superseded|Roster|ScheduleUpdated)/.test(key)
    && !['AdditionalStudentRefs','RevisionToken','RecordId','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy','PackageDigest','ScheduleRevision'].includes(key)));
  return { ...copy, RecordId:id, CbtTestId:id, LateEntryParentId:source.CbtTestId,
    LateEntrySourceDigest:source.PackageDigest, LateEntryProtocolVersion:1,
    Title:`${source.Title || source.AssessmentComponentName} · Late entry`,
    StudentRefs:plan.StudentRefs, RosterCount:plan.StudentRefs.length,
    StartsAt:plan.StartsAt, EndsAt:plan.EndsAt, Status:'Scheduled', PackageRevision:1,
    CreatedAt:timestamp, CreatedBy:actor, UpdatedAt:timestamp, UpdatedBy:actor };
}
