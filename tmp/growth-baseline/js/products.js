(() => {
  const menu = document.querySelector('.products-menu');
  if (!menu) return;

  const summary = menu.querySelector('summary');
  const closeMenu = () => { menu.open = false; };

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
  window.addEventListener('pagehide', closeMenu);
  window.addEventListener('pageshow', closeMenu);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') closeMenu();
  });
})();
