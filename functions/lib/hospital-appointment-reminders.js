import {clean,fail,id,digest,patientName} from './hospital-model.js';
import {field,dateFilters} from './hospital-orders-model.js';
import {resolveBranchEmailEnvironment} from './branch-email-provider.js';
import {sendConfiguredEmail} from './email-service.js';

const states=['Queued','Sending','Accepted','Failed','Uncertain','Cancelled','Skipped'];
const email=value=>clean(value).toLowerCase();
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<=254;
const slot=a=>[a.AppointmentId,a.BranchId,a.PatientId,a.StartAt,a.EndAt,a.ScheduleId,a.Clinician];
const hash=value=>digest(JSON.stringify(value));
export function createHospitalAppointmentReminders(ctx){
  const {env,user,db,collection,requireCapability,branch,patient,clock,actor,strip,condition,eq,auditWrite,operation,page}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,row,old)=>({collectionPath:collection(name),documentId:key,data:row,currentDocument:condition(old)});
  const view=row=>row?{...strip(row),Revision:row.__updateTime}:null;
  const requireWrite=()=>{requireCapability('appointments.write');if(user.subscriptionReadOnly)fail('This subscription permits viewing only.',403);};
  const revision=(row,value)=>{if(!value||value!==row.__updateTime)fail('This reminder changed. Refresh it before continuing.',409);};
  const event=(key,row,Type,Reason='')=>write('AppointmentReminderEvents',key,{EventId:key,ReminderId:row.ReminderId,BranchId:row.BranchId,AppointmentId:row.AppointmentId,PatientId:row.PatientId,Type,Reason,CreatedAt:clock(),Actor:actor,Provider:row.Provider||'',ProviderMessageId:row.ProviderMessageId||'',Attempt:row.Attempt||0,Snapshot:strip(row)},null);
  async function current(body){const BranchId=await branch(body),row=await read('AppointmentReminders',body.ReminderId);if(!row||row.BranchId!==BranchId)fail('Choose a reminder in this branch.',404);return row;}
  async function booking(body){const BranchId=await branch(body),a=await read('Appointments',body.AppointmentId);if(!a||a.BranchId!==BranchId||a.PatientId!==body.PatientId)fail('Choose an appointment in this branch.',404);return {a,p:await patient(a.PatientId,BranchId)};}
  async function connection(BranchId){
    const resolved=await resolveBranchEmailEnvironment(env,BranchId),e=resolved.env,provider=clean(e.EMAIL_PROVIDER||'brevo').toLowerCase();
    const legacy=provider==='brevo'&&!e.BREVO_API_KEY?await db.getDocument(env,'settings','brevo'):null;
    return {provider,configured:provider==='brevo'?!!(e.BREVO_API_KEY||legacy?.BrevoApiKey):provider==='gmail'&&!!(e.GMAIL_OAUTH_CLIENT_ID&&e.GMAIL_OAUTH_CLIENT_SECRET&&e.GMAIL_REFRESH_TOKEN&&e.GMAIL_CONNECTED_EMAIL)};
  }
  function reason(a,p,row){
    if(!a||a.Status!=='Scheduled')return 'The appointment is no longer scheduled.';
    if(Date.parse(a.StartAt)<=Date.parse(clock()))return 'The appointment start time has passed.';
    if(JSON.stringify(slot(a))!==JSON.stringify(row.Slot))return 'The appointment was rescheduled. Review the new booking before preparing another reminder.';
    if(!p||p.Status!=='Active'||!p.AccessBranchIds?.includes(row.BranchId))return 'The patient is no longer active in this branch.';
    if(email(p.Email)!==row.ToEmail)return 'The saved patient email changed. Review the contact before continuing.';
    return '';
  }
  async function preview(body){
    const {a,p}=await booking(body),ReminderId=await hash(['appointment-email',...slot(a)]),existing=await read('AppointmentReminders',ReminderId);
    const branches=await db.getSchoolStructure(env),branchRow=(branches.Branches||[]).find(b=>(b.Id||b.id)===a.BranchId);
    const BranchName=clean(branchRow?.Name||branchRow?.name)||a.BranchId,ToEmail=email(p.Email);
    const Subject='Appointment reminder';
    const Text=`This is a reminder of your appointment at ${BranchName}.\n\nDate and time (WAT): ${new Date(a.StartAt).toLocaleString('en-GB',{timeZone:'Africa/Lagos'})}\nClinic: ${a.Department}\nDoctor: ${a.ClinicianName}\nBooking reference: ${a.Reference}\n\nPlease contact the hospital if you need to change your appointment. Do not reply with medical information.`;
    const draft={ReminderId,AppointmentId:a.AppointmentId,PatientId:a.PatientId,BranchId:a.BranchId,BranchName,Slot:slot(a),StartAt:a.StartAt,PatientName:patientName(p),HospitalNumber:p.HospitalNumber,Reference:a.Reference,ToEmail,Subject,Text};
    const blocked=reason(a,p,draft)||(!validEmail(ToEmail)?'Add a valid email to the patient registration first.':'');
    return {ok:true,preview:draft,reminder:view(existing),blocked,connection:await connection(a.BranchId),Token:await hash([draft,a.__updateTime,p.__updateTime])};
  }
  async function finish(row,Status,Reason='',provider={}){
    const key=await hash([row.ReminderId,row.Attempt,Status,row.__updateTime]),next={...strip(row),Status,Reason,UpdatedAt:clock(),UpdatedBy:actor,...provider};
    await db.batchCommitLiteralDocuments(env,[write('AppointmentReminders',row.ReminderId,next,row),event(key,next,Status,Reason),auditWrite(key,'Appointment reminder '+Status.toLowerCase(),row.BranchId,{}, {ReminderId:row.ReminderId,AppointmentId:row.AppointmentId,Reason})]);
    return {ok:true,ReminderId:row.ReminderId,Status};
  }
  async function dispatch(body){
    requireWrite();let row=await current(body);
    // Sending is never reclaimed, even after a timeout. An accepted email may have lost its response.
    if(row.Status!=='Queued'||Date.parse(row.DueAt)>Date.parse(clock()))return {ok:true,Status:row.Status,Unchanged:true};
    const a=await read('Appointments',row.AppointmentId),p=await read('Patients',row.PatientId),why=reason(a,p,row);
    if(why)return finish(row,'Skipped',why);
    const key=await hash([row.ReminderId,(row.Attempt||0)+1,'claim']),next={...strip(row),Status:'Sending',Attempt:(row.Attempt||0)+1,ClaimedAt:clock(),UpdatedAt:clock(),UpdatedBy:actor,Reason:''};
    try{
      // Conditional dependency writes establish one atomic dispatch point against cancellation,
      // rescheduling and contact edits. Every source field is retained unchanged.
      await db.batchCommitLiteralDocuments(env,[write('AppointmentReminders',row.ReminderId,next,row),write('Appointments',a.AppointmentId,strip(a),a),write('Patients',p.PatientId,strip(p),p),event(key,next,'Sending')]);
    }catch(error){if(error.status===409)return {ok:true,Status:'Changed',Unchanged:true};throw error;}
    row=await read('AppointmentReminders',row.ReminderId);
    let result;
    try{result=await (db.sendConfiguredEmail||sendConfiguredEmail)(env,{branchId:row.BranchId,toEmail:row.ToEmail,subject:row.Subject,textContent:row.Text});}
    catch(error){
      const safe=error.retrySafe===true&&!error.deliveryUncertain;
      return finish(row,safe?'Failed':'Uncertain',safe?'The provider did not accept this email. Check email settings before an explicit retry.':'Delivery could not be confirmed. Check the provider log; do not resend automatically.',{FailureCode:clean(error.code).slice(0,100)});
    }
    if(result?.ok!==true)return finish(row,'Uncertain','The provider returned no confirmed acceptance. Check its delivery log before taking action.');
    // Keep final persistence outside the send catch: failure here must never become retryable.
    return finish(row,'Accepted','Accepted by the email provider; inbox delivery is not yet confirmed.',{Provider:clean(result.provider),ProviderMessageId:clean(result.providerMessageId).slice(0,300),AcceptedAt:clock()});
  }
  return {
    async appointmentReminderPreview(body){requireCapability('appointments.read');return preview(body);},
    async queueAppointmentReminder(body){
      requireWrite();await branch(body);if(body.ConfirmConsent!==true)fail('Confirm permission to use this saved email for the appointment reminder.');
      return operation(body,'queueAppointmentReminder',async key=>{
        const r=await preview(body);
        if(r.reminder&&!body.ReplaceUnsent)return {writes:[],result:{ReminderId:r.reminder.ReminderId,Status:r.reminder.Status,Unchanged:true}};
        if(r.reminder){
          const safe=['Failed','Skipped'].includes(r.reminder.Status)||(r.reminder.Status==='Cancelled'&&['Queued','Failed'].includes(r.reminder.CancelledFrom));
          if(!safe)fail('An accepted or uncertain reminder cannot be scheduled again for this booking.',409);
          if(body.Revision!==r.reminder.Revision)fail('This reminder changed. Preview it again.',409);
        }
        if(r.blocked)fail(r.blocked,409);if(!r.connection.configured)fail('Connect this branch’s email provider in settings before scheduling reminders.',409);
        if(body.PreviewToken!==r.Token)fail('The booking or patient contact changed. Preview the reminder again.',409);
        const at=Date.parse(body.DueAt);if(!Number.isFinite(at)||at<Date.parse(clock())-60000||at>=Date.parse(r.preview.StartAt)||at>Date.parse(clock())+366*86400000)fail('Choose a reminder time before the appointment and no earlier than now.');
        const row={...r.preview,DueAt:new Date(Math.max(at,Date.parse(clock()))).toISOString(),Status:'Queued',Attempt:r.reminder?.Attempt||0,ConsentConfirmedAt:clock(),ConsentConfirmedBy:actor,CreatedAt:r.reminder?.CreatedAt||clock(),UpdatedAt:clock(),UpdatedBy:actor};
        return {writes:[write('AppointmentReminders',row.ReminderId,row,r.reminder?{__updateTime:r.reminder.Revision}:null),event(key,row,r.reminder?'Reconfirmed':'Queued'),auditWrite(key,'Schedule appointment reminder',row.BranchId,{}, {ReminderId:row.ReminderId,AppointmentId:row.AppointmentId})],result:{ReminderId:row.ReminderId,Status:'Queued'}};
      });
    },
    async appointmentReminders(body){
      requireCapability('appointments.read');const BranchId=await branch(body),Status=clean(body.Status);if(!states.includes(Status))fail('Choose a reminder status.');
      const open=['Queued','Sending','Uncertain'].includes(Status),sort=open?'DueAt':'UpdatedAt',filters=[eq('BranchId',BranchId),eq('Status',Status),...(open?[]:dateFilters(body.DateRange,sort))];
      const scope=await hash(filters);if(body.Cursor&&body.Cursor.scope!==scope)fail('Load the first page for these reminder filters.');
      const r=await page('AppointmentReminders',filters,sort,body);
      return {ok:true,reminders:r.rows.map(view),next:r.next?{...r.next,scope}:null};
    },
    async appointmentReminderDetails(body){requireCapability('appointments.read');return {ok:true,reminder:view(await current(body))};},
    async appointmentReminderHistory(body){
      requireCapability('appointments.read');const row=await current(body),filters=[eq('BranchId',row.BranchId),eq('ReminderId',row.ReminderId),...dateFilters(body.DateRange)],scope=await hash(filters);
      if(body.Cursor&&body.Cursor.scope!==scope)fail('Load the first page for this reminder history.');const r=await page('AppointmentReminderEvents',filters,'CreatedAt',body);return {ok:true,entries:r.rows.map(strip),next:r.next?{...r.next,scope}:null};
    },
    async changeAppointmentReminder(body){
      requireWrite();await branch(body);return operation(body,'changeAppointmentReminder',async key=>{
        const row=await current(body);revision(row,body.Revision);const Action=clean(body.Action),Reason=field(body,'Reason',1000,true);if(Reason.length<5)fail('Record a clear reason for this change.');let Status;
        if(Action==='cancel'&&['Queued','Failed'].includes(row.Status))Status='Cancelled';
        else if(Action==='retry'&&row.Status==='Failed'){
          const a=await read('Appointments',row.AppointmentId),p=await patient(row.PatientId,row.BranchId),why=reason(a,p,row);if(why)fail(why,409);if(!((await connection(row.BranchId)).configured))fail('Connect the email provider first.',409);Status='Queued';
        }else if(['confirm-accepted','confirm-cancelled'].includes(Action)&&['Sending','Uncertain'].includes(row.Status)){
          requireCapability('appointments.configure');if(Date.parse(clock())-Date.parse(row.ClaimedAt)<10*60000)fail('Allow ten minutes for the in-flight send to finish before reviewing its outcome.',409);
          if(body.ConfirmProviderReview!==true)fail('Confirm that you checked the provider delivery log.');Status=Action==='confirm-accepted'?'Accepted':'Cancelled';
        }else fail('This reminder cannot make that transition. Refresh its status.',409);
        const next={...strip(row),Status,Reason,UpdatedAt:clock(),UpdatedBy:actor,...(Status==='Cancelled'?{CancelledFrom:row.Status}:{}),...(Status==='Queued'?{DueAt:clock()}:{})};
        return {writes:[write('AppointmentReminders',row.ReminderId,next,row),event(key,next,Status,Reason),auditWrite(key,'Review appointment reminder',row.BranchId,{}, {ReminderId:row.ReminderId,Status,Reason})],result:{ReminderId:row.ReminderId,Status}};
      });
    },
    async sendAppointmentReminder(body){requireWrite();if(body.ConfirmSend!==true)fail('Confirm processing this due reminder.');return dispatch(body);},
    // This method is deliberately absent from the staff HTTP action allowlist.
    async processAppointmentReminder(body){return dispatch(body);}
  };
}
