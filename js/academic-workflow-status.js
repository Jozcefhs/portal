(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const scoreStages = [['All', 'All'], ['Draft', 'Draft / changed'], ['Submitted', 'Submitted'], ['Approved', 'Approved']];
  const scoreOverviewStages = [...scoreStages, ['Published', 'Published results']];
  const resultStages = [['All', 'All'], ['Draft', 'Draft'], ['Reviewed', 'Submitted / reviewed'], ['Approved', 'Approved'], ['Published', 'Published'], ['Pending', 'Pending'], ['Withdrawn', 'Withdrawn']];
  let branchSnapshot = null;
  function clearBranchSummary() { branchSnapshot = null; }
  const armKey = row => JSON.stringify([String(row.ClassId ?? '').trim(),String(row.ArmId ?? '').trim()]);
  function publicationArms(rows, componentId = '') {
    const groups = new Map();
    for (const row of rows) {
      if (!row.ArmId || !row.ClassId) continue;
      const endTerm = (row.ResultType || 'End of Term') === 'End of Term';
      if (componentId ? !endTerm && !(row.ComponentIds || []).includes(componentId) : !endTerm) continue;
      // A classroom can have separate mid-term and end-term results. Unfinished
      // end-term results do not mark a published mid-term report as partial.
      const key = JSON.stringify([armKey(row),row.ResultType || 'End of Term']);
      const group = groups.get(key) || {arm:armKey(row),published:0,other:0};
      group.published += Number(row.Published || 0);group.other += Number(row.Other || 0);groups.set(key,group);
    }
    const published = new Set(),partial = new Set();
    for (const group of groups.values()) if (group.published > 0) {
      published.add(group.arm);if(group.other > 0)partial.add(group.arm);
    }
    return {published,partial};
  }
  function branchPublications(key,componentId) {
    return branchSnapshot?.key === key && Array.isArray(branchSnapshot.publications)
      ? publicationArms(branchSnapshot.publications,componentId) : null;
  }
  function branchArmRows(key, componentId, loadedSheets = []) {
    if (branchSnapshot?.key !== key || !branchSnapshot.rows) return null;
    const rows = new Map(branchSnapshot.rows.map(row => [row.SheetId, row]));
    for (const row of loadedSheets) {
      const saved = rows.get(row.SheetId);
      if (!saved?.UpdatedAt || row.UpdatedAt && row.UpdatedAt >= saved.UpdatedAt) rows.set(row.SheetId, row);
    }
    // Retain verified local approvals when the officer moves to another class.
    branchSnapshot.rows = [...rows.values()];
    return [...rows.values()].filter(row => !componentId || (row.AssessmentComponents || []).some(component => component.Id === componentId));
  }

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
  function armCounts(rows, statusOf, stages) {
    const groups = Object.fromEntries(stages.map(([key]) => [key, new Set()]));
    for (const row of rows) {
      const arm = String(row.ArmId ?? '').trim();
      if (!arm) continue;
      // Reusable arm names/definitions can occur in more than one class.
      const identity = JSON.stringify([String(row.ClassId ?? '').trim(), arm]);
      groups.All.add(identity);
      groups[statusOf(row)]?.add(identity);
    }
    return Object.fromEntries(Object.entries(groups).map(([key, arms]) => [key, arms.size]));
  }
  function badge(key, label = key) {
    return `<span class="academic-workflow-badge workflow-${esc(key.toLowerCase())}">${esc(label)}</span>`;
  }
  // Filters consume loaded records. Branch summaries load only on explicit click.
  function mount({host, getRows, statusOf, stages, state = {status: 'All'}, unit, countArms = false, getArmRows = null, branchSummary = null, getPublication = null, onChange = () => {}}) {
    if (branchSummary && branchSnapshot?.key !== branchSummary.key) branchSnapshot = {key:branchSummary.key, rows:null, loading:false, error:'', listeners:new Map()};
    host.classList.add('academic-workflow-filter');
    host.innerHTML = '<label>Status<select data-workflow-status aria-label="Workflow status"></select></label><div class="academic-workflow-counts" data-workflow-counts aria-label="Status counts"></div><p data-workflow-summary role="status" aria-live="polite"></p>';
    if (branchSummary) host.insertAdjacentHTML('beforeend','<button type="button" data-load-branch-arms></button><p data-branch-arms-status role="status"></p>');
    const select = host.querySelector('[data-workflow-status]');
    const refresh = () => {
      const rows = getRows(), totals = counts(rows, statusOf, stages), armRows = getArmRows ? getArmRows() : rows;
      const arms = countArms && armRows ? armCounts(armRows, statusOf, stages) : null;
      const publication = getPublication?.(), publishedRows = publication ? rows.filter(row => publication.published.has(armKey(row))) : [];
      if (getPublication) {
        totals.Published = publishedRows.length;
        if (arms) {
          arms.Published = publication?.published.size ?? null;
          if (publication) arms.All = new Set([...armRows.filter(row=>row.ArmId).map(armKey),...publication.published]).size;
        }
      }
      const armLabel = count => `${count ?? '—'} ${getArmRows ? 'branch ' : ''}${count === 1 ? 'arm' : 'arms'}`;
      if (!stages.some(([key]) => key === state.status)) state.status = 'All';
      select.innerHTML = stages.map(([key, label]) => `<option value="${key}"${state.status === key ? ' selected' : ''}>${esc(label)} (${key === 'Published' && getPublication ? armLabel(publication?.published.size) : `${totals[key]}${countArms ? ` ${totals[key] === 1 ? 'subject' : 'subjects'}, ${armLabel(arms?.[key])}` : ''}`})</option>`).join('');
      host.querySelector('[data-workflow-counts]').innerHTML = stages.map(([key, label]) => key === 'Published' && getPublication
        ? `<button type="button" class="academic-workflow-count workflow-published" data-workflow-stage="Published" aria-pressed="${state.status === key}">${esc(label)}<span class="academic-workflow-arm-count" data-workflow-arm-count="Published">${armLabel(publication?.published.size)}</span></button>`
        : `<button type="button" class="academic-workflow-count workflow-${key.toLowerCase()}" data-workflow-stage="${key}" aria-pressed="${state.status === key}">${esc(label)} <strong>${totals[key]}</strong>${countArms ? ` ${totals[key] === 1 ? 'subject' : 'subjects'}<span class="academic-workflow-arm-count" data-workflow-arm-count="${key}">${armLabel(arms?.[key])}</span>` : ''}</button>`).join('');
      const visible = state.status === 'Published' && getPublication ? publishedRows : state.status === 'All' ? rows : rows.filter(row => statusOf(row) === state.status);
      host.querySelector('[data-workflow-summary]').textContent = `Showing ${visible.length} of ${rows.length} loaded ${unit}.${countArms && getArmRows ? ' Arm counts cover arms with saved subject sheets across all classes in this branch, school section and term, using the selected test and status. Class/classroom filters affect subjects only.' : ''}${arms ? ' Mixed-status arms may appear in more than one group.' : countArms ? ' Load branch-wide arm counts to see totals.' : ' Counts use the selected scope only.'}`;
      if (getPublication && state.status === 'Published') host.querySelector('[data-workflow-summary]').textContent = publication
        ? `${publication.published.size} branch arms have published results for this assessment scope; ${publication.partial.size} also have pending or unpublished result records. Showing ${visible.length} loaded subject sheets from those arms. This does not mean every student or subject is published.`
        : 'Load branch-wide arm counts to check published results. Publication has not been loaded yet.';
      if (branchSummary) {
        const snapshot = branchSnapshot?.key === branchSummary.key ? branchSnapshot : null;
        const button = host.querySelector('[data-load-branch-arms]');
        button.disabled = snapshot?.loading === true;
        button.textContent = snapshot?.loading ? 'Loading branch-wide arm counts…' : snapshot?.rows ? 'Refresh branch-wide arm counts' : 'Load branch-wide arm counts';
        host.querySelector('[data-branch-arms-status]').textContent = snapshot?.error || (snapshot?.rows ? 'Branch review and publication snapshot retained while switching classes. Refresh for changes by other officers.' : 'Loads review and publication status metadata only; no student marks or history.');
      }
      onChange(visible, totals);
      return visible;
    };
    if (countArms && getArmRows && branchSnapshot) {
      for (const target of branchSnapshot.listeners.keys()) if (!target.isConnected) branchSnapshot.listeners.delete(target);
      branchSnapshot.listeners.set(host, refresh);
    }
    select.onchange = () => { state.status = select.value; refresh(); };
    host.addEventListener('click', event => {
      const button = event.target.closest('[data-workflow-stage]');
      if (button && host.contains(button)) { state.status = button.dataset.workflowStage; refresh(); }
    });
    if (branchSummary) host.querySelector('[data-load-branch-arms]').onclick = async () => {
      const snapshot = branchSnapshot;
      if (snapshot?.key !== branchSummary.key || snapshot.loading) return;
      snapshot.loading = true; snapshot.error = ''; refresh();
      try {
        const data = await branchSummary.load();
        if (!Array.isArray(data?.branchReviewSummary?.sheets)) throw new Error('Branch counts were not returned. Try loading them again.');
        snapshot.rows = data.branchReviewSummary.sheets;
        snapshot.publications = Array.isArray(data.branchReviewSummary.publications) ? data.branchReviewSummary.publications : null;
      } catch (error) { snapshot.rows = null; snapshot.publications = null; snapshot.error = error.message || 'Branch counts could not be loaded.'; }
      finally {
        snapshot.loading = false;
        if (branchSnapshot === snapshot) for (const [target, update] of snapshot.listeners) {
          if (target.isConnected) update(); else snapshot.listeners.delete(target);
        }
      }
    };
    refresh();
    return {refresh, state};
  }
  root.DynamaxAcademicWorkflow = Object.freeze({scoreStages, scoreOverviewStages, resultStages, scoreReview, scoreStatus, resultStatus, counts, armCounts, branchArmRows, publicationArms, branchPublications, clearBranchSummary, badge, mount});
})(globalThis);
