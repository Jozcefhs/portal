const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const table = (headings, rows) => `<table><thead><tr>${headings.map(value => `<th>${escape(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headings.length}">No saved attendance records.</td></tr>`}</tbody></table>`;

const printStyles = `<style>
    @page{size:A4 landscape;margin:12mm}body{font:12px Arial;color:#102a43;margin:24px}h1{font-size:22px}h2{font-size:17px}
    table{width:100%;border-collapse:collapse}th,td{padding:7px;border:1px solid #bbc9d5;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}
    thead{display:table-header-group}th{background:#edf3f8}tr{break-inside:avoid}.detail{break-before:page}button{padding:10px 18px}
    @media print{button{display:none}body{margin:0}}</style>`;

export function attendancePrintHtml({ schoolName, classroom, period, mode, summaries, records, studentName, subjectName }) {
  const details = [...records].sort((a, b) => String(a.AttendanceDate).localeCompare(String(b.AttendanceDate))
    || String(a.StudentRef).localeCompare(String(b.StudentRef)) || String(a.TimetableEntryId || '').localeCompare(String(b.TimetableEntryId || '')));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(classroom)} attendance</title>${printStyles}</head><body><button onclick="window.print()">Print / Save as PDF</button>
    <h1>${escape(schoolName || 'School')}</h1><h2>${escape(classroom)} — Attendance</h2><p>${escape(period)} · ${escape(mode)} registers</p>
    <p>Saved records only. Blank or unmarked dates are not assumed present. Pending corrections are not applied.</p>
    ${table(['S/N', 'Student', 'Reference', 'Present', 'Absent', 'Late', 'Excused', 'Left early', 'Registers', 'School open days', 'Attendance'], summaries.map((row, i) => [i + 1, studentName(row.StudentRef), row.StudentRef, row.Present, row.Absent, row.Late, row.Excused, row.LeftEarly, row.Total, row.SchoolDaysOpen ?? '—', `${row.AttendancePercentage}%`]))}
    <section class="detail"><h2>Dated attendance register — ${escape(classroom)}</h2><p>${escape(period)} · ${escape(mode)}</p>
    ${table(['Date', 'Student', 'Reference', 'Register / subject / lesson', 'Status', 'Minutes late', 'Note'], details.map(row => [row.AttendanceDate, studentName(row.StudentRef), row.StudentRef, [row.Mode, row.SubjectId ? subjectName(row.SubjectId) : '', row.TimetableEntryId || ''].filter(Boolean).join(' · '), row.Status, row.MinutesLate ?? '', row.Note || '']))}</section>
    <p>Generated ${escape(new Date().toLocaleString())} · ${details.length} saved attendance entries</p></body></html>`;
}

export function studentAttendancePrintHtml({ schoolName, name, reference, period, register, records, classroom, lesson }) {
  const details = [...records].sort((a, b) => String(a.AttendanceDate).localeCompare(String(b.AttendanceDate))
    || lesson(a).localeCompare(lesson(b)));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(name)} · Attendance history</title>${printStyles}</head>
    <body><button type="button" onclick="window.print()">Print / Save as PDF</button>
    <h1>${escape(schoolName)}</h1><h2>${escape(name)} · ${escape(reference)}</h2>
    <p>${escape(register)} · ${escape(period)} · ${details.length} saved attendance entries</p>
    ${table(['Date', 'Classroom', 'Register', 'Status', 'Minutes late', 'Note', 'Marked by'], details.map(row =>
      [row.AttendanceDate, classroom(row), lesson(row), row.Status, row.MinutesLate ?? '', row.Note, row.MarkedBy]))}
    </body></html>`;
}
