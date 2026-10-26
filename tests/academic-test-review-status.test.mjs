import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const runtime=vm.createContext({escapeHtml});
vm.runInContext(source.match(/function academicTestReviewStatusMarkup\([\s\S]*?\n}/)[0],runtime);
const render=row=>runtime.academicTestReviewStatusMarkup(row);
test('saved CA1 approval is visible even when the term sheet is Draft',()=>{
 const sheet={Status:'Draft',ComponentReviews:{ca1:{Name:'CA1',Status:'Approved'}}},before=structuredClone(sheet);
 const html=render(sheet);assert.match(html,/CA1 · Approved/);assert.match(html,/Last saved test reviews/);
 assert.deepEqual(sheet,before);
});
test('fresh checks supersede historical approval when marks or roster changed',()=>{
 const html=render({ComponentReviews:{ca1:{Name:'CA1',Status:'Approved'}},TestReviewStatus:[{Name:'CA1',Status:'Draft',Stale:true}]});
 assert.match(html,/CA1 · Changed — resubmit/);assert.doesNotMatch(html,/CA1 · Approved/);
 assert.match(html,/Checked against saved marks/);
 assert.match(render({ComponentReviews:{ca1:{Name:'CA1',Status:'Approved'}},TestReviewStatus:[]}),/Not yet submitted/);
});
test('unreviewed, submitted, locked and reopened tests have distinct labels with safe human names',()=>{
 assert.match(render({}),/Not yet submitted/);
 assert.match(render({TestReviewStatus:[{Name:'CA2',Status:'Draft'}]}),/Not yet submitted/);
 const html=render({AssessmentComponents:[{Id:'internal',Name:'Exam'}],ComponentReviews:{internal:{ComponentId:'internal',Status:'Submitted'},ca1:{Name:'<img onerror=bad>',Status:'Locked'},ca2:{Name:'CA2',Status:'Draft',ReopenedAt:'today'}}});
 assert.match(html,/Exam · Submitted/);assert.match(html,/CA2 · Reopened/);assert.match(html,/&lt;img onerror=bad&gt; · Locked/);
 assert.doesNotMatch(html,/<img|internal/);
});
