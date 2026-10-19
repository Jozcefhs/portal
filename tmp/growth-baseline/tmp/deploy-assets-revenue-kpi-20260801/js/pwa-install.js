(() => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  let installEvent = null;
  const showPrompt = () => {
    if (!installEvent || document.querySelector('.pwa-install') || window.matchMedia('(display-mode: standalone)').matches) return;
    const box = document.createElement('aside'); box.className = 'pwa-install';
    box.innerHTML = '<p><strong>Install Dynamax</strong><br><small>Add Dynamax to this device for quick app-like access.</small></p><button type="button" class="pwa-confirm">Install</button><button type="button" class="pwa-dismiss">Not now</button>';
    box.querySelector('.pwa-confirm').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (!window.DynamaxActionFeedback.begin(button, 'Opening installer...')) return;
      try {
        installEvent.prompt();
        await installEvent.userChoice;
        installEvent = null;
      } finally {
        window.DynamaxActionFeedback.end(button);
        box.remove();
      }
    });
    box.querySelector('.pwa-dismiss').addEventListener('click', () => box.remove()); document.body.appendChild(box);
  };
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installEvent = event; showPrompt(); });
  window.installDynamaxApp = async (button = null) => {
    if (!installEvent) {
      window.alert('Use your browser menu and choose “Install app” or “Add to Home screen”.');
      return;
    }
    if (button && !window.DynamaxActionFeedback.begin(button, 'Opening installer...')) return;
    try {
      installEvent.prompt();
      await installEvent.userChoice;
      installEvent = null;
    } finally {
      if (button) window.DynamaxActionFeedback.end(button);
    }
  };
  document.getElementById('installDynamaxApp')?.addEventListener('click', (event) => window.installDynamaxApp(event.currentTarget));
})();
