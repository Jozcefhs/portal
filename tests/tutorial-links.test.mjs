import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeTutorialLinks,
  normalizeYouTubeTutorialUrl
} from '../functions/api/backend.js';

const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');

test('tutorial settings accept only secure YouTube destinations', () => {
  assert.equal(normalizeYouTubeTutorialUrl('https://youtu.be/abc123'), 'https://youtu.be/abc123');
  assert.equal(normalizeYouTubeTutorialUrl('https://www.youtube.com/@DynamaxVendmac'), 'https://www.youtube.com/@DynamaxVendmac');
  assert.throws(() => normalizeYouTubeTutorialUrl('https://example.com/tutorial'), /YouTube/);
  assert.throws(() => normalizeYouTubeTutorialUrl('http://youtube.com/watch?v=abc'), /HTTPS YouTube/);
});

test('tutorial catalogue drops blank links and persists through the school profile', () => {
  assert.deepEqual(normalizeTutorialLinks({
    Accounts: 'https://youtu.be/accounts',
    Students: ''
  }), { Accounts: 'https://youtu.be/accounts' });
  assert.match(backendSource, /TutorialLinks: normalizeTutorialLinks\(/);
  assert.match(backendSource, /TutorialChannelUrl: normalizeYouTubeTutorialUrl\(/);
});
