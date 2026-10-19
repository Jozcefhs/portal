function clean(value) {
  return String(value ?? '').trim();
}

export function normalizeMinimumAdmissionAge(value) {
  const text = clean(value);
  if (!text) return null;
  const age = Number(text);
  return Number.isInteger(age) && age >= 0 && age <= 120 ? age : null;
}

function parseDateOnly(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return { year, month, day, date };
}

function referenceDateParts(value) {
  if (typeof value === 'string') return parseDateOnly(value);
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    date
  };
}

export function applicantAgeOn(dateOfBirth, referenceDate = new Date()) {
  const birth = parseDateOnly(dateOfBirth);
  const reference = referenceDateParts(referenceDate);
  if (!birth || !reference || birth.date > reference.date) return null;
  let age = reference.year - birth.year;
  if (
    reference.month < birth.month
    || (reference.month === birth.month && reference.day < birth.day)
  ) age -= 1;
  return age;
}

export function evaluateAdmissionAge(classConfig = {}, dateOfBirth, referenceDate = new Date()) {
  const className = clean(classConfig.ClassName || classConfig.className) || 'the selected class';
  const rawMinimumAge = classConfig.MinimumAge
    ?? classConfig.minimumAge
    ?? classConfig.MinimumAdmissionAge
    ?? classConfig.minimumAdmissionAge;
  const minimumAge = normalizeMinimumAdmissionAge(rawMinimumAge);
  if (minimumAge === null) return { ok: true, minimumAge: null, age: null, className };

  const age = applicantAgeOn(dateOfBirth, referenceDate);
  if (age === null) {
    return {
      ok: false,
      minimumAge,
      age: null,
      className,
      message: `Enter a valid date of birth for the applicant applying to ${className}.`
    };
  }
  if (age < minimumAge) {
    return {
      ok: false,
      minimumAge,
      age,
      className,
      message: `The applicant must be at least ${minimumAge} year${minimumAge === 1 ? '' : 's'} old to apply for ${className}.`
    };
  }
  return { ok: true, minimumAge, age, className };
}
