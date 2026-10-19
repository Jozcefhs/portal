// Pure, resumable constraint search. No database writes or platform bindings.
import {
  academicTimetablePeriodsForDay, normalizeAcademicTimetableEntry
} from './academic-timetable-attendance.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const active = (row) => !['inactive', 'archived', 'closed', 'deleted'].includes(lower(row?.Status));
const key = (row) => JSON.stringify([row.ClassId, row.ArmId, row.SubjectId]);
const classKey = (row) => JSON.stringify([row.ClassId, row.ArmId]);
const fail = (message) => Object.assign(new Error(message), { status: 409, code: 'ACADEMIC_GENERATOR_INVALID' });
function integer(value, name, maximum, fallback = 0) {
  const number = value === '' || value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw fail(`${name} must be a whole number between 0 and ${maximum}.`);
  return number;
}

export function normalizeAcademicGenerationRules(input = {}, version = {}) {
  if (!Array.isArray(input.Requirements) || input.Requirements.length > 1000) throw fail('Configure at most 1,000 classroom-subject requirements.');
  const days = new Set((version.Days || []).map((day) => day.DayCode));
  const seen = new Set();
  const requirements = input.Requirements.map((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw fail('Every requirement must be a classroom-subject record.');
    const row = {
      ClassId: clean(source.ClassId), ArmId: clean(source.ArmId), SubjectId: clean(source.SubjectId),
      TeacherUsername: lower(source.TeacherUsername), Room: clean(source.Room).slice(0, 100),
      PeriodsPerWeek: integer(source.PeriodsPerWeek, 'Weekly subject periods', 100),
      DoubleLessonsPerWeek: integer(source.DoubleLessonsPerWeek, 'Double lessons per week', 50),
      MaxPeriodsPerDay: integer(source.MaxPeriodsPerDay, 'Daily subject maximum', 100),
      LatestLessonNumber: integer(source.LatestLessonNumber, 'Last permitted lesson number', 100),
      AllowedDayCodes: Array.isArray(source.AllowedDayCodes)
        ? [...new Set(source.AllowedDayCodes.map((day) => clean(day).toUpperCase()))] : []
    };
    if (!row.ClassId || !row.ArmId || !row.SubjectId) throw fail('Every requirement needs a class, arm and subject.');
    if (seen.has(key(row))) throw fail('Each classroom-subject combination can appear only once.');
    seen.add(key(row));
    if (row.AllowedDayCodes.some((day) => !days.has(day))) throw fail('Allowed days must use this version’s configured school days.');
    if (row.DoubleLessonsPerWeek * 2 > row.PeriodsPerWeek) throw fail('Double lessons exceed the subject’s weekly period requirement.');
    return row;
  }).filter((row) => row.PeriodsPerWeek > 0).sort((a, b) => key(a).localeCompare(key(b)));
  if (!requirements.length) throw fail('Enter weekly periods for at least one classroom-subject combination.');
  if (requirements.reduce((total, row) => total + row.PeriodsPerWeek, 0) > 2500) throw fail('Generate at most 2,500 lesson periods in one version. Split larger school sections into separate timetable scopes.');
  return {
    Requirements: requirements,
    MaxConsecutiveTeacherPeriods: integer(input.MaxConsecutiveTeacherPeriods, 'Maximum consecutive teacher periods', 100)
  };
}

function periodMatches(row, version) {
  return (!row.SessionId || row.SessionId === version.SessionId) && (!row.TermId || row.TermId === version.TermId);
}

