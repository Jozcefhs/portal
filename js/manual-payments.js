(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  function amountDefault(fee = {}) {
    const number = value => value === null || value === undefined || String(value).trim() === '' ? NaN
      : Number(String(value).replace(/^₦\s*/, '').replace(/,/g, '').trim());
    const balance = number(fee.Balance), amount = balance > 0 ? balance : number(fee.Amount);
    return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : '';
  }
  const canAccess = user => user?.edition === 'school' && ['Super Admin', 'Accounts Officer'].includes(user.role)
    && (user.allowedSections || []).includes('accounts');
  window.DynamaxManualPayments = { amountDefault, canAccess,
    open({ fetch: staffFetch, user, isCurrent = () => true, signal, onSaved }) {
      if (!canAccess(user) || document.getElementById('manualPaymentDialog')) return;
      const dialog = document.createElement('dialog');
      dialog.id = 'manualPaymentDialog'; dialog.className = 'workflow-dialog payment-correction-dialog';
      dialog.setAttribute('aria-labelledby', 'manualPaymentTitle');
      dialog.innerHTML = `<header><h2 id="manualPaymentTitle">Record manual payment</h2><button type="button" data-close aria-label="Close">×</button></header>
        <p>Record money already received. This does not collect money from a bank or card. Check the payment proof before recording.</p>
        <form autocomplete="off"><label>Full admission / applicant reference<input name="AccountRef" maxlength="180" required></label>
          <button type="button" data-load>Load account</button><div data-account role="status"></div>
          <fieldset data-fields hidden><legend>Payment details</legend>
            <label>Fee component<select name="ChoiceId" required><option value="">Choose a fee</option></select></label>
            <small>Amount defaults to the outstanding balance or configured price. You may edit it for the amount actually received.</small>
            <label>Description<input name="Description" maxlength="300" required></label>
            <label>Amount<input name="Amount" type="number" data-finance-input inputmode="decimal" min="0.01" step="0.01" required></label>
            <label>Payment method<select name="Method"><option>Bank Transfer</option><option>Cash</option><option>POS</option><option>Cheque</option></select></label>
            <label>Payment date<input name="PaidAt" type="date" required></label>
            <label>Payment-proof / bank reference<input name="PaymentProof" maxlength="200" required></label>
            <button type="submit" data-submit>Review and record payment</button>
          </fieldset>
        </form><section data-duplicate hidden></section><p data-status role="status" aria-live="polite"></p><small data-reference></small>`;
      document.body.append(dialog); dialog.showModal();
      const form = dialog.querySelector('form'), fields = dialog.querySelector('[data-fields]');
      const status = dialog.querySelector('[data-status]'), duplicate = dialog.querySelector('[data-duplicate]');
      const reference = `WEB-MANUAL-${crypto.randomUUID()}`;
      dialog.querySelector('[data-reference]').textContent = `Payment reference: ${reference}`;
      const now = new Date();
      form.elements.PaidAt.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      let busy = false, account = null, choices = [], instruction = null, reviewDigest = '', posted = false, uncertain = false;
      const current = () => dialog.isConnected && !signal?.aborted && isCurrent();
      const say = (message, bad = false) => { status.textContent = message; status.className = bad ? 'status bad' : 'status'; };
      const lock = () => {
        form.querySelectorAll('input,select,button').forEach(el => { el.disabled = busy || posted || Boolean(instruction); });
        dialog.querySelector('[data-close]').disabled = busy;
        dialog.querySelectorAll('[data-duplicate] input,[data-duplicate] button').forEach(el => { el.disabled = busy || posted; });
        const retry = dialog.querySelector('[data-retry]');
        if (retry) { retry.disabled = busy || posted; retry.hidden = posted || (Boolean(reviewDigest) && !uncertain); }
      };
      const api = async body => {
        if (!current()) throw new Error('Your account or working branch changed. Close this form and reopen it.');
        const response = await staffFetch('/api/staff-manual-payments', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await response.json();
        if (!current()) throw new Error('Your account or working branch changed. Check the payment history before retrying.');
        if (!response.ok || (!data.ok && data.code !== 'WALLET_DUPLICATE_REVIEW_REQUIRED')) throw new Error(data.message || 'Payment could not be confirmed.');
        return data;
      };
      const run = async task => {
        if (busy || posted) return;
        busy = true; lock();
        try { await task(); }
        catch (error) { say(`${error.message}${instruction ? ` Keep reference ${reference}; retry this instruction before starting another.` : ''}`, true); }
        finally { busy = false; lock(); }
      };
      const lookup = () => run(async () => {
        account = null; choices = []; fields.hidden = true;
        dialog.querySelector('[data-account]').textContent = '';
        say('Loading account and fee components...');
        const data = await api({ action: 'lookup', AccountRef: form.elements.AccountRef.value.trim() });
        account = data.account; choices = data.choices;
        form.elements.AccountRef.value = account.AccountRef;
        dialog.querySelector('[data-account]').textContent = [account.DisplayName, account.AccountRef, account.ClassName].filter(Boolean).join(' · ');
        form.elements.ChoiceId.innerHTML = '<option value="">Choose a fee</option>' + choices.map(row =>
          `<option value="${esc(row.ChoiceId)}">${esc([`${row.FeeName} (${row.FeeCode})`, row.AcademicSession, row.Term].filter(Boolean).join(' · '))}</option>`).join('');
        form.elements.Description.value = ''; form.elements.Amount.value = '';
        fields.hidden = false; say('Account verified. Choose the payment component.');
      });
      const post = async () => {
        say('Recording payment...');
        uncertain = true;
        const data = await api({ action: 'post', ...instruction, Reference: reference, DuplicateWalletReviewDigest: reviewDigest });
        uncertain = false;
        if (data.code === 'WALLET_DUPLICATE_REVIEW_REQUIRED') {
          reviewDigest = data.duplicateReview.ReviewDigest;
          duplicate.hidden = false;
          duplicate.innerHTML = `<h3>Possible duplicate wallet top-up</h3><p>${esc(data.message)}</p><ul>${data.duplicateReview.Matches.map(row =>
            `<li>${esc(row.Date)} · ${esc(row.Source)} · ${esc(row.Reference)} · ${esc(row.Currency)} ${esc(row.Amount)}</li>`).join('')}</ul>
            <label><input type="checkbox" data-checked> I checked the credits and payment proof. This is a separate payment.</label>
            <button type="button" data-separate>Record this separate payment</button>`;
          duplicate.querySelector('[data-separate]').addEventListener('click', () => {
            if (!duplicate.querySelector('[data-checked]').checked) { say('Confirm that you checked the existing credits first.', true); return; }
            void run(post);
          });
          say('No new payment recorded. Review the existing credits above.', true);
          return;
        }
        posted = true; duplicate.hidden = true;
        say(`${data.message} Receipt: ${data.payment.ReceiptNo}. Amount: ${data.payment.Currency} ${data.payment.Amount}.`);
        void window.DynamaxStaffActionFeedback?.report(status.textContent, 'ok');
        if (onSaved) { try { await onSaved(); } catch (_) { /* Receipt remains confirmed if dashboard refresh fails. */ } }
      };
      form.elements.AccountRef.addEventListener('input', () => { account = null; choices = []; fields.hidden = true; dialog.querySelector('[data-account]').textContent = ''; });
      form.elements.AccountRef.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void lookup(); } });
      dialog.querySelector('[data-load]').addEventListener('click', () => { void lookup(); });
      form.elements.ChoiceId.addEventListener('change', () => {
        const fee = choices.find(row => row.ChoiceId === form.elements.ChoiceId.value);
        form.elements.Description.value = fee?.FeeName || '';
        if (window.DynamaxFinancialValues) window.DynamaxFinancialValues.set(form.elements.Amount, amountDefault(fee));
        else form.elements.Amount.value = amountDefault(fee);
      });
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!account || instruction || busy || posted) return;
        const values = Object.fromEntries(new FormData(form));
        void run(async () => {
          const confirmed = await window.DynamaxDialogs.confirm({ title: 'Record this payment?',
            message: `${account.DisplayName} (${account.AccountRef})\n${values.Description}\nAmount: ${values.Amount}\nDate: ${values.PaidAt}\nProof: ${values.PaymentProof}`, confirmText: 'Record payment' });
          if (!confirmed) return;
          instruction = values;
          const retry = document.createElement('button'); retry.type = 'button'; retry.dataset.retry = ''; retry.textContent = 'Retry same payment reference';
          retry.addEventListener('click', () => { if (uncertain) void run(post); });
          dialog.append(retry);
          await post();
        });
      });
      const close = async () => {
        if (busy) return;
        if (instruction && !posted && uncertain) {
          busy = true; lock();
          let confirmed = false;
          try { confirmed = await window.DynamaxDialogs.confirm({ title: 'Payment not yet confirmed',
            message: `Before recording another payment, check the history for reference ${reference}. Closing this form will end its safe retry session.`, confirmText: 'Close form' }); }
          finally { busy = false; lock(); }
          if (!confirmed) return;
        }
        dialog.close();
      };
      dialog.querySelector('[data-close]').addEventListener('click', () => { void close(); });
      dialog.addEventListener('cancel', event => { event.preventDefault(); void close(); });
      const abort = () => { dialog.close(); };
      signal?.addEventListener('abort', abort, { once: true });
      dialog.addEventListener('close', () => { signal?.removeEventListener('abort', abort); dialog.remove(); });
      form.elements.AccountRef.focus();
    }
  };
})();
