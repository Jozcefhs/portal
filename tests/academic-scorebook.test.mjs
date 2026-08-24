import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import {
  ACADEMIC_MANAGEMENT_COLLECTIONS,
  ACADEMIC_SCOREBOOK_STATE_KEYS,
  academicCbtScoreBatchDigest,
  academicLockedScoreChanges,
  academicLockedScoreComponentIds,
  academicScoreTeacherAllocations,
  createAcademicCbtSyncPreparation,
  verifyAcademicCbtSyncPreparation,
  verifyAcademicCbtScoreSignature
} from '../functions/lib/academic-management.js';
import {
  academicAssessmentScheme,
  academicScoreSourceIssues,
  calculateAcademicStudentScore,
  normalizeAcademicScoreImportRows,
  validateAcademicCbtScoreBatch,
  validateAcademicScoreImport
} from '../functions/lib/academic-scorebook.js';

const portalRoot = new URL('../', import.meta.url);
const academicManagementSource = await readFile(new URL('functions/lib/academic-management.js', portalRoot), 'utf8');
const adminSource = await readFile(new URL('js/admin.js', portalRoot), 'utf8');
const backendSource = await readFile(new URL('functions/api/backend.js', portalRoot), 'utf8');
const styleSource = await readFile(new URL('css/style.css', portalRoot), 'utf8');

const policy = {
  Assessment: {
    Components: [
      { Id: 'ca', Name: 'Continuous Assessment', MaximumScore: 40, WeightPercentage: 40, Required: true, Order: 1 },
      { Id: 'exam', Name: 'Examination', MaximumScore: 60, WeightPercentage: 60, Required: true, Order: 2 }
    ],
    GradeBands: [
      { Grade: 'A', MinimumPercentage: 70, MaximumPercentage: 100, GradePoint: 5, Remark: 'Excellent', Classification: 'pass' },
      { Grade: 'B', MinimumPercentage: 50, MaximumPercentage: 69.99, GradePoint: 4, Remark: 'Good', Classification: 'pass' },
      { Grade: 'F', MinimumPercentage: 0, MaximumPercentage: 49.99, GradePoint: 0, Remark: 'Fail', Classification: 'fail' }
    ]
  }
};

test('AM-007 active assessment schemes require complete weights and grading coverage', () => {
  const scheme = academicAssessmentScheme(policy, { RevisionId: 'revision-1' });
  assert.equal(scheme.Ready, true);
  assert.equal(scheme.TotalWeightPercentage, 100);
  assert.equal(scheme.RevisionId, 'revision-1');
  const broken = academicAssessmentScheme({ Assessment: { Components: [{ Id: 'ca', Name: 'CA', MaximumScore: 40, WeightPercentage: 30 }], GradeBands: [] } });
  assert.equal(broken.Ready, false);
  assert.ok(broken.Issues.some((issue) => issue.includes('total 30')));
});

test('AM-009 score calculations preserve states, weights, grades, points and remarks', () => {
  const score = calculateAcademicStudentScore(policy, [
    { ComponentId: 'ca', RawScore: 32 },
    { ComponentId: 'exam', RawScore: 45 }
  ]);
  assert.equal(score.Percentage, 77);
  assert.equal(score.Grade, 'A');
  assert.equal(score.GradePoint, 5);
  assert.equal(score.Remark, 'Excellent');
  assert.equal(score.CompletionStatus, 'Complete');

  const absent = calculateAcademicStudentScore(policy, [
    { ComponentId: 'ca', RawScore: 40 },
    { ComponentId: 'exam', State: 'Absent' }
  ]);
  assert.equal(absent.Percentage, 40);
  assert.equal(absent.Grade, 'F');
  assert.equal(absent.CompletionStatus, 'Complete');

  const exempt = calculateAcademicStudentScore(policy, [
    { ComponentId: 'ca', RawScore: 30 },
    { ComponentId: 'exam', State: 'Exempt' }
  ]);
  assert.equal(exempt.Percentage, 75);
  assert.equal(exempt.IncludedWeightPercentage, 40);

  const missing = calculateAcademicStudentScore(policy, [
    { ComponentId: 'ca', RawScore: 30 },
    { ComponentId: 'exam', State: 'Missing' }
  ]);
  assert.equal(missing.CompletionStatus, 'Incomplete');
  assert.equal(missing.Grade, '');
});

