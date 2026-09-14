import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [setupHtml, setupJs, settingsApi, backendApi] = await Promise.all([
  readFile(new URL('../setup.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/setup.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/settings.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8')
]);

test('tenant settings display authoritative subscription values as read-only', () => {
  assert.match(setupHtml, /id="subscriptionPlan"[^>]*readonly/);
  assert.match(setupHtml, /id="userLimit"[^>]*readonly/);
  assert.match(setupHtml, /managed by the organisation's online subscription/);
  assert.doesNotMatch(setupHtml, /productKeyMode|Product key requirement/);
});

test('web settings do not submit or persist manual licensing overrides', () => {
  assert.doesNotMatch(setupJs, /data\.get\('SubscriptionPlan'\)|data\.get\('UserLimit'\)|ProductKeyMode/);
  assert.match(settingsApi, /Plan: existing\.SubscriptionPlan/);
  assert.match(settingsApi, /UserLimit: existing\.UserLimit/);
  assert.match(settingsApi, /UserLimit: organization\.UserLimit/);
  assert.doesNotMatch(settingsApi, /incoming\.SubscriptionPlan|incoming\.UserLimit|incoming\.ProductKeyMode/);
});

test('legacy desktop settings saves preserve the authoritative subscription policy', () => {
  assert.match(backendApi, /const authoritativeSubscription = resolveOrganizationConfig/);
  assert.match(backendApi, /SubscriptionPlan: authoritativeSubscription\.Plan/);
  assert.match(backendApi, /UserLimit: authoritativeSubscription\.UserLimit/);
  assert.doesNotMatch(backendApi, /body\.SubscriptionPlan \|\| body\.subscriptionPlan/);
  assert.doesNotMatch(backendApi, /body\.UserLimit \|\| body\.userLimit/);
});
