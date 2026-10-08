/* Keep the store controls and scroll targets clear of the dashboard navigation. */
(() => {
  const store = document.querySelector('.parent-store');
  const controls = store?.querySelector('.parent-store-controls');
  if (!store || !controls) return;
  const navigation = document.getElementById('dashboardNav');

  function measureStoreControls() {
    // Phones put navigation at the bottom; wider screens keep it at the top.
    const bottomNavigation = window.matchMedia('(max-width: 680px)').matches;
    const navigationHeight = bottomNavigation ? 0 : Math.ceil(navigation?.getBoundingClientRect().height || 0);
    const controlsHeight = Math.ceil(controls.getBoundingClientRect().height);
    store.style.setProperty('--store-sticky-top', `${navigationHeight}px`);
    // A hidden dashboard panel has no height. Retain the fallback/last size
    // until ResizeObserver sees the panel after it becomes visible again.
    if (controlsHeight > 0) store.style.setProperty('--store-controls-height', `${controlsHeight}px`);
  }

  measureStoreControls();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(measureStoreControls);
    observer.observe(controls);
    if (navigation) observer.observe(navigation);
  }
  window.addEventListener('resize', measureStoreControls);
})();
