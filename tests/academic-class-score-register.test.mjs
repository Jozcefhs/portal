import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { buildAcademicClassScoreRegister } from '../functions/lib/academic-class-score-register.js';
import { getAcademicClassScoreRegister } from '../functions/lib/academic-management.js';

const period = { SessionId: 's1', TermId: 't1', ClassId: 'grade7' };
const scheme = [{ Id: 'ca1', Name: 'CA1', MaximumScore: 100, WeightPercentage: 10 }, { Id: 'exam', Name: 'Exam', MaximumScore: 100, WeightPercentage: 70 }];
function fixture() {
  return { classes: [{ ClassId: 'grade7', Name: 'Grade 7' }, { ClassId: 'grade8', Name: 'Grade 8' }],
    sessions: [{ SessionId: 's1' }], terms: [{ TermId: 't1', SessionId: 's1' }],
    arms: [{ ArmId: 'a', Name: 'Excellence' }, { ArmId: 'b', Name: 'Brilliance' }],
    subjects: [{ SubjectId: 'maths', Name: 'Mathematics' }, { SubjectId: 'eng', Name: 'English' }],
    assessmentScheme: { Components: scheme },
    students: ['Ada', 'Ben', 'Chidi'].map((StudentName, index) => ({ StudentRef: `DCA/00${index + 1}`, StudentName })),
    studentMemberships: ['a', 'b', ''].map((ArmId, index) => ({ ...period, ArmId, StudentRef: `DCA/00${index + 1}`, Status: 'Active', SubjectIds: ['maths', 'eng'] })),
    scoreSheets: ['a', 'b'].map(ArmId => ({ ...period, SheetId: `sheet-${ArmId}`, ArmId, SubjectId: 'maths', AssessmentComponents: scheme, Status: 'Draft' })),
    studentScores: ['a', 'b'].map((ArmId, index) => ({ ...period, ArmId, SubjectId: 'maths', SheetId: `sheet-${ArmId}`, StudentRef: `DCA/00${index + 1}`,
      ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 80 + index, MaximumScore: 100 }] })) };
}

test('whole class includes all arms and unassigned students with subject/test columns', () => {
  const data = fixture(), before = structuredClone(data), report = buildAcademicClassScoreRegister(data, period);
  assert.equal(report.StudentCount, 3); assert.equal(report.SubjectCount, 2);
  assert.deepEqual(report.Rows.map(row => row.ArmName), ['Excellence', 'Brilliance', 'Unassigned']);
  const maths = report.Columns.find(column => column.SubjectId === 'maths' && column.TestId === 'ca1');
  assert.equal(report.Rows[0].Cells.find(cell => cell.ColumnId === maths.Id).RawScore, 80);
  assert.equal(report.Rows[1].Cells.find(cell => cell.ColumnId === maths.Id).RawScore, 81);
  assert.equal(report.Rows[2].Cells.find(cell => cell.ColumnId === maths.Id).State, 'Not recorded');
  assert.deepEqual(data, before);
});

test('other classes, terms and inactive memberships cannot enter the selected class register', () => {
  const data = fixture();
  for (const patch of [{ ClassId: 'grade8' }, { TermId: 'old' }, { SessionId: 'old' }, { Status: 'Withdrawn' }]) {
    data.studentMemberships.push({ ...data.studentMemberships[0], StudentRef: 'excluded', ...patch });
    data.studentScores.push({ ...data.studentScores[0], StudentRef: 'excluded', ...patch });
  }
  assert.deepEqual(buildAcademicClassScoreRegister(data, period).Rows.map(row => row.StudentRef), ['DCA/001', 'DCA/002', 'DCA/003']);
});

test('conflicting transferred-arm scores are flagged instead of silently choosing a mark', () => {
  const data = fixture(); data.studentScores.push({ ...data.studentScores[0], ArmId: 'b', SheetId: 'sheet-b' });
  data.studentMemberships.push({ ...data.studentMemberships[0], ArmId: 'b' });
  const report = buildAcademicClassScoreRegister(data, period);
  assert.equal(report.StudentCount, 3); assert.equal(report.Rows[0].RosterConflict, true);
  assert.equal(report.Rows[0].Cells.find(cell => cell.State === 'Review duplicate').RawScore, null);
});