test('AM-009 saved score cells lock recorded values and require managed reactivation for changes', () => {
  const previous = {
    ComponentScores: [
      { ComponentId: 'ca', State: 'Numeric', RawScore: 32 },
      { ComponentId: 'exam', State: 'Missing', RawScore: null }
    ]
  };
  assert.deepEqual(academicLockedScoreComponentIds(previous), ['ca']);
  assert.deepEqual(academicLockedScoreChanges(previous, [
    { ComponentId: 'ca', State: 'Numeric', RawScore: 32 },
    { ComponentId: 'exam', State: 'Numeric', RawScore: 50 }
  ]), []);
  assert.deepEqual(academicLockedScoreChanges(previous, [
    { ComponentId: 'ca', State: 'Numeric', RawScore: 35 },
    { ComponentId: 'exam', State: 'Missing', RawScore: null }
  ]), ['ca']);
  assert.deepEqual(academicLockedScoreChanges(previous, [
    { ComponentId: 'ca', State: 'Numeric', RawScore: 35 }
  ], true), []);
});

test('AM-009 blank score-entry cells default to Score without submitting untouched blanks', () => {
  assert.match(adminSource, /function academicScoreStateOptions\(selected = 'Numeric'\)/);
  assert.match(adminSource, /automaticMissing = clean\(savedEntry\?\.State\) === 'Missing' && savedEntry\?\.StateExplicit !== true/);
  assert.match(adminSource, /!savedEntry \|\| automaticMissing \? \{ \.\.\.\(savedEntry \|\| \{\}\), State: 'Numeric', RawScore: '' \}/);
  assert.match(adminSource, /\.filter\(\(score\) => score\.State !== 'Numeric' \|\| clean\(score\.RawScore\)\)/);
  assert.match(adminSource, /component\.dataset\.stateExplicit = 'true'/);
  const explicitlyMissing = calculateAcademicStudentScore(policy, [
    { ComponentId: 'ca', RawScore: 30 },
    { ComponentId: 'exam', State: 'Missing', StateExplicit: true }
  ]);
  assert.equal(explicitlyMissing.ComponentScores[1].State, 'Missing');
  assert.equal(explicitlyMissing.ComponentScores[1].StateExplicit, true);
});

test('AM-010 spreadsheet imports normalize component columns and report every invalid row before writes', () => {
  const scheme = academicAssessmentScheme(policy);
  const rows = normalizeAcademicScoreImportRows([
    { StudentRef: 'DCA/001', StudentName: 'Ada', ca: '35', exam: 'ABSENT' }
  ], scheme);
  assert.equal(rows[0].ComponentScores[1].RawScore, 'ABSENT');
  const preview = validateAcademicScoreImport([
    { StudentRef: 'DCA/001', ca: 35, exam: 50 },
    { StudentRef: 'DCA/001', ca: 41, exam: 50 },
    { StudentRef: 'UNKNOWN', ca: 20, exam: 40 }
  ], { scheme, roster: [{ StudentRef: 'DCA/001' }] });
  assert.equal(preview.TotalRows, 3);
  assert.equal(preview.ValidRows, 1);
  assert.equal(preview.InvalidRows, 2);
  assert.ok(preview.Rows[1].Issues.some((issue) => issue.includes('duplicated')));
  assert.ok(preview.Rows[1].Issues.some((issue) => issue.includes('between 0 and 40')));
  assert.ok(preview.Rows[2].Issues.some((issue) => issue.includes('not in the selected subject roster')));
});

test('AM-010 source rules reject the wrong entry channel and partial imports preserve other component scores', () => {
  const sourcePolicy = structuredClone(policy);
  sourcePolicy.Assessment.Components[0].SourceMode = 'manual';
  sourcePolicy.Assessment.Components[1].SourceMode = 'spreadsheet';
  const scheme = academicAssessmentScheme(sourcePolicy);
  assert.deepEqual(academicScoreSourceIssues(scheme, [{ ComponentId: 'exam', RawScore: 48 }], 'manual'), [
    'Examination accepts scores only from spreadsheet.'
  ]);
  const forbidden = validateAcademicScoreImport([
    { StudentRef: 'DCA/001', ca: 35, exam: 50 }
  ], { scheme, roster: [{ StudentRef: 'DCA/001' }], sourceMode: 'spreadsheet' });
  assert.equal(forbidden.ValidRows, 0);
  assert.ok(forbidden.Rows[0].Issues.some((issue) => issue.includes('Continuous Assessment accepts scores only from manual')));

  const partial = validateAcademicScoreImport([
    { StudentRef: 'DCA/001', exam: 48 }
  ], {
    scheme,
    roster: [{ StudentRef: 'DCA/001' }],
    sourceMode: 'spreadsheet',
    existingScores: [{ StudentRef: 'DCA/001', ComponentScores: [{ ComponentId: 'ca', RawScore: 36 }] }]
  });
  assert.equal(partial.ValidRows, 1);
  assert.equal(partial.Rows[0].Calculated.Percentage, 84);
  assert.equal(partial.Rows[0].Calculated.ComponentScores.find((row) => row.ComponentId === 'ca').RawScore, 36);
});

