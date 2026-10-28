/* One report layout for staff previews and parent view/print. No data reads or writes. */
(() => {
  'use strict';
  const clean = value => String(value ?? '').trim();
  const present = value => value !== '' && value !== undefined && value !== null;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const initials = name => clean(name).split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
  const styles = `@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font:12px/1.4 Arial,sans-serif;color:#17324d;margin:22px}.report{border:2px solid #42576b;padding:18px}.letterhead{display:grid;grid-template-columns:82px 1fr 92px;align-items:center;gap:14px;border-bottom:3px solid #08735f;padding-bottom:12px}.logo{width:76px;height:76px;object-fit:contain}.school{text-align:center}.school h1{margin:0;color:#123f6d;font-size:23px}.school p{margin:3px 0;color:#526b80}.passport{object-fit:cover;width:82px;height:96px;border:2px solid #c5d2dd;border-radius:12px;display:grid;place-items:center;background:#eef3f7;color:#63788c;font-size:22px;font-weight:800}.title{text-align:center;margin:14px 0 10px}.title h2{margin:0;color:#123f6d}.report-table{width:100%;border-collapse:collapse;margin-top:10px;table-layout:fixed}.report-table th,.report-table td{border:1px solid #cad8e3;padding:6px;text-align:left;vertical-align:top}.report-table th{background:#164a78;color:#fff;font-size:9px;text-transform:uppercase}.identity-table{margin-top:0;background:#eef6fb}.identity-table td{padding:7px 9px}.identity-table span{display:block;color:#61768a;font-size:8px;font-weight:700;text-transform:uppercase}.identity-table strong{display:block;margin-top:3px}.subject-table td:not(:first-child),.subject-table th:not(:first-child),.summary-table td,.summary-table th{text-align:center}.summary-table th{background:#edf8f5;color:#08735f}.summary-table td{font-weight:800}.remarks-table td:first-child{width:72%}.remarks-table p{margin:5px 0}.endorsement,.result-signatory{text-align:center}.endorsement .decision{display:block;margin-bottom:4px;color:#08735f}.result-signatory strong{max-width:100%;white-space:nowrap}.stamp{display:block;width:105px;height:82px;margin:0 auto 4px;object-fit:contain}.criteria-table th{background:#eef4f8;color:#123f6d}.criteria-table ul{margin:0;padding-left:17px;font-size:9px}.verification-table td:first-child{width:90px;text-align:center}.verification-table img{width:74px;height:74px}.reference{font-size:9px;color:#647b90;overflow-wrap:anywhere}.sample{margin-top:12px;color:#a42626;font-weight:800;text-align:center}.no-print{margin-top:12px;padding:9px 14px;border:0;border-radius:7px;background:#1769e0;color:#fff;font-weight:700}@media print{body{margin:0}.report{border-color:#42576b}.no-print{display:none}.sample{display:block}}
    /* Give the subject its full intrinsic width; marks share the remaining space. */
    .subject-table{table-layout:auto}
    .subject-table col{width:calc(100% / var(--report-column-count))}
    .subject-table th,.subject-table td{width:auto}
    .subject-table th:first-child,.subject-table td:first-child{white-space:nowrap;overflow-wrap:normal;word-break:normal}
    .subject-table tr{break-inside:avoid}
    .report-table thead{display:table-header-group}
    .identity-table,.summary-table,.remarks-table,.verification-table{break-inside:avoid}
    @media screen and (max-width:740px){body{margin:12px}.report{min-width:680px}}
    @media print{html,body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.report{min-width:0}}
`;

function weightedMarkup(record) {
  const columns = [...new Map((record.Subjects || []).flatMap(subject => (subject.WeightedComponents || [])
    .map(component => [component.ComponentId, component]))).values()];
  return `<table class="report-table subject-table" style="--report-column-count:${columns.length + 3}"><colgroup>${'<col>'.repeat(columns.length + 3)}</colgroup><thead><tr><th>Subject</th>${columns.map(component =>
    `<th>${escapeHtml(component.Name || 'Assessment')}</th>`).join('')}<th>Total</th><th>Grade</th></tr></thead><tbody>${(record.Subjects || []).map(subject =>
    `<tr><td>${escapeHtml(subject.SubjectName || 'Subject')}</td>${columns.map(column => {
      const component = (subject.WeightedComponents || []).find(row => row.ComponentId === column.ComponentId);
      return `<td>${component?.State === 'Exempt' ? 'Exempt' : component?.WeightedMark == null ? '—'
        : `${escapeHtml(component.WeightedMark)} / ${escapeHtml(component.MaximumMark)}`}</td>`;
    }).join('')}<td>${escapeHtml(subject.Total ?? '—')}</td><td>${escapeHtml(subject.Grade || '—')}</td></tr>`).join('')}${clean(record.ResultType).toLowerCase() === 'mid-term' ? (record.NotTaughtSubjects || []).map(subject => `<tr><td>${escapeHtml(subject.SubjectName || 'Subject')}</td><td colspan="${columns.length + 2}">Not taught this mid-term · Not included in average</td></tr>`).join('') : ''}</tbody></table>`;
}

function formatAverage(value) {
  return present(value) && clean(value) && Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
}

function reportDate(value, birthDate = false) {
  const text = clean(value);
  if (!text) return '';
  let date;
  if (birthDate) {
    // Birth dates are calendar dates, independent of the viewing device's zone.
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
    const legacy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!iso && !legacy) return '';
    const [year, month, day] = iso ? iso.slice(1).map(Number) : [Number(legacy[3]), Number(legacy[2]), Number(legacy[1])];
    date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  } else {
    date = new Date(text);
    if (!Number.isFinite(date.getTime())) return '';
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: birthDate ? 'UTC' : 'Africa/Lagos'
  }).format(date);
}

