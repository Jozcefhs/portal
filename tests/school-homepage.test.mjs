import test from 'node:test';
import assert from 'node:assert/strict';
import { homepageContent, homepageEditor, publishedHomepagePhoto } from '../functions/lib/school-homepage.js';
import { onRequestPost } from '../functions/api/settings.js';

const jpg = 'data:image/jpeg;base64,/9j/2Q==';
const example = { PortalHeadline: 'Welcome', PortalNotice: 'Open day', about: 'Our school',
  links: [{ label: 'School calendar', url: 'https://example.org/calendar' }], photos: { cover: { image: jpg, alt: 'Campus' } } };
function fixture() {
  const docs = new Map([['publicPortalContent', { PortalNotice: 'Earlier notice', legacy: true, __updateTime: '0' }]]);
  const commits = [];
  const store = { getDocument: async (_env, _path, id) => docs.get(id),
    batchCommitDocuments: async (_env, writes) => {
      for (const write of writes) {
        if (write.updateTime) assert.equal(docs.get(write.documentId).__updateTime, write.updateTime);
        if (write.exists === false) assert.equal(docs.has(write.documentId), false);
      }
      commits.push(writes);
      for (const write of writes) {
        if (write.operation === 'delete') docs.delete(write.documentId);
        else docs.set(write.documentId, { ...(write.updateMask ? docs.get(write.documentId) : {}),
          ...write.data, __updateTime: String(commits.length) });
      }
    } };
  const edit = (action, body = {}, workspace = 'school-a') => homepageEditor({}, workspace, action, body, 'admin', store);
  return { docs, commits, store, edit };
}
test('drafts are private, publishing is atomic and a repeated publish has zero writes', async () => {
  const { edit, docs, commits, store } = fixture();
  const initial = await edit('loadHomepage');
  assert.deepEqual(initial.liveText, { PortalNotice: 'Earlier notice' });
  const saved = await edit('saveHomepageDraft', { ...initial, page: example });
  assert.equal(docs.size, 2);
  assert.equal(docs.get('publicPortalContent').PortalNotice, 'Earlier notice');
  assert.deepEqual((await edit('loadHomepage')).page, homepageContent(example));
  await edit('saveHomepageDraft', { ...saved, page: example });
  assert.equal(commits.length, 1);
  const published = await edit('publishHomepage', { ...saved, page: example });
  const live = docs.get('publicPortalContent');
  assert.equal(live.legacy, true);
  assert.equal(live.PortalNotice, 'Open day');
  assert.equal(live.HomepageDetails.photos.cover.image, undefined);
  const params = new URLSearchParams({ homepagePhoto: 'cover', v: live.HomepageDetails.photos.cover.hash });
  const image = workspaceId => publishedHomepagePhoto({}, { workspaceId, edition: 'school' }, params, store.getDocument);
  assert.equal((await image('school-a')).headers.get('Content-Type'), 'image/jpeg');
  assert.equal((await image('school-b')).status, 404);
  await assert.rejects(edit('loadHomepage', {}, 'school-b'), { status: 409 });
  await edit('publishHomepage', { ...published, page: example });
  assert.equal(commits.length, 2);
  const updated = await edit('publishHomepage', { ...published, page: { ...example, about: 'Changed' } });
  assert.ok(commits[2].every(w => !w.documentId.includes('Photo')));
  await edit('publishHomepage', { ...updated, page: { ...example, photos: {} } });
  assert.equal((await image('school-a')).status, 404);
});
test('a restored public homepage remains editable when the private draft is missing', async () => {
  const { edit, docs } = fixture();
  const start = await edit('loadHomepage');
  await edit('publishHomepage', { ...start, page: example });
  docs.delete('homepageDraft-school-a');
  const restored = await edit('loadHomepage');
  assert.deepEqual(homepageContent(restored.page), homepageContent(example));
});
test('stale edits and legacy changes to published copy are protected', async () => {
  const { edit, docs } = fixture();
  const first = await edit('loadHomepage');
  const saved = await edit('saveHomepageDraft', { ...first, page: example });
  await assert.rejects(edit('publishHomepage', { ...first, page: { ...example, about: 'stale' } }), { status: 409 });
  docs.get('publicPortalContent').PortalNotice = 'Edited elsewhere';
  await assert.rejects(edit('publishHomepage', { ...saved, page: example }), { status: 409 });
});
test('only published photo slots and permitted links can be displayed', async () => {
  for (const url of ['javascript:alert(1)', 'http://example.org', 'https://user@example.org']) {
    assert.throws(() => homepageContent({ links: [{ label: 'Link', url }] }, true), { status: 400 });
  }
  assert.throws(() => homepageContent({ photos: { cover: { image: jpg } } }, true), { status: 400 });
  assert.throws(() => homepageContent({ photos: { cover: { image: jpg, desktopX: 150 } } }), { status: 400 });
  const res = await publishedHomepagePhoto({}, { edition: 'school', workspaceId: 'a' },
    new URLSearchParams({ homepagePhoto: '../homepageDraft-a', v: 'a'.repeat(64) }), () => assert.fail('unexpected read'));
  assert.equal(res.status, 404);
});
test('private editor actions require administrator authentication', async () => {
  for (const action of ['loadHomepage', 'saveHomepageDraft', 'publishHomepage']) {
    const res = await onRequestPost({ request: new Request('https://example.org/api/settings', {
      method: 'POST', body: JSON.stringify({ action, page: example }), headers: { 'Content-Type': 'application/json' }
    }), env: { DYNAMAX_WORKSPACE_ID: 'school-a', ORGANISATION_EDITION: 'school', ADMIN_WEB_PASSWORD: 'private' } });
    assert.ok([401, 403].includes(res.status), String(res.status));
  }
});
test('a branch editing session and a non-school edition cannot open the editor', async () => {
  for (const [edition, scope] of [['school', 'branch'], ['faith', 'organisation']]) {
    const res = await onRequestPost({ request: new Request('https://example.org/api/settings', {
      method: 'POST', body: JSON.stringify({ action: 'loadHomepage', SettingsScope: scope, password: 'test-only' })
    }), env: { DYNAMAX_WORKSPACE_ID: 'demo', ORGANISATION_EDITION: edition, ADMIN_WEB_PASSWORD: 'test-only' } });
    assert.equal(res.status, 403);
  }
});