export function buildAcademicGenerationProblem(state = {}, version = {}, { includeTasks = true } = {}) {
  const rules = normalizeAcademicGenerationRules(version.GenerationRules, version);
  const allocations = (state.teacherAllocations || []).filter((row) => active(row) && periodMatches(row, version)
    && lower(row.AllocationRole) === 'subject teacher');
  const teachersFor = (row) => [...new Set(allocations.filter((allocation) => allocation.ClassId === row.ClassId
    && (!allocation.ArmId || allocation.ArmId === row.ArmId) && allocation.SubjectId === row.SubjectId
    && (!row.TeacherUsername || lower(allocation.TeacherUsername) === row.TeacherUsername))
    .map((allocation) => lower(allocation.TeacherUsername)))].sort();
  const days = (version.Days || []).map((day) => ({ ...day, Periods: academicTimetablePeriodsForDay(version, day.DayCode) }));
  const constraints = (state.timetableConstraints || []).filter((row) => active(row) && periodMatches(row, version));
  const problem = { version, rules, days, constraints, teachersFor, tasks: [], fixed: [], issues: [], requirements: new Map(rules.Requirements.map((row) => [key(row), row])) };
  for (const row of rules.Requirements) {
    const schoolClass = (state.classes || []).find((item) => item.ClassId === row.ClassId && active(item));
    const arm = (state.arms || []).find((item) => item.ArmId === row.ArmId && item.ClassId === row.ClassId && active(item) && periodMatches(item, version));
    const subject = (state.subjects || []).find((item) => item.SubjectId === row.SubjectId && active(item));
    if (!schoolClass || !arm || !subject) throw fail('A generator requirement refers to a missing, inactive or wrong-term classroom or subject.');
    if (!teachersFor(row).length) throw fail(`Allocate a subject teacher for ${schoolClass.Name || row.ClassId} / ${arm.Name || row.ArmId}: ${subject.Name || row.SubjectId}.`);
    row.Label = `${schoolClass.Name || row.ClassId} / ${arm.Name || row.ArmId}: ${subject.Name || row.SubjectId}`;
  }
  const fixed = (state.timetableEntries || []).filter((entry) => active(entry) && entry.VersionId === version.VersionId && entry.GeneratorLocked === true);
  const runtime = generationRuntime(problem);
  for (const entry of fixed) {
    const normalized = canonicalEntry(problem, entry);
    const reason = runtime.reason(normalized);
    if (reason) throw fail(`Locked lesson: ${reason}`);
    runtime.add(normalized);
    problem.fixed.push({ ...normalized, GeneratorLocked: true });
  }
  if (!includeTasks) return problem;
  let taskIndex = 0;
  for (const row of rules.Requirements) {
    const locked = problem.fixed.filter((entry) => key(entry) === key(row));
    const lockedDoubles = locked.filter((entry) => entry.DurationPeriods === 2).length;
    const doubles = row.DoubleLessonsPerWeek - lockedDoubles;
    const remaining = row.PeriodsPerWeek - locked.reduce((total, entry) => total + entry.DurationPeriods, 0);
    const singles = remaining - doubles * 2;
    if (doubles < 0 || singles < 0) throw fail(`${row.Label}: locked lessons exceed the weekly or double-lesson requirement.`);
    for (const [duration, count] of [[2, doubles], [1, singles]]) {
      if (!count) continue;
      const options = [];
      for (const day of days) {
        if (row.AllowedDayCodes.length && !row.AllowedDayCodes.includes(day.DayCode)) continue;
        let lessonNumber = 0;
        for (let index = 0; index < day.Periods.length; index++) {
          const start = day.Periods[index];
          if (start.Kind !== 'Lesson') continue;
          lessonNumber++;
          const occupied = day.Periods.slice(index, index + duration);
          if (occupied.length !== duration || occupied.some((period) => period.Kind !== 'Lesson')) continue;
          if (row.LatestLessonNumber && lessonNumber + duration - 1 > row.LatestLessonNumber) continue;
          for (const teacher of teachersFor(row)) {
            const entry = {
              ClassId: row.ClassId, ArmId: row.ArmId, SubjectId: row.SubjectId, TeacherUsername: teacher,
              Room: row.Room, DayCode: day.DayCode, StartPeriodCode: start.PeriodCode,
              PeriodCodes: occupied.map((period) => period.PeriodCode), DurationPeriods: duration,
              LessonType: duration === 2 ? 'Double' : 'Single', GeneratorLocked: false
            };
            if (!runtime.reason(entry)) options.push(entry);
          }
        }
      }
      if (!options.length) problem.issues.push(`${row.Label}: no available ${duration === 2 ? 'double' : 'single'}-period slot satisfies the cutoff, availability and locked lessons.`);
      for (let index = 0; index < count; index++) problem.tasks.push({ Id: taskIndex++, row, duration, options });
    }
  }
  const weekCapacity = days.reduce((total, day) => total + day.Periods.filter((period) => period.Kind === 'Lesson').length, 0);
  const byClass = new Map();
  for (const row of rules.Requirements) byClass.set(classKey(row), (byClass.get(classKey(row)) || 0) + row.PeriodsPerWeek);
  for (const [classroom, required] of byClass) if (required > weekCapacity) problem.issues.push(`${classroom}: ${required} required periods exceed the ${weekCapacity} lesson periods in the school week.`);
  for (const row of rules.Requirements) {
    const capacity = days.filter((day) => !row.AllowedDayCodes.length || row.AllowedDayCodes.includes(day.DayCode)).reduce((total, day) => {
      const available = day.Periods.filter((period) => period.Kind === 'Lesson').length;
      return total + Math.min(available, row.LatestLessonNumber || available, row.MaxPeriodsPerDay || available);
    }, 0);
    if (row.PeriodsPerWeek > capacity) problem.issues.push(`${row.Label}: ${row.PeriodsPerWeek} required periods cannot fit into the ${capacity} permitted daily/cutoff slots.`);
  }
  // Most restricted requirements first; doubles before singles. Stable ordering
  // makes a checkpoint reproducible on desktop and web without random state.
  problem.tasks.sort((a, b) => a.options.length - b.options.length || b.duration - a.duration || b.row.PeriodsPerWeek - a.row.PeriodsPerWeek || a.Id - b.Id);
  return problem;
}

