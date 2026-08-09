(function paymentMethodsBootstrap() {
  const cache = new Map();
  let activeChoice = null;

  const clean = (value) => String(value ?? '').trim();
  const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));

  function ensureStyles() {
    if (document.querySelector('link[data-payment-method-styles]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/payment-methods.css?v=20260809-direct-transfer';
    link.dataset.paymentMethodStyles = 'true';
    document.head.appendChild(link);
  }

  async function load(branchId = 'main') {
    const branch = clean(branchId).toLowerCase() || 'main';
    if (cache.has(branch)) return cache.get(branch);
    const promise = fetch(`/api/payment-methods?branch=${encodeURIComponent(branch)}`, {
      credentials: 'same-origin', cache: 'no-store'
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load the available payment methods.');
      return data.methods || {};
    }).catch((error) => {
      cache.delete(branch);
      throw error;
    });
    cache.set(branch, promise);
    return promise;
  }

  function readProof(file) {
    if (!file) return Promise.resolve({ proofDataUrl: '', proofFileName: '' });
    if (file.size > 450000) throw new Error('Payment proof must be below 450 KB.');
    if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type)) {
      throw new Error('Choose a PNG, JPG, WebP or PDF payment proof.');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('The selected payment proof could not be read.'));
      reader.onload = () => resolve({ proofDataUrl: String(reader.result || ''), proofFileName: file.name });
      reader.readAsDataURL(file);
    });
  }

  function ensureDialog() {
    let dialog = document.getElementById('publicPaymentMethodDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'publicPaymentMethodDialog';
    dialog.className = 'payment-method-dialog';
    document.body.appendChild(dialog);
    return dialog;
  }

  async function choose(options = {}) {
    if (activeChoice) throw new Error('Complete or close the current payment choice first.');
    ensureStyles();
    const branchId = clean(options.branchId || 'main').toLowerCase() || 'main';
    const currency = clean(options.currency || 'NGN').toUpperCase();
    const amount = Number(String(options.amount || '0').replace(/,/g, ''));
    const amountText = Number.isFinite(amount) && amount > 0
      ? new Intl.NumberFormat('en-NG', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
      : '';
    const methods = await load(branchId);
    const onlineEnabled = Boolean(methods.online?.enabled);
    const transfer = methods.directTransfer || {};
    const transferEnabled = Boolean(transfer.enabled) && clean(transfer.currency).toUpperCase() === currency;
    if (!onlineEnabled && !transferEnabled) {
      throw new Error(transfer.enabled
        ? `Direct transfer is configured for ${transfer.currency}, not ${currency}. No automated online route is currently available.`
        : 'No payment method is currently available. Contact the organisation.');
    }
    const dialog = ensureDialog();
    const firstMethod = onlineEnabled ? 'paystack' : 'direct_bank_transfer';
    dialog.innerHTML = `<form method="dialog" class="payment-method-form">
      <header><div><small>Choose payment route</small><h2>How would you like to pay?</h2><p>Only verified payments receive a final receipt.</p></div><button type="button" data-close-payment-method aria-label="Close">&times;</button></header>
      <div class="payment-method-options">
        <label class="payment-method-option" ${onlineEnabled ? '' : 'hidden'}><input type="radio" name="paymentMethod" value="paystack" ${firstMethod === 'paystack' ? 'checked' : ''}><span><strong>Pay online</strong><small>Card, USSD, Pay with Bank or online bank transfer through Paystack.</small></span></label>
        <label class="payment-method-option" ${transferEnabled ? '' : 'hidden'}><input type="radio" name="paymentMethod" value="direct_bank_transfer" ${firstMethod === 'direct_bank_transfer' ? 'checked' : ''}><span><strong>Direct bank transfer</strong><small>Transfer without Paystack, then submit your bank reference for verification.</small></span></label>
      </div>
      <section class="direct-transfer-panel" data-direct-transfer-panel hidden>
        <p class="direct-transfer-warning"><strong>Awaiting verification:</strong> submitting this transfer does not mark it paid. A receipt is issued only after an authorised user verifies the bank credit.</p>
        ${amountText ? `<p class="direct-transfer-amount"><small>Transfer exactly</small><strong>${escapeHtml(amountText)}</strong></p>` : ''}
        <dl><div><dt>Bank</dt><dd>${escapeHtml(transfer.bankName)}</dd></div><div><dt>Account name</dt><dd>${escapeHtml(transfer.accountName)}</dd></div><div><dt>Account number</dt><dd>${escapeHtml(transfer.accountNumber)}</dd></div><div><dt>Amount currency</dt><dd>${escapeHtml(transfer.currency)}</dd></div></dl>
        ${transfer.instructions ? `<p class="direct-transfer-instructions">${escapeHtml(transfer.instructions)}</p>` : ''}
        <label>Bank transaction reference <input name="bankReference" maxlength="160" autocomplete="off" placeholder="Required after making the transfer"></label>
        <label>Payment proof <span>(optional, maximum 450 KB)</span><input name="paymentProof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf"></label>
      </section>
      <p class="payment-method-status" role="status"></p>
      <footer><button type="button" data-close-payment-method>Cancel</button><button type="submit" class="payment-method-continue">Continue</button></footer>
    </form>`;
    const form = dialog.querySelector('form');
    const panel = dialog.querySelector('[data-direct-transfer-panel]');
    const status = dialog.querySelector('.payment-method-status');
    const update = () => {
      const direct = form.elements.paymentMethod.value === 'direct_bank_transfer';
      panel.hidden = !direct;
      form.elements.bankReference.required = direct;
      form.querySelector('.payment-method-continue').textContent = direct ? 'Submit for verification' : 'Continue to secure payment';
    };
    form.addEventListener('change', update);
    update();

    return new Promise((resolve, reject) => {
      activeChoice = { dialog, resolve, reject };
      const finish = (value) => {
        if (!activeChoice) return;
        activeChoice = null;
        if (dialog.open) dialog.close();
        resolve(value);
      };
      dialog.querySelectorAll('[data-close-payment-method]').forEach((button) => button.addEventListener('click', () => finish(null)));
      dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); }, { once: true });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        status.textContent = '';
        const paymentMethod = form.elements.paymentMethod.value;
        if (paymentMethod === 'paystack') {
          finish({ paymentMethod: 'paystack' });
          return;
        }
        try {
          const bankReference = clean(form.elements.bankReference.value);
          if (!bankReference) throw new Error('Enter the bank transaction reference.');
          const proof = await readProof(form.elements.paymentProof.files?.[0]);
          finish({ paymentMethod: 'direct_bank_transfer', bankReference, ...proof });
        } catch (error) {
          status.textContent = error.message || String(error);
        }
      });
      try { dialog.showModal(); } catch (error) { activeChoice = null; reject(error); }
    });
  }

  function directTransferMessage(data = {}) {
    const bank = data.bankDetails || {};
    return [
      data.message || 'Transfer submitted for verification.',
      data.reference ? `Reference: ${data.reference}` : '',
      bank.bankName ? `Bank: ${bank.bankName}` : '',
      bank.accountNumber ? `Account: ${bank.accountName} - ${bank.accountNumber}` : ''
    ].filter(Boolean).join('  |  ');
  }

  window.DynamaxPaymentMethods = { choose, load, directTransferMessage };
}());
