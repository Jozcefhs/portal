import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  absolutePublicAssetUrl,
  buildIssuanceSnapshot,
  buildPrintableCorrespondence,
  canonicalExecutiveRole,
  executiveOfficeCapabilities,
  normalizeCorrespondenceDraft,
  normalizeExecutiveMetricPreferences,
  normalizeTemplate,
  validateTemplateWriteTarget,
  renderTokenTemplate,
  snapshotIdentityMatchesDeployment,
  visibleExecutiveStaffRow
} from '../functions/lib/executive-correspondence.js';
import { requireBackendSecret } from '../functions/api/backend.js';
import { featureFlagsForEdition } from '../functions/lib/organization-config.js';
import { recordsDeskCapabilities } from '../functions/lib/records-desk.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';

const portalRoot = new URL('../', import.meta.url);
const [endpoint, backend, backendSecurity, executiveSource, emailSource, backupSource] = await Promise.all([
  readFile(new URL('functions/api/staff-correspondence.js', portalRoot), 'utf8'),
  readFile(new URL('functions/api/backend.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/backend-security.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/executive-correspondence.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/email-service.js', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/organization-backup.js', portalRoot), 'utf8')
]);

test('principal also receives school conduct oversight while senior-minister defaults remain scoped', () => {
  assert.deepEqual(
    allowedSectionsFor({ role: 'Principal' }, featureFlagsForEdition('school')),
    ['recordsDesk', 'executiveOffice', 'studentConduct', 'humanResources', 'staffAttendance']
  );
  assert.deepEqual(
    allowedSectionsFor({ role: 'Senior Pastor' }, featureFlagsForEdition('faith')),
    ['recordsDesk', 'executiveOffice', 'humanResources', 'staffAttendance']
  );
  assert.deepEqual(
    allowedSectionsFor({ role: 'Head Minister' }, featureFlagsForEdition('organization')),
    ['recordsDesk', 'executiveOffice', 'humanResources', 'staffAttendance']
  );
  assert.equal(canonicalExecutiveRole('Head Minister'), 'Senior Pastor');
  assert.equal(executiveOfficeCapabilities({
    role: 'Principal',
    edition: 'school',
    allowedSections: ['recordsDesk', 'executiveOffice']
  }).canSearchStudents, true);
  assert.equal(executiveOfficeCapabilities({
    role: 'Principal',
    edition: 'faith',
    allowedSections: ['recordsDesk', 'executiveOffice']
  }).enabled, false);
  assert.equal(executiveOfficeCapabilities({
    role: 'Pastor',
    edition: 'faith',
    allowedSections: ['recordsDesk']
  }).enabled, false);
});

test('executive Records Desk access includes safe staff search without staff security administration', () => {
  const principal = recordsDeskCapabilities({
    role: 'Principal',
    edition: 'school',
    allowedSections: ['recordsDesk', 'executiveOffice']
  });
  assert.equal(principal.canSearchStudents, true);
  assert.equal(principal.canSearchStaff, true);
  assert.equal(principal.canViewStaffSecurity, false);
  assert.equal(principal.canViewStudentFinance, false);

  const seniorPastor = recordsDeskCapabilities({
    role: 'Senior Pastor',
    edition: 'faith',
    allowedSections: ['recordsDesk', 'executiveOffice']
  });
  assert.equal(seniorPastor.canSearchMembers, true);
  assert.equal(seniorPastor.canSearchDepartments, true);
  assert.equal(seniorPastor.canSearchStaff, true);
  assert.equal(seniorPastor.canViewStaffSecurity, false);
});

test('executive staff counts and directory never cross organisation editions', () => {
  const faithScope = { edition: 'faith', branchId: 'main', schoolSection: '' };
  const faithExecutive = { edition: 'faith', username: 'faith.admin' };
  assert.equal(visibleExecutiveStaffRow(
    { Username: 'school.teacher', OrganisationEdition: 'school', BranchId: 'main' },
    faithScope,
    faithExecutive
  ), false);
  assert.equal(visibleExecutiveStaffRow(
    { Username: 'faith.pastor', OrganisationEdition: 'church', BranchId: 'main' },
    faithScope,
    faithExecutive
  ), true);
  assert.equal(visibleExecutiveStaffRow(
    { Username: 'faith.admin', BranchId: 'main' },
    faithScope,
    faithExecutive
  ), true);
  assert.equal(visibleExecutiveStaffRow(
    { Username: 'legacy.school', BranchId: 'main' },
    faithScope,
    faithExecutive
  ), false);
  assert.equal(visibleExecutiveStaffRow(
    { Username: 'other.branch', OrganisationEdition: 'faith', BranchId: 'abuja' },
    faithScope,
    faithExecutive
  ), false);
});

test('official templates are plain text, token bounded, and edition aware', () => {
  const draft = normalizeCorrespondenceDraft({
    Kind: 'transfer-certificate',
    SubjectTemplate: 'Transfer Certificate - {{STUDENT_NAME}}',
    BodyTemplate: 'Student {{STUDENT_NAME}} / {{ADMISSION_NO}}',
    RecipientType: 'student',
    RecipientId: 'DCA/26/001',
    RecipientName: 'Ada Grace',
    TokenValues: {
      STUDENT_NAME: 'Ada Grace',
      ADMISSION_NO: 'DCA/26/001',
      PASSWORD_HASH: 'must-not-be-retained'
    }
  }, {
    edition: 'school',
    branchId: 'main',
    schoolSection: 'secondary',
    actor: 'The Principal',
    username: 'principal',
    now: '2026-07-28T12:00:00.000Z'
  });
  assert.equal(draft.Kind, 'transfer-certificate');
  assert.equal(draft.TokenValues.STUDENT_NAME, 'Ada Grace');
  assert.equal(Object.hasOwn(draft.TokenValues, 'PASSWORD_HASH'), false);
  assert.equal(
    renderTokenTemplate(draft.SubjectTemplate, draft.TokenValues),
    'Transfer Certificate - Ada Grace'
  );
  assert.throws(() => normalizeCorrespondenceDraft({
    Kind: 'transfer-certificate',
    Subject: 'Transfer',
    Body: 'Body',
    RecipientType: 'student',
    RecipientName: 'Ada'
  }, { edition: 'school' }), /linked to an enrolled student/);
  assert.throws(() => normalizeCorrespondenceDraft({
    Kind: 'transfer-certificate',
    Subject: 'Transfer',
    Body: 'Body',
    RecipientType: 'custom',
    RecipientName: 'Ada'
  }, { edition: 'school' }), /linked to an enrolled student/);
  assert.throws(() => normalizeCorrespondenceDraft({
    Kind: 'official-letter',
    Subject: '{{PASSWORD_HASH}}',
    Body: 'Body',
    RecipientName: 'Recipient'
  }, { edition: 'school' }), /unsupported token/);
});

test('custom template IDs are server generated and updates cannot cross scope or overwrite built-ins', () => {
  const created = normalizeTemplate({
    TemplateId: 'caller-controlled-id',
    Name: 'Custom letter',
    Kind: 'official-letter',
    Subject: 'Notice',
    Body: 'Body'
  }, {
    edition: 'school',
    branchId: 'main',
    schoolSection: 'secondary',
    actor: 'Principal'
  });
  assert.match(created.TemplateId, /^TPL-/);
  assert.notEqual(created.TemplateId, 'caller-controlled-id');
  assert.throws(
    () => validateTemplateWriteTarget('builtin-official-letter', null, {
      edition: 'school', branchId: 'main', schoolSection: 'secondary'
    }),
    /Built-in templates cannot be overwritten/
  );
  assert.throws(
    () => validateTemplateWriteTarget('TPL-OTHER', {
      TemplateId: 'TPL-OTHER',
      Edition: 'school',
      BranchId: 'another-branch',
      SchoolSection: 'secondary'
    }, {
      edition: 'school', branchId: 'main', schoolSection: 'secondary'
    }),
    /another branch or section/
  );
  assert.throws(
    () => validateTemplateWriteTarget('TPL-MISSING', null, {
      edition: 'school', branchId: 'main', schoolSection: 'secondary'
    }),
    /not found/
  );
});

test('issuance snapshots copy identity, branding, recipient and tokens for stable later rendering', () => {
  const identity = {
    Name: 'Dynamax School',
    Code: 'DCA',
    Edition: 'school',
    Address: 'Original Road',
    Email: 'office@example.com',
    Phone: '0800',
    CurrentAcademicSession: '2026/2027',
    LogoUrl: 'https://portal.example/images/logo.png'
  };
  const correspondence = {
    CorrespondenceId: 'COR-1',
    IssuedAt: '2026-07-28T12:00:00.000Z',
    RecipientType: 'student',
    RecipientId: 'DCA/26/001',
    RecipientName: 'Ada Grace',
    RecipientEmail: 'parent@example.com',
    RecipientAddress: 'Old Address',
    TokenValues: { STUDENT_NAME: 'Ada Grace', CLASS: 'JSS 1' }
  };
  const snapshot = buildIssuanceSnapshot(identity, correspondence);
  identity.Name = 'Renamed School';
  correspondence.RecipientName = 'Changed Student';
  correspondence.TokenValues.CLASS = 'SSS 3';
  assert.equal(snapshot.Identity.Name, 'Dynamax School');
  assert.equal(snapshot.SnapshotVersion, 2);
  assert.equal(snapshot.Identity.LogoUrl, 'https://portal.example/images/logo.png');
  assert.equal(snapshot.Recipient.RecipientName, 'Ada Grace');
  assert.equal(snapshot.TokenValues.CLASS, 'JSS 1');
});

test('public asset URLs are absolute for email clients', () => {
  assert.equal(
    absolutePublicAssetUrl({ PUBLIC_PORTAL_URL: 'https://portal.example/' }, '/images/Logo.png'),
    'https://portal.example/images/Logo.png'
  );
  assert.equal(
    absolutePublicAssetUrl({}, 'http://legacy.example/logo.png'),
    'https://legacy.example/logo.png'
  );
  assert.equal(
    absolutePublicAssetUrl({}, '/api/document-logo', 'https://destinychristianacademy.pages.dev'),
    'https://destinychristianacademy.pages.dev/api/document-logo'
  );
  assert.equal(
    absolutePublicAssetUrl({}, '/api/document-logo', 'https://digc-suite.pages.dev'),
    'https://digc-suite.pages.dev/api/document-logo'
  );
  assert.equal(absolutePublicAssetUrl({}, '/api/document-logo'), '');
});

test('issuance snapshot identity cannot cross deployment boundaries', () => {
  assert.equal(snapshotIdentityMatchesDeployment(
    { Edition: 'school', WorkspaceId: 'school-main', Code: 'DCA' },
    { Edition: 'school', WorkspaceId: 'school-main', Code: 'DCA' }
  ), true);
  assert.equal(snapshotIdentityMatchesDeployment(
    { Edition: 'faith', WorkspaceId: 'faith-main', Code: 'DIGC' },
    { Edition: 'school', WorkspaceId: 'school-main', Code: 'DCA' }
  ), false);
  assert.equal(snapshotIdentityMatchesDeployment(
    { Edition: 'school', WorkspaceId: 'faith-main', Code: 'DIGC' },
    { Edition: 'school', WorkspaceId: 'school-main', Code: 'DCA' }
  ), false);
});

test('dashboard preferences discard unknown metrics and remain bounded', () => {
  assert.deepEqual(
    normalizeExecutiveMetricPreferences([
      'studentTotal', 'unknownQuery', 'staffTotal', 'studentTotal',
      'classTotal', 'activeStudents', 'activeStaff', 'studentByClass',
      'staffByDepartment', 'correspondenceByStatus', 'issuedCorrespondence'
    ], 'school'),
    [
      'studentTotal', 'staffTotal', 'classTotal', 'activeStudents',
      'activeStaff', 'studentByClass', 'staffByDepartment', 'correspondenceByStatus'
    ]
  );
  assert.deepEqual(
    normalizeExecutiveMetricPreferences([], 'faith'),
    ['memberTotal', 'departmentTotal', 'staffTotal', 'issuedCorrespondence']
  );
});

test('printable official documents use branding and safely escape plain-text content', () => {
  const printable = buildPrintableCorrespondence({
    CorrespondenceId: 'COR-1',
    Reference: 'DCA-TC-1',
    Kind: 'transfer-certificate',
    RecipientName: 'Ada <Grace>',
    IssuedAt: '2026-07-28T12:00:00.000Z',
    IssuedBy: 'Jane Principal',
    IssuerTitle: 'Principal',
    SignatureApplied: true,
    StampApplied: true
  }, {
    Name: 'Dynamax School',
    Address: 'School Road',
    Email: 'office@example.com',
    Phone: '0800',
    LogoUrl: 'https://portal.example/images/logo.png',
    LogoDataUrl: 'data:image/png;base64,AAAA'
  }, {
    subject: 'Transfer <Certificate>',
    body: 'This body contains <script>alert(1)</script>.'
  }, {
    SignatureDataUrl: 'data:image/png;base64,BBBB',
    StampDataUrl: 'data:image/png;base64,CCCC'
  });
  assert.equal(printable.title, 'Transfer <Certificate>');
  assert.equal(printable.documentTypeTitle, 'Transfer Certificate');
  assert.match(printable.html, /class="signature-image"/);
  assert.match(printable.html, /class="stamp-image"/);
  assert.doesNotMatch(printable.html, /class="watermark"/);
  assert.match(printable.html, /background-image:/);
  assert.match(printable.html, /header\{[^}]*grid-template-columns:72px minmax\(0,1fr\) 72px/);
  assert.match(printable.html, /\.identity\{text-align:center\}/);
  assert.match(printable.html, /\.meta>div:last-child\{text-align:right\}/);
  assert.match(printable.html, /\.footer\{[^}]*text-align:center/);
  assert.match(printable.emailHtml, /Digitally signed/);
  assert.match(printable.emailHtml, /Official stamp applied/);
  assert.doesNotMatch(printable.emailHtml, /data:image/);
  assert.match(printable.emailHtml, /https:\/\/portal\.example\/images\/logo\.png/);
  assert.equal(printable.emailAttachments.length, 2);
  assert.equal(printable.emailAttachments[0].name, 'DCA-TC-1-signature.png');
  assert.equal(printable.emailAttachments[0].content, 'BBBB');
  assert.match(printable.html, /Ada &lt;Grace&gt;/);
  assert.doesNotMatch(printable.html, /<script>alert/);
  assert.doesNotMatch(printable.emailHtml, /<script>alert/);
});

test('official correspondence sends the email-safe layout with bounded endorsement attachments', () => {
  assert.match(executiveSource, /htmlContent: printable\.emailHtml \|\| printable\.html/);
  assert.match(executiveSource, /attachments: printable\.emailAttachments/);
  assert.match(executiveSource, /senderProfile: 'executive'/);
  assert.match(emailSource, /payload\.attachment = normalizedAttachments/);
  assert.match(emailSource, /content\.length > 1500000/);
  assert.match(emailSource, /getDocument\(env, 'settings', 'organisationProfile'\)/);
  assert.match(emailSource, /env\.BREVO_API_KEY \|\| brevo\?\.BrevoApiKey/);
  assert.match(emailSource, /schoolProfile\?\.BrevoSenderEmail/);
  assert.match(emailSource, /brevo\?\.ExecutiveSenderEmail/);
  assert.match(emailSource, /brevo\?\.OrganisationSenderEmail/);
  assert.match(emailSource, /brevo\?\.OrganisationExecutiveSenderEmail/);
  assert.match(emailSource, /payload\.replyTo = \{ email: replyToEmail/);
});

test('email correspondence uses a table layout, aligned background watermark, and one generated signature block', () => {
  const printable = buildPrintableCorrespondence({
    CorrespondenceId: 'COR-LEGACY-1',
    Reference: 'DIGC-COR-1',
    Kind: 'external-agency',
    RecipientName: 'Rosemary Ethan',
    IssuedAt: '2026-07-29T12:00:00.000Z',
    IssuedBy: 'Jozcefhs',
    IssuerTitle: 'Super Admin'
  }, {
    Name: 'Dunamis International Gospel Centre',
    Address: 'The Lord’s Garden',
    Email: 'office@example.com',
    Phone: '0800',
    LogoUrl: 'https://portal.example/images/church-logo.png'
  }, {
    subject: 'Official message',
    body: 'The\n\nDear Sir/Madam,\n\nThe official message.\n\nYours faithfully,\nJozcefhs\nSuper Admin'
  });

  assert.match(printable.emailHtml, /<table role="presentation"/);
  assert.match(printable.emailHtml, /padding:30px 40px 34px/);
  assert.match(printable.emailHtml, /background-position:center center/);
  assert.match(printable.emailHtml, /background-repeat:no-repeat/);
  assert.doesNotMatch(printable.emailHtml, /position:absolute/);
  assert.match(printable.emailHtml, /Yours faithfully,/);
  assert.equal((printable.emailHtml.match(/Jozcefhs/g) || []).length, 1);
  assert.doesNotMatch(printable.emailHtml, /<p>The<\/p>/);
  assert.equal((printable.fullText.match(/Jozcefhs/g) || []).length, 1);
});

test('web issue and send verify the current password server-side and never accept the desktop secret', () => {
  assert.match(endpoint, /requireStaffSession\(env, request\)/);
  assert.match(endpoint, /verifyStaffApprovalPassword\(env, user\.username, password\)/);
  assert.match(endpoint, /\['issue', 'send'\]\.includes\(action\)/);
  assert.match(endpoint, /method: 'Password'/);
  assert.doesNotMatch(endpoint, /BACKEND_SHARED_SECRET|GOOGLE_APPS_SCRIPT_SECRET|AuthorizationVerified/);
});

test('desktop bridge resolves an authoritative actor and requires its local password attestation', () => {
  assert.match(backend, /'getExecutiveOffice'/);
  assert.match(backend, /'saveOfficialCorrespondenceDraft'/);
  assert.match(backend, /'issueOfficialCorrespondence'/);
  assert.match(backend, /'sendOfficialCorrespondence'/);
  assert.match(backend, /body\.AuthorizationVerified !== true/);
  assert.match(backend, /method: 'Desktop password'/);
  assert.match(backendSecurity, /schoolSectionAccess: clean\(user\.SchoolSectionAccess/);
  assert.match(backendSecurity, /UserSchoolSectionAccess: actor\.schoolSectionAccess/);
  assert.match(backend, /publicOrigin\s*[,}]/);
  assert.match(backend, /routeAction\(env, action, body, deploymentIdentity, new URL\(request\.url\)\.origin\)/);
  assert.match(endpoint, /publicOrigin: new URL\(request\.url\)\.origin/);
});

test('desktop Executive Office bridge fails closed without its shared secret', () => {
  assert.throws(
    () => requireBackendSecret({}, { Action: 'getExecutiveOffice' }),
    (error) => error.status === 503 && /backend is not configured/i.test(error.message)
  );
  assert.throws(
    () => requireBackendSecret({}, { Action: 'ping' }),
    (error) => error.status === 503 && error.code === 'BACKEND_SECRET_NOT_CONFIGURED'
  );
  assert.throws(
    () => requireBackendSecret(
      { BACKEND_SHARED_SECRET: 'configured-secret' },
      { Action: 'getExecutiveOffice', Secret: 'wrong-secret' }
    ),
    (error) => error.status === 401
  );
  assert.doesNotThrow(() => requireBackendSecret(
    { BACKEND_SHARED_SECRET: 'configured-secret' },
    { Action: 'getExecutiveOffice', Secret: 'configured-secret' }
  ));
});

test('issued rendering is snapshot based and issue/send transitions are idempotent', () => {
  assert.match(backupSource, /listRootCollectionIds\(env\)/);
  assert.match(backupSource, /EXCLUDED_ROOT_COLLECTIONS/);
  assert.match(endpoint, /verifyStaffApprovalPassword\(env, user\.username, password\)/);
  assert.match(
    executiveSource,
    /Issued documents must never[\s\S]*const authoritative = immutable[\s\S]*\? \{\}/
  );
  assert.match(executiveSource, /Status: 'Uncertain'/);
  assert.match(executiveSource, /Automatic resend is paused to prevent a duplicate email/);
  assert.match(executiveSource, /ProviderMessageId: providerMessageId/);
});
