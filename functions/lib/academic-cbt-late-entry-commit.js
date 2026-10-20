import {getFirestoreAccessToken, firestoreBaseUrl, buildStructuredQuery, firestoreDocumentToObject, batchCommitDocuments} from './firestore.js';

const clean = value => String(value ?? '').trim();
const fail = () => Object.assign(new Error('Students, scores or CBT sittings changed during review. Review again; no sitting or student list was changed.'), {status:409, code:'ACADEMIC_CBT_LATE_ENTRY_CHANGED'});

// Query locks cover new memberships, sibling sittings and concurrently posted
// scores. No existing record is rewritten to acquire those locks.
export async function commitAcademicCbtLateEntry(env, writes, source, state, startsAt, dependencies = {}) {
  const token = await (dependencies.token || getFirestoreAccessToken)(env);
  const base = (dependencies.base || firestoreBaseUrl)(env);
  const request = dependencies.fetch || fetch;
  const commit = dependencies.commit || batchCommitDocuments;
  const headers = {Authorization:`Bearer ${token}`, 'Content-Type':'application/json'};
  let transaction = '';
  try {
    for (const [key, collection, field] of [
      ['studentMemberships','academicStudentMemberships','SessionId'],
      ['cbtTests','academicCbtTests','SubjectId'],
      ['studentScores','academicStudentScores','SubjectId']
    ]) {
      const scopeMatches = row => row[field] === source[field] && row.SessionId === source.SessionId && row.TermId === source.TermId
        && clean(row.BranchId || 'main').toLowerCase() === clean(source.BranchId || 'main').toLowerCase()
        && (row.SchoolSection || dependencies.legacySection || 'secondary') === source.SchoolSection;
      const snapshot = rows => JSON.stringify(rows.filter(scopeMatches).map(row => {
        const id = clean(row.__id || row.MembershipId || row.CbtTestId || row.ScoreId);
        if (!id || !row.__updateTime) throw fail();
        return [id,row.__updateTime];
      }).sort((a,b)=>a[0].localeCompare(b[0])));
      const {structuredQuery} = buildStructuredQuery(collection, {filters:[{field,op:'==',value:source[field]}],limit:10001,
        select:[field,'SessionId','TermId','BranchId','SchoolSection']});
      const response = await request(`${base}:runQuery`, {method:'POST',headers,
        body:JSON.stringify({structuredQuery,...(transaction ? {transaction} : {newTransaction:{readWrite:{}}})})});
      const data = await response.json();
      if (!transaction && Array.isArray(data)) transaction = clean(data.find(row=>row.transaction)?.transaction);
      if (!response.ok || !transaction || !Array.isArray(data) || data.some(row=>row.error)) throw fail();
      const documents = data.filter(row=>row.document).map(row=>firestoreDocumentToObject(row.document));
      if (documents.length >= 10001 || snapshot(documents) !== snapshot(state[key] || [])) throw fail();
    }
    // Add-only roster amendments do not alter the schedule or require a new sitting.
    if (!dependencies.addOnlyRoster && Date.parse(startsAt) <= Date.now()) throw fail();
    return await commit(env,writes,{transaction});
  } catch (error) {
    if (transaction) await request(`${base}:rollback`,{method:'POST',headers,body:JSON.stringify({transaction})}).catch(()=>{});
    throw error;
  }
}
