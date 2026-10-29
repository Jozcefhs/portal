import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertWebReleaseMetadata(html, worker) {
  const pages = [...html.matchAll(/<meta\s+name=["']dynamax-web-release["']\s+content=["']([^"']+)["']/g)];
  const workers = [...worker.matchAll(/^const\s+CACHE\s*=\s*["'](dynamax-v\d+-[a-z0-9-]+)["']/gm)];
  if (pages.length !== 1 || workers.length !== 1 || pages[0][1] !== workers[0][1]) {
    throw new Error('Web release mismatch: admin.html must declare the same release as sw.js. Deployment would show a permanent update banner.');
  }
  return pages[0][1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf('--root'), root = resolve(index >= 0 ? process.argv[index + 1] : '.');
  const [html, worker] = await Promise.all(['admin.html', 'sw.js'].map(path => readFile(resolve(root, path), 'utf8')));
  console.log(`Web release metadata verified: ${assertWebReleaseMetadata(html, worker)}`);
}
