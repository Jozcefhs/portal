import {academicCbtAllStudentRefs, academicCbtNewcomers} from './academic-cbt-late-entry.js';

export function academicCbtRosterAdditionPlan(source, roster, tests, scores, memberships = roster) {
  if (source.Status !== 'Scheduled' || !(source.LocalDownloadedAt || source.LocalPackageIssuedAt)) {
    throw Object.assign(new Error('Choose a downloaded scheduled test. Use Refresh student list for an unissued test.'),
      {status:409, code:'ACADEMIC_CBT_ROSTER_ADDITION_INVALID'});
  }
  const review = academicCbtNewcomers(source, roster, tests, scores, memberships);
  const previous = academicCbtAllStudentRefs(source);
  if (previous.length + review.Eligible.length > 1000) {
    throw Object.assign(new Error('The complete candidate list exceeds 1,000 students. No partial list was saved.'), {status:413});
  }
  return {...review, Added:review.Eligible, Removed:[], PreviousCount:previous.length,
    RosterCount:previous.length + review.Eligible.length,
    Rule:'Add only. Existing students, papers, schedules, attempts and scores are preserved. Pull this test on every updated CBT server.'};
}
