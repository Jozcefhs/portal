(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const params = new URLSearchParams(location.search), branch = params.get('branch') || 'main';
  $('section').value = params.get('section') === 'primary' ? 'primary' : 'secondary';
  $('audience').value = params.get('audience') === 'student' ? 'student' : 'applicant';
  let state = {}, options = {}, selected = null, editing = '', revision = '', busy = false;
  const status = (message, bad = false) => { $('managerStatus').textContent = message; $('managerStatus').className = bad ? 'bad' : 'good'; };
  let sessionActive = false;
  async function request(url, body) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      return { response, data: await response.json() };
    } finally { clearTimeout(timeout); }
  }
  const idle = window.DynamaxStaffIdleSession.create({
    renew: async activityAgeMs => {
      const { response, data } = await request('/api/staff-session', { action: 'activity', activityAgeMs });
      return { ...data, ok: response.ok && data.ok, status: response.status };
    }, onToken: () => {}, onExpire: message => { sessionActive = false; status(`${message} Sign in through the staff workspace, then retry here. Your open draft has been kept on this page.`, true); }
  });
  ['pointerdown', 'keydown', 'input', 'change', 'wheel', 'touchstart'].forEach(name => document.addEventListener(name, event => idle.activity(event), { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => idle.check()); window.addEventListener('online', () => idle.check());
  async function staffSession() {
    const { response, data } = await request('/api/staff-session');
    if (!response.ok || !data.authenticated) throw new Error('Sign in through the staff workspace, then retry here.');
    idle.start({ username: data.user.username, session: data.session }); sessionActive = true;
  }
  const scope = () => ({ BranchId: branch, SchoolSection: $('section').value, Audience: $('audience').value });
  async function api(action, extra = {}) {
    const { response, data } = await request('/api/portal-cbt-manage', { ...scope(), action, ...extra });
    if (response.status === 401) { sessionActive = false; idle.stop(); }
    if (!response.ok || data.ok === false) throw new Error(data.message || 'The server did not confirm this operation.'); return data;
  }
  async function run(task) {
    if (busy) return; busy = true;
    const enabled = [...document.querySelectorAll('button,input,select,textarea')].filter(el => !el.disabled); enabled.forEach(el => { el.disabled = true; });
    try { if (!sessionActive) await staffSession(); await task(); } catch (error) { status(error.message, true); }
    finally { busy = false; enabled.filter(el => el.isConnected).forEach(el => { el.disabled = false; }); }
  }
  const time = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }) + ' WAT' : '—';
  const selectOptions = (id, rows, key, label, chosen = '') => { $(id).innerHTML = rows.map(row => `<option value="${escape(row[key])}"${row[key] === chosen ? ' selected' : ''}>${escape(label(row))}</option>`).join(''); };
  async function load() {
    selected = null; $('testDetails').hidden = $('resultReview').hidden = $('accessCards').hidden = true;
    state = await api('state'); renderTestList();
    status('Examinations loaded.');
  }
  function renderTestList() {
    $('testList').innerHTML = `<table><thead><tr><th>Examination</th><th>Period</th><th>Window (WAT)</th><th>Status</th><th>Candidates</th><th></th></tr></thead><tbody>${state.tests.map(test => `<tr><td>${escape(test.Title)}</td><td>${escape(test.AcademicSession)} · ${escape(test.Term)}</td><td>${escape(time(test.StartsAt))}<br>${escape(time(test.EndsAt))}</td><td>${escape(test.Status)}</td><td>${test.CandidateCount}</td><td><button data-open="${test.TestId}" type="button">Open register</button></td></tr>`).join('') || '<tr><td colspan="6">No examinations in this branch and section.</td></tr>'}</tbody></table>`;
    $('testList').querySelectorAll('[data-open]').forEach(button => { button.onclick = () => run(() => details(button.dataset.open)); });
  }
  function academicChoices() {
    const session = $('academicSession').value, term = $('academicTerm').value, classId = $('academicClass').value;
    const allocations = (options.allocations || []).filter(row => row.SessionId === session && row.TermId === term && row.ClassId === classId && row.SubjectId && row.TeacherUsername && !['Archived', 'Inactive'].includes(row.Status));
    selectOptions('academicAllocation', allocations.map((row, i) => ({ ...row, key: String(i) })), 'key', row => `${(options.subjects || []).find(s => s.SubjectId === row.SubjectId)?.Name || row.SubjectId} · ${row.TeacherUsername}`);
    $('academicAllocation')._rows = allocations;
    total();
  }
  function componentChoices(rows) {
    options.componentChoices = rows.filter(row => ['any', 'built-in-cbt'].includes(row.SourceMode)).flatMap(row => row.ScoreEntryMode === 'objective-theory'
      ? ['objective', 'theory'].filter(part => ['any', 'built-in-cbt'].includes((row.ScoreParts || []).find(value => value.Id === part)?.SourceMode || row.SourceMode)).map(part => ({
        ...row, key: `${row.Id}:${part}`, part, maximum: part === 'theory' ? row.TheoryMaximumScore : row.ObjectiveMaximumScore,
        label: `${row.Name} — ${part === 'theory' ? 'Theory' : 'Objective'}` }))
      : [{ ...row, key: row.Id, part: '', maximum: row.MaximumScore, label: row.Name }]);
    selectOptions('academicComponent', options.componentChoices, 'key', row => `${row.label} (${row.maximum} marks)`); total();
  }
  async function refreshAssessment() {
    const allocation = $('academicAllocation')._rows?.[Number($('academicAllocation').value)];
    if (!allocation) { componentChoices([]); return; }
    const data = await api('assessment', { SessionId: $('academicSession').value, TermId: $('academicTerm').value,
      ClassId: $('academicClass').value, SubjectId: allocation.SubjectId, TeacherUsername: allocation.TeacherUsername });
    componentChoices(data.components || []);
  }
  function academicTerms() {
    selectOptions('academicTerm', (options.terms || []).filter(row => row.SessionId === $('academicSession').value), 'TermId', row => row.Name);
    academicChoices();
  }
  async function editor(existing = null) {
    options = await api('options', $('academicSession').value ? { SessionId: $('academicSession').value, TermId: $('academicTerm').value } : {});
    editing = existing?.TestId || ''; revision = existing?.Revision || '';
    const applicant = $('audience').value === 'applicant';
    $('entranceFields').hidden = !applicant; $('academicFields').hidden = applicant;
    selectOptions('entranceSubject', state.subjects || [], 'id', row => `${row.name} (${row.maxScore} marks)`);
    $('admissionSessions').innerHTML = [...new Set((options.periods || []).map(row => row.AcademicSession))].map(value => `<option value="${escape(value)}"></option>`).join('');
    $('applyingClasses').innerHTML = [...new Set((options.periods || []).map(row => row.ClassName))].map(value => `<option value="${escape(value)}"></option>`).join('');
    if (!applicant) {
      selectOptions('academicSession', options.sessions || [], 'SessionId', row => row.Name, options.selection?.SessionId);
      selectOptions('academicClass', (options.classes || []).filter(row => !['Archived', 'Inactive'].includes(row.Status)), 'ClassId', row => row.Name);
      academicTerms();
      await refreshAssessment();
    }
    $('questionEditors').replaceChildren();
    $('testTitle').value = existing?.Title || ''; $('duration').value = existing?.DurationMinutes || 30; $('testInstructions').value = existing?.Instructions || '';
    if (existing) {
      if (!applicant && existing.Academic) {
        $('academicSession').value = existing.Academic.SessionId; academicTerms();
        $('academicTerm').value = existing.Academic.TermId; $('academicClass').value = existing.Academic.ClassId; academicChoices();
        const index = $('academicAllocation')._rows.findIndex(row => row.SubjectId === existing.Academic.SubjectId && row.TeacherUsername === existing.Academic.TeacherUsername);
        $('academicAllocation').value = String(index); await refreshAssessment();
        $('academicComponent').value = `${existing.Academic.AssessmentComponentId}${existing.Academic.AssessmentPartId ? ':' + existing.Academic.AssessmentPartId : ''}`;
      }
      $('admissionSession').value = existing.AcademicSession; $('admissionTerm').value = existing.Term; $('applyingClass').value = existing.ClassName;
      $('entranceSubject').value = (state.subjects || []).find(row => row.name === existing.SubjectName)?.id || '';
      $('startsAt').value = new Date(Date.parse(existing.StartsAt) + 3600000).toISOString().slice(0, 16); $('endsAt').value = new Date(Date.parse(existing.EndsAt) + 3600000).toISOString().slice(0, 16);
      (existing.Questions || []).forEach(question);
    } else question();
    $('testEditor').hidden = false; $('testEditor').scrollIntoView({ behavior: 'smooth' }); total();
  }
  function question(row = {}) {
    const card = document.createElement('div'); card.className = 'question-editor';
    card.innerHTML = `<div class="exam-grid"><label>Answer type<select data-type><option value="single">Multiple choice</option><option value="extended">Written answer</option></select></label><label>Marks<input data-marks type="number" min="0.01" max="100" step="0.01" value="${escape(row.MaximumScore || 1)}" required></label></div><label>Question<textarea data-prompt required maxlength="8000">${escape(row.Prompt?.Text || '')}</textarea></label><div data-choice-fields><label>Options — one per line (2–6)<textarea data-options>${escape(row.Options?.map(option => option.Text).join('\n') || '')}</textarea></label><label>Correct answer<select data-key>${['A', 'B', 'C', 'D', 'E', 'F'].map(value => `<option${value === row.AnswerKey ? ' selected' : ''}>${value}</option>`).join('')}</select></label></div><button type="button" data-remove>Remove question</button>`;
    card.querySelector('[data-type]').value = row.QuestionType || 'single';
    const toggle = () => { card.querySelector('[data-choice-fields]').hidden = card.querySelector('[data-type]').value !== 'single'; };
    card.querySelector('[data-type]').onchange = toggle; toggle();
    card.querySelector('[data-remove]').onclick = () => { card.remove(); total(); };
    card.querySelector('[data-marks]').oninput = total; $('questionEditors').append(card); total();
  }
  function total() {
    const cards = [...$('questionEditors').children], sum = cards.reduce((value, row) => value + Number(row.querySelector('[data-marks]').value || 0), 0);
    const subject = (state.subjects || []).find(row => row.id === $('entranceSubject').value), component = (options.componentChoices || []).find(row => row.key === $('academicComponent').value);
    const target = $('audience').value === 'applicant' ? subject?.maxScore : component?.maximum;
    $('questionTotal').textContent = `${cards.length} questions · Total ${Number(sum.toFixed(4))} / ${target ?? 'choose subject'} marks`;
  }
  async function saveDraft() {
    const allocation = $('academicAllocation')._rows?.[Number($('academicAllocation').value)] || {};
    const component = (options.componentChoices || []).find(row => row.key === $('academicComponent').value);
    const body = { Title: $('testTitle').value, AcademicSession: $('admissionSession').value, Term: $('admissionTerm').value, ClassName: $('applyingClass').value,
      SubjectId: $('audience').value === 'applicant' ? $('entranceSubject').value : allocation.SubjectId,
      SessionId: $('academicSession').value, TermId: $('academicTerm').value, ClassId: $('academicClass').value, TeacherUsername: allocation.TeacherUsername,
      AssessmentComponentId: component?.Id || '', AssessmentPartId: component?.part || '', StartsAt: `${$('startsAt').value}:00+01:00`, EndsAt: `${$('endsAt').value}:00+01:00`,
      DurationMinutes: Number($('duration').value), Instructions: $('testInstructions').value, TestId: editing, Revision: revision,
      Questions: [...$('questionEditors').children].map((row, index) => ({ QuestionId: `Q${index + 1}`, QuestionType: row.querySelector('[data-type]').value,
        Prompt: row.querySelector('[data-prompt]').value, MaximumScore: Number(row.querySelector('[data-marks]').value),
        Options: row.querySelector('[data-options]').value.split('\n').map(value => value.trim()).filter(Boolean), AnswerKey: row.querySelector('[data-key]').value })) };
    const saved = await api('create', body); $('testEditor').hidden = true; await load(); await details(saved.TestId); status(saved.message);
  }
  async function details(id) {
    const data = await api('details', { TestId: id }); selected = data;
    state.tests = state.tests.map(row => row.TestId === id ? { ...row, ...data.test, CandidateCount: data.candidates.length } : row);
    renderTestList();
    const registered = new Set(data.candidates.map(row => row.Reference.toLowerCase())), available = data.available.filter(row => !registered.has(row.Reference.toLowerCase()));
    $('testDetails').hidden = false; $('resultReview').hidden = $('accessCards').hidden = true;
    $('testDetails').innerHTML = `<h2>${escape(data.test.Title)}</h2><p>${escape(data.test.Status)} · ${escape(time(data.test.StartsAt))} to ${escape(time(data.test.EndsAt))}</p><p class="test-link">Remote candidate link: <a href="/exam.html?test=${id}" target="_blank" rel="noopener">${escape(location.origin)}/exam.html?test=${id}</a></p>
      ${data.test.Status === 'Draft' ? `<p>Register candidates, then open the examination. Opening freezes its questions, candidates and delivery assignments.</p><div class="exam-actions"><button type="button" data-edit>Edit draft</button><button type="button" data-select-all>Select all unregistered</button><select aria-label="Delivery mode" data-delivery>${data.test.Audience === 'applicant' ? '<option value="offline">School network (offline)</option>' : ''}<option value="online">Remote over internet</option></select><button type="button" data-enroll>Register selected candidates</button><button type="button" data-schedule>Open examination</button></div><div class="exam-options">${available.map(row => `<label class="row-check"><input type="checkbox" value="${escape(row.Reference)}" data-candidate-check>${escape(row.DisplayName)} · ${escape(row.Reference)}</label>`).join('') || '<p>No unregistered candidates in this class and period.</p>'}</div>` : '<p>Offline applicants: open Local CBT Server → Entrance exams, then pull this examination before disconnecting the internet. Each offline exam is reserved to one CBT server.</p>'}
      <div class="exam-actions"><button type="button" data-cards>Preview / print access cards</button><button type="button" data-refresh>Refresh results</button><button type="button" data-post-all>Post approved results</button></div>
      <div class="exam-table"><table><thead><tr><th>Candidate</th><th>Reference</th><th>Delivery</th><th>Attempt</th><th>Score</th><th>Online result</th><th></th></tr></thead><tbody>${data.candidates.map(row => `<tr><td>${escape(row.DisplayName)}</td><td>${escape(row.Reference)}</td><td>${escape(row.Delivery)}</td><td>${escape(row.Status)}</td><td>${row.Status === 'Ready' || row.Status === 'In progress' ? '—' : row.NeedsMarking ? 'Needs marking' : escape(row.RawScore)}</td><td>${escape(row.PostMessage || 'Not posted')}</td><td>${['Submitted', 'Approved', 'In progress'].includes(row.Status) ? `<button type="button" data-review="${row.CandidateId}">Review</button>` : ''}${row.Status === 'Approved' ? `<button type="button" data-post="${row.CandidateId}">Post result</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7">No candidates registered.</td></tr>'}</tbody></table></div>`;
    const find = selector => $('testDetails').querySelector(selector);
    if (find('[data-edit]')) find('[data-edit]').onclick = () => run(() => editor(data.test));
    if (find('[data-select-all]')) find('[data-select-all]').onclick = () => { $('testDetails').querySelectorAll('[data-candidate-check]').forEach(check => { check.checked = true; }); };
    if (find('[data-enroll]')) find('[data-enroll]').onclick = () => run(async () => {
      const refs = [...$('testDetails').querySelectorAll('[data-candidate-check]:checked')].map(el => el.value), delivery = find('[data-delivery]').value;
      if (!refs.length) throw new Error('Select at least one candidate.');
      for (let i = 0; i < refs.length; i += 25) { status(`Registering candidates ${i + 1}–${Math.min(i + 25, refs.length)} of ${refs.length}…`); await api('enroll', { TestId: id, References: refs.slice(i, i + 25), Delivery: delivery }); }
      await details(id); status('Selected candidates registered.');
    });
    if (find('[data-schedule]')) find('[data-schedule]').onclick = () => run(async () => { const result = await api('schedule', { TestId: id }); await details(id); status(result.message); });
    find('[data-refresh]').onclick = () => run(() => details(id)); find('[data-cards]').onclick = () => run(() => cards(id));
    $('testDetails').querySelectorAll('[data-review]').forEach(button => { button.onclick = () => run(() => review(id, button.dataset.review)); });
    $('testDetails').querySelectorAll('[data-post]').forEach(button => { button.onclick = () => run(async () => { const result = await api('post', { TestId: id, CandidateId: button.dataset.post }); await details(id); status(result.message); }); });
    find('[data-post-all]').onclick = () => run(async () => {
      const approved = data.candidates.filter(row => row.Status === 'Approved' && !row.PostedAt), issues = []; let posted = 0;
      for (const row of approved) { status(`Posting ${posted + issues.length + 1} of ${approved.length} approved results…`); try { await api('post', { TestId: id, CandidateId: row.CandidateId }); posted++; } catch (error) { issues.push(`${row.Reference}: ${error.message}`); } }
      await details(id); status(`${posted} results confirmed. ${issues.join(' ') || 'Existing scores were preserved.'}`, Boolean(issues.length));
    });
  }
  async function cards(id) {
    const data = await api('cards', { TestId: id }); $('accessCards').hidden = false;
    $('accessCards').innerHTML = `<h2>Examination access cards</h2><p>Give each candidate only their own card. Keep this list private.</p><div class="exam-actions"><button type="button" data-print>Print cards</button><button type="button" data-close>Close cards</button></div>${data.cards.map(row => `<article class="access-card"><h3>${escape(data.test.Title)}</h3><p>${escape(row.DisplayName)} · ${escape(row.Reference)}</p><p>${escape(row.Delivery === 'online' ? 'Remote examination — internet required' : 'School-network examination — use the CBT server address / QR supplied by staff')}</p>${row.Delivery === 'online' ? `<p>${escape(location.origin)}/exam.html?test=${id}</p>` : ''}<p>Login: <strong>${escape(row.Delivery === 'offline' ? row.LoginId : row.Reference)}</strong><br>Examination password: <strong>${escape(row.Password)}</strong></p><p>${escape(time(data.test.StartsAt))} · ${data.test.DurationMinutes} minutes</p></article>`).join('')}`;
    $('accessCards').querySelector('[data-print]').onclick = () => window.print(); $('accessCards').querySelector('[data-close]').onclick = () => { $('accessCards').hidden = true; $('accessCards').replaceChildren(); };
    $('accessCards').scrollIntoView({ behavior: 'smooth' });
  }
  async function review(id, candidate) {
    const data = await api('review', { TestId: id, CandidateId: candidate }); $('resultReview').hidden = false;
    $('resultReview').innerHTML = `<h2>Review: ${escape(data.candidate.DisplayName)}</h2>${data.Questions.map(q => `<article class="exam-question"><h3>${q.Ordinal}. ${escape(q.Prompt.Text)}</h3><p>Candidate answer:</p><pre>${escape(data.Answers[q.QuestionId] || 'No answer')}</pre>${q.QuestionType === 'single' ? `<p>Correct answer: ${escape(q.AnswerKey)} · Mark: ${data.QuestionMarks[q.QuestionId] ?? 0} / ${q.MaximumScore}</p>` : `<label>Mark / ${q.MaximumScore}<input data-mark="${q.QuestionId}" type="number" min="0" max="${q.MaximumScore}" step="0.01" value="${escape(data.QuestionMarks[q.QuestionId] ?? '')}"${data.candidate.Status === 'Approved' ? ' disabled' : ''}></label>`}</article>`).join('')}<div class="exam-actions">${data.candidate.Status !== 'Approved' ? '<button type="button" data-approve>Approve result</button>' : ''}<button type="button" data-close-review>Close review</button></div>`;
    $('resultReview').querySelector('[data-close-review]').onclick = () => { $('resultReview').hidden = true; };
    const approve = $('resultReview').querySelector('[data-approve]'); if (approve) approve.onclick = () => run(async () => {
      const Marks = Object.fromEntries([...$('resultReview').querySelectorAll('[data-mark]')].map(el => [el.dataset.mark, el.value]));
      const result = await api('approve', { TestId: id, CandidateId: candidate, Revision: data.candidate.Revision, Marks }); await details(id); status(result.message);
    }); $('resultReview').scrollIntoView({ behavior: 'smooth' });
  }
  $('loadTests').onclick = () => run(load); $('newTest').onclick = () => run(() => editor()); $('addQuestion').onclick = () => question();
  $('cancelEditor').onclick = () => { $('testEditor').hidden = true; }; $('testEditor').onsubmit = event => { event.preventDefault(); run(saveDraft); };
  $('academicSession').onchange = () => { academicTerms(); run(refreshAssessment); };
  $('academicTerm').onchange = $('academicClass').onchange = () => { academicChoices(); run(refreshAssessment); };
  $('academicAllocation').onchange = () => run(refreshAssessment);
  $('academicComponent').onchange = $('entranceSubject').onchange = total;
  for (const id of ['audience', 'section']) $(id).onchange = () => { $('testEditor').hidden = true; run(load); };
  run(load);
})();
