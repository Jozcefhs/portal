import { identityPrefix, branchResetFilePrefixes, containsReference } from './document-storage.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { resetBranchId } from './branch-reset.js';
import { collectionKind, owns } from './branch-restore.js';
import { getDocument, getDocuments } from './firestore.js';
import { normalizeSchoolStructure } from './school-scope.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const maxPage = 100;
const db = { getDocument, getDocuments };

function describe(object) {
  const metadata = object.customMetadata || {};
  return { key: object.key, version: object.version, etag: object.etag, size: object.size,
    name: metadata.fileName || object.key.split('/').at(-1),
    type: object.httpMetadata?.contentType || metadata.mimeType || 'application/octet-stream',
    ...(metadata.uploadedAt ? {uploadedAt:metadata.uploadedAt} : {}),
    ...(metadata.operationId ? {operationId:metadata.operationId} : {}) };
}

export async function backupDocuments(env, user, action, body, database = db) {
  const identity = requiredDeploymentIdentity(env);
  if (body.workspaceId !== identity.workspaceId || body.edition !== identity.edition) throw fail('The backup workspace changed.');
  const bucket = env.DYNAMAX_DOCUMENTS;
  if (!bucket?.list || !bucket?.head || !bucket?.get) throw fail('Private document storage is unavailable. Reconnect it or choose a database-only backup.', 503);
  if (!['branch','organisation'].includes(body.scope)) throw fail('Select a backup scope.');
  const branch = body.scope === 'branch' ? resetBranchId(body.branchId) : '';
  if (!branch && body.branchId) throw fail('The branch and backup scope disagree.');
  const root = identityPrefix(identity);
  const papers = 'private-portal-cbt/' + identity.workspaceId + '/';
  const legacyPapers = identity.edition === 'school';
  let prefixes;
  if (branch) {
    const working = user.branchId || user.BranchId;
    if (working && working !== 'all' && working !== branch) throw fail('Switch to the selected working branch first.');
    const structure = normalizeSchoolStructure(await database.getDocument(env, 'settings', 'schoolStructure') || {});
    if (!structure.Branches.some(row => row.Id === branch)) throw fail('Choose a configured branch.');
    prefixes = branchResetFilePrefixes(identity, branch);
    if (structure.Branches.some(row => row.Id !== branch && row.Id.replace(/^[._-]+|[._-]+$/g,'') === branch)) {
      throw fail('Two branches share this storage prefix. Use a whole-organisation backup for their documents.');
    }
  } else {
    prefixes = [root, ...(legacyPapers ? [papers] : [])];
  }
  function allowed(object) {
    const key = object.key;
    if (legacyPapers && key.startsWith(papers)) return !branch || !!body.owner;
    const parts = key.startsWith(root) ? key.slice(root.length).split('/') : [];
    const meta = object.customMetadata;
    if (parts.length !== 6 || !parts.every(Boolean)) return false;
    if (meta?.workspaceId && meta.workspaceId !== identity.workspaceId || meta?.edition && meta.edition !== identity.edition ||
        meta?.branchId && meta.branchId !== parts[1]) return false;
    // Some older workspace files predate custom metadata. A canonical workspace
    // prefix can identify those for the whole organisation, never for one branch.
    if (!branch && root === 'v1/'+identity.edition+'/'+identity.workspaceId+'/') return true;
    return meta?.workspaceId === identity.workspaceId && meta.edition === identity.edition && meta.branchId === parts[1] &&
      (!branch || parts[1] === branch);
  }
  if (action === 'list-backup-documents') {
    // Legacy main is also the fallback for unassigned uploads. Only export its linked files.
    const browse = branch === 'main' ? [] : prefixes;
    const index = body.index ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= Math.max(browse.length,1)) throw fail('Invalid document page.');
    if (!browse.length) return { ok:true, files:[], skipped:0, next:null };
    const page = await bucket.list({prefix:browse[index], limit:maxPage, cursor:body.cursor || undefined, include:['customMetadata','httpMetadata']});
    if (page.truncated && (!page.cursor || page.cursor === body.cursor)) throw fail('The document listing did not advance.');
    const files = page.objects.filter(allowed).map(describe);
    return { ok:true, files, skipped:page.objects.length-files.length,
      next:page.truncated ? {index,cursor:page.cursor} : index+1 < browse.length ? {index:index+1} : null };
  }
  const key = body.key;
  if (typeof key !== 'string' || key.length > 1024 || key.split('/').some(p => !p || p === '.' || p === '..') ||
    !(key.startsWith(root) || legacyPapers && key.startsWith(papers))) throw fail('Document outside the selected workspace.');
  if (branch && key.startsWith(root) && key.slice(root.length).split('/')[1] !== branch) throw fail('Document outside the selected branch.');
  if (branch && (branch === 'main' || key.startsWith(papers))) {
    const owner = body.owner;
    if (!owner || !collectionKind(owner.path, identity, branch)) throw fail('The document requires a verified branch record.');
    const [row] = await database.getDocuments(env, owner.path, [owner.id]);
    if (!row || !owns(owner.path, row, identity, branch) || !containsReference(row,key)) throw fail('The document is no longer linked to this branch.');
  }
  if (action === 'inspect-backup-document') {
    const object = await bucket.head(key);
    if (!object) return {ok:true,missing:true};
    if (!allowed(object)) return {ok:true,excluded:true};
    return {ok:true,file:describe(object)};
  }
  if (action !== 'read-backup-document' || !body.version || !body.etag) throw fail('A document version is required.');
  const object = await bucket.get(key,{onlyIf:{etagMatches:body.etag}});
  if (!object?.body || !allowed(object) || object.version !== body.version || object.etag !== body.etag) throw fail('A document changed or is unavailable. Start the backup again.');
  return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(object.size),
    'X-Content-Type-Options':'nosniff','Content-Disposition':'attachment','Cache-Control':'private, no-store'}});
}
