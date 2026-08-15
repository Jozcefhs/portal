import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const adminJs = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const portalCss = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

test('executive office is an edition-aware staff workspace', () => {
  assert.match(adminJs, /\['executiveOffice', 'Executive Office'\]/);
  assert.match(adminJs, /function executiveOfficeTitle\(\)/);
  assert.match(adminJs, /return "Principal's Office"/);
  assert.match(adminJs, /return "Senior Pastor's Office"/);
  assert.match(adminJs, /executiveOffice: '\\u\{1F4E8\}'/);
  assert.match(adminJs, /active === 'executiveOffice'/);
  assert.match(adminJs, /loadExecutiveOffice\(\)/);
});

test('principal and ministry executive roles are available and retain user settings', () => {
  for (const role of ['Principal', 'Senior Pastor', 'Head Minister']) {
    assert.match(adminJs, new RegExp(`'${role}'`));
  }
  assert.match(adminJs, /const isExecutiveRole = \['Principal', 'Senior Pastor', 'Head Minister'\]/);
  assert.match(adminJs, /user\.role === 'Accounts Officer' \|\|[\s\S]*?isExecutiveRole \|\|[\s\S]*?user\.approvalEnabled/);
});

test('executive correspondence uses the authenticated server API for every workflow', () => {
  assert.match(adminJs, /staffFetch\('\/api\/staff-correspondence'/);
  for (const action of ['bootstrap', 'search', 'savePreferences', 'saveTemplate', 'saveDraft', 'issue', 'send', 'document']) {
    assert.match(adminJs, new RegExp(`['"]${action}['"]`), `${action} should be wired`);
  }
  assert.match(adminJs, /Enter your current password to issue or send this official document/);
  assert.match(adminJs, /A recipient email address is required before this document can be sent/);
  assert.match(adminJs, /delete draftPayload\.approvalPassword;[\s\S]*?const saved = await executiveOfficeRequest\('saveDraft', draftPayload\)/);
  assert.match(adminJs, /payload\.correspondenceId = executiveCorrespondenceId\(saved\.correspondence\)/);
  assert.match(adminJs, /function executiveSendDialogMarkup\(\)/);
  assert.match(adminJs, /\$\{executiveSendDialogMarkup\(\)\}/);
  assert.match(adminJs, /class="compact-icon-action executive-send-action" data-send-executive=/);
  assert.match(adminJs, /function openExecutiveSendDialog\(correspondenceId\)/);
  assert.match(adminJs, /form\.elements\.recipientEmail\.value = clean\(pick\(row, \['RecipientEmail', 'recipientEmail'\]\)\)/);
  assert.match(adminJs, /typeof dialog\.showModal === 'function'/);
  assert.match(adminJs, /openExecutiveSendDialog\(button\.dataset\.sendExecutive\)/);
});

test('executive workspace provides configurable metrics, directories, templates, composer and register', () => {
  assert.match(adminJs, /Choose summary cards and charts/);
  assert.match(adminJs, /executiveMetricCatalog/);
  assert.match(adminJs, /savePreferences', \{ metricIds \}/);
  assert.match(adminJs, /Read-only directory/);
  assert.match(adminJs, /Template library/);
  assert.match(adminJs, /Transfer certificate details/);
  assert.match(adminJs, /Apply my signature/);
  assert.match(adminJs, /Apply official stamp/);
  assert.match(adminJs, /Correspondence register/);
  assert.match(adminJs, /Print preview/);
  assert.match(adminJs, /\{ id: 'student', label: 'Students' \}/);
  assert.match(adminJs, /\{ id: 'member', label: 'Members' \}/);
  assert.match(adminJs, /return \{ type: 'class', \.\.\.row \}/);
  assert.match(adminJs, /payload\.SubjectTemplate = payload\.subject/);
  assert.match(adminJs, /LEAVING_DATE: payload\.leavingDate/);
  assert.match(adminJs, /body\.replace\(\/\\\{\\\{LETTER_BODY\\\}\\\}\/gi/);
  assert.match(adminJs, /LETTER_BODY: ''/);
  assert.match(adminJs, /name="directoryRecipientEmail"/);
  assert.match(adminJs, /payload\.directoryRecipientEmail\) \|\| executiveRecordEmail/);
  assert.doesNotMatch(adminJs, /\.filter\(\(metric\) => selected\.has\(metric\.id\)\)\s*\.slice\(0, 6\)/);
  assert.match(adminJs, /data-executive-manage-staff>Manage staff accounts/);
  assert.match(adminJs, /data-executive-manage-staff\]'\)\?\.addEventListener\('click', \(\) => selectSection\('staffUsers'\)\)/);
});

test('executive office remains responsive and readable in dark mode', () => {
  assert.match(portalCss, /\.executive-workspace-tabs\{/);
  assert.match(portalCss, /\.executive-directory-layout\{display:grid;grid-template-columns:230px minmax\(0,1fr\)/);
  assert.match(portalCss, /\.executive-composer\{display:grid/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.executive-workspace-tabs/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.executive-compose-card input/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.executive-directory-search>label\{color:#e7f1fb\}/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.executive-directory-email\{color:#e7f1fb\}/);
  assert.match(portalCss, /\.executive-empty-chart h3\{color:#173b58\}/);
  assert.match(portalCss, /\.executive-empty-chart \.muted\{color:#60778c!important\}/);
  assert.match(portalCss, /\.executive-register-row \.executive-send-action,[^{]*\{color:#185f96!important\}/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.executive-empty-chart\{[^}]*background:#112438;[^}]*color:#edf5ff\}/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.executive-empty-chart \.muted\{color:#b8cada!important\}/);
  assert.match(portalCss, /@media\(max-width:680px\)\{[\s\S]*?\.executive-directory-layout\{grid-template-columns:1fr/);
  assert.match(adminHtml, /js\/admin\.js\?v=20260815-bulk-subject-delete/);
});
