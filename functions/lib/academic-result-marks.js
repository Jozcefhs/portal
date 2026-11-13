// Presentation only: use the saved score/policy snapshot, never today's scheme.
const clean = value => String(value ?? '').trim();
const number = value => value === null || value === undefined || value === '' ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function academicWeightedResultComponents(subject = {}, policySnapshot = {}, resultType = '') {
  const definitions = policySnapshot.Assessment?.Components || [];
  const scores = subject.ComponentScores || [];
  let completeMetadata = scores.length > 0;
  const components = scores.map(score => {
    const maximum = number(score.MaximumScore), weight = number(score.WeightPercentage);
    const definition = definitions.find(row => clean(row.Id) === clean(score.ComponentId));
    if (!(maximum > 0) || weight === null || weight < 0) completeMetadata = false;
    const cells = score.Parts?.length ? score.Parts : [score];
    let earned = 0, included = 0, unresolved = false;
    for (const cell of cells) {
      const cellMaximum = number(cell.MaximumScore);
      if (!(cellMaximum > 0)) completeMetadata = false;
      const cellWeight = maximum > 0 && cellMaximum > 0 && weight !== null ? weight * cellMaximum / maximum : 0;
      if (cell.State === 'Exempt') continue;
      included += cellWeight;
      if (cell.State === 'Numeric') {
        const raw = number(cell.RawScore);
        if (raw === null || raw < 0 || raw > cellMaximum) completeMetadata = false;
        else earned += raw / cellMaximum * cellWeight;
      } else if (cell.State !== 'Absent') unresolved = true;
    }
    return { ComponentId: clean(score.ComponentId), Name: clean(score.ComponentName || definition?.Name || score.ComponentId),
      State: included === 0 && cells.every(cell => cell.State === 'Exempt') ? 'Exempt' : unresolved ? 'Incomplete' : 'Numeric',
      earned, included, savedWeight: weight, configuredWeight: number(definition?.WeightPercentage) };
  });
  const included = components.reduce((sum, row) => sum + row.included, 0);
  const total = number(subject.Total ?? subject.Percentage);
  const calculated = included > 0 ? components.reduce((sum, row) => sum + row.earned, 0) * 100 / included : null;
  // Legacy partial snapshots cannot reliably explain a saved total. Do not invent marks.
  const reliable = completeMetadata && included > 0 && total !== null && Math.abs(calculated - total) <= 0.02;
  return components.map(({ earned, included: weight, savedWeight, configuredWeight, ...row }) => {
    // Mid-term totals are percentages, but its displayed components retain their
    // contribution to the full term. Both weights come from the saved snapshot.
    const midTerm = clean(resultType).toLowerCase() === 'mid-term';
    const scale = midTerm ? (savedWeight > 0 && configuredWeight > 0 ? configuredWeight / savedWeight : null) : 100 / included;
    const available = reliable && scale !== null;
    return { ...row, State: available ? row.State : 'Unavailable',
      WeightedMark: available && row.State === 'Numeric' ? round(earned * scale) : null,
      MaximumMark: available && row.State !== 'Exempt' ? round(weight * scale) : null
    };
  });
}

export function academicResultWithWeightedComponents(result = {}) {
  return { ...result, Subjects: (result.Subjects || []).map(subject => ({ ...subject,
    WeightedComponents: academicWeightedResultComponents(subject, result.PolicySnapshot || {}, result.ResultType)
  })) };
}
