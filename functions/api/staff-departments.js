import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { schoolSectionFor } from '../lib/school-scope.js';

function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function number(value) {
  const parsed = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function safeId(value) { return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140); }
function nowIso() { return new Date().toISOString(); }

const CONFIG = {
  clinic: { label: 'Clinic', inventory: 'clinicInventory', movements: 'clinicMovements', prefix: 'MED', category: 'Medical Supply', unit: 'pcs' },
  kitchen: { label: 'Kitchen', inventory: 'kitchenInventory', movements: 'kitchenMovements', prefix: 'KIT', category: 'Foodstuff', unit: 'kg' },
  tuckShop: { label: 'Tuck Shop', inventory: 'tuckShopInventory', movements: 'tuckShopMovements', prefix: 'TUK', category: 'General Item', unit: 'pcs' }
};

function scopeFields(user) {
  return {
    BranchId: clean(user.branchId) || 'main',
    SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary')
  };
}

function visible(rows, user) {
  const section = lower(user.schoolSectionAccess || 'All');
  const branch = lower(user.branchId || '');
  return (rows || []).filter((row) => {
    const branchAllowed = !branch || lower(row.BranchId || 'main') === branch;
    return branchAllowed && (section === 'all' || schoolSectionFor(row) === section);
  });
}

function publicRows(rows) {
  return (rows || []).map(({ PasswordHash, WalletPinHash, ...row }) => row);
}

async function loadDepartment(env, section, user) {
  const config = CONFIG[section];
  const [inventory, movements, records] = await Promise.all([
    listCollection(env, config.inventory),
    listCollection(env, config.movements),
    section === 'clinic' ? listCollection(env, 'clinicRecords') : Promise.resolve([])
  ]);
  const scopedInventory = visible(inventory, user);
  return {
    ok: true,
    inventory: publicRows(scopedInventory),
    movements: publicRows(visible(movements, user).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date))).slice(0, 100)),
    records: publicRows(visible(records, user).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date))).slice(0, 100)),
    lowStock: publicRows(scopedInventory.filter((row) => number(row.ReorderLevel) > 0 && number(row.Quantity) <= number(row.ReorderLevel)))
  };
}

async function saveInventory(env, section, body, user) {
  const config = CONFIG[section];
  const itemName = clean(body.ItemName);
  if (!itemName) { const err = new Error('Item name is required.'); err.status = 400; throw err; }
  const rows = visible(await listCollection(env, config.inventory), user);
  const originalName = clean(body.OriginalItemName || itemName);
  const existing = rows.find((row) => lower(row.ItemName || row.__id) === lower(originalName)) || {};
  const payload = {
    ...existing,
    ...scopeFields(user),
    ItemName: itemName,
    Category: clean(body.Category) || config.category,
    Unit: clean(body.Unit) || config.unit,
    Quantity: Math.max(0, number(body.Quantity)),
    ReorderLevel: Math.max(0, number(body.ReorderLevel)),
    Notes: clean(body.Notes),
    LastUpdated: nowIso(),
    UpdatedBy: user.displayName || user.username
  };
  delete payload.__id;
  delete payload.__name;
  await upsertDocument(env, config.inventory, existing.__id || safeId(`${scopeFields(user).BranchId}-${scopeFields(user).SchoolSection}-${itemName}`), payload);
  return { ok: true, message: `${config.label} inventory item saved.` };
}

async function recordMovement(env, section, body, user) {
  const config = CONFIG[section];
  const itemName = clean(body.ItemName);
  const movementType = clean(body.MovementType).toUpperCase();
  const quantity = number(body.Quantity);
  if (!itemName) { const err = new Error('Choose an inventory item.'); err.status = 400; throw err; }
  if (!['IN', 'OUT'].includes(movementType)) { const err = new Error('Choose Stock In or Stock Out.'); err.status = 400; throw err; }
  if (quantity <= 0) { const err = new Error('Quantity must be greater than zero.'); err.status = 400; throw err; }
  const item = visible(await listCollection(env, config.inventory), user).find((row) => lower(row.ItemName || row.__id) === lower(itemName));
  if (!item) { const err = new Error('Inventory item not found. Create it first.'); err.status = 404; throw err; }
  const current = number(item.Quantity);
  if (movementType === 'OUT' && quantity > current) { const err = new Error(`Only ${current} ${clean(item.Unit) || 'units'} are currently available.`); err.status = 409; throw err; }
  const timestamp = nowIso();
  const updated = { ...item, Quantity: movementType === 'IN' ? current + quantity : current - quantity, LastUpdated: timestamp, UpdatedBy: user.displayName || user.username };
  delete updated.__id;
  delete updated.__name;
  await upsertDocument(env, config.inventory, item.__id, updated);
  const movementNo = `${config.prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await upsertDocument(env, config.movements, movementNo, {
    ...scopeFields(user),
    MovementNo: movementNo,
    Date: timestamp,
    ItemName: clean(item.ItemName) || itemName,
    MovementType: movementType,
    Quantity: quantity,
    Reason: clean(body.Reason),
    RecordedBy: user.displayName || user.username
  });
  return { ok: true, message: `${config.label} stock ${movementType === 'IN' ? 'receipt' : 'issue'} recorded.` };
}

async function saveClinicRecord(env, body, user) {
  const studentName = clean(body.StudentName);
  const complaint = clean(body.Complaint);
  if (!studentName || !complaint) { const err = new Error('Student name and complaint are required.'); err.status = 400; throw err; }
  const recordId = clean(body.RecordId) || `CLN-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await upsertDocument(env, 'clinicRecords', safeId(recordId), {
    ...scopeFields(user),
    RecordId: recordId,
    RecordNo: recordId,
    Date: clean(body.Date) || nowIso().slice(0, 10),
    StudentName: studentName,
    AdmissionNo: clean(body.AdmissionNo),
    ClassName: clean(body.ClassName),
    Complaint: complaint,
    Treatment: clean(body.Treatment),
    Disposition: clean(body.Disposition),
    Notes: clean(body.Notes),
    RecordedBy: user.displayName || user.username,
    UpdatedAt: nowIso()
  });
  return { ok: true, message: 'Clinic visit saved.' };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await request.json().catch(() => ({}));
    const section = clean(body.section);
    if (!CONFIG[section] || !(user.allowedSections || []).includes(section)) {
      const err = new Error('This staff account is not allowed to manage that department.'); err.status = 403; throw err;
    }
    const action = lower(body.action || 'list');
    if (action === 'saveitem') await saveInventory(env, section, body, user);
    else if (action === 'recordmovement') await recordMovement(env, section, body, user);
    else if (action === 'saveclinicrecord' && section === 'clinic') await saveClinicRecord(env, body, user);
    else if (action !== 'list') { const err = new Error('Choose a valid department action.'); err.status = 400; throw err; }
    const data = await loadDepartment(env, section, user);
    if (action !== 'list') data.message = action === 'saveitem' ? `${CONFIG[section].label} inventory item saved.` : action === 'recordmovement' ? `${CONFIG[section].label} stock movement recorded.` : 'Clinic visit saved.';
    return Response.json(data);
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
