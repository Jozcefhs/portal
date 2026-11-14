import {fail,id,digest} from './hospital-model.js';
import {dateOnly} from './hospital-orders-model.js';
import {clinicalAccessVersion,clinicalTypes,clinicalSource,clinicalDocument} from './hospital-clinical-source.js';

export async function readPortalClinical({env,db,collection,read,write,commit,clock,grant,person,session,context,body}){
  const type=body.action==='document'?body.DocumentType:body.action;
  if(!clinicalTypes[type])fail('Choose a clinical document.');
  const matches=r=>r&&r.DocumentType===type&&r.PatientId===person.PatientId&&r.BranchId===grant.BranchId&&r.GrantId===grant.GrantId&&r.GrantAccessVersion===clinicalAccessVersion(grant)&&r.Status==='Published';
  if(body.action==='document'){
    const row=await read('PortalClinicalDocuments',id(body.DocumentId));
    if(!matches(row))fail('This document is not shared under your current access. Contact the clinical team.',404);
    const c=await clinicalSource({read,type,parentId:row.ParentId,patientId:person.PatientId,branchId:grant.BranchId});
    if(!c.ready||c.sourceId!==row.SourceId)fail('This document is being reviewed or has been superseded. Ask the clinical team for the updated release.',409);
    // One immutable access event per session and publication version, including
    // retries. No writes to the medical record, patient, financials or grant.
    const key=await digest(JSON.stringify(['clinical-view',session.SessionId,row.DocumentId,row.__updateTime]));
    if(!await read('PortalClinicalEvents',key)){
      try{await commit([write('PortalClinicalEvents',key,{EventId:key,Action:'View clinical portal document',DocumentId:row.DocumentId,SourceId:row.SourceId,
        PatientId:person.PatientId,BranchId:grant.BranchId,GrantId:grant.GrantId,RecipientName:grant.RecipientName,RecipientKind:grant.Kind,CreatedAt:clock()},null)]);}
      catch(e){if(e.status!==409)throw e;}
    }
    return {ok:true,...context,type,document:{...clinicalDocument(c),PublishedAt:row.PublishedAt},LoadedAt:clock()};
  }
  const from=dateOnly(body.From),to=dateOnly(body.To);if(from>to||Date.parse(to)-Date.parse(from)>92*86400000)fail('Choose a date range of up to 93 days.');
  const start=new Date(`${from}T00:00:00+01:00`).toISOString(),end=new Date(Date.parse(`${to}T00:00:00+01:00`)+86400000).toISOString();
  const scope=await digest(JSON.stringify([grant.GrantId,clinicalAccessVersion(grant),type,from,to]));
  const options={filters:Object.entries({BranchId:grant.BranchId,PatientId:person.PatientId,GrantId:grant.GrantId,GrantAccessVersion:clinicalAccessVersion(grant),DocumentType:type,Status:'Published'}).map(([field,value])=>({field,op:'==',value})),orderBy:[{field:'PublishedAt'},{field:'__name__'}],limit:31};
  options.filters.push({field:'PublishedAt',op:'>=',value:start},{field:'PublishedAt',op:'<',value:end});
  if(body.Cursor){if(body.Cursor.scope!==scope||typeof body.Cursor.value!=='string'||body.Cursor.value<start||body.Cursor.value>=end)fail('Load the first page for this period.');
    options.startAfterName=`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection('PortalClinicalDocuments')}/${id(body.Cursor.id)}`;options.startAfterFieldValue=body.Cursor.value;}
  const rows=await db.queryCollection(env,collection('PortalClinicalDocuments'),options),shown=rows.slice(0,30);
  if(shown.some(r=>!matches(r)))fail('The requested documents could not be verified.',409);
  return {ok:true,rows:shown.map(r=>({DocumentId:r.DocumentId,Title:r.Title,Number:r.Number,CreatedAt:r.PublishedAt})),LoadedAt:clock(),next:rows.length>30?{scope,id:shown.at(-1).__id,value:shown.at(-1).PublishedAt}:null};
}
