import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reusable = await readFile(
  new URL('../.github/workflows/deploy-firestore-indexes.yml', import.meta.url),
  'utf8'
);
const school = await readFile(new URL('../.github/workflows/deploy-school.yml', import.meta.url), 'utf8');
const church = await readFile(new URL('../.github/workflows/deploy-digc-suite.yml', import.meta.url), 'utf8');

test('the reusable workflow deploys only checked-in Firestore indexes with short-lived credentials', () => {
  assert.match(reusable, /workflow_call:/);
  assert.match(reusable, /google-github-actions\/auth@v3/);
  assert.match(reusable, /id-token: write/);
  assert.match(reusable, /firebase-tools@15\.24\.0 deploy/);
  assert.match(reusable, /--only firestore:indexes/);
  assert.match(reusable, /--non-interactive/);
  assert.match(reusable, /firestore\.indexes\.json/);
  assert.doesNotMatch(reusable, /FIREBASE_TOKEN|credentials_json|private[_ -]?key/i);
});

test('school deployment is blocked until its Firestore indexes deploy', () => {
  assert.match(school, /firestore-indexes:/);
  assert.match(school, /SCHOOL_FIREBASE_PROJECT_ID/);
  assert.match(school, /SCHOOL_GCP_WIF_PROVIDER/);
  assert.match(school, /SCHOOL_GCP_INDEX_SERVICE_ACCOUNT/);
  assert.match(school, /needs: firestore-indexes/);
  assert.ok(school.indexOf('needs: firestore-indexes') < school.indexOf('cloudflare/wrangler-action@v3'));
});

test('church deployment is blocked until its Firestore indexes deploy', () => {
  assert.match(church, /firestore-indexes:/);
  assert.match(church, /CHURCH_FIREBASE_PROJECT_ID/);
  assert.match(church, /CHURCH_GCP_WIF_PROVIDER/);
  assert.match(church, /CHURCH_GCP_INDEX_SERVICE_ACCOUNT/);
  assert.match(church, /needs: firestore-indexes/);
  assert.ok(church.indexOf('needs: firestore-indexes') < church.indexOf('cloudflare/wrangler-action@v3'));
});
