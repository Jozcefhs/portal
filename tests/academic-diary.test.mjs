import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDiary, diaryAccess, normalizeSchemeWeeks, diaryId, legacyDiaryId, DIARY_COLLECTIONS } from '../functions/lib/academic-diary.js';
import { diaryPrintHtml } from '../js/academic-diary.js';
import { submissionHash, SUBMISSION_COLLECTIONS } from '../functions/lib/academic-submissions.js';
import { readFile } from 'node:fs/promises';

function fixture() {
  const scope = { branchId: 'main', section: 'secondary' };
  const period = { SessionId: 'session', TermId: 'term', ClassId: 'class', ArmId: 'arm' };
  const state = {
    classes: [{ ClassId: 'class', Name: 'Grade 9' }], arms: [{ ClassId: 'class', ArmId: 'arm', Name: 'Excellence' }],
    subjects: [{ SubjectId: 'math', Name: 'Mathematics' }, { SubjectId: 'english', Name: 'English' }],
    offerings: ['math', 'english'].map(SubjectId => ({ ...period, SubjectId })),
    terms: [{ TermId: 'term', SessionId: 'session', Name: 'First term' }, { TermId: 'term2', SessionId: 'session', Name: 'Second term' }],
    teacherAllocations: [
      { ...period, SubjectId: 'math', TeacherUsername: 'math.teacher', AllocationRole: 'Subject Teacher' },
      { ...period, SubjectId: 'english', TeacherUsername: 'english.teacher', AllocationRole: 'Subject Teacher' },
      { ...period, TeacherUsername: 'class.teacher', AllocationRole: 'Form Teacher' },
    ],
  };
  const docs = new Map(), commits = [], reads = [];
  let revision = 0;
  const io = {
    getDocument: async (_env, collection, id) => { reads.push([collection, id]); return structuredClone(docs.get(`${collection}/${id}`) || null); },
    batchCommitDocuments: async (_env, writes) => {
      for (const write of writes) {
        const existing = docs.get(`${write.collectionPath}/${write.documentId}`);
        if (write.exists === false && existing || write.updateTime && write.updateTime !== existing?.__updateTime) throw Object.assign(new Error('conflict'), { status: 409 });
      }
      commits.push(writes);
      for (const write of writes) docs.set(`${write.collectionPath}/${write.documentId}`, { ...structuredClone(write.data), __updateTime: `r${++revision}` });
    },
  };
  const context = reviewer => ({ scope, state, session: { SessionId: 'session', Name: '2026/2027' },
    term: { TermId: 'term', StartDate: '2026-09-01', EndDate: '2026-12-31', Name: 'First term' }, permissions: { canReviewScores: reviewer } });
  const request = (user, action = 'getacademicdiary', input = {}) => handleDiary(context(user === 'manager'), {}, { username: user },
    { ...period, ArmId: '', Week: 1, WeekEnding: '2026-10-23', ...input }, action.toLowerCase(), io);
  return { state, context, request, period, docs, commits, reads, scope };
}