test('Milestone 5 server and web contracts expose controlled score sheets, imports and rollback', () => {
  ['academicScoreSheets', 'academicStudentScores', 'academicScoreImports'].forEach((name) => assert.match(academicManagementSource, new RegExp(name)));
  ['getAcademicScorebookContext', 'saveAcademicScoreDraft', 'changeAcademicScoreSheetStatus', 'previewAcademicScoreImport', 'importAcademicScores', 'rollbackAcademicScoreImport']
    .forEach((action) => assert.match(academicManagementSource, new RegExp(action)));
  assert.match(academicManagementSource, /SectionId: scope\.section, ClassId: classId, SubjectId: subjectId/);
  assert.match(academicManagementSource, /academicAssessmentFingerprint/);
  assert.match(academicManagementSource, /existing\.AssessmentComponents/);
  assert.match(academicManagementSource, /ACADEMIC_SCORE_SNAPSHOT_INVALID/);
  assert.match(academicManagementSource, /existingScores: context\.state\.studentScores/);
  assert.match(adminSource, /data-academic-scorebook/);
  assert.match(adminSource, /data-academic-score-import/);
  assert.match(adminSource, /parseAcademicScoreSpreadsheet/);
  assert.match(adminSource, /changeAcademicScoreSheetStatus/);
  assert.match(adminSource, /Download score template/);
  assert.match(academicManagementSource, /reactivateAcademicScoreEditing/);
  assert.match(academicManagementSource, /ACADEMIC_SCORE_CELL_LOCKED/);
  assert.match(backendSource, /case 'reactivateAcademicScoreEditing'/);
  assert.match(adminSource, /data-academic-score-reactivate/);
  assert.match(adminSource, /Save and lock recorded scores/);
  assert.match(styleSource, /\.academic-score-component\.is-saved-locked/);
});

