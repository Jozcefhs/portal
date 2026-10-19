// Read-only class (all arms) projection. Call only after staff/branch/section checks.
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const active = row => !['inactive', 'archived', 'withdrawn', 'transferred'].includes(lower(row.Status));
const cells = score => (score.ComponentScores || []).flatMap(component => component.Parts?.length
  ? component.Parts.map(part => ({ ...part, TestId: `${component.ComponentId}:${part.PartId}` }))
  : [{ ...component, TestId: component.ComponentId }]);

export function buildAcademicClassScoreRegister(data = {}, input = {}) {
  const inPeriod = row => row.SessionId === input.SessionId && row.TermId === input.TermId && row.ClassId === input.ClassId;
  const schoolClass = (data.classes || []).find(row => row.ClassId === input.ClassId);
  if (!schoolClass || !input.SessionId || !input.TermId) throw new Error('Choose a class, academic session and term.');
  const roster = new Map();
  for (const membership of (data.studentMemberships || []).filter(row => inPeriod(row) && active(row))) {
    const key = lower(membership.StudentRef);
    if (!key) continue;
    const entry = roster.get(key) || [];
    entry.push(membership); roster.set(key, entry);
  }
  const sheets = (data.scoreSheets || []).filter(inPeriod);
  const subjectIds = new Set([...sheets.map(row => row.SubjectId), ...[...roster.values()].flatMap(rows => rows.flatMap(row => row.SubjectIds || []))]);
  const columns = new Map();
  for (const SubjectId of subjectIds) {
    const subject = (data.subjects || []).find(row => row.SubjectId === SubjectId);
    if (subject?.AssessmentCategory === 'TimetableOnly') continue;
    const definitions = sheets.filter(row => row.SubjectId === SubjectId).flatMap(row => row.AssessmentComponents || []);
    if (!definitions.length) definitions.push(...(data.assessmentScheme?.Components || []));
    for (const component of definitions) {
      const parts = component.ScoreEntryMode === 'objective-theory' && component.ScoreParts?.length ? component.ScoreParts : [null];
      for (const part of parts) {
        const TestId = `${component.Id}${part ? `:${part.Id}` : ''}`;
        const Id = JSON.stringify([SubjectId, TestId]);
        columns.set(Id, { Id, SubjectId, SubjectName: clean(subject?.Name || SubjectId), TestId,
          TestName: `${component.Name || component.Id}${part ? ` · ${part.Name || part.Id}` : ''}` });
      }
    }
  }
  const values = new Map();
  for (const score of (data.studentScores || []).filter(inPeriod)) {
    if (!roster.has(lower(score.StudentRef))) continue;
    const sheet = sheets.find(row => row.SheetId === score.SheetId);
    if (!sheet) continue;
    for (const cell of cells(score)) {
      const Id = JSON.stringify([score.SubjectId, cell.TestId]);
      if (!columns.has(Id)) columns.set(Id, { Id, SubjectId: score.SubjectId,
        SubjectName: clean((data.subjects || []).find(row => row.SubjectId === score.SubjectId)?.Name || score.SubjectId),
        TestId: cell.TestId, TestName: cell.TestId });
      const key = JSON.stringify([lower(score.StudentRef), Id]);
      const entries = values.get(key) || [];
      entries.push({ State: cell.State, RawScore: cell.RawScore ?? null, MaximumScore: cell.MaximumScore ?? null,
        SheetStatus: clean(sheet.Status), ArmId: clean(score.ArmId) });
      values.set(key, entries);
    }
  }
  const Columns = [...columns.values()].sort((a, b) => a.SubjectName.localeCompare(b.SubjectName) || a.TestId.localeCompare(b.TestId, undefined, { numeric: true }));
  const people = new Map((data.students || []).map(row => [lower(row.StudentRef), row.StudentName || row.DisplayName]));
  const Rows = [...roster].map(([ref, memberships]) => {
    const member = memberships[0];
    const ArmName = [...new Set(memberships.map(row => clean((data.arms || []).find(arm => arm.ArmId === row.ArmId)?.Name || row.ArmId || 'Unassigned')))].join(', ');
    return { StudentRef: member.StudentRef, StudentName: clean(people.get(ref) || member.StudentName || member.StudentRef), ArmName,
      RosterConflict: memberships.length > 1,
      Cells: Columns.map(column => {
        const entries = values.get(JSON.stringify([ref, column.Id])) || [];
        if (entries.length > 1) return { ColumnId: column.Id, State: 'Review duplicate', RawScore: null, MaximumScore: null };
        if (entries.length) return { ColumnId: column.Id, ...entries[0] };
        const offered = memberships.some(row => (row.SubjectIds || []).includes(column.SubjectId));
        return { ColumnId: column.Id, State: offered ? 'Not recorded' : 'Not enrolled', RawScore: null, MaximumScore: null };
      }) };
  }).sort((a, b) => a.StudentName.localeCompare(b.StudentName) || a.StudentRef.localeCompare(b.StudentRef));
  return { ClassId: input.ClassId, ClassName: clean(schoolClass.Name), SessionId: input.SessionId, TermId: input.TermId,
    Columns, Rows, StudentCount: Rows.length, SubjectCount: new Set(Columns.map(row => row.SubjectId)).size };
}
