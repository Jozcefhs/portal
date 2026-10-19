import { formatPersonName } from './person-name-format.js';

const clean = (value) => String(value ?? '').trim();

// Current profile name parts are authoritative. Imported display-name aliases
// can survive a correction; reconcile them on reads, never rewrite snapshots.
export function withStudentDisplayName(row = {}, profile = {}) {
  const fallback = clean(row.DisplayName || row.displayName || row.ApplicantName || row.applicantName
    || row.StudentName || row.studentName || row.Name || row.name);
  const name = formatPersonName(row, profile, fallback);
  return name ? { ...row, DisplayName: name, ApplicantName: name, StudentName: name } : row;
}