function canonicalEntry(problem, source) {
  const entry = normalizeAcademicTimetableEntry(source, problem.version);
  const row = problem.requirements.get(key(entry));
  if (!row) throw fail('Configure a weekly requirement for every lesson in a generated timetable, including locked lessons.');
  if (!problem.teachersFor(row).includes(lower(entry.TeacherUsername))) throw fail(`${row.Label}: the lesson teacher is not allocated to this classroom and subject.`);
  return {
    ClassId: entry.ClassId, ArmId: entry.ArmId, SubjectId: entry.SubjectId, TeacherUsername: lower(entry.TeacherUsername),
    Room: entry.Room, DayCode: entry.DayCode, StartPeriodCode: entry.StartPeriodCode,
    DurationPeriods: entry.DurationPeriods, PeriodCodes: entry.PeriodCodes, LessonType: entry.LessonType,
    GeneratorLocked: source.GeneratorLocked === true
  };
}

function generationRuntime(problem) {
  const occupied = new Map(), counts = new Map();
  problem.entryMetadata ||= new WeakMap();
  const metadata = (entry) => {
    if (problem.entryMetadata.has(entry)) return problem.entryMetadata.get(entry);
    const subject = key(entry), classroom = classKey(entry), teacher = lower(entry.TeacherUsername);
    const row = problem.requirements.get(subject), day = problem.days.find((item) => item.DayCode === entry.DayCode);
    const constraint = problem.constraints.find((item) => lower(item.TeacherUsername) === teacher);
    const lessons = day?.Periods.filter((period) => period.Kind === 'Lesson').map((period) => period.PeriodCode) || [];
    let restriction = '';
    if (!row) restriction = 'A lesson has no classroom-subject requirement.';
    else if (row.AllowedDayCodes.length && !row.AllowedDayCodes.includes(entry.DayCode)) restriction = `${row.Label}: this day is not permitted.`;
    else if (row.Room && lower(row.Room) !== lower(entry.Room)) restriction = `${row.Label}: use the configured room.`;
    else if (row.LatestLessonNumber && entry.PeriodCodes.some((period) => lessons.indexOf(period) + 1 > row.LatestLessonNumber)) restriction = `${row.Label}: the lesson finishes after permitted period ${row.LatestLessonNumber}.`;
    else if ((constraint?.UnavailableSlots || []).some((slot) => entry.PeriodCodes.some((period) => lower(slot) === lower(`${entry.DayCode}:${period}`)))) restriction = `${row.Label}: teacher unavailable.`;
    const result = { row, day, constraint, teacher, restriction,
      resources: entry.PeriodCodes.flatMap((period) => [`class:${classroom}:${entry.DayCode}:${period}`, `teacher:${teacher}:${entry.DayCode}:${period}`,
        ...(entry.Room ? [`room:${lower(entry.Room)}:${entry.DayCode}:${period}`] : [])]),
      subjectDay: `subject:${subject}:${entry.DayCode}`, subjectWeek: `week:${subject}`, doubles: `doubles:${subject}`,
      teacherDay: `teacherday:${teacher}:${entry.DayCode}`, teacherWeek: `teacherweek:${teacher}`, classDay: `classday:${classroom}:${entry.DayCode}` };
    problem.entryMetadata.set(entry, result);
    return result;
  };
  const bump = (id, delta) => { const value = (counts.get(id) || 0) + delta; if (value) counts.set(id, value); else counts.delete(id); };
  const load = (id) => counts.get(id) || 0;
  function change(entry, direction) {
    const meta = metadata(entry);
    for (const id of meta.resources) { if (direction > 0) occupied.set(id, true); else occupied.delete(id); }
    for (const id of [meta.subjectDay, meta.subjectWeek, meta.teacherDay, meta.teacherWeek, meta.classDay]) bump(id, direction * entry.DurationPeriods);
    if (entry.DurationPeriods === 2) bump(meta.doubles, direction);
  }
  return {
    add: (entry) => change(entry, 1), remove: (entry) => change(entry, -1),
    reason(entry) {
      const meta = metadata(entry), { row, day, constraint } = meta;
      if (meta.restriction) return meta.restriction;
      if (meta.resources.some((id) => occupied.has(id))) return `${row.Label}: teacher, classroom or room conflict.`;
      if (row.MaxPeriodsPerDay && load(meta.subjectDay) + entry.DurationPeriods > row.MaxPeriodsPerDay) return `${row.Label}: daily subject maximum exceeded.`;
      if (load(meta.subjectWeek) + entry.DurationPeriods > row.PeriodsPerWeek) return `${row.Label}: weekly subject requirement exceeded.`;
      if (entry.DurationPeriods === 2 && load(meta.doubles) + 1 > row.DoubleLessonsPerWeek) return `${row.Label}: too many double lessons.`;
      if (constraint?.MaxPeriodsPerDay && load(meta.teacherDay) + entry.DurationPeriods > constraint.MaxPeriodsPerDay) return `${row.Label}: daily teacher load exceeded.`;
      if (constraint?.MaxPeriodsPerWeek && load(meta.teacherWeek) + entry.DurationPeriods > constraint.MaxPeriodsPerWeek) return `${row.Label}: weekly teacher load exceeded.`;
      if (problem.rules.MaxConsecutiveTeacherPeriods) {
        let consecutive = 0;
        for (const period of day.Periods) {
          const used = period.Kind === 'Lesson' && (entry.PeriodCodes.includes(period.PeriodCode)
            || occupied.has(`teacher:${meta.teacher}:${entry.DayCode}:${period.PeriodCode}`));
          consecutive = used ? consecutive + 1 : 0;
          if (consecutive > problem.rules.MaxConsecutiveTeacherPeriods) return `${row.Label}: consecutive teacher-period limit exceeded.`;
        }
      }
      return '';
    },
    score(entry) {
      // Prefer a subject's unused days, then balance teacher and classroom loads.
      const meta = metadata(entry);
      return load(meta.subjectDay) * 100 + load(meta.teacherDay) * 4 + load(meta.classDay);
    },
    total: (row) => load(`week:${key(row)}`), doubles: (row) => load(`doubles:${key(row)}`)
  };
}

