import { getDocument } from './firestore.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const yes = value => value === true || ['yes', 'true', '1'].includes(lower(value));
const failure = message => Object.assign(new Error(message), { status: 409, code: 'PROCUREMENT_STOCK_CONTROLLED' });

// Quantities are not money: preserve supported fractional stock instead of
// rounding a medicine dose or kilogram balance to two currency decimal places.
export function inventoryQuantityNumber(value) {
  const raw = clean(value || 0), negative = /^\s*\(.*\)\s*$/.test(raw);
  const parsed = Number(raw.replace(/,/g, '').replace(/[^0-9.-]/g, '') || '0') * (negative ? -1 : 1);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function procurementVendorOwned(row = {}) {
  return Boolean(clean(row.VendorId)) || lower(row.OwnershipType || row.OwnerType) === 'vendor';
}

export function procurementManagedItem(row = {}) {
  return yes(row.ProcurementManaged) || Boolean(clean(row.ProcurementItemId));
}

export async function loadProcurementInventoryControl(env, scope = {}, readDocument = getDocument) {
  const rawEdition = lower(scope.edition || scope.OrganisationEdition || scope.OrganizationEdition || 'school');
  const edition = ['church', 'faith', 'religious'].includes(rawEdition) ? 'faith'
    : ['organisation', 'organization', 'other'].includes(rawEdition) ? 'organization' : rawEdition;
  const branch = lower(scope.branchId || scope.BranchId || 'main');
  if (!['school', 'faith', 'organization'].includes(edition) || !/^[a-z0-9._-]{1,80}$/.test(branch) || branch === 'all') {
    throw Object.assign(new Error('Choose one valid edition and branch for inventory changes.'), { status: 400 });
  }
  const settings = await readDocument(env, 'procurementSettings', `${edition}--${branch}`);
  return yes(settings?.Enabled);
}

function controlledItem(existing = {}, options = {}) {
  return procurementManagedItem(existing) || (options.controlled === true && !procurementVendorOwned(existing));
}

// Existing balances are not migrated or revalued by this guard. Procurement
// receipts and reviewed adjustments are the only writers that bypass it.
export function assertProcurementInventoryEdit(existing = {}, next = {}, options = {}) {
  if (options.controlled === true && procurementVendorOwned(existing) && !procurementVendorOwned({ ...existing, ...next })) {
    throw failure('Vendor-owned stock must remain separate. Use reviewed Procurement to introduce organisation-owned stock, not an ownership conversion.');
  }
  if (!procurementManagedItem(existing) && !clean(existing.__id || existing.ItemName || existing.ItemCode) && procurementVendorOwned(next)) return;
  if (!controlledItem(existing, options)) return;
  const previousQuantity = Number(existing.Quantity ?? 0);
  const nextQuantity = Number(next.Quantity ?? existing.Quantity ?? 0);
  if (!Number.isFinite(nextQuantity) || nextQuantity !== previousQuantity) {
    throw failure('Stock is controlled by Procurement. Confirm a delivery to receive stock, or record Stock out for usage; do not replace the balance.');
  }
  if (!procurementVendorOwned(existing) && procurementVendorOwned(next)) {
    throw failure('Procurement stock belongs to the organisation and cannot be reassigned to a vendor. Create a separate vendor-owned product.');
  }
  if (clean(existing.__id || existing.ItemName || existing.ItemCode)) {
    for (const [field, fallback] of [['BranchId', 'main'], ['OrganisationEdition', 'school'], ['SchoolSection', 'Secondary'], ['StoreType', '']]) {
      if ((field === 'BranchId' || clean(existing[field])) && Object.hasOwn(next, field)
        && lower(next[field] || fallback) !== lower(existing[field] || fallback)) {
        throw failure('Procurement-controlled stock cannot be moved to another branch, edition, department or school section through an editor or import.');
      }
    }
  }
  if (procurementManagedItem(existing)) {
    for (const field of ['ProcurementManaged', 'ProcurementItemId', 'Unit', 'ItemCode', 'BranchId', 'SchoolSection', 'OrganisationEdition', 'StoreType']) {
      if (Object.hasOwn(next, field) && clean(next[field]) !== clean(existing[field])) {
        throw failure(`The ${field} of Procurement-linked stock cannot be changed in the department editor.`);
      }
    }
  }
}

export function assertProcurementInventoryMovement(item = {}, type, options = {}) {
  if (controlledItem(item, options) && clean(type).toUpperCase() === 'IN') {
    throw failure('Receive stock through Procurement and confirm the delivered quantity. Direct Stock in is disabled for organisation-owned stock.');
  }
}

export function procurementMovementBalance(item = {}, type, amount, options = {}) {
  const current = Number(item.Quantity || 0), incoming = clean(type).toUpperCase() === 'IN';
  if (!controlledItem(item, options)) return incoming ? current + Number(amount) : current - Number(amount);
  const scaled = Number(amount) * 1000, previous = current * 1000;
  // Tolerate floating-point representation noise, not additional precision.
  if (!Number.isSafeInteger(Math.round(scaled)) || !Number.isSafeInteger(Math.round(previous))
    || Math.abs(scaled - Math.round(scaled)) > 0.000001 || Math.abs(previous - Math.round(previous)) > 0.000001) {
    throw failure('Procurement stock and usage quantities must have at most three decimal places.');
  }
  return (Math.round(previous) + (incoming ? Math.round(scaled) : -Math.round(scaled))) / 1000;
}

export function assertProcurementInventoryDeletion(item = {}, options = {}) {
  if (controlledItem(item, options)) {
    throw failure('Procurement-controlled inventory cannot be deleted. Preserve its stock and delivery history.');
  }
}

export function guardProcurementImportRow(existing = {}, next = {}, options = {}) {
  if (procurementManagedItem(existing) || (controlledItem(existing, options) && clean(existing.__id || existing.ItemName || existing.ItemCode))) {
    throw failure('Existing Procurement-linked stock must be preserved. Use Procurement adjustments instead of replacing it through an import.');
  }
  // CSV import must not manufacture a linked stock identity or transfer ownership.
  if (procurementManagedItem(next) && !procurementManagedItem(existing)) {
    throw failure('Procurement links must be created by the reviewed Procurement workflow, not by an inventory import.');
  }
  assertProcurementInventoryEdit(existing, next, options);
}
