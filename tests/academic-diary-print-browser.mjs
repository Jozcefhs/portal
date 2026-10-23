// Synthetic HTML from both shipped print builders; no network or school data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { diaryPrintHtml } from '../js/academic-diary.js';

const { chromium } = await import(pathToFileURL(process.env.SUBMISSION_PLAYWRIGHT_MODULE).href);
const Subjects = ['Christian Religious Studies', 'Civic Education', 'Commerce', 'Computer Studies', 'DIY (Study)',
  'Economics', 'English Studies', 'Fashion Design and Garment Making', 'Financial Accounting', 'French',
  'Geography', 'Government', 'Literature in English', 'Livestock Farming', 'Mathematics'].map((Name, index) => ({ SubjectId: `s${index}`, Name }));
const diary = {
  Classrooms: [{ ClassId: 'grade10', ArmId: 'brilliance', Name: 'Grade 10 / Brilliance' }], Subjects, SessionName: '2026/2027', TermName: 'First Term',
  Weekly: { RecordId: 'synthetic-week', Week: 1, WeekEnding: '2026-10-23', Status: 'Draft', Entries: [
    { SubjectId: 's0', PlannedWork: { Theme: 'The early community', Content: 'Beliefs and shared responsibilities.' },
      WorkCompleted: 'Discussed the lesson and completed individual and group activities. Learners explained their answers with examples.',
      Notes: 'Review exercises next week.', TeacherUsername: 'sample.teacher', Status: 'Submitted' },
  ] },
  Scheme: { RecordId: 'synthetic-scheme', Weeks: [{ Week: 1, Theme: 'The early community', Content: 'Beliefs and shared responsibilities.' }] },
};
diary.LegacyClassRecords = [{ Name: 'Grade 10', Weekly: diary.Weekly, Scheme: { ...diary.Scheme, SubjectId: 's0' } }];
const selected = { ClassId: 'grade10', ArmId: 'brilliance', SubjectId: 's0' };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const client of ['web', 'desktop']) {
    for (const mode of ['weekly', 'scheme', 'legacy']) {
      const html = client === 'web' ? diaryPrintHtml(diary, selected, 'Sample School', mode) : execFileSync('python', ['-c',
        'import json,sys; from modules.academic_diary import build_diary_print_html; p=json.load(sys.stdin); print(build_diary_print_html(p["diary"],p["context"],"Sample School",p["mode"]))'],
      { cwd: '../suite', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, input: JSON.stringify({ diary, context: selected, mode }), encoding: 'utf8' });
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      await page.route('**/*', route => route.abort());
      await page.setContent(html);
      const metrics = await page.locator('table').first().evaluate(table => ({
        width: table.getBoundingClientRect().width,
        columns: [...table.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().width),
        header: getComputedStyle(table.querySelector('thead')).display,
        clipped: [...table.querySelectorAll('th,td')].some(cell => cell.scrollWidth > cell.clientWidth + 1),
      }));
      assert.ok(metrics.width <= 1033 && metrics.width > 1000, `${client}/${mode}: paper width ${metrics.width}`);
      const proportions = mode === 'scheme' ? [8, 32, 60] : [18, 24, 28, 15, 15];
      metrics.columns.forEach((width, index) => assert.ok(Math.abs(width / metrics.width * 100 - proportions[index]) < .2));
      assert.equal(metrics.header, 'table-header-group');
      assert.equal(metrics.clipped, false);
      const printed = await page.locator('body').innerText();
      assert.ok(printed.includes(mode === 'legacy' ? 'Grade 10' : 'Grade 10 / Brilliance'));
      if (mode === 'legacy') assert.ok(!printed.includes('Grade 10 / Brilliance'));
      if (mode === 'weekly') {
        assert.equal(await page.locator('tbody tr').count(), Subjects.length);
        assert.equal((await page.locator('tbody tr').nth(1).locator('td').nth(4).innerText()), 'Missing');
        await page.screenshot({ path: `tmp/diary-compact-print-${client}.png`, fullPage: true });
      }
      await page.setViewportSize({ width: 1032, height: 720 });
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('button').isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.close();
    }
  }
  console.log('PASS: web and desktop weekly, scheme and legacy prints use compact paper widths, proportional columns, wrapped content and repeated print headers.');
} finally { await browser.close(); }
