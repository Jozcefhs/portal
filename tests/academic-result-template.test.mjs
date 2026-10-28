import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(await read('js/academic-result-template.js'), context);
const template = context.DynamaxAcademicResultTemplate;
const child = {DisplayName:'Test Learner',AccountRef:'TEST/001',Gender:'Female',DateOfBirth:'2011-05-14'};
const result = {
  Access:{Allowed:true},PublicationStatus:'Published',PublishedAt:'2026-10-27T23:30:00.000Z',ResultReference:'RESULT-TEST-001',
  ClassName:'Grade 10',ArmName:'Brilliance',SchoolStage:'secondary',AcademicSession:'2026/2027',Term:'First Term',ResultType:'End of Term',
  OverallAverage:72,ClassAverage:68.2,OverallGrade:'A',OverallPosition:4,AssessedStudentCount:42,Attendance:{AttendancePercentage:96},
  TeacherRemark:'Keep working carefully.',PrincipalRemark:'Good progress.',Recommendation:'Promoted',
  Subjects:[{SubjectName:'Computer Hardware and GSM Repairs',Total:72,Grade:'A',GradePoint:5,Position:3,Remark:'Excellent',
    WeightedComponents:[{ComponentId:'ca1',Name:'CA1',State:'Numeric',WeightedMark:7.2,MaximumMark:10},
      {ComponentId:'exam',Name:'Exam',State:'Numeric',WeightedMark:50.4,MaximumMark:70}]}]
};
const options = {profile:{SchoolName:'Test School',SchoolAddress:'Test address',ResultSignatoryName:'Test Officer'},origin:'https://school.example'};

test('official parent copy uses the approved report structure without extra subject columns', () => {
  const before = structuredClone(result);
  const html = template.render(child, result, options);
  for (const name of ['identity','subject','summary','remarks','criteria','verification']) assert.match(html,new RegExp(`report-table ${name}-table`));
  assert.match(html,/<th>Subject<\/th><th>CA1<\/th><th>Exam/);
  assert.doesNotMatch(html,/Weighted|Exempt assessments are excluded|Totals use unrounded marks|no reliable saved breakdown/);
  assert.match(html,/<td>7.2 \/ 10<\/td>/);
  assert.match(html,/<td>50.4 \/ 70<\/td>/);
  assert.match(html,/<td>A · 4 of 42<\/td>/);
  assert.doesNotMatch(html,/<th>(Point|Position \/ assessed|Remark)<\/th>|SAMPLE PREVIEW/);
  assert.match(html,/Test Learner/);assert.match(html,/Grade 10 \/ Brilliance/);
  assert.match(html,/https:\/\/school.example\/verify-result.html\?reference=RESULT-TEST-001/);
  assert.deepEqual(result,before,'Rendering must not change the saved scores or result');
});

test('custom assessments, exemptions, zero and unavailable marks retain their recorded meaning', () => {
  const record=structuredClone(result);
  record.Subjects[0].WeightedComponents=[
    {ComponentId:'project-internal',Name:'Research project',State:'Numeric',WeightedMark:0,MaximumMark:30},
    {ComponentId:'exam',Name:'Exam',State:'Exempt',WeightedMark:null,MaximumMark:null},
    {ComponentId:'old',Name:'Practical',State:'Unavailable',WeightedMark:null,MaximumMark:null}
  ];
  const html=template.render(child,record,options);
  assert.match(html,/Research project/);assert.match(html,/<td>0 \/ 30<\/td><td>Exempt<\/td><td>—<\/td>/);
  assert.doesNotMatch(html,/project-internal|>null<|>undefined</);
  assert.match(html,/<td>72<\/td><td>A<\/td>/,'Saved total and grade must not be recalculated');
});

test('not-taught subjects remain visible on mid-term reports, without fake marks or staff-only reasons',()=>{
  const html=template.render(child,{...result,ResultType:'Mid-Term',NotTaughtSubjects:[{SubjectName:'Technical Drawing',Reason:'Private staff reason'}]},options);
  assert.match(html,/<td>Technical Drawing<\/td><td colspan="4">Not taught this mid-term · Not included in average/);
  assert.doesNotMatch(html,/Private staff reason/);
  assert.match(html,/<td>72.0%<\/td>/,'Existing average is retained, displayed to one decimal place');
});

