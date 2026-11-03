(function (root) {
  'use strict';
  const text = value => String(value ?? '').trim();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const present = value => Array.isArray(value) ? value.some(item => text(item)) : Boolean(text(value));
  const normalized = value => (Array.isArray(value) ? value : [value]).map(item => text(item).toLowerCase()).filter(Boolean).sort();
  function optionText(question, answer) {
    if (!present(answer)) return 'Not answered';
    const options = new Map((question.Options || []).map(option => [text(option.Id).toLowerCase(), option]));
    return (Array.isArray(answer) ? answer : [answer]).map(value => {
      const option = options.get(text(value).toLowerCase());
      if (!option) return text(value);
      return text(option.Text) && text(option.Text).toLowerCase() !== text(option.Id).toLowerCase()
        ? `${option.Id} — ${option.Text}` : text(option.Text || option.Id);
    }).join('; ');
  }
  function rows(data) {
    return (data.Questions || []).map((question, index) => {
      const answer = data.Answers?.[question.QuestionId];
      const savedMark = data.QuestionMarks?.[question.QuestionId];
      // Legacy serialized unmarked answers can contain an empty string.
      const mark = ['number', 'string'].includes(typeof savedMark) && text(savedMark) && Number.isFinite(Number(savedMark)) ? Number(savedMark) : null;
      const objective = ['single', 'multiple', 'true-false'].includes(question.QuestionType);
      let outcome = 'Not answered', tone = 'unanswered';
      if (present(answer)) {
        if (!objective) { outcome = mark == null ? 'Awaiting marking' : 'Manually marked'; tone = 'manual'; }
        else if (!present(question.AnswerKey)) { outcome = 'Answer key unavailable'; tone = 'manual'; }
        else {
          const correct = JSON.stringify(normalized(answer)) === JSON.stringify(normalized(question.AnswerKey));
          outcome = correct ? 'Correct' : 'Incorrect'; tone = correct ? 'correct' : 'incorrect';
        }
      }
      return {
        number: question.Ordinal ?? index + 1,
        prompt: question.Prompt?.Text || (typeof question.Prompt === 'string' ? question.Prompt : 'Refer to the question paper.'),
        selected: objective ? optionText(question, answer) : (present(answer) ? text(answer) : 'Not answered'),
        expected: objective ? (present(question.AnswerKey) ? optionText(question, question.AnswerKey) : 'Unavailable') : 'Teacher marking',
        outcome, tone, mark: mark == null ? 'Pending' : `${mark} / ${question.MaximumScore}`
      };
    });
  }
  function documentHtml(data, stylesheet) {
    const test = data.test || {}, candidate = data.candidate || {}, items = rows(data);
    const metadata = [
      ['Student / candidate', candidate.DisplayName], ['Reference', candidate.Reference],
      ['Class', test.ClassName], ['Subject', test.SubjectName],
      ['Session', test.AcademicSession], ['Term', test.Term], ['Attempt status', candidate.Status]
    ].filter(([, value]) => text(value));
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Answer comparison — ${escape(candidate.DisplayName)}</title><link rel="stylesheet" href="${escape(stylesheet)}"></head><body>
      <nav aria-label="Preview actions"><button id="printAnswers" type="button">Print / Save as PDF</button><button id="closeAnswers" type="button">Close preview</button></nav>
      <main><header><p class="eyebrow">Read-only answer comparison</p>${test.SchoolName ? `<h1>${escape(test.SchoolName)}</h1>` : ''}<h2>${escape(test.Title)}</h2></header>
      <dl>${metadata.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
      <p>Student selections beside the teacher’s saved correct options. Saved marks only; unsaved marking edits are excluded.</p>
      <div class="table-scroll"><table><thead><tr><th scope="col">No.</th><th scope="col">Question</th><th scope="col">Student’s selection</th><th scope="col">Teacher’s correct option</th><th scope="col">Comparison</th><th scope="col">Saved mark</th></tr></thead><tbody>${items.map(row => `<tr><td>${escape(row.number)}</td><td>${escape(row.prompt)}</td><td>${escape(row.selected)}</td><td>${escape(row.expected)}</td><td><span class="badge ${row.tone}">${escape(row.outcome)}</span></td><td>${escape(row.mark)}</td></tr>`).join('')}</tbody></table></div>
      ${items.length ? '' : '<p>No saved questions are available for this attempt.</p>'}<footer>This preview does not change answers, marks or approval status.</footer></main></body></html>`;
  }
  function open(data) {
    // Open during the user's click: no asynchronous request or popup retry.
    const preview = window.open('', '_blank');
    if (!preview) throw new Error('Your browser blocked the answer preview. Allow pop-ups for this portal and try again.');
    preview.document.open();
    preview.document.write(documentHtml(data, new URL('/css/cbt-answer-comparison.css?v=20261103', window.location.origin).href));
    preview.document.close();
    preview.document.getElementById('printAnswers').addEventListener('click', () => preview.print());
    preview.document.getElementById('closeAnswers').addEventListener('click', () => preview.close());
    preview.opener = null;
    preview.focus();
    return preview;
  }
  root.DynamaxCbtAnswerComparison = Object.freeze({ rows, optionText, documentHtml, open });
})(globalThis);
