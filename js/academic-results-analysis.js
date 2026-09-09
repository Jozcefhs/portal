(function exposeAcademicResultsAnalysis(root) {
  'use strict';

  const clean = (value) => String(value ?? '').trim();
  const lower = (value) => clean(value).toLowerCase();
  const rounded = (value, places = 1) => {
    const factor = 10 ** places;
    return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
  };
  const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const mean = (rows, valueFor) => rows.length
    ? rounded(rows.reduce((sum, row) => sum + finiteNumber(valueFor(row)), 0) / rows.length)
    : 0;
  const active = (row = {}) => !['inactive', 'withdrawn', 'archived', 'cancelled'].includes(lower(row.Status));
  const same = (left, right) => lower(left) === lower(right);

  function recordId(row = {}) {
    return clean(row.RecordId || row.SubjectId || row.DepartmentId || row.ArmId || row.ClassId
      || row.TermId || row.SessionId || row.Username || row.StudentRef || row.__id);
  }

  function indexRows(rows = [], idFor = recordId) {
    return new Map(rows.map((row) => [lower(idFor(row)), row]).filter(([key]) => key));
  }

  function labelFor(index, id, fallback = '') {
    const row = index.get(lower(id));
    return clean(row?.Name || row?.DisplayName || row?.StudentName || row?.Username || fallback || id);
  }

  function scoreBand(score) {
    const value = finiteNumber(score);
    if (value >= 70) return '70–100';
    if (value >= 60) return '60–69';
    if (value >= 50) return '50–59';
    if (value >= 40) return '40–49';
    return 'Below 40';
  }

  function attendanceBand(percentage, hasAttendance) {
    if (!hasAttendance) return 'No attendance record';
    const value = finiteNumber(percentage);
    if (value >= 90) return '90–100%';
    if (value >= 75) return '75–89%';
    if (value >= 50) return '50–74%';
    return 'Below 50%';
  }

  function subjectScore(subject = {}, annual = true) {
    return finiteNumber(annual ? subject.AnnualTotal : (subject.Total ?? subject.WeightedTotal));
  }

  function subjectPass(subject = {}, score = 0) {
    const classification = lower(subject.Classification);
    if (classification) return classification !== 'fail';
    return finiteNumber(score) >= 50;
  }

  function allocationMatches(allocation = {}, result = {}, termId = '') {
    if (!active(allocation) || lower(allocation.AllocationRole) !== 'subject teacher') return false;
    if (!same(allocation.SessionId, result.SessionId)) return false;
    if (termId && !same(allocation.TermId, termId)) return false;
    if (!same(allocation.ClassId, result.ClassId)) return false;
    return !clean(allocation.ArmId) || same(allocation.ArmId, result.ArmId);
  }

  function uniqueFacet(rows, keyFor, labelForRow) {
    const values = new Map();
    rows.forEach((row) => {
      const key = clean(keyFor(row));
      if (!key || values.has(lower(key))) return;
      values.set(lower(key), { value: key, label: clean(labelForRow(row) || key) });
    });
    return [...values.values()].sort((left, right) => left.label.localeCompare(right.label, undefined, {
      numeric: true, sensitivity: 'base'
    }));
  }

  function comparison(rows, keyFor, labelForRow, scoreFor = (row) => row.Score, passFor = (row) => row.Pass) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = clean(keyFor(row));
      if (!key) return;
      const normalized = lower(key);
      const bucket = groups.get(normalized) || { Key: key, Label: clean(labelForRow(row) || key), Rows: [] };
      bucket.Rows.push(row);
      groups.set(normalized, bucket);
    });
    return [...groups.values()].map((bucket) => ({
      Key: bucket.Key,
      Label: bucket.Label,
      Count: bucket.Rows.length,
      StudentCount: new Set(bucket.Rows.map((row) => lower(row.StudentRef)).filter(Boolean)).size,
      Average: mean(bucket.Rows, scoreFor),
      PassRate: bucket.Rows.length
        ? rounded((bucket.Rows.filter(passFor).length / bucket.Rows.length) * 100)
        : 0,
      Highest: bucket.Rows.length ? rounded(Math.max(...bucket.Rows.map(scoreFor))) : 0,
      Lowest: bucket.Rows.length ? rounded(Math.min(...bucket.Rows.map(scoreFor))) : 0
    })).sort((left, right) => right.Average - left.Average || left.Label.localeCompare(right.Label));
  }

  function buildAcademicSessionAnalysis(input = {}, filterValue = {}) {
    const filters = {
      period: clean(filterValue.period || 'annual'), classId: clean(filterValue.classId),
      armId: clean(filterValue.armId), departmentId: clean(filterValue.departmentId),
      schoolStage: clean(filterValue.schoolStage), studentType: clean(filterValue.studentType),
      subjectId: clean(filterValue.subjectId), teacherUsername: lower(filterValue.teacherUsername),
      studentRef: clean(filterValue.studentRef), gender: clean(filterValue.gender),
      resultStatus: clean(filterValue.resultStatus), promotionOutcome: clean(filterValue.promotionOutcome),
      grade: clean(filterValue.grade), classification: clean(filterValue.classification),
      scoreBand: clean(filterValue.scoreBand), attendanceBand: clean(filterValue.attendanceBand),
      completeness: clean(filterValue.completeness), minimumAverage: clean(filterValue.minimumAverage),
      maximumAverage: clean(filterValue.maximumAverage), query: lower(filterValue.query)
    };
    const sessionId = clean(input.SessionId || input.sessionId);
    const termId = filters.period === 'annual' ? '' : clean(filters.period);
    const annual = !termId;
    const students = input.Students || input.students || [];
    const classes = input.Classes || input.classes || [];
    const arms = input.Arms || input.arms || [];
    const subjects = input.Subjects || input.subjects || [];
    const departments = input.Departments || input.departments || [];
    const staff = input.Staff || input.staff || [];
    const terms = (input.Terms || input.terms || []).filter((row) => !sessionId || same(row.SessionId, sessionId));
    const memberships = (input.StudentMemberships || input.studentMemberships || []).filter((row) => (
      active(row) && (!sessionId || same(row.SessionId, sessionId))
    ));
    const allocations = (input.TeacherAllocations || input.teacherAllocations || []).filter((row) => (
      active(row) && lower(row.AllocationRole) === 'subject teacher' && (!sessionId || same(row.SessionId, sessionId))
    ));
    const termResults = (input.TermResults || input.termResults || []).filter((row) => (
      (!sessionId || same(row.SessionId, sessionId))
      && lower(row.ResultType || 'End of Term') !== 'mid-term'
    ));
    const cumulativeResults = (input.CumulativeResults || input.cumulativeResults || []).filter((row) => !sessionId || same(row.SessionId, sessionId));
    const promotionDecisions = (input.PromotionDecisions || input.promotionDecisions || []).filter((row) => !sessionId || same(row.SessionId, sessionId));
    const sourceResults = annual ? cumulativeResults : termResults.filter((row) => same(row.TermId, termId));

    const studentIndex = indexRows(students, (row) => row.StudentRef);
    const classIndex = indexRows(classes, (row) => row.ClassId);
    const armIndex = indexRows(arms, (row) => row.ArmId);
    const subjectIndex = indexRows(subjects, (row) => row.SubjectId);
    const departmentIndex = indexRows(departments, (row) => row.DepartmentId);
    const staffIndex = indexRows(staff, (row) => row.Username);
    const termIndex = indexRows(terms, (row) => row.TermId);
    const rosterFacetRows = memberships.map((membership) => {
      const student = studentIndex.get(lower(membership.StudentRef)) || {};
      const schoolClass = classIndex.get(lower(membership.ClassId)) || {};
      const arm = armIndex.get(lower(membership.ArmId)) || {};
      const departmentId = clean(membership.DepartmentId || arm.DepartmentId);
      return {
        StudentRef: clean(membership.StudentRef),
        StudentName: clean(student.StudentName || student.DisplayName || membership.StudentName || membership.StudentRef),
        Gender: clean(student.Gender || membership.Gender || 'Not recorded'),
        StudentType: clean(student.StudentType || membership.StudentType || 'Not recorded'),
        ClassId: clean(membership.ClassId),
        ClassName: clean(membership.ClassName || labelFor(classIndex, membership.ClassId, membership.ClassId)),
        ArmId: clean(membership.ArmId),
        ArmName: clean(membership.ArmName || labelFor(armIndex, membership.ArmId, membership.ArmId)),
        DepartmentId: departmentId,
        DepartmentName: labelFor(departmentIndex, departmentId, departmentId),
        SchoolStage: clean(membership.SchoolStage || schoolClass.SchoolStage)
      };
    });
    const assignmentFacetRows = allocations.filter((allocation) => (
      (!termId || same(allocation.TermId, termId))
      && (!filters.classId || same(allocation.ClassId, filters.classId))
      && (!filters.armId || !clean(allocation.ArmId) || same(allocation.ArmId, filters.armId))
    )).map((allocation) => ({
      ...allocation,
      SubjectName: labelFor(subjectIndex, allocation.SubjectId, allocation.SubjectId),
      TeacherName: labelFor(staffIndex, allocation.TeacherUsername, allocation.TeacherUsername)
    }));
    const promotionByStudent = new Map();
    promotionDecisions.forEach((row) => {
      const key = lower(row.StudentRef);
      const previous = promotionByStudent.get(key);
      const currentDate = clean(row.CommittedAt || row.UpdatedAt || row.CreatedAt);
      const previousDate = clean(previous?.CommittedAt || previous?.UpdatedAt || previous?.CreatedAt);
      if (!previous || currentDate >= previousDate) promotionByStudent.set(key, row);
    });

    const candidateRows = sourceResults.map((result) => {
      const student = studentIndex.get(lower(result.StudentRef)) || {};
      const schoolClass = classIndex.get(lower(result.ClassId)) || {};
      const arm = armIndex.get(lower(result.ArmId)) || {};
      const promotion = promotionByStudent.get(lower(result.StudentRef)) || {};
      const resultSubjects = (result.Subjects || []).map((subject) => ({
        ...subject,
        SubjectName: clean(subject.SubjectName || labelFor(subjectIndex, subject.SubjectId, subject.SubjectId)),
        Score: subjectScore(subject, annual),
        Pass: subjectPass(subject, subjectScore(subject, annual))
      }));
      let analysisSubjects = resultSubjects;
      if (filters.subjectId) analysisSubjects = analysisSubjects.filter((subject) => same(subject.SubjectId, filters.subjectId));
      if (filters.teacherUsername) {
        const teacherSubjectIds = new Set(allocations.filter((allocation) => (
          same(allocation.TeacherUsername, filters.teacherUsername)
          && allocationMatches(allocation, result, termId)
        )).map((allocation) => lower(allocation.SubjectId)));
        analysisSubjects = analysisSubjects.filter((subject) => teacherSubjectIds.has(lower(subject.SubjectId)));
      }
      const scoreUsesSubjects = Boolean(filters.subjectId || filters.teacherUsername);
      const score = scoreUsesSubjects
        ? (analysisSubjects.length ? mean(analysisSubjects, (subject) => subject.Score) : null)
        : finiteNumber(result.OverallAverage);
      const grade = scoreUsesSubjects && analysisSubjects.length === 1
        ? clean(analysisSubjects[0].Grade)
        : clean(result.OverallGrade);
      const classification = scoreUsesSubjects
        ? (analysisSubjects.length === 1
          ? clean(analysisSubjects[0].Classification || (score >= 50 ? 'Pass' : 'Fail'))
          : (score >= 50 ? 'Pass' : 'Fail'))
        : clean(result.OverallClassification);
      const attendancePercentage = finiteNumber(result.Attendance?.AttendancePercentage);
      const hasAttendance = finiteNumber(result.Attendance?.Total) > 0 || attendancePercentage > 0;
      const promotionOutcome = clean(promotion.FinalOutcome || promotion.RecommendedOutcome || 'Not calculated');
      const contributingTerms = annual ? (result.ContributingResultIds || []).length : 1;
      const expectedTerms = annual ? (result.TermWeights || []).filter((term) => term.Required !== false).length : 1;
      const complete = annual
        ? !(result.MissingRequiredTerms || []).length && (!expectedTerms || contributingTerms >= expectedTerms)
        : true;
      const pass = classification ? lower(classification) !== 'fail' : finiteNumber(score) >= 50;
      const attendanceGroup = attendanceBand(attendancePercentage, hasAttendance);
      const atRisk = score !== null && (
        !pass || ['Below 50%', '50–74%'].includes(attendanceGroup)
        || ['pending', 'probation', 'repeated'].includes(lower(promotionOutcome))
      );
      return {
        ResultId: clean(result.CumulativeResultId || result.ResultId), StudentRef: clean(result.StudentRef),
        StudentName: clean(student.StudentName || student.DisplayName || result.StudentName || result.StudentRef),
        Gender: clean(student.Gender || result.Gender || 'Not recorded'),
        StudentType: clean(student.StudentType || result.StudentType || 'Not recorded'),
        ClassId: clean(result.ClassId), ClassName: clean(result.ClassName || labelFor(classIndex, result.ClassId, result.ClassId)),
        SchoolStage: clean(result.SchoolStage || schoolClass.SchoolStage),
        ArmId: clean(result.ArmId), ArmName: clean(result.ArmName || labelFor(armIndex, result.ArmId, result.ArmId)),
        DepartmentId: clean(result.DepartmentId || arm.DepartmentId),
        DepartmentName: labelFor(departmentIndex, result.DepartmentId || arm.DepartmentId, 'Not assigned'),
        Period: annual ? 'Annual cumulative' : labelFor(termIndex, termId, result.Term || termId),
        Status: clean(result.Status || result.PublicationStatus || 'Unknown'), Grade: grade || 'Not graded',
        Classification: classification || (pass ? 'Pass' : 'Fail'), Score: score,
        ScoreBand: score === null ? '' : scoreBand(score), Pass: pass,
        AttendancePercentage: attendancePercentage, AttendanceBand: attendanceGroup,
        HasAttendance: hasAttendance, PromotionOutcome: promotionOutcome,
        PromotionStatus: clean(promotion.Status || 'Not calculated'), Complete: complete,
        ContributingTerms: contributingTerms, ExpectedTerms: expectedTerms,
        Subjects: resultSubjects, AnalysisSubjects: analysisSubjects, AtRisk: atRisk,
        OverallPosition: result.OverallPosition ?? '', AssessedStudentCount: result.AssessedStudentCount ?? ''
      };
    });

    const numericMinimum = filters.minimumAverage === '' ? null : Number(filters.minimumAverage);
    const numericMaximum = filters.maximumAverage === '' ? null : Number(filters.maximumAverage);
    const rows = candidateRows.filter((row) => {
      if (row.Score === null) return false;
      if (filters.classId && !same(row.ClassId, filters.classId)) return false;
      if (filters.armId && !same(row.ArmId, filters.armId)) return false;
      if (filters.departmentId && !same(row.DepartmentId, filters.departmentId)) return false;
      if (filters.schoolStage && !same(row.SchoolStage, filters.schoolStage)) return false;
      if (filters.studentType && !same(row.StudentType, filters.studentType)) return false;
      if (filters.studentRef && !same(row.StudentRef, filters.studentRef)) return false;
      if (filters.gender && !same(row.Gender, filters.gender)) return false;
      if (filters.resultStatus && !same(row.Status, filters.resultStatus)) return false;
      if (filters.promotionOutcome && !same(row.PromotionOutcome, filters.promotionOutcome)) return false;
      if (filters.grade && !same(row.Grade, filters.grade)) return false;
      if (filters.classification && !same(row.Classification, filters.classification)) return false;
      if (filters.scoreBand && !same(row.ScoreBand, filters.scoreBand)) return false;
      if (filters.attendanceBand && !same(row.AttendanceBand, filters.attendanceBand)) return false;
      if (filters.completeness && (filters.completeness === 'complete') !== row.Complete) return false;
      if (Number.isFinite(numericMinimum) && row.Score < numericMinimum) return false;
      if (Number.isFinite(numericMaximum) && row.Score > numericMaximum) return false;
      if (filters.query && !lower([
        row.StudentName, row.StudentRef, row.ClassName, row.ArmName, row.DepartmentName,
        row.Status, row.Grade, row.PromotionOutcome
      ].join(' ')).includes(filters.query)) return false;
      return true;
    }).sort((left, right) => right.Score - left.Score || left.StudentName.localeCompare(right.StudentName));

    const cohortAverages = new Map(comparison(rows, (row) => `${row.ClassId}|${row.ArmId}`, (row) => `${row.ClassName} / ${row.ArmName}`)
      .map((row) => [lower(row.Key), row.Average]));
    let previousScore = null;
    let previousRank = 0;
    rows.forEach((row, index) => {
      if (previousScore === null || Math.abs(row.Score - previousScore) > 0.0001) {
        previousRank = index + 1;
        previousScore = row.Score;
      }
      row.FilteredRank = previousRank;
      row.CohortAverage = cohortAverages.get(lower(`${row.ClassId}|${row.ArmId}`)) || 0;
      row.DifferenceFromCohort = rounded(row.Score - row.CohortAverage);
    });

    const subjectObservations = rows.flatMap((row) => row.AnalysisSubjects.map((subject) => ({
      StudentRef: row.StudentRef, SubjectId: subject.SubjectId, SubjectName: subject.SubjectName,
      Score: subject.Score, Pass: subject.Pass
    })));
    const selectedStudentRefs = new Set(rows.map((row) => lower(row.StudentRef)));
    const teacherObservations = [];
    termResults.forEach((result) => {
      if (!selectedStudentRefs.has(lower(result.StudentRef))) return;
      if (termId && !same(result.TermId, termId)) return;
      if (filters.classId && !same(result.ClassId, filters.classId)) return;
      if (filters.armId && !same(result.ArmId, filters.armId)) return;
      (result.Subjects || []).forEach((subject) => {
        if (filters.subjectId && !same(subject.SubjectId, filters.subjectId)) return;
        allocations.filter((allocation) => allocationMatches(allocation, result, result.TermId)
          && same(allocation.SubjectId, subject.SubjectId)
          && (!filters.teacherUsername || same(allocation.TeacherUsername, filters.teacherUsername)))
          .forEach((allocation) => teacherObservations.push({
            StudentRef: result.StudentRef, TeacherUsername: allocation.TeacherUsername,
            TeacherName: labelFor(staffIndex, allocation.TeacherUsername, allocation.TeacherUsername),
            Score: subjectScore(subject, false), Pass: subjectPass(subject, subjectScore(subject, false))
          }));
      });
    });

    const termObservations = [];
    termResults.forEach((result) => {
      if (!selectedStudentRefs.has(lower(result.StudentRef))) return;
      if (filters.classId && !same(result.ClassId, filters.classId)) return;
      if (filters.armId && !same(result.ArmId, filters.armId)) return;
      let values = (result.Subjects || []).map((subject) => ({
        ...subject, Score: subjectScore(subject, false), Pass: subjectPass(subject, subjectScore(subject, false))
      }));
      if (filters.subjectId) values = values.filter((subject) => same(subject.SubjectId, filters.subjectId));
      if (filters.teacherUsername) {
        const teacherSubjects = new Set(allocations.filter((allocation) => allocationMatches(allocation, result, result.TermId)
          && same(allocation.TeacherUsername, filters.teacherUsername)).map((allocation) => lower(allocation.SubjectId)));
        values = values.filter((subject) => teacherSubjects.has(lower(subject.SubjectId)));
      }
      if (!values.length) return;
      const score = filters.subjectId || filters.teacherUsername
        ? mean(values, (subject) => subject.Score)
        : finiteNumber(result.OverallAverage);
      termObservations.push({
        StudentRef: result.StudentRef, TermId: result.TermId,
        TermName: clean(result.Term || labelFor(termIndex, result.TermId, result.TermId)),
        Score: score, Pass: score >= 50
      });
    });

    const coverageMatches = (row) => {
      const student = studentIndex.get(lower(row.StudentRef)) || {};
      const schoolClass = classIndex.get(lower(row.ClassId)) || {};
      const arm = armIndex.get(lower(row.ArmId)) || {};
      if (filters.classId && !same(row.ClassId, filters.classId)) return false;
      if (filters.armId && !same(row.ArmId, filters.armId)) return false;
      if (filters.departmentId && !same(row.DepartmentId || arm.DepartmentId, filters.departmentId)) return false;
      if (filters.schoolStage && !same(row.SchoolStage || schoolClass.SchoolStage, filters.schoolStage)) return false;
      if (filters.studentRef && !same(row.StudentRef, filters.studentRef)) return false;
      if (filters.gender && !same(student.Gender || row.Gender || 'Not recorded', filters.gender)) return false;
      if (filters.studentType && !same(student.StudentType || row.StudentType || 'Not recorded', filters.studentType)) return false;
      return true;
    };
    const rosterRefs = new Set(memberships.filter(coverageMatches).map((membership) => lower(membership.StudentRef)).filter(Boolean));
    const resultCoverageRefs = new Set(candidateRows.filter(coverageMatches).map((row) => lower(row.StudentRef)).filter(Boolean));
    const average = mean(rows, (row) => row.Score);
    const attendanceRows = rows.filter((row) => row.HasAttendance);
    const finalized = rows.filter((row) => ['published', 'locked'].includes(lower(row.Status))).length;
    const metrics = {
      StudentCount: rows.length,
      Average: average,
      PassRate: rows.length ? rounded((rows.filter((row) => row.Pass).length / rows.length) * 100) : 0,
      Highest: rows.length ? rounded(Math.max(...rows.map((row) => row.Score))) : 0,
      Lowest: rows.length ? rounded(Math.min(...rows.map((row) => row.Score))) : 0,
      AttendanceAverage: attendanceRows.length ? mean(attendanceRows, (row) => row.AttendancePercentage) : 0,
      AtRiskCount: rows.filter((row) => row.AtRisk).length,
      FinalizedCount: finalized,
      RosterCount: rosterRefs.size,
      CoverageRate: rosterRefs.size ? Math.min(100, rounded((resultCoverageRefs.size / rosterRefs.size) * 100)) : 0
    };

    const termComparison = comparison(termObservations, (row) => row.TermId, (row) => row.TermName);
    termComparison.sort((left, right) => {
      const leftTerm = termIndex.get(lower(left.Key)) || {};
      const rightTerm = termIndex.get(lower(right.Key)) || {};
      return clean(leftTerm.StartDate).localeCompare(clean(rightTerm.StartDate)) || left.Label.localeCompare(right.Label);
    });
    return {
      SessionId: sessionId,
      Period: annual ? 'Annual cumulative' : labelFor(termIndex, termId, termId),
      Annual: annual,
      Filters: filters,
      Rows: rows,
      Metrics: metrics,
      Facets: {
        periods: [{ value: 'annual', label: 'Annual cumulative' }, ...terms.map((row) => ({ value: row.TermId, label: clean(row.Name || row.Term) }))],
        classes: uniqueFacet(rosterFacetRows, (row) => row.ClassId, (row) => row.ClassName),
        arms: uniqueFacet(rosterFacetRows.filter((row) => !filters.classId || same(row.ClassId, filters.classId)), (row) => row.ArmId, (row) => `${row.ClassName} / ${row.ArmName}`),
        departments: uniqueFacet(rosterFacetRows, (row) => row.DepartmentId, (row) => row.DepartmentName),
        schoolStages: uniqueFacet(rosterFacetRows, (row) => row.SchoolStage, (row) => row.SchoolStage),
        studentTypes: uniqueFacet(rosterFacetRows, (row) => row.StudentType, (row) => row.StudentType),
        subjects: uniqueFacet(assignmentFacetRows, (row) => row.SubjectId, (row) => row.SubjectName),
        teachers: uniqueFacet(assignmentFacetRows, (row) => row.TeacherUsername, (row) => row.TeacherName),
        students: uniqueFacet(rosterFacetRows, (row) => row.StudentRef, (row) => `${row.StudentName} (${row.StudentRef})`),
        genders: uniqueFacet(rosterFacetRows, (row) => row.Gender, (row) => row.Gender),
        statuses: uniqueFacet(candidateRows, (row) => row.Status, (row) => row.Status),
        promotionOutcomes: uniqueFacet(candidateRows, (row) => row.PromotionOutcome, (row) => row.PromotionOutcome),
        grades: uniqueFacet(candidateRows, (row) => row.Grade, (row) => row.Grade),
        classifications: uniqueFacet(candidateRows, (row) => row.Classification, (row) => row.Classification),
        scoreBands: uniqueFacet(candidateRows, (row) => row.ScoreBand, (row) => row.ScoreBand),
        attendanceBands: uniqueFacet(candidateRows, (row) => row.AttendanceBand, (row) => row.AttendanceBand)
      },
      Comparisons: {
        Classes: comparison(rows, (row) => row.ClassId, (row) => row.ClassName),
        Arms: comparison(rows, (row) => row.ArmId, (row) => `${row.ClassName} / ${row.ArmName}`),
        Subjects: comparison(subjectObservations, (row) => row.SubjectId, (row) => row.SubjectName),
        Teachers: comparison(teacherObservations, (row) => row.TeacherUsername, (row) => row.TeacherName),
        Genders: comparison(rows, (row) => row.Gender, (row) => row.Gender),
        ScoreBands: comparison(rows, (row) => row.ScoreBand, (row) => row.ScoreBand),
        PromotionOutcomes: comparison(rows, (row) => row.PromotionOutcome, (row) => row.PromotionOutcome),
        Terms: termComparison
      },
      Warnings: [
        annual && !cumulativeResults.length && termResults.length
          ? 'Term results exist, but cumulative results have not been calculated for this session.'
          : '',
        rosterRefs.size && metrics.CoverageRate < 100
          ? `${rosterRefs.size - resultCoverageRefs.size} rostered student(s) do not yet have a ${annual ? 'cumulative' : 'term'} result.`
          : ''
      ].filter(Boolean)
    };
  }

  root.DynamaxAcademicResultsAnalysis = Object.freeze({ buildAcademicSessionAnalysis, scoreBand, attendanceBand });
}(typeof globalThis === 'undefined' ? window : globalThis));
