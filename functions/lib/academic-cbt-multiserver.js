// A server is identified by the verified public-key fingerprint, never its LAN
// address or display name. Authorised reviewers may upload from multiple servers.
// Keep attempt provenance per score cell so equal marks cannot hide a duplicate.
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();

export function academicCbtScoreSources(previous, component, row, input, signingKeyId, syncId, syncBatches = []) {
  const partId = component.ScoreEntryMode === 'objective-theory' ? (clean(input.AssessmentPartId) || 'objective') : '';
  const cellId = `${component.Id}${partId ? `:${partId}` : ''}`;
  const sources = Array.isArray(previous?.CbtScoreSources) ? previous.CbtScoreSources : [];
  const prior = sources.find(source => source.CellId === cellId);
  const testId = clean(input.SourceTestId || input.ExamId);
  const attemptId = clean(row.AttemptId);
  const conflict = (detail) => {
    throw Object.assign(new Error(
      `${row.StudentRef}: ${component.Name || component.Id} ${detail}. `
      + 'This student result was not posted and the existing result was preserved. '
      + 'Review the attempts from both centres before making an authorised score correction; do not repeat the test.'
    ), { status: 409, code: 'ACADEMIC_CBT_SYNC_ATTEMPT_CONFLICT' });
  };
  if (!attemptId || !testId) {
    throw Object.assign(new Error('Each built-in CBT score needs its test and attempt identity. Update the desktop app and retry.'),
      { status: 409, code: 'ACADEMIC_CBT_SYNC_ATTEMPT_REQUIRED' });
  }
  if ((previous?.ManualScoreCorrections || []).some(row => row.CellId === cellId)) {
    conflict('has an authorised manual correction that an upload cannot replace');
  }
  if (prior) {
    if (lower(prior.SigningKeyId) !== lower(signingKeyId)
        || clean(prior.AttemptId) !== attemptId || clean(prior.SourceTestId) !== testId) {
      conflict('already has a result from another CBT attempt or server');
    }
  } else {
    const oldComponent = (previous?.ComponentScores || []).find(score => score.ComponentId === component.Id);
    const oldCell = partId ? oldComponent?.Parts?.find(part => part.PartId === partId) : oldComponent;
    if (['Numeric', 'Absent', 'Exempt'].includes(clean(oldCell?.State))) {
      // Older releases stored the signer on the batch, but not the attempt on
      // each cell. Preserve same-server compatibility; never guess across servers.
      const history = syncBatches.filter(batch => batch.SourceType === 'BuiltInCBT'
        && batch.SheetId === previous.SheetId && batch.AssessmentComponentId === component.Id
        && (!partId || (clean(batch.AssessmentPartId) || 'objective') === partId)
        && (batch.AffectedScoreIds || []).includes(previous.ScoreId));
      if (!history.length || history.some(batch => lower(batch.SigningKeyId) !== lower(signingKeyId)
          || clean(batch.SourceTestId) !== testId)) {
        conflict('already has a recorded result whose original attempt needs review');
      }
    }
  }
  return [
    ...sources.filter(source => source.CellId !== cellId),
    { CellId: cellId, SourceTestId: testId, AttemptId: attemptId, SigningKeyId: signingKeyId,
      SyncId: syncId, SubmittedAt: clean(row.SubmittedAt) }
  ];
}
