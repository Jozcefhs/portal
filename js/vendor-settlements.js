/* Shared-server vendor workflow; this client never calculates payable amounts. */
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const money = v => new Intl.NumberFormat('en-NG', { style:'currency', currency:'NGN' }).format(Number(v || 0));
  const today = () => new Date().toISOString().slice(0, 10);
  const option = (value, label = value, selected = '') => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
  const input = (name, label, value = '', type = 'text', extra = '') => `<label>${esc(label)}<input name="${esc(name)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const select = (name, label, values, chosen = '') => `<label>${esc(label)}<select name="${esc(name)}">${values.map(v => Array.isArray(v) ? option(v[0], v[1], chosen) : option(v, v, chosen)).join('')}</select></label>`;
  const metrics = balance => `<div class="vendor-metrics">${['GrossSales','Refunds','SchoolDeductions','NetEntitlement','Paid','Reserved','Outstanding','Available'].map(key =>
    `<div class="vendor-metric"><span>${esc(({ GrossSales:'Confirmed sales', SchoolDeductions:'Organisation deductions', NetEntitlement:'Net entitlement', Reserved:'Reserved in requests', Available:'Available to request' })[key] || key)}</span><strong>${money(balance?.[key])}</strong></div>`).join('')}</div>`;
  const ruleFields = (rule = {}, inherited = false) => `<fieldset class="vendor-rule vendor-full"><legend>Agreed settlement rule</legend><div class="vendor-form">
    ${select('RuleMode','Payment arrangement',[...(inherited ? ['Inherit default'] : []),'Full payment','Percentage','Fixed charge'],rule.Mode || (inherited ? 'Inherit default' : 'Full payment'))}
    ${input('EffectiveDate','Effective from (prospective only)',today(),'date','required')}
    ${input('Rate','Commission (%)',rule.Rate || 0,'number','min="0" max="100" step="0.01" data-rule="Percentage"')}
    ${input('FixedAmount','Fixed charge',Number(rule.FixedCents || 0) / 100,'number','min="0" step="0.01" data-rule="Fixed charge"')}
    ${select('Basis','Fixed-charge basis',['Per sale','Per period'],rule.Basis || 'Per sale')}
    ${select('Cycle','Period schedule',['Daily','Weekly','Monthly'],rule.Cycle || 'Monthly')}
    <small class="vendor-full">Full payment retains no charge, even if the default does. Charges are capped at confirmed sales after refunds. A period charge is deducted once across sales, not once per request; its first sale fixes that period’s rule. Per-sale deductions reverse proportionally on refund.</small>
  </div></fieldset>`;
  const formBody = form => {
    const body = Object.fromEntries(new FormData(form));
    if (body.RuleMode) { body.Rule = { Mode:body.RuleMode, Rate:body.Rate, FixedAmount:body.FixedAmount, Basis:body.Basis, Cycle:body.Cycle, EffectiveDate:body.EffectiveDate };
      ['RuleMode','Rate','FixedAmount','Basis','Cycle','EffectiveDate'].forEach(key => delete body[key]); }
    return body;
  };
  function ruleVisibility(form) {
    if (!form.elements.RuleMode) return;
    const mode = form.elements.RuleMode.value;
    form.querySelectorAll('[data-rule]').forEach(el => { el.closest('label').hidden = el.dataset.rule !== mode; });
    ['Basis','Cycle'].forEach(name => { form.elements[name].closest('label').hidden = mode !== 'Fixed charge' || name === 'Cycle' && form.elements.Basis.value !== 'Per period'; });
  }
  let mounted;
  function mount(root, request) {
    mounted?.destroy();
    let data, tab = 'balances', statement, selected = '', busy = false, notice = '', disposed = false, dialog, statementGeneration = 0;
    const pending = new Set();
    const status = (message, error = false) => { const el = root.querySelector('.vendor-status'); if (el) { el.textContent = message; el.classList.toggle('error', error); } };
    async function call(action, body = {}, form) {
      if (busy || disposed) return null;
      busy = true;
      const controller = new AbortController(); pending.add(controller);
      const submit = form?.querySelector('[type=submit]'); if (submit) { submit.disabled = true; submit.textContent = 'Processing…'; }
      const timer = setTimeout(() => controller.abort(), 45000);
      try {
        if (!['bootstrap','statement','previewHistorical','previewProductImport','saveVendor','saveProduct','saveSettings'].includes(action)) {
          body.RequestId ||= form ? (form.dataset.requestId ||= crypto.randomUUID()) : crypto.randomUUID();
        }
        return await request(action, body, controller.signal);
      } catch (error) {
        if (disposed) return null;
        const message = error.name === 'AbortError' ? 'Request timed out. Refresh before retrying: the server may already have recorded it.' : error.message;
        const target = form?.querySelector('[role=status]'); if (target) target.textContent = message; else status(message, true);
        return null;
      } finally { clearTimeout(timer); pending.delete(controller); busy = false; if (submit?.isConnected) { submit.disabled = false; submit.textContent = submit.dataset.label || 'Save'; } }
    }
    async function reload() {
      const result = await call('bootstrap'); if (!result || disposed || !root.isConnected) return;
      data = result; if (!data.vendors.some(v => v.VendorId === selected)) selected = data.vendors[0]?.VendorId || '';
      draw(); if (tab === 'statement') await loadStatement();
    }
    function vendorOptions(chosen = selected, empty = false) { return `${empty ? option('','Organisation-owned stock',chosen) : ''}${data.vendors.map(v => option(v.VendorId,v.Name,chosen)).join('')}`; }
    async function productImportDialog() {
      if (busy || disposed) return;
      let csv;
      try { csv = await import('./vendor-product-import.js'); }
      catch { return status('Could not load the CSV tools. Refresh this page and try again.',true); }
      if (disposed) return;
      dialog?.remove();
      const modal = document.createElement('dialog'); dialog = modal; modal.className = 'vendor-dialog vendor-import-dialog';
      modal.innerHTML = `<div class="vendor-header"><h3>Batch products & owners</h3><button type="button" data-close aria-label="Close">×</button></div>
        <form class="vendor-form">
          ${select('Mode','What would you like to do?',[['assign','Assign owners to existing products'],['create','Create new products']],'assign')}
          <label>Completed CSV<input name="File" type="file" accept=".csv,text/csv"></label>
          <p class="vendor-full" data-help></p>
          <div class="vendor-actions vendor-full"><a class="vendor-download" data-template download></a><a class="vendor-download" data-owners download>Download vendor IDs</a><button type="button" data-preview>Preview CSV</button></div>
          <p class="vendor-full vendor-status" role="status" aria-live="polite"></p>
          <div class="vendor-table-wrap vendor-full" data-preview-table></div>
          <label class="vendor-check vendor-full"><input type="checkbox" name="Confirmed" disabled> I have checked the products and owners shown in this preview.</label>
          <button type="submit" class="vendor-full" data-label="Import confirmed rows" disabled>Import confirmed rows</button>
        </form>`;
      document.body.append(modal); modal.showModal();
      const form = modal.querySelector('form'), progress = form.querySelector('[role=status]'), table = form.querySelector('[data-preview-table]');
      const submit = form.querySelector('[type=submit]'), previewButton = form.querySelector('[data-preview]');
      let batches = [], previews = [], requestIds = [], next = 0, running = false, complete = false, changed = false;
      let downloadUrls = [];
      const totals = { created:0, assigned:0, skipped:0 };
      const say = message => { progress.textContent = message; };
      function controls() {
        for (const name of ['Mode','File']) form.elements[name].disabled = running || next > 0;
        previewButton.disabled = running || next > 0;
        form.elements.Confirmed.disabled = running || !previews.length || !previews.every(p => p.valid) || complete;
        submit.disabled = running || complete || !form.elements.Confirmed.checked || form.elements.Confirmed.disabled;
        modal.querySelector('[data-close]').disabled = running;
      }
      function reset() {
        batches = []; previews = []; requestIds = []; next = 0; complete = false;
        Object.keys(totals).forEach(key => { totals[key] = 0; });
        form.elements.Confirmed.checked = false; table.innerHTML = ''; controls(); say('');
        const assign = form.elements.Mode.value === 'assign';
        form.querySelector('[data-template]').textContent = assign ? 'Download existing products' : 'Download new-product template';
        form.querySelector('[data-help]').textContent = assign
          ? 'Download existing products, fill in Owner using a registered vendor ID / name (or ORGANISATION), and upload. Keep stock IDs unchanged. Stock, prices, and past sales are not changed.'
          : 'Enter new products and registered owners. Existing matching stock is skipped, never overwritten. Identical products from different owners receive separate stock records.';
        setDownloadLinks(assign);
      }
      function downloadLink(el, filename, contents) {
        const url = URL.createObjectURL(new Blob([contents],{type:'text/csv;charset=utf-8'}));
        downloadUrls.push(url); el.href = url; el.download = filename;
      }
      function setDownloadLinks(assign) {
        downloadUrls.forEach(url => URL.revokeObjectURL(url)); downloadUrls = [];
        const rows = assign ? data.products.map(p => ({ ...p, Store:p.Section, Owner:p.VendorId || 'ORGANISATION',
          CurrentOwner:data.vendors.find(v => v.VendorId === p.VendorId)?.Name || p.VendorId || 'Organisation' })) : [];
        downloadLink(form.querySelector('[data-template]'),assign ? 'existing-product-owners.csv' : 'new-products.csv',csv.productCsv(assign
          ? ['InventoryId','ItemCode','ItemName','Store','SchoolSection','CurrentOwner','Owner']
          : ['ItemCode','ItemName','Owner','Store','Quantity','Price','Category','Unit','Active','SchoolSection'],rows));
        downloadLink(form.querySelector('[data-owners]'),'registered-vendor-ids.csv',csv.productCsv(['Owner','Name','SchoolSection'],
          data.vendors.filter(v => v.Active !== 'NO').map(v => ({Owner:v.VendorId,Name:v.Name,SchoolSection:v.SchoolSection}))));
      }
      form.elements.Mode.onchange = reset; form.elements.File.onchange = reset;
      form.elements.Confirmed.onchange = controls;
      previewButton.onclick = async () => {
        const file = form.elements.File.files[0];
        if (!file) return say('Choose a completed CSV first. Maximum 1,000 rows / 512 KB.');
        reset(); running = true; controls();
        try {
          if (file.size > csv.PRODUCT_IMPORT_LIMITS.bytes) throw new Error('CSV exceeds 512 KB. Split it into smaller files.');
          batches = csv.productChunks(csv.parseProductCsv(await file.text(),form.elements.Mode.value));
          for (let i = 0; i < batches.length; i++) {
            say(`Checking batch ${i + 1} of ${batches.length}… No products have been saved.`);
            const result = await call('previewProductImport',{Mode:form.elements.Mode.value,Rows:batches[i]},form);
            if (!result || disposed || !modal.isConnected) { previews = []; return; }
            previews.push(result);
          }
          const duplicates = csv.duplicatePreviewRows(previews);
          for (const preview of previews) for (const row of preview.rows) if (duplicates.has(row.RowNumber)) {
            row.Errors.push('Duplicate stock record in this CSV. Keep only one row per product.'); row.Status = 'Error'; preview.valid = false;
          }
          const rows = previews.flatMap(p => p.rows), errors = rows.filter(r => r.Errors.length).length;
          table.innerHTML = `<table class="vendor-table"><thead><tr><th>CSV row / product</th><th>Owner change</th><th>Stock / price (kept for existing products)</th><th>Action / errors</th></tr></thead><tbody>${rows.map(r =>
            `<tr class="${r.Errors.length ? 'vendor-import-error' : ''}"><td>${r.RowNumber} · ${esc(r.ItemName)}<small>${esc(r.InventoryId || r.ItemCode)} · ${esc(r.Section)}</small></td>
            <td>${esc(r.CurrentOwner)} → <strong>${esc(r.Owner)}</strong><small>${esc(r.SchoolSection)}</small></td><td>${esc(r.Quantity)} · ${money(r.Price)}</td><td>${esc(r.Status)}<small>${r.Errors.map(esc).join(' ')}</small></td></tr>`).join('')}</tbody></table>`;
          requestIds = batches.map(() => crypto.randomUUID());
          say(errors ? `${errors} row(s) need correction. Nothing has been saved. Correct the CSV and preview again.`
            : `${rows.length} rows checked: ${rows.filter(r => r.Status === 'Assign owner').length} owner changes, ${rows.filter(r => r.Status === 'Create').length} new products. Other rows will be kept unchanged. Confirm to import in batches of 20.`);
        } catch (error) { previews = []; say(error.message); }
        finally { running = false; controls(); }
      };
      form.onsubmit = async event => {
        event.preventDefault(); if (running || submit.disabled) return;
        running = true; controls();
        try {
          while (next < batches.length) {
            say(`Saving batch ${next + 1} of ${batches.length}… ${next * csv.PRODUCT_IMPORT_LIMITS.batch} earlier rows completed.`);
            const result = await call('importProducts',{Mode:form.elements.Mode.value,Rows:batches[next],Confirmed:true,
              PreviewDigest:previews[next].PreviewDigest,RequestId:requestIds[next]},form);
            if (!result || disposed || !modal.isConnected) {
              if (!disposed) say(`${progress.textContent} Completed ${next} of ${batches.length} batches. Use Import to safely retry this batch. If stock / owner details changed, close and load a fresh preview; earlier completed batches remain saved.`);
              return;
            }
            for (const key of Object.keys(totals)) totals[key] += Number(result[key] || 0);
            next++; changed = true;
          }
          complete = true; say(`Complete: ${totals.assigned} owners assigned, ${totals.created} products created, ${totals.skipped} unchanged. Stock and past sales were preserved.`);
        } finally { running = false; controls(); }
      };
      modal.querySelector('[data-close]').onclick = () => { if (!running) modal.close(); };
      modal.addEventListener('cancel',event => { if (running) event.preventDefault(); });
      modal.addEventListener('close',() => { downloadUrls.forEach(url => URL.revokeObjectURL(url)); modal.remove(); if (changed && !disposed) reload(); });
      reset();
    }
    function showDialog(title, html, action, transform = b => b) {
      dialog?.remove(); const modal = document.createElement('dialog'); dialog = modal; modal.className = 'vendor-dialog';
      modal.innerHTML = `<div class="vendor-header"><h3>${esc(title)}</h3><button type="button" data-close aria-label="Close">×</button></div><form class="vendor-form">${html}
        <p class="vendor-full vendor-status" role="status"></p><button type="submit" class="vendor-full" data-label="${esc(title)}">${esc(title)}</button></form>`;
      document.body.append(modal); modal.showModal(); modal.querySelector('[data-close]').onclick = () => modal.close();
      modal.addEventListener('close', () => modal.remove());
      const form = modal.querySelector('form'); ruleVisibility(form); form.onchange = () => ruleVisibility(form);
      form.onsubmit = async event => { event.preventDefault(); const result = await call(action, transform(formBody(form)), form);
        if (result && !disposed) { notice = result.message; modal.close(); await reload(); } };
    }
    const auth = () => input('approvalPassword','Confirm with your current password','','password','autocomplete="current-password" required');
    const notes = () => `<label class="vendor-full">Reason / notes<textarea name="Notes" rows="2" maxlength="2000" required></textarea></label>`;
    const paymentFields = (value = 0) => `${input('Amount','Amount',value,'number','min="0.01" step="0.01" required')}${input('Date','Date',today(),'date','required')}
      ${select('PaymentAccount','Cash / bank account',[['1020','1020 · Bank'],['1010','1010 · Cash'],['1030','1030 · Clearing']])}
      ${select('PaymentMethod','Method',['Bank Transfer','Cash','POS / Card'])}${input('Reference','Payment / refund reference','','text','required maxlength="200"')}
      ${input('EvidenceReference','Evidence reference (bank slip / document)','','text','required maxlength="2000"')}`;
    function vendorForm(v = {}) {
      const chosen = v.RuleHistory?.at(-1) || {}, vendorId = v.VendorId || `VND-${crypto.randomUUID()}`;
      showDialog(v.VendorId ? 'Save vendor' : 'Register vendor', `${input('Name','Vendor name',v.Name,'text','required maxlength="160"')}${input('ContactPerson','Contact person',v.ContactPerson)}
        ${input('Phone','Phone',v.Phone,'tel')}${input('Email','Email',v.Email,'email')}${input('LoginUsername','Restricted Vendor User login (optional)',v.LoginUsername)}
        ${select('SupplierId','Link existing supplier (optional)',[['','Separate sales vendor'],...(data.suppliers || []).map(s => [s.SupplierId,s.Name])],v.SupplierId)}
        ${data.capabilities.edition === 'school' ? select('SchoolSection','School section',['Primary','Secondary'],v.SchoolSection || (data.capabilities.section === 'Primary' ? 'Primary' : 'Secondary')) : ''}
        ${select('Active','Active',['YES','NO'],v.Active || 'YES')}${input('BankName','Bank name',v.BankName)}${input('BankAccountName','Account name',v.BankAccountName)}
        <label class="vendor-check vendor-full"><input name="PosEnabled" type="checkbox" ${v.PosEnabled !== false ? 'checked' : ''}> Allow this vendor login to sell its assigned products at the counter</label>
        ${input('BankAccountNumber',`Account number${v.BankAccountMasked ? ` (saved ${v.BankAccountMasked}; blank keeps it)` : ''}`,'','text','inputmode="numeric" pattern="[0-9]{6,34}"')}
        ${v.VendorId ? '<label class="vendor-check vendor-full"><input name="ChangeRule" type="checkbox"> Change the payment arrangement prospectively (leave unchecked for contact or bank changes only)</label>' : ''}${ruleFields(chosen,true)}`,
        'saveVendor', b => { if (v.VendorId && !b.ChangeRule) delete b.Rule; delete b.ChangeRule; return { ...b, PosEnabled:!!b.PosEnabled, VendorId:vendorId, RecordVersion:v.RecordVersion }; });
    }
    function productForm(p = {}) {
      const stockId = p.InventoryId || `ITEM-${crypto.randomUUID()}`;
      showDialog('Save product ownership', `${input('ItemName','Item name',p.ItemName,'text','required')}<label>Owner<select name="VendorId">${vendorOptions(p.VendorId || '',true)}</select></label>
        ${select('Section','Store',data.capabilities.edition === 'school' ? [['tuckShop','Tuck shop']] : [['organizationStore','Organisation store'],['restaurant','Restaurant']],p.Section)}
        ${input('Quantity','Stock available',p.Quantity || 0,'number','min="0" step="1" required')}${input('Price','Selling price',p.Price || 0,'number','min="0.01" step="0.01" required')}
        ${input('Category','Category',p.Category || 'General Item')}${input('Unit','Unit',p.Unit || 'pcs')}${select('Active','Active',['YES','NO'],p.Active || 'YES')}
        <small class="vendor-full">Separate stock records are used for identical products from different vendors. Ownership changes affect new sales only.</small>`, 'saveProduct',
        b => ({ ...b, InventoryId:stockId, RecordVersion:p.RecordVersion }));
    }
    function print(title, html) {
      const win = window.open('','_blank'); if (!win) return status('Allow pop-ups to print the statement.',true);
      win.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>body{font:14px Arial;color:#143652;padding:24px}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ccd}small{display:block}button{padding:10px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save as PDF</button><h1>${esc(title)}</h1><p>Branch: ${esc(data.capabilities.branchId)} · Generated ${esc(new Date().toLocaleString())}</p>${html}</body></html>`);
      win.document.close();
    }
    function requestCard(r) {
      const c = data.capabilities, next = ({ Submitted:c.confirm && 'Accounts Confirmed', 'Accounts Confirmed':c.review && 'Admin Reviewed', 'Admin Reviewed':c.approve && 'Approved' })[r.Status];
      return `<article class="vendor-card"><h3>${esc(r.VendorName)}</h3><span class="vendor-badge">${esc(r.Status)} · ${esc(r.PaymentStatus)}</span><small>${esc(r.SettlementId)} · revision ${r.Revision}</small>
        <p>${money(r.Amount)} requested · ${money(r.Paid)} paid<br>${esc(r.From)} — ${esc(r.To)}</p><div class="vendor-actions">
        <button data-request="${esc(r.SettlementId)}" data-action="print">Statement / requisition</button>
        ${next ? `<button data-request="${esc(r.SettlementId)}" data-action="${next}">${esc(next)}</button><button data-request="${esc(r.SettlementId)}" data-action="Rejected">Reject</button>` : ''}
        ${c.pay && r.Status === 'Approved' && r.Unpaid > 0 ? `<button data-request="${esc(r.SettlementId)}" data-action="pay">Record payment</button>` : ''}
        ${r.PaymentStatus !== 'Paid' && !['Cancelled','Rejected'].includes(r.Status) && (c.manage || c.vendor || r.Status === 'Submitted') ? `<button data-request="${esc(r.SettlementId)}" data-action="Cancelled">Withdraw unpaid claim</button>` : ''}
        ${['Cancelled','Rejected'].includes(r.Status) && !r.ReplacedBy ? `<button data-request="${esc(r.SettlementId)}" data-action="revise">Revise & resubmit</button>` : ''}</div></article>`;
    }
    function statementHTML(s) { return `<h3>${esc(s.vendor.Name)}</h3><p>${esc(s.from)} — ${esc(s.to)} · ${esc(s.vendor.BankName)} ${esc(s.vendor.BankAccountMasked)}</p>${metrics(s.balance)}
      ${s.balance.NeedsReview ? '<p class="vendor-notice">Refunds, overpayments or an unissued paid-sale stock movement require review. Accounts must reconcile the affected records before further requests or payments.</p>' : ''}
      <p>Available from this period: <strong>${money(s.availableInPeriod)}</strong> · Direct-collection charges due: ${money(s.directChargeDue)}</p>
      <div class="vendor-table-wrap"><table class="vendor-table"><thead><tr><th>Date / reference</th><th>Products / rule</th><th>Sales</th><th>Refunds</th><th>Deduction</th><th>Net</th></tr></thead><tbody>${s.entries.map(e => `<tr><td>${esc(e.Date.slice(0,10))}<small>${esc(e.SaleNo || e.EntryId)} · ${esc(e.Type)}</small></td>
        <td>${esc((e.Items || []).map(i => `${i.Quantity} × ${i.ItemName}`).join(', '))}<small>${esc(e.RuleLabel)}</small></td><td>${money(e.Gross)}</td><td>${money(e.Refund)}</td><td>${money(e.SchoolCharge)}</td><td>${money(e.Net)}</td></tr>`).join('') || '<tr><td colspan="6">No confirmed vendor earnings in this period.</td></tr>'}</tbody></table></div>
      <h4>Recorded payments / receipts</h4><div class="vendor-table-wrap"><table class="vendor-table"><thead><tr><th>Date</th><th>Reference</th><th>Type / method</th><th>Amount</th></tr></thead><tbody>${s.payments.map(p => `<tr><td>${esc(p.Date)}</td><td>${esc(p.Reference)}<small>${esc(p.EvidenceReference)}</small></td><td>${esc(p.Type || p.PaymentMethod || 'Settlement')}</td><td>${money(p.Amount)}</td></tr>`).join('') || '<tr><td colspan="4">No payments recorded.</td></tr>'}</tbody></table></div><small>The summary is the full vendor balance; rows are filtered by date. Payments are recorded separately, never initiated by this page.</small>`; }
    async function loadStatement() {
      if (!selected || !data) return;
      const form = root.querySelector('[data-statement-filter]'), range = form ? formBody(form) : { From:today().slice(0,7) + '-01', To:today() };
      const generation = ++statementGeneration, vendorId = selected;
      const result = await call('statement',{ ...range, VendorId:vendorId });
      if (result && !disposed && generation === statementGeneration && vendorId === selected && root.querySelector('[data-statement-result]')) {
        statement = result; root.querySelector('[data-statement-result]').innerHTML = statementHTML(result);
      }
    }
    function requestForm(replaced) {
      if (!selected) return status('Register or select a vendor first.',true);
      const currentStatement = statement?.vendor.VendorId === selected ? statement : null;
      if (!replaced && !currentStatement) return status('Load a fresh statement for the selected vendor and period before requesting payment.',true);
      showDialog('Submit vendor requisition', `${input('From','From',replaced?.From || currentStatement?.from || today().slice(0,7) + '-01','date','required')}
        ${input('To','To',replaced?.To || currentStatement?.to || today(),'date','required')}${input('Amount','Amount requested',currentStatement?.availableInPeriod ?? replaced?.Amount ?? 0,'number','min="0.01" step="0.01" required')}${notes()}
        <small class="vendor-full">Confirmed unclaimed earnings are reserved on submission. Approval does not send money. Revisions require the complete approval chain again.</small>`,
        'requestSettlement', b => ({ ...b, VendorId:selected, ...(replaced ? { ReplacesSettlementId:replaced.SettlementId, RecordVersion:replaced.RecordVersion } : {}) }));
    }
    function historicalForm() {
      showDialog('Preview reviewed opening', `${input('OpeningReference','Unique historical reference','','text','required pattern="[A-Za-z0-9_-]{1,120}"')}${input('Date','Opening date',today(),'date','required')}
        ${['GrossSales','Refunds','SchoolDeductions','PriorPayments'].map(k => input(k,({GrossSales:'Historical sales collected',SchoolDeductions:'Agreed past deductions',PriorPayments:'Already paid to vendor'})[k] || k,0,'number','min="0" step="0.01" required')).join('')}
        ${select('OffsetAccount','Reviewed revenue / equity offset',(data.chart || []).filter(a => ['Revenue','Equity'].includes(a.Type)).map(a => [a.Code,`${a.Code} · ${a.Name}`]))}
        ${input('EvidenceReference','Reviewed statement / evidence reference','','text','required')}${notes()}`, 'previewHistorical',b => ({ ...b, VendorId:selected }));
      const form = dialog.querySelector('form');
      form.onsubmit = async event => { event.preventDefault(); const body = { ...formBody(form), VendorId:selected }, result = await call('previewHistorical',body,form); if (!result || disposed) return;
        dialog.close();
        showDialog('Confirm historical opening', `<p class="vendor-full">Outstanding vendor opening: <strong>${money(result.Outstanding)}</strong>. ${esc(result.message)}</p>
          <label class="vendor-check vendor-full"><input name="Confirmed" type="checkbox" required> Accounts has reviewed ownership, sales, prior payments, the statement and the accounting offset.</label>${auth()}`, 'recordOpening', b => ({ ...body, ...b, Confirmed:true, PreviewDigest:result.PreviewDigest }));
      };
    }
    function draw() {
      const c = data.capabilities;
      root.innerHTML = `<section class="vendor-workspace"><header class="vendor-header"><div><h2>Vendor Sales & Settlements</h2><p>Vendor earnings, approved requisitions and recorded payments in one place.</p></div><button data-refresh>Refresh</button></header>
        ${!data.settings.Enabled || !data.settings.AccountingConfirmed ? '<div class="vendor-notice">Setup only — vendor sales are disabled until Accounts confirms the arrangement and account mappings. Existing organisation-owned sales are unchanged.</div>' : ''}
        <p class="vendor-status" role="status">${esc(notice)}</p><nav class="vendor-tabs" aria-label="Vendor sections">${[['balances','Vendors & balances'],['statement','Statement & request'],['requests','Payment requests'],...(c.operate ? [['products','Product ownership']] : []),...(c.manage ? [['settings','Organisation default']] : [])].map(([key,label]) => `<button data-tab="${key}" aria-pressed="${tab === key}">${label}</button>`).join('')}</nav><div class="vendor-panel" data-panel></div></section>`;
      const panel = root.querySelector('[data-panel]');
      if (tab === 'balances') panel.innerHTML = `${c.manage ? '<div class="vendor-actions"><button data-add-vendor>Register vendor</button></div>' : ''}<div class="vendor-grid">${data.vendors.map(v => { const b = data.balances.find(r => r.VendorId === v.VendorId) || {}; return `<article class="vendor-card"><h3>${esc(v.Name)}</h3><small>${esc(v.SchoolSection)} · ${v.Active === 'NO' ? 'Inactive' : 'Active'} · ${esc(v.BankAccountMasked)}</small><p>Available <strong>${money(b.Available)}</strong><br>Reserved ${money(b.Reserved)} · Paid ${money(b.Paid)}</p>${b.NeedsReview ? '<span class="vendor-badge">Needs reconciliation</span>' : ''}<div class="vendor-actions"><button data-view-vendor="${esc(v.VendorId)}">Open statement</button>${c.manage ? `<button data-edit-vendor="${esc(v.VendorId)}">Edit vendor / rule</button>` : ''}</div></article>`; }).join('') || '<p>No vendor accounts yet. Existing unassigned stock stays organisation-owned until reviewed.</p>'}</div>`;
      if (tab === 'statement') panel.innerHTML = `<form class="vendor-form" data-statement-filter><label class="vendor-full">Vendor<select name="VendorId">${vendorOptions()}</select></label>${input('From','From',today().slice(0,7)+'-01','date','required')}${input('To','To',today(),'date','required')}<button type="submit" data-label="Load statement">Load statement</button></form><div class="vendor-actions"><button data-request-new>Request payment</button><button data-print-statement>Print / Save PDF</button>${c.pay ? '<button data-refund>Record linked refund</button><button data-recovery>Record money received</button><button data-opening>Reviewed historical opening</button>' : ''}</div><div data-statement-result><p>Select a vendor and load a statement.</p></div>`;
      if (tab === 'requests') panel.innerHTML = `<p>Accounts confirmation → Admin review → Director / Super Admin approval → Accounts records payment.</p><div class="vendor-grid">${data.requests.map(requestCard).join('') || '<p>No vendor payment requests yet.</p>'}</div>`;
      if (tab === 'products') panel.innerHTML = `<div class="vendor-actions"><p>Ownership applies to future sales only.</p><button data-import-products>Batch products & owners</button><button data-add-product>Add vendor product</button></div><div class="vendor-table-wrap"><table class="vendor-table"><thead><tr><th>Product</th><th>Owner</th><th>Stock / price</th><th>Action</th></tr></thead><tbody>${data.products.map((p,index) => `<tr><td>${esc(p.ItemName)}<small>${esc(p.InventoryId)} · ${esc(p.Section)}</small></td><td>${esc(data.vendors.find(v => v.VendorId === p.VendorId)?.Name || 'Organisation')}</td><td>${esc(p.Quantity)} · ${money(p.Price)}</td><td><button data-edit-product="${index}">Review ownership</button></td></tr>`).join('')}</tbody></table></div>`;
      if (tab === 'settings') { const s = data.settings; panel.innerHTML = `<h3>Default settlement arrangement</h3><p>Individual vendors may inherit this rule or explicitly receive full payment.</p><form class="vendor-form" data-settings>${ruleFields(s.RuleHistory?.at(-1))}
        ${[['PayableAccount','Vendor payable account','Liability'],['CommissionAccount','Commission / charge income','Revenue'],['VendorReceivableAccount','Direct-collection charge receivable','Asset']].map(([key,label,type]) => select(key,label,data.chart.filter(a => a.Type === type && a.Active !== 'NO').map(a => [a.Code,`${a.Code} · ${a.Name}`]),s[key])).join('')}
        ${input('BusinessTimezone','Business timezone',s.BusinessTimezone)}<label class="vendor-check vendor-full"><input name="AccountingConfirmed" type="checkbox" ${s.AccountingConfirmed ? 'checked' : ''}> Accounts has confirmed the collection arrangement and account mappings.</label>
        <label class="vendor-check vendor-full"><input name="Enabled" type="checkbox" ${s.Enabled ? 'checked' : ''}> Enable reviewed vendor sales and settlements in this branch</label><button type="submit" data-label="Save default arrangement">Save default arrangement</button><p class="vendor-full" role="status"></p></form>`; }
      if (tab === 'statement' && c.pay) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Complete paid sale stock issue';
        root.querySelector('[data-refund]').after(button);
        button.onclick = () => {
          const held = statement?.entries.filter(e => e.SettlementHold && e.Type === 'Sale') || [];
          if (!held.length) return status('Load a statement containing an original paid sale held for inventory review.',true);
          showDialog('Complete paid sale stock issue', `${select('EntryId','Paid sale awaiting stock issue',held.map(e => [e.EntryId,e.SaleNo]))}${input('EvidenceReference','Stock issue / delivery evidence','','text','required')}${notes()}${auth()}
            <small class="vendor-full">Stock must now cover the entire original order. The original stock issue and settlement holds are completed atomically; no payment or earnings are duplicated. Refunded orders require a separate quantity review.</small>`, 'completeInventoryReview',b => ({...b,VendorId:selected}));
        };
      }
      root.querySelector('[data-refresh]').onclick = reload;
      root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; statement = null; statementGeneration++; draw(); if (tab === 'statement') loadStatement(); });
      root.querySelector('[data-add-vendor]')?.addEventListener('click', () => vendorForm());
      root.querySelectorAll('[data-edit-vendor]').forEach(b => b.onclick = () => vendorForm(data.vendors.find(v => v.VendorId === b.dataset.editVendor)));
      root.querySelectorAll('[data-view-vendor]').forEach(b => b.onclick = () => { selected = b.dataset.viewVendor; tab = 'statement'; draw(); loadStatement(); });
      root.querySelector('[data-add-product]')?.addEventListener('click', () => productForm());
      root.querySelector('[data-import-products]')?.addEventListener('click', productImportDialog);
      root.querySelectorAll('[data-edit-product]').forEach(b => b.onclick = () => productForm(data.products[Number(b.dataset.editProduct)]));
      root.querySelector('[data-request-new]')?.addEventListener('click', () => requestForm());
      root.querySelector('[data-print-statement]')?.addEventListener('click', () => statement ? print(`Vendor statement — ${statement.vendor.Name}`,statementHTML(statement)) : status('Load a statement first.',true));
      const filter = root.querySelector('[data-statement-filter]'); if (filter) {
        filter.onchange = () => {
          selected = filter.elements.VendorId.value; statement = null; statementGeneration++;
          root.querySelector('[data-statement-result]').textContent = 'Filters changed. Load a fresh statement before requesting payment.';
        };
        filter.onsubmit = e => { e.preventDefault(); selected = filter.elements.VendorId.value; loadStatement(); };
      }
      const settings = root.querySelector('[data-settings]'); if (settings) { ruleVisibility(settings); settings.onchange = () => ruleVisibility(settings); settings.onsubmit = async e => { e.preventDefault();
        const result = await call('saveSettings',{ ...formBody(settings), RecordVersion:data.settings.RecordVersion, AccountingConfirmed:settings.elements.AccountingConfirmed.checked, Enabled:settings.elements.Enabled.checked },settings);
        if (result) { notice = result.message; await reload(); } }; }
      root.querySelectorAll('[data-request]').forEach(b => b.onclick = () => {
        const r = data.requests.find(r => r.SettlementId === b.dataset.request), action = b.dataset.action;
        if (action === 'print') return print(`Vendor requisition — ${r.SettlementId}`,`<h3>${esc(r.VendorName)}</h3><p>${esc(r.Status)} · ${esc(r.PaymentStatus)} · revision ${r.Revision}</p><p>Requested ${money(r.Amount)} · Paid ${money(r.Paid)} · Unpaid ${money(r.Unpaid)}</p><p>${esc(r.BankName)} · ${esc(r.BankAccountName)} · ${esc(r.BankAccountNumber || r.BankAccountMasked)}</p><table><tr><th>Sale</th><th>Products / agreed rule</th><th>Gross</th><th>Refund</th><th>Charge</th><th>Net</th></tr>${(r.Snapshot || []).map(s => `<tr><td>${esc(s.SaleNo)}</td><td>${esc((s.Items || []).map(i => `${i.Quantity} × ${i.ItemName}`).join(', '))}<small>${esc(s.RuleLabel || JSON.stringify(s.RuleSnapshot || {}))}</small></td><td>${money(s.Gross)}</td><td>${money(s.Refund)}</td><td>${money(s.Charge)}</td><td>${money(s.Net)}</td></tr>`).join('')}</table><h4>Approval / payment trail</h4>${(r.History || []).map(h => `<p>${esc(h.Action)} · ${esc(h.By)} · ${esc(h.At)} · ${esc(h.Notes)}</p>`).join('')}`);
        if (action === 'revise') { selected = r.VendorId; return requestForm(r); }
        const payment = action === 'pay';
        showDialog(payment ? 'Record vendor payment' : action, payment ? `<p class="vendor-full">${esc(r.BankName)} · ${esc(r.BankAccountName)} · ${esc(r.BankAccountNumber || r.BankAccountMasked)}. Maximum unpaid ${money(r.Unpaid)}. Record an already-made payment; this does not send money.</p>${paymentFields(r.Unpaid)}${auth()}` : `${notes()}${action === 'Cancelled' && ['Submitted','Rejected'].includes(r.Status) ? '' : auth()}`,
          payment ? 'pay' : 'decision', body => ({ ...body, SettlementId:r.SettlementId, VendorId:r.VendorId, RecordVersion:r.RecordVersion, ...(payment ? {} : { Status:action }) }));
      });
      root.querySelector('[data-opening]')?.addEventListener('click', () => selected ? historicalForm() : status('Select a vendor first.',true));
      root.querySelector('[data-refund]')?.addEventListener('click', () => {
        if (!statement) return status('Load the original sale’s statement first.',true);
        const originals = statement.entries.filter(e => ['Sale','Vendor collected sale'].includes(e.Type));
        showDialog('Record linked vendor refund', `${select('EntryId','Original sale',originals.map(e => [e.EntryId,`${e.Date.slice(0,10)} · ${e.SaleNo} · ${money(e.Gross)}`]))}${paymentFields()}${notes()}${auth()}
          <small class="vendor-full">Wallet sales refund the original wallet. Other refunds record money already returned. Affected claims must be reconciled. Stock is restocked separately after physical inspection.</small>`, 'refund', b => ({ ...b, VendorId:selected }));
      });
      root.querySelector('[data-recovery]')?.addEventListener('click', () => showDialog('Record vendor receipt / commission return', `${select('Kind','Movement type',['Commission received','Commission returned','Overpayment recovery'])}${paymentFields()}${auth()}
        <small class="vendor-full">Commission returned records money already returned to a vendor after a refund reduces an earlier collected charge. No transfer is initiated.</small>`, 'recordRecovery', b => ({ ...b, VendorId:selected })));
    }
    root.innerHTML = '<p class="vendor-status" role="status">Loading vendor workspace…</p>'; reload();
    mounted = { destroy() { disposed = true; for (const c of pending) c.abort(); dialog?.close(); dialog?.remove(); } };
    return mounted;
  }
  window.DynamaxVendors = Object.freeze({ mount, unmount() { mounted?.destroy(); mounted = undefined; } });
})();