test('class access uses assigned teachers; reviewers see classes but cannot impersonate teachers', async () => {
  const f = fixture();
  await assert.rejects(f.request('outsider'), /assigned to you/);
  await assert.rejects(f.request('math.teacher', 'getacademicdiary', { ClassId: 'other' }), /assigned to you/);
  assert.equal((await f.request('class.teacher')).diary.CanCompile, true);
  assert.equal((await f.request('math.teacher')).diary.CanCompile, false);
  await assert.rejects(f.request('manager', 'saveAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'unauthorised' }), /allocated subject teacher/);
  await assert.rejects(f.request('math.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'english' }), /allocated subject teacher/);
  f.state.teacherAllocations[0].Status = 'Inactive';
  await assert.rejects(f.request('math.teacher'), /assigned to you/);
});

test('diary includes allocated subjects without legacy offerings and preserves teacher ownership', async () => {
  const f = fixture();
  f.state.offerings = [];
  assert.deepEqual((await f.request('manager')).diary.Subjects.map(row => row.SubjectId), ['english', 'math']);
  const saved = await f.request('math.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Algebra' });
  assert.equal(saved.diary.Weekly.Entries[0].WorkCompleted, 'Algebra');
  await assert.rejects(f.request('math.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'english', Version: 1 }), /allocated subject teacher/);
});

test('diary excludes allocations from other classrooms, periods and inactive subjects', async () => {
  const f = fixture();
  f.state.offerings = [];
  f.state.teacherAllocations[0].ArmId = 'other-arm';
  f.state.teacherAllocations[1].TermId = 'other-term';
  assert.deepEqual((await f.request('manager')).diary.Subjects, []);
  f.state.teacherAllocations[0].ArmId = '';
  assert.deepEqual((await f.request('manager')).diary.Subjects.map(row => row.SubjectId), ['math']);
  f.state.subjects[0].Status = 'Archived';
  assert.deepEqual((await f.request('manager')).diary.Subjects, []);
});

test('scheme validates weeks and freezes the planned topic in submitted weekly work', async () => {
  const f = fixture();
  await f.request('math.teacher', 'saveAcademicDiaryScheme', { SubjectId: 'math', Weeks: [{ Week: 1, Theme: 'Fractions', Content: 'Equivalent fractions' }] });
  const saved = await f.request('math.teacher', 'submitAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Equivalent fractions completed' });
  assert.equal(saved.diary.Weekly.Entries[0].PlannedWork.Theme, 'Fractions');
  await f.request('math.teacher', 'saveAcademicDiaryScheme', { SubjectId: 'math', Version: 1, Weeks: [{ Week: 1, Theme: 'Decimals', Content: 'Place value' }] });
  assert.equal((await f.request('manager')).diary.Weekly.Entries[0].PlannedWork.Theme, 'Fractions');
  assert.throws(() => normalizeSchemeWeeks([{ Week: 1, Theme: 'x', Content: 'y' }, { Week: 1, Theme: 'x', Content: 'y' }]), /unique/);
  assert.throws(() => normalizeSchemeWeeks([{ Week: 54, Theme: 'x', Content: 'y' }]), /53/);
});

test('weekly compilation requires all subjects, then management approves and immutable history remains', async () => {
  const f = fixture();
  await f.request('math.teacher', 'submitAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Fractions' });
  await assert.rejects(f.request('class.teacher', 'submitAcademicDiary', { Version: 1 }), /English/);
  await f.request('english.teacher', 'submitAcademicDiaryEntry', { SubjectId: 'english', Version: 1, WorkCompleted: 'Grammar' });
  await assert.rejects(f.request('math.teacher', 'submitAcademicDiary', { Version: 2 }), /class teacher/);
  const compiled = await f.request('class.teacher', 'submitAcademicDiary', { Version: 2 });
  assert.equal(compiled.diary.Weekly.Status, 'Submitted');
  await assert.rejects(f.request('class.teacher', 'approveAcademicDiary', { Version: 3 }), /Academic Management/);
  const approved = await f.request('manager', 'approveAcademicDiary', { Version: 3, Reason: 'Checked' });
  assert.equal(approved.diary.Weekly.Status, 'Approved');
  assert.equal(approved.diary.Weekly.Reviewed.By, 'manager');
  assert.equal(f.commits.length, 4);
  assert.equal(f.commits[3][1].data.Previous.Status, 'Submitted');
  await assert.rejects(f.request('math.teacher', 'saveAcademicDiaryEntry', { Version: 4, SubjectId: 'math' }), /locked/);
  await assert.rejects(f.request('manager', 'returnAcademicDiary', { Version: 4 }), /reason/);
  const returned = await f.request('manager', 'returnAcademicDiary', { Version: 4, Reason: 'Correct the dates in the notes' });
  assert.equal(returned.diary.Weekly.Entries[0].Status, 'Returned');
  assert.equal(f.commits[4][1].data.Previous.Status, 'Approved');
});

test('subject entries lock on submission and class teacher can return only a submitted entry', async () => {
  const f = fixture();
  await f.request('math.teacher', 'submitAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Work' });
  await assert.rejects(f.request('math.teacher', 'saveAcademicDiaryEntry', { Version: 1, SubjectId: 'math' }), /submitted/);
  await f.request('class.teacher', 'returnAcademicDiaryEntry', { Version: 1, SubjectId: 'math', Reason: 'Explain coverage' });
  const result = await f.request('math.teacher', 'submitAcademicDiaryEntry', { Version: 2, SubjectId: 'math', WorkCompleted: 'Work explained' });
  assert.equal(result.diary.Weekly.Entries[0].WorkCompleted, 'Work explained');
});

test('stale writes and repeated submissions cannot overwrite another teacher or duplicate history', async () => {
  const f = fixture();
  await f.request('math.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Math' });
  await assert.rejects(f.request('english.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'english', WorkCompleted: 'English' }), /changed/);
  const result = await f.request('english.teacher', 'saveAcademicDiaryEntry', { Version: 1, SubjectId: 'english', WorkCompleted: 'English' });
  assert.equal(result.diary.Weekly.Entries.length, 2);
  assert.equal(f.commits.length, 2);
  assert.ok(f.commits[1][0].updateTime);
  const results = await Promise.allSettled([
    f.request('math.teacher', 'submitAcademicDiaryEntry', { Version: 2, SubjectId: 'math', WorkCompleted: 'Math' }),
    f.request('english.teacher', 'submitAcademicDiaryEntry', { Version: 2, SubjectId: 'english', WorkCompleted: 'English' }),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(f.commits.length, 3);
});

test('week-ending date is valid, inside the term and consistent across subjects', async () => {
  const f = fixture();
  for (const WeekEnding of ['2026-02-30', 'bad', '2027-01-01']) {
    await assert.rejects(f.request('math.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'math', WeekEnding }), /date|term/);
  }
  await f.request('math.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'math' });
  await assert.rejects(f.request('english.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'english', Version: 1, WeekEnding: '2026-10-24' }), /same date/);
});

test('class record IDs isolate branch, section, session, class, term, subject and week but never arm', async () => {
  const f = fixture();
  const base = { ...f.period, Week: 1, SubjectId: 'math' };
  const keys = await Promise.all([
    diaryId('week', f.scope, base), diaryId('week', { ...f.scope, branchId: 'other' }, base),
    diaryId('week', { ...f.scope, section: 'primary' }, base), diaryId('week', f.scope, { ...base, Week: 2 }),
    diaryId('week', f.scope, { ...base, TermId: 'term2' }), diaryId('week', f.scope, { ...base, ClassId: 'other' }),
    diaryId('week', f.scope, { ...base, SessionId: 'session2' }),
    diaryId('scheme', f.scope, base), diaryId('scheme', f.scope, { ...base, SubjectId: 'english' }),
  ]);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys[0], await diaryId('week', f.scope, { ...base, ArmId: 'arm2' }));
  assert.equal(await diaryId('scheme', f.scope, base), await diaryId('scheme', f.scope, { ...base, ArmId: '' }));
  assert.notEqual(keys[0], await legacyDiaryId('week', f.scope, base));
});

test('one class choice and union of subjects/teachers across valid arms, including class-wide allocations', async () => {
  const f = fixture();
  f.state.arms.push({ ClassId: 'class', ArmId: 'second', Name: 'Brilliance' });
  f.state.teacherAllocations[1].ArmId = 'second';
  f.state.offerings[1].ArmId = 'second';
  f.state.teacherAllocations.push({ ...f.period, ArmId: 'second', SubjectId: 'math', TeacherUsername: 'second.teacher', AllocationRole: 'Subject Teacher' });
  const choices = (await f.request('second.teacher', 'getAcademicDiary', { ClassId: '' })).diary;
  assert.deepEqual(choices.Classes, [{ ClassId: 'class', Name: 'Grade 9' }]);
  assert.equal(choices.DiaryScope, 'Class');
  assert.deepEqual(choices.Classrooms, [{ ClassId: 'class', Name: 'Grade 9', ArmId: '' }]);
  const saved = await f.request('math.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Shared class work' });
  const other = (await f.request('second.teacher')).diary;
  assert.deepEqual(other.Subjects.map(row => row.SubjectId), ['english', 'math']);
  assert.deepEqual(other.OwnSubjects, ['math']);
  assert.deepEqual(other.Weekly, saved.diary.Weekly);
  await assert.rejects(f.request('second.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Stale replacement' }), /changed/);
  const updated = await f.request('second.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Reviewed shared work', Version: 1 });
  assert.equal(updated.diary.Weekly.Entries.length, 1);
  assert.equal(f.commits[1][1].data.Previous.Entries[0].WorkCompleted, 'Shared class work');
  assert.equal(updated.diary.Weekly.ArmId, '');
  assert.equal(updated.diary.Weekly.DiaryScope, 'Class');
  const scheme = await f.request('math.teacher', 'saveAcademicDiaryScheme', { SubjectId: 'math', Weeks: [{ Week: 1, Theme: 'Class topic', Content: 'All arms' }] });
  assert.deepEqual((await f.request('second.teacher', 'getAcademicDiary', { SubjectId: 'math' })).diary.Scheme, scheme.diary.Scheme);
  f.state.teacherAllocations[2].ArmId = '';
  assert.equal((await f.request('class.teacher')).diary.CanCompile, true);
});

test('old arm clients cannot write a second diary or reserve an arm-based surcharge', async () => {
  const f = fixture();
  for (const action of ['saveAcademicDiaryEntry', 'submitAcademicDiaryEntry', 'saveAcademicDiaryScheme', 'submitAcademicDiary', 'approveAcademicDiary', 'returnAcademicDiaryEntry']) {
    await assert.rejects(f.request('manager', action, { ArmId: 'arm' }), /whole class/);
  }
  assert.equal(f.commits.length, 0);
  assert.equal(f.reads.length, 0);
});

test('late class-wide subject submission reserves the canonical diary once without changing saved work', async () => {
  const f = fixture();
  await f.request('math.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Saved class draft' });
  const id = await submissionHash(['main', 'secondary', 'session', 'term']);
  f.docs.set(`${SUBMISSION_COLLECTIONS.settings}/${id}`, { Enabled: true, Rules: [{
    RecordType: 'diary-entry', ClassId: 'class', SubjectId: 'math', Enabled: true, Deadline: '2000-01-01T00:00:00Z', AmountKobo: 10000,
  }] });
  const before = structuredClone([...f.docs]);
  let reference;
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(f.request('math.teacher', 'submitAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'Final shared work', Version: 1 }), error => {
      assert.equal(error.code, 'ACADEMIC_SURCHARGE_REQUIRED');
      if (reference) assert.equal(error.submission.Reference, reference);
      reference = error.submission.Reference;
      return true;
    });
  }
  const pending = f.docs.get(`${SUBMISSION_COLLECTIONS.pending}/${reference}`);
  assert.equal(pending.Context.ArmId, '');
  assert.equal(pending.Context.ClassId, 'class');
  assert.equal(pending.Writes[0].documentId, await diaryId('week', f.scope, { ...f.period, Week: 1 }));
  assert.equal(pending.Writes[0].data.DiaryScope, 'Class');
  assert.equal(pending.Writes[0].data.Entries[0].WorkCompleted, 'Final shared work');
  for (const [key, record] of before) assert.deepEqual(f.docs.get(key), record);
  assert.equal([...f.docs.keys()].filter(key => key.startsWith(`${SUBMISSION_COLLECTIONS.pending}/`)).length, 1);
});

test('legacy arm work, schemes and approvals are read-only, printable, and not silently merged', async () => {
  const f = fixture(), selected = { ...f.period, Week: 1, SubjectId: 'math' };
  // Archived arms remain available for historical inspection.
  f.state.arms.push({ ClassId: 'class', ArmId: 'retired', Name: 'Old arm', Status: 'Archived' });
  for (const ArmId of ['arm', 'retired']) {
    const id = await legacyDiaryId('week', f.scope, { ...selected, ArmId });
    f.docs.set(`${DIARY_COLLECTIONS.week}/${id}`, { ...selected, ArmId, RecordId: id, Version: 4, Status: 'Approved', WeekEnding: '2026-10-23',
      Entries: [{ SubjectId: 'math', WorkCompleted: `<old ${ArmId}>`, Status: 'Submitted', TeacherUsername: 'old.teacher' }],
      Reviewed: { By: 'old.reviewer', Comment: 'Approved independently' }, __updateTime: 'legacy' });
  }
  const schemeId = await legacyDiaryId('scheme', f.scope, selected);
  f.docs.set(`${DIARY_COLLECTIONS.scheme}/${schemeId}`, { ...selected, RecordId: schemeId, Version: 2, Weeks: [{ Week: 1, Theme: 'Old topic', Content: 'Old content' }], __updateTime: 'legacy-scheme' });
  const before = structuredClone([...f.docs]);
  const normal = (await f.request('manager')).diary;
  assert.equal(normal.Weekly.Version, 0);
  assert.equal(normal.Weekly.Entries.length, 0);
  assert.equal(normal.LegacyArmRecords, undefined);
  const archive = (await f.request('manager', 'getAcademicDiary', { SubjectId: 'math', IncludeLegacyArmRecords: true })).diary;
  assert.equal(archive.LegacyArmRecords.length, 2);
  assert.equal(archive.LegacyArmRecords[0].Weekly.Status, 'Approved');
  assert.equal(archive.LegacyArmRecords[0].Weekly.__updateTime, undefined);
  const html = diaryPrintHtml(archive, selected, 'School', 'legacy');
  for (const value of ['Grade 9', 'read-only', 'Old arm', 'old.reviewer', 'Old topic', 'Approved independently', '&lt;old arm&gt;']) assert.ok(html.includes(value), value);
  assert.ok(!html.includes('<old arm>'));
  assert.deepEqual([...f.docs], before);
  await f.request('math.teacher', 'saveAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: 'New shared class entry' });
  for (const [key, record] of before) assert.deepEqual(f.docs.get(key), record);
  assert.notEqual(f.commits[0][0].documentId, before[0][1].RecordId);
  await assert.rejects(f.request('outsider', 'getAcademicDiary', { IncludeLegacyArmRecords: true }), /assigned to you/);
});

test('print previews escape content and include every subject, approval and all session terms', async () => {
  const f = fixture();
  await f.request('math.teacher', 'saveAcademicDiaryScheme', { SubjectId: 'math', Weeks: [{ Week: 1, Theme: '<script>bad</script>', Content: 'Fractions' }] });
  await f.request('math.teacher', 'submitAcademicDiaryEntry', { SubjectId: 'math', WorkCompleted: '<img src=x onerror=alert(1)>' });
  const result = await f.request('manager', 'getAcademicDiary', { SubjectId: 'math', IncludeSessionSchemes: true });
  const html = diaryPrintHtml(result.diary, { ...f.period, SubjectId: 'math' }, 'School & Academy');
  assert.match(html, /English/); assert.match(html, /Mathematics/); assert.match(html, /NOT YET APPROVED/);
  assert.match(html, /School &amp; Academy/); assert.ok(!html.includes('<img src=x'));
  const scheme = diaryPrintHtml(result.diary, { ...f.period, SubjectId: 'math' }, 'School', 'scheme');
  assert.match(scheme, /First term/); assert.match(scheme, /Second term/);
  assert.ok(!scheme.includes('<script>bad'));
  assert.equal(f.reads.filter(([collection]) => collection === DIARY_COLLECTIONS.history).length, 0);
});

test('desktop and web actions both route through the authenticated academic handler', async () => {
  const [backend, management, web] = await Promise.all(['../functions/api/backend.js', '../functions/lib/academic-management.js', '../js/admin.js'].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  for (const action of ['getAcademicDiary', 'saveAcademicDiaryScheme', 'submitAcademicDiaryEntry', 'submitAcademicDiary', 'approveAcademicDiary', 'returnAcademicDiary']) assert.ok(backend.includes(`case '${action}':`));
  assert.match(management, /return handleDiary\(context, env, user, input, action\)/);
  assert.match(web, /data-academic-diary/);
});