test('scorebook requests stay below the Worker subrequest ceiling', () => {
  assert.deepEqual(ACADEMIC_SCOREBOOK_STATE_KEYS, [
    'sessions', 'terms', 'classes', 'arms', 'subjects', 'teacherAllocations',
    'studentMemberships', 'scoreSheets', 'studentScores', 'scoreImports', 'scoreSyncBatches'
  ]);
  assert.match(academicManagementSource, /ACADEMIC_SCOREBOOK_STATE_KEYS = Object\.freeze\(\[/);
  assert.match(academicManagementSource, /stateKeys: ACADEMIC_SCOREBOOK_STATE_KEYS/);
  assert.match(academicManagementSource, /partialAcademicManagement: true/);
  assert.match(academicManagementSource, /refreshAcademicManagement: true/);
  assert.doesNotMatch(
    academicManagementSource.match(/export async function getAcademicScorebookContext[\s\S]*?\n}/)?.[0] || '',
    /academicOperationalResponse/
  );
  assert.match(adminSource, /data\.refreshAcademicManagement === true/);
  assert.match(adminSource, /data\.partialAcademicManagement === true/);
});

test('Milestone 8 CBT batches accept finalized submissions without changing untouched roster students', () => {
  const cbtPolicy = structuredClone(policy);
  cbtPolicy.Assessment.Components[0].SourceMode = 'built-in-cbt';
  const scheme = academicAssessmentScheme(cbtPolicy);
  const valid = validateAcademicCbtScoreBatch({
    SourceType: 'BuiltInCBT', AssessmentComponentId: 'ca', MaximumScore: 40,
    Scores: [
      { StudentRef: 'DCA/001', State: 'Numeric', RawScore: 34 },
      { StudentRef: 'DCA/002', State: 'Absent' }
    ]
  }, {
    scheme, sourceMode: 'built-in-cbt',
    roster: [{ StudentRef: 'DCA/001' }, { StudentRef: 'DCA/002' }]
  });
  assert.equal(valid.Ready, true);
  assert.equal(valid.NumericCount, 1);
  assert.equal(valid.AbsentCount, 1);

  const partial = validateAcademicCbtScoreBatch({
    SourceType: 'BuiltInCBT', AssessmentComponentId: 'ca', MaximumScore: 40,
    Scores: [{ StudentRef: 'DCA/001', State: 'Numeric', RawScore: 34 }]
  }, {
    scheme, sourceMode: 'built-in-cbt',
    roster: [{ StudentRef: 'DCA/001' }, { StudentRef: 'DCA/002' }]
  });
  assert.equal(partial.Ready, true);
  assert.equal(partial.SubmittedCount, 1);
  assert.equal(partial.UntouchedRosterCount, 1);

  const invalid = validateAcademicCbtScoreBatch({
    SourceType: 'BuiltInCBT', AssessmentComponentId: 'ca', MaximumScore: 40,
    Scores: [{ StudentRef: 'DCA/001', State: 'Numeric', RawScore: 41 }]
  }, {
    scheme, sourceMode: 'built-in-cbt',
    roster: [{ StudentRef: 'DCA/001' }, { StudentRef: 'DCA/002' }]
  });
  assert.equal(invalid.Ready, false);
  assert.ok(invalid.Issues.some((issue) => issue.includes('between 0 and 40')));
});

test('Milestone 8 server contract exposes idempotent approved CBT score synchronization', () => {
  assert.match(academicManagementSource, /academicScoreSyncBatches/);
  assert.match(academicManagementSource, /syncAcademicCbtScores/);
  assert.match(academicManagementSource, /ACADEMIC_CBT_SCORE_DIGEST_INVALID/);
  assert.match(academicManagementSource, /verifyAcademicCbtScoreSignature/);
  assert.match(academicManagementSource, /RSASSA-PKCS1-v1_5-SHA256/);
  assert.match(academicManagementSource, /ACADEMIC_CBT_SYNC_KEY_REUSED/);
  assert.match(academicManagementSource, /ACADEMIC_CBT_SYNC_TEMPORARY/);
  assert.match(academicManagementSource, /commitOutcomeMayBeUncertain/);
  assert.match(academicManagementSource, /kept the approved batch safely queued/);
  assert.match(academicManagementSource, /dynamax-academic-cbt-sync-preparation-v1/);
  assert.match(academicManagementSource, /commitRequired: true/);
  assert.match(academicManagementSource, /ACADEMIC_CBT_SYNC_CLIENT_UPDATE_REQUIRED/);
  assert.match(adminSource, /SupportsPreparedScoreCommit: true/);
  assert.match(adminSource, /ScoreSyncPreparation: response\.scoreSyncPreparation/);
  assert.match(academicManagementSource, /SheetId, Status: 'Committed', SourceType: sourceType/);
  assert.doesNotMatch(academicManagementSource, /SheetId, Status: 'Committed', SourceType,/);
  assert.match(backendSource, /startsWith\('ACADEMIC_CBT_SYNC_'\)/);
  assert.doesNotMatch(backendSource, /responseCode = err\?\.code \|\| \(cbtSyncFailure/);
  assert.match(backendSource, /'syncAcademicCbtScores', 'syncLocalCbtStudentPasswords'/);
  assert.match(academicManagementSource, /ApprovalStatus/);
  assert.match(adminSource, /data-academic-external-cbt/);
  assert.match(adminSource, /external-cbt-adapter-template\.csv/);
});

test('score-entry student names use the compact register type size', () => {
  assert.match(styleSource, /\.academic-scorebook-table td:first-child strong\{display:block;font-size:12px;line-height:1\.25\}/);
});

test('focused Academic Management reads establish one Firestore token before parallel collection loading', () => {
  const loader = academicManagementSource.match(/async function loadAcademicState[\s\S]*?\n}/)?.[0] || '';
  assert.match(loader, /groups\.push\(await loadCollection\(collections\[0\]\)\)/);
  assert.match(loader, /collections\.slice\(1\)\.map\(loadCollection\)/);
  assert.doesNotMatch(loader, /catch\(\(\) => \[\]\)/);
});

test('class-wide CBT synchronization uses subject-teacher authority without requiring an arm form teacher', () => {
  const candidate = {
    SessionId: 'session-1', TermId: 'term-1', ClassId: 'grade-10',
    ArmId: 'brilliance', SubjectId: 'math'
  };
  const state = { teacherAllocations: [
    {
      SessionId: 'session-1', TermId: 'term-1', ClassId: 'grade-10', ArmId: 'brilliance',
      SubjectId: '', TeacherUsername: 'form.brilliance', AllocationRole: 'Form Teacher', Status: 'Active'
    },
    {
      SessionId: 'session-1', TermId: 'term-1', ClassId: 'grade-10', ArmId: 'excellence',
      SubjectId: 'math', TeacherUsername: 'math.teacher', AllocationRole: 'Subject Teacher', Status: 'Active'
    }
  ] };
  assert.deepEqual(academicScoreTeacherAllocations(state, candidate), []);
  assert.deepEqual(
    academicScoreTeacherAllocations(state, candidate, { classWideSubjectAuthority: true }).map((row) => row.TeacherUsername),
    ['math.teacher']
  );
  assert.match(academicManagementSource, /classWideSubjectAuthority: true/);
});

test('CBT score commits use a short-lived signed preparation bound to the workspace and approved batch', async () => {
  const env = {
    FIREBASE_PRIVATE_KEY: 'test-only-private-material',
    FIREBASE_PROJECT_ID: 'school-project',
    DYNAMAX_WORKSPACE_ID: 'school'
  };
  const user = { username: 'academic.reviewer' };
  const digest = 'a'.repeat(64);
  const syncId = 'score-sync-test';
  const writes = [
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.studentScores, documentId: 'score-1', data: {} },
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreSheets, documentId: 'sheet-1', data: {} },
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.scoreSyncBatches, documentId: syncId, data: {} },
    { collectionPath: ACADEMIC_MANAGEMENT_COLLECTIONS.audit, documentId: 'audit-1', data: {} }
  ];
  const token = await createAcademicCbtSyncPreparation(env, user, {
    BranchId: 'main', SchoolSection: 'secondary', BatchDigest: digest,
    SyncId: syncId, Message: 'Scores synchronized.', Writes: writes,
    Receipt: { SyncId: syncId }
  });
  const prepared = await verifyAcademicCbtSyncPreparation(env, user, {
    BranchId: 'main', SchoolSection: 'secondary', BatchDigest: digest,
    ScoreSyncPreparation: token
  });
  assert.equal(prepared.SyncId, syncId);
  assert.equal(prepared.Writes.length, 4);
  await assert.rejects(
    verifyAcademicCbtSyncPreparation(env, user, {
      BranchId: 'main', SchoolSection: 'secondary', BatchDigest: 'b'.repeat(64),
      ScoreSyncPreparation: token
    }),
    (error) => error?.code === 'ACADEMIC_CBT_SYNC_PREPARATION_MISMATCH'
  );
});

