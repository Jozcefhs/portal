// Local-only UI fixture using actual generator actions and in-memory sample data.
// Run: node scripts/preview-timetable-generator.mjs (http://127.0.0.1:8800)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timetableHarness } from '../tests/helpers/timetable-generator-harness.mjs';
import { normalizeAcademicTimetableDays, normalizeAcademicTimetablePeriods } from '../functions/lib/academic-timetable-attendance.js';
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const extract = (start, end) => admin.slice(admin.indexOf(start), admin.indexOf(end, admin.indexOf(start)));
const Days = normalizeAcademicTimetableDays('MON | Monday\nTUE | Tuesday\nWED | Wednesday\nTHU | Thursday\nFRI | Friday');
const Periods = normalizeAcademicTimetablePeriods('ALL | P1 | Period 1 | 08:00 | 08:40 | Lesson | 1\nALL | P2 | Period 2 | 08:40 | 09:20 | Lesson | 2\nALL | BRK | Break | 09:20 | 09:40 | Break | 3\nALL | P3 | Period 3 | 09:40 | 10:20 | Lesson | 4\nALL | P4 | Period 4 | 10:20 | 11:00 | Lesson | 5', Days);
const requirement = (ArmId, SubjectId, LatestLessonNumber = 0) => ({ ClassId: 'class', ArmId, SubjectId, PeriodsPerWeek: 5, MaxPeriodsPerDay: 1, LatestLessonNumber });
const version = { VersionId: 'source', RecordId: 'source', Name: 'First Term requirements', Status: 'Draft', SessionId: 'session', TermId: 'term', Days, Periods,
  GenerationRules: { Requirements: [requirement('a', 'math', 2), requirement('b', 'math', 2), requirement('a', 'english'), requirement('b', 'english')] }, __updateTime: 'original' };
const harness = timetableHarness({
  timetableVersions: [version], timetableEntries: [], timetableConstraints: [],
  classes: [{ ClassId: 'class', RecordId: 'class', Name: 'Grade 7' }],
  arms: ['a', 'b'].map((ArmId) => ({ ArmId, RecordId: ArmId, ClassId: 'class', Name: ArmId === 'a' ? 'Radiance' : 'Merit' })),
  subjects: [{ SubjectId: 'math', RecordId: 'math', Name: 'Mathematics' }, { SubjectId: 'english', RecordId: 'english', Name: 'English Language' }],
  staff: [{ Username: 'math', RecordId: 'math', DisplayName: 'Sample Mathematics Teacher' }, { Username: 'english', RecordId: 'english', DisplayName: 'Sample English Teacher' }],
  teacherAllocations: ['math', 'english'].map((SubjectId) => ({ SubjectId, ClassId: 'class', ArmId: '', TeacherUsername: SubjectId,
    AllocationRole: 'Subject Teacher', SessionId: 'session', TermId: 'term' }))
});
const publicData = () => Object.fromEntries(Object.entries(harness.state).map(([key, rows]) => [key, rows.map((row) => {
  const value = { ...row, RevisionToken: row.__updateTime || '' }; delete value.GenerationPlan; return value;
})]));
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Timetable generator — local sample</title><link rel="stylesheet" href="/style.css"><style>body{padding:14px;margin:0;background:#eef5fa}main{max-width:1100px;margin:auto}.fixture-title{color:#163f68;margin:5px 0 14px}.academic-management-editor{width:100%;box-sizing:border-box}</style></head><body><main><h2 class="fixture-title">Academic Management · Timetable generator</h2><p>Local sample data only — no live school records.</p><div id="panel"></div></main><script>
const clean = v => String(v ?? '').trim(), escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let academicManagementData = ${JSON.stringify({ ...publicData(), permissions: { canManageTimetables: true } })};
let academicManagementFilters = {section:'secondary',sessionId:'session',termId:'term'}, selectedBranchId='main', academicManagementView='timetable';
let academicTimetableDraft = {versionId:'source'}, academicManagementTaskViews={timetable:'generator'}, staffBrand=null;
const panelEl=document.getElementById('panel'), staffSessionAbortController=new AbortController();
function academicIsActive(row){return !['inactive','archived','closed'].includes(clean(row.Status).toLowerCase())}
function academicFind(rows,id){return (rows||[]).find(r=>[r.RecordId,r.VersionId,r.ArmId,r.ClassId,r.SubjectId,r.Username].includes(id))}
function academicLabel(rows,id,fallback='Not selected'){const r=academicFind(rows,id); return r?.Name||r?.DisplayName||fallback}
function academicSelectOptions(rows,selected='',label=r=>r.Name,placeholder='Choose'){return (placeholder?'<option value="">'+placeholder+'</option>':'')+rows.map(r=>{const id=r.RecordId||r.VersionId||r.ArmId||r.Username; return '<option value="'+escapeHtml(id)+'"'+(id===selected?' selected':'')+'>'+escapeHtml(label(r))+'</option>'}).join('')}
${extract('function academicPeriodsForDay(', 'function academicTimetableBatchKey(')}
${extract('function academicTimetableGeneratorWorkspace(', 'function academicTimetableWorkspace(')}
${extract('async function boundedAcademicGenerationRequest(', 'function bindAcademicManagement(')}
${extract('function academicWorkflowPayload(', 'function academicCbtTestUploadPayload(').split("  if (form.dataset.academicWorkflow === 'saveAcademicSchoolCalendar')")[0]}
 return Object.fromEntries(new FormData(form).entries()); }
async function runButtonAction(button,label,task){const text=button.textContent;button.disabled=true;button.textContent=label;try{return await task()}finally{if(button.isConnected){button.disabled=false;button.textContent=text}}}
async function academicManagementRequest(action,payload,options={}){const response=await fetch('/api/generation',{method:'POST',headers:{'Content-Type':'application/json'},signal:options.signal,body:JSON.stringify({action,...payload})});const data=await response.json();if(!response.ok)throw new Error(data.message);return data;}
function renderAcademicManagement(data){academicManagementData={...academicManagementData,...data};const version=academicFind(data.timetableVersions,academicTimetableDraft.versionId);panelEl.innerHTML=academicTimetableGeneratorWorkspace(academicManagementData,academicManagementData,version);bindAcademicTimetableGenerator(panelEl);panelEl.querySelectorAll('[data-academic-timetable-version-select]').forEach(select=>select.onchange=()=>{academicTimetableDraft.versionId=select.value;renderAcademicManagement(academicManagementData)});panelEl.querySelector('form')?.addEventListener('submit',async e=>{e.preventDefault();try{renderAcademicManagement(await academicManagementRequest('saveAcademicTimetableGenerationRules',academicWorkflowPayload(e.target)))}catch(error){panelEl.querySelector('[data-academic-generation-result]').textContent=error.message}})}
renderAcademicManagement(academicManagementData);
</script></body></html>`;
const server = http.createServer(async (request, response) => {
  try {
    if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(await readFile(new URL('../css/style.css', import.meta.url))); return; }
    if (request.method === 'POST' && request.url === '/api/generation') {
      const buffers = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 768 * 1024) throw new Error('Too much data'); buffers.push(chunk); }
      const { action, ...payload } = JSON.parse(Buffer.concat(buffers).toString());
      const data = await harness.run(action, payload);
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)); return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
  } catch (error) { response.statusCode = 409; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: false, message: error.message })); }
});
server.listen(8800, '127.0.0.1', () => process.stdout.write('Local timetable sample: http://127.0.0.1:8800\n'));
