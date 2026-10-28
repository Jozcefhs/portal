import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:'msedge',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date('2026-10-28T07:15:00Z')});
  await page.route('**/*',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body><button id="open">Staff meetings</button><script type="module">import {openStaffMeetings} from "/js/staff-meetings.js"; window.openStaffMeetings=openStaffMeetings;</script></body></html>'});
    if(['/js/staff-meetings.js','/css/staff-meetings.css'].includes(path))return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':'text/css',body:await read(path.slice(1))});
    return route.fulfill({status:404,body:''});
  });
  await page.goto('https://meetings.test/');await page.waitForFunction(()=>Boolean(window.openStaffMeetings));
  await page.evaluate(()=>{
    window.calls=[];window.proofs=[];window.saved=null;window.manager=true;
    const meeting={MeetingId:'11111111-1111-4111-8111-111111111111',Title:'Morning briefing',Type:'Daily',StartTime:'08:00',EndTime:'09:00',TimeZone:'Africa/Lagos',Site:{Name:'Meeting hall',Policy:'GEOFENCE_ONLY'},ExpectedCount:4,Invited:true,attendance:{},OpenMinutes:30,CheckoutMinutes:120,ProofSiteId:'meeting:main:test:2026-10-28',Schedule:{StartAt:'2026-10-28T07:00:00Z',EndAt:'2026-10-28T08:00:00Z'}};
    const rows=[{Username:'ada',DisplayName:'Ada Teacher',Department:'Teaching',Status:'Late',FirstClockIn:'2026-10-28T07:10:00Z',LateMinutes:10,AttendanceState:'Checked in'}, {Username:'bola',DisplayName:'Bola Admin',Department:'Administration',Status:'Present',FirstClockIn:'2026-10-28T07:00:00Z',LastClockOut:'2026-10-28T08:00:00Z',AttendanceState:'Completed'}, {Username:'chidi',DisplayName:'Chidi Teacher',Department:'Teaching',Status:'Absent',AttendanceState:'Not checked in'}, {Username:'dora',DisplayName:'Dora Teacher',Department:'Teaching',Status:'Pending',AttendanceState:'Not checked in'}];
    window.request=async(action,payload,key)=>{calls.push({action,payload,key});if(action==='bootstrap')return {Date:'2026-10-28',TimeZone:'Africa/Lagos',canManage:manager,policy:{IdentityVerification:'PASSKEY'}};
      if(action==='setup')return {Revision:'r1',departments:[{Id:'teaching',Name:'Teaching',Count:3},{Id:'administration',Name:'Administration',Count:1}]};
      if(action==='save'){saved=payload;return {message:'Meeting saved.'};}
      if(action==='list')return {policy:{IdentityVerification:'PASSKEY'},meetings:[structuredClone(meeting)]};
      if(action==='report')return {meeting:structuredClone(meeting),rows,Date:'2026-10-28',LoadedAt:'2026-10-28T08:05:00Z'};
      if(action==='clock'){meeting.attendance={FirstClockIn:'2026-10-28T07:15:00Z',...(payload.Direction==='OUT'?{LastClockOut:'2026-10-28T07:30:00Z'}:{})};return {attendance:meeting.attendance,message:'Meeting attendance recorded.'};}
      throw Error('Unexpected action '+action);
    };
    window.show=()=>openStaffMeetings({request,cacheKey:manager?'manager':'staff',schoolName:'Synthetic Organisation',branchName:'Main branch',position:async()=>({Latitude:9.1,Longitude:7.2}),verify:async(policy,site,direction)=>{proofs.push({policy,site,direction});return {location:{Latitude:9.1,Longitude:7.2,Accuracy:10},attendanceProof:'signed-proof'};}});
    document.querySelector('#open').onclick=show;
  });
  await page.getByRole('button',{name:'Staff meetings',exact:true}).click();await page.locator('[data-new]').waitFor();
  assert.deepEqual(await page.evaluate(()=>calls.map(row=>row.action)),['bootstrap']);
  await page.getByRole('button',{name:'Create meeting'}).click();await page.locator('[data-editor]').waitFor();
  await page.getByLabel('Meeting title',{exact:true}).fill('Department briefing');await page.getByLabel('Meeting type').selectOption('Daily');
  await page.getByRole('button',{name:'Include all'}).click();assert.equal(await page.locator('[name="Departments"]:checked').count(),2);
  await page.locator('[name="Departments"][value="administration"]').uncheck();
  await page.getByLabel('Location name').fill('Meeting hall');await page.getByRole('button',{name:'Use my GPS location'}).click();
  await page.waitForFunction(()=>document.querySelector('[name="Latitude"]').value==='9.1');
  await page.getByRole('button',{name:'Save meeting',exact:true}).click();await page.locator('[data-new]').waitFor();
  assert.deepEqual(await page.evaluate(()=>saved.Departments),['teaching']);assert.equal(await page.evaluate(()=>saved.Site.Latitude),'9.1');
  assert.equal(await page.evaluate(()=>calls.filter(row=>row.action==='list').length),0);
  await page.getByRole('button',{name:'Load meetings',exact:true}).click();await page.locator('[data-report]').waitFor();
  await page.getByRole('button',{name:'Check in',exact:true}).click();await page.waitForFunction(()=>proofs.length===1&&document.querySelector('[data-status]').textContent.includes('recorded'));
  assert.equal(await page.evaluate(()=>proofs[0].site),'meeting:main:test:2026-10-28');assert.equal(await page.locator('[data-in]').isDisabled(),true);
  await page.getByRole('button',{name:'Attendance register'}).click();await page.locator('[data-filter]').waitFor();
  await page.getByLabel('Attendance filter').selectOption('Absent');assert.match(await page.locator('[data-table]').textContent(),/Chidi Teacher/);assert.ok(!(await page.locator('[data-table]').textContent()).includes('Ada Teacher'));
  const reads=await page.evaluate(()=>calls.length);
  await page.getByRole('button',{name:'Preview / print'}).click();await page.locator('.staff-meeting-preview').waitFor();
  assert.match(await page.frameLocator('.staff-meeting-preview iframe').locator('body').textContent(),/Chidi Teacher/);assert.ok(!(await page.frameLocator('.staff-meeting-preview iframe').locator('body').textContent()).includes('Ada Teacher'));
  await page.getByRole('button',{name:'Close preview'}).click();assert.equal(await page.evaluate(()=>calls.length),reads);
  await mkdir(new URL('../tmp/meeting-browser/',import.meta.url),{recursive:true});
  for(const width of [1280,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:fileURLToPath(new URL(`../tmp/meeting-browser/register-${width}.png`,import.meta.url))});assert.ok(await page.locator('.staff-meetings').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Dialog should not overflow horizontally');}
  await page.getByRole('button',{name:'Back to meetings'}).click();await page.getByRole('button',{name:'Load meetings',exact:true}).click();assert.equal(await page.evaluate(()=>calls.length),reads);
  await page.getByLabel('Meeting date').fill('2026-10-29');await page.getByLabel('Meeting date').dispatchEvent('change');assert.equal(await page.evaluate(()=>calls.length),reads);
  await page.getByLabel('Meeting date').fill('2026-10-28');await page.getByLabel('Meeting date').dispatchEvent('change');await page.locator('[data-report]').waitFor();assert.equal(await page.evaluate(()=>calls.length),reads);
  await page.getByRole('button',{name:'Close meetings',exact:true}).click();
  await page.evaluate(()=>manager=false);await page.getByRole('button',{name:'Staff meetings',exact:true}).click();await page.locator('[data-load]').waitFor();assert.equal(await page.locator('[data-new]').count(),0);
  await page.getByRole('button',{name:'Load meetings',exact:true}).click();await page.locator('[data-out]').waitFor();assert.equal(await page.locator('[data-report]').count(),0);assert.equal(await page.locator('[data-edit]').count(),0);
  assert.deepEqual(errors,[]);console.log('Meeting browser checks passed: departments, GPS, clock proof, status filters, print preview, cached dates, roles, desktop and mobile.');
}finally{await browser.close();}
