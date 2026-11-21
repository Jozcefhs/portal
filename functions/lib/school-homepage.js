import { batchCommitDocuments, getDocument } from './firestore.js';
import { PUBLIC_PORTAL_CONTENT_DOCUMENT, publicPortalContent } from './public-portal-content.js';

const slots = ['cover', 'gallery1', 'gallery2', 'gallery3'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function shortText(value, max) {
  const result = String(value ?? '').trim();
  if (result.length > max) fail(`Text exceeds the ${max}-character limit.`);
  return result;
}

function position(value) {
  const n = Number(value ?? 50);
  if (!Number.isInteger(n) || n < 0 || n > 100) fail('Choose a crop position between 0 and 100.');
  return n;
}

function photo(value) {
  if (!value?.image) return null;
  const image = String(value.image);
  if (image.length > 170000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(image))
    fail('Choose a smaller photo and upload it again.');
  let decoded;
  try { decoded = atob(image.slice('data:image/jpeg;base64,'.length)); } catch { fail('Upload a valid JPEG photo.'); }
  if (!decoded.endsWith('\xff\xd9')) fail('Upload a complete JPEG photo.');
  const alt = shortText(value.alt, 200);
  return { image, alt, desktopX: position(value.desktopX), desktopY: position(value.desktopY),
    mobileX: position(value.mobileX), mobileY: position(value.mobileY) };
}

export function homepageContent(input = {}, publish = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Supply a homepage draft.');
  const links = input.links ?? [];
  if (!Array.isArray(links) || links.length > 6) fail('Choose up to six related links.');
  const photos = {};
  for (const slot of slots) {
    const item = photo(input.photos?.[slot]);
    if (item) {
      if (publish && !item.alt) fail('Add a description for each photo before publishing.');
      photos[slot] = item;
    }
  }
  return {
    PortalHeadline: shortText(input.PortalHeadline, 180), PortalSubheading: shortText(input.PortalSubheading, 600),
    PortalNotice: shortText(input.PortalNotice, 500), about: shortText(input.about, 2400),
    links: links.map(link => {
      const label = shortText(link?.label, 64);
      const url = shortText(link?.url, 1500);
      if (url || publish) {
        let parsed;
        try { parsed = new URL(url); } catch { fail('Enter a full HTTPS address for each link.'); }
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('Use an HTTPS address without login details.');
      }
      if (publish && !label) fail('Give each related link a label.');
      return { label, url };
    }), photos
  };
}

async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export function photoDocumentId(workspace, slot) {
  if (!slots.includes(slot)) fail('Photo not found.', 404);
  return `homepagePhoto-${workspace}-${slot}`;
}

export async function publishedHomepagePhoto(env, deployment, params, read = getDocument) {
  const slot = params.get('homepagePhoto');
  const hash = params.get('v') || '';
  const missing = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  if (deployment.edition !== 'school' || !slots.includes(slot) || !/^[a-f0-9]{64}$/.test(hash)) return missing();
  const stored = await read(env, 'settings', photoDocumentId(deployment.workspaceId, slot));
  if (!stored?.image || stored.hash !== hash) return missing();
  const bytes = Uint8Array.from(atob(stored.image.slice('data:image/jpeg;base64,'.length)), c => c.charCodeAt(0));
  return new Response(bytes, { headers: {
    'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff'
  } });
}

export async function homepageEditor(env, workspace, action, body, actor, store = { getDocument, batchCommitDocuments }) {
  const draftId = 'homepageDraft-' + workspace;
  const [draft, live] = await Promise.all([draftId, PUBLIC_PORTAL_CONTENT_DOCUMENT].map(id => store.getDocument(env, 'settings', id)));
  if (live?.HomepageWorkspace && live.HomepageWorkspace !== workspace) fail('The homepage belongs to a different school workspace.', 409);
  const liveDetails = live?.HomepageWorkspace === workspace ? live.HomepageDetails : null;
  const liveRevision = await digest(JSON.stringify([publicPortalContent(live), liveDetails?.revision || '']));
  const revision = draft?.revision || '';
  if (action === 'loadHomepage') {
    let page = draft?.page ? JSON.parse(draft.page) : null;
    if (!page && liveDetails) {
      const photos = {};
      await Promise.all(slots.filter(slot => liveDetails.photos?.[slot]).map(async slot => {
        const metadata = liveDetails.photos[slot];
        const asset = await store.getDocument(env, 'settings', photoDocumentId(workspace, slot));
        if (!asset?.image || asset.hash !== metadata.hash) fail('A published photo is unavailable. Restore it before editing the homepage.', 409);
        photos[slot] = { ...metadata, image: asset.image };
      }));
      page = { ...publicPortalContent(live), about: liveDetails.about, links: liveDetails.links, photos };
    }
    if (page && revision === liveDetails?.revision) Object.assign(page, publicPortalContent(live));
    return { revision, liveRevision, page, liveText: Object.fromEntries(Object.entries(publicPortalContent(live))
      .filter(([key]) => Object.hasOwn(live || {}, key))) };
  }
  const publishing = action === 'publishHomepage';
  if (!publishing && action !== 'saveHomepageDraft') fail('Unknown homepage action.');
  if (!body.page) fail('Supply a homepage draft.');
  const page = homepageContent(body.page, publishing);
  const serialized = JSON.stringify(page);
  const next = await digest(serialized);
  const changed = next !== revision;
  if (changed && body.revision !== revision) fail('Another administrator saved this draft. Reopen the editor to load it.', 409);
  const copy = publicPortalContent(page);
  const alreadyLive = liveDetails?.revision === next && JSON.stringify(copy) === JSON.stringify(publicPortalContent(live));
  if (publishing && !alreadyLive && body.liveRevision !== liveRevision) fail('The published page changed. Reopen the editor before publishing.', 409);
  const writes = [];
  const write = (documentId, data, extra = {}) => writes.push({
    collectionPath: 'settings', documentId, data, restoreJsonTypes: true, ...extra
  });
  if (changed || (publishing && !alreadyLive)) {
    write(draftId, { page: serialized, revision: next, UpdatedBy: actor },
      draft ? { updateTime: draft.__updateTime } : { exists: false });
  }
  let publishedRevision = liveRevision;
  if (publishing && !alreadyLive) {
    const photos = {};
    for (const slot of slots) {
      const previous = liveDetails?.photos?.[slot];
      if (page.photos[slot]) {
        const { image, ...details } = page.photos[slot];
        const hash = await digest(image);
        photos[slot] = { ...details, hash };
        if (previous?.hash !== hash) write(photoDocumentId(workspace, slot), { image, hash });
      } else if (previous) write(photoDocumentId(workspace, slot), {}, { operation: 'delete' });
    }
    const data = { ...copy, HomepageWorkspace: workspace, HomepageDetails: { revision: next, about: page.about, links: page.links, photos },
      UpdatedBy: actor, UpdatedAt: new Date().toISOString() };
    write(PUBLIC_PORTAL_CONTENT_DOCUMENT, data, { updateMask: Object.keys(data), ...(live ? { updateTime: live.__updateTime } : { exists: false }) });
    publishedRevision = await digest(JSON.stringify([copy, next]));
  }
  if (writes.length) await store.batchCommitDocuments(env, writes);
  return { revision: next, liveRevision: publishedRevision };
}
