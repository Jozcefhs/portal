(function () {
  'use strict';
  const $ = id => document.getElementById(id), params = new URLSearchParams(location.search);
  const scope = { BranchId: params.get('branch') || 'main', SchoolSection: params.get('section') || 'secondary', CbtTestId: params.get('source') || '' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let copies = [], after = '', busy = false, selected = null;
  const cache = new Map();
  $('remoteAnswers').href = `/exams-admin.html?audience=student&remote=1&${new URLSearchParams({ branch: scope.BranchId, section: scope.SchoolSection, source: scope.CbtTestId })}`;
  async function api(action, extra = {}) {
    const response = await fetch('/api/local-cbt-answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...scope, ...extra, action }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw Error(data.message || 'Answers could not be loaded.');
    return data;
  }
  function render() {
    const search = $('findAnswer').value.trim().toLowerCase();
    const rows = copies.flatMap(copy => copy.Candidates.map(student => ({ ...student, CopyId: copy.CopyId, UploadedAt: copy.UploadedAt })));
    rows.sort((a, b) => a.DisplayName.localeCompare(b.DisplayName) || b.UploadedAt.localeCompare(a.UploadedAt));
    const filtered = rows.filter(row => `${row.DisplayName} ${row.Reference}`.toLowerCase().includes(search));
    $('answerList').innerHTML = rows.length ? `<p>${rows.length} saved answer copies on loaded pages. Separate uploads are retained with their dates.</p><table><thead><tr><th>Student</th><th>Admission number</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>${filtered.map(row => `<tr><td>${escape(row.DisplayName)}</td><td>${escape(row.Reference)}</td><td>${escape(new Date(row.UploadedAt).toLocaleString())}</td><td><button type="button" data-copy="${escape(row.CopyId)}" data-attempt="${escape(row.AttemptId)}">Load answers</button></td></tr>`).join('')}</tbody></table>` : '<p>No local answer copies have been uploaded for this test yet. The original CBT server must upload its saved answers. Score totals alone cannot reconstruct student selections.</p><p>The desktop update adds automatic answer uploads with scores and a separate <strong>Upload saved answers</strong> button under <strong>Mark / Review</strong>. Existing installations need that update before they can upload answers; the original attempts remain on their server.</p>';
    $('moreAnswers').hidden = !after;
  }
  async function load(more = false) {
    if (busy) return;
    busy = true; $('refreshAnswers').disabled = true; $('moreAnswers').disabled = true;
    $('answerStatus').textContent = 'Loading answer list for this test…';
    try {
      const data = await api('list', { After: more ? after : '' });
      copies = more ? [...copies, ...data.copies] : data.copies; after = data.nextAfter;
      $('answerTitle').textContent = data.title || 'Local CBT answers'; render();
      $('answerStatus').textContent = 'Answer list loaded. Choose a student to load their answers.';
    } catch (error) { $('answerStatus').textContent = error.message; }
    finally { busy = false; $('refreshAnswers').disabled = false; $('moreAnswers').disabled = false; }
  }
  $('answerList').addEventListener('click', async event => {
    const button = event.target.closest('button[data-copy]');
    if (!button || busy) return;
    busy = true; button.disabled = true;
    try {
      const key = `${button.dataset.copy}|${button.dataset.attempt}`;
      if (!cache.has(key)) cache.set(key, await api('review', { CopyId: button.dataset.copy, AttemptId: button.dataset.attempt }));
      selected = cache.get(key); $('previewTitle').textContent = `${selected.candidate.DisplayName} — saved answer comparison`;
      $('answerPreview').hidden = false; $('answerPreview').scrollIntoView({ block: 'nearest' });
      $('answerStatus').textContent = 'Saved answers loaded. Select Preview / print answers below.';
    } catch (error) { $('answerStatus').textContent = error.message; }
    finally { busy = false; button.disabled = false; }
  });
  $('printAnswer').addEventListener('click', () => { if (selected) { try { window.DynamaxCbtAnswerComparison.open(selected); } catch (error) { $('answerStatus').textContent = error.message; } } });
  $('refreshAnswers').addEventListener('click', () => load()); $('moreAnswers').addEventListener('click', () => load(true));
  $('findAnswer').addEventListener('input', render);
  if (scope.CbtTestId) load(); else $('answerStatus').textContent = 'Choose Answers / print beside a test in Academic Area → Online CBT.';
})();
