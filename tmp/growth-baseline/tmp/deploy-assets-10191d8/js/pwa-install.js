(() => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  let installEvent = null;
  const showPrompt = () => {
    if (!installEvent || document.querySelector('.pwa-install') || window.matchMedia('(display-mode: standalone)').matches) return;
    const box = document.createElement('aside'); box.className = 'pwa-install';
    box.innerHTML = '<p><strong>Install School Portal</strong><br><small>Add this portal to your phone for quick app-like access.</small></p><button type="button" class="pwa-confirm">Install</button><button type="button" class="pwa-dismiss">Not now</button>';
    box.querySelector('.pwa-confirm').addEventListener('click', async () => { installEvent.prompt(); await installEvent.userChoice; installEvent = null; box.remove(); });
    box.querySelector('.pwa-dismiss').addEventListener('click', () => box.remove()); document.body.appendChild(box);
  };
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installEvent = event; showPrompt(); });
})();
