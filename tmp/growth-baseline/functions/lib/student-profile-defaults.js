const clean = (value) => String(value ?? '').trim();

function savedValue(row, field, aliases = []) {
  // A canonical value (even an intentional clearing) takes precedence over an
  // old import alias. Defaults fill missing values; they never replace choices.
  if (Object.hasOwn(row || {}, field)) return clean(row[field]);
  return aliases.map((alias) => clean(row?.[alias])).find(Boolean) || '';
}

export function studentProfileDefaults(row = {}) {
  const enrollment = savedValue(row, 'EnrollmentCategory', ['enrollmentCategory', 'IntakeCategory', 'StudentEntryType']);
  const progress = savedValue(row, 'AcademicProgress', ['academicProgress', 'ProgressCategory', 'RepeaterStatus']);
  return {
    BillingCategory: savedValue(row, 'BillingCategory', ['billingCategory']) || 'Regular',
    AcademicProgress: progress || (enrollment.toLowerCase() === 'returning' ? 'Promoted' : '')
  };
}

export function withStudentProfileDefaults(row = {}) {
  return { ...row, ...studentProfileDefaults(row) };
}

export function missingStudentProfileDefaults(row = {}) {
  return Object.fromEntries(Object.entries(studentProfileDefaults(row))
    .filter(([field, value]) => value && !clean(row[field])));
}

export function studentProfileDefaultsPlan(rows = []) {
  const changes = rows.map((row) => ({ row, patch: missingStudentProfileDefaults(row) }))
    .filter(({ patch }) => Object.keys(patch).length);
  return { total: rows.length, changes,
    billingCategory: changes.filter(({ patch }) => patch.BillingCategory).length,
    academicProgress: changes.filter(({ patch }) => patch.AcademicProgress).length };
}

export async function studentProfileDefaultsFingerprint(plan, scope = {}) {
  const signature = JSON.stringify({ scope, changes: plan.changes.map(({ row, patch }) =>
    [row.__scopePath, row.__id, row.__updateTime, patch]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
