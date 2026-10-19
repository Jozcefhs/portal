import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('school application uses a direct long-past date selector for date of birth', async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL('../application.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/application.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/application.css', import.meta.url), 'utf8')
  ]);
  assert.match(html, /data-historical-date-picker/);
  assert.match(html, /id="dobYear"[^>]*required/);
  assert.match(html, /id="dobMonth"[^>]*required/);
  assert.match(html, /id="dobDay"[^>]*required/);
  assert.match(html, /id="dob" name="DateOfBirth" type="hidden"/);
  assert.match(script, /currentYear - 120/);
  assert.match(script, /daysInMonth\(year, month\)/);
  assert.match(script, /String\(month\)\.padStart\(2, '0'\)/);
  assert.match(css, /\.historical-date-picker\{display:grid/);
});
