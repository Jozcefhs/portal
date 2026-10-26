import {getFirestoreAccessToken,firestoreBaseUrl,buildStructuredQuery,firestoreDocumentToObject,batchCommitDocuments} from './firestore.js';
const clean=value=>String(value??'').trim();
const fail=()=>Object.assign(new Error('The student placements, scores or sheet reviews changed during this batch. No result in this batch was changed. Refresh and retry.'),{status:409,code:'ACADEMIC_RESULT_BATCH_CHANGED'});

// Score writers advance the membership revision in the same atomic commit as
// the marks. Lock those revisions and sheet reviews, without rewriting either.
export async function commitAcademicResultBatch(env,writes,scope,evidence,dependencies={}) {
  if (!writes.length) return {writeResults:[]};
  const token=await (dependencies.token||getFirestoreAccessToken)(env),base=(dependencies.base||firestoreBaseUrl)(env);
  const request=dependencies.fetch||fetch,commit=dependencies.commit||batchCommitDocuments;
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const filters=['BranchId','SessionId','TermId'].map(field=>({field,op:'==',value:scope[field]}));
  const queries=[];
  for(let offset=0;offset<evidence.refs.length;offset+=10){
    const refs=evidence.refs.slice(offset,offset+10);
    queries.push({collection:'academicStudentMemberships',filters:[...filters,{field:'StudentRef',op:'in',value:refs}],
      rows:evidence.memberships.filter(row=>refs.includes(row.StudentRef)),limit:1001});
  }
  queries.push({collection:'academicScoreSheets',filters:[...filters,...['ClassId','ArmId'].map(field=>({field,op:'==',value:scope[field]}))],
    rows:evidence.sheets,limit:1001});
  const snapshot=rows=>JSON.stringify(rows.filter(row=>clean(row.SchoolSection||'secondary')===scope.SchoolSection).map(row=>{
    const id=clean(row.__id||row.RecordId||row.MembershipId||row.SheetId);
    if(!id||!row.__updateTime)throw fail();return [id,row.__updateTime];
  }).sort((a,b)=>a[0].localeCompare(b[0])));
  let transaction='';
  try{
    for(const query of queries){
      const {structuredQuery}=buildStructuredQuery(query.collection,{filters:query.filters,limit:query.limit,
        select:['StudentRef','SchoolSection']});
      const response=await request(`${base}:runQuery`,{method:'POST',headers,
        body:JSON.stringify({structuredQuery,...(transaction?{transaction}:{newTransaction:{readWrite:{}}})})});
      const data=await response.json();
      if(!transaction&&Array.isArray(data))transaction=clean(data.find(row=>row.transaction)?.transaction);
      if(!response.ok||!transaction||!Array.isArray(data)||data.some(row=>row.error))throw fail();
      const rows=data.filter(row=>row.document).map(row=>firestoreDocumentToObject(row.document));
      if(rows.length>=query.limit||snapshot(rows)!==snapshot(query.rows))throw fail();
    }
    return await commit(env,writes,{transaction});
  }catch(error){
    if(transaction)await request(`${base}:rollback`,{method:'POST',headers,body:JSON.stringify({transaction})}).catch(()=>{});
    throw error;
  }
}
