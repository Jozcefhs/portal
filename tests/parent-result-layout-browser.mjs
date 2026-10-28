import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const playwright=await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser=await playwright.chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true});
const extract=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
try {
  const [template,admin,parent,previewCss,tableCss]=await Promise.all([
    'js/academic-result-template.js','js/admin.js','js/parent-dashboard.js','css/academic-result-preview.css','css/parent-academic-results.css'
  ].map(read));
  const context=await browser.newContext({viewport:{width:1100,height:900}});
  const page=await context.newPage();const errors=[];
  context.on('page',tab=>tab.on('pageerror',error=>errors.push(error.message)));
  page.on('pageerror',error=>errors.push(error.message));
  const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7v0AAAAASUVORK5CYII=','base64');
  await context.route('**/*',route=>new URL(route.request().url()).pathname==='/'
    ? route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body></body></html>'})
    : route.fulfill({status:200,contentType:'image/png',body:pixel}));
  await page.goto('https://school.example/');
  await page.setContent(`<style>${previewCss}</style><button id="parentPrint">Print result</button><p id="status"></p><section id="exceptions"></section>`,{waitUntil:'domcontentloaded'});
  await page.addScriptTag({content:template});
  await page.evaluate(()=>{
    window.clean=value=>String(value??'').trim();
    window.escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.academicManagementData={reportProfile:{SchoolName:'Destiny Christian Academy',SchoolAddress:"The Lord’s Garden Airport Road Lugbe, Abuja",SchoolPhone:'+234 123 456 7890',SchoolEmail:'admin@example.com',ResultSignatoryName:'Authorised Officer'}};
    const renderer=window.DynamaxAcademicResultTemplate;
    window.DynamaxAcademicResultTemplate={...renderer,render(child,record,options){
      window.lastReport={child,record,options};return renderer.render(child,record,options);
    }};
  });
  await page.addScriptTag({content:extract(admin,'function printAcademicResultSample(','function academicAnalysisSelectOptions(')});
  const selectors=['.letterhead','.school h1','.passport','.title','.identity-table','.subject-table','.summary-table','.remarks-table'];
  const metrics=async frame=>frame.evaluate(selectors=>Object.fromEntries(selectors.map(selector=>{
    const node=document.querySelector(selector),rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    return [selector,{x:rect.x,y:rect.y,width:rect.width,height:rect.height,color:style.color,font:style.fontSize}];
  })),selectors);
  for (const stage of ['nursery','primary','secondary']) {
    await page.evaluate(stage=>printAcademicResultSample(stage),stage);
    const frame=await (await page.locator('#academicResultSampleDialog[open] iframe').elementHandle()).contentFrame();
    await frame.waitForSelector('.subject-table');
    const reference=await metrics(frame);
    const fixture=await page.evaluate(()=>window.lastReport);
    const report=await context.newPage();
    const viewport=await frame.evaluate(()=>({width:innerWidth,height:innerHeight}));
    await report.setViewportSize(viewport);
    await report.setContent(await page.evaluate(({child,record,options})=>DynamaxAcademicResultTemplate.render(child,record,{...options,sampleLabel:''}),fixture));
    assert.deepEqual(await metrics(report),reference,`${stage}: parent and sample geometry must match exactly`);
    assert.equal(await report.locator('.subject-table th').count(),7);
    assert.equal(await report.locator('.sample').count(),0);
    assert.equal(await report.locator('.subject-table th').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(22, 74, 120)');
    assert.equal(await report.locator('.identity-table tbody tr').count(),3);
    assert.match(await report.locator('.identity-table').innerText(),/DATE OF BIRTH/);
    assert.match(await report.locator('.identity-table').innerText(),/26 Oct 2026/);
    assert.doesNotMatch(await report.locator('.subject-table').innerText(),/WEIGHTED/);
    if(stage==='secondary') {
      await report.screenshot({path:'tmp/parent-result-matched-layout.png',fullPage:true});
      fixture.record.Subjects[0].SubjectName='Computer Hardware and GSM Repairs';
      fixture.record.Subjects[1].SubjectName='Physical and Health Education';
      fixture.record.ResultType='Mid-Term';
      fixture.record.NotTaughtSubjects=[{SubjectName:'Electrical Installation and Maintenance',Reason:'Staff-only reason'}];
      for (const width of [1100,703,390]) {
        await report.setViewportSize({width,height:950});
        await report.emulateMedia({media:width===703?'print':'screen'});
        await report.setContent(await page.evaluate(({child,record,options})=>DynamaxAcademicResultTemplate.render(child,record,{...options,sampleLabel:''}),fixture));
        const result=await report.locator('.subject-table').evaluate(table=>{
          const cells=[...table.querySelectorAll('tbody td:first-child')];
          return {tableWidth:table.getBoundingClientRect().width,reportWidth:document.querySelector('.report').clientWidth,
            columns:cells.map(cell=>{const range=document.createRange();range.selectNodeContents(cell);return {nowrap:getComputedStyle(cell).whiteSpace,lines:range.getClientRects().length,contentWidth:range.getBoundingClientRect().width,width:cell.clientWidth};}),
            printColor:getComputedStyle(document.body).printColorAdjust};
        });
        assert.ok(result.tableWidth<=result.reportWidth,JSON.stringify(result));
        for (const cell of result.columns) {assert.equal(cell.nowrap,'nowrap');assert.equal(cell.lines,1);assert.ok(cell.contentWidth+12<=cell.width+1,JSON.stringify(cell));}
        if(width===703)assert.equal(result.printColor,'exact');
        assert.match(await report.locator('.subject-table').innerText(),/Not taught this mid-term/);
        await report.screenshot({path:`tmp/parent-result-subjects-${width}.png`,fullPage:true});
      }
      await page.evaluate(fixture=>{window.parentFixture=fixture;},fixture);
    }
    await report.close();
    await page.getByRole('button',{name:'Close preview'}).click();
  }
  // Exercise the actual parent action: one access recheck, server-returned marks,
  // images settled before print, and no report when permission is denied.
  await page.addScriptTag({content:extract(parent,'async function parentResultRequest(','async function refreshParentAcademicResults(')
    +extract(parent,'function academicResultPrintMarkup(','function renderAcademicResults(')});
  await page.evaluate(()=>{
    window.authPayload=()=>({email:'parent@example.com'});window.freshBody=value=>JSON.stringify(value);
    window.setActionLoading=(button,loading)=>{button.disabled=loading;};
    window.setStatus=message=>{document.querySelector('#status').textContent=message;};
    window.academicResultPassportDataUrl=async()=>'';
    // Inline fixture images keep popup printing deterministic; QR URL generation
    // is checked separately above and does not require a real public endpoint.
    const fixtureImage='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const reportRenderer=window.DynamaxAcademicResultTemplate.render;
    window.DynamaxAcademicResultTemplate={...window.DynamaxAcademicResultTemplate,render(...args){
      return reportRenderer(...args).replace(/src="https:\/\/school\.example\/api\/academic-result-qr\?[^"]+"/g,`src="${fixtureImage}"`);
    }};
    window.parentFixture.options.profile.DocumentLogoUrl=fixtureImage;
    window.parentFixture.options.profile.DocumentStampUrl=fixtureImage;
    window.requests=[];window.denied=false;
    window.fetch=async(url,options)=>{
      window.requests.push(JSON.parse(options.body));
      return {ok:!window.denied,json:async()=>window.denied?{ok:false,message:'Result access withdrawn'}:
        {ok:true,academicResult:{...window.parentFixture.record,Access:{Allowed:true},OverallAverage:79},reportProfile:window.parentFixture.options.profile}};
    };
    const open=window.open.bind(window);
    window.open=(...args)=>{const popup=open(...args);popup.print=()=>{
      popup.document.body.dataset.printed='yes';popup.document.body.dataset.imagesSettled=String([...popup.document.images].every(image=>image.complete));
    };return popup;};
    document.querySelector('#parentPrint').onclick=event=>printAcademicResult(window.parentFixture.child,{ResultId:'chosen-result',OverallAverage:1},event.target);
  });
  const popupPromise=page.waitForEvent('popup');await page.locator('#parentPrint').click();const popup=await popupPromise;
  await popup.waitForSelector('body[data-printed=yes]');
  assert.match(await popup.locator('.summary-table').innerText(),/79.0%/);
  assert.equal(await popup.locator('body').getAttribute('data-images-settled'),'true',JSON.stringify(await popup.evaluate(()=>({url:location.href,state:document.readyState,images:[...document.images].map(image=>({src:image.src,complete:image.complete,width:image.naturalWidth}))}))));
  assert.equal(await page.evaluate(()=>requests.length),1);
  assert.equal(await page.evaluate(()=>requests[0].action),'getAcademicResultForPrint');
  await popup.close();
  await page.evaluate(()=>{window.denied=true;});
  await page.locator('#parentPrint').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Result access withdrawn');
  await page.waitForFunction(()=>!document.querySelector('#parentPrint').disabled);
  // Class-scoped checkbox choices retain saved reasons when the results reload.
  await page.addScriptTag({content:extract(admin,'function academicMidTermNotTaughtMarkup(','function academicTermResultsWorkspace(')});
  await page.evaluate(()=>{
    window.academicIsActive=row=>row.Status==='Active';
    const rows={subjects:[{SubjectId:'trade',Name:'Computer Hardware and GSM Repairs'},{SubjectId:'other',Name:'Other classroom subject'}],studentMemberships:[
      {ClassId:'grade10',ArmId:'brilliance',Status:'Active',SubjectIds:['trade']},
      {ClassId:'grade11',ArmId:'merit',Status:'Active',SubjectIds:['other']}
    ]};
    document.querySelector('#exceptions').innerHTML='<form>'+academicMidTermNotTaughtMarkup(rows,{ClassId:'grade10',ArmId:'brilliance'},[{NotTaughtSubjects:[{SubjectId:'trade',Reason:'Lessons have not started.'}]}])+'</form>';
  });
  assert.equal(await page.locator('input[name=NotTaughtSubjectIds]').count(),1);
  assert.equal(await page.getByLabel('Computer Hardware and GSM Repairs',{exact:true}).isChecked(),true);
  assert.equal(await page.locator('textarea[name=NotTaughtReason]').inputValue(),'Lessons have not started.');
  await page.getByLabel('Computer Hardware and GSM Repairs',{exact:true}).uncheck();
  assert.deepEqual(await page.locator('#exceptions form').evaluate(form=>new FormData(form).getAll('NotTaughtSubjectIds')),[]);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'tmp/midterm-not-taught-controls.png',fullPage:true});
  // Inline parent tables keep the same no-wrap subject rule.
  await page.addStyleTag({content:tableCss});
  await page.evaluate(()=>{const div=document.createElement('div');div.className='academic-result-subject-table';div.innerHTML=DynamaxAcademicResultTemplate.weightedMarkup(parentFixture.record);document.body.appendChild(div);});
  assert.equal(await page.locator('.academic-result-subject-table td').first().evaluate(node=>getComputedStyle(node).whiteSpace),'nowrap');
  assert.deepEqual(errors,[]);
  console.log('PASS: exact sample/parent layout parity for all stages; unwrapped subjects at desktop, mobile and A4 print widths; parent access recheck; mid-term subject checkboxes and retained reasons.');
} finally {await browser.close();}
