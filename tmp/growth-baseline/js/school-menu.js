(() => {
  const menu = document.querySelector('.landing-mobile-menu');
  if (!menu) return;

  const summary = menu.querySelector('summary');
  const closeMenu = () => { menu.open = false; };

  // Let the native summary handle tapping, Enter and Space without double toggling.
  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('focusin', (event) => {
    if (!menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      closeMenu();
      summary.focus();
    }
  });
  menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  // Do not restore an open dropdown after following a link or returning to the app.
  window.addEventListener('pagehide', closeMenu);
  window.addEventListener('pageshow', closeMenu);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') closeMenu();
  });
  const mobileLayout = window.matchMedia('(max-width: 620px)');
  mobileLayout.addEventListener('change', closeMenu);
})();
