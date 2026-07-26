(function () {
  const services = document.getElementById('servicesSheet');
  const settings = document.getElementById('settingsPanel');
  const form = document.getElementById('preferenceForm');
  const openServices = document.getElementById('openServices');
  const openSettings = document.getElementById('openSettings');
  let lastTrigger = null;

  function focusable(panel) {
    return [...panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')];
  }

  function openPanel(panel, trigger) {
    [services, settings].forEach((item) => { if (item !== panel) item.hidden = true; });
    lastTrigger = trigger;
    panel.hidden = false;
    document.body.classList.add('launcher-modal-open');
    requestAnimationFrame(() => panel.classList.add('is-open'));
    focusable(panel)[0]?.focus();
  }

  function closePanel(panel) {
    panel.classList.remove('is-open');
    panel.hidden = true;
    document.body.classList.remove('launcher-modal-open');
    lastTrigger?.focus();
  }

  function populateForm() {
    const preferences = window.DIGCPreferences.read();
    form.elements.theme.value = preferences.theme;
    form.elements.accent.value = preferences.accent;
    form.elements.largeText.checked = preferences.largeText;
    form.elements.compact.checked = preferences.compact;
    form.elements.reduceMotion.checked = preferences.reduceMotion;
  }

  openServices.addEventListener('click', () => openPanel(services, openServices));
  openSettings.addEventListener('click', () => {
    populateForm();
    openPanel(settings, openSettings);
  });

  document.querySelectorAll('[data-close-panel]').forEach((button) => {
    button.addEventListener('click', () => closePanel(button.closest('.launcher-overlay')));
  });

  [services, settings].forEach((panel) => {
    panel.addEventListener('click', (event) => {
      if (event.target === panel) closePanel(panel);
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePanel(panel);
      if (event.key !== 'Tab') return;
      const items = focusable(panel);
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  });

  form.addEventListener('change', () => {
    window.DIGCPreferences.apply({
      theme: form.elements.theme.value,
      accent: form.elements.accent.value,
      largeText: form.elements.largeText.checked,
      compact: form.elements.compact.checked,
      reduceMotion: form.elements.reduceMotion.checked
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    window.DIGCPreferences.save({
      theme: form.elements.theme.value,
      accent: form.elements.accent.value,
      largeText: form.elements.largeText.checked,
      compact: form.elements.compact.checked,
      reduceMotion: form.elements.reduceMotion.checked
    });
    closePanel(settings);
  });

  document.getElementById('resetPreferences').addEventListener('click', () => {
    window.DIGCPreferences.save(window.DIGCPreferences.defaults);
    populateForm();
  });
})();
