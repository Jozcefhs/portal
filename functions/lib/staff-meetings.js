import {getDocument, getDocuments, listCollection, queryCollectionPages, batchCommitLiteralDocuments} from './firestore.js';
import {requiredDeploymentIdentity} from './deployment-identity.js';
import {academicManagementCapabilities, academicWebActor} from './academic-management.js';
import {enforceActorBranch} from './branch-scope.js';
import {staffAccountVisibleInBranch} from './staff-branch-access.js';
import {canManageAttendanceGroups} from './staff-attendance-groups.js';
import {getStaffAttendanceDocument} from './staff-attendance-storage.js';
import {staffAttendanceDirectoryFor, normalizeAttendanceSite, evaluateAttendancePresence, verifiedAttendanceIdentity} from './staff-time-attendance.js';
import {attendanceLocalDate, attendanceShiftForDate} from './staff-attendance-schedules.js';

const clean=value=>String(value??'').trim();
const lower=value=>clean(value).toLowerCase();
const DAYS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const publicRow=row=>Object.fromEntries(Object.entries(row||{}).filter(([key])=>!key.startsWith('__')));
const precondition=row=>row ? {updateTime:row.__updateTime||fail('The saved meeting revision is unavailable. Reload it.',409)} : {exists:false};
const deps={getDocument,getDocuments,listCollection,queryCollectionPages,batchCommitLiteralDocuments,getStaffAttendanceDocument,now:()=>new Date().toISOString()};
const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clean(value))?lower(value):fail('A valid meeting identifier is required.');
const ips=value=>Array.isArray(value)?value:clean(value).split(/[\s,]+/).filter(Boolean);
function validIp(value){
  if(value.includes(':')){try{return !value.includes('%')&&Boolean(new URL(`https://[${value}]/`).hostname);}catch{return false;}}
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value)&&value.split('.').every(part=>Number(part)<=255&&String(Number(part))===part);
}
function date(value){const text=clean(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text))||new Date(`${text}T00:00:00Z`).toISOString().slice(0,10)!==text)fail('Choose a valid meeting date.');return text;}
function integer(value,fallback,min,max,label){const n=value===''||value==null?fallback:Number(value);if(!Number.isInteger(n)||n<min||n>max)fail(`${label} must be between ${min} and ${max}.`);return n;}
export function canManageStaffMeetings(user){
  const edition=lower(user.edition||'school').replace(/^church$/,'faith'),role=clean(user.role),sections=new Set(user.allowedSections||[]);
  if(edition==='school'&&academicManagementCapabilities(academicWebActor(user)).canManageStructure===true)return true;
  if(canManageAttendanceGroups(user)&&['staffAttendance','humanResources'].some(key=>sections.has(key)))return true;
  const roles={faith:['Super Admin','Pastor','Senior Pastor','Head Minister','Church Administrator','Management'],
    organization:['Super Admin','Executive Director','Organisation Administrator','Operations Manager','Management'],
    hospital:['Super Admin','Hospital Administrator','Medical Director']};
  const modules={faith:['staffAttendance','services','executiveOffice','humanResources'],organization:['staffAttendance','services','executiveOffice','humanResources'],hospital:['staffAttendance','hospitalReception','humanResources']};
  return (roles[edition]||[]).includes(role)&&(modules[edition]||[]).some(key=>sections.has(key));
}
export function meetingProofSiteId(branch,id,day){return `meeting:${clean(branch)}:${uuid(id)}:${date(day)}`;}
function context(env,user,body){
  const identity=requiredDeploymentIdentity(env);
  if(lower(user.edition||'school').replace(/^church$/,'faith')!==identity.edition)fail('Meetings are unavailable for an account from another organisation edition.',403);
  if(!clean(user.username))fail('Sign in with your staff account.',401);
  const branch=enforceActorBranch(user,body.BranchId);
  if(!/^[a-z0-9_-]+$/i.test(branch))fail('Select one organisation branch.');
  if(['Vendor User','Parent','Student','External Auditor'].includes(user.role))fail('This workspace is for school staff.',403);
  return {branch,root:`${identity.edition==='school'?'schoolBranches':'organisationBranches'}/${branch}`,manager:canManageStaffMeetings(user),username:lower(user.username)};
}
function writable(user){if(user.subscriptionReadOnly||user.subscriptionActive===false)fail('The subscription is read-only. Meeting changes are unavailable.',403);}
export function normalizeStaffMeeting(input,now){
  if(!Array.isArray(input.Departments)||input.Type==='Daily'&&!Array.isArray(input.Days))fail('Choose departments and meeting days using the checkboxes.');
  const Title=clean(input.Title);if(!Title||Title.length>140)fail('Enter a meeting title of up to 140 characters.');
  const Type=clean(input.Type);if(!['Daily','Dated'].includes(Type))fail('Choose a daily or dated meeting.');
  const TimeZone=clean(input.TimeZone)||'Africa/Lagos';try{attendanceLocalDate(now,TimeZone);}catch{fail('Choose a valid time zone.');}
  const StartDate=date(input.StartDate),EndDate=Type==='Dated'?StartDate:clean(input.EndDate)?date(input.EndDate):'';
  if(EndDate&&EndDate<StartDate)fail('The finish date cannot precede the start date.');
  const StartTime=clean(input.StartTime),EndTime=clean(input.EndTime);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(StartTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(EndTime)||EndTime<=StartTime)fail('Choose start and finish times on the same day, with finish after start.');
  const Days=Type==='Dated'?[DAYS[new Date(StartDate).getUTCDay()]]:[...new Set((input.Days||[]).map(clean))];
  if(!Days.length||Days.some(day=>!DAYS.includes(day)))fail('Select the days for this daily meeting.');
  const Departments=[...new Set((input.Departments||[]).map(lower).filter(Boolean))];
  if(!Departments.length||Departments.length>100)fail('Select at least one department.');
  const Site=normalizeAttendanceSite({...input.Site,Name:clean(input.Site?.Name)||Title,Active:'YES'});
  if(Site.Policy!=='NETWORK_ONLY'&&(!Number.isFinite(Site.Latitude)||Site.Latitude < -90||Site.Latitude>90||!Number.isFinite(Site.Longitude)||Site.Longitude < -180||Site.Longitude>180||input.Site?.Latitude===''||input.Site?.Longitude===''))fail('Enter valid meeting GPS coordinates.');
  if(Site.Policy==='NETWORK_ONLY'&&!Site.AllowedPublicIps.length)fail('Add an approved public network address or use your current network.');
  if(Site.AllowedPublicIps.length>30||Site.AllowedPublicIps.some(ip=>!validIp(ip)))fail('Enter exact public IPv4 or IPv6 addresses, separated by commas.');
  return {Title,Type,StartDate,EndDate,StartTime,EndTime,TimeZone,Days,Departments,Site,
    GraceMinutes:integer(input.GraceMinutes,0,0,180,'Late grace period'),
    OpenMinutes:integer(input.OpenMinutes,30,0,360,'Check-in opening allowance'),
    CheckoutMinutes:integer(input.CheckoutMinutes,120,0,720,'Check-out allowance'),
    Cancelled:input.Cancelled===true};
}
function versionAt(entry,day){return [...(entry?.Versions||[])].filter(v=>v.EffectiveFrom<=day).sort((a,b)=>b.EffectiveFrom.localeCompare(a.EffectiveFrom)||b.SavedAt.localeCompare(a.SavedAt))[0];}
export function meetingRunsOn(meeting,day){return !meeting.Cancelled&&day>=meeting.StartDate&&(!meeting.EndDate||day<=meeting.EndDate)&&meeting.Days.includes(DAYS[new Date(day).getUTCDay()]);}
export function meetingSchedule(meeting,day){
  return attendanceShiftForDate({TimeZone:meeting.TimeZone,ResumptionTime:meeting.StartTime,ClosingTime:meeting.EndTime,WorkDays:DAYS,
    GraceMinutes:meeting.GraceMinutes,ClockInOpenMinutesBefore:meeting.OpenMinutes,Active:'YES'}, {},'',day);
}
export function meetingAttendanceRows(occurrence,records,now){
  const byUser=new Map(records.map(row=>[row.Username,row])),end=Date.parse(occurrence.Schedule.EndAt),at=Date.parse(now);
  return occurrence.Participants.map(person=>{
    const saved=byUser.get(person.Username)||{},inside=Boolean(saved.FirstClockIn),out=Boolean(saved.LastClockOut);
    const Status=inside?(saved.LateMinutes>0?'Late':'Present'):at>=end?'Absent':'Pending';
    return {...person,...publicRow(saved),Status,MissingClockOut:inside&&!out&&at>=end,
      AttendanceState:inside?(out?'Completed':'Checked in'):'Not checked in'};
  });
}
async function directory(env,user,branch,io){
  const [staff,employees]=await Promise.all([io.listCollection(env,'staffUsers'),io.listCollection(env,'hrEmployees')]);
  const visible=staff.filter(row=>staffAccountVisibleInBranch(row,{branchId:branch})&&!row.DeletedAt&&!['Vendor User','Parent','Student','External Auditor'].includes(row.Role))
    .map(row=>({...row,BranchId:branch}));
  return staffAttendanceDirectoryFor(visible,employees,user,branch);
}
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function summary(meeting){const {Participants,Site,...rest}=publicRow(meeting);return {...rest,Site:{Name:Site.Name,Policy:Site.Policy,Latitude:Site.Latitude,Longitude:Site.Longitude,RadiusMetres:Site.RadiusMetres},ExpectedCount:Participants.length};}

