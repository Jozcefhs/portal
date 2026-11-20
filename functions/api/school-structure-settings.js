import { getDocument, batchCommitLiteralDocuments } from '../lib/firestore.js';
import { canonicalSchoolBranchId, invalidateSchoolStructureCache, normalizeSchoolStructure } from '../lib/school-scope.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';

const documents = ['BirthCertificate', 'PreviousSchoolReport', 'PassportPhotograph', 'MedicalReport', 'TransferCertificateDoc', 'AcceptanceForm'];
const sections = ['primary', 'secondary'];
const reject = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export function checkSchoolOwner(user, writing) {
  if (user.role !== 'Super Admin' || user.edition !== 'school' || user.branchAccess === 'selected'
    || user.assignedBranchId || user.assignedBranchIds?.length || user.canSwitchBranches === false) {
    reject('Sign in with a school-wide Super Admin account to manage these settings.', 403);
  }
  if (!user.subscriptionActive || (writing && user.subscriptionReadOnly)) reject('The subscription does not currently allow this action.', 403);
}

function snapshot(structure, requirements) {
  const current = normalizeSchoolStructure(structure);
  return {
    branches: current.Branches, activeBranch: current.ActiveBranchId, sections: current.Sections,
    documents: Object.fromEntries(documents.map(key => [key, requirements?.Enabled?.[key] !== false])),
    structureVersion: structure?.__updateTime || '', documentsVersion: requirements?.__updateTime || ''
  };
}

export function schoolSettingsWrites(input, structure, requirements, username) {
  const current = snapshot(structure, requirements);
  if (input.structureVersion !== current.structureVersion || input.documentsVersion !== current.documentsVersion) {
    reject('Settings changed since this form was opened. Reopen it to load the latest values.', 409);
  }
  if (!Array.isArray(input.branches) || !input.branches.length) reject('Enter at least one branch.');
  const existing = new Map(current.branches.map(branch => [branch.Id, branch]));
  const seen = new Set();
  const branches = input.branches.map(row => {
    const name = String(row?.Name || '').trim();
    const id = row?.Id || canonicalSchoolBranchId(name, '');
    if (!name || name.length > 160 || !id || id !== canonicalSchoolBranchId(id, '') || seen.has(id)) reject('Each branch needs a name and a unique branch ID.');
    seen.add(id);
    return { ...existing.get(id), Id: id, Name: name };
  });
  if (current.branches.some(branch => !seen.has(branch.Id))) reject('Keep every existing branch so its records stay accessible.');
  const activeBranch = Number.isInteger(input.activeIndex) && branches[input.activeIndex]?.Id;
  if (!activeBranch) reject('Select a listed branch as the active branch.');
  if (!Array.isArray(input.sections) || !input.sections.length || input.sections.some(value => !sections.includes(value))) reject('Select at least one school section.');
  if (documents.some(key => typeof input.documents?.[key] !== 'boolean')) reject('Supply each document requirement.');
  const selectedSections = sections.filter(key => input.sections.includes(key));
  const enabled = Object.fromEntries(documents.map(key => [key, input.documents[key]]));
  const writes = [];
  function add(id, stored, fields) {
    const data = { ...fields, UpdatedAt: new Date().toISOString(), UpdatedBy: username };
    writes.push({ collectionPath: 'settings', documentId: id, data, updateMask: Object.keys(data),
      ...(stored ? { updateTime: stored.__updateTime } : { exists: false }) });
  }
  if (branches.some((b, i) => b.Id !== current.branches[i]?.Id || b.Name !== current.branches[i]?.Name)
    || activeBranch !== current.activeBranch || sections.some(key => current.sections.includes(key) !== selectedSections.includes(key))) {
    const raw = new Map((structure?.Branches || []).filter(row => typeof row === 'object' && row).map(row => [canonicalSchoolBranchId(row.Id || row.Name), row]));
    add('schoolStructure', structure, { Branches: branches.map(b => ({ ...raw.get(b.Id), ...b })), Sections: selectedSections, ActiveBranchId: activeBranch });
  }
  if (documents.some(key => enabled[key] !== current.documents[key])) {
    add('admissionDocuments', requirements, { Enabled: { ...requirements?.Enabled, ...enabled } });
  }
  return writes;
}

async function handle({ env, request }, writing) {
  try {
    const user = await requireStaffSession(env, request);
    checkSchoolOwner(user, writing);
    if (writing && (request.headers.get('Origin') !== new URL(request.url).origin || !request.headers.get('Content-Type')?.includes('application/json'))) reject('Open the settings on this school’s portal.', 403);
    const input = writing ? await readJsonBody(request, { maxBytes: 64 * 1024 }) : null;
    const [structure, requirements] = await Promise.all(['schoolStructure', 'admissionDocuments'].map(id => getDocument(env, 'settings', id)));
    if (!writing) return json({ ok: true, settings: snapshot(structure, requirements) });
    const writes = schoolSettingsWrites(input, structure, requirements, user.username);
    if (writes.length) {
      await batchCommitLiteralDocuments(env, writes);
      if (writes.some(write => write.documentId === 'schoolStructure')) invalidateSchoolStructureCache();
    }
    return json({ ok: true, changed: writes.length > 0 });
  } catch (error) {
    return json({ ok: false, message: error.message }, error.status || 500);
  }
}
export const onRequestGet = context => handle(context, false);
export const onRequestPost = context => handle(context, true);
