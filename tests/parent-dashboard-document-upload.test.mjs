import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [html, script, css] = await Promise.all([
  readFile(new URL('parent-dashboard.html', portalRoot), 'utf8'),
  readFile(new URL('js/parent-dashboard.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8')
]);

test('parent dashboard exposes admission document upload for the selected child', () => {
  assert.match(html, /data-dashboard-target="documents"/);
  assert.match(html, /id="parentDocumentUploadForm"/);
  assert.match(html, /id="parentDocumentTarget"/);
  assert.equal((html.match(/data-parent-document-type=/g) || []).length, 6);
  assert.match(script, /function parentDocumentApplicationReference\(child\)/);
  assert.match(script, /function passportPhotoCacheKey\(child, reference\)/);
  assert.match(script, /scopePath: child\.PassportPhotoScopePath \|\| child\.__scopePath \|\| ''/);
  assert.match(script, /child\.PassportPhotoScopePath = data\.targetScopePath/);
  assert.match(script, /Uploading for: \$\{child\.DisplayName/);
});

test('parent upload reuses authenticated credentials and securely targets the selected application', () => {
  assert.match(script, /fetch\('\/api\/upload-document'/);
  assert.match(script, /body: JSON\.stringify\(\{[\s\S]*?\.\.\.authPayload\(\),[\s\S]*?applicationReference,[\s\S]*?accountRef: child\.AccountRef/);
  assert.match(script, /sourceType: child\.SourceType \|\| 'Student'/);
  assert.match(script, /'Idempotency-Key': idempotencyKey/);
  assert.match(script, /getTurnstileToken\('upload_document'\)/);
  assert.doesNotMatch(html, /id="parentDocumentUploadForm"[\s\S]*?type="password"/);
});

test('switching children clears pending files and upload feedback', () => {
  assert.match(script, /function resetParentDocumentSelection\(\)[\s\S]*?parentDocumentUploadForm\?\.reset\(\)/);
  assert.match(script, /button\.addEventListener\('click',[\s\S]*?resetParentDocumentSelection\(\);[\s\S]*?selectedChildKey = identity/);
});

test('parent uploads enforce file limits, visible progress, and repeated-click protection', () => {
  assert.match(script, /PARENT_DOCUMENT_MAX_FILE_SIZE = 8 \* 1024 \* 1024/);
  assert.match(script, /setActionLoading\(parentUploadDocumentsBtn, true, 'Uploading documents\.\.\.'/);
  assert.match(script, /setParentDocumentProgress\(index \+ 1, uploads\.length\)/);
  assert.match(script, /parentDocumentIdempotencyKeys/);
  assert.match(css, /\.parent-document-target\{/);
  assert.match(css, /html\[data-theme="dark"\] \.parent-document-target\{/);
});

test('parent upload rows follow the school admission-document settings', () => {
  assert.match(script, /loadParentDocumentSettings/);
  assert.match(script, /\/api\/admission-document-settings/);
  assert.match(script, /\[data-parent-document-row\]/);
  assert.match(script, /row\.hidden = !active/);
});

test('parent dashboard has an authenticated notification center', () => {
  assert.match(html, /id="parentNotificationsBtn"/);
  assert.match(html, /id="parentNotificationBadge"/);
  assert.match(html, /id="parentNotificationPanel"[^>]*hidden/);
  assert.match(script, /action: 'getNotifications',[\s\S]*?\.\.\.authPayload\(\)/);
  assert.match(script, /action: 'markNotificationRead',[\s\S]*?\.\.\.authPayload\(\)/);
  assert.match(script, /accountRefs: \(dashboard\.children \|\| \[\]\)\.map/);
  assert.match(script, /parentNotificationBadge\.hidden = unreadCount === 0/);
  assert.match(css, /\.parent-notification-item\.unread\{/);
});