test('retiring a stale membership keeps its recorded marks visible under the confirmed current arm', () => {
  const data = fixture();
  data.studentMemberships[0].Status = 'Archived';
  data.studentMemberships[0].SupersededByMembershipId = 'current';
  data.studentMemberships.push({ ...data.studentMemberships[0], MembershipId: 'current', Status: 'Active', ArmId: 'b', SupersededByMembershipId: '' });
  const originalScores = structuredClone(data.studentScores);
  const report = buildAcademicClassScoreRegister(data, period);
  const row = report.Rows.find(row => row.StudentRef === 'DCA/001');
  assert.equal(row.ArmName, 'Brilliance');
  assert.equal(row.RosterConflict, false);
  assert.equal(row.Cells.find(cell => cell.State === 'Numeric').RawScore, 80);
  assert.deepEqual(data.studentScores, originalScores);
});

test('a class-only recorded mark takes precedence over an empty cell in an arm score sheet', () => {
  const data=fixture();
  data.scoreSheets.push({...data.scoreSheets[0],SheetId:'class-only',ArmId:'',ClassOnlyScorebook:true});
  data.studentScores.push({...data.studentScores[0],SheetId:'class-only',ArmId:'',
    ComponentScores:[{ComponentId:'ca1',State:'Missing',RawScore:null},
      {ComponentId:'exam',State:'Numeric',RawScore:75,MaximumScore:100}]});
  const row=buildAcademicClassScoreRegister(data,period).Rows[0];
  assert.equal(row.Cells.filter(cell=>cell.State==='Numeric').length,2);
  assert.equal(row.Cells.some(cell=>cell.State==='Review duplicate'),false);
});

test('split tests, exemptions and absence retain their meaning and do not become zero or total marks', () => {
  const data = fixture();
  data.scoreSheets[0].AssessmentComponents = [{ Id: 'ca2', Name: 'CA2', ScoreEntryMode: 'objective-theory', ScoreParts: [{ Id: 'objective', Name: 'A' }, { Id: 'theory', Name: 'B' }] }];
  data.studentScores[0].ComponentScores = [{ ComponentId: 'ca2', Parts: [{ PartId: 'objective', State: 'Numeric', RawScore: 40, MaximumScore: 50 }, { PartId: 'theory', State: 'Exempt' }] }];
  data.studentScores[1].ComponentScores[0].State = 'Absent';
  const report = buildAcademicClassScoreRegister(data, period);
  assert.ok(report.Columns.some(column => column.TestId === 'ca2:objective'));
  assert.ok(report.Rows[0].Cells.some(cell => cell.RawScore === 40 && cell.MaximumScore === 50));
  assert.ok(report.Rows[0].Cells.some(cell => cell.State === 'Exempt'));
  assert.ok(report.Rows[1].Cells.some(cell => cell.State === 'Absent'));
});

test('class-wide API refuses ordinary teachers before any data loading', async () => {
  await assert.rejects(getAcademicClassScoreRegister({}, { role: 'Teacher', edition: 'school', allowedSections: ['academics'] }, period), { code: 'ACADEMIC_ACCESS_FORBIDDEN' });
});

test('class-wide API uses scoped bootstrap and rejects unpermitted class or period identifiers', async () => {
  const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function getAcademicClassScoreRegister('), source.indexOf('export async function getAcademicScorebookContext(')).replace('export ', '');
  const ctx = vm.createContext({ buildAcademicClassScoreRegister,
    requireCapability: (_user, capability) => assert.equal(capability, 'canReviewScores'),
    bootstrapAcademicManagement: async (_env, _user, input) => { assert.equal(input.View, 'scorebook'); return fixture(); },
    failure: (message, status, code) => Object.assign(new Error(message), { status, code }) });
  vm.runInContext(body, ctx);
  assert.equal((await ctx.getAcademicClassScoreRegister({}, {}, period)).classScoreRegister.StudentCount, 3);
  for (const patch of [{ ClassId: 'private' }, { TermId: 'private' }, { SessionId: 'private' }]) {
    await assert.rejects(ctx.getAcademicClassScoreRegister({}, {}, { ...period, ...patch }), { code: 'ACADEMIC_CLASS_REGISTER_FORBIDDEN' });
  }
});
