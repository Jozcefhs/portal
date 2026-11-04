import {readFileSync} from 'node:fs';

// Serve the scripts and styles the actual Hospital page uses in local browser fixtures.
export function hospitalBrowserAssets() {
  const html = readFileSync(new URL('../../hospital.html', import.meta.url), 'utf8');
  return new Set(['/hospital.html', ...Array.from(
    html.matchAll(/(?:src|href)="(\/(?:js|css)\/[^"?]+)(?:[^" ]*)"/g), match => match[1]
  )]);
}
