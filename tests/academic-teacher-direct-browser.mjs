import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {allocationUiFixture} from './academic-teacher-allocation.test.mjs';
import {fixture,renderWorkspace,extractFunction} from './helpers/academic-register-fixture.mjs';
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:'chrome',headless:true});
const css=(await Promise.all(['style.css','academic-class-score-register.css'].map(file=>readFile(new URL(`../css/${file}`,import.meta.url),'utf8')))).join('\n').replace(/@import[^;]+;/g,'');
const registerFunctions=['academicRecordId','academicFind','academicLabel','academicClassRegisterView','academicClassRegisterTable','academicClassRegisterPrintHtml','bindAcademicClassRegisterSubjectDismissal','createAcademicClassRegisterCache','bindAcademicClassScoreRegister'].map(extractFunction).join('\n');
const ownFunctions=['academicRecordLoadForm','applyAcademicTeacherClassroomControls'].map(extractFunction).join('\n');
const checks=[];
try{
  for(const role of ['Form Teacher','Assistant Teacher'])for(const width of [1366,390]){
    const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.abort());
    const f=allocationUiFixture(role);
    f.data.classes=f.data.classes.filter(row=>row.ClassId==='class');f.data.arms=f.data.arms.filter(row=>row.ArmId==='arm');
    f.data.teacherWorkspace={BranchId:'garden',SchoolSection:'primary',SessionId:'session',TermId:'term',ClassId:'class',ArmId:'arm',Classrooms:[{ClassId:'class',ArmId:'arm',ClassName:'Grade 1',Name:'Excellence'}]};
    const allocation=f.context.academicStudentWorkspace(f.data,f.data);
    await page.setContent(`<style>${css}main{padding:16px;min-width:0}</style><body class="staff-page"><main id="panel">${allocation}</main></body>`);
    await page.addScriptTag({content:`
      const panelEl=document.querySelector('#panel'),clean=v=>String(v??'').trim(),escapeHtml=v=>String(v??'');
      let academicManagementView='students',academicManagementData=${JSON.stringify(f.data)},academicStudentAllocationDraft={};
      const academicManagementTaskViews={scorebook:'classRegister'},academicManagementFilters={section:'primary',sessionId:'session',termId:'term'};
      ${f.scripts}
      ${ownFunctions}
      panelEl.insertAdjacentHTML('afterbegin',academicRecordLoadForm(academicManagementData,'Pupils'));
      const allocationForm=panelEl.querySelector('[data-academic-student-placement]');
      syncAcademicStudentPlacementForm(allocationForm);applyAcademicTeacherClassroomControls(academicManagementData);
      allocationForm.addEventListener('submit',event=>{event.preventDefault();window.submitted=Object.fromEntries(new FormData(allocationForm));});
    `});
    const allocationForm=page.locator('[data-academic-student-placement]');
    for(const name of ['ClassId','ArmId'])assert.equal(await allocationForm.locator(`[name="${name}"]`).isVisible(),false);
    assert.equal(await page.locator('[data-academic-own-classroom] select').count(),0);
    await allocationForm.locator('[name="StudentRefs"]').check();
    await allocationForm.getByRole('button',{name:'Allocate selected pupils'}).click();
    assert.deepEqual(await page.evaluate(()=>({student:submitted.StudentRefs,arm:submitted.ArmId,classId:submitted.ClassId})),{student:'P1',arm:'arm',classId:'class'});

    const input=fixture();input.data.permissions.canViewClassroomScores=true;input.data.teacherWorkspace=f.data.teacherWorkspace;
    input.rows.classes[0].Name='Grade 1';input.rows.arms[0].Name='Excellence';
    input.rows.teacherAllocations.push({SessionId:'session',TermId:'term',ClassId:'class',ArmId:'arm',AllocationRole:role});
    const register=renderWorkspace('scorebook',input).match(/<form[^>]*data-classroom-register[^>]*>[\s\S]*?<\/form>/)[0];
    await page.evaluate(html=>{academicManagementView='scorebook';panelEl.innerHTML=academicRecordLoadForm(academicManagementData,'Scorebook')+html;},register);
    await page.addScriptTag({content:`
      window.requests=[];
      async function academicManagementRequest(action,payload){requests.push({action,payload});return {classScoreRegister:{ClassId:'class',ArmId:'arm',ClassName:'Grade 1',ClassroomName:'Grade 1 / Excellence',SessionId:'session',TermId:'term',StudentCount:1,SubjectCount:1,
        Columns:[{Id:'math-ca1',SubjectId:'math',SubjectName:'Mathematics',TestId:'ca1',TestName:'CA1'}],
        Rows:[{StudentRef:'TEST/1',StudentName:'Sample Learner',ArmName:'Excellence',Cells:[{ColumnId:'math-ca1',State:'Numeric',RawScore:85,MaximumScore:100}]}]}};}
      ${registerFunctions}
      bindAcademicClassScoreRegister(panelEl.querySelector('[data-academic-class-score-register]'));
      applyAcademicTeacherClassroomControls(academicManagementData);
    `});
    await page.waitForSelector('tbody tr');
    assert.equal(await page.locator('[data-academic-class-score-register] [name="ClassId"]').isVisible(),false);
    assert.equal(await page.evaluate(()=>requests.length),1);
    assert.deepEqual(await page.evaluate(()=>requests[0]),{action:'getAcademicClassroomScoreRegister',payload:{SchoolSection:'primary',SessionId:'session',TermId:'term',ClassId:'class',ArmId:'arm'}});
    await page.evaluate(()=>applyAcademicTeacherClassroomControls(academicManagementData));
    assert.equal(await page.evaluate(()=>requests.length),1,'rebinding must not reload the scores');
    assert.equal(await page.locator('[data-academic-class-score-register] [data-assigned-classroom-name]').count(),1);
    await page.selectOption('[name="ScoreFilter"]','scored-any');
    assert.equal(await page.evaluate(()=>requests.length),1,'filtering must not fetch scores');
    const [preview]=await Promise.all([page.waitForEvent('popup'),page.locator('[data-class-register-print]').click()]);
    await preview.waitForLoadState('domcontentloaded');assert.match(await preview.locator('body').innerText(),/Sample Learner/);await preview.close();
    assert.equal(await page.evaluate(()=>requests.length),1,'preview must not fetch scores');
    await page.locator('[data-class-register-reload]').click();
    await page.waitForFunction(()=>requests.length===2&&!document.querySelector('[data-class-register-reload]').disabled);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
    assert.deepEqual(errors,[]);
    await page.screenshot({path:`tmp/teacher-direct-${role.replaceAll(' ','-')}-${width}.png`,fullPage:true});
    checks.push({role,width,automaticOwnClassroom:true,allocationPayloadPreserved:true,oneInitialScoreRead:true,previewNoReads:true});
    await page.close();
  }
  await writeFile('tmp/teacher-direct-browser-proof.json',JSON.stringify(checks,null,2));
  console.log(JSON.stringify(checks));
}finally{await browser.close();}
