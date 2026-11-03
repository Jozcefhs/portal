import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/cbt-answer-comparison.js';

const { rows, optionText, documentHtml, open } = globalThis.DynamaxCbtAnswerComparison;
const question = (id, extra = {}) => ({ QuestionId: id, QuestionType: 'single', Prompt: { Text: 'Two plus two?' },
  Options: [{ Id: 'A', Text: 'Three' }, { Id: 'B', Text: 'Four' }], AnswerKey: 'B', MaximumScore: 5, ...extra });

test('saved option IDs resolve to original option text even if the presentation order changed', () => {
  assert.equal(optionText(question('1'), 'b'), 'B — Four');
  assert.equal(optionText(question('1', { Options: [{ Id: 'B', Text: 'Four' }, { Id: 'A', Text: 'Three' }] }), 'A'), 'A — Three');
  assert.equal(optionText(question('1', { Options: [{ Id: 'B', Text: 'B' }] }), 'B'), 'B');
  assert.equal(optionText(question('1'), 'C'), 'C');
});

test('comparison distinguishes incorrect, unanswered and saved zero marks without mutating data', () => {
  const data = { Questions: [question('a'), question('b'), question('c')], Answers: { a: 'B', b: 'A' }, QuestionMarks: { a: 5, b: 0 } };
  const before = structuredClone(data), result = rows(data);
  assert.deepEqual(result.map(r => [r.outcome, r.mark]), [['Correct', '5 / 5'], ['Incorrect', '0 / 5'], ['Not answered', 'Pending']]);
  assert.equal(result[2].selected, 'Not answered');
  assert.deepEqual(data, before);
});

test('multiple selections compare regardless of order and missing keys are not guessed', () => {
  const data = { Questions: [question('a', { QuestionType: 'multiple', AnswerKey: ['A', 'B'] }), question('b', { AnswerKey: null })],
    Answers: { a: ['b', 'a'], b: 'A' } };
  assert.equal(rows(data)[0].outcome, 'Correct');
  assert.equal(rows(data)[0].selected, 'B — Four; A — Three');
  assert.equal(rows(data)[1].outcome, 'Answer key unavailable');
});

test('written responses show saved marking state including zero rather than inventing an objective key', () => {
  const data = { Questions: [question('a', { QuestionType: 'extended' }), question('b', { QuestionType: 'extended' })],
    Answers: { a: 'An explanation', b: 'Another explanation' }, QuestionMarks: { a: '', b: 0 } };
  assert.deepEqual(rows(data).map(r => [r.outcome, r.expected, r.mark]), [
    ['Awaiting marking', 'Teacher marking', 'Pending'], ['Manually marked', 'Teacher marking', '0 / 5']]);
});

test('printable document escapes saved content and avoids inline scripts under exam CSP', () => {
  const html = documentHtml({ test: { Title: '<img src=x onerror=alert(1)>', SchoolName: 'A & B' },
    candidate: { DisplayName: '<script>bad()</script>' }, Questions: [question('q', { Options: [{ Id: 'B', Text: '<svg onload=bad()>' }] })],
    Answers: { q: 'B' } }, '/css/cbt-answer-comparison.css');
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(html, /B — &lt;svg onload=bad\(\)&gt;/);
  assert.doesNotMatch(html, /<script|<img|<svg|onclick=|<style/);
  assert.match(html, /Print \/ Save as PDF/);
  assert.match(html, /Saved marks only/);
});

test('blocked popup produces a clear error without retrying or fetching data', () => {
  let calls = 0;
  globalThis.window = { open() { calls++; return null; } };
  try { assert.throws(() => open({}), /Allow pop-ups/); assert.equal(calls, 1); }
  finally { delete globalThis.window; }
});
