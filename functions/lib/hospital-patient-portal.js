import {getDocument,queryCollection,batchCommitLiteralDocuments} from './firestore.js';
import {getSchoolStructure} from './school-scope.js';
import {configuredStaffBranches} from './staff-branch-context.js';
import {staffAccessFor} from './staff-auth.js';
import {requiredDeploymentIdentity} from './deployment-identity.js';
import {hospitalCollectionPath} from './hospital-storage.js';
import {clean,fail,id,digest,patientName} from './hospital-model.js';
import {dateOnly} from './hospital-orders-model.js';
import {netPaid,fundsAvailable} from './hospital-billing-model.js';
import {secureSecretEqual} from './request-security.js';
import {portalCode,portalToken,portalPassword,portalHmac,PORTAL_SESSION_MS} from './hospital-portal-model.js';

const strip=row=>Object.fromEntries(Object.entries(row).filter(([k])=>!k.startsWith('__')));
const condition=row=>row?{updateTime:row.__updateTime||fail('Refresh and try again.',409)}:{exists:false};
const eq=(field,value)=>({field,op:'==',value});
const denied=()=>fail('Access is unavailable or has expired. Sign in again, or contact Reception.',401);
const number=(row,key)=>Number.isSafeInteger(row[key])?row[key]:0;