function academicResultCriteriaMarkup(record = {}) {
  const policy = record.PolicySnapshot || {};
  const gradeBands = policy.Assessment?.GradeBands || [];
  const promotion = policy.Promotion || {};
  const gradeRows = gradeBands.map((band) => `<li><strong>${escapeHtml(band.Grade || '')}</strong> ${escapeHtml(band.MinimumPercentage ?? 0)}-${escapeHtml(band.MaximumPercentage ?? 100)}%${band.Remark ? ` - ${escapeHtml(band.Remark)}` : ''}</li>`).join('');
  const junior = promotion.JuniorSecondary || {};
  const senior = promotion.SeniorSecondary || {};
  const general = [];
  if (promotion.MinimumOverallAverage !== null && promotion.MinimumOverallAverage !== undefined) general.push(`Minimum average: ${promotion.MinimumOverallAverage}%`);
  if (promotion.MaximumFailedSubjects !== null && promotion.MaximumFailedSubjects !== undefined) general.push(`Maximum failed subjects: ${promotion.MaximumFailedSubjects}`);
  if (promotion.MinimumAttendancePercentage !== null && promotion.MinimumAttendancePercentage !== undefined) general.push(`Minimum attendance: ${promotion.MinimumAttendancePercentage}%`);
  if (promotion.ProbationResit?.Enabled === true) general.push(`Optional probation re-sit: pass mark ${promotion.ProbationResit.PassPercentage ?? 50}%`);
  const juniorRows = [
    junior.PromotedMinimumAverage !== null && junior.PromotedMinimumAverage !== undefined ? `Promoted: ${junior.PromotedMinimumAverage}% and above` : '',
    junior.ProbationMinimumAverage !== null && junior.ProbationMinimumAverage !== undefined ? `Probation review: ${junior.ProbationMinimumAverage}% to below ${junior.PromotedMinimumAverage ?? 'the promoted threshold'}%` : ''
  ].filter(Boolean);
  const seniorRows = [
    senior.PromotedMinimumCredits ? `Promoted: at least ${senior.PromotedMinimumCredits} Core credits at ${senior.CreditMinimumPercentage ?? 50}% or above` : '',
    senior.ProbationCreditCount ? `Probation review: ${senior.ProbationCreditCountMode === 'at-least' ? 'at least ' : ''}${senior.ProbationCreditCount} Core credits` : ''
  ].filter(Boolean);
  const generalRows = general.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  const fallback = '<li>Subject to management review and the approved promotion policy.</li>';
  return `<table class="report-table criteria-table"><thead><tr><th>Grade key</th><th>Junior</th><th>Senior</th></tr></thead><tbody><tr><td><ul>${gradeRows || '<li>Uses the approved grading policy for this result.</li>'}</ul></td><td><ul>${generalRows}${juniorRows.map((line) => `<li>${escapeHtml(line)}</li>`).join('') || fallback}</ul></td><td><ul>${generalRows}${seniorRows.map((line) => `<li>${escapeHtml(line)}</li>`).join('') || fallback}</ul></td></tr></tbody></table>`;
}

