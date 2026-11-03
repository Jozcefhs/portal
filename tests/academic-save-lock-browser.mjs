import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {fixture,source,extractFunction,renderWorkspace} from './helpers/academic-register-fixture.mjs';
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:'chrome',headless:true});
const css=await readFile(new URL('../css/style.css',import.meta.url),'utf8');
const input=fixture();
input.data.assessmentScheme.Components=[{Id:'ca1',Name:'CA1',MaximumScore:100,WeightPercentage:20,SourceMode:'any',Required:true},{Id:'exam',Name:'Exam',MaximumScore:100,WeightPercentage:80,SourceMode:'any',Required:true}];
input.data.scorebookContext.MidTerm={Enabled:true,ComponentIds:['ca1']};
input.rows.scoreSheets=[{...input.data.scorebookContext,SheetId:'sheet',Status:'Draft',RevisionToken:'sheet-v1'}];
input.rows.studentScores=[{ScoreId:'score',SheetId:'sheet',StudentRef:'TEST/1',ComponentScores:[{ComponentId:'ca1',State:'Numeric',RawScore:50}],LockedScoreCellIds:[],RevisionToken:'score-v1'}];
const functions=['academicRecordId','academicIsActive','academicFind','academicLabel','academicSelectOptions','academicScoreStateOptions','academicCbtUploadStatus','academicScoreActionState','academicScorebookWorkspace','academicScorebookRowPayload','updateAcademicScorebookRow','academicScoreSheetRequestPayload'].map(extractFunction).join('\n');
const start=source.indexOf("  scorebookForm?.querySelectorAll('[data-academic-score-student]')");
const binding=source.slice(start,source.indexOf("  panelEl.querySelector('[data-academic-batch-review]')",start));
const checks=[];
try {
  for(const width of [1366,390]){
    const page=await browser.newPage({viewport:{width,height:950}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
    await page.setContent(`<style>${css.replace(/@import[^;]+;/g,'')}main{padding:16px;min-width:0}.academic-management-editor{max-width:100%;box-sizing:border-box}</style><body class="staff-page"><main><div id="academicManagementStatus"></div><section id="panel">${renderWorkspace('scorebook',input)}</section></main></body>`);
    await page.addScriptTag({content:`
      const panelEl=document.querySelector('#panel');
      let academicManagementData=${JSON.stringify({...input.data,...input.rows})};
      let academicManagementFilters={sessionId:'session',termId:'term',section:'secondary'},academicScorebookDraft={};
      const clean=v=>String(v??'').trim(),escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const table=()=>'';window.requests=[];
      const setStatus=(el,message)=>el.textContent=message;
      const runButtonAction=async(button,label,action)=>{button.disabled=true;try{return await action();}finally{if(button.isConnected)button.disabled=false;}};
      ${functions}
      function bind(){const scorebookForm=panelEl.querySelector('[data-academic-scorebook]');${binding}}
      function renderAcademicManagement(data,message){academicManagementData=data;panelEl.innerHTML=academicScorebookWorkspace(data,data);bind();if(message)setStatus(document.querySelector('#academicManagementStatus'),message);}
      async function academicManagementRequest(action,payload){
        requests.push({action,payload});const data=structuredClone(academicManagementData),score=data.studentScores[0];
        if(action==='saveAcademicScoreDraft'){score.ComponentScores=payload.Rows.find(row=>row.StudentRef==='TEST/1').ComponentScores;score.RevisionToken='score-v2';}
        if(action==='lockAcademicRecordedScores')score.LockedScoreCellIds=['ca1'];
        if(action==='submitAcademicMidTermScores')data.scoreSheets[0].ComponentReviews={ca1:{Status:'Submitted'}};
        data.scoreSheets[0].RevisionToken='sheet-v'+(requests.length+1);data.message='Completed '+action;return data;
      }
      bind();
    `});
    const form=page.locator('[data-academic-scorebook]');
    assert.equal(await form.getByRole('button',{name:'Lock recorded scores',exact:true}).isEnabled(),true);
    assert.equal(await form.getByRole('button',{name:'Submit mid-term scores',exact:true}).isDisabled(),true);
    const mark=form.locator('[data-academic-score-student="TEST/1"] [data-academic-score-component="ca1"] input');
    await mark.fill('65');
    assert.equal(await form.getByRole('button',{name:'Lock recorded scores',exact:true}).isDisabled(),true);
    assert.match(await form.locator('[data-score-action-hint]').innerText(),/Unsaved changes/);
    await form.getByRole('button',{name:'Save scores',exact:true}).click();
    assert.equal(await mark.isEnabled(),true,'save keeps the mark editable');
    assert.equal(await form.getByRole('button',{name:'Submit mid-term scores',exact:true}).isDisabled(),true);
    await form.getByRole('button',{name:'Lock recorded scores',exact:true}).click();
    assert.equal(await mark.isDisabled(),true);
    assert.equal(await form.getByRole('button',{name:'Submit mid-term scores',exact:true}).isEnabled(),true);
    await form.getByRole('button',{name:'Submit mid-term scores',exact:true}).click();
    const requests=await page.evaluate(()=>window.requests);
    assert.deepEqual(requests.map(row=>row.action),['saveAcademicScoreDraft','lockAcademicRecordedScores','submitAcademicMidTermScores']);
    assert.equal(requests[0].payload.Rows.find(row=>row.StudentRef==='TEST/1').ComponentScores[0].RawScore,'65');
    assert.equal(requests[1].payload.RevisionToken,'sheet-v2');assert.equal(requests[2].payload.RevisionToken,'sheet-v3');
    assert.deepEqual(errors,[]);
    const clipped=await form.locator('.academic-scorebook-actions button').evaluateAll(buttons=>buttons.some(button=>{const r=button.getBoundingClientRect();return r.left<0||r.right>innerWidth+1;}));
    assert.equal(clipped,false,'action buttons fit the viewport');
    await form.locator('.academic-scorebook-actions').scrollIntoViewIfNeeded();
    await page.screenshot({path:`tmp/save-lock-${width}.png`,fullPage:true});
    checks.push({width,saveEditable:true,lockRequired:true,midTermSubmitted:true,buttonsClipped:false});await page.close();
  }
  await writeFile('tmp/save-lock-browser-proof.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));
}finally{await browser.close();}