export async function handleStaffMeetings(env,user,body,requestContext={},dependencies={}){
  const io={...deps,...dependencies},ctx=context(env,user,body),action=lower(body.action),now=io.now();
  if(!['bootstrap','setup','save','list','report','clock'].includes(action))fail('Unsupported meeting action.');
  if(['setup','save','report'].includes(action)&&!ctx.manager)fail('Meeting management requires full academic, organisation or authorised HR control.',403);
  if(['save','clock'].includes(action))writable(user);
  const catalogPath=`${ctx.root}/staffMeetingSettings`,versionsPath=`${ctx.root}/staffMeetingVersions`,occurrencesPath=`${ctx.root}/staffMeetingOccurrences`;
  const policy=['bootstrap','list','clock'].includes(action)?await io.getStaffAttendanceDocument(env,'policy',ctx.branch,'default')||{}:{};
  const identityPolicy={IdentityVerification:policy.IdentityVerification||'NONE'};
  if(action==='bootstrap')return {ok:true,canManage:ctx.manager,Date:attendanceLocalDate(now,policy.TimeZone||'Africa/Lagos'),TimeZone:policy.TimeZone||'Africa/Lagos',policy:identityPolicy};
  const catalog=await io.getDocument(env,catalogPath,'catalog');
  const entries=catalog?.Meetings||[];
  if(action==='setup'){
    const people=await directory(env,user,ctx.branch,io);
    let meeting=null;
    if(body.MeetingId){const entry=entries.find(row=>row.MeetingId===uuid(body.MeetingId));if(!entry)fail('Meeting not found.',404);meeting=await io.getDocument(env,versionsPath,entry.Versions.at(-1).VersionId);}
    const departments=[...new Map(people.map(row=>[lower(row.Department)||'__unassigned__',row.Department||'No department'])).entries()].map(([Id,Name])=>({Id,Name,Count:people.filter(row=>(lower(row.Department)||'__unassigned__')===Id).length}));
    return {ok:true,departments,meeting:meeting?publicRow(meeting):null,Revision:catalog?.Revision||'',policy:identityPolicy};
  }
  if(action==='save'){
    if(clean(body.ExpectedRevision)!==(catalog?.Revision||''))fail('The meeting schedule changed. Reopen the editor before saving.',409);
    const MeetingId=uuid(body.MeetingId),existing=entries.find(row=>row.MeetingId===MeetingId);
    const input={...body};if(body.UseCurrentNetwork===true){if(!clean(requestContext.clientIp))fail('Your public network address is unavailable. Enter it explicitly.');input.Site={...body.Site,AllowedPublicIps:[...new Set([...ips(body.Site?.AllowedPublicIps),clean(requestContext.clientIp)].filter(Boolean))]};}
    const meeting=normalizeStaffMeeting(input,now),today=attendanceLocalDate(now,meeting.TimeZone),EffectiveFrom=date(body.EffectiveFrom||meeting.StartDate);
    if(EffectiveFrom<today||meeting.StartDate<today&&!existing)fail('New meeting schedules cannot be backdated.');
    // Editing future occurrences only makes the current day's roster, location
    // and times immutable, even when nobody has checked in yet.
    if(existing&&EffectiveFrom<=today)fail('Changes to an existing meeting take effect from tomorrow or a later date.');
    if(EffectiveFrom<meeting.StartDate)fail('The effective date cannot precede the meeting start date.');
    if(meeting.EndDate&&EffectiveFrom>meeting.EndDate)fail('The effective date is after the meeting ends. Create a new meeting instead.');
    if(!existing&&Date.parse(meetingSchedule(meeting,meeting.StartDate).EndAt)<=Date.parse(now))fail('This meeting has already finished. Choose a future time.');
    const people=await directory(env,user,ctx.branch,io),available=new Set(people.map(row=>lower(row.Department)||'__unassigned__'));
    if(meeting.Departments.some(department=>!available.has(department)))fail('A selected department is unavailable. Reload departments.');
    const Participants=people.filter(row=>meeting.Departments.includes(lower(row.Department)||'__unassigned__'));
    if(!Participants.length||Participants.length>1000)fail('A meeting must include between 1 and 1,000 active staff members.');
    const VersionId=crypto.randomUUID(),saved={...meeting,MeetingId,VersionId,EffectiveFrom,Participants,SavedAt:now,SavedBy:ctx.username,BranchId:ctx.branch};
    if(new TextEncoder().encode(JSON.stringify(saved)).length>600000)fail('The participant list is too large.',413);
    const pointer={VersionId,EffectiveFrom,SavedAt:now,Title:meeting.Title,StartDate:meeting.StartDate,EndDate:meeting.EndDate,Days:meeting.Days,Cancelled:meeting.Cancelled};
    const replacement={MeetingId,Versions:[...(existing?.Versions||[]),pointer]};
    const Meetings=entries.filter(row=>row.MeetingId!==MeetingId).concat(replacement);
    if(Meetings.length>100||replacement.Versions.length>100)fail('The meeting schedule limit has been reached. Existing history is preserved.',409);
    if(new TextEncoder().encode(JSON.stringify(Meetings)).length>700000)fail('The meeting schedule is full. Existing history is preserved.',409);
    await io.batchCommitLiteralDocuments(env,[{collectionPath:versionsPath,documentId:VersionId,data:saved,exists:false},
      {collectionPath:catalogPath,documentId:'catalog',data:{Meetings,Revision:crypto.randomUUID(),UpdatedAt:now,UpdatedBy:ctx.username},...precondition(catalog)}]);
    return {ok:true,message:`Meeting saved for ${Participants.length} staff. ${existing?'Changes apply from '+EffectiveFrom+'.':'It is ready for attendance.'}`,meeting:summary(saved)};
  }
  const day=date(body.Date);
  const requested=body.MeetingId?uuid(body.MeetingId):'';
  const pointers=entries.filter(entry=>!requested||entry.MeetingId===requested).map(entry=>({MeetingId:entry.MeetingId,pointer:versionAt(entry,day)})).filter(row=>row.pointer&&meetingRunsOn(row.pointer,day));
  if(requested&&!pointers.length)fail('No meeting is scheduled for this date.',404);
  if(action!=='list'&&!requested)fail('Choose one meeting.');
  const loaded=await io.getDocuments(env,versionsPath,pointers.map(row=>row.pointer.VersionId));
  const meetings=loaded.filter(Boolean).filter(row=>meetingRunsOn(row,day));
  if(requested&&!meetings.length)fail('This meeting does not run on the selected date.',404);
  const usernameHash=await digest(ctx.username);
  const occurrenceId=meeting=>`${meeting.MeetingId}_${day}`;
  if(action==='list'){
    const visible=meetings.filter(meeting=>ctx.manager||meeting.Participants.some(row=>row.Username===ctx.username));
    const attendance=await Promise.all(visible.map(meeting=>io.getDocument(env,`${occurrencesPath}/${occurrenceId(meeting)}/attendance`,usernameHash)));
    return {ok:true,Date:day,canManage:ctx.manager,policy:identityPolicy,meetings:visible.map((meeting,i)=>({...summary(meeting),Schedule:meetingSchedule(meeting,day),
      Invited:meeting.Participants.some(row=>row.Username===ctx.username),attendance:publicRow(attendance[i]),ProofSiteId:meetingProofSiteId(ctx.branch,meeting.MeetingId,day)}))};
  }
  const meeting=meetings[0],id=occurrenceId(meeting),attendancePath=`${occurrencesPath}/${id}/attendance`;
  let occurrence=await io.getDocument(env,occurrencesPath,id);
  const snapshot=occurrence||{...publicRow(meeting),Date:day,Schedule:meetingSchedule(meeting,day)};
  if(action==='report'){
    const records=occurrence?await io.queryCollectionPages(env,attendancePath,{pageSize:250,maxRows:1001}):[];
    return {ok:true,meeting:summary(snapshot),Date:day,Schedule:snapshot.Schedule,rows:meetingAttendanceRows(snapshot,records,now),LoadedAt:now};
  }
  const person=snapshot.Participants.find(row=>row.Username===ctx.username);
  if(!person)fail('Your department is not included in this meeting.',403);
  const direction=clean(body.Direction).toUpperCase();if(!['IN','OUT'].includes(direction))fail('Choose meeting check-in or check-out.');
  const start=Date.parse(snapshot.Schedule.StartAt),end=Date.parse(snapshot.Schedule.EndAt),at=Date.parse(now);
  for(let attempt=0;attempt<3;attempt++){
    const saved=await io.getDocument(env,attendancePath,usernameHash);
    if(saved?.[direction==='IN'?'FirstClockIn':'LastClockOut'])return {ok:true,attendance:publicRow(saved),message:'This meeting attendance was already recorded. No duplicate was created.'};
    if(direction==='OUT'&&!saved?.FirstClockIn)fail('Check in to this meeting before checking out.',409);
  if(at<start-snapshot.OpenMinutes*60000||at>end+snapshot.CheckoutMinutes*60000||(direction==='IN'&&at>=end))fail('This meeting is outside its attendance window.',409);
  const identity=verifiedAttendanceIdentity(identityPolicy,requestContext.identityProof);
  const location=body.Location||{},latitude=location.Latitude??location.latitude,longitude=location.Longitude??location.longitude,accuracy=location.Accuracy??location.accuracy;
  const validLocation=[latitude,longitude,accuracy].every(value=>typeof value==='number'&&Number.isFinite(value))&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180&&accuracy>=0;
  const presence=evaluateAttendancePresence(snapshot.Site,validLocation?location:{},requestContext.clientIp||'');
  if(!presence.passed)fail('Use this meeting’s approved location or network to record attendance.',403);

    const record={...publicRow(saved),...person,Date:day,MeetingId:meeting.MeetingId,VersionId:meeting.VersionId,
      ...(direction==='IN'?{FirstClockIn:now,LateMinutes:at>start+snapshot.GraceMinutes*60000?Math.max(1,Math.round((at-start)/60000)):0}:
        {LastClockOut:now,EarlyDepartureMinutes:Math.max(0,Math.round((end-at)/60000)),MinutesAttended:Math.max(0,Math.round((at-Date.parse(saved.FirstClockIn))/60000))})};
    const event={...person,Date:day,Direction:direction,Timestamp:now,MeetingId:meeting.MeetingId,VersionId:meeting.VersionId,
      VerificationMethod:`${presence.verificationMethod} + ${identity}`,DistanceMetres:presence.distanceMetres,AccuracyMetres:presence.accuracyMetres};
    const writes=[{collectionPath:attendancePath,documentId:usernameHash,data:record,...precondition(saved)},
      {collectionPath:`${occurrencesPath}/${id}/events`,documentId:`${usernameHash}_${direction}`,data:event,exists:false}];
    if(!occurrence)writes.push({collectionPath:occurrencesPath,documentId:id,data:snapshot,exists:false});
    try{await io.batchCommitLiteralDocuments(env,writes);return {ok:true,attendance:record,message:`Meeting check-${direction==='IN'?'in':'out'} recorded.`};}
    catch(error){if(attempt===2||![409,412].includes(error.status))throw error;occurrence=await io.getDocument(env,occurrencesPath,id);}
  }
}