test('report dates use saved birth and publication values; the term does not repeat the report type', () => {
  const html=template.render(child,{...result,ResultType:'Mid-Term'},options);
  assert.match(html,/<span>Date of birth<\/span><strong>14 May 2011<\/strong>/);
  assert.match(html,/<span>Result release date<\/span><strong>28 Oct 2026<\/strong>/,'Release date uses WAT even on another device time zone');
  assert.match(html,/<span>Term<\/span><strong>First Term<\/strong>/);
  assert.doesNotMatch(html,/<span>Period<\/span>|First Term · Mid-Term/);
  assert.match(html,/Mid-Term Academic Result/);
  const legacy=template.render({...child,DateOfBirth:'',dateOfBirth:'14/05/2011'},{...result,PublicationStatus:'Locked'},options);
  assert.match(legacy,/<span>Date of birth<\/span><strong>14 May 2011<\/strong>/);
  assert.match(legacy,/<span>Result release date<\/span><strong>28 Oct 2026<\/strong>/);
});

test('unknown dates and drafts do not fabricate a birth or release date', () => {
  const unknown=template.render({...child,DateOfBirth:'2011-02-31'},{...result,PublishedAt:'',UpdatedAt:'2026-10-28T12:00:00Z'},options);
  assert.match(unknown,/<span>Date of birth<\/span><strong>Not recorded<\/strong>/);
  assert.match(unknown,/<span>Result release date<\/span><strong>Not recorded<\/strong>/);
  const draft=template.render(child,{...result,PublicationStatus:'Calculated Draft'},{...options,staffPreview:true});
  assert.match(draft,/<span>Result release date<\/span><strong>Not released<\/strong>/);
});

test('averages round for display only, including whole percentages and zero', () => {
  const record={...result,OverallAverage:76.67,ClassAverage:71.02};
  const before=structuredClone(record);
  const html=template.render(child,record,options);
  assert.match(html,/<td>76.7%<\/td><td>71.0%<\/td>/);
  assert.equal(template.formatAverage(0),'0.0%');
  assert.equal(template.formatAverage(100),'100.0%');
  assert.equal(template.formatAverage('68.25'),'68.3%');
  for(const missing of ['',null,undefined,'not a score',Infinity]) assert.equal(template.formatAverage(missing),'—');
  assert.deepEqual(record,before);
});

test('labels are escaped and restricted reports cannot be rendered', () => {
  const record=structuredClone(result);record.Subjects[0].SubjectName='<script>private</script>';
  const html=template.render({...child,DisplayName:'<b>Learner</b>'},record,options);
  assert.match(html,/&lt;script&gt;private&lt;\/script&gt;/);assert.match(html,/&lt;b&gt;Learner&lt;\/b&gt;/);
  assert.throws(()=>template.render(child,{...result,Access:{Allowed:false}},options),/not available/);
});

test('missing optional summary values do not turn into null percentages or fake attendance', () => {
  const html=template.render(child,{...result,OverallAverage:null,ClassAverage:null,OverallPosition:null,Attendance:{}},options);
  assert.doesNotMatch(html,/null%|undefined%|A · null|<td>0%<\/td>/);
  assert.match(html,/<td>—<\/td>/);
});

test('nursery and primary use pupil and head teacher; drafts remain clearly identified', () => {
  for (const stage of ['nursery','primary']) {
    const html=template.render(child,{...result,SchoolStage:stage,ClassName:'Class 2',PublicationStatus:'Calculated Draft',Status:'Calculated Draft'},{...options,staffPreview:true});
    assert.match(html,/<span>Pupil<\/span>/);assert.match(html,/<strong>Head Teacher:<\/strong>/);
    assert.match(html,/STAFF PREVIEW, NOT A PUBLISHED RESULT/);
  }
  assert.match(template.render(child,{...result,ResultType:'Mid-Term'},options),/Mid-Term Academic Result/);
});

test('both entry points load the same template before their consumers and cache it together',async()=>{
  const [admin,parent,worker]=await Promise.all(['admin.html','parent-dashboard.html','sw.js'].map(read));
  for (const [html,consumer] of [[admin,'js/admin.js'],[parent,'js/parent-dashboard.js']]) {
    assert.ok(html.indexOf('js/academic-result-template.js')<html.indexOf(consumer));
  }
  assert.match(worker,/\/js\/academic-result-template.js/);assert.match(worker,/\/css\/parent-academic-results.css/);
});
