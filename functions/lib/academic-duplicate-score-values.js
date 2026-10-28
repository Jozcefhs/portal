const clean = value => String(value ?? '').trim();
export const academicScoreCell = (score, id) => {
  const [componentId, partId] = id.split(':');
  const components = (score.ComponentScores || []).filter(row => row.ComponentId === componentId);
  if (components.length !== 1) return null;
  if (!partId) return components[0].Parts?.length ? null : components[0];
  const parts = (components[0].Parts || []).filter(row => row.PartId === partId);
  return parts.length === 1 ? parts[0] : null;
};
export const academicDuplicateValue = cell => ({State:cell.State, RawScore:cell.RawScore ?? null, MaximumScore:cell.MaximumScore ?? null});
export const sameAcademicDuplicateValue = (a,b) => a && b && JSON.stringify(academicDuplicateValue(a)) === JSON.stringify(academicDuplicateValue(b));
export const academicDuplicateRecorded = cell => cell && ['Numeric','Absent','Exempt'].includes(cell.State);

// Only an explicit resolution can designate the working current-arm record.
// New conflicting sources or changed former-arm marks require a fresh review.
export function resolvedAcademicScoreEntry(entries, membership, testId) {
  const working = entries.filter(row => row.ArmId === clean(membership.ArmId) && row.Resolutions?.[testId]);
  if (working.length !== 1) return null;
  const target = working[0], receipt = target.Resolutions[testId];
  if (receipt.WorkingScoreId !== target.ScoreId || !receipt.ResolutionId || !Array.isArray(receipt.Candidates)
      || receipt.Candidates.length !== entries.length || new Set(entries.map(row=>row.ScoreId)).size !== entries.length) return null;
  if (!entries.every(row => receipt.Candidates.some(saved => saved.ScoreId === row.ScoreId && saved.ArmId === row.ArmId
      && (row.ScoreId === target.ScoreId || sameAcademicDuplicateValue(saved,row))))) return null;
  return target;
}
