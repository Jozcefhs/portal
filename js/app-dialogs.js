(function initializeDynamaxDialogs() {
  if (window.DynamaxDialogs) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'app-decision-dialog';
  dialog.setAttribute('aria-labelledby', 'appDecisionTitle');
  dialog.innerHTML = `<form class="app-decision-form">
    <header><span class="app-decision-icon" aria-hidden="true">?</span><div><small>Dynamax confirmation</small><h2 id="appDecisionTitle">Confirm action</h2></div><button type="button" data-app-dialog-cancel aria-label="Close dialog">&times;</button></header>
    <div class="app-decision-body"><p class="app-decision-message"></p><label class="app-decision-field"><span></span><textarea rows="4" maxlength="1000"></textarea></label><p class="app-decision-status status" role="status"></p></div>
    <footer><button type="button" class="secondary" data-app-dialog-cancel>Cancel</button><button type="submit" class="app-decision-confirm">Confirm</button></footer>
  </form>`;
  document.body.appendChild(dialog);

  const form = dialog.querySelector('form');
  const icon = dialog.querySelector('.app-decision-icon');
  const title = dialog.querySelector('h2');
  const message = dialog.querySelector('.app-decision-message');
  const field = dialog.querySelector('.app-decision-field');
  const fieldLabel = field.querySelector('span');
  const input = field.querySelector('textarea');
  const status = dialog.querySelector('.app-decision-status');
  const confirmButton = dialog.querySelector('.app-decision-confirm');
  const footerCancel = dialog.querySelector('footer [data-app-dialog-cancel]');
  let resolver = null;
  let mode = 'confirm';

  function finish(value) {
    const resolve = resolver;
    resolver = null;
    if (dialog.open) dialog.close();
    if (resolve) resolve(value);
  }

  function open(options = {}, nextMode = 'confirm') {
    if (resolver) finish(nextMode === 'prompt' ? null : false);
    mode = nextMode;
    const dangerous = options.tone === 'danger';
    dialog.classList.toggle('is-danger', dangerous);
    icon.textContent = dangerous ? '!' : (nextMode === 'alert' ? 'i' : '✓');
    title.textContent = options.title || (nextMode === 'alert' ? 'Notice' : 'Confirm action');
    message.textContent = options.message || '';
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
    return new Promise((resolve) => {
      resolver = resolve;
      dialog.showModal();
      window.requestAnimationFrame(() => (nextMode === 'prompt' ? input : confirmButton).focus());
    });
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

  window.DynamaxDialogs = {
    confirm: (options) => open(options, 'confirm'),
    prompt: (options) => open(options, 'prompt'),
    alert: (options) => open(options, 'alert')
  };
})();
