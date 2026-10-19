import { chromium } from 'file:///C:/Users/DYNAMAX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = await readFile('js/parent-dashboard.js', 'utf8');
const admin = await readFile('js/admin.js', 'utf8');
const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const extract = (source,start,end) => source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const ctx = vm.createContext({ escapeHtml:esc, clean:value=>String(value??'').trim(), childInitials:()=> 'SL', window:{}, location:{origin:'https://example.test'} });
vm.runInContext(extract(source,'function academicResultComponentColumns(','function renderLibraryLoans(')
  + extract(source,'function academicResultCriteriaMarkup(','function fileAsDataUrl(')
  + extract(source,'function academicResultPrintMarkup(','async function printAcademicResult('),ctx);
const record = { Status:'Published', ResultType:'End of Term', StudentName:'Sample Learner', StudentRef:'SAMPLE/001', ClassName:'Grade 7', ArmName:'Excellence',
  AcademicSession:'2026/2027', Term:'First Term', ResultReference:'SAMPLE-001', OverallAverage:80.5, OverallGrade:'A', Attendance:{AttendancePercentage:96},
  TeacherRemark:'Excellent progress.', PrincipalRemark:'Continue your good work.', PolicySnapshot:{},
  Subjects:['Mathematics','English Language','Basic Science','Computer Studies','History','Civic Education','French','Cultural and Creative Arts'].map(SubjectName=>({SubjectName,Total:80.5,Grade:'A',GradePoint:5,Remark:'Excellent',
    WeightedComponents:[['CA1',8.5,10],['CA2',7,10],['CA3',9,10],['Exam',56,70]].map(([Name,WeightedMark,MaximumMark])=>({ComponentId:Name,Name,State:'Numeric',WeightedMark,MaximumMark}))})) };
const parentHtml = ctx.academicResultPrintMarkup({DisplayName:'Sample Learner',AccountRef:'SAMPLE/001'},record,{profile:{SchoolName:'Sample Academy'}});
const py = spawnSync('../suite/tmp/release-venv/Scripts/python.exe',['-c','import json,sys; from modules.academic_management import build_term_result_print_html; print(build_term_result_print_html(json.load(sys.stdin), "Sample Academy"))'],{cwd:'../suite',input:JSON.stringify(record),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
assert.equal(py.status,0,py.stderr);
await writeFile('tmp/weighted-parent-print.html',parentHtml);
await writeFile('tmp/weighted-desktop-print.html',py.stdout);
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
 const page = await browser.newPage({viewport:{width:794,height:1123}});
 await page.route('**/*',route=>route.abort());
 for(const [name,html] of [['parent',parentHtml],['desktop',py.stdout]]) {
   await page.setContent(html);
   await page.emulateMedia({media:'print'});
   assert.equal(await page.locator('table').first().count(),1);
   await page.screenshot({path:`tmp/weighted-${name}-print.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 }
 await page.emulateMedia({media:'screen'});
 const columns=record.Subjects.flatMap(subject=>subject.WeightedComponents.map(c=>({Id:subject.SubjectName+c.ComponentId,SubjectName:subject.SubjectName,TestId:c.ComponentId,TestName:c.Name})));
 const report={ClassName:'Grade 7',StudentCount:61,SubjectCount:8,Columns:columns,Rows:Array.from({length:61},(_,i)=>({StudentName:`Learner ${String(i).padStart(2,'0')}`,StudentRef:`SAMPLE/${i}`,ArmName:i%2?'Brilliance':'Excellence',Cells:columns.map(c=>({ColumnId:c.Id,State:'Numeric',RawScore:85,MaximumScore:100,SheetStatus:'Draft'}))}))};
 const binding=extract(admin,'function bindAcademicClassScoreRegister(','function academicWeightedResultMarkup(');
 for(const width of [390,1280]) {
   await page.setViewportSize({width,height:850});
   await page.setContent(`<style>body{font:14px Arial;margin:16px}form{max-width:100%}table{border-collapse:collapse}th,td{padding:8px;border:1px solid #ccc;white-space:nowrap}select,input,button{padding:10px;margin:4px}</style><form data-academic-class-score-register><h2>Class score register — all arms</h2><select name="ClassId"><option value="grade7">Grade 7</option></select><select name="TestId"><option value="">All tests</option></select><input name="Query" placeholder="Find student"><button type="submit">Load class scores</button><p data-class-register-status></p><div data-class-register-table style="max-width:100%;overflow:auto"></div><button type="button" data-class-register-page="-1">Previous</button><span data-class-register-count></span><button type="button" data-class-register-page="1">Next</button></form>`);
   await page.evaluate(({binding,report})=>{
     window.clean=v=>String(v??'').trim(); window.escapeHtml=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
     window.academicManagementFilters={section:'secondary',sessionId:'s1',termId:'t1'};
     window.academicManagementRequest=async(action,input)=>{if(action!=='getAcademicClassScoreRegister'||input.ClassId!=='grade7')throw Error('Incorrect class request');return {classScoreRegister:report};};
     (0,eval)(binding); bindAcademicClassScoreRegister(document.querySelector('form'));
   },{binding,report});
   await page.click('button[type=submit]');
   await page.waitForSelector('tbody tr');
   assert.equal(await page.locator('tbody tr').count(),25);
   await page.selectOption('select[name=TestId]','CA1');
   assert.equal(await page.locator('thead th').count(),11);
   await page.click('[data-class-register-page="1"]');
   assert.match(await page.locator('[data-class-register-count]').textContent(),/26–50 of 61/);
   await page.fill('input[name=Query]','SAMPLE/60');
   assert.equal(await page.locator('tbody tr').count(),1);
   await page.fill('input[name=Query]','');
   await page.screenshot({path:`tmp/class-score-register-${width}.png`,fullPage:true});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.locator('[data-class-register-table]').evaluate(el=>el.scrollLeft=el.scrollWidth);
   assert.ok(await page.locator('[data-class-register-table]').evaluate(el=>el.scrollLeft>0));
 }
 console.log('PASS: parent/desktop print layouts; mobile/desktop class register, filtering, pagination and horizontal scroll.');
} finally { await browser.close(); }
