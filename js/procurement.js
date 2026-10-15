/* Procurement uses authoritative, branch-scoped stock; vendor stock never enters this workflow. */
(function (global) {
  'use strict';
  const clean = value => String(value ?? '').trim();
  const esc = value => clean(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const number = value => new Intl.NumberFormat('en-NG', { maximumFractionDigits: 3 }).format(Number(value || 0));
  const money = value => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(Number(value || 0));
  const date = value => global.DynamaxTime?.formatDateTime(value) || clean(value).replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const option = (value, label, chosen = '') => `<option value="${esc(value)}"${clean(value) === clean(chosen) ? ' selected' : ''}>${esc(label)}</option>`;
  const input = (name, label, value = '', type = 'text', extra = '') => `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const state = value => `<span class="procurement-state">${esc(clean(value).replaceAll('_', ' ') || '—')}</span>`;
  const notes = (label = 'Reason / notes', required = true) => `<label class="procurement-full">${esc(label)}<textarea name="Notes" maxlength="2000" ${required ? 'required' : ''}></textarea></label>`;
  const isVendorItem = row => !!clean(row.VendorId) || /vendor/i.test(clean(row.OwnershipType || row.OwnerType));
  const key = row => clean(row.ItemId || row.ProcurementItemId || row.__id);
  const itemName = row => clean(row.ItemName || row.Name || row.Title || key(row));
  const requestKey = row => clean(row.RequisitionId || row.RequestId || row.__id);
  const transferKey = row => clean(row.TransferId || row.__id);
  const purchaseKey = row => clean(row.PurchaseId || row.__id);
  const statusKey = row => clean(row.Status).toUpperCase().replaceAll(' ', '_');
  function numeric(value, label, zero = false) {
    const result = Number(value);
    if (!clean(value) || !Number.isFinite(result) || (zero ? result < 0 : result <= 0) || result > 1000000000) throw new Error(`${label} must be ${zero ? 'zero or ' : ''}a positive number no greater than 1,000,000,000.`);
    return result;
  }
  function lineValues(rows, withCost = false, departmentTargets = false) {
    if (!rows.length || rows.length > 20) throw new Error('Add between 1 and 20 items.');
    const seen = new Set();
    return rows.map(row => {
      const ItemId = clean(row.ItemId);
      if (!ItemId || seen.has(ItemId)) throw new Error('Choose each item once; combine repeated quantities into one line.');
      seen.add(ItemId);
      if (departmentTargets && !clean(row.InventoryId)) throw new Error('Choose the matching department stock record for every requested item.');
      return { ItemId, Quantity: numeric(row.Quantity, 'Quantity'), ...(departmentTargets ? { InventoryId: clean(row.InventoryId) } : {}), ...(withCost ? { UnitCost: numeric(row.UnitCost, 'Unit cost', true) } : {}) };
    });
  }
  function filterRows(rows, query) {
    const text = clean(query).toLowerCase();
    return !text ? rows : rows.filter(row => JSON.stringify(row).toLowerCase().includes(text));
  }
  function table(headers, rows, renderRow, empty) {
    if (!rows.length) return `<p class="procurement-empty">${esc(empty)}</p>`;
    const columns = headers.map(header => typeof header === 'string' ? { label: header } : header);
    return `<div class="procurement-table-wrap" tabindex="0" role="region" aria-label="${esc(columns.map(column => column.label).join(', '))}"><table class="procurement-table"><thead><tr>${columns.map(column => `<th scope="col"${column.numeric ? ' class="procurement-number"' : ''}>${esc(column.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(renderRow).join('')}</tbody></table></div>`;
  }
  let mounted;
  function mount(root, options) {
    mounted?.destroy();
    let data = {}, tab = 'requests', query = '', schoolSection = '', disposed = false, busy = false, dialog = null, notice = '';
    const controllers = new Set();
    const cap = () => data.capabilities || {};
    const writable = () => !options.readOnly && data.readOnly !== true;
    const can = name => writable() && cap()[name] === true;
    const items = () => (data.items || []).filter(row => !isVendorItem(row));
    const departments = () => data.departments || [];
    const departmentId = row => clean(row.Key || row.Section || row.DepartmentId || row.key);
    const departmentName = value => clean(departments().find(row => departmentId(row) === value)?.Name || departments().find(row => departmentId(row) === value)?.Label || value);
    const feedback = (message, error = false) => {
      const target = root.querySelector('[data-proc-status]');
      if (target) { target.textContent = message; target.classList.toggle('error', error); }
    };
    function destroy() {
      disposed = true;
      controllers.forEach(controller => controller.abort());
      controllers.clear();
      dialog?.remove();
      dialog = null;
      root.removeEventListener('click', click);
      root.removeEventListener('input', search);
      root.removeEventListener('change', changeScope);
    }
    mounted = { destroy };
    async function call(action, payload = {}, form = null) {
      if (busy || disposed) return null;
      const progress = form?.querySelector('[role="status"]');
      if (form && !form.reportValidity()) return null;
      const serialized = JSON.stringify(payload);
      if (form?.dataset.uncertain && form.dataset.payload !== serialized) {
        progress.textContent = 'The previous response was not received. Refresh this workspace and check its records before changing or resubmitting these entries.';
        return null;
      }
      const readOnlyAction = ['list', 'lookupinventory', 'records', 'recorddetail', 'previewitemimport'].includes(action);
      if (!readOnlyAction) {
        const RequestId = form ? (form.dataset.requestId ||= global.crypto.randomUUID()) : global.crypto.randomUUID();
        payload = { ...payload, RequestId };
        if (form) form.dataset.payload = serialized;
      }
      busy = true;
      const controls = [...(form || root).querySelectorAll('button, input, select, textarea')].map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      if (progress) progress.textContent = action === 'previewitemimport' ? 'Checking every row against existing records…' : readOnlyAction ? 'Finding records…' : form?.dataset.savingMessage || 'Saving…';
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 45000);
      try {
        const result = await options.request(action, payload, controller.signal);
        if (disposed) return null;
        if (form) { delete form.dataset.uncertain; delete form.dataset.requestId; }
        return result;
      } catch (error) {
        if (disposed) return null;
        const uncertain = !error.responseReceived && !readOnlyAction;
        if (form) {
          if (uncertain) form.dataset.uncertain = 'yes';
          else { delete form.dataset.requestId; delete form.dataset.uncertain; }
        }
        const message = `${error.name === 'AbortError' ? 'The request timed out.' : error.message || 'Procurement request failed.'}${uncertain ? ' The server may have saved it. Retry unchanged entries, or refresh and check the records first.' : ''}`;
        if (progress) progress.textContent = message; else feedback(message, true);
        return null;
      } finally {
        clearTimeout(timer); controllers.delete(controller); busy = false;
        controls.forEach(([control, disabled]) => { if (control.isConnected) control.disabled = disabled; });
      }
    }
    async function reload(requestedSchoolSection = schoolSection) {
      const result = await call('list', requestedSchoolSection ? { SchoolSection: requestedSchoolSection } : {});
      if (!result || disposed) return false;
      data = result;
      schoolSection = clean(data.schoolSection || requestedSchoolSection || (data.schoolSections || [])[0]);
      draw();
      return true;
    }
    const itemOptions = selected => option('', 'Choose an organisation-owned item', selected) + items().map(row => option(key(row), `${itemName(row)} · ${row.Unit || 'units'} · ${number(row.Quantity)} central`, selected)).join('');
    const departmentSelect = (value = '') => `<label>Receiving department<select name="Department" required>${option('', 'Choose department', value)}${departments().map(row => option(departmentId(row), row.Name || row.Label || departmentId(row), value)).join('')}</select></label>`;
    const overrideField = () => can('canOverride') ? input('OverrideReason', 'Exceptional self-approval / self-receipt reason (only if needed)', '', 'text', 'maxlength="1000"') : '';
    const lineSummary = row => (row.Lines || []).map(line => `${esc(line.ItemName || items().find(item => key(item) === line.ItemId)?.ItemName || line.ItemId)} × <span class="procurement-number">${number(line.Quantity)}</span>${line.DepartmentItemName ? `<small>Department item: ${esc(line.DepartmentItemName)}</small>` : ''}`).join('<br>');
    function actions(buttons) { return `<div class="procurement-actions">${buttons.join('')}</div>`; }
    const button = (action, id, label) => `<button type="button" data-proc-action="${esc(action)}" data-id="${esc(id)}">${esc(label)}</button>`;
    function drawBody() {
      let rows, html, headers;
      if (tab === 'settings') {
        root.querySelector('[data-proc-count]').textContent = '';
        root.querySelector('[data-proc-body]').innerHTML = `<h3>Central procurement control</h3><p class="procurement-section-note">${data.settings?.Enabled === true ? 'Enabled: organisation-owned stock additions must go through Procurement.' : 'Not enabled: existing department stock controls remain available.'} Existing quantities and historical records are preserved. Vendor-owned stock remains separate. Once an item is linked to Procurement, its direct quantity and unit edits remain protected even if this branch setting is later disabled.</p>${can('canConfigure') ? button('settings', '', 'Configure this branch') : ''}`;
        return;
      } else if (tab === 'stock') {
        rows = filterRows(items(), query);
        headers = ['Item', 'Unit', { label: 'Central stock', numeric: true }, { label: 'Reorder level', numeric: true }, 'Action'];
        html = table(headers, rows, row => `<tr><td><strong>${esc(itemName(row))}</strong><small>${esc(row.ItemCode || key(row))}${row.Category ? ` · ${esc(row.Category)}` : ''}</small></td><td>${esc(row.Unit)}</td><td class="procurement-number">${number(row.Quantity)}</td><td class="procurement-number">${number(row.ReorderLevel)}</td><td>${can('canManage') ? button('edititem', key(row), 'Edit item') : ''}</td></tr>`, 'No central items match. Procurement can add an organisation-owned item to begin.');
      } else if (tab === 'purchases') {
        rows = filterRows(data.purchases || [], query);
        headers = ['Purchase / supplier', 'Items', { label: 'Amount', numeric: true }, 'Status', 'Action'];
        html = table(headers, rows, row => `<tr><td><strong>${esc(row.SupplierName)}</strong><small>${esc(purchaseKey(row))} · ${esc(row.Reference || '')}</small><small>${esc(date(row.CreatedAt))}</small></td><td>${lineSummary(row)}</td><td class="procurement-number">${money(row.TotalAmount ?? row.Amount)}</td><td>${state(row.Status)}</td><td>${actions([button('viewpurchase', purchaseKey(row), 'Details'), ...(can('canApprove') && statusKey(row) === 'PENDING' ? [button('reviewpurchase', purchaseKey(row), 'Review')] : []), ...(can('canManage') && ['APPROVED', 'PARTIALLY_RECEIVED'].includes(statusKey(row)) ? [button('receivepurchase', purchaseKey(row), 'Receive stock')] : [])])}</td></tr>`, 'No purchases match these filters.');
      } else if (tab === 'transfers') {
        rows = filterRows(data.transfers || [], query);
        headers = ['Transfer / department', 'Items', 'Status', 'Action'];
        html = table(headers, rows, row => `<tr><td><strong>${esc(departmentName(row.Department))}</strong><small>${esc(transferKey(row))} · ${esc(row.SchoolSection)}</small><small>${esc(date(row.CreatedAt))}</small></td><td>${lineSummary(row)}${(row.Lines || []).map(line => `<small>${esc(line.ItemName || line.ItemId)}: ${number(line.ReceivedQuantity)} received / ${number(line.Quantity)} issued${Number(line.ReturnedQuantity) ? ` / ${number(line.ReturnedQuantity)} returned centrally` : ''}</small>`).join('')}</td><td>${state(row.Status)}</td><td>${actions([button('viewtransfer', transferKey(row), 'Details'), ...(can('canReceive') && row.CanReceive === true && ['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'DISCREPANCY'].includes(statusKey(row)) ? [button('confirmreceipt', transferKey(row), 'Confirm receipt')] : []), ...(can('canManage') && (row.Lines || []).some(line => Number(line.Quantity) > Number(line.ReceivedQuantity || 0) + Number(line.ReturnedQuantity || 0)) ? [button('returntransfer', transferKey(row), 'Receive back')] : [])])}</td></tr>`, 'No transfers match. Issued stock stays in transit until the receiving department confirms delivery.');
      } else if (tab === 'departments') {
        rows = filterRows((data.departmentInventory || []).filter(row => !isVendorItem(row)), query);
        headers = ['Department / item', 'Unit', { label: 'Available stock', numeric: true }, { label: 'Reorder level', numeric: true }];
        html = table(headers, rows, row => `<tr><td><strong>${esc(itemName(row))}</strong><small>${esc(departmentName(row.Department || row.Section))} · ${esc(row.InventoryId || row.__id)}</small></td><td>${esc(row.Unit)}</td><td class="procurement-number">${number(row.Quantity)}</td><td class="procurement-number">${number(row.ReorderLevel)}</td></tr>`, 'No organisation-owned department stock is listed. Existing vendor-owned products remain in their separate inventory.');
      } else {
        rows = filterRows(data.requests || [], query);
        headers = ['Request / department', 'Items', 'Status', 'Action'];
        html = table(headers, rows, row => `<tr><td><strong>${esc(departmentName(row.Department))}</strong><small>${esc(requestKey(row))} · ${esc(row.RequestedBy || row.CreatedBy)}</small><small>${esc(date(row.CreatedAt))}</small></td><td>${lineSummary(row)}</td><td>${state(row.Status)}</td><td>${actions([button('viewrequest', requestKey(row), 'Details'), ...(can('canReviewRequests') && statusKey(row) === 'PENDING' ? [button('reviewrequest', requestKey(row), 'Review')] : []), ...(can('canManage') && ['APPROVED', 'PARTIALLY_ISSUED'].includes(statusKey(row)) ? [button('issue', requestKey(row), 'Issue stock')] : [])])}</td></tr>`, 'No supply requests match. Departments can request replenishment from the central stock catalogue.');
      }
      const total = tab === 'stock' ? items().length : tab === 'purchases' ? (data.purchases || []).length : tab === 'transfers' ? (data.transfers || []).length : tab === 'departments' ? (data.departmentInventory || []).filter(row => !isVendorItem(row)).length : (data.requests || []).length;
      const paging = data.paging?.[tab];
      root.querySelector('[data-proc-count]').textContent = paging
        ? `${rows.length} of ${total} loaded ${paging.mode === 'history' ? 'history' : 'active'} records shown. ${paging.hasMore ? 'More records are available.' : 'End of this record list.'} Search covers loaded records only.`
        : `${rows.length} of ${total} records shown`;
      root.querySelector('[data-proc-body]').innerHTML = `${html}${paging?.hasMore ? `<div class="procurement-pagination">${button('more', '', 'Load more records')}</div>` : ''}`;
    }
    function draw() {
      if (disposed) return;
      const tabs = [['requests', 'Supply requests'], ['stock', 'Central stock'], ...(cap().canManage || cap().canApprove ? [['purchases', 'Purchases']] : []), ['transfers', 'Deliveries & receipts'], ['departments', 'Department balances'], ...(cap().canConfigure ? [['settings', 'Branch control']] : [])];
      if (!tabs.some(([id]) => id === tab)) tab = 'requests';
      const inTransit = (data.transfers || []).filter(row => ['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'DISCREPANCY'].includes(statusKey(row))).length;
      root.innerHTML = `<section class="procurement-workspace"><header class="procurement-heading"><div><h2>Procurement</h2><p>Purchase centrally, issue supplies and confirm department receipts.</p></div><button type="button" data-proc-action="refresh">Refresh</button></header>
        <p class="procurement-notice" data-proc-status role="status" aria-live="polite">${esc(notice)}</p>
        ${!writable() ? '<p class="procurement-notice">Read-only access: purchasing and stock changes are unavailable.</p>' : ''}
        ${(data.schoolSections || []).length > 1 ? `<div class="procurement-toolbar"><label>School section<select data-proc-school-section>${data.schoolSections.map(value => option(value, value, schoolSection)).join('')}</select></label></div>` : ''}
        <div class="procurement-metrics">${[['Central items', items().length], ['Pending requests loaded', (data.requests || []).filter(row => statusKey(row) === 'PENDING').length], ['Awaiting confirmation loaded', inTransit], ['Low central stock', items().filter(row => Number(row.ReorderLevel) > 0 && Number(row.Quantity || 0) <= Number(row.ReorderLevel)).length]].map(([label, value]) => `<div class="procurement-metric"><span>${esc(label)}</span><strong>${number(value)}</strong></div>`).join('')}</div>
        <nav class="procurement-tabs" role="tablist" aria-label="Procurement workspaces">${tabs.map(([id, label]) => `<button type="button" role="tab" id="proc-tab-${id}" data-proc-tab="${id}" aria-selected="${id === tab}" aria-controls="procurement-content">${esc(label)}</button>`).join('')}</nav>
        <div class="procurement-toolbar"><label>Search <input type="search" data-proc-search value="${esc(query)}" placeholder="Item, department, reference or status" autocomplete="off"></label><div class="procurement-actions">${['stock', 'departments'].includes(tab) && can('canManage') ? button('batchitems', '', 'Batch upload items') : ''}${tab === 'stock' && can('canManage') ? button('newitem', '', 'Add central item') : ''}${tab === 'requests' && can('canRequest') ? button('newrequest', '', 'Request supplies') : ''}${tab === 'purchases' && can('canManage') ? button('newpurchase', '', 'New purchase') : ''}${tab === 'departments' && (can('canRequest') || can('canManage')) ? button('lookupinventory', '', 'Find older department item') : ''}${tab === 'departments' && can('canManage') ? button('newdestination', '', 'Add department item') : ''}</div></div>
        ${['requests', 'purchases', 'transfers'].includes(tab) ? `<label class="procurement-record-view">Record view<select data-proc-record-mode>${option('active', 'Active work', data.paging?.[tab]?.mode || 'active')}${option('history', 'All records (history)', data.paging?.[tab]?.mode || 'active')}</select></label>` : ''}
        ${!departments().length ? '<p class="procurement-notice">No inventory department is enabled for this account and plan. Procurement covers central purchasing; enable the relevant inventory module and grant department access before requesting or receiving supplies.</p>' : ''}
        <p class="procurement-count" data-proc-count aria-live="polite"></p><div id="procurement-content" role="tabpanel" aria-labelledby="proc-tab-${esc(tab)}" data-proc-body></div>
        <p class="procurement-section-note">${tab === 'departments' ? 'These are the existing departmental balances. Older records without a branch tag are not listed until you find them by exact name or record ID. Sales, dispensing and other stock-out operations continue to reduce balances in their own modules. ' : ''}Vendor-owned stock is excluded. Confirming a receipt increases the department balance only; it does not deduct the central stock a second time.</p>
      </section>`;
      drawBody();
    }
    function search(event) {
      if (!event.target.matches('[data-proc-search]')) return;
      query = event.target.value;
      drawBody();
    }
    async function changeScope(event) {
      if (event.target.matches('[data-proc-record-mode]')) {
        if (busy) return;
        const previous = data.paging?.[tab]?.mode || 'active';
        if (!await loadRecords(tab, event.target.value)) event.target.value = previous;
        return;
      }
      if (!event.target.matches('[data-proc-school-section]') || busy) return;
      const previousQuery = query;
      query = '';
      if (!await reload(event.target.value)) {
        // Keep the label, visible records and subsequent forms in the last
        // successfully loaded section if the new section could not be read.
        event.target.value = schoolSection;
        query = previousQuery;
      }
    }
    async function loadRecords(kind, mode, append = false) {
      const page = data.paging?.[kind];
      const result = await call('records', { Kind: kind, Mode: mode, SchoolSection: schoolSection || 'All',
        ...(append && page?.nextCursor ? { Cursor: page.nextCursor } : {}) });
      if (!result || disposed) return false;
      const identify = kind === 'requests' ? requestKey : kind === 'purchases' ? purchaseKey : transferKey;
      const merged = new Map((append ? data[kind] || [] : []).map(row => [identify(row), row]));
      (result.records || []).forEach(row => merged.set(identify(row), row));
      data = { ...data, [kind]: [...merged.values()], paging: { ...data.paging, [kind]: result.paging } };
      if (!append) query = '';
      draw();
      return true;
    }
    async function loadDetail(kind, recordId, title) {
      const result = await call('recorddetail', { Kind: kind, RecordId: recordId, SchoolSection: schoolSection || 'All' });
      if (result?.record) detailDialog(result.record, title);
    }
    function openDialog(title, contents, save, label = 'Save') {
      if (disposed || busy) return;
      dialog?.remove();
      const modal = document.createElement('dialog');
      dialog = modal;
      modal.className = 'procurement-dialog';
      modal.setAttribute('aria-labelledby', 'procurement-dialog-title');
      modal.innerHTML = `<header class="procurement-heading"><h3 id="procurement-dialog-title">${esc(title)}</h3><button type="button" data-proc-close aria-label="Close dialog">×</button></header><form class="procurement-form" autocomplete="off">${contents}<p class="procurement-notice procurement-full" role="status" aria-live="polite"></p><div class="procurement-actions procurement-full"><button type="button" class="secondary" data-proc-close>Close</button>${save ? `<button type="submit">${esc(label)}</button>` : ''}</div></form>`;
      document.body.append(modal);
      const close = () => { if (!busy) { modal.close(); modal.remove(); if (dialog === modal) dialog = null; } };
      modal.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
      modal.querySelectorAll('[data-proc-close]').forEach(element => element.addEventListener('click', close));
      modal.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!save || busy || !form.reportValidity()) return;
        try { await save(Object.fromEntries(new FormData(form)), form); }
        catch (error) { form.querySelector('[role="status"]').textContent = error.message; }
      });
      modal.showModal();
      return modal.querySelector('form');
    }
    async function save(action, payload, form) {
      const result = await call(action, payload, form);
      if (!result) return;
      dialog?.close(); dialog?.remove(); dialog = null;
      notice = result.message || 'Procurement records updated.';
      await reload();
    }
    function lineEditor(form, withCost, initial = [], departmentTargets = false) {
      const holder = form.querySelector('[data-proc-lines]');
      const targetOptions = (node, selected = '') => {
        if (!departmentTargets) return;
        const central = items().find(item => key(item) === node.querySelector('[data-line-item]').value);
        const target = node.querySelector('[data-line-inventory]');
        const department = form.elements.Department.value;
        const rows = (data.departmentInventory || []).filter(row => !isVendorItem(row)
          && clean(row.Department || row.Section) === department
          && (!schoolSection || clean(row.SchoolSection || 'All') === schoolSection)
          && central && clean(row.Unit || 'pcs').toLowerCase() === clean(central.Unit || 'pcs').toLowerCase()
          && (!clean(row.ProcurementItemId) || clean(row.ProcurementItemId) === key(central)));
        target.innerHTML = option('', 'Choose matching department item') + rows.map(row => option(row.InventoryId || row.__id, `${itemName(row)} · ${number(row.Quantity)} ${row.Unit || 'pcs'} available`, selected)).join('');
      };
      const add = row => {
        if (holder.children.length >= 20) return;
        const node = document.createElement('div');
        node.className = `procurement-line${withCost ? ' procurement-line-cost' : ''}`;
        node.dataset.procLine = 'yes';
        node.innerHTML = `<label>Central item<select data-line-item required>${itemOptions(row?.ItemId)}</select></label><label>Quantity<input type="number" data-line-quantity min="0.001" step="0.001" max="1000000000" value="${esc(row?.Quantity || '')}" required></label>${withCost ? `<label>Unit cost<input type="number" data-line-cost min="0" step="0.01" max="1000000000" value="${esc(row?.UnitCost ?? '')}" required></label>` : ''}<button type="button" class="secondary" data-remove-line aria-label="Remove item line">×</button>${departmentTargets ? '<label class="procurement-full">Destination stock record<select data-line-inventory required><option value="">Choose the central item first</option></select></label>' : ''}`;
        node.querySelector('[data-remove-line]').addEventListener('click', () => node.remove());
        if (departmentTargets) {
          node.querySelector('[data-line-item]').addEventListener('change', () => targetOptions(node));
          targetOptions(node, row?.InventoryId);
        }
        holder.append(node);
      };
      form.querySelector('[data-add-line]').addEventListener('click', () => add());
      if (departmentTargets) form.elements.Department.addEventListener('change', () => holder.querySelectorAll('[data-proc-line]').forEach(node => targetOptions(node)));
      (initial.length ? initial : [{}]).forEach(add);
      return () => lineValues([...holder.querySelectorAll('[data-proc-line]')].map(row => ({ ItemId: row.querySelector('[data-line-item]').value, Quantity: row.querySelector('[data-line-quantity]').value, ...(departmentTargets ? { InventoryId: row.querySelector('[data-line-inventory]').value } : {}), ...(withCost ? { UnitCost: row.querySelector('[data-line-cost]').value } : {}) })), withCost, departmentTargets);
    }
    const linesBox = '<div class="procurement-lines procurement-full" data-proc-lines></div><div class="procurement-full"><button type="button" class="secondary" data-add-line>Add another item</button></div>';
    function itemDialog(row = {}) {
      openDialog(row.ItemId ? 'Edit central item' : 'Add central item', `${input('ItemName', 'Item name', row.ItemName, 'text', 'required maxlength="160"')}${input('ItemCode', 'Item code', row.ItemCode, 'text', 'maxlength="80"')}${input('Unit', 'Stock unit', row.Unit || 'pcs', 'text', 'required maxlength="40"')}${input('Category', 'Category', row.Category, 'text', 'maxlength="100"')}${input('ReorderLevel', 'Reorder level', row.ReorderLevel || 0, 'number', 'min="0" step="0.001" required')}<p class="procurement-section-note procurement-full">Central stock starts at zero. Record actual purchases received to add stock. Existing department quantities are not moved or overwritten.</p>`, (fields, form) => save('saveitem', { ...fields, ItemId: key(row), ReorderLevel: numeric(fields.ReorderLevel, 'Reorder level', true), ExpectedRevision: row.Revision || '' }, form), 'Save item');
    }
    function requestDialog() {
      let read;
      const form = openDialog('Request supplies', `${departmentSelect(options.department)}${input('NeededBy', 'Needed by (optional)', '', 'date')}${notes()}<p class="procurement-section-note procurement-full">School section: ${esc(schoolSection || 'All')}. Match each central item to its existing organisation-owned department stock record with the same unit. If absent, create the department item at zero stock first.</p>${linesBox}`, (fields, form) => save('request', { ...fields, SchoolSection: schoolSection || 'All', Lines: read() }, form), 'Submit supply request');
      if (form) read = lineEditor(form, false, [], true);
    }
    function purchaseDialog() {
      let read;
      const form = openDialog('New purchase', `${input('SupplierName', 'Supplier name', '', 'text', 'required maxlength="160"')}${input('Reference', 'Supplier / approval reference', '', 'text', 'required maxlength="160"')}${input('FinanceReference', 'Finance / Accounts reference (optional)', '', 'text', 'maxlength="160"')}${notes('Purchase reason / supporting document reference')}${linesBox}<p class="procurement-section-note procurement-full">Submit for approval before recording stock received. This does not record a supplier payment or duplicate an accounting journal. Process payment separately through Finance / Accounts and enter its reference above.</p>`, (fields, form) => save('createpurchase', { ...fields, Lines: read() }, form), 'Submit purchase for approval');
      if (form) read = lineEditor(form, true);
    }
    function reviewDialog(row, purchase = false) {
      const title = purchase ? 'Review purchase' : 'Review supply request';
      openDialog(title, `<div class="procurement-full">${lineSummary(row)}</div><label>Decision<select name="Decision" required><option value="APPROVED">Approve</option><option value="REJECTED">Reject</option></select></label>${notes('Review / rejection notes')}${overrideField()}`, (fields, form) => save(purchase ? 'reviewpurchase' : 'reviewrequest', { ...fields, ...(purchase ? { PurchaseId: purchaseKey(row) } : { RequisitionId: requestKey(row) }), ExpectedRevision: row.Revision }, form), 'Save review');
    }
    function detailDialog(row, title) {
      openDialog(title, `<dl class="procurement-full">${[['Reference', row.Reference || requestKey(row) || transferKey(row) || purchaseKey(row)], ['Status', row.Status], ['Department', departmentName(row.Department)], ['Supplier', row.SupplierName], ['Requested / recorded by', row.RequestedBy || row.CreatedBy], ['Created', date(row.CreatedAt)], ['Reason / notes', row.Notes], ['Review notes', row.ReviewNotes]].filter(([, value]) => clean(value)).map(([label, value]) => `<dt><strong>${esc(label)}</strong></dt><dd>${esc(value)}</dd>`).join('')}</dl><div class="procurement-full">${lineSummary(row)}</div>${(row.Receipts || []).length ? `<h4 class="procurement-full">Receipt history</h4><ul class="procurement-history procurement-full">${row.Receipts.map(receipt => `<li>${esc(date(receipt.CreatedAt || receipt.ReceivedAt))} · ${esc(receipt.ReceivedBy || receipt.CreatedBy)}<br>${esc(receipt.Notes || '')}</li>`).join('')}</ul>` : ''}`, null);
    }
    function receiptDialog(row, purchase = false, returning = false) {
      const remaining = (row.Lines || []).map((line, index) => ({ ...line, index, Remaining: Number(line.Quantity || 0) - Number(line.ReceivedQuantity || 0) - Number(line.ReturnedQuantity || 0) })).filter(line => line.Remaining > 0);
      const form = openDialog(returning ? 'Receive undelivered stock back centrally' : purchase ? 'Receive purchased stock' : 'Confirm department receipt', `<p class="procurement-section-note procurement-full">${returning ? 'Record only stock physically returned from this delivery to the central store. This cannot return stock already confirmed by the department.' : 'Enter only the additional quantity physically received now, not the cumulative total. Leave undelivered items at zero. Remaining units stay in transit / outstanding.'}</p><div class="procurement-lines procurement-full">${remaining.map(line => `<div class="procurement-line procurement-line-receipt"><div class="procurement-line-info"><strong>${esc(line.ItemName || line.ItemId)}</strong><small>${number(line.Remaining)} outstanding · ${number(line.ReceivedQuantity)} previously received</small></div><label>${returning ? 'Returned now' : 'Received now'}<input type="number" data-receipt-item="${esc(line.ItemId)}" min="0" max="${line.Remaining}" step="0.001" value="0" required></label></div>`).join('')}</div>${notes(returning ? 'Physical return reason / evidence' : 'Receipt / discrepancy notes')}${!purchase && !returning ? '<label class="procurement-check procurement-full"><input type="checkbox" name="Discrepancy">Flag a delivery discrepancy (explain above). This does not automatically return stock.</label>' : ''}${!purchase && !returning ? overrideField() : ''}<label class="procurement-check procurement-full"><input type="checkbox" name="Confirmed" required>I have checked the physical quantities and the notes above.</label>`, (fields, form) => {
        const Lines = [...form.querySelectorAll('[data-receipt-item]')].map(element => ({ ItemId: element.dataset.receiptItem, Quantity: numeric(element.value, 'Received quantity', true) })).filter(line => line.Quantity > 0);
        const Discrepancy = !purchase && !returning && form.elements.Discrepancy.checked;
        if (!Lines.length && !Discrepancy) throw new Error('Enter at least one physical quantity, or flag and explain a delivery discrepancy. Do not confirm stock that has not arrived.');
        return save(returning ? 'returntransfer' : purchase ? 'receivepurchase' : 'confirmreceipt', { Lines, Notes: fields.Notes, ReportDiscrepancy: Discrepancy, OverrideReason: fields.OverrideReason || '', ExpectedRevision: row.Revision, ...(purchase ? { PurchaseId: purchaseKey(row), DeliveryReference: fields.DeliveryReference } : { TransferId: transferKey(row) }) }, form);
      }, returning ? 'Confirm physical return' : purchase ? 'Record stock received' : 'Confirm receipt');
      if (purchase && form) form.insertAdjacentHTML('afterbegin', input('DeliveryReference', 'Unique supplier delivery reference', '', 'text', 'required maxlength="160"'));
      return form;
    }
    function issueDialog(row) {
      const available = (row.Lines || []).map(line => ({ ...line, Remaining: Number(line.Quantity || 0) - Number(line.IssuedQuantity || 0), Stock: items().find(item => key(item) === line.ItemId) })).filter(line => line.Remaining > 0);
      openDialog('Issue department supplies', `<p class="procurement-section-note procurement-full">${esc(departmentName(row.Department))}: issued stock is deducted centrally and held in transit until confirmed by the department.</p><div class="procurement-lines procurement-full">${available.map(line => `<div class="procurement-line procurement-line-receipt"><div class="procurement-line-info"><strong>${esc(line.ItemName || line.Stock?.ItemName || line.ItemId)}</strong><small>${number(line.Remaining)} requested / ${number(line.Stock?.Quantity)} central stock</small></div><label>Issue now<input data-issue-item="${esc(line.ItemId)}" type="number" min="0" max="${Math.max(0, Math.min(line.Remaining, Number(line.Stock?.Quantity || 0)))}" step="0.001" value="0" required></label></div>`).join('')}</div>${notes('Dispatch / handover notes')}`, (fields, form) => {
        const Lines = [...form.querySelectorAll('[data-issue-item]')].map(element => ({ ItemId: element.dataset.issueItem, Quantity: numeric(element.value, 'Issue quantity', true) })).filter(line => line.Quantity > 0);
        if (!Lines.length) throw new Error('Enter at least one available quantity to issue.');
        return save('issue', { RequisitionId: requestKey(row), ExpectedRevision: row.Revision, Lines, Notes: fields.Notes }, form);
      }, 'Issue stock');
    }
    function settingsDialog() {
      openDialog('Central procurement control', `<label>Organisation-owned stock additions<select name="Enabled"><option value="YES"${data.settings?.Enabled === true ? ' selected' : ''}>Use central Procurement</option><option value="NO"${data.settings?.Enabled === true ? '' : ' selected'}>Keep legacy department controls</option></select></label><p class="procurement-section-note procurement-full">This applies to the current branch across its inventory departments. Existing balances stay exactly where they are: no quantities, historical sales or accounts are rewritten. Vendor-owned stock is excluded. Already-linked items remain protected.</p><label class="procurement-check procurement-full"><input type="checkbox" name="ConfirmExistingBalances" required>I have reviewed the existing department balances and want to preserve them without moving or duplicating stock.</label>${notes('Configuration reason')}`, (fields, form) => save('settings', { Enabled: fields.Enabled === 'YES', ConfirmExistingBalances: true, ExpectedRevision: data.settings?.Revision || 0, Notes: fields.Notes }, form), 'Save branch control');
    }
    function destinationDialog() {
      const form = openDialog('Add department item', `<label>Central item<select name="ItemId" required>${itemOptions()}</select></label>${departmentSelect(options.department)}${input('ItemCode', 'Department item code (required for stores)', '', 'text', 'maxlength="80"')}${input('Price', 'Selling price (if applicable)', 0, 'number', 'min="0" step="0.01" required')}${notes('Notes (optional)', false)}<p class="procurement-section-note procurement-full">School section: ${esc(schoolSection || 'All')}. Creates a matching organisation-owned department item at zero stock, using the central item’s name and stock unit. This does not overwrite an existing item or move stock. Submit a supply request, issue it and confirm delivery to replenish.</p>`, (fields, form) => save('savedestination', { ...fields, Price: numeric(fields.Price, 'Selling price', true), SchoolSection: schoolSection || 'All' }, form), 'Create zero-stock department item');
      if (form) {
        const requiredCode = () => { form.elements.ItemCode.required = ['bookstore', 'uniformStore', 'organizationStore'].includes(form.elements.Department.value); };
        form.elements.Department.addEventListener('change', requiredCode);
        requiredCode();
      }
    }
    async function batchItemsDialog() {
      const requestedTab = tab;
      const mode = requestedTab === 'departments' ? 'department' : 'central';
      const scope = schoolSection || 'All';
      let importer;
      try { importer = await (options.loadItemImport ? options.loadItemImport() : import('./procurement-item-import.js')); }
      catch { feedback('The CSV uploader could not be loaded. Refresh and try again.', true); return; }
      if (disposed || busy || tab !== requestedTab || !can('canManage') || scope !== (schoolSection || 'All')) return;
      const { PROCUREMENT_IMPORT_COLUMNS: columns, PROCUREMENT_IMPORT_LIMITS: limits, parseProcurementItemCsv, normalizeProcurementImportRow } = importer;
      const createLabel = mode === 'department' ? 'Create items with opening stock' : 'Create zero-stock items';
      let prepared = null, reading = 0;
      const form = openDialog(`Batch upload ${mode === 'department' ? 'department' : 'central'} items`, `
        <p class="procurement-section-note procurement-full">Branch: ${esc(options.branchId || 'current working branch')}${mode === 'department' ? ` · School section: ${esc(scope)}` : ' · Central catalogue shared within this branch'}. ${mode === 'department' ? 'Creates new organisation-owned department items with the <strong>opening available quantity</strong> entered in the CSV. Use this for stock already held by the department, not a new delivery. Central stock is not increased or deducted.' : 'Creates organisation-owned central catalogue records at <strong>zero stock</strong>.'} Use approved purchases and confirmed deliveries for subsequent restocking. Existing items and vendor-owned stock are never overwritten.</p>
        ${mode === 'department' ? departmentSelect(options.department) : ''}
        <div class="procurement-actions procurement-full"><button type="button" class="secondary" data-proc-import-template>Download CSV template</button></div>
        <label class="procurement-full">Choose CSV file<input type="file" accept=".csv,text/csv" data-proc-import-file data-proc-import-source></label>
        <label class="procurement-full">CSV contents (paste or edit)<textarea rows="7" spellcheck="false" data-proc-import-csv data-proc-import-source aria-describedby="procurement-import-help"></textarea></label>
        <p class="procurement-section-note procurement-full" id="procurement-import-help">Up to ${limits.rows} items, ${Math.round(limits.bytes / 1024)} KB. Columns: ${esc(columns[mode].join(', '))}. ItemName and Unit are required. ${mode === 'department' ? 'QuantityAvailable is the opening balance in the item’s stock unit; blank means 0. Use non-negative numbers with up to 3 decimal places. Price is not required; an optional Price column from older files is still accepted (blank creates a new item with price 0). Matching central items are reused; missing central catalogue entries are created at zero stock. Store departments require an ItemCode.' : 'Use a unique item name and, when supplied, a unique item code. Do not include stock quantities.'} Vendor ownership and branch fields cannot be imported.</p>
        <div class="procurement-actions procurement-full"><button type="button" data-proc-import-preview>Preview and validate</button></div>
        <div class="procurement-full" data-proc-import-results aria-live="polite"></div>
        <label class="procurement-check procurement-full"><input type="checkbox" data-proc-import-confirm required disabled>I have reviewed the preview and want to create ${mode === 'department' ? 'the new items with the opening quantities shown' : 'the new zero-stock items shown'}. Existing items and duplicate rows will be skipped; their stock will not change.</label>`, async (_fields, currentForm) => {
        if (!prepared || !currentForm.querySelector('[data-proc-import-confirm]').checked) throw new Error('Preview the CSV and confirm the new items and opening quantities before importing.');
        currentForm.dataset.savingMessage = `Creating ${prepared.count} validated item${prepared.count === 1 ? '' : 's'}…`;
        const result = await call('importitems', prepared.payload, currentForm);
        if (disposed || !currentForm.isConnected) return;
        if (!result) {
          if (currentForm.dataset.uncertain) {
            currentForm.querySelectorAll('[data-proc-import-source]').forEach(control => { control.disabled = true; });
            if (currentForm.elements.Department) currentForm.elements.Department.disabled = true;
            currentForm.querySelector('[data-proc-import-preview]').disabled = true;
            currentForm.querySelector('button[type="submit"]').textContent = 'Retry unchanged upload';
          } else invalidate(false);
          return;
        }
        dialog?.close(); dialog?.remove(); dialog = null;
        notice = result.message || 'Batch upload completed as previewed. Existing balances were preserved.';
        await reload();
      }, createLabel);
      if (!form) return;
      const csv = form.querySelector('[data-proc-import-csv]');
      const results = form.querySelector('[data-proc-import-results]');
      const confirm = form.querySelector('[data-proc-import-confirm]');
      const submit = form.querySelector('button[type="submit"]');
      const preview = form.querySelector('[data-proc-import-preview]');
      const progress = form.querySelector('[role="status"]');
      function invalidate(clear = true) {
        if (form.dataset.uncertain) return;
        prepared = null; confirm.checked = false; confirm.disabled = true; submit.disabled = true;
        form.querySelectorAll('[data-proc-import-source]').forEach(control => { control.disabled = false; });
        if (form.elements.Department) form.elements.Department.disabled = false;
        preview.disabled = false; submit.textContent = createLabel;
        if (clear) { results.innerHTML = ''; progress.textContent = 'Preview again after changing the CSV or department.'; }
      }
      invalidate(false);
      csv.addEventListener('input', () => { reading += 1; invalidate(); });
      form.elements.Department?.addEventListener('change', () => invalidate());
      form.querySelector('[data-proc-import-file]').addEventListener('change', async event => {
        if (busy || form.dataset.uncertain) return;
        const sequence = ++reading;
        invalidate();
        const file = event.target.files?.[0];
        if (!file) return;
        if (!/\.csv$/i.test(file.name) || file.size > limits.bytes) {
          progress.textContent = `Choose a CSV file no larger than ${Math.round(limits.bytes / 1024)} KB. Existing draft contents have been kept.`; return;
        }
        try {
          const contents = await file.text();
          if (disposed || !form.isConnected || sequence !== reading || busy) return;
          csv.value = contents;
          progress.textContent = `${file.name} loaded. Preview to check each row before uploading.`;
        } catch { if (sequence === reading) progress.textContent = 'The selected file could not be read. Choose it again or paste its CSV contents.'; }
      });
      form.querySelector('[data-proc-import-template]').addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob(['\ufeff' + columns[mode].join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = `procurement-${mode}-items.csv`;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      preview.addEventListener('click', async () => {
        if (busy || form.dataset.uncertain) return;
        reading += 1;
        invalidate(false); progress.textContent = ''; results.innerHTML = '';
        if (mode === 'department' && !form.elements.Department.reportValidity()) return;
        try {
          const rows = parseProcurementItemCsv(csv.value, mode);
          const invalid = rows.map(row => ({ ...row, errors: normalizeProcurementImportRow(row, mode).errors })).filter(row => row.errors.length);
          if (invalid.length) {
            results.innerHTML = `<ul class="procurement-import-errors">${invalid.map(row => `<li>Row ${esc(row.RowNumber)}: ${row.errors.map(esc).join('; ')}</li>`).join('')}</ul>`;
            progress.textContent = 'Correct the listed rows, then preview again. Nothing has been saved.'; return;
          }
          const payload = { ImportMode: mode, Rows: rows, ...(mode === 'department' ? { Department: form.elements.Department.value, SchoolSection: scope } : {}) };
          // Preview is a read-only API request. Keep confirmation disabled during it.
          const result = await call('previewitemimport', payload, form);
          if (disposed || !form.isConnected) return;
          if (!result) { if (!progress.textContent) progress.textContent = 'The preview could not be checked. Nothing was uploaded; try Preview and validate again.'; return; }
          const summary = result.summary || {};
          const byRow = new Map(rows.map(row => [Number(row.RowNumber), row]));
          const showPrice = mode === 'department' && rows.some(row => clean(row.Price));
          const headers = [{ label: 'CSV row', numeric: true }, 'Item / unit', { label: 'Reorder level', numeric: true }, ...(mode === 'department' ? [{ label: 'Available quantity', numeric: true }] : []), ...(showPrice ? [{ label: 'Price (optional)', numeric: true }] : []), 'Result'];
          results.innerHTML = `<p class="procurement-section-note">${number(summary.ready)} ready · ${number(summary.skipped)} skipped · ${number(summary.errors)} with errors. New central items: ${number(summary.newCentral)}${mode === 'department' ? ` · New department items: ${number(summary.newDepartment)}. Opening quantities below apply only to new department items; skipped balances remain unchanged` : ''}. New central stock balances: 0.</p>` + table(headers, result.rows || [], row => {
            const raw = byRow.get(Number(row.RowNumber)) || {};
            return `<tr><td class="procurement-number">${esc(row.RowNumber)}</td><td><strong>${esc(row.ItemName)}</strong><small>${esc(row.ItemCode || 'No code')} · ${esc(row.Unit)}</small></td><td class="procurement-number">${number(raw.ReorderLevel)}</td>${mode === 'department' ? `<td class="procurement-number">${number(row.QuantityAvailable ?? raw.QuantityAvailable)}</td>` : ''}${showPrice ? `<td class="procurement-number">${money(raw.Price)}</td>` : ''}<td><span class="procurement-state">${esc(row.status)}</span>${row.message ? `<small>${esc(row.message)}</small>` : ''}${(row.errors || []).map(error => `<small class="procurement-import-error">${esc(error)}</small>`).join('')}</td></tr>`;
          }, 'No item rows to import.');
          if (result.canImport && Number(summary.ready) > 0 && !Number(summary.errors) && clean(result.PreviewFingerprint)) {
            prepared = { count: summary.ready, payload: { ...payload, PreviewFingerprint: result.PreviewFingerprint } };
            confirm.disabled = false; submit.disabled = false;
            progress.textContent = `Review the preview, then tick the confirmation to create the new items${mode === 'department' ? ' with their opening quantities' : ' at zero stock'}. Existing stock quantities will not change.`;
          } else progress.textContent = Number(summary.errors) ? 'Correct all errors and preview again. Nothing has been saved.' : 'All rows already exist or were skipped. There are no new items to upload.';
        } catch (error) { progress.textContent = error.message || 'The CSV could not be read. Check the template and preview again.'; }
      });
    }
    function lookupInventoryDialog() {
      openDialog('Find older department item', `${departmentSelect(options.department)}${input('ItemName', 'Exact item name', '', 'text', 'maxlength="160"')}${input('InventoryId', 'Exact record ID (optional alternative)', '', 'text', 'maxlength="160"')}<p class="procurement-section-note procurement-full">School section: ${esc(schoolSection || 'All')}. Find an existing organisation-owned stock record by its exact name or ID. This does not create, adopt or change stock. Found records are available for this view until refreshed or switched to another section.</p>`, async (fields, form) => {
        if (!clean(fields.ItemName) && !clean(fields.InventoryId)) throw new Error('Enter the exact item name or record ID.');
        const result = await call('lookupinventory', { ...fields, SchoolSection: schoolSection || 'All' }, form);
        if (!result) return;
        const found = (result.departmentInventory || []).filter(row => !isVendorItem(row) && clean(row.Department) === clean(fields.Department)
          && clean(row.SchoolSection || 'All') === (schoolSection || 'All'));
        const merged = new Map((data.departmentInventory || []).map(row => [`${row.Department}:${row.InventoryId}`, row]));
        found.forEach(row => merged.set(`${row.Department}:${row.InventoryId}`, row));
        data = { ...data, departmentInventory: [...merged.values()] };
        dialog?.close(); dialog?.remove(); dialog = null;
        notice = found.length ? `${found.length} existing department item${found.length === 1 ? '' : 's'} found. You can now select ${found.length === 1 ? 'it' : 'them'} in a supply request. No stock was changed.` : 'No matching organisation-owned department items were found.';
        query = ''; tab = 'departments'; draw();
      }, 'Find existing item');
    }
    async function click(event) {
      const target = event.target.closest('[data-proc-action], [data-proc-tab]');
      if (!target || !root.contains(target) || busy) return;
      if (target.dataset.procTab) { tab = target.dataset.procTab; query = ''; draw(); root.querySelector(`[data-proc-tab="${tab}"]`)?.focus(); return; }
      const id = target.dataset.id, action = target.dataset.procAction;
      if (action === 'refresh') { notice = ''; await reload(); return; }
      if (action === 'more' && data.paging?.[tab]?.hasMore) return loadRecords(tab, data.paging[tab].mode, true);
      if (action === 'newitem' && can('canManage')) return itemDialog();
      if (action === 'batchitems' && ['stock', 'departments'].includes(tab) && can('canManage')) return batchItemsDialog();
      if (action === 'edititem' && can('canManage')) return itemDialog(items().find(row => key(row) === id));
      if (action === 'newrequest' && can('canRequest')) return requestDialog();
      if (action === 'newpurchase' && can('canManage')) return purchaseDialog();
      if (action === 'settings' && can('canConfigure')) return settingsDialog();
      if (action === 'newdestination' && can('canManage')) return destinationDialog();
      if (action === 'lookupinventory' && (can('canRequest') || can('canManage'))) return lookupInventoryDialog();
      const request = (data.requests || []).find(row => requestKey(row) === id);
      const purchase = (data.purchases || []).find(row => purchaseKey(row) === id);
      const transfer = (data.transfers || []).find(row => transferKey(row) === id);
      if (action === 'viewrequest' && request) return loadDetail('requests', id, 'Supply request');
      if (action === 'viewpurchase' && purchase) return loadDetail('purchases', id, 'Purchase');
      if (action === 'viewtransfer' && transfer) return loadDetail('transfers', id, 'Delivery');
      if (action === 'reviewrequest' && request && can('canReviewRequests')) return reviewDialog(request);
      if (action === 'reviewpurchase' && purchase && can('canApprove')) return reviewDialog(purchase, true);
      if (action === 'issue' && request && can('canManage')) return issueDialog(request);
      if (action === 'receivepurchase' && purchase && can('canManage')) return receiptDialog(purchase, true);
      if (action === 'confirmreceipt' && transfer && can('canReceive') && transfer.CanReceive === true) return receiptDialog(transfer);
      if (action === 'returntransfer' && transfer && can('canManage')) return receiptDialog(transfer, false, true);
    }
    root.addEventListener('click', click);
    root.addEventListener('input', search);
    root.addEventListener('change', changeScope);
    root.innerHTML = '<p class="procurement-notice" data-proc-status role="status">Loading Procurement…</p>';
    reload();
    return { reload, destroy };
  }
  global.DynamaxProcurement = { mount, unmount() { mounted?.destroy(); mounted = null; }, lineValues, filterRows, isVendorItem };
})(window);
