const YOUTUBE_TUTORIAL_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'youtu.be', 'www.youtu.be',
  'youtube-nocookie.com', 'www.youtube-nocookie.com'
]);

function clean(value) {
  return String(value ?? '').trim();
}

export function normalizeYouTubeTutorialUrl(value) {
  const url = clean(value);
  if (!url) return '';
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    const err = new Error('Enter a valid YouTube URL.');
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== 'https:' || !YOUTUBE_TUTORIAL_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.pathname === '/') {
    const err = new Error('Tutorial links must use an HTTPS YouTube video, playlist or channel address.');
    err.status = 400;
    throw err;
  }
  return url;
}

export function normalizeTutorialLinks(value) {
  let source = value;
  if (typeof source === 'string') {
    try { source = source.trim() ? JSON.parse(source) : {}; } catch (_error) { source = {}; }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const entries = Object.entries(source).slice(0, 64);
  return Object.fromEntries(entries.flatMap(([rawLabel, rawUrl]) => {
    const label = clean(rawLabel).slice(0, 120);
    if (!label) return [];
    const url = normalizeYouTubeTutorialUrl(rawUrl);
    return url ? [[label, url]] : [];
  }));
}
