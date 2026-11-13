import {AREA1_BRANCH,AREA1_STUDENTS,AREA1_PROJECT} from './area1-admission-prefix.mjs';
const base=`projects/${AREA1_PROJECT}/databases/(default)/documents/`;
const value=v=>v?.stringValue??v?.integerValue;
const normalized=v=>String(v).replace(/^(?:DCA|DCAP1)\/(\d{2})\/0*(\d+)$/,'$1/$2');
export function planArea1OlderEntries(profiles, memberships, movements, scores) {
  const all=[...profiles,...memberships,...movements,...scores];
  for(const doc of all)if(!doc.name?.startsWith(base)||!doc.updateTime||value(doc.fields.BranchId)!==AREA1_BRANCH)throw Error('Unversioned or out-of-branch record.');
  if(profiles.length!==351||profiles.some(d=>!d.name.startsWith(base+AREA1_STUDENTS+'/')))throw Error('Expected the 351 retained Area 1 profiles.');
  const refs=new Set(profiles.map(d=>value(d.fields.AdmissionNo)));
  if(refs.size!==351)throw Error('Duplicate retained identity.');
  if(scores.some(d=>!refs.has(value(d.fields.StudentRef))))throw Error('An older entry has scores; review before removing it.');
  const removeMemberships=memberships.filter(d=>!refs.has(value(d.fields.StudentRef)));
  const removeIds=new Set(removeMemberships.map(d=>d.name.split('/').at(-1)));
  if(profiles.some(d=>removeIds.has(value(d.fields.AcademicMembershipId))))throw Error('A retained pupil points to an older membership.');
  const retained=memberships.filter(d=>refs.has(value(d.fields.StudentRef)));
  const aliases=new Map();
  for(const old of removeMemberships){
    const ref=value(old.fields.StudentRef);if(!/^DCA\/\d{2}\/\d+$/.test(ref))continue;
    const matches=retained.filter(r=>normalized(value(r.fields.StudentRef))===normalized(ref)&&['ClassId','SessionId','TermId','SchoolSection'].every(k=>value(r.fields[k])===value(old.fields[k])));
    if(matches.length===1){
      if(value(old.fields.ArmId)&&value(old.fields.ArmId)!==value(matches[0].fields.ArmId))throw Error('Alternate reference has another placement.');
      aliases.set(ref,value(matches[0].fields.StudentRef));
    }else if([...refs].some(r=>normalized(r)===normalized(ref)))throw Error('Ambiguous alternate admission number.');
  }
  const remove=[...removeMemberships],patch=[];
  for(const old of movements){const ref=value(old.fields.StudentRef);if(refs.has(ref))continue;if(aliases.has(ref))patch.push({before:old,after:{name:old.name,fields:{...old.fields,StudentRef:{stringValue:aliases.get(ref)}}}});else remove.push(old);}
  for(const doc of remove)if(!/^academicStudent(Memberships|Movements)\//.test(doc.name.slice(base.length)))throw Error('Unexpected deletion collection.');
  return {remove,patch,aliases:[...aliases],retainedMemberships:retained.length};
}
