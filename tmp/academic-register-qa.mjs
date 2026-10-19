import { writeFile } from 'node:fs/promises';
import { fixture, renderWorkspace } from '../tests/helpers/academic-register-fixture.mjs';
const input = fixture();
for (const kind of ['attendance', 'scorebook']) {
  const form = renderWorkspace(kind, input).match(/<form[\s\S]*?<\/form>/)[0];
  await writeFile(new URL(`academic-${kind}-qa.html`, import.meta.url), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Academic ${kind} layout check</title><link rel="stylesheet" href="/css/style.css"><style>body{margin:0;padding:18px}main{max-width:1200px;margin:0 auto;display:grid;gap:14px;min-width:0}header{padding:12px;background:#102e48;color:white;border-radius:10px}header strong{color:white}header small{display:block}</style></head><body><main><header><strong>Academic Management</strong><small>Local layout preview · sample students</small></header>${form}</main></body></html>`);
}
