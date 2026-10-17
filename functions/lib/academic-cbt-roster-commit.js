import {getFirestoreAccessToken, firestoreBaseUrl, buildStructuredQuery, firestoreDocumentToObject, batchCommitDocuments} from './firestore.js';

const clean = value=>String(value??'').trim();
const fail = () => Object.assign(new Error('Class memberships changed during the review. Review the student list again; no test was changed.'), {status:409,code:'ACADEMIC_CBT_ROSTER_CHANGED'});

// Lock the class query as well as the test revision: newly added memberships,
// withdrawals and concurrent transfers must not slip into a reviewed snapshot.
export async function commitAcademicCbtRoster(env, writes, record, memberships, dependencies = {}) {
  const token = await (dependencies.token || getFirestoreAccessToken)(env);
  const base = (dependencies.base || firestoreBaseUrl)(env);
  const request = dependencies.fetch || fetch;
  const commit = dependencies.commit || batchCommitDocuments;
  const scopeMatches = row => row.ClassId === record.ClassId && row.SessionId === record.SessionId && row.TermId === record.TermId
    && clean(row.BranchId || 'main').toLowerCase() === clean(record.BranchId || 'main').toLowerCase();
  const snapshot = rows => {
    const relevant = rows.filter(scopeMatches);
    if (relevant.some(row=>!clean(row.__id || row.MembershipId) || !clean(row.__updateTime))) throw fail();
    return JSON.stringify(relevant.map(row=>[clean(row.__id || row.MembershipId),row.__updateTime]).sort((a,b)=>a[0].localeCompare(b[0])));
  };
  const expected = snapshot(memberships);
  // Class IDs are branch/section-specific. A single indexed equality avoids
  // introducing a composite-index dependency into the repair workflow.
  const {structuredQuery} = buildStructuredQuery('academicStudentMemberships', {
    filters:[{field:'ClassId',op:'==',value:record.ClassId}], limit:5001,
    select:['MembershipId','ClassId','SessionId','TermId','BranchId']
  });
  const headers = {Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  let transaction='';
  try {
    const response = await request(`${base}:runQuery`, {method:'POST',headers,
      body:JSON.stringify({structuredQuery,newTransaction:{readWrite:{}}})});
    const data = await response.json();
    if(Array.isArray(data)) transaction=clean(data.find(row=>row.transaction)?.transaction);
    if(!response.ok || !transaction || !Array.isArray(data) || data.some(row=>row.error)) throw fail();
    const documents=data.filter(row=>row.document).map(row=>firestoreDocumentToObject(row.document));
    if(documents.length>=5001 || snapshot(documents)!==expected) throw fail();
    if(Date.parse(record.StartsAt)<=Date.now()) throw fail();
    return await commit(env,writes,{transaction});
  } catch(error) {
    if(transaction) await request(`${base}:rollback`,{method:'POST',headers,body:JSON.stringify({transaction})}).catch(()=>{});
    throw error;
  }
}
