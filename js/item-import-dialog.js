import { ITEM_IMPORT_LIMITS, ITEM_IMPORT_MODULES, parseItemImportCsv, duplicateItemImportRows } from './item-import-csv.js';
import { productCsv } from './vendor-product-import.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function openItemImportDialog({ section, request, isCurrent, reload, defaultSection = 'Secondary' }) {
  const config = ITEM_IMPORT_MODULES[section];
  if (!config || !isCurrent()) return;
  document.querySelector('[data-item-import-dialog]')?.close();
  const modal = document.createElement('dialog');
  modal.className = 'item-import-dialog'; modal.dataset.itemImportDialog = '';
  modal.innerHTML = `<form><header><h2>Batch upload · ${esc(config.label)}</h2><button type="button" data-close aria-label="Close batch upload">×</button></header>
    <p>${section === 'library' ? 'One row per physical copy. Use a unique barcode for every copy; copies of the same title share its catalogue entry.' : 'Add new items with their opening quantities.'} Existing items are skipped, never overwritten. This does not change sales, loans or payments.</p>
    <div class="item-import-tools"><a data-template download>Download CSV template</a><label>Completed CSV<input name="File" type="file" accept=".csv,text/csv" required></label><button type="button" data-preview>Preview CSV</button></div>
    <p role="status" aria-live="polite"></p><div class="item-import-preview" data-table></div>
    <label class="item-import-confirm"><input name="Confirmed" type="checkbox" disabled> I have checked all rows in this preview.</label>
    <footer><button type="submit" disabled>Import confirmed rows</button><button type="button" data-done>Close</button></footer></form>`;
  document.body.append(modal); modal.showModal();
  const form = modal.querySelector('form'), progress = modal.querySelector('[role=status]'), preview = modal.querySelector('[data-preview]'), submit = form.querySelector('[type=submit]');
  const templateUrl = URL.createObjectURL(new Blob([productCsv(config.columns, [])], { type: 'text/csv;charset=utf-8' }));
  const link = modal.querySelector('[data-template]'); link.href = templateUrl; link.download = `${section}-items-template.csv`;
  let batches = [], previews = [], requestIds = [], next = 0, running = false, completed = false, changed = false;
  const totals = { created: 0, skipped: 0 };
  const say = message => { progress.textContent = message; };
  const checkScope = () => { if (!isCurrent()) throw new Error('Your workspace changed. Close this upload and start again in the current workspace.'); };
  const controls = () => {
    form.elements.File.disabled = running || next > 0;
    preview.disabled = running || next > 0;
    form.elements.Confirmed.disabled = running || completed || !previews.length || !previews.every(value => value.valid);
    submit.disabled = running || completed || form.elements.Confirmed.disabled || !form.elements.Confirmed.checked;
    modal.querySelectorAll('[data-close], [data-done]').forEach(button => { button.disabled = running; });
  };
  const reset = () => { batches = []; previews = []; requestIds = []; next = 0; completed = false; totals.created = totals.skipped = 0; form.elements.Confirmed.checked = false; modal.querySelector('[data-table]').innerHTML = ''; say(''); controls(); };
  form.elements.File.onchange = reset; form.elements.Confirmed.onchange = controls;
  preview.onclick = async () => {
    const file = form.elements.File.files[0];
    if (!file) return say('Choose a completed CSV. Maximum 1,000 rows / 512 KB.');
    reset(); running = true; controls();
    try {
      checkScope();
      if (file.size > ITEM_IMPORT_LIMITS.bytes) throw new Error('Maximum CSV size is 512 KB.');
      const rows = parseItemImportCsv(await file.text(), section);
      const duplicates = duplicateItemImportRows(rows, section, defaultSection);
      for (let index = 0; index < rows.length; index += ITEM_IMPORT_LIMITS.batch) batches.push(rows.slice(index, index + ITEM_IMPORT_LIMITS.batch));
      for (const [index, Rows] of batches.entries()) {
        checkScope(); say(`Checking batch ${index + 1} of ${batches.length}… Nothing has been saved.`);
        const result = await request({ action: 'preview', Rows }); checkScope();
        for (const row of result.rows) if (duplicates.has(row.RowNumber)) { row.Errors.push('Duplicate in this CSV. Keep one row per item / barcode.'); row.Status = 'Error'; result.valid = false; }
        previews.push(result);
      }
      const views = previews.flatMap(value => value.rows), errors = views.filter(value => value.Errors.length).length;
      modal.querySelector('[data-table]').innerHTML = `<table><thead><tr><th>CSV row / item</th><th>Reference</th><th>Opening quantity</th><th>Action / errors</th></tr></thead><tbody>${views.map(row => `<tr><td>${esc(row.RowNumber)} · ${esc(row.ItemName)}<small>${esc(row.SchoolSection)}</small></td><td>${esc(row.Reference)}</td><td class="item-import-quantity">${esc(row.Quantity)}</td><td>${esc(row.Status)}<small>${row.Errors.map(esc).join(' ')}</small></td></tr>`).join('')}</tbody></table>`;
      requestIds = batches.map(() => crypto.randomUUID());
      say(errors ? `${errors} row(s) need correction. Nothing has been saved. Correct the CSV and preview again.` : `${views.length} rows checked: ${views.filter(value => value.Status === 'Create').length} new, ${views.filter(value => value.Status === 'Skip existing').length} existing. Confirm to import.`);
    } catch (error) { previews = []; say(error.message || String(error)); }
    finally { running = false; controls(); }
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (running || submit.disabled) return;
    running = true; controls();
    try {
      while (next < batches.length) {
        checkScope(); say(`Saving batch ${next + 1} of ${batches.length}…`);
        const result = await request({ action: 'import', Rows: batches[next], PreviewDigest: previews[next].PreviewDigest, RequestId: requestIds[next], Confirmed: true });
        changed = true; next++; totals.created += Number(result.created || 0); totals.skipped += Number(result.skipped || 0);
        checkScope();
      }
      completed = true; say(`Complete: ${totals.created} items added, ${totals.skipped} existing items kept unchanged.`);
      submit.textContent = 'Import complete'; modal.querySelector('[data-done]').textContent = 'Done';
    } catch (error) { say(`${error.message || String(error)} Completed ${next} of ${batches.length} batches. Retry to resume safely, or close and preview a corrected file. Completed batches remain saved.`); }
    finally { running = false; controls(); }
  };
  modal.querySelectorAll('[data-close], [data-done]').forEach(button => { button.onclick = () => { if (!running) modal.close(); }; });
  modal.addEventListener('cancel', event => { if (running) event.preventDefault(); });
  modal.addEventListener('close', () => {
    URL.revokeObjectURL(templateUrl); modal.remove();
    if (changed && isCurrent()) Promise.resolve(reload()).catch(() => {});
  }, { once: true });
  controls();
  return modal;
}
