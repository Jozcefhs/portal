import {getFirestoreAccessToken,firestoreBaseUrl,buildStructuredQuery,firestoreDocumentToObject,batchCommitDocuments} from './firestore.js';
const fail=()=>Object.assign(new Error('These scores, placements or results changed during review. Nothing was resolved. Reload the competing marks and try again.'),{status:409,code:'ACADEMIC_DUPLICATE_CHANGED'});
const snapshot=rows=>JSON.stringify(rows.map(row=>{
  if(!row.__name||!row.__updateTime)throw fail();return [row.__name,row.__updateTime];
}).sort((a,b)=>a[0].localeCompare(b[0])));

// Lock both existing versions and query membership: a new competing score or
// a newly published result cannot slip between review and the atomic correction.
export async function commitAcademicDuplicateScore(env,writes,evidence,dependencies={}) {
  const token=await (dependencies.token||getFirestoreAccessToken)(env),base=(dependencies.base||firestoreBaseUrl)(env);
  const request=dependencies.fetch||fetch,commit=dependencies.commit||batchCommitDocuments;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  let transaction='';
  try {
    for(const query of evidence.queries){
      const {structuredQuery}=buildStructuredQuery(query.collection,{filters:query.filters,limit:query.limit,select:['SchoolSection']});
      const response=await request(`${base}:runQuery`,{method:'POST',headers,body:JSON.stringify({structuredQuery,
        ...(transaction?{transaction}:{newTransaction:{readWrite:{}}})})});
      const data=await response.json();
      if(!transaction&&Array.isArray(data))transaction=data.find(row=>row.transaction)?.transaction;
      if(!response.ok||!transaction||!Array.isArray(data)||data.some(row=>row.error))throw fail();
      const rows=data.flatMap(row=>row.document?[firestoreDocumentToObject(row.document)]:[]);
      if(rows.length>=query.limit||snapshot(rows)!==snapshot(query.rows))throw fail();
    }
    if(evidence.documents.length){
      const response=await request(`${base}:batchGet`,{method:'POST',headers,body:JSON.stringify({transaction,documents:evidence.documents.map(row=>row.__name),mask:{fieldPaths:['SchoolSection']}})});
      const data=await response.json();
      if(!response.ok||!Array.isArray(data)||data.some(row=>row.error||row.missing))throw fail();
      if(snapshot(data.flatMap(row=>row.found?[firestoreDocumentToObject(row.found)]:[]))!==snapshot(evidence.documents))throw fail();
    }
    return await commit(env,writes,{transaction});
  } catch(error) {
    if(transaction)await request(`${base}:rollback`,{method:'POST',headers,body:JSON.stringify({transaction})}).catch(()=>{});
    throw error;
  }
}
