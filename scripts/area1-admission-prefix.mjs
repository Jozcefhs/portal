// Plan-only helpers. The live runner keeps its complete before/after backup private.
export const AREA1_BRANCH = 'area-1-primary';
export const AREA1_STUDENTS = `schoolBranches/${AREA1_BRANCH}/sections/primary/students`;
export const AREA1_PROJECT = 'school-management-suite-27064';
const prefix = `projects/${AREA1_PROJECT}/databases/(default)/documents/`;
const string = value => value?.stringValue;
const identity = /^(AdmissionNo|admissionNo|AdmissionNumber|AccountRef|StudentRef|StudentAdmissionNo|StudentRefs|StudentIds|ChildrenRefs|LinkedReferences)$/i;
const linkedCollections = new Set(['academicStudentMemberships', 'academicStudentMovements', 'academicStudentScores', 'academicScoreSheets']);

export function area1Admission(value) {
  return typeof value === 'string' && /^DCA\/[0-9]{2}\/[0-9]+$/.test(value)
    ? value.replace(/^DCA\//, 'DCAP1/') : value;
}

function rewrite(value, enabled = false) {
  if (value?.stringValue !== undefined) return enabled ? {stringValue: area1Admission(value.stringValue)} : value;
  if (value?.arrayValue?.values) return {arrayValue: {...value.arrayValue, values: value.arrayValue.values.map(v => rewrite(v, enabled))}};
  if (value?.mapValue?.fields) return {mapValue: {...value.mapValue, fields: Object.fromEntries(Object.entries(value.mapValue.fields).map(([k,v]) => [k,rewrite(v, identity.test(k))]))}};
  return value;
}

export function planArea1Prefix(documents) {
  const names = new Set(documents.map(d => d.name));
  const changes = [];
  for (const before of documents) {
    if (!before.name?.startsWith(prefix) || !before.updateTime) throw Error('A versioned document from the school project is required.');
    const path = before.name.slice(prefix.length), collection = path.split('/').slice(0,-1).join('/');
    if (string(before.fields?.BranchId) !== AREA1_BRANCH) throw Error('Refusing a record outside Area 1.');
    if (collection !== AREA1_STUDENTS && !linkedCollections.has(collection)) throw Error('Unsupported collection; review its identity rules first.');
    const fields = Object.fromEntries(Object.entries(before.fields).map(([k,v]) => [k,rewrite(v, identity.test(k))]));
    const mask = Object.keys(fields).filter(k => JSON.stringify(fields[k]) !== JSON.stringify(before.fields[k]));
    if (!mask.length) continue;
    let destination = before.name;
    if (collection === AREA1_STUDENTS) {
      const old = string(before.fields.AdmissionNo), next = area1Admission(old);
      if (path.split('/').at(-1) !== old.replaceAll('/','-')) throw Error('Unexpected student key.');
      if (next === old) throw Error('Student reference and admission number disagree.');
      destination = prefix + collection + '/' + next.replaceAll('/','-');
      if (names.has(destination)) throw Error('The destination admission number already exists.');
    }
    changes.push({before, after: {name: destination, fields}, mask, collection});
  }
  if (new Set(changes.map(c=>c.after.name)).size !== changes.length) throw Error('Duplicate destination.');
  return changes;
}

export function prefixWrites(change) {
  if (change.before.name === change.after.name) return [{update:change.after,updateMask:{fieldPaths:change.mask},currentDocument:{updateTime:change.before.updateTime}}];
  return [{update:change.after,currentDocument:{exists:false}},
    {delete:change.before.name,currentDocument:{updateTime:change.before.updateTime}}];
}

export function prefixBatches(changes, maxWrites = 400) {
  // Keep each learner and all of their reference updates in one atomic commit.
  const groups = new Map();
  for (const change of changes) {
    const fields = change.before.fields;
    const ref = string(fields.AdmissionNo) || string(fields.StudentRef);
    if (!ref) throw Error('Cannot group the record with its learner.');
    if (!groups.has(ref)) groups.set(ref, []);
    groups.get(ref).push(...prefixWrites(change));
  }
  const batches=[];let current=[];
  for(const writes of groups.values()) {
    if(writes.length>maxWrites)throw Error('One learner exceeds the atomic write limit.');
    if(current.length+writes.length>maxWrites){batches.push(current);current=[];}
    current.push(...writes);
  }
  if(current.length)batches.push(current);
  return batches;
}