// Every financial request derives its patient and branch from an active grant.
// No public patient search, financial mutation, NFC login or booking-token login.
export async function hospitalPatientPortalAction(env,sessionToken,body,overrides={}){
  if(requiredDeploymentIdentity(env).edition!=='hospital')fail('Patient portal is available only in the Hospital edition.',403);
  if(!['activate','login','logout','context','invoices','receipts','deposits','document','changePassword'].includes(body.action))fail('Choose a valid patient portal action.');
  if(['PatientId','BranchId','Payer','Kind','GrantId'].some(k=>k in body))fail('Use the patient access issued by Reception.',403);
  const db={getDocument,queryCollection,batchCommitLiteralDocuments,getSchoolStructure,...overrides},collection=name=>hospitalCollectionPath(env,name);
  const clock=()=>(overrides.now?overrides.now():new Date()).toISOString();
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const commit=writes=>db.batchCommitLiteralDocuments(env,writes);
  let grant,session,SessionId;
  const event=(key,Action,extra={})=>write('PortalEvents',key,{EventId:key,GrantId:grant.GrantId,PatientId:grant.PatientId,BranchId:grant.BranchId,
    Actor:`portal:${grant.GrantId}`,Kind:grant.Kind,Action,CreatedAt:clock(),...extra},null);
  if(body.action==='logout'){
    if(!/^[a-f0-9]{64}$/.test(sessionToken||''))return {ok:true,clearCookie:true};
    SessionId=await digest(sessionToken);session=await read('PortalSessions',SessionId);
    if(session&&!session.RevokedAt){try{await commit([write('PortalSessions',SessionId,{...strip(session),RevokedAt:clock()},session)]);}catch(e){if(e.status!==409)throw e;}}
    return {ok:true,clearCookie:true};
  }
  const signingIn=['login','activate'].includes(body.action);
  if(signingIn){
    const GrantId=portalCode(body.AccessCode),requestId=id(body.RequestId);
    // Per-recipient limit supplements the route's per-IP limit, including attempts
    // from different networks. No counters are written while browsing records.
    const limitId=await digest(`portal-login:${GrantId}`);let allowed=false;
    for(let retry=0;retry<3;retry++){
      const old=await read('PortalLoginLimits',limitId),fresh=!old||old.ResetAt<=clock(),Attempts=fresh?1:old.Attempts+1;
      if(Attempts>8)fail('Too many sign-in attempts. Wait 15 minutes before trying again.',429);
      try{await commit([write('PortalLoginLimits',limitId,{Attempts,ResetAt:fresh?new Date(Date.parse(clock())+15*60000).toISOString():old.ResetAt},old)]);allowed=true;break;}
      catch(e){if(e.status!==409)throw e;}
    }
    if(!allowed)fail('Sign-in is busy. Please try again shortly.',429);
    grant=await read('PortalGrants',GrantId);
    if(!grant||grant.AccessUntil<=clock())denied();
    if(body.action==='activate'){
      if(grant.Status!=='Invited'||grant.InvitationExpiresAt<=clock()||!await secureSecretEqual(await digest(portalToken(body.InvitationToken)),grant.InvitationHash))denied();
    }else{
      if(grant.Status!=='Active'||grant.PasswordVersion!==1||typeof body.Password!=='string'||body.Password.length<12||body.Password.length>128)denied();
      const candidate=await portalPassword(env,body.Password,grant.Salt);
      if(!await secureSecretEqual(candidate.PasswordHash,grant.PasswordHash))denied();
    }
    // A retry of a successful sign-in returns the same cookie without another
    // session/audit write. Session secrets are derived, never stored in plaintext.
    sessionToken=await portalHmac(env,`session:${GrantId}:${grant.AuthVersion}:${requestId}`);
    SessionId=await digest(sessionToken);
  }else{
    if(!/^[a-f0-9]{64}$/.test(sessionToken||''))denied();
    SessionId=await digest(sessionToken);session=await read('PortalSessions',SessionId);
    if(!session||session.RevokedAt||session.ExpiresAt<=clock())denied();
    grant=await read('PortalGrants',session.GrantId);
    if(!grant||grant.Status!=='Active'||grant.AccessUntil<=clock()||grant.AuthVersion!==session.AuthVersion||grant.PatientId!==session.PatientId||grant.BranchId!==session.BranchId)denied();
  }
  const person=await read('Patients',grant.PatientId);
  if(!person||person.Status!=='Active'||!person.AccessBranchIds?.includes(grant.BranchId))denied();
  const [entitlement,structure]=await Promise.all([
    (overrides.staffAccessFor||staffAccessFor)(env,{username:'system:hospital-patient-portal',role:'Hospital Administrator',branchAccess:'all'}),db.getSchoolStructure(env)]);
  if(entitlement.edition!=='hospital'||entitlement.subscriptionActive===false||!entitlement.allowedSections?.includes('hospitalBilling'))fail('The patient portal is temporarily unavailable. Contact Reception.',403);
  const selectedBranch=configuredStaffBranches(structure).find(b=>clean(b.id).toLowerCase()===grant.BranchId);
  if(!selectedBranch)denied();
  if(signingIn){
    const existing=await read('PortalSessions',SessionId);
    if(existing){if(existing.RevokedAt||existing.ExpiresAt<=clock()||existing.AuthVersion!==grant.AuthVersion)denied();return {ok:true,cookieToken:sessionToken,ExpiresAt:existing.ExpiresAt};}
    const next=body.action==='activate'?{...strip(grant),...await portalPassword(env,body.Password),Status:'Active',InvitationHash:'',ActivatedAt:clock(),UpdatedAt:clock()}:strip(grant);
    const ExpiresAt=new Date(Math.min(Date.parse(grant.AccessUntil),Date.parse(clock())+PORTAL_SESSION_MS)).toISOString();
    const row={SessionId,GrantId:grant.GrantId,AuthVersion:grant.AuthVersion,PatientId:grant.PatientId,BranchId:grant.BranchId,CreatedAt:clock(),ExpiresAt};
    try{await commit([write('PortalSessions',SessionId,row,null),write('PortalGrants',grant.GrantId,next,grant),
      write('Patients',person.PatientId,strip(person),person),event(SessionId,body.action==='activate'?'Activate patient portal':'Sign in to patient financial portal')]);}
    catch(e){if(e.status!==409)throw e;const saved=await read('PortalSessions',SessionId);if(!saved||saved.RevokedAt||saved.AuthVersion!==grant.AuthVersion)fail('Access changed. Sign in again.',409);return {ok:true,cookieToken:sessionToken,ExpiresAt:saved.ExpiresAt};}
    return {ok:true,cookieToken:sessionToken,ExpiresAt};
  }
  if(body.action==='changePassword'){
    if(typeof body.CurrentPassword!=='string'||body.CurrentPassword.length<12||body.CurrentPassword.length>128)denied();
    const old=await portalPassword(env,body.CurrentPassword,grant.Salt);
    if(!await secureSecretEqual(old.PasswordHash,grant.PasswordHash))fail('The current password is incorrect.',400);
    if(body.Password===body.CurrentPassword)fail('Choose a different new password.');
    const key=await digest(`password:${SessionId}:${id(body.RequestId)}`),next={...strip(grant),...await portalPassword(env,body.Password),AuthVersion:key,UpdatedAt:clock()};
    await commit([write('PortalGrants',grant.GrantId,next,grant),event(key,'Change patient portal password')]);return {ok:true,clearCookie:true};
  }
  const context={patient:{DisplayName:patientName(person),HospitalNumber:person.HospitalNumber},branch:{Name:selectedBranch.name||selectedBranch.id},
    access:{RecipientName:grant.RecipientName,Kind:grant.Kind,AccessUntil:grant.AccessUntil},ExpiresAt:session.ExpiresAt,Today:clock().slice(0,10)};
  if(body.action==='context')return {ok:true,...context};
  const types={invoices:'Invoices',receipts:'Payments',deposits:'Funds'};
  function matching(row,type){return row&&row.PatientId===person.PatientId&&row.BranchId===grant.BranchId&&(type==='invoices'||type==='receipts'&&row.Payer==='Patient'||type==='deposits'&&row.Kind==='Patient');}
  function view(row,type,detail=false){
    const common={DocumentId:row.InvoiceId,Number:row.InvoiceNumber,CreatedAt:row.CreatedAt,Currency:row.Currency||'NGN'};
    if(type==='invoices')return {...common,Status:row.Status,PatientCents:number(row,'PatientCents'),CreditCents:number(row,'PatientCreditCents'),PaidCents:netPaid(row,'Patient'),
      BalanceCents:number(row,'PatientCents')-number(row,'PatientCreditCents')-netPaid(row,'Patient'),
      HmoCents:number(row,'HmoCents')-number(row,'HmoCreditCents'),CorporateCents:number(row,'CorporateCents')-number(row,'CorporateCreditCents'),
      ...(detail?{Lines:(row.Lines||[]).map(l=>({Description:l.Description,PatientCents:number(l,'PatientCents'),HmoCents:number(l,'HmoCents'),CorporateCents:number(l,'CorporateCents')}))}:{})};
    return {DocumentId:type==='receipts'?row.PaymentId:row.FundId,Number:row.ReceiptNumber,CreatedAt:row.CreatedAt,Currency:row.Currency||'NGN',
      AmountCents:row.AmountCents,RefundedCents:number(row,'RefundedCents'),Method:row.Method,
      ...(type==='deposits'?{AppliedCents:number(row,'AppliedCents'),AvailableCents:fundsAvailable(row)}:
        {IsAllocation:!!row.SourceFundId,SourceReceiptNumber:row.SourceReceiptNumber||'',ReturnedCents:number(row,'ReturnedToFundCents')}),
      ...(detail?{Reference:row.Reference||''}:{})};
  }
  if(body.action==='document'){
    const type=body.DocumentType;if(!types[type])fail('Choose an invoice or receipt.');
    const row=await read(types[type],body.DocumentId);if(!matching(row,type))fail('This document is not available under your patient access.',404);
    return {ok:true,...context,type,document:view(row,type,true),LoadedAt:clock()};
  }
  const type=body.action,from=dateOnly(body.From),to=dateOnly(body.To);
  if(from>to||Date.parse(to)-Date.parse(from)>92*86400000)fail('Choose a date range of up to 93 days.');
  const start=new Date(`${from}T00:00:00+01:00`).toISOString(),end=new Date(Date.parse(`${to}T00:00:00+01:00`)+86400000).toISOString();
  const scope=await digest(JSON.stringify([grant.GrantId,type,from,to])),options={filters:[eq('BranchId',grant.BranchId),eq('PatientId',person.PatientId),
    ...(type==='receipts'?[eq('Payer','Patient')]:type==='deposits'?[eq('Kind','Patient')]:[]),{field:'CreatedAt',op:'>=',value:start},{field:'CreatedAt',op:'<',value:end}],
    orderBy:[{field:'CreatedAt'},{field:'__name__'}],limit:31};
  if(body.Cursor){
    if(body.Cursor.scope!==scope||typeof body.Cursor.value!=='string'||body.Cursor.value<start||body.Cursor.value>=end)fail('Load the first page for this period.');
    options.startAfterName=`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection(types[type])}/${id(body.Cursor.id)}`;options.startAfterFieldValue=body.Cursor.value;
  }
  const rows=await db.queryCollection(env,collection(types[type]),options),shown=rows.slice(0,30);
  if(shown.some(row=>!matching(row,type)))fail('The requested records could not be verified.',409);
  return {ok:true,rows:shown.map(r=>view(r,type)),LoadedAt:clock(),next:rows.length>30?{scope,id:shown.at(-1).__id,value:shown.at(-1).CreatedAt}:null};
}
