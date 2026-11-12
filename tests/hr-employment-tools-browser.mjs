import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
const source = await readFile(new URL('../js/hr-employment-tools.js', import.meta.url), 'utf8');
const payGradesSource = await readFile(new URL('../js/hr-pay-grades.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
await mkdir(new URL('../tmp/hr-employment-ui/', import.meta.url), { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<style>${css}</style><main id="hr" style="max-width:1150px;margin:auto;padding:12px"></main>`);
  await page.evaluate(() => document.body.classList.add('staff-page'));
  await page.addScriptTag({ content: source });
  await page.addScriptTag({ content: payGradesSource });
  await page.evaluate(() => {
    window.calls = [];
    window.confirmations = [];
    window.acceptSend = false;
    window.failSend = false;
    const pdf = btoa('%PDF-1.4\n% Synthetic fixture\n%%EOF');
    const employees = {
      ada: { employee: { Username: 'ada', EmployeeId: 'EMP-ADA', DisplayName: 'Ada Example', Position: 'Administrative Officer', Department: 'Operations', EmploymentType: 'Permanent', HireDate: '2026-01-01', WorkEmail: 'ada@example.invalid', BranchId: 'annex' },
        profile: { BasicSalary: 150000, Allowances: [{ Name: 'Housing', Amount: 20000 }], Deductions: [{ Name: 'Loan', Amount: 1000 }], Currency: 'NGN' }, PayrollVersion: 'pay-v1', salaryEditable: true,
        salary: { GrossPay: 170000, Earnings: [{ Name: 'Basic salary', Amount: 150000 }, { Name: 'Housing', Amount: 20000 }], Deductions: [{ Name: 'Loan', Amount: 1000 }], Currency: 'NGN' }, letters: [] },
      bola: { employee: { Username: 'bola', EmployeeId: 'EMP-BOLA', DisplayName: 'Bola Example', Position: 'Officer', Department: 'Operations', WorkEmail: 'bola@example.invalid' },
        profile: { BasicSalary: 200000, CalculationMode: 'Configurable', Allowances: [], Deductions: [] }, PayrollVersion: 'pay-b1', salaryEditable: false, salary: { GrossPay: 250000, Earnings: [{ Name: 'Configured earnings', Amount: 250000 }], Deductions: [], Currency: 'NGN' }, letters: [], lettersTruncated: true },
      chidi: { employee: { Username: 'chidi', DisplayName: 'Chidi Example', BranchId: 'annex' }, profile: null, salaryEditable: true, letters: [] },
      efe: { employee: { Username: 'efe', DisplayName: 'Efe Example', BranchId: 'annex' }, profile: { BasicSalary: 0 }, salaryEditable: true, letters: [] }
    };
    const letters = {}, templates = { Allowances: ['Housing'], Deductions: ['Loan'] };
    let templateVersion = 'initial-catalog';
    let payGrade = null, assigned = [];
    const request = async (action, body) => {
      window.calls.push({ action, body: structuredClone(body) });
      if (action === 'getSalaryStructure') return structuredClone(employees[body.Username]);
      if (action === 'listPayGrades') return { grades: payGrade ? [structuredClone(payGrade)] : [] };
      if (action === 'savePayGrade') {
        payGrade = { ...body, GradeId: 'example-grade', Revision: 'grade-1' };
        return { grade: structuredClone(payGrade) };
      }
      if (action === 'renamePayGrade') {
        if (body.GradeRevision !== payGrade.Revision) throw new Error('Grade revision changed');
        payGrade = { ...payGrade, PayGrade: body.PayGrade, PayLevel: body.PayLevel, Revision: 'grade-2' };
        return { grade: structuredClone(payGrade) };
      }
      if (action === 'deletePayGrade') {
        if (body.GradeRevision !== payGrade.Revision) throw new Error('Grade revision changed');
        payGrade = null;
        return { ok: true };
      }
      if (action === 'listPayGradeMembers') return { usernames: assigned };
      if (action === 'getPayGradePreview') return { grade: structuredClone(payGrade), previewVersion: 'checked-version',
        changedCount: body.Usernames.length, staff: body.Usernames.map(name => ({
          Username: name, DisplayName: employees[name].employee.DisplayName, current: employees[name].profile
        })) };
      if (action === 'applyPayGrade') {
        if (body.PreviewVersion !== 'checked-version') throw new Error('Preview the batch first');
        assigned = body.Usernames;
        for (const name of assigned) {
          const { BasicSalary, Allowances, Deductions, GradeId, PayGrade, PayLevel } = payGrade;
          employees[name].profile = { ...employees[name].profile, BasicSalary, Allowances, Deductions, PayGradeId: GradeId, PayGrade, PayLevel };
          employees[name].PayrollVersion = 'grade-applied';
        }
        return { updatedCount: assigned.length };
      }
      if (action === 'listSalaryTemplates') return { templates: structuredClone(templates), templateVersion };
      if (action === 'addSalaryTemplate') {
        templates[body.Kind].push(body.Name);
        templateVersion = 'after-add';
        return { templates: structuredClone(templates), templateVersion, message: `${body.Name} added to the reusable list.` };
      }
      if (action === 'editSalaryTemplate' || action === 'deleteSalaryTemplate') {
        if (body.TemplateVersion !== templateVersion || body.BranchId !== 'annex') throw new Error('Wrong catalog version or branch');
        const items = templates[body.Kind], index = items.indexOf(body.ExistingName);
        if (index < 0) throw new Error('Missing reusable item');
        const editing = action === 'editSalaryTemplate';
        items.splice(index, 1, ...(editing ? [body.Name] : []));
        templateVersion = action;
        const message = editing ? `Reusable name updated to ${body.Name}.` : `${body.ExistingName} removed from the reusable list.`;
        return { templates: structuredClone(templates), templateVersion, message };
      }
      if (action === 'saveSalaryStructure') {
        assertNeverOtherEmployee(body);
        Object.assign(employees.ada.profile, body); employees.ada.PayrollVersion = 'pay-v2';
        employees.ada.salary.Earnings = [{Name:'Basic salary',Amount:body.BasicSalary},...body.Allowances];
        employees.ada.salary.Deductions = body.Deductions;
        employees.ada.salary.GrossPay = employees.ada.salary.Earnings.reduce((total,row) => total + row.Amount, 0);
        return { ...structuredClone(employees.ada), message: 'Salary saved on existing payroll profile.' };
      }
      if (action === 'saveEmploymentLetter' || action === 'previewEmploymentLetter') {
        const letter = { LetterId: action === 'saveEmploymentLetter' ? 'letter-1' : '', LetterVersion: 'letter-v1', LetterDate: body.LetterDate,
          EmployeeName: 'Ada Example', RecipientEmail: 'ada@example.invalid', Status: 'Draft', FileName: 'employment-letter.pdf', PdfBase64: pdf, Terms: { ...body } };
        if (letter.LetterId) letters[letter.LetterId] = letter;
        return { letter, message: action === 'saveEmploymentLetter' ? 'Letter draft saved.' : 'Preview ready.' };
      }
      if (action === 'loadEmploymentLetter') return { letter: structuredClone(letters[body.LetterId]) };
      if (action === 'sendEmploymentLetter') {
        if (window.failSend) { letters[body.LetterId].Status = 'Uncertain'; throw new Error('Email outcome is uncertain; check the provider log.'); }
        letters[body.LetterId].Status = 'Sent'; letters[body.LetterId].SentAt = '2026-11-10T10:00:00Z';
        return { letter: structuredClone(letters[body.LetterId]), message: 'Synthetic delivery recorded.' };
      }
      throw new Error(`Unexpected action ${action}`);
    };
    const assertNeverOtherEmployee = body => { if (body.Username !== 'ada' || body.PayrollVersion !== 'pay-v1') throw new Error('Wrong payroll identity/version'); };
    window.mountHr = edition => window.DynamaxHrEmployment.mount(document.getElementById('hr'), {
      edition, directory: Object.values(employees).map(row => row.employee),
      capabilities: { canViewSalaryStructure: true, canManageSalaryStructure: true, canIssueEmploymentLetters: true }, request,
      confirm: async options => { window.confirmations.push(options); return window.acceptSend; }
    });
    window.mountHr('school');
  });
  assert.equal(await page.evaluate(() => calls.length), 0, 'opening must not read payroll or letters');
  await page.getByLabel('Staff member', { exact: true }).selectOption('ada');
  assert.equal(await page.evaluate(() => calls.length), 0, 'selection without load stays read-free');
  await page.getByRole('button', { name: 'Load employee setup', exact: true }).click();
  await page.getByText('Employee setup loaded. Use Refresh for changes made elsewhere.').waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'Housing', exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('Housing amount (NGN)').inputValue(), '20000');
  assert.equal(await page.getByRole('checkbox', { name: 'Loan', exact: true }).isChecked(), true);
  await page.getByLabel('Basic salary (NGN)', { exact: true }).fill('160000');
  const manageItems = page.getByRole('button', { name: 'Manage reusable items', exact: true });
  const itemDialog = page.getByRole('dialog', { name: 'Reusable salary items', exact: true });
  await manageItems.click();
  await itemDialog.waitFor();
  const layout = await itemDialog.boundingBox();
  assert.ok(layout.width <= 460 && layout.height < 370, 'the catalog opens as a compact dialog');
  assert.equal(await itemDialog.getByRole('button', { name: 'Save reusable name', exact: true }).isVisible(), false);
  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 300 }]) {
    await page.setViewportSize(viewport);
    const box = await itemDialog.boundingBox();
    assert.ok(box.width <= viewport.width - 24 && box.height <= viewport.height - 32, 'the dialog fits narrow and short screens');
    assert.equal(await itemDialog.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true, 'the dialog needs no horizontal scrolling');
    if (viewport.width === 320) await itemDialog.screenshot({ path: fileURLToPath(new URL('../tmp/hr-employment-ui/reusable-items-320.png', import.meta.url)) });
  }
  await page.setViewportSize({ width: 1366, height: 1000 });
  await page.getByLabel('Reusable name', { exact: true }).fill('Transport');
  await page.getByRole('button', { name: 'Add reusable item', exact: true }).click();
  await page.getByText('Transport added to the reusable list.').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await itemDialog.isVisible(), false);
  assert.equal(await manageItems.evaluate(button => button === document.activeElement), true);
  assert.equal(await page.getByLabel('Basic salary (NGN)', { exact: true }).inputValue(), '160000');
  assert.equal(await page.getByLabel('Transport amount (NGN)').isDisabled(), true);
  await page.getByRole('checkbox', { name: 'Transport', exact: true }).check();
  await page.getByLabel('Transport amount (NGN)').fill('10000');
  await page.getByRole('checkbox', { name: 'Loan', exact: true }).uncheck();
  assert.equal(await page.getByLabel('Loan amount (NGN)').isDisabled(), true);
  await page.getByRole('button', { name: 'Add deduction', exact: true }).click();
  await page.getByLabel('Deduction name', { exact: true }).last().fill('Temporary row');
  await page.getByRole('button', { name: 'Remove deduction', exact: true }).last().click();
  await page.getByRole('button', { name: 'Save salary structure', exact: true }).click();
  await page.getByText('Salary saved on existing payroll profile.').waitFor();
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'saveSalaryStructure').length), 1);
  assert.deepEqual(await page.evaluate(() => calls.find(row => row.action === 'saveSalaryStructure').body.Allowances), [{Name:'Housing',Amount:20000},{Name:'Transport',Amount:10000}]);
  assert.deepEqual(await page.evaluate(() => calls.find(row => row.action === 'saveSalaryStructure').body.Deductions), []);
  await manageItems.click();
  const reusableItem = page.getByLabel('Reusable item', { exact: true });
  await reusableItem.selectOption({ label: 'Transport' });
  assert.equal(await itemDialog.getByRole('button', { name: 'Add reusable item', exact: true }).isVisible(), false);
  assert.equal(await page.getByLabel('Updated name', { exact: true }).inputValue(), 'Transport');
  await page.getByLabel('Updated name', { exact: true }).fill('Transport support');
  await page.getByRole('button', { name: 'Save reusable name', exact: true }).click();
  await page.getByText('Reusable name updated to Transport support.', { exact: true }).waitFor();
  await reusableItem.selectOption({ label: 'Housing' });
  await page.getByRole('button', { name: 'Delete reusable item', exact: true }).click();
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'deleteSalaryTemplate').length), 0);
  await page.evaluate(() => { acceptSend = true; });
  await page.getByRole('button', { name: 'Delete reusable item', exact: true }).click();
  await page.getByText('Housing removed from the reusable list.', { exact: true }).waitFor();
  await page.evaluate(() => { acceptSend = false; });
  await itemDialog.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await itemDialog.isVisible(), false);
  assert.deepEqual(await page.getByLabel('Allowance name', { exact: true }).evaluateAll(rows => rows.map(row => row.value)), ['Housing', 'Transport']);
  assert.deepEqual(await page.locator('.hr-component-row [data-hr-component-amount]').evaluateAll(rows => rows.map(row => row.value)), ['20000', '10000']);
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'saveSalaryStructure').length), 1, 'catalog edits do not save the salary form');
  await page.getByLabel('Staff member', { exact: true }).selectOption('bola');
  await page.getByRole('button', { name: 'Load employee setup', exact: true }).click();
  await page.getByText('Configured earnings', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-hr-letter-history-limit]').isVisible(), true);
  assert.equal(await page.getByLabel('Basic salary (NGN)', { exact: true }).isDisabled(), true);
  await page.getByLabel('Staff member', { exact: true }).selectOption('chidi');
  await page.getByRole('button', { name: 'Load employee setup', exact: true }).click();
  await page.getByText('Chidi Example · No saved salary structure yet.').waitFor();
  assert.equal(await page.getByLabel('Basic salary (NGN)', { exact: true }).inputValue(), '');
  await page.getByRole('button', { name: 'Save salary structure', exact: true }).click();
  assert.equal(await page.getByLabel('Basic salary (NGN)', { exact: true }).evaluate(input => input.validity.valueMissing), true);
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'saveSalaryStructure').length), 1, 'blank salary is never submitted');
  assert.equal(await page.getByRole('checkbox', { name: 'Housing', exact: true }).count(), 0);
  assert.equal(await page.getByRole('checkbox', { name: 'Transport support', exact: true }).isChecked(), false);
  assert.equal(await page.getByLabel('Transport support amount (NGN)').inputValue(), '');
  await page.getByLabel('Staff member', { exact: true }).selectOption('ada');
  assert.equal(await page.locator('[data-hr-letter-history-limit]').isVisible(), false);
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'getSalaryStructure').length), 3, 'return to loaded employee uses cache');
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'listSalaryTemplates').length), 1, 'reuse the branch list when switching employees');
  assert.deepEqual(await page.getByLabel('Allowance name', { exact: true }).evaluateAll(rows => rows.map(row => row.value)), ['Housing', 'Transport']);
  assert.equal(await page.getByLabel('Basic salary (NGN)', { exact: true }).inputValue(), '160000');
  await page.getByLabel('Letter date', { exact: true }).fill('2026-11-10');
  await page.getByLabel('Work location', { exact: true }).fill('Annex office');
  await page.getByLabel('Other agreed terms', { exact: true }).fill('Agreed terms for this synthetic example only.');
  assert.equal(await page.getByRole('button', { name: 'Send employment letter', exact: true }).isDisabled(), true);
  const firstDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  assert.equal((await firstDownload).suggestedFilename(), 'employment-letter.pdf');
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'previewEmploymentLetter').length), 1);
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'saveEmploymentLetter').length), 0, 'download preview is read-only');
  const secondDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click(); await secondDownload;
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'previewEmploymentLetter').length), 1, 'repeat PDF download uses cache');
  await page.getByRole('button', { name: 'Save letter draft', exact: true }).click();
  await page.getByText('Letter draft saved.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Send employment letter', exact: true }).click();
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'sendEmploymentLetter').length), 0, 'cancel must not send');
  await page.evaluate(() => { acceptSend = true; });
  await page.getByRole('button', { name: 'Send employment letter', exact: true }).click();
  await page.getByText('Synthetic delivery recorded.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Send employment letter', exact: true }).isDisabled(), true);
  const send = await page.evaluate(() => calls.find(row => row.action === 'sendEmploymentLetter').body);
  assert.deepEqual(send, { Username: 'ada', LetterId: 'letter-1', LetterVersion: 'letter-v1', ConfirmedRecipientEmail: 'ada@example.invalid', ConfirmSend: true });
  await page.getByLabel('Other agreed terms', { exact: true }).fill('Changed terms need a new saved draft.');
  assert.equal(await page.getByRole('button', { name: 'Send employment letter', exact: true }).isDisabled(), true);
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: fileURLToPath(new URL(`../tmp/hr-employment-ui/hr-${width}.png`, import.meta.url)), fullPage: true });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('*')].filter(node => node.getBoundingClientRect().right > window.innerWidth + 1).map(node => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().right)}`).slice(0, 12));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `no horizontal page overflow at ${width}px: ${overflow.join(', ')}`);
  }
  await page.getByRole('button', { name: 'Save letter draft', exact: true }).click();
  await page.getByText('Letter draft saved.', { exact: true }).waitFor();
  await page.evaluate(() => { failSend = true; });
  await page.getByRole('button', { name: 'Send employment letter', exact: true }).click();
  await page.getByText('Email outcome is uncertain; check the provider log. Load the saved letter to check its delivery state.').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Send employment letter', exact: true }).isDisabled(), true, 'uncertain response cannot be retried blindly');
  await page.getByRole('button', { name: 'Load saved letter', exact: true }).click();
  await page.getByText('Saved letter loaded.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Send employment letter', exact: true }).isDisabled(), true, 'saved Uncertain state is not resendable');
  await page.getByLabel('Staff member', { exact: true }).selectOption('efe');
  await page.getByRole('button', { name: 'Load employee setup', exact: true }).click();
  await page.getByText('Employee setup loaded. Use Refresh for changes made elsewhere.').waitFor();
  assert.equal(await page.getByLabel('Basic salary (NGN)', { exact: true }).inputValue(), '0', 'an explicitly saved zero stays visible');
  await page.getByLabel('Staff member', { exact: true }).selectOption('ada');
  await page.getByRole('checkbox', { name: 'Loan', exact: true }).check();
  await page.getByLabel('Loan amount (NGN)').fill('750');
  const gradeButton = page.getByRole('button', { name: 'Pay grades & levels', exact: true });
  await gradeButton.click();
  const gradesDialog = page.getByRole('dialog', { name: 'Pay grades and levels' });
  await gradesDialog.getByLabel('Pay grade', { exact: true }).fill('Officer');
  await gradesDialog.getByLabel('Pay level', { exact: true }).fill('Level 2');
  await gradesDialog.getByRole('button', { name: 'Save grade from salary form' }).click();
  await gradesDialog.getByText('Pay grade and level saved. Use Preview batch to apply its amounts.').waitFor();
  assert.deepEqual(await page.evaluate(() => {
    const { BasicSalary, Allowances, Deductions, BranchId } = calls.find(row => row.action === 'savePayGrade').body;
    return { BasicSalary, Allowances, Deductions, BranchId };
  }), { BasicSalary: 160000, Allowances: [{ Name: 'Housing', Amount: 20000 }, { Name: 'Transport', Amount: 10000 }],
    Deductions: [{ Name: 'Loan', Amount: 750 }], BranchId: 'annex' });
  assert.equal(await gradesDialog.getByRole('checkbox', { name: /Bola/ }).count(), 0);
  await gradesDialog.getByRole('checkbox', { name: /Ada Example/ }).check();
  await gradesDialog.getByRole('checkbox', { name: /Chidi Example/ }).check();
  await gradesDialog.getByRole('button', { name: 'Preview batch' }).click();
  await gradesDialog.getByText('Ada Example · ada', { exact: true }).waitFor();
  await gradesDialog.getByText('Chidi Example · chidi', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'applyPayGrade').length), 0);
  const box = await gradesDialog.boundingBox();
  assert.ok(box.width <= 366 && box.height <= 968, 'the pay grade dialog fits the phone viewport');
  await gradesDialog.getByRole('button', { name: 'Apply to 2 staff' }).click();
  await gradesDialog.getByText('Salary structure saved for 2 staff.').waitFor();
  assert.deepEqual(await page.evaluate(() => calls.find(row => row.action === 'applyPayGrade').body.Usernames), ['ada', 'chidi']);
  await gradesDialog.getByRole('button', { name: 'Select staff on this grade and level' }).click();
  await gradesDialog.getByText('2 staff on this grade and level selected.').waitFor();
  const gradeManage = gradesDialog.getByText('Edit or delete grade and level', { exact: true });
  await gradeManage.click();
  await gradesDialog.getByLabel('New pay grade', { exact: true }).fill('Senior officer');
  await gradesDialog.getByLabel('New pay level', { exact: true }).fill('Level 3');
  await gradesDialog.getByRole('button', { name: 'Save grade and level names' }).click();
  await gradesDialog.getByText('Grade and level names saved.').waitFor();
  assert.equal(await gradesDialog.getByLabel('Grade and level', { exact: true })
    .locator('option:checked').textContent(), 'Senior officer · Level 3');
  await gradeManage.click();
  await page.evaluate(() => { acceptSend = false; });
  await gradesDialog.getByRole('button', { name: 'Delete grade and level', exact: true }).click();
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'deletePayGrade').length), 0);
  await page.evaluate(() => { acceptSend = true; });
  await gradesDialog.getByRole('button', { name: 'Delete grade and level', exact: true }).click();
  await gradesDialog.getByText('Grade and level deleted.').waitFor();
  assert.equal(await gradesDialog.getByLabel('Grade and level', { exact: true }).locator('option').count(), 1);
  assert.equal(await page.evaluate(() => calls.filter(row => row.action === 'applyPayGrade').length), 1);
  await gradesDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByText(/Pay grade Officer · Level 2/).waitFor();
  for (const edition of ['faith', 'organisation', 'hospital']) {
    const before = await page.evaluate(() => calls.length);
    await page.evaluate(value => mountHr(value), edition);
    assert.equal(await page.evaluate(() => calls.length), before, `${edition} workspace opening is read-free`);
    assert.equal(await page.getByRole('button', { name: 'Load employee setup', exact: true }).count(), 1);
  }
  assert.deepEqual(errors, []);
  console.log('HR employment browser checks passed: scoped cached loading, existing salary edit, configured profile read-only, PDF cache, explicit sending, all editions and mobile layout.');
} finally { await browser.close(); }