function academicResultIdentityMarkup(child = {}, record = {}, learnerLabel = 'Student') {
  const className = clean(record.ClassName || '-');
  const armName = clean(record.ArmName);
  const classLabel = armName && !className.toLowerCase().includes(armName.toLowerCase())
    ? `${className} / ${armName}`
    : className;
  const released = ['published', 'locked'].includes(clean(record.PublicationStatus || record.Status).toLowerCase());
  const cells = [
    [learnerLabel, child.DisplayName || child.StudentName || record.StudentName || child.AccountRef || learnerLabel],
    ['Admission number', child.AccountRef || child.AdmissionNo || record.StudentRef || '-'],
    ['Class', classLabel],
    ['Gender', child.Gender || record.Gender || 'Not recorded'],
    ['Academic session', record.AcademicSession || '-'],
    ['Term', record.Term || '-'],
    ['Date of birth', reportDate(child.DateOfBirth || child.dateOfBirth || record.DateOfBirth, true) || 'Not recorded'],
    ['Result release date', released ? reportDate(record.PublishedAt) || 'Not recorded' : 'Not released']
  ];
  return `<table class="report-table identity-table"><tbody>${[cells.slice(0, 3), cells.slice(3, 6), cells.slice(6)].map((row) => `<tr>${row.map(([label, value], index) => `<td${row.length === 2 && index === 1 ? ' colspan="2"' : ''}><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function academicResultSummaryMarkup(record = {}) {
  const position = present(record.OverallPosition)
    ? ` · ${record.OverallPosition}${record.AssessedStudentCount ? ` of ${record.AssessedStudentCount}` : ''}`
    : '';
  const cells = [
    ['Overall average', formatAverage(record.OverallAverage)],
    ['Class average', formatAverage(record.ClassAverage)],
    ['Overall grade', `${record.OverallGrade || '-'}${position}`],
    ['Attendance', present(record.Attendance?.AttendancePercentage) ? `${record.Attendance.AttendancePercentage}%` : '—'],
    ['Decision', record.Recommendation || record.OverallRemark || record.OverallClassification || 'Pending review']
  ];
  return `<table class="report-table summary-table"><thead><tr>${cells.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('')}</tr></thead><tbody><tr>${cells.map(([, value]) => `<td>${escapeHtml(value)}</td>`).join('')}</tr></tbody></table>`;
}

function render(child, record, options = {}) {
  if (record.Access?.Allowed === false) throw new Error('This result is not available.');
  const profile = options.profile || {};
  const origin = options.origin || '';
  const sampleLabel = clean(options.sampleLabel);
  const staffWarning = options.staffPreview && !['Published', 'Locked'].includes(record.PublicationStatus || record.Status)
    ? `${record.Status || 'Draft'} — STAFF PREVIEW, NOT A PUBLISHED RESULT` : '';
  const schoolName = profile.SchoolName || profile.OrganizationName || 'School';
  const logoUrl = profile.DocumentLogoUrl || '/api/document-logo';
  const stampUrl = profile.DocumentStampUrl || '/api/document-stamp';
  const primary = ['nursery', 'primary'].includes(String(record.SchoolStage || child.SchoolSection || '').toLowerCase())
    || /(?:nursery|primary|grade\s*[1-6]\b)/i.test(String(record.ClassName || child.ClassName || ''));
  const learnerLabel = primary ? 'Pupil' : 'Student';
  const executiveLabel = primary ? 'Head Teacher' : 'Principal';
  const reportTitle = clean(record.ResultType) === 'Mid-Term' ? 'Mid-Term Academic Result' : 'Academic Result';
  const passport = options.passportDataUrl
    ? `<img class="passport" src="${escapeHtml(options.passportDataUrl)}" alt="Student passport photograph">`
    : `<div class="passport passport-empty" aria-label="Passport photograph unavailable">${escapeHtml(initials(child.DisplayName || child.StudentName || record.StudentName || 'Student'))}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(record.Term || 'Academic Result')}</title><style>${styles}</style></head><body><main class="report"><header class="letterhead"><img class="logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(schoolName)} logo" onerror="this.style.visibility='hidden'"><div class="school"><h1>${escapeHtml(schoolName)}</h1><p>${escapeHtml(profile.SchoolAddress || '')}</p><p>${escapeHtml([profile.SchoolPhone, profile.SchoolEmail].filter(Boolean).join(' · '))}</p></div>${passport}</header><section class="title"><h2>${escapeHtml(reportTitle)}</h2></section>${staffWarning ? `<p class="sample">${escapeHtml(staffWarning)}</p>` : ''}${academicResultIdentityMarkup(child, record, learnerLabel)}
  ${weightedMarkup(record)}
  ${academicResultSummaryMarkup(record)}
  <table class="report-table remarks-table"><tbody><tr><td><p><strong>Form Teacher:</strong> ${escapeHtml(record.TeacherRemark || '-')}</p><p><strong>${executiveLabel}:</strong> ${escapeHtml(record.PrincipalRemark || '-')}</p></td><td class="endorsement result-signatory"><strong class="decision">${escapeHtml(record.Recommendation || record.OverallRemark || 'Pending review')}</strong><img class="stamp" src="${escapeHtml(stampUrl)}" alt="Official stamp" onerror="this.style.visibility='hidden'"><strong>${escapeHtml(profile.ResultSignatoryName || 'Authorized school officer')}</strong><br><small>${escapeHtml(profile.ResultSignatoryTitle || 'Official result signatory')}</small></td></tr></tbody></table>
  ${academicResultCriteriaMarkup(record)}
  <table class="report-table verification-table"><tbody><tr><td><img src="${escapeHtml(`${origin}/api/academic-result-qr?reference=${encodeURIComponent(record.ResultReference || record.ResultId)}`)}" alt="Result verification QR code"></td><td><strong>Result verification</strong><p class="reference">Result reference: ${escapeHtml(record.ResultReference || record.ResultId)}<br>Verification: ${escapeHtml(`${origin}/verify-result.html?reference=${encodeURIComponent(record.ResultReference || record.ResultId)}`)}</p></td></tr></tbody></table>${sampleLabel ? `<p class="sample">${escapeHtml(sampleLabel.toUpperCase())} SAMPLE PREVIEW · NOT AN OFFICIAL RESULT</p>` : ''}<button class="no-print" onclick="window.print()">${sampleLabel ? 'Print preview' : 'Print result'}</button></main></body></html>`;
}


  globalThis.DynamaxAcademicResultTemplate = Object.freeze({ render, weightedMarkup, formatAverage, styles });
})();
