(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const scoreStages = [['All', 'All'], ['Draft', 'Draft / changed'], ['Submitted', 'Submitted'], ['Approved', 'Approved']];
  const resultStages = [['All', 'All'], ['Draft', 'Draft'], ['Reviewed', 'Submitted / reviewed'], ['Approved', 'Approved'], ['Published', 'Published'], ['Pending', 'Pending'], ['Withdrawn', 'Withdrawn']];

  function scoreReview(sheet, componentId = '') {
    if (!componentId || ['Approved', 'Locked'].includes(sheet.Status)) return sheet;
    // A freshly checked (even empty) list supersedes older saved review badges.
    const review = Array.isArray(sheet.TestReviewStatus)
      ? sheet.TestReviewStatus.find(row => row.ComponentId === componentId)
      : sheet.ComponentReviews?.[componentId];
    return review || {Status: sheet.Status === 'Submitted' ? 'Submitted' : 'Draft'};
  }
  function scoreStatus(review = {}) {
    if (review.Stale) return 'Draft';
    return ['Approved', 'Locked'].includes(review.Status) ? 'Approved' : review.Status === 'Submitted' ? 'Submitted' : 'Draft';
  }
  function resultStatus(row = {}) {
    if (row.CalculationPending || row.SubjectChangeRecalculationRequired) return 'Pending';
    if (['Published', 'Locked'].includes(row.Status)) return 'Published';
    return ['Reviewed', 'Approved', 'Withdrawn'].includes(row.Status) ? row.Status : 'Draft';
  }
  function counts(rows, statusOf, stages) {
    const result = Object.fromEntries(stages.map(([key]) => [key, 0]));
    result.All = rows.length;
    for (const row of rows) { const key = statusOf(row); result[key] = (result[key] || 0) + 1; }
    return result;
  }
  function badge(key, label = key) {
    return `<span class="academic-workflow-badge workflow-${esc(key.toLowerCase())}">${esc(label)}</span>`;
  }
  // Only consumes the caller's loaded records. No persistence, requests or polling.
  function mount({host, getRows, statusOf, stages, state = {status: 'All'}, unit, onChange = () => {}}) {
    host.classList.add('academic-workflow-filter');
    host.innerHTML = '<label>Status<select data-workflow-status aria-label="Workflow status"></select></label><div class="academic-workflow-counts" data-workflow-counts aria-label="Status counts"></div><p data-workflow-summary role="status" aria-live="polite"></p>';
    const select = host.querySelector('[data-workflow-status]');
    const refresh = () => {
      const rows = getRows(), totals = counts(rows, statusOf, stages);
      if (!stages.some(([key]) => key === state.status)) state.status = 'All';
      select.innerHTML = stages.map(([key, label]) => `<option value="${key}"${state.status === key ? ' selected' : ''}>${esc(label)} (${totals[key]})</option>`).join('');
      host.querySelector('[data-workflow-counts]').innerHTML = stages.map(([key, label]) => `<button type="button" class="academic-workflow-count workflow-${key.toLowerCase()}" data-workflow-stage="${key}" aria-pressed="${state.status === key}">${esc(label)} <strong>${totals[key]}</strong></button>`).join('');
      const visible = state.status === 'All' ? rows : rows.filter(row => statusOf(row) === state.status);
      host.querySelector('[data-workflow-summary]').textContent = `Showing ${visible.length} of ${rows.length} loaded ${unit}. Counts use the selected scope only.`;
      onChange(visible, totals);
      return visible;
    };
    select.onchange = () => { state.status = select.value; refresh(); };
    host.addEventListener('click', event => {
      const button = event.target.closest('[data-workflow-stage]');
      if (button && host.contains(button)) { state.status = button.dataset.workflowStage; refresh(); }
    });
    refresh();
    return {refresh, state};
  }
  root.DynamaxAcademicWorkflow = Object.freeze({scoreStages, resultStages, scoreReview, scoreStatus, resultStatus, counts, badge, mount});
})(globalThis);