test('Milestone 8 verifies a signed local CBT batch identity', async () => {
  const keys = await webcrypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  );
  const publicDer = new Uint8Array(await webcrypto.subtle.exportKey('spki', keys.publicKey));
  const publicText = Buffer.from(publicDer).toString('base64').match(/.{1,64}/g).join('\n');
  const payload = {
    Version: 'dynamax-cbt-score-batch-v1', BatchId: 'cbt-sync-test-batch',
    SessionId: 'session-1', TermId: 'term-1', ClassId: 'class-1', ArmId: 'arm-1', SubjectId: 'math',
    AssessmentComponentId: 'ca', MaximumScore: 40, SourceType: 'BuiltInCBT', MarkingRevision: 2,
    ApprovalStatus: 'Approved', Scores: [{ StudentRef: 'DCA/001', State: 'Numeric', RawScore: 32 }]
  };
  payload.BatchDigest = await academicCbtScoreBatchDigest(payload);
  const keyDigest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', publicDer));
  payload.SigningKeyId = Buffer.from(keyDigest).toString('hex').slice(0, 32);
  payload.SigningPublicKey = `-----BEGIN PUBLIC KEY-----\n${publicText}\n-----END PUBLIC KEY-----\n`;
  payload.SignatureAlgorithm = 'RSASSA-PKCS1-v1_5-SHA256';
  payload.Signature = Buffer.from(await webcrypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(payload.BatchDigest)
  )).toString('base64url');
  assert.equal(await verifyAcademicCbtScoreSignature(payload), payload.SigningKeyId);
});
