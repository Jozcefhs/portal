(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const logo = document.querySelector('.exam-logo');
  logo.onerror = () => { logo.hidden = true; };
  if (logo.complete && !logo.naturalWidth) logo.hidden = true;
  const random = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
  let client, candidateId = '', attempt = null, answers = {}, version = 0, acknowledged = 0, offset = 0, busy = false, submissionPending = false, timer, lastContact = 0;
  const status = text => { $('examStatus').textContent = text; };
  const testId = new URLSearchParams(location.search).get('test') || '';
  $('testId').value = testId;
  let storageReady = true;
  try {
    client = sessionStorage.getItem('exam-client') || random(); sessionStorage.setItem('exam-client', client);
    candidateId = sessionStorage.getItem(`exam-candidate:${testId}`) || '';
  } catch (_) { storageReady = false; status('Enable site storage so this browser can safely save and resume your answers.'); }
  const pendingKey = () => `exam-answers:${attempt.TestId}:${attempt.CandidateId}:${attempt.AttemptId}`;
  const recoveryKey = () => `${pendingKey()}:recovery`;
  $('closeRecovery').onclick = () => { $('examRecovery').hidden = true; };
  let restoreFocus, dialogResolve;
  function closeDialog(value = false) {
    $('examDialog').hidden = true; restoreFocus?.focus();
    if (dialogResolve) { const resolve = dialogResolve; dialogResolve = null; resolve(value); }
  }
  function notice(message, confirm = false) {
    closeDialog(false); restoreFocus = document.activeElement;
    $('dialogText').textContent = message; $('dialogConfirm').hidden = !confirm;
    $('dialogClose').textContent = confirm ? 'Cancel' : 'Close'; $('examDialog').hidden = false; $('dialogClose').focus();
    return new Promise(resolve => { dialogResolve = resolve; });
  }
  $('dialogClose').onclick = () => closeDialog(false);
  $('dialogConfirm').onclick = () => closeDialog(true);
  $('examDialog').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(false); }
    if (event.key === 'Tab') { const controls = [$('dialogConfirm'), $('dialogClose')].filter(el => !el.hidden); const i = controls.indexOf(document.activeElement); event.preventDefault(); controls[(i + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus(); }
  });
  async function request(action, extra = {}) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/portal-cbt', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, CandidateId: candidateId, ClientId: client, ...extra }) });
      const data = await response.json(); if (!response.ok || data.ok === false) throw new Error(data.message || 'The server did not confirm this request.');
      lastContact = Date.now();
      return data;
    } finally { clearTimeout(timeout); }
  }
  function persist() {
    try { sessionStorage.setItem(pendingKey(), JSON.stringify({ Answers: answers, SaveVersion: version, BaseVersion: acknowledged, submissionPending })); }
    catch (_) { status('This browser could not keep a recovery copy. Keep this page open while answers save to the server.'); }
  }
  function updateTimer() {
    if (!attempt || attempt.Status !== 'In progress') return;
    const seconds = Math.max(0, Math.ceil((Date.parse(attempt.ExpiresAt) - (Date.now() + offset)) / 1000));
    $('examTimer').textContent = `Time left: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (!seconds && !submissionPending) { submissionPending = true; version = Math.max(version, acknowledged + 1); freezeAnswers(); persist(); flush(); }
  }
  function freezeAnswers() {
    $('questions').querySelectorAll('fieldset').forEach(field => { field.disabled = true; });
    $('submitExam').disabled = true;
  }
  function done(next) {
    attempt = next; clearInterval(timer);
    $('examLogin').hidden = $('examLobby').hidden = $('examWork').hidden = true; $('examDone').hidden = false;
    $('examReceipt').textContent = `Reference: ${next.Reference} · Submitted: ${new Date(next.SubmittedAt).toLocaleString()} · Receipt: ${next.AttemptId}`;
    $('saveState').textContent = ''; status(next.TimedOut ? 'Time expired. The school server submitted the answers it received before the deadline.' : 'Submission confirmed by the school server.');
    try { sessionStorage.removeItem(pendingKey()); sessionStorage.removeItem(recoveryKey()); } catch (_) {}
  }
  function render(next) {
    attempt = next; offset = Date.parse(next.ServerTime) - Date.now();
    $('examTitle').textContent = next.Title; $('examSchool').textContent = next.SchoolName;
    $('candidateName').textContent = next.DisplayName; $('examLogin').hidden = true;
    $('examSchedule').textContent = `${next.SubjectName} · ${next.DurationMinutes} minutes · Opens ${new Date(next.StartsAt).toLocaleString()} · Closes ${new Date(next.EndsAt).toLocaleString()}`;
    $('examInstructions').textContent = next.Instructions || 'Read each question carefully. Answers save automatically while connected. The timer continues if you disconnect.';
    if (['Submitted', 'Approved'].includes(next.Status)) return done(next);
    if (next.Status !== 'In progress') { $('examLobby').hidden = false; return; }
    $('examLobby').hidden = true; $('examWork').hidden = false;
    answers = { ...next.Answers }; version = acknowledged = next.SaveVersion || 0;
    try {
      const saved = JSON.parse(sessionStorage.getItem(pendingKey()) || 'null');
      const sameAnswers = saved && JSON.stringify(saved.Answers) === JSON.stringify(answers);
      if (saved && saved.SaveVersion > saved.BaseVersion && (saved.submissionPending || !sameAnswers)) {
        if (saved.BaseVersion === acknowledged || (saved.submissionPending && sameAnswers)) { answers = saved.Answers; version = Math.max(saved.SaveVersion, acknowledged + 1); submissionPending = saved.submissionPending === true; }
        else {
          sessionStorage.setItem(recoveryKey(), JSON.stringify(saved.Answers));
          notice('Saved answers changed. Your unconfirmed answers are kept in the recovery copy on this page. Close duplicate tabs and compare the answers before continuing.');
        }
      }
      const recovery = JSON.parse(sessionStorage.getItem(recoveryKey()) || 'null');
      if (recovery) {
        $('examRecovery').hidden = false;
        $('recoveryAnswers').value = next.Questions.map(q => `${q.Ordinal}. ${q.Prompt.Text}\n${q.QuestionType === 'single' ? (q.Options.find(option => option.Id === recovery[q.QuestionId])?.Text || 'No answer') : (recovery[q.QuestionId] || 'No answer')}`).join('\n\n');
      }
    } catch (_) {}
    $('questions').replaceChildren();
    next.Questions.forEach(q => {
      const field = document.createElement('fieldset'); field.className = 'exam-question';
      const title = document.createElement('legend'); title.textContent = `${q.Ordinal}. ${q.Prompt.Text} (${q.MaximumScore} marks)`; field.append(title);
      const changed = value => { answers[q.QuestionId] = value; version++; persist(); $('saveState').textContent = 'Saving answers…'; flush(); };
      if (q.QuestionType === 'single') q.Options.forEach(option => {
        const label = document.createElement('label'), radio = document.createElement('input'), text = document.createElement('span');
        radio.type = 'radio'; radio.name = q.QuestionId; radio.value = option.Id; radio.checked = answers[q.QuestionId] === option.Id;
        radio.onchange = () => changed(radio.value); text.textContent = `${option.Id}. ${option.Text}`; label.append(radio, text); field.append(label);
      });
      else { const area = document.createElement('textarea'); area.maxLength = 12000; area.value = answers[q.QuestionId] || ''; area.setAttribute('aria-label', `Answer question ${q.Ordinal}`); area.oninput = () => changed(area.value); field.append(area); }
      $('questions').append(field);
    });
    if (submissionPending) freezeAnswers();
    clearInterval(timer); timer = setInterval(updateTimer, 1000); updateTimer(); flush();
  }
  async function flush() {
    if (busy || !attempt || attempt.Status !== 'In progress') return;
    if (!submissionPending && version <= acknowledged && Date.now() - lastContact < 30000) return;
    busy = true;
    const sendingVersion = Math.max(version, submissionPending ? acknowledged + 1 : 0);
    const sending = submissionPending ? 'submit' : sendingVersion > acknowledged ? 'save' : 'session';
    let confirmed = false;
    try {
      const data = await request(sending, { Answers: { ...answers }, SaveVersion: sendingVersion, BaseVersion: acknowledged });
      offset = Date.parse(data.attempt.ServerTime) - Date.now();
      acknowledged = Math.max(acknowledged, data.attempt.SaveVersion || 0);
      if (data.attempt.Status !== 'In progress') { done(data.attempt); return; }
      persist();
      $('saveState').textContent = version > acknowledged ? 'Saving answers…' : 'All answers saved online';
      status(''); confirmed = true;
    } catch (error) {
      $('saveState').textContent = 'Not yet saved online — retrying';
      status(`${error.message} Keep this page open. The timer continues; reconnect as soon as possible.`);
    } finally { busy = false; }
    if (confirmed && (version > acknowledged || submissionPending)) setTimeout(flush, 0);
  }
  $('showPassword').onclick = () => {
    const show = $('examPassword').type === 'password'; $('examPassword').type = show ? 'text' : 'password';
    $('showPassword').setAttribute('aria-pressed', String(show)); $('showPassword').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); $('eyeSlash').hidden = !show;
  };
  $('examLogin').onsubmit = async event => {
    event.preventDefault(); if (!storageReady) return notice('Enable site storage and reload this page before starting.');
    const button = event.submitter || $('examLogin').querySelector('button[type=submit]'); button.disabled = true;
    try { const data = await request('login', { TestId: $('testId').value.trim(), Reference: $('examReference').value.trim(), Password: $('examPassword').value });
      candidateId = data.CandidateId; sessionStorage.setItem(`exam-candidate:${$('testId').value.trim()}`, candidateId); $('examPassword').value = '';
      const current = await request('session'); render(current.attempt);
    } catch (error) { notice(error.message); } finally { button.disabled = false; }
  };
  $('startExam').onclick = async () => {
    if (!await notice('Start this test now? The timer will keep counting even if this page closes or the internet disconnects.', true)) return;
    $('startExam').disabled = true;
    try { render((await request('start')).attempt); } catch (error) { notice(error.message); } finally { $('startExam').disabled = false; }
  };
  $('submitExam').onclick = async () => {
    if (!await notice('Submit your answers now? You cannot change them after the school server confirms submission.', true)) return;
    submissionPending = true; version = Math.max(version, acknowledged + 1); freezeAnswers(); persist(); flush();
  };
  window.addEventListener('online', flush);
  window.addEventListener('beforeunload', event => { if (attempt?.Status === 'In progress') { persist(); event.preventDefault(); event.returnValue = ''; } });
  setInterval(flush, 15000);
  if (candidateId && storageReady) request('session').then(data => render(data.attempt)).catch(() => { candidateId = ''; status('Sign in with your examination card to resume.'); });
})();
