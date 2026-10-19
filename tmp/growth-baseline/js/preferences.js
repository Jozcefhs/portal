(function () {
  const KEY = 'digc-suite-preferences';
  const defaults = { theme: 'system', accent: 'blue', largeText: false, compact: false, reduceMotion: false, biometric: false, faceAudioGuidance: true };

  function read() {
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch (_error) {
      return { ...defaults };
    }
  }

  function resolvedTheme(theme) {
    if (theme !== 'system') return theme;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply(preferences) {
    const root = document.documentElement;
    root.dataset.themePreference = preferences.theme;
    root.dataset.theme = resolvedTheme(preferences.theme);
    root.dataset.accent = preferences.accent;
    root.dataset.largeText = preferences.largeText ? 'true' : 'false';
    root.dataset.density = preferences.compact ? 'compact' : 'comfortable';
    root.dataset.reduceMotion = preferences.reduceMotion ? 'true' : 'false';
    root.dataset.biometric = preferences.biometric ? 'true' : 'false';
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = root.dataset.theme === 'dark' ? '#07111f' : '#0b4bc8';
  }

  function save(preferences) {
    const normalized = { ...defaults, ...preferences };
    localStorage.setItem(KEY, JSON.stringify(normalized));
    apply(normalized);
    return normalized;
  }

  const preferences = read();
  apply(preferences);
  window.DIGCPreferences = { defaults: { ...defaults }, read, save, apply };

  if (window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const refresh = () => {
      const current = read();
      if (current.theme === 'system') apply(current);
    };
    if (media.addEventListener) media.addEventListener('change', refresh);
  }
})();
