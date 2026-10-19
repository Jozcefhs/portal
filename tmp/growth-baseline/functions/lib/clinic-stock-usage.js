import { batchCommitLiteralDocuments, getDocument } from './firestore.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const quantity = value => Math.round(Number(value) * 1000) / 1000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: 'CLINIC_STOCK_INVALID' });
const plain = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
const scopeOf = row => `${lower(row.BranchId || 'main')}|${lower(row.SchoolSection || 'Secondary')}`;
const sameStudent = (a, b) => lower(a).replace(/[^a-z0-9]/g, '') === lower(b).replace(/[^a-z0-9]/g, '');
const yes = value => value === true || ['yes', 'true', '1', 'on'].includes(lower(value));

export function isActiveClinicVisit(record = {}) {
  return !['cancelled', 'canceled', 'void', 'voided'].includes(lower(record.Status));
}

export function normalizeClinicDispensedItems(value) {
  if (!Array.isArray(value) || value.length > 30) throw fail('Select no more than 30 dispensed inventory items.');
  const ids = new Set();
  return value.map(line => {
    const id = clean(line?.InventoryId);
    const rawAmount = line?.Quantity;
    const amount = Number(rawAmount);
    if (!id || id.length > 140 || /[\/\\?#\[\]\u0000-\u001f]/.test(id) || ['.', '..'].includes(id) || ids.has(id)) throw fail('Choose each exact clinic inventory item once.');
    if (!['number', 'string'].includes(typeof rawAmount)
      || (typeof rawAmount === 'string' && !/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(rawAmount.trim()))
      || !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || Math.abs(quantity(amount) - amount) > 0.0000001) {
      throw fail('Dispensed quantities must be positive numbers with no more than three decimal places.');
    }
    ids.add(id);
    return { InventoryId: id, Quantity: quantity(amount) };
  }).sort((a, b) => a.InventoryId.localeCompare(b.InventoryId));
}

async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function conditional(collectionPath, documentId, data, previous) {
  if (previous && !clean(previous.__updateTime)) throw fail('A record version is unavailable. Refresh before saving.', 409);
  return { collectionPath, documentId, data: plain(data), ...(previous ? { updateTime: previous.__updateTime } : { exists: false }) };
}

// Both web and desktop callers first resolve an authorised, enrolled student.
// Only explicit structured dispensing lines affect stock; old free text never does.
export async function commitClinicVisit(env, { documentId, payload, body = {}, user = {} }) {
  if (!clean(user.username) || user.subscriptionReadOnly || ['Vendor User', 'External Auditor'].includes(clean(user.role))) {
    throw fail('This account cannot record clinic stock usage.', 403);
  }
  if (clean(payload.OrganisationEdition) !== 'school' || !clean(payload.AdmissionNo)
    || !/^[A-Za-z0-9_.-]{1,140}$/.test(documentId) || ['.', '..'].includes(documentId)) throw fail('Choose a valid school clinic visit.');
  const suppliedItems = Object.hasOwn(body, 'DispensedItems') ? normalizeClinicDispensedItems(body.DispensedItems) : null;
  const requestId = clean(body.RequestId);
  if (requestId && !/^[A-Za-z0-9_.:-]{1,160}$/.test(requestId)) throw fail('The clinic request reference is invalid.');
  const operationId = await digest([lower(user.username), documentId, requestId || `revision:${body.ExpectedRevision ?? 'new'}`]);
  const fingerprint = await digest({ documentId, scope: scopeOf(payload), student: payload.AdmissionNo,
    Date: clean(body.Date), Complaint: payload.Complaint, Treatment: payload.Treatment,
    Disposition: payload.Disposition, Notes: payload.Notes, ReviewedBy: payload.ReviewedBy || '',
    DispensedItems: suppliedItems, ExpectedRevision: body.ExpectedRevision ?? null,
    Status: clean(body.Status), ChangeReason: clean(body.ChangeReason), RestoreDispensedStock: yes(body.RestoreDispensedStock) });
  const [existing, receipt] = await Promise.all([
    getDocument(env, 'clinicRecords', documentId), getDocument(env, 'clinicRecordOperations', operationId)
  ]);
  const replay = row => {
    if (row.Fingerprint !== fingerprint) throw fail('This request reference was already used with different visit details. Refresh before making a correction.', 409);
    return { ok: true, replayed: true, record: row.Record, message: 'Clinic visit already saved.' };
  };
  if (receipt) return replay(receipt);
  try {
  if (existing && (scopeOf(existing) !== scopeOf(payload) || !sameStudent(existing.AdmissionNo, payload.AdmissionNo)
    || (clean(existing.OrganisationEdition) && lower(existing.OrganisationEdition) !== 'school'))) {
    throw fail('A clinic record cannot be reassigned to another student or workspace.', 403);
  }
  const revision = Number(existing?.Revision || 0);
  if (existing && (body.ExpectedRevision === undefined || Number(body.ExpectedRevision) !== revision)) {
    throw fail('This visit changed or requires a reviewed correction. Reload it before saving.', 409);
  }
  if (existing && !clean(body.ChangeReason)) throw fail('Enter a reason for correcting or cancelling this visit.');
  const oldLines = normalizeClinicDispensedItems(existing?.DispensedItems || []);
  const status = clean(body.Status || existing?.Status || 'Active');
  if (!['Active', 'Cancelled'].includes(status)) throw fail('Choose Active or Cancelled for the clinic visit.');
  const restore = yes(body.RestoreDispensedStock);
  if (restore && (!existing || status !== 'Cancelled')) throw fail('Stock can be returned only when cancelling an existing visit.');
  let newLines = suppliedItems || oldLines;
  if (status === 'Cancelled') {
    if (!existing) throw fail('Save a visit before cancelling it.');
    if (!restore && suppliedItems && JSON.stringify(suppliedItems) !== JSON.stringify(oldLines)) {
      throw fail('Cancelling a clinical record does not return stock. Confirm unused items were returned, or keep the existing quantities.');
    }
    newLines = restore ? [] : oldLines;
  }
  const oldById = new Map(oldLines.map(line => [line.InventoryId, line.Quantity]));
  const nextById = new Map(newLines.map(line => [line.InventoryId, line.Quantity]));
  const ids = [...new Set([...oldById.keys(), ...nextById.keys()])];
  const stockRows = await Promise.all(ids.map(id => getDocument(env, 'clinicInventory', id)));
  const timestamp = new Date().toISOString();
  const writes = [];
  const enriched = [];
  const deltas = [];
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index], item = stockRows[index];
    if (!item || scopeOf(item) !== scopeOf(payload) || (clean(item.OrganisationEdition) && lower(item.OrganisationEdition) !== 'school')) {
      throw fail('A dispensed item is missing or belongs to another branch or school section.', 403);
    }
    if (clean(item.VendorId) || lower(item.OwnershipType || item.OwnerType) === 'vendor') throw fail('Vendor-owned stock cannot be dispensed through clinic visits.', 403);
    const delta = quantity((nextById.get(id) || 0) - (oldById.get(id) || 0));
    const current = Number(item.Quantity);
    if (!Number.isFinite(current) || current < 0 || Math.abs(quantity(current) - current) > 0.0000001) {
      throw fail('The clinic stock balance needs review before dispensing; quantities support up to three decimal places.', 409);
    }
    if (delta > 0 && ['no', 'inactive', 'false', '0'].includes(lower(item.Active))) throw fail('An inactive clinic item cannot be dispensed.');
    if (delta > current) throw fail(`Only ${current} ${clean(item.Unit) || 'units'} of ${clean(item.ItemName) || id} are available. Nothing was saved.`, 409);
    if (nextById.has(id)) enriched.push({ InventoryId: id, ItemName: clean(item.ItemName), Unit: clean(item.Unit), Quantity: nextById.get(id) });
    if (!delta) continue;
    const after = quantity(current - delta);
    const movementId = `CLN-${operationId.slice(0, 40)}-${index}`;
    const movement = { OrganisationEdition: 'school', BranchId: payload.BranchId, SchoolSection: payload.SchoolSection,
      InventoryId: id, ItemName: clean(item.ItemName), Unit: clean(item.Unit), RecordId: payload.RecordId,
      MovementNo: movementId, Date: timestamp, MovementType: delta > 0 ? 'OUT' : 'IN',
      Quantity: Math.abs(delta), BalanceBefore: current, BalanceAfter: after, Source: 'Clinic visit',
      Reason: clean(body.ChangeReason) || 'Dispensed during clinic visit', RecordedBy: user.displayName || user.username };
    writes.push(conditional('clinicInventory', id, { ...item, Quantity: after, LastUpdated: timestamp,
      UpdatedBy: user.displayName || user.username }, item));
    writes.push(conditional('clinicMovements', movementId, movement));
    deltas.push({ InventoryId: id, Change: -delta, BalanceBefore: current, BalanceAfter: after });
  }
  const record = { ...plain(existing), ...plain(payload), Status: status, DispensedItems: enriched,
    Revision: revision + 1, CreatedAt: existing?.CreatedAt || timestamp, UpdatedAt: timestamp,
    UpdatedBy: user.username, ChangeReason: clean(body.ChangeReason),
    StockReturnedOnCancellation: status === 'Cancelled' && (restore || existing?.StockReturnedOnCancellation === true) };
  writes.push(conditional('clinicRecords', documentId, record, existing));
  writes.push(conditional('clinicRecordOperations', operationId, { Fingerprint: fingerprint, RecordId: payload.RecordId,
    BranchId: payload.BranchId, SchoolSection: payload.SchoolSection, OrganisationEdition: 'school',
    Date: timestamp, Actor: user.username, Reason: record.ChangeReason, StockChanges: deltas,
    PreviousRecord: plain(existing), Record: record }));
  await batchCommitLiteralDocuments(env, writes);
  return { ok: true, record, message: status === 'Cancelled' ? 'Clinic visit cancelled.' : 'Clinic visit and stock usage saved.' };
  }
  catch (error) {
    // Re-read after validation races as well as a response lost after a successful commit.
    const saved = await getDocument(env, 'clinicRecordOperations', operationId).catch(() => null);
    if (saved) return replay(saved);
    if ([409, 412].includes(Number(error.status)) && error.code !== 'CLINIC_STOCK_INVALID') {
      throw fail('Stock or the visit changed while saving. Refresh and try again; no partial update was made.', 409);
    }
    throw error;
  }
}
