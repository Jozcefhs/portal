(() => {
  'use strict';
  const workflows = {
    hospitalPatients: ['patients', 'Open patient register'],
    hospitalReception: ['reception', 'Open visit register'],
    hospitalTriage: ['triage', 'Open triage workspace'],
    hospitalConsultations: ['consultations', 'Open consultations'],
    hospitalOrders: ['orders', 'Open clinical orders'],
    hospitalPharmacy: ['pharmacy', 'Open pharmacy'],
    hospitalLaboratory: ['laboratory', 'Open laboratory'],
    hospitalImaging: ['imaging', 'Open imaging'],
    hospitalTheatre: ['theatre', 'Open theatre'],
    hospitalNursing: ['nursing', 'Open nursing handovers'],
    hospitalInpatients: ['inpatients', 'Open ward register'],
    hospitalBilling: ['billing', 'Open billing and payments'],
    hospitalHmo: ['hmo', 'Open insurance claims']
  };
  // Each staff session and branch switch has its own abort signal.
  const sessions = new WeakMap();
  function snapshot(options, refresh) {
    const { signal, key, branchId, fetcher } = options;
    if (!sessions.has(signal)) sessions.set(signal, new Map());
    const cache = sessions.get(signal);
    const id = JSON.stringify([branchId, key]);
    const existing = cache.get(id);
    if (existing && (existing.busy || (!refresh && Date.now() < existing.until))) return existing.promise;
    const entry = { busy: true };
    entry.promise = (async () => {
      const response = await fetcher('/api/staff-hospital', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({ action: 'getModuleDashboard', BranchId: branchId, Module: key })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.message || 'Unable to load the branch figures.');
      return data;
    })().then(data => {
      entry.busy = false;
      entry.until = Date.now() + 60000;
      return data;
    }, error => { cache.delete(id); throw error; });
    cache.set(id, entry);
    return entry.promise;
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function overview(host, tabs, select) {
    const area = element('section', undefined, 'hospital-module-dashboard');
    area.append(element('h2', 'Hospital departments'));
    const grid = element('div', undefined, 'hospital-module-links');
    for (const [key, label] of tabs.filter(([key]) => Object.hasOwn(workflows, key))) {
      const button = element('button', label);
      button.type = 'button';
      button.onclick = () => select(key);
      grid.append(button);
    }
    if (!grid.childElementCount) grid.append(element('p', 'No hospital departments are assigned to this account.'));
    area.append(grid);
    host.replaceChildren(area);
  }
  function mount(host, options) {
    const { key, title, branchId, branchName, selectBranch, signal } = options;
    const [task, action] = workflows[key];
    const area = element('section', undefined, 'hospital-module-dashboard');
    area.dataset.hospitalDashboard = key;
    const header = element('header');
    const heading = element('div');
    heading.append(element('p', branchName || 'Hospital Operations', 'eyebrow'), element('h2', title));
    header.append(heading);
    area.append(header);
    host.replaceChildren(area);
    if (!branchId || branchId === 'all') {
      area.append(element('p', 'Choose a hospital branch to view its dashboard.'));
      const choose = element('button', 'Choose branch');
      choose.type = 'button';
      choose.onclick = selectBranch;
      area.append(choose);
      return;
    }
    const actions = element('div', undefined, 'hospital-module-actions');
    const link = element('a', action, 'btn');
    link.href = '/hospital.html?' + new URLSearchParams({ branch: branchId, task });
    const refresh = element('button', 'Refresh figures');
    refresh.type = 'button';
    actions.append(link);
    if (['orders','laboratory','imaging'].includes(task)) {
      const report = element('a', 'Outstanding investigations report', 'btn');
      report.href = '/hospital.html?' + new URLSearchParams({ branch: branchId, task, report: 'outstanding' });
      actions.append(report);
    }
    if (task === 'pharmacy') {
      const report = element('a', 'Medicine usage report', 'btn');
      report.href = '/hospital.html?' + new URLSearchParams({ branch: branchId, task, report: 'usage' });
      actions.append(report);
      const expiry = element('a', 'Expiring medicine stock report', 'btn');
      expiry.href = '/hospital.html?' + new URLSearchParams({ branch: branchId, task:'stock-control', report:'expiry' });
      actions.append(expiry);
    }
    actions.append(refresh);
    header.append(actions);
    const metrics = element('dl');
    const message = element('p', '', 'muted');
    message.setAttribute('role', 'status');
    area.append(metrics, message);
    async function load(refreshRequested) {
      refresh.disabled = true;
      message.textContent = 'Loading branch figuresâ€¦';
      try {
        const data = await snapshot(options, refreshRequested);
        if (!area.isConnected || signal.aborted) return;
        const cards = [data.total, ...data.metrics].map(({ label, count }) => {
          const card = element('div');
          card.append(element('dt', label), element('dd', count.toLocaleString()));
          return card;
        });
        metrics.replaceChildren(...cards);
        message.textContent = 'Branch register Â· Updated ' + new Date(data.readTime).toLocaleTimeString();
      } catch (error) {
        if (area.isConnected && !signal.aborted) message.textContent = error.message + ' Select Refresh figures to retry.';
      } finally { refresh.disabled = false; }
    }
    refresh.onclick = () => load(true);
    load(false);
  }
  window.DynamaxHospitalDashboards = { has: key => Object.hasOwn(workflows, key), mount, overview };
})();
