import test from 'node:test';
import assert from 'node:assert/strict';
import {handleStaffMeetings,normalizeStaffMeeting,meetingSchedule,meetingAttendanceRows,canManageStaffMeetings,meetingProofSiteId} from '../functions/lib/staff-meetings.js';
import {filterMeetingRows,meetingPrintDocument} from '../js/staff-meetings.js';
import {createStaffAttendanceProof,readStaffAttendanceProof} from '../functions/lib/staff-auth.js';

const env={ORGANISATION_EDITION:'school',DYNAMAX_WORKSPACE_ID:'meeting-test'};
const admin={username:'head',role:'Super Admin',edition:'school',allowedSections:['academics'],branchId:'main'};
const staff={username:'teacher',role:'Teacher',edition:'school',allowedSections:[],branchId:'main'};
const id='11111111-1111-4111-8111-111111111111';
const root='schoolBranches/main';
const form={MeetingId:id,Title:'Morning briefing',Type:'Daily',StartDate:'2026-10-28',StartTime:'08:00',EndTime:'09:00',Days:['MON','TUE','WED','THU','FRI'],TimeZone:'Africa/Lagos',Departments:['teaching'],Site:{Name:'Meeting hall',Policy:'GEOFENCE_ONLY',Latitude:9.1,Longitude:7.2,RadiusMetres:150},GraceMinutes:5,OpenMinutes:30,CheckoutMinutes:120};
function fixture(){
  const docs=new Map(),reads=[],commits=[];let now='2026-10-28T06:00:00.000Z',revision=0;
  const directory=[
    {Username:'teacher',DisplayName:'Ada Teacher',Role:'Teacher',Department:'Teaching',BranchId:'main',Edition:'school',Active:'YES'},
    {Username:'head',DisplayName:'School Head',Role:'Super Admin',Department:'Teaching',BranchId:'main'},
    {Username:'accounts',DisplayName:'Finance Officer',Role:'Accounts Officer',Department:'Finance',BranchId:'main'},
    {Username:'inactive',DisplayName:'Inactive',Department:'Teaching',BranchId:'main',Active:'NO'},
    {Username:'exited',Department:'Teaching',BranchId:'main'},
    {Username:'other',Department:'Teaching',BranchId:'primary'},
    {Username:'faith',Department:'Teaching',BranchId:'main',Edition:'faith'},
    {Username:'vendor',Department:'Teaching',BranchId:'main',Role:'Vendor User'},
    {Username:'deleted',Department:'Teaching',BranchId:'main',DeletedAt:'2026-01-01'}
  ];
  let policy={IdentityVerification:'NONE',TimeZone:'Africa/Lagos'};
  const copy=value=>value?structuredClone(value):null;
  const io={now:()=>now,
    getDocument:async(_env,path,id)=>{reads.push(['get',path,id]);return copy(docs.get(`${path}/${id}`));},
    getDocuments:async(_env,path,ids)=>{reads.push(['batch',path,ids]);return ids.map(id=>copy(docs.get(`${path}/${id}`)));},
    listCollection:async(_env,path)=>{reads.push(['list',path]);return path==='staffUsers'?copy(directory):[{Username:'exited',Status:'Terminated',BranchId:'main',Edition:'school'}];},
    queryCollectionPages:async(_env,path,options)=>{reads.push(['query',path,options]);return [...docs].filter(([key])=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')).map(([,value])=>copy(value));},
    getStaffAttendanceDocument:async()=>{reads.push(['policy']);return copy(policy);},
    batchCommitLiteralDocuments:async(_env,writes)=>{
      for(const write of writes){const prior=docs.get(`${write.collectionPath}/${write.documentId}`);
        if(write.exists===false&&prior||write.updateTime&&prior?.__updateTime!==write.updateTime)throw Object.assign(new Error('Precondition conflict'),{status:409});}
      commits.push(copy(writes));for(const write of writes)docs.set(`${write.collectionPath}/${write.documentId}`,{...copy(write.data),__updateTime:`revision-${++revision}`});
    }};
  const call=(action,body={},user=admin,context={})=>handleStaffMeetings(env,user,{action,BranchId:'main',...body},context,io);
  return {docs,reads,commits,directory,call,io,setTime:value=>now=value,setPolicy:value=>policy=value,save:(changes={})=>call('save',{...form,...changes}),clock:(Direction='IN',context={},changes={})=>call('clock',{MeetingId:id,Date:'2026-10-28',Direction,Location:{Latitude:9.1,Longitude:7.2,Accuracy:20},...changes},staff,context)};
}

test('all full Academic Management roles can manage meetings; limited roles cannot',()=>{
  for(const role of ['Super Admin','Principal','Vice Principal Academics','Vice Principal Administration','Head Teacher','Assistant Head Teacher','Management','ICT'])assert.equal(canManageStaffMeetings({...admin,role}),true,role);
  for(const role of ['Teacher','Accounts Officer','Parent','Vendor User'])assert.equal(canManageStaffMeetings({...admin,role}),false,role);
  assert.equal(canManageStaffMeetings({...admin,allowedSections:[]}),false);
});
test('unauthorised manager, cross-branch and non-school requests fail before directory reads',async()=>{
  const f=fixture();
  for(const action of ['setup','save','report'])await assert.rejects(f.call(action,{},staff),/Meeting management/);
  await assert.rejects(f.call('list',{BranchId:'primary',Date:'2026-10-28'}),/another branch/);
  await assert.rejects(handleStaffMeetings({...env,ORGANISATION_EDITION:'faith'},admin,{action:'list'}, {},f.io),/unavailable/);
  await assert.rejects(f.call('save',form,{...admin,subscriptionReadOnly:true}),/read-only/);
  assert.equal(f.reads.length,0);
});
test('opening controls reads policy only; no records, staff directory or writes',async()=>{
  const f=fixture();const result=await f.call('bootstrap');assert.equal(result.Date,'2026-10-28');assert.equal(result.canManage,true);
  assert.deepEqual(f.reads,[['policy']]);assert.equal(f.commits.length,0);
});
test('meeting validation rejects malformed dates, departments, times and locations',()=>{
  for(const change of [{StartDate:'2026-02-30'},{StartTime:'25:00'},{EndTime:'07:00'},{Days:[]},{Departments:[]},{Departments:'teaching'},{Days:'WED'},{TimeZone:'Not/AZone'},{GraceMinutes:-1},{Site:{...form.Site,Latitude:91}},{Site:{...form.Site,Longitude:''}},{Site:{Name:'Network',Policy:'NETWORK_ONLY',AllowedPublicIps:['999.2.3.4']}},{Site:{Name:'Network',Policy:'NETWORK_ONLY',AllowedPublicIps:[]}}])assert.throws(()=>normalizeStaffMeeting({...form,...change},'2026-10-28T06:00:00Z'));
  assert.equal(normalizeStaffMeeting({...form,Type:'Dated',Days:[]},'2026-10-28T06:00:00Z').EndDate,'2026-10-28');
});
test('save captures only active selected departments in this edition and branch',async()=>{
  const f=fixture();const result=await f.save();assert.equal(result.meeting.ExpectedCount,2);
  const version=[...f.docs].find(([key])=>key.includes('staffMeetingVersions'))[1];assert.deepEqual(version.Participants.map(row=>row.Username).sort(),['head','teacher']);
  assert.equal(f.commits.length,1);assert.equal(f.commits[0].length,2);
  assert.ok(f.commits.flat().every(row=>!row.collectionPath.includes('staffDailyAttendance')));
});
test('multi-branch and organisation-wide staff may be included in the selected branch',async()=>{
  const f=fixture();f.directory.push({Username:'multi',Department:'Teaching',BranchId:'primary',BranchIds:['primary','main'],BranchAccess:'selected'}, {Username:'wide',Department:'Teaching',BranchAccess:'all'});
  const result=await f.save();assert.equal(result.meeting.ExpectedCount,4);
});
test('unknown departments and forged participant rosters cannot enrol excluded staff',async()=>{
  const f=fixture();await assert.rejects(f.save({Departments:['invented']}),/unavailable/);assert.equal(f.commits.length,0);
  await f.save({Participants:[{Username:'accounts'}]});f.setTime('2026-10-28T07:00:00Z');
  await assert.rejects(f.call('clock',{MeetingId:id,Date:'2026-10-28',Direction:'IN'}, {...staff,username:'accounts'}),/not included/);
});
test('trusted current public network is stored only on the meeting',async()=>{
  const f=fixture();await f.call('save',{...form,Site:{Name:'Meeting Wi-Fi',Policy:'NETWORK_ONLY',AllowedPublicIps:'203.0.113.2'},UseCurrentNetwork:true},admin,{clientIp:'203.0.113.3'});
  const version=[...f.docs].find(([key])=>key.includes('staffMeetingVersions'))[1];assert.deepEqual(version.Site.AllowedPublicIps,['203.0.113.2','203.0.113.3']);
  assert.ok([...f.docs.keys()].every(key=>key.includes('staffMeeting')));
});
test('stale schedule saves conflict without losing the original record',async()=>{
  const f=fixture();await f.save();const before=structuredClone([...f.docs]);await assert.rejects(f.save({Title:'Overwrite'}),/schedule changed/);assert.deepEqual([...f.docs],before);
});
test('future edits preserve today and historical roster, schedule and attendance',async()=>{
  const f=fixture();await f.save();f.setTime('2026-10-28T07:00:00Z');await f.clock();const setup=await f.call('setup',{MeetingId:id});
  await assert.rejects(f.save({ExpectedRevision:setup.Revision,EffectiveFrom:'2026-10-28'}),/tomorrow/);
  await f.save({ExpectedRevision:setup.Revision,EffectiveFrom:'2026-10-29',Departments:['finance'],Title:'Future finance meeting',StartTime:'10:00',EndTime:'11:00'});
  const today=await f.call('report',{MeetingId:id,Date:'2026-10-28'}),tomorrow=await f.call('report',{MeetingId:id,Date:'2026-10-29'});
  assert.equal(today.meeting.Title,'Morning briefing');assert.equal(today.rows.length,2);assert.equal(today.rows.find(row=>row.Username==='teacher').Status,'Present');
  assert.equal(tomorrow.meeting.Title,'Future finance meeting');assert.equal(tomorrow.rows.length,1);assert.equal(tomorrow.rows[0].Username,'accounts');
  assert.equal([...f.docs.keys()].filter(key=>key.includes('staffMeetingVersions')).length,2);
});
test('daily weekdays and dated meetings only load the requested date, without directory reads',async()=>{
  const f=fixture();await f.save();f.reads.length=0;
  const saturday=await f.call('list',{Date:'2026-10-31'},staff);assert.equal(saturday.meetings.length,0);
  assert.ok(f.reads.every(row=>row[0]!=='list'));assert.ok(!f.reads.some(row=>row[0]==='query'));
  f.reads.length=0;const today=await f.call('list',{Date:'2026-10-28'},staff);assert.equal(today.meetings.length,1);assert.equal(today.meetings[0].Participants,undefined);assert.equal(today.meetings[0].Site.AllowedPublicIps,undefined);
  const accounts=await f.call('list',{Date:'2026-10-28'},{...staff,username:'accounts'});assert.equal(accounts.meetings.length,0);
  const g=fixture();await g.save({Type:'Dated'});assert.equal((await g.call('list',{Date:'2026-10-29'},staff)).meetings.length,0);
});
test('pending is distinct from absence and no read-only report creates records',async()=>{
  const f=fixture();await f.save();const before=structuredClone([...f.docs]);
  let report=await f.call('report',{MeetingId:id,Date:'2026-10-28'});assert.ok(report.rows.every(row=>row.Status==='Pending'));
  f.setTime('2026-10-28T08:00:00Z');report=await f.call('report',{MeetingId:id,Date:'2026-10-28'});assert.ok(report.rows.every(row=>row.Status==='Absent'));
  assert.deepEqual([...f.docs],before);assert.ok(!f.reads.some(row=>row[0]==='query'));
});
test('meeting GPS and identity verification are both required, independent of daily attendance',async()=>{
  const f=fixture();await f.save();f.setTime('2026-10-28T07:10:00Z');f.setPolicy({IdentityVerification:'PASSKEY'});
  await assert.rejects(f.clock(),/identity/);await assert.rejects(f.clock('IN',{identityProof:{method:'face'}}),/identity/);
  await assert.rejects(f.clock('IN',{identityProof:{method:'passkey'}},{Location:{Latitude:5,Longitude:5,Accuracy:20}}),/approved location/);
  await f.clock('IN',{identityProof:{method:'passkey'}});const report=await f.call('report',{MeetingId:id,Date:'2026-10-28'});assert.equal(report.rows.find(row=>row.Username==='teacher').LateMinutes,10);
  assert.ok(f.commits.flat().every(row=>row.collectionPath.startsWith(root+'/staffMeeting')));
});
test('network-only meetings accept exact approved public IP and reject other networks',async()=>{
  const f=fixture();await f.save({Site:{Name:'Meeting network',Policy:'NETWORK_ONLY',AllowedPublicIps:['203.0.113.1']}});f.setTime('2026-10-28T07:00:00Z');
  await assert.rejects(f.clock('IN',{clientIp:'203.0.113.2'},{Location:{}}),/approved location/);await f.clock('IN',{clientIp:'203.0.113.1'},{Location:{}});
});
test('simultaneous clock-ins and subsequent retries create one IN and one OUT event',async()=>{
  const f=fixture();await f.save();f.setTime('2026-10-28T07:00:00Z');await Promise.all([f.clock(),f.clock()]);const inWrites=f.commits.length;
  await f.clock();assert.equal(f.commits.length,inWrites);
  f.setTime('2026-10-28T08:00:00Z');await Promise.all([f.clock('OUT'),f.clock('OUT')]);const after=f.commits.length;await f.clock('OUT');assert.equal(f.commits.length,after);
  const events=[...f.docs].filter(([path])=>path.includes('/events/'));assert.equal(events.length,2);
  const report=await f.call('report',{MeetingId:id,Date:'2026-10-28'}),row=report.rows.find(row=>row.Username==='teacher');assert.equal(row.MinutesAttended,60);assert.equal(row.FirstClockIn,'2026-10-28T07:00:00Z');assert.equal(row.LastClockOut,'2026-10-28T08:00:00Z');
});
test('attendance windows and IN-before-OUT are enforced using server time',async()=>{
  const f=fixture();await f.save();await assert.rejects(f.clock(),/window/);f.setTime('2026-10-28T07:00:00Z');await assert.rejects(f.clock('OUT'),/Check in/);
  f.setTime('2026-10-28T08:00:00Z');await assert.rejects(f.clock(),/window/);assert.equal(f.commits.length,1);
});
test('late, absent, early departure and missing check-out filters use only loaded rows',()=>{
  const meeting=normalizeStaffMeeting(form,'2026-10-28T06:00:00Z');const occurrence={...meeting,Schedule:meetingSchedule(meeting,'2026-10-28'),Participants:[{Username:'a',DisplayName:'Ada',Department:'Teaching'},{Username:'b',DisplayName:'Bola',Department:'Finance'},{Username:'c',DisplayName:'Chidi',Department:'Teaching'}]};
  const rows=meetingAttendanceRows(occurrence,[{Username:'a',FirstClockIn:'2026-10-28T07:10:00Z',LateMinutes:10},{Username:'b',FirstClockIn:'2026-10-28T07:00:00Z',LastClockOut:'2026-10-28T07:50:00Z',EarlyDepartureMinutes:10}], '2026-10-28T08:05:00Z');
  assert.equal(filterMeetingRows(rows,'Present').length,2);assert.equal(filterMeetingRows(rows,'Late').length,1);assert.equal(filterMeetingRows(rows,'Absent').length,1);assert.equal(filterMeetingRows(rows,'Early departure')[0].Username,'b');assert.equal(filterMeetingRows(rows,'Missing check-out')[0].Username,'a');assert.equal(filterMeetingRows(rows,'','Chidi','Teaching')[0].Username,'c');
  const print=meetingPrintDocument({meeting,Date:'2026-10-28',LoadedAt:'2026-10-28T08:05:00Z'},rows,'<School>','All');assert.ok(print.includes('&lt;School&gt;'));assert.ok(print.includes('Ada'));assert.ok(!print.includes('<script'));
});
test('proof scope rejects a daily clock, another meeting or another date',async()=>{
  const secretEnv={STAFF_SESSION_SECRET:'meeting-proof-secret-abcdefghijklmnopqrstuvwxyz'};
  const scope={siteId:meetingProofSiteId('main',id,'2026-10-28'),direction:'IN'};
  const token=await createStaffAttendanceProof(secretEnv,{username:'teacher'},{...scope,method:'passkey'});
  assert.ok(await readStaffAttendanceProof(secretEnv,token,'teacher',scope));
  for(const siteId of ['ordinary-work-site',meetingProofSiteId('primary',id,'2026-10-28'),meetingProofSiteId('main',id,'2026-10-29')])assert.equal(await readStaffAttendanceProof(secretEnv,token,'teacher',{...scope,siteId}),null);
  assert.equal(await readStaffAttendanceProof(secretEnv,token,'teacher',{...scope,direction:'OUT'}),null);
});

for(const [edition,role] of [['faith','Pastor'],['organization','Operations Manager']])test(`${edition} meetings isolate departments and grant equivalent management access`,async()=>{
  const f=fixture(),actor={...admin,edition,role,allowedSections:['services']},runtime={...env,ORGANISATION_EDITION:edition};
  f.directory.splice(0,f.directory.length,{Username:'worker',DisplayName:'Invited Worker',Role:'Department User',Department:'Teaching',BranchId:'main',Edition:edition},{Username:'school-staff',Department:'Teaching',BranchId:'main',Edition:'school'});
  const call=(action,body,user=actor)=>handleStaffMeetings(runtime,user,{action,BranchId:'main',...body},{},f.io);
  assert.equal(canManageStaffMeetings(actor),true);const saved=await call('save',form);assert.equal(saved.meeting.ExpectedCount,1);
  assert.ok([...f.docs.keys()].every(path=>path.startsWith('organisationBranches/main/')));
  assert.equal((await call('list',{Date:'2026-10-28'},{...actor,username:'worker',role:'Department User',allowedSections:[]})).meetings.length,1);
  await assert.rejects(call('setup',{}, {...actor,role:'Department User'}),/Meeting management/);
});
test('hospital administrators and Medical Director can manage meetings without clinical access expansion',()=>{
  for(const role of ['Super Admin','Hospital Administrator','Medical Director'])assert.equal(canManageStaffMeetings({...admin,edition:'hospital',role,allowedSections:['hospitalReception']}),true);
  assert.equal(canManageStaffMeetings({...admin,edition:'hospital',role:'Doctor',allowedSections:['hospitalReception']}),false);
});


test('invalid GPS accuracy cannot validate meeting attendance and late retries preserve first stamps',async()=>{
  const f=fixture();await f.save();f.setTime('2026-10-28T07:00:00Z');
  await assert.rejects(f.clock('IN',{}, {Location:{Latitude:9.1,Longitude:7.2,Accuracy:-1}}),/approved location/);
  await f.clock();const count=f.commits.length;f.setTime('2026-10-29T12:00:00Z');
  const replay=await f.clock();assert.equal(replay.attendance.FirstClockIn,'2026-10-28T07:00:00Z');assert.equal(f.commits.length,count);
});