export function validateAcademicGeneratedEntries(problem, supplied = [], requireComplete = false) {
  if (!Array.isArray(supplied) || supplied.length > 2500) throw fail('A timetable preview may contain at most 2,500 lessons.');
  const runtime = generationRuntime(problem);
  const entries = supplied.map((source) => {
    const entry = canonicalEntry(problem, source);
    const reason = runtime.reason(entry);
    if (reason) throw fail(reason);
    runtime.add(entry);
    return entry;
  });
  if (requireComplete) {
    for (const row of problem.rules.Requirements) {
      if (runtime.total(row) !== row.PeriodsPerWeek || runtime.doubles(row) !== row.DoubleLessonsPerWeek) throw fail(`${row.Label}: weekly periods or double lessons are incomplete.`);
    }
    for (const locked of problem.fixed) if (!entries.some((entry) => JSON.stringify(entry) === JSON.stringify(locked))) throw fail('A locked lesson was changed or omitted from the generated preview.');
  }
  return entries;
}

export function advanceAcademicTimetableGeneration(problem, checkpoint = null, budget = 1200) {
  const tasks = problem.tasks;
  const maximumChecks = 120000;
  const limit = Math.min(2400, Math.max(1, Number(budget) || 1200));
  const frames = checkpoint?.Frames;
  if (checkpoint && (!Array.isArray(frames) || frames.length > tasks.length || frames.some((frame) => !frame || !Object.hasOwn(frame, 'Task') || !Object.hasOwn(frame, 'Next') || !Object.hasOwn(frame, 'Chosen'))
      || !Array.isArray(checkpoint.Best) || checkpoint.Best.length > tasks.length)) throw fail('The generation checkpoint is invalid. Start a fresh preview.');
  const cursor = {
    Frames: frames ? frames.map((frame) => ({ Task: integer(frame.Task, 'Search task', tasks.length), Next: integer(frame.Next, 'Search position', 10000), Chosen: frame.Chosen == null ? null : integer(frame.Chosen, 'Selected slot', 10000) })) : [],
    Best: checkpoint ? checkpoint.Best.map((choice) => ({ Task: integer(choice?.Task, 'Preview task', tasks.length), Choice: integer(choice?.Choice, 'Preview slot', 10000) })) : [],
    Checks: checkpoint ? integer(checkpoint.Checks, 'Search checks', maximumChecks) : 0
  };
  const runtime = generationRuntime(problem);
  problem.fixed.forEach(runtime.add);
  const selected = [];
  const usedTasks = new Set(), choiceCache = new WeakMap();
  const choices = (task) => task.options.map((entry, index) => ({ index, score: runtime.score(entry) }))
    .sort((a, b) => a.score - b.score || a.index - b.index).map((option) => option.index);
  // Recompute the most constrained remaining subject after each placement.
  // A fixed classroom-first order can trap an otherwise feasible full week.
  const nextTask = () => {
    const groups = new Map();
    tasks.forEach((task, index) => {
      if (usedTasks.has(index)) return;
      const id = `${key(task.row)}:${task.duration}`;
      if (!groups.has(id)) groups.set(id, { index, count: 0 });
      groups.get(id).count++;
    });
    let chosen = -1, smallest = Infinity;
    for (const group of groups.values()) {
      const available = tasks[group.index].options.reduce((total, entry) => total + (!runtime.reason(entry) ? 1 : 0), 0);
      const slack = available / group.count;
      if (slack < smallest) { chosen = group.index; smallest = slack; }
      if (!available) break;
    }
    return chosen;
  };
  // Restore only validated selected slots. Checkpoints are client-owned previews,
  // never authority to write a timetable, and all writes revalidate the full plan.
  for (let depth = 0; depth < cursor.Frames.length; depth++) {
    const frame = cursor.Frames[depth], task = tasks[frame.Task];
    if (!task || usedTasks.has(frame.Task)) throw fail('A search task is missing or repeated. Start again.');
    if (frame.Next > task.options.length || (frame.Chosen === null && depth !== cursor.Frames.length - 1)) throw fail('Invalid search checkpoint. Start again.');
    if (frame.Chosen !== null) {
      const order = choices(task), entry = task.options[frame.Chosen];
      choiceCache.set(frame, order);
      if (!entry || order[frame.Next - 1] !== frame.Chosen || runtime.reason(entry)) throw fail('The preview checkpoint no longer satisfies the timetable rules. Start again.');
      selected.push({ Task: frame.Task, Choice: frame.Chosen }); usedTasks.add(frame.Task); runtime.add(entry);
    }
  }
  let checks = 0, placements = 0, exhausted = false;
  if (!problem.issues.length) while (checks < limit && placements < 40 && cursor.Checks < maximumChecks && selected.length < tasks.length) {
    const depth = selected.length;
    if (!cursor.Frames[depth]) cursor.Frames.push({ Task: nextTask(), Next: 0, Chosen: null });
    const frame = cursor.Frames[depth], task = tasks[frame.Task];
    if (!choiceCache.has(frame)) choiceCache.set(frame, choices(task));
    const order = choiceCache.get(frame);
    if (frame.Next >= order.length) {
      cursor.Frames.pop();
      if (!depth) { exhausted = true; break; }
      const previous = cursor.Frames[depth - 1];
      runtime.remove(tasks[previous.Task].options[previous.Chosen]); usedTasks.delete(previous.Task);
      previous.Chosen = null; selected.pop();
      checks++; cursor.Checks++;
      continue;
    }
    const choice = order[frame.Next++], entry = task.options[choice];
    checks++; cursor.Checks++;
    if (runtime.reason(entry)) continue;
    frame.Chosen = choice; selected.push({ Task: frame.Task, Choice: choice }); usedTasks.add(frame.Task); runtime.add(entry); placements++;
    if (selected.length > cursor.Best.length) cursor.Best = [...selected];
  }
  const complete = !problem.issues.length && selected.length === tasks.length;
  const done = complete || exhausted || problem.issues.length > 0 || cursor.Checks >= maximumChecks;
  const best = complete ? selected : cursor.Best;
  const entries = [...problem.fixed, ...best.map((choice) => {
    const entry = tasks[choice.Task]?.options[choice.Choice];
    if (!entry) throw fail('The best-preview checkpoint is invalid. Start again.');
    return entry;
  })];
  validateAcademicGeneratedEntries(problem, entries, complete);
  const byRequirement = new Map();
  for (const entry of entries) byRequirement.set(key(entry), (byRequirement.get(key(entry)) || 0) + entry.DurationPeriods);
  const unscheduled = problem.rules.Requirements.map((row) => ({
    Label: row.Label, ClassId: row.ClassId, ArmId: row.ArmId, SubjectId: row.SubjectId,
    Required: row.PeriodsPerWeek, Scheduled: byRequirement.get(key(row)) || 0,
    Remaining: row.PeriodsPerWeek - (byRequirement.get(key(row)) || 0)
  })).filter((row) => row.Remaining > 0);
  return {
    Complete: complete, Done: done, Checkpoint: done ? null : cursor, Entries: entries,
    RequiredPeriods: problem.rules.Requirements.reduce((total, row) => total + row.PeriodsPerWeek, 0),
    ScheduledPeriods: entries.reduce((total, entry) => total + entry.DurationPeriods, 0),
    Checks: cursor.Checks, Unscheduled: unscheduled, Issues: problem.issues,
    Message: complete ? 'Complete conflict-free preview ready for review. Nothing has been saved.'
      : problem.issues.length ? 'The configured requirements cannot fit. Resolve the listed issues.'
        : exhausted ? 'No complete arrangement satisfies these rules. Adjust requirements, availability or locked lessons.'
          : done ? 'The bounded search limit was reached; this does not prove the timetable is impossible. Adjust constraints or locked lessons and try again.'
            : 'Searching and resolving conflicts. Nothing has been saved.'
  };
}
