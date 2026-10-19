import { getDocument, queryCollection } from './firestore.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const safeId = value => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
function inScope(row, item, scope) {
  const branch = lower(item.BranchId || scope.BranchId || 'main');
  const section = lower(item.SchoolSection || scope.SchoolSection);
  return clean(row.StoreType) === clean(item.StoreType)
    && lower(row.ItemCode) === lower(item.ItemCode)
    && lower(row.BranchId || 'main') === branch
    && (!section || !clean(row.SchoolSection) || lower(row.SchoolSection) === 'all' || lower(row.SchoolSection) === section);
}

// Checkout stores the exact ID. Older payment intents resolve by code only when
// there is one matching stock record in the recorded branch and school section.
export async function resolveSchoolStoreStock(env, item = {}, scope = {}) {
  const explicitId = clean(item.InventoryDocumentId);
  if (explicitId) {
    const row = await getDocument(env, 'storeItems', explicitId);
    const normalized = row && !row.ItemCode && explicitId === safeId(`${item.StoreType}-${item.ItemCode}`)
      ? { ...row, ItemCode: item.ItemCode } : row;
    return normalized && inScope(normalized, item, scope) ? normalized : null;
  }
  const rows = await queryCollection(env, 'storeItems', {
    filters: [{ field: 'ItemCode', op: '==', value: clean(item.ItemCode) }], limit: 101
  });
  if (rows.length > 100) throw Object.assign(new Error('This item code is ambiguous. Ask the store keeper to review its stock records.'), { status: 409 });
  const matches = rows.filter(row => inScope(row, item, scope));
  if (matches.length > 1) throw Object.assign(new Error('More than one stock record matches this item in the selected branch and section.'), { status: 409 });
  if (matches.length) return matches[0];
  // Some older records have no ItemCode field but retain their original ID.
  const legacy = await getDocument(env, 'storeItems', safeId(`${item.StoreType}-${item.ItemCode}`));
  const normalizedLegacy = legacy && { ...legacy, ItemCode: legacy.ItemCode || item.ItemCode };
  return normalizedLegacy && inScope(normalizedLegacy, item, scope) ? normalizedLegacy : null;
}
