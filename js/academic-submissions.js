const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => `NGN ${(Number(value) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const scope = row => Object.fromEntries(['BranchId', 'SchoolSection', 'SessionId', 'TermId'].map(key => [key, row[key]]));

export function deadlineButtonLabel(settings, type, input, normal, now = Date.now()) {
  if (!settings?.Enabled) return normal;
  const keys = ['ClassId', 'SubjectId', 'Week', 'AssessmentComponentId'];
  const rules = (settings.Rules || []).filter(row => row.Enabled && row.RecordType === type
    && keys.every(key => !row[key] || String(row[key]) === String(input[key] ?? '')))
    .sort((a, b) => keys.filter(key => b[key]).length - keys.filter(key => a[key]).length);
  return rules[0] && now > Date.parse(rules[0].Deadline) ? `Pay charges — ${money(rules[0].AmountKobo)}` : normal;
}

export function openSurchargeCheckout({ request, submission }) {
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'box-sizing:border-box;width:min(620px,90vw);max-height:90vh;overflow:auto;padding:24px;border:1px solid #adc4db;border-radius:12px';
    dialog.innerHTML = `<h2>Late submission surcharge</h2><p>${escape(submission.Description)} · ${escape(money(submission.AmountKobo))}</p><p>${escape(Object.entries(submission.Context || {}).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(' · '))}</p>
      <p>Deadline: ${escape(new Date(submission.Deadline).toLocaleString())}</p>
      <p>The validated record is reserved. Payment submits that saved version automatically, even if you close this window. Later edits are not included. Payment does not grant academic approval.</p>
      <p style="overflow-wrap:anywhere">Reference: ${escape(submission.Reference)}</p>
      <p role="status" data-status>${escape(submission.Status)}</p><button data-pay>Pay charges</button> <button data-check>Check payment / submission</button> <button data-close>Close — keep pending</button>`;
    document.body.append(dialog); dialog.showModal();
    let timer, busy = false, finished = false;
    const status = dialog.querySelector('[data-status]');
    if (submission.PaidAt || submission.Status === 'Submitted') dialog.querySelector('[data-pay]').disabled = true;
    const close = result => { if (finished) return; finished = true; clearTimeout(timer); dialog.close(); dialog.remove(); result ? resolve(result) : reject(new Error('Submission is pending. Resume it from Submission deadlines & surcharges; do not pay twice.')); };
    const check = async () => {
      if (busy || finished) return;
      busy = true;
      try {
        const result = await request('verifyAcademicSubmission', { ...scope(submission), Reference: submission.Reference });
        status.textContent = result.submission.Message || result.message || result.submission.Status;
        if (result.submission.Status === 'Submitted') { close({ ...result, message: 'Payment verified and record submitted.' }); return; }
        if (result.submission.PaidAt) dialog.querySelector('[data-pay]').disabled = true;
      } catch (error) { status.textContent = error.message; }
      finally { busy = false; }
    };
    let polls = 0;
    const poll = async () => { await check(); if (!finished && ++polls < 120) timer = setTimeout(poll, 5000); };
    dialog.querySelector('[data-pay]').onclick = async () => {
      if (busy) return;
      const checkout = window.open('about:blank', '_blank');
      if (!checkout) { status.textContent = 'Allow pop-ups to open secure Paystack checkout.'; return; }
      checkout.opener = null; busy = true;
      try {
        const result = await request('payAcademicSubmission', { ...scope(submission), Reference: submission.Reference });
        if (result.submission.Status === 'Submitted') { checkout.close(); close(result); return; }
        if (!/^https:\/\/checkout\.paystack\.com\//.test(result.checkoutUrl || '')) throw new Error('Checkout address is unavailable. Check the payment status before trying again.');
        checkout.location.replace(result.checkoutUrl);
        status.textContent = 'Complete payment in Paystack. This window will check and confirm submission.';
        clearTimeout(timer); polls = 0; timer = setTimeout(poll, 5000);
      } catch (error) { checkout.close(); status.textContent = error.message; }
      finally { busy = false; }
    };
    dialog.querySelector('[data-check]').onclick = check;
    dialog.querySelector('[data-close]').onclick = () => close();
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  });
}

export async function openSubmissionSettings({ request, context, classes = [], subjects = [] }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'academic-submission-settings';
  dialog.style.cssText = 'box-sizing:border-box;width:min(1150px,95vw);max-height:92vh;overflow:auto;padding:22px;border:1px solid #adc4db;border-radius:12px';
  dialog.innerHTML = `<style>
    .academic-submission-settings .submission-master-switch{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:10px;margin:0}
    .academic-submission-settings input[type=checkbox]{width:18px;height:18px;min-width:18px;flex:none;margin:0}
    .academic-submission-settings .submission-actions{display:flex;flex-wrap:wrap;gap:12px}
    .academic-submission-settings .submission-actions button{margin:0}
    </style><h2>Submission deadlines &amp; surcharges</h2><p>Settings apply only to the selected branch, school section, session and term. Amounts are per late submission, paid into the school Paystack account. Draft score entry and draft weekly work remain available.</p>
    <p>Times below are West Africa Time (UTC+01:00). A more specific class/subject/week/test rule overrides the general rule. Avoid equally specific overlapping rules.</p>
    <p role="status" data-status>Loading…</p><section data-settings></section><h3>Pending submissions and payment register</h3><p>Resume your checkout or check a payment without paying again. Paid records needing review are not reported as submitted.</p><section data-register></section><button data-close>Close</button>`;
  document.body.append(dialog); dialog.showModal();
  const status = dialog.querySelector('[data-status]'), settingsEl = dialog.querySelector('[data-settings]'), register = dialog.querySelector('[data-register]');
  let current, types, canManage, busy = false;
  const run = async task => {
    if (busy) return; busy = true;
    dialog.querySelectorAll('button').forEach(b => b.disabled = true);
    try { await task(); } catch (error) { status.textContent = error.message; }
    finally { busy = false; dialog.querySelectorAll('button').forEach(b => b.disabled = false); }
  };
  dialog.querySelector('[data-close]').onclick = () => { if (!busy) { dialog.close(); dialog.remove(); } };
  const options = (rows, key, selected, all) => `<option value="">${all}</option>${selected && !rows.some(row => row[key] === selected) ? `<option selected value="${escape(selected)}">${escape(selected)}</option>` : ''}${rows.map(row => `<option value="${escape(row[key])}" ${row[key] === selected ? 'selected' : ''}>${escape(row.Name || row[key])}</option>`).join('')}`;
  const row = rule => `<tr data-rule><td><select data-type>${Object.entries(types).map(([key, name]) => `<option value="${key}" ${key === rule.RecordType ? 'selected' : ''}>${escape(name)}</option>`).join('')}</select></td>
    <td><select data-class>${options(classes, 'ClassId', rule.ClassId, 'All classes')}</select></td><td><select data-subject>${options(subjects, 'SubjectId', rule.SubjectId, 'All subjects')}</select></td>
    <td><input data-week type="number" min="1" max="53" value="${escape(rule.Week)}" aria-label="Week; blank means all" style="width:65px"></td>
    <td><input data-component value="${escape(rule.AssessmentComponentId)}" placeholder="All" aria-label="Assessment component ID" style="width:90px"></td>
    <td><input data-deadline type="datetime-local" required value="${rule.Deadline ? escape(new Date(Date.parse(rule.Deadline) + 3600000).toISOString().slice(0,16)) : ''}"></td>
    <td><input data-amount type="number" min="1" max="1000000" step="0.01" value="${Number(rule.AmountKobo || 10000) / 100}" aria-label="Surcharge in naira" style="width:100px"></td>
    <td><input data-enabled type="checkbox" ${rule.Enabled !== false ? 'checked' : ''} aria-label="Rule enabled"></td><td><button type="button" data-remove>Remove</button></td></tr>`;
  const render = () => {
    settingsEl.innerHTML = `<form><fieldset style="min-width:0" ${canManage ? '' : 'disabled'}><label class="submission-master-switch"><input name="Enabled" type="checkbox" ${current.Enabled ? 'checked' : ''}><span>Enable submission deadlines and surcharges</span></label>
      <div style="overflow:auto;margin:15px 0"><table style="min-width:1050px"><thead><tr>${['Record','Class','Subject','Week','Test ID','Deadline (WAT)','Amount (NGN)','Enabled',''].map(t => `<th>${t}</th>`).join('')}</tr></thead><tbody>${current.Rules.map(row).join('')}</tbody></table></div>
      <div class="submission-actions"><button type="button" data-add>Add deadline</button><button type="submit">Save settings</button></div></fieldset></form>`;
    settingsEl.querySelector('[data-add]').onclick = () => settingsEl.querySelector('tbody').insertAdjacentHTML('beforeend', row({ RecordType: 'cbt', Enabled: true }));
    settingsEl.onclick = event => { if (event.target.matches('[data-remove]')) event.target.closest('tr').remove(); };
    settingsEl.querySelector('form').onsubmit = event => {
      event.preventDefault(); void run(async () => {
        const Rules = [...settingsEl.querySelectorAll('[data-rule]')].map(tr => ({ RecordType: tr.querySelector('[data-type]').value,
          ClassId: tr.querySelector('[data-class]').value, SubjectId: tr.querySelector('[data-subject]').value,
          Week: tr.querySelector('[data-week]').value, AssessmentComponentId: tr.querySelector('[data-component]').value.trim(),
          Deadline: `${tr.querySelector('[data-deadline]').value}:00+01:00`, AmountKobo: Math.round(Number(tr.querySelector('[data-amount]').value) * 100), Enabled: tr.querySelector('[data-enabled]').checked }));
        const result = await request('saveAcademicSubmissionSettings', { ...context, Enabled: settingsEl.querySelector('[name=Enabled]').checked, Rules, RevisionToken: current.RevisionToken });
        current = result.settings; render(); status.textContent = 'Deadline and surcharge settings saved.';
      });
    };
  };
  const loadRegister = async (cursor = '') => {
    const result = await request('listAcademicSubmissions', { ...context, Cursor: cursor });
    register.innerHTML = `<div style="overflow:auto"><table><thead><tr><th>Teacher / record</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>${result.submissions.map((item, index) => `<tr><td>${escape(item.Actor)} · ${escape(item.Description)}<br><small>${escape(item.CreatedAt)}</small></td><td>${money(item.AmountKobo)}</td><td>${escape(item.Status)}<br>${escape(item.Message)}</td><td><button data-payment="${index}">Review / check payment</button></td></tr>`).join('')}</tbody></table></div><button data-reload>Refresh register</button>`;
    register.querySelector('[data-reload]').onclick = () => void run(loadRegister);
    if (result.nextCursor) {
      const next = document.createElement('button'); next.textContent = 'Next page';
      next.onclick = () => void run(() => loadRegister(result.nextCursor)); register.append(next);
    }
    register.querySelectorAll('[data-payment]').forEach(button => { button.onclick = () => void run(async () => {
      await openSurchargeCheckout({ request, submission: result.submissions[Number(button.dataset.payment)] }); await loadRegister();
    }); });
  };
  await run(async () => {
    const result = await request('getAcademicSubmissionSettings', { ...context, IncludeChoices: true });
    classes = result.classes || classes; subjects = result.subjects || subjects;
    current = result.settings; types = result.recordTypes; canManage = result.canManage;
    render(); await loadRegister(); status.textContent = canManage ? 'Set a deadline and amount, then enable the feature when ready.' : 'Your submission deadlines and payment register.';
  });
}
