const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase();
const ids = row => [row?.SubjectId, row?.RecordId, row?.__id, row?.Id].map(clean).filter(Boolean);
const internal = value => /^subject__/i.test(clean(value));

// Resolve from the catalogue already in this workspace; never issue a lookup per result.
export function academicSubjectName(subject = {}, catalogue = []) {
  const subjectIds = ids(subject).map(key);
  const readable = value => clean(value) && key(value) !== 'subject' && !internal(value) && !subjectIds.includes(key(value));
  const snapshot = [subject.SubjectName, subject.Name].find(readable);
  if (snapshot) return clean(snapshot);
  const match = catalogue.find(row => ids(row).some(id => subjectIds.includes(key(id))));
  return clean([match?.Name, match?.SubjectName].find(readable));
}

// Presentation only: leave stored scores, workflow state, revisions and custom prose intact.
export function academicResultWithSubjectLabels(result = {}, catalogue = []) {
  const names = new Map();
  for (const subject of [...catalogue, ...(result.Subjects || [])]) {
    const name = academicSubjectName(subject, catalogue);
    for (const id of ids(subject)) if (internal(id)) names.set(key(id), name || 'this subject');
  }
  const output = { ...result, Subjects: (result.Subjects || []).map(subject => ({
    ...subject, SubjectName: academicSubjectName(subject, catalogue) || 'Subject'
  })) };
  for (const field of ['TeacherRemark', 'PrincipalRemark', 'Recommendation']) {
    if (typeof result[field] === 'string') output[field] = result[field].replace(
      /\bsubject__[a-z0-9_-]+\b/gi, id => names.get(key(id)) || 'this subject');
  }
  return output;
}
