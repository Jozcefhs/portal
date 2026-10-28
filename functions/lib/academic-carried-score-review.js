// A transfer can retain an individual student's existing approval without
// approving the destination classmates. Editing marks or adopting another
// assessment invalidates this proof automatically.
export function academicCarriedScoreSnapshot(value) {
  const canonical = row => Array.isArray(row) ? row.map(canonical)
    : row && typeof row === 'object' ? Object.fromEntries(Object.keys(row).sort().map(key => [key, canonical(row[key])])) : row;
  return JSON.stringify(canonical(value || []));
}

export function academicCarriedScoreReview(score = {}, sheet = {}) {
  const review = score.ArmTransferReview;
  if (!review || review.AssessmentRevisionId !== score.AssessmentRevisionId
    || [sheet.ReopenedAt, sheet.ScoreEditingReactivatedAt].some(at => at && at >= review.TransferredAt)
    || review.ScoreSnapshot !== academicCarriedScoreSnapshot(score.ComponentScores)) return null;
  return review;
}
