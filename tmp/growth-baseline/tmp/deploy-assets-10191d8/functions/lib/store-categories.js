import { batchUpsertDocuments, listCollection, upsertDocument } from './firestore.js';

const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
const scopeName = (value) => clean(value).toLowerCase().includes('uniform') ? 'Uniform Store' : 'Bookstore';
const safeId = (value) => clean(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'category';
export const categoryKey = (value) => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[&/+]/g, ' and ').replace(/\b(accessories)\b/g, 'accessory').replace(/\b(books)\b/g, 'book')
  .replace(/\b(shirts|skirts|trousers|bags)\b/g, (word) => word.slice(0, -1)).replace(/[^a-z0-9]+/g, '');

function scopes(value, fallback) {
  const values = Array.isArray(value) ? value : clean(value).split(/[,/|]+/);
  const result = [...new Set(values.filter(Boolean).map(scopeName))];
  return result.length ? result : [scopeName(fallback)];
}

export function categoryApplies(category, storeType) {
  return scopes(category.StoreScopes || category.AppliesTo, storeType).includes(scopeName(storeType));
}

export async function ensureStoreCategories(env) {
  const [rawCategories, items] = await Promise.all([listCollection(env, 'storeCategories').catch(() => []), listCollection(env, 'storeItems')]);
  const byKey = new Map(); const categories = []; const writes = [];
  for (const row of rawCategories) {
    const name = clean(row.Name || row.Category || row.__id); if (!name) continue;
    const key = categoryKey(name); const existing = byKey.get(key);
    if (existing) {
      existing.StoreScopes = [...new Set([...existing.StoreScopes, ...scopes(row.StoreScopes || row.AppliesTo, row.StoreType)])];
      existing.Aliases = [...new Set([...(existing.Aliases || []), name])];
      writes.push({ collectionPath: 'storeCategories', documentId: row.__id, data: { ...row, Active: 'NO', ReplacedByCategoryId: existing.CategoryId, UpdatedAt: new Date().toISOString() } });
      continue;
    }
    const category = { ...row, CategoryId: clean(row.CategoryId || row.__id), Name: name, SearchKey: key, StoreScopes: scopes(row.StoreScopes || row.AppliesTo, row.StoreType), Active: clean(row.Active || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES' };
    delete category.__id; delete category.__name; byKey.set(key, category); categories.push(category);
  }
  for (const item of items) {
    const name = clean(item.Category); if (!name) continue;
    const key = categoryKey(name); let category = byKey.get(key);
    if (!category) {
      const id = `CAT-${safeId(categoryKey(name)).toUpperCase()}`;
      category = { CategoryId: id, Name: name, SearchKey: key, StoreScopes: [scopeName(item.StoreType)], Active: 'YES', Aliases: [], CreatedAt: new Date().toISOString(), UpdatedAt: new Date().toISOString() };
      byKey.set(key, category); categories.push(category); writes.push({ collectionPath: 'storeCategories', documentId: id, data: category });
    } else if (!category.StoreScopes.includes(scopeName(item.StoreType))) {
      category.StoreScopes.push(scopeName(item.StoreType));
      writes.push({ collectionPath: 'storeCategories', documentId: category.CategoryId, data: category });
    }
    if (clean(item.CategoryId) !== category.CategoryId || name !== category.Name) {
      const payload = { ...item, CategoryId: category.CategoryId, Category: category.Name, UpdatedAt: item.UpdatedAt || new Date().toISOString() };
      delete payload.__id; delete payload.__name;
      writes.push({ collectionPath: 'storeItems', documentId: item.__id, data: payload });
    }
  }
  if (!categories.length) {
    const defaults = [
      ['Shirts', 'Uniform Store'], ['Trousers/Skirts', 'Uniform Store'], ['Sportswear', 'Uniform Store'], ['Footwear', 'Uniform Store'],
      ['Textbooks', 'Bookstore'], ['Exercise Books', 'Bookstore'], ['Stationery', 'Bookstore'], ['Bags/Accessories', 'Bookstore']
    ];
    for (const [name, storeType] of defaults) {
      const id = `CAT-${safeId(categoryKey(name)).toUpperCase()}`; const category = { CategoryId: id, Name: name, SearchKey: categoryKey(name), StoreScopes: [storeType], Active: 'YES', Aliases: [], CreatedAt: new Date().toISOString(), UpdatedAt: new Date().toISOString() };
      categories.push(category); writes.push({ collectionPath: 'storeCategories', documentId: id, data: category });
    }
  }
  const uniqueWrites = [...new Map(writes.map((write) => [`${write.collectionPath}/${write.documentId}`, write])).values()];
  for (let index = 0; index < uniqueWrites.length; index += 450) await batchUpsertDocuments(env, uniqueWrites.slice(index, index + 450));
  return { categories, items };
}

export async function saveStoreCategory(env, body, updatedBy = '') {
  const name = clean(body.Name || body.Category); if (!name) { const error = new Error('Category name is required.'); error.status = 400; throw error; }
  const { categories, items } = await ensureStoreCategories(env);
  const id = clean(body.CategoryId); const duplicate = categories.find((row) => categoryKey(row.Name) === categoryKey(name) && row.CategoryId !== id);
  if (duplicate) { const error = new Error(`A matching or very similar category already exists as "${duplicate.Name}".`); error.status = 409; throw error; }
  const current = categories.find((row) => row.CategoryId === id); const categoryId = current?.CategoryId || `CAT-${safeId(categoryKey(name)).toUpperCase()}`;
  const payload = { ...(current || {}), CategoryId: categoryId, Name: name, SearchKey: categoryKey(name), StoreScopes: scopes(body.StoreScopes || body.AppliesTo, body.StoreType), Active: clean(body.Active || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES', UpdatedAt: new Date().toISOString(), UpdatedBy: updatedBy, CreatedAt: current?.CreatedAt || new Date().toISOString() };
  if (current && current.Name !== name) payload.Aliases = [...new Set([...(current.Aliases || []), current.Name])];
  await upsertDocument(env, 'storeCategories', categoryId, payload);
  if (current && current.Name !== name) {
    const affected = items.filter((item) => clean(item.CategoryId) === categoryId || categoryKey(item.Category) === categoryKey(current.Name));
    for (let index = 0; index < affected.length; index += 450) await batchUpsertDocuments(env, affected.slice(index, index + 450).map((item) => { const data = { ...item, CategoryId: categoryId, Category: name }; delete data.__id; delete data.__name; return { collectionPath: 'storeItems', documentId: item.__id, data }; }));
  }
  return payload;
}

export async function resolveStoreCategory(env, body, storeType) {
  const { categories } = await ensureStoreCategories(env); const id = clean(body.CategoryId); const name = clean(body.Category);
  let category = categories.find((row) => id && row.CategoryId === id) || categories.find((row) => categoryKey(row.Name) === categoryKey(name));
  if (!category && String(body.CreateCategoryIfMissing).toLowerCase() === 'true') category = await saveStoreCategory(env, { Name: name, StoreScopes: [storeType], Active: 'YES' }, clean(body.UpdatedBy));
  if (!category) { const error = new Error('Choose an existing category or confirm quick creation of the new category.'); error.status = 400; throw error; }
  if (category.Active === 'NO') { const error = new Error('That category is inactive. Reactivate it before assigning items.'); error.status = 409; throw error; }
  if (!categoryApplies(category, storeType)) { const error = new Error(`That category is not enabled for ${storeType}.`); error.status = 409; throw error; }
  return category;
}
