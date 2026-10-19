const PUBLIC_CACHE_PREFIX = 'dynamax-public-api:';
const PUBLIC_CACHE_TTL_MS = 5 * 60 * 1000;
const publicJsonInflight = new Map();
let turnstileScriptPromise = null;

const siteProfileFallback = {
  SchoolName: 'Dynamax',
  SchoolAddress: '',
  PortalHeadline: 'Admissions and parent services in one place',
  PortalSubheading: 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.',
  PortalNotice: '',
  NameFormat: 'Surname, first name, middle name',
  ResultDisplayMode: 'subjects',
  ShowResultsOnline: 'NO',
  DeclarationStatement: 'I declare that the information supplied in this application is complete and correct.',
  TurnstileSiteKey: ''
};

function readPublicCache(cacheKey, ttlMs) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(`${PUBLIC_CACHE_PREFIX}${cacheKey}`) || 'null');
    if (!cached || !cached.savedAt || Date.now() - Number(cached.savedAt) > ttlMs) return null;
    return cached.data ?? null;
  } catch (_error) {
    return null;
  }
}

function writePublicCache(cacheKey, data) {
  try {
    sessionStorage.setItem(`${PUBLIC_CACHE_PREFIX}${cacheKey}`, JSON.stringify({
      savedAt: Date.now(),
      data
    }));
  } catch (_error) {
    // Browsing remains available when private mode or storage policy blocks sessionStorage.
  }
}

async function getPublicJson(url, options = {}) {
  const cacheKey = options.cacheKey || url;
  const ttlMs = Number(options.ttlMs || PUBLIC_CACHE_TTL_MS);
  if (!options.force) {
    const cached = readPublicCache(cacheKey, ttlMs);
    if (cached !== null) return cached;
    if (publicJsonInflight.has(cacheKey)) return publicJsonInflight.get(cacheKey);
  }

  const request = fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-cache',
    signal: options.signal
  }).then(async (response) => {
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_error) {
      throw new Error(options.invalidMessage || 'The service returned an invalid response. Please try again.');
    }
    if (!response.ok) {
      throw new Error(data?.message || options.errorMessage || 'Could not load the requested information.');
    }
    if (options.cache !== false && data?.ok !== false) writePublicCache(cacheKey, data);
    return data;
  }).finally(() => {
    if (publicJsonInflight.get(cacheKey) === request) publicJsonInflight.delete(cacheKey);
  });

  publicJsonInflight.set(cacheKey, request);
  return request;
}

async function loadSiteProfile() {
  try {
    const data = await getPublicJson('/api/settings', {
      cacheKey: 'settings',
      errorMessage: 'Could not load portal settings.',
      invalidMessage: 'Portal settings returned an invalid response.'
    });
    return data && data.ok && data.profile ? { ...siteProfileFallback, ...data.profile } : siteProfileFallback;
  } catch (_err) {
    return siteProfileFallback;
  }
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-dynamax-turnstile]');
    const script = existing || document.createElement('script');
    const finish = () => window.turnstile
      ? resolve(window.turnstile)
      : reject(new Error('Human verification could not start. Refresh this page and try again.'));
    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', () => reject(new Error('Human verification could not load. Check your connection and try again.')), { once: true });
    if (!existing) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.dynamaxTurnstile = 'true';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    turnstileScriptPromise = null;
    throw error;
  });
  return turnstileScriptPromise;
}

function normalizedTurnstileAction(action) {
  return String(action || 'submit').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 32) || 'submit';
}

async function getTurnstileToken(action) {
  const profile = await window.siteProfileReady;
  const siteKey = String(profile?.TurnstileSiteKey || profile?.turnstileSiteKey || '').trim();
  if (!siteKey) return {};

  const turnstile = await loadTurnstileScript();
  const turnstileAction = normalizedTurnstileAction(action);
  const container = document.createElement('div');
  container.className = 'dynamax-turnstile-challenge';
  Object.assign(container.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647'
  });
  document.body.appendChild(container);

  return new Promise((resolve, reject) => {
    let widgetId;
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      finish(new Error('Human verification timed out. Please try again.'));
    }, 120000);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      try {
        if (widgetId !== undefined) turnstile.remove(widgetId);
      } catch (_error) {
        // The widget can already be removed after navigation or a provider-side failure.
      }
      container.remove();
    };
    const finish = (error, token = '') => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve({ turnstileToken: token, turnstileAction });
    };
    try {
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        action: turnstileAction,
        execution: 'execute',
        appearance: 'interaction-only',
        callback: (token) => finish(null, token),
        'error-callback': () => finish(new Error('Human verification failed. Please try again.')),
        'expired-callback': () => finish(new Error('Human verification expired. Please try again.')),
        'timeout-callback': () => finish(new Error('Human verification timed out. Please try again.'))
      });
      turnstile.execute(widgetId);
    } catch (error) {
      finish(error);
    }
  });
}

window.DynamaxPublicApi = {
  getJson: getPublicJson,
  getTurnstileToken
};

function applySiteProfile(profile) {
  document.title = document.title.replace('Destiny Christian Academy', profile.SchoolName || 'School Portal');
  document.querySelectorAll('[data-school-name]').forEach((node) => {
    node.textContent = profile.SchoolName || 'School Portal';
  });
  document.querySelectorAll('[data-school-address]').forEach((node) => {
    node.textContent = profile.SchoolAddress || '';
    node.hidden = !profile.SchoolAddress;
  });
  document.querySelectorAll('[data-portal-headline]').forEach((node) => {
    node.textContent = profile.PortalHeadline || '';
  });
  document.querySelectorAll('[data-portal-subheading]').forEach((node) => {
    node.textContent = profile.PortalSubheading || '';
  });
  document.querySelectorAll('[data-portal-notice]').forEach((node) => {
    node.textContent = profile.PortalNotice || '';
    node.hidden = !profile.PortalNotice;
  });
  document.querySelectorAll('[data-declaration-statement]').forEach((node) => {
    node.textContent = profile.DeclarationStatement || 'I declare that the information supplied in this application is complete and correct.';
  });
  const brandLogo = profile.WebLogoUrl || '/images/Logo.png';
  if (brandLogo) {
    document.querySelectorAll('img.logo, img.nav-logo').forEach((node) => {
      node.src = brandLogo;
      node.style.display = '';
    });
  }
  window.SCHOOL_PROFILE = profile;
  window.dispatchEvent(new CustomEvent('school-profile-ready', { detail: profile }));
}

window.siteProfileReady = loadSiteProfile().then((profile) => {
  applySiteProfile(profile);
  return profile;
});
