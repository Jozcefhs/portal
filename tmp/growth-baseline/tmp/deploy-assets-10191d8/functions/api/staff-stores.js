import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { listSchoolCollection, schoolSectionFor } from '../lib/school-scope.js';
import { canonicalConfiguredClass } from '../lib/class-names.js';
import { categoryApplies, ensureStoreCategories, resolveStoreCategory, saveStoreCategory } from '../lib/store-categories.js';

function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function safeId(value) { return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140); }
function yes(value) { return ['yes', 'true', '1', 'active'].includes(lower(value)); }
function referenceKey(value) { return lower(value).split(/[^a-z0-9]+/).filter(Boolean).map((part) => /^\d+$/.test(part) ? String(Number(part)) : part).join('|'); }

function storeForSection(section) {
  return section === 'uniformStore' ? 'Uniform Store' : 'Bookstore';
}

function visible(rows, user) {
  const section = lower(user.schoolSectionAccess || 'All');
  const branch = lower(user.branchId || '');
  return rows.filter((row) => (section === 'all' || schoolSectionFor(row) === section) && (!branch || lower(row.BranchId || 'main') === branch));
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await request.json().catch(() => ({}));
    const section = clean(body.section || body.Section);
    if (!['bookstore', 'uniformStore'].includes(section) || !(user.allowedSections || []).includes(section)) {
      const err = new Error('This staff account is not allowed to manage that store.'); err.status = 403; throw err;
    }
    const storeType = storeForSection(section);
    const action = lower(body.action || 'list');
    if (action === 'savecategory' || action === 'deactivatecategory') {
      const category = await saveStoreCategory(env, { ...body, StoreType: storeType, Active: action === 'deactivatecategory' ? 'NO' : body.Active }, user.displayName || user.username);
      return Response.json({ ok: true, message: action === 'deactivatecategory' ? 'Category deactivated. Existing references were preserved.' : 'Category saved.', category });
    }
    if (action === 'saveitem') {
      const itemCode = clean(body.ItemCode);
      const itemName = clean(body.ItemName);
      if (!itemCode || !itemName) { const err = new Error('Item code and item name are required.'); err.status = 400; throw err; }
      const configuredClasses = await listCollection(env, 'settings/academics/classes').catch(() => []);
      const category = await resolveStoreCategory(env, body, storeType);
      const payload = {
        StoreType: storeType, ItemCode: itemCode, ItemName: itemName,
        CategoryId: category.CategoryId, Category: category.Name, Size: clean(body.Size), Gender: clean(body.Gender) || 'All',
        ClassName: canonicalConfiguredClass(clean(body.ClassName) || 'All', configuredClasses), Price: Math.max(0, Number(body.Price || 0) || 0),
        Quantity: Math.max(0, Math.floor(Number(body.Quantity || 0) || 0)), Active: yes(body.Active ?? true) ? 'YES' : 'NO',
        BranchId: clean(user.branchId) || 'main',
        SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary'),
        UpdatedAt: new Date().toISOString(), UpdatedBy: user.displayName || user.username
      };
      await upsertDocument(env, 'storeItems', safeId(`${storeType}-${itemCode}-${payload.BranchId}-${payload.SchoolSection}`), payload);
      return Response.json({ ok: true, message: 'Store item saved.', item: payload });
    }
    if (action === 'updateorder') {
      const orderNo = clean(body.OrderNo);
      const status = clean(body.Status);
      if (!orderNo || !['Paid - Awaiting Collection', 'Ready for Collection', 'Collected'].includes(status)) { const err = new Error('Choose a valid order and collection status.'); err.status = 400; throw err; }
      const order = visible(await listCollection(env, 'storeOrders'), user).find((row) => clean(row.StoreType) === storeType && (clean(row.OrderNo) === orderNo || clean(row.__id) === orderNo));
      if (!order) { const err = new Error('Store order not found.'); err.status = 404; throw err; }
      let verifiedReference = '';
      if (status === 'Collected') {
        verifiedReference = clean(body.CollectionReference);
        if (!verifiedReference) { const err = new Error('Student card ID, admission number, or parent verification code is required.'); err.status = 400; throw err; }
        const students = await listSchoolCollection(env, 'students');
        const student = students.find((row) => [row.AccountRef, row.AdmissionNo, row.ApplicationReference].map(referenceKey).filter(Boolean).includes(referenceKey(order.AccountRef || order.AdmissionNo)));
        const allowed = [order.AccountRef, order.AdmissionNo, student?.AccountRef, student?.AdmissionNo, student?.WalletCardId, student?.VerificationCode, student?.ParentLoginCode].map(referenceKey).filter(Boolean);
        if (!allowed.includes(referenceKey(verifiedReference))) { const err = new Error('The collection reference does not match this order. Nothing was marked collected.'); err.status = 409; throw err; }
      }
      const payload = { ...order, Status: status, UpdatedAt: new Date().toISOString(), UpdatedBy: user.displayName || user.username };
      if (status === 'Collected') { payload.CollectedAt = new Date().toISOString(); payload.CollectedBy = user.displayName || user.username; payload.CollectionReferenceVerified = verifiedReference; }
      delete payload.__id; delete payload.__name;
      await upsertDocument(env, 'storeOrders', order.__id || safeId(orderNo), payload);
      return Response.json({ ok: true, message: 'Order collection status updated.', order: payload });
    }
    const [{ categories, items }, orders] = await Promise.all([ensureStoreCategories(env), listCollection(env, 'storeOrders')]);
    return Response.json({ ok: true, categories: categories.filter((row) => categoryApplies(row, storeType)), items: visible(items, user).filter((row) => clean(row.StoreType) === storeType), orders: visible(orders, user).filter((row) => clean(row.StoreType) === storeType) });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
