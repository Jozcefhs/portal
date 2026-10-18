import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPrintableCorrespondence, executiveSignatoryTitle } from '../functions/lib/executive-correspondence.js';

test('the saved staff position is used, not a permission role or generic officer title', () => {
  assert.equal(executiveSignatoryTitle({ Position: ' Principal ', Role: 'Super Admin' }), 'Principal');
  assert.equal(executiveSignatoryTitle({ position: 'Finance Director' }), 'Finance Director');
  assert.equal(executiveSignatoryTitle({ Position: ' ', Role: 'Super Admin' }), 'Authorised Officer');
  assert.equal(executiveSignatoryTitle(), 'Authorised Officer');
  const source = fs.readFileSync(new URL('../functions/lib/executive-correspondence.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!immutable\) \{[\s\S]*?IssuerTitle: await loadExecutiveSignatoryTitle\(env, user\)/);
  assert.match(source, /const issuerTitle = await loadExecutiveSignatoryTitle\(env, user\)/);
  assert.match(source, /findStaffUserRecord\(env, user.username\)/);
});

for (const Edition of ['school', 'faith', 'organization']) {
  test(`${Edition} uses the desktop A4 letter layout and subscriber code with no top rule`, () => {
    const { html, emailHtml } = buildPrintableCorrespondence({ Reference: 'TEST-COR-1', Kind: 'general',
      RecipientName: 'Test Recipient', IssuedAt: '2026-10-18', IssuedBy: 'Test Officer', IssuerTitle: 'Director' },
    { Edition, Name: 'Test Subscriber', Code: 'SUB', Address: 'Test address', Email: 'office@example.test' },
    { subject: 'Official Letter: Confirmation', body: 'A sample official message.' });
    assert.match(html, /@page\{size:A4;margin:20mm 18mm 18mm/);
    assert.match(html, /header\{text-align:center\}/);
    assert.match(html, /width:22mm;height:22mm/);
    assert.match(html, /10.5pt\/16pt/);
    assert.match(html, /18 October 2026/);
    assert.match(html, /Generated from the SUB Executive Office/);
    assert.match(emailHtml, /Official document · TEST-COR-1 · SUB/);
    assert.match(html, /Test Officer<\/strong><br>Director/);
    assert.doesNotMatch(html, /border-top|letterhead-accent|Dynamax Executive|text-transform:uppercase/);
  });
}

test('transfer details are escaped and fallback footer uses subscriber name', () => {
  const { html } = buildPrintableCorrespondence({ Reference: 'TEST', Kind: 'transfer-certificate',
    RecipientName: 'Test <Student>', IssuerTitle: '', TokenValues: { ADMISSION_NO: 'TEST/001', CLASS: 'Grade 8',
      ADMISSION_DATE: '20 July 2022', LEAVING_DATE: '12 September 2026', REASON: 'Transfer', CONDUCT: 'Good <conduct>' } },
  { Name: 'Example & School' }, { subject: 'Transfer Letter', body: 'Test body.' });
  assert.match(html, /class="details"/); assert.match(html, /Test &lt;Student&gt;/);
  for (const text of ['TEST/001', 'Grade 8', '20 July 2022', '12 September 2026', 'Good &lt;conduct&gt;', 'Authorised Officer']) assert.ok(html.includes(text));
  assert.match(html, /Generated from the Example &amp; School Executive Office/);
  assert.doesNotMatch(html, /<Student>|<conduct>/);
});

test('compose preview and saved document use the same server renderer, without issuing or saving the preview', () => {
  const source = fs.readFileSync(new URL('../functions/lib/executive-correspondence.js', import.meta.url), 'utf8');
  const preview = source.slice(source.indexOf("if (action === 'preview')"), source.indexOf("if (action === 'savetemplate')"));
  assert.match(preview, /loadBrandingContext\(env, identity, draft, user\)/);
  assert.match(preview, /buildPrintableCorrespondence\(rendered.correspondence/);
  assert.match(preview, /loadStaffApprovalProfile\(env, user.username\)/);
  assert.doesNotMatch(preview, /upsertDocument|saveDraft\(|issueCorrespondence|sendCorrespondence/);
  const admin = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /executiveOfficeRequest\('preview', payload\)/);
  assert.doesNotMatch(admin, /openExecutivePrint\(executiveComposerPayload/);
});
