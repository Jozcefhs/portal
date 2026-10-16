const clean = value => String(value ?? '').trim().toLowerCase();

// Do not pass the composite register ID through safeScopeId: it truncates each
// part to 80 characters and can remove the date, classroom and register mode.
export function attendanceIdentity(record = {}) {
  const mode = clean(record.Mode || 'Daily');
  return JSON.stringify([
    clean(record.BranchId || 'main'), clean(record.SchoolSection || 'secondary'),
    clean(record.SessionId), clean(record.TermId), clean(record.AttendanceDate),
    clean(record.ClassId), clean(record.ArmId), mode,
    mode === 'subject' ? clean(record.SubjectId) : mode === 'period' ? clean(record.TimetableEntryId) : '',
    clean(record.StudentRef)
  ]);
}

export async function academicAttendanceId(record) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(attendanceIdentity(record)));
  return `attendance-v2-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function findExistingAttendance(records, intended, id) {
  const identity = attendanceIdentity(intended);
  const matches = records.filter(row => attendanceIdentity(row) === identity);
  const occupied = records.find(row => clean(row.AttendanceId || row.RecordId || row.__id) === clean(id));
  if (matches.length > 1 || (occupied && attendanceIdentity(occupied) !== identity)) {
    throw Object.assign(new Error('This student has ambiguous attendance records for the selected register. Review them before saving; no attendance has been changed.'),
      { status: 409, code: 'ACADEMIC_ATTENDANCE_AMBIGUOUS' });
  }
  // Keep the original document and revision for legacy history/corrections.
  return matches[0] || null;
}

export function attendanceCorrectionMatches(correction, record) {
  // Older correction requests did not copy the mode/subject/period. Their
  // original record supplies those fields, while the date/class/student and
  // branch/section must still match (including established legacy defaults).
  return attendanceIdentity({ ...correction,
    ...(!correction.Mode ? { Mode: record.Mode, SubjectId: record.SubjectId, TimetableEntryId: record.TimetableEntryId } : {})
  }) === attendanceIdentity(record);
}
