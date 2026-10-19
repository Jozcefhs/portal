(function initializeDynamaxDialogs() {
  if (window.DynamaxDialogs) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'app-decision-dialog';
  dialog.setAttribute('aria-labelledby', 'appDecisionTitle');
  dialog.innerHTML = `<form class="app-decision-form">
    <header><span class="app-decision-icon" aria-hidden="true">?</span><div><small class="app-decision-eyebrow">Dynamax confirmation</small><h2 id="appDecisionTitle">Confirm action</h2></div><button type="button" data-app-dialog-cancel aria-label="Close dialog">&times;</button></header>
    <div class="app-decision-body"><p class="app-decision-message"></p><section class="app-decision-details" aria-label="Message details" hidden><strong></strong><ol></ol></section><label class="app-decision-field"><span></span><textarea rows="4" maxlength="1000"></textarea></label><p class="app-decision-status status" role="status"></p></div>
    <footer><button type="button" class="secondary" data-app-dialog-cancel>Cancel</button><button type="submit" class="app-decision-confirm">Confirm</button></footer>
  </form>`;
  document.body.appendChild(dialog);

  const form = dialog.querySelector('form');
  const icon = dialog.querySelector('.app-decision-icon');
  const eyebrow = dialog.querySelector('.app-decision-eyebrow');
  const title = dialog.querySelector('h2');
  const message = dialog.querySelector('.app-decision-message');
  const details = dialog.querySelector('.app-decision-details');
  const detailsLabel = details.querySelector('strong');
  const detailsList = details.querySelector('ol');
  const field = dialog.querySelector('.app-decision-field');
  const fieldLabel = field.querySelector('span');
  const input = field.querySelector('textarea');
  const status = dialog.querySelector('.app-decision-status');
  const confirmButton = dialog.querySelector('.app-decision-confirm');
  const footerCancel = dialog.querySelector('footer [data-app-dialog-cancel]');
  let resolver = null;
  let mode = 'confirm';
  const queue = [];
  let active = null;
  let previousAlert = null;
  const validationBatches = new Map();

  function finish(value) {
    const resolve = resolver;
    resolver = null;
    if (dialog.open) dialog.close();
    if (active?.mode === 'alert') previousAlert = { message: active.options.message, time: Date.now() };
    active = null;
    if (resolve) resolve(value);
    showNext();
  }

  function open(options = {}, nextMode = 'confirm') {
    // Results must never dismiss an approval/password/reason confirmation.
    if (nextMode === 'alert' && options.message && !options.validation) {
      const duplicate = [active, ...queue].find(entry => entry?.mode === 'alert' && entry.options.message === options.message);
      if (duplicate) return duplicate.promise;
      if (previousAlert?.message === options.message && Date.now() - previousAlert.time < 750) return Promise.resolve(true);
    }
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    queue.push({ options, mode: nextMode, resolve, promise });
    showNext();
    return promise;
  }

  function showNext() {
    if (active || !queue.length) return;
    active = queue.shift();
    const { options, mode: nextMode } = active;
    resolver = active.resolve;
    mode = nextMode;
    const dangerous = options.tone === 'danger';
    const items = Array.isArray(options.items)
      ? options.items.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [];
    dialog.classList.toggle('is-danger', dangerous);
    dialog.classList.toggle('has-details', items.length > 0);
    icon.textContent = dangerous ? '!' : (nextMode === 'alert' ? 'i' : '✓');
    eyebrow.textContent = options.eyebrow || (dangerous ? 'Action required' : (nextMode === 'alert' ? 'Dynamax message' : 'Dynamax confirmation'));
    title.textContent = options.title || (nextMode === 'alert' ? 'Notice' : 'Confirm action');
    message.textContent = options.message || '';
    details.hidden = items.length === 0;
    detailsLabel.textContent = options.detailsLabel || `${items.length} detail${items.length === 1 ? '' : 's'}`;
    detailsList.replaceChildren(...items.map((item) => {
      const entry = document.createElement('li');
      entry.textContent = item;
      return entry;
    }));
    field.hidden = nextMode !== 'prompt';
    fieldLabel.textContent = options.label || 'Note';
    input.value = String(options.value || '');
    input.placeholder = options.placeholder || '';
    input.required = Boolean(options.required);
    input.inputMode = options.inputMode || 'text';
    input.maxLength = Number(options.maxLength || 1000);
    confirmButton.textContent = options.confirmText || (nextMode === 'alert' ? 'Close' : 'Confirm');
    confirmButton.classList.toggle('danger', dangerous);
    footerCancel.hidden = nextMode === 'alert';
    status.textContent = '';
    status.className = 'app-decision-status status';
    dialog.showModal();
    window.requestAnimationFrame(() => (nextMode === 'prompt' ? input : confirmButton).focus());
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (mode === 'prompt') {
      const value = input.value.trim();
      if (input.required && !value) {
        status.textContent = 'Complete this field before continuing.';
        status.className = 'app-decision-status status bad';
        input.focus();
        return;
      }
      finish(value);
      return;
    }
    finish(true);
  });
  dialog.querySelectorAll('[data-app-dialog-cancel]').forEach((button) => button.addEventListener('click', () => finish(mode === 'prompt' ? null : false)));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish(mode === 'prompt' ? null : false);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) finish(mode === 'prompt' ? null : false);
  });

  function validationLabel(target) {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const labelledBy = clean(target.getAttribute('aria-labelledby')).split(' ')
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    const accessibleLabel = clean(labelledBy) || clean(target.getAttribute('aria-label'));
    if (accessibleLabel) return accessibleLabel;
    const labels = Array.from(target.labels || []).map(label => {
      // Options, entered values and help text are not part of the field name.
      const copy = label.cloneNode(true);
      copy.querySelectorAll('input, select, textarea, button, datalist, output, small, [aria-hidden="true"]')
        .forEach(node => node.remove());
      return clean(copy.textContent);
    }).filter(Boolean);
    return labels.join(' / ') || clean(target.name) || clean(target.id) || 'Required field';
  }

  // A browser may run microtasks between invalid events from ONE submission.
  // Collect until the next task, and keep the batch locked until it is dismissed.
  document.addEventListener('invalid', event => {
    const target = event.target;
    if (target.closest('.app-decision-dialog')) return;
    event.preventDefault(); // Keep native tooltips from competing with the summary.
    const owner = target.form || target;
    let batch = validationBatches.get(owner);
    if (batch) {
      batch.targets.add(target);
      return;
    }
    batch = { targets: new Set([target]), timer: null };
    validationBatches.set(owner, batch);
    batch.timer = setTimeout(() => {
      if (validationBatches.get(owner) !== batch) return;
      const targets = Array.from(batch.targets).filter(control =>
        control.isConnected && control.willValidate && !control.validity.valid);
      if (!targets.length) { validationBatches.delete(owner); return; }
      const radioGroups = new Set();
      const items = targets.filter(control => {
        if (control.type !== 'radio' || !control.name) return true;
        if (radioGroups.has(control.name)) return false;
        radioGroups.add(control.name);
        return true;
      }).map(control => `${validationLabel(control)}: ${control.validationMessage || 'Check this field before continuing.'}`);
      void open({ title: 'Check the form', tone: 'danger', validation: true,
        message: 'Complete or correct the following fields before continuing.',
        detailsLabel: 'Fields to review', items }, 'alert').then(() => {
        if (validationBatches.get(owner) !== batch) return;
        validationBatches.delete(owner);
        const first = targets.find(control => control.isConnected && control.willValidate && !control.validity.valid);
        if (!dialog.open) first?.focus();
      });
    }, 0);
  }, true);

  window.DynamaxDialogs = {
    clear: () => {
      for (const batch of validationBatches.values()) clearTimeout(batch.timer);
      validationBatches.clear();
      for (const entry of queue.splice(0)) entry.resolve(entry.mode === 'prompt' ? null : false);
      finish(mode === 'prompt' ? null : false);
      previousAlert = null;
    },
    confirm: (options) => open(options, 'confirm'),
    prompt: (options) => open(options, 'prompt'),
    alert: (options) => open(options, 'alert')
  };
})();
