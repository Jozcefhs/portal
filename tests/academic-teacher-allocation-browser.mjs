import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { allocationUiFixture } from './academic-teacher-allocation.test.mjs';
const playwright = await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
try {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const checks = [];
  for (const role of ['Form Teacher','Assistant Teacher']) for (const width of [1366,390]) {
    const fixture = allocationUiFixture(role);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.abort());
    await page.setContent(`<style>${css.replace(/@import[^;]+;/g,'')}main{padding:16px}</style><body class="staff-page"><main>${fixture.html}</main></body>`);
    await page.addScriptTag({ content: `
      window.academicManagementData=${JSON.stringify(fixture.data)};
      window.academicManagementFilters={section:'primary',sessionId:'session',termId:'term'};
      window.academicStudentAllocationDraft={};window.clean=v=>String(v??'').trim();window.escapeHtml=clean;
      ${fixture.scripts}
      const form=document.querySelector('[data-academic-student-placement]');
      for(const key of ['SessionId','TermId','ClassId','ArmId'])form.elements[key].addEventListener('change',()=>syncAcademicStudentPlacementForm(form,key));
      form.addEventListener('submit',event=>{event.preventDefault();window.submitted=Object.fromEntries(new FormData(form));});
      syncAcademicStudentPlacementForm(form);
    ` });
    const form = page.locator('[data-academic-student-placement]');
    assert.equal(await form.locator('[name="ClassId"]').inputValue(), 'class');
    assert.equal(await form.locator('[name="ArmId"]').inputValue(), 'arm');
    assert.equal(await page.locator('[data-academic-workflow="moveAcademicStudentMembership"],[data-academic-student-membership-import]').count(), 0);
    assert.equal(await form.locator('option[value="other-arm"],option[value="other-class"]').count(), 0);
    await form.locator('input[name="StudentRefs"]').check();
    await form.getByRole('button', { name: 'Allocate selected pupils' }).click();
    assert.deepEqual(await page.evaluate(() => ({ pupil: submitted.StudentRefs, arm: submitted.ArmId, class: submitted.ClassId })), { pupil: 'P1', arm: 'arm', class: 'class' });
    assert.deepEqual(errors, []);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    assert.equal(overflow, false, `${role} at ${width}px should fit the viewport`);
    await page.screenshot({ path: `tmp/teacher-allocation-${role.replaceAll(' ','-')}-${width}.png`, fullPage: true });
    checks.push({ role, width, submittedOwnClassroom: true, noExtraManagementActions: true, overflow });
    await page.close();
  }
  await writeFile('tmp/teacher-allocation-browser-proof.json', JSON.stringify(checks,null,2));
  console.log('Teacher/assistant allocation passed at desktop and mobile widths.');
} finally { await browser.close(); }
