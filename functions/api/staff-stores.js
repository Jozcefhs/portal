import { batchCommitDocuments, listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { listSchoolCollection, schoolSectionFor } from '../lib/school-scope.js';
import { canonicalConfiguredClass } from '../lib/class-names.js';
import { categoryApplies, ensureStoreCategories, resolveStoreCategory, saveStoreCategory } from '../lib/store-categories.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';
import {
  initializeOnlineOrganizationCommerceSale,
  listOrganizationCommerceSales,
  normalizeCommercePaymentMethod,
  recordManualOrganizationCommerceSale
} from '../lib/organization-commerce.js';
import QRCode from 'qrcode';

function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function safeId(value) { return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140); }
function yes(value) { return ['yes', 'true', '1', 'active'].includes(lower(value)); }
function referenceKey(value) { return lower(value).split(/[^a-z0-9]+/).filter(Boolean).map((part) => /^\d+$/.test(part) ? String(Number(part)) : part).join('|'); }

function storeQrSvg(value = '') {
  const qr = QRCode.create(clean(value), { errorCorrectionLevel: 'M' });
  const margin = 3;
  const size = qr.modules.size + (margin * 2);
  const modules = [];
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (qr.modules.get(row, column)) modules.push(`M${column + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Public organisation store QR code" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${size}v${size}H0z"/><path fill="#071b2c" d="${modules.join('')}"/></svg>`;
}

function storeForSection(section) {
  if (section === 'uniformStore') return 'Uniform Store';
  if (section === 'organizationStore') return 'Organisation Store';
  return 'Bookstore';
}

function visible(rows, user) {
  const section = lower(user.schoolSectionAccess || 'All');
  const branch = lower(user.branchId || '');
  return rows.filter((row) => (section === 'all' || schoolSectionFor(row) === section) && (!branch || lower(row.BranchId || 'main') === branch));
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 512 * 1024 });
    const section = clean(body.section || body.Section);
    if (!['bookstore', 'uniformStore', 'organizationStore'].includes(section) || !(user.allowedSections || []).includes(section)) {
      const err = new Error('This staff account is not allowed to manage that store.'); err.status = 403; throw err;
    }
    const storeType = storeForSection(section);
    const action = lower(body.action || 'list');
    if (action === 'genericqr') {
      if (section !== 'organizationStore') {
        const err = new Error('The public store QR code is available only in the Organisation Store workspace.');
        err.status = 403;
        throw err;
      }
      const origin = new URL(request.url).origin.replace(/\/+$/, '');
      const branchId = clean(user.branchId).toLowerCase() || 'main';
      const storeUrl = `${origin}/store.html?branch=${encodeURIComponent(branchId)}`;
      if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(storeUrl)) {
        const err = new Error('The public store address is unavailable on this deployment.');
        err.status = 503;
        throw err;
      }
      return Response.json({
        ok: true,
        generic: true,
        message: 'Reusable public store QR code generated.',
        branchId,
        storeUrl,
        paymentLink: storeUrl,
        qrSvg: storeQrSvg(storeUrl)
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action === 'savecategory' || action === 'deactivatecategory') {
      const category = await saveStoreCategory(env, { ...body, StoreType: storeType, Active: action === 'deactivatecategory' ? 'NO' : body.Active }, user.displayName || user.username);
      return Response.json({ ok: true, message: action === 'deactivatecategory' ? 'Category deactivated. Existing references were preserved.' : 'Category saved.', category });
    }
    if (action === 'saveitem') {
      const itemId = clean(body.ItemId || body.itemId);
      const itemCode = clean(body.ItemCode);
      const itemName = clean(body.ItemName);
      if (!itemCode || !itemName) { const err = new Error('Item code and item name are required.'); err.status = 400; throw err; }
      const scopedItems = visible(await listCollection(env, 'storeItems'), user)
        .filter((row) => clean(row.StoreType) === storeType);
      const existing = itemId ? scopedItems.find((row) => clean(row.__id) === itemId) : null;
      if (itemId && !existing) { const err = new Error('Store item not found or is outside your permitted workspace.'); err.status = 404; throw err; }
      const duplicate = scopedItems.find((row) => lower(row.ItemCode) === lower(itemCode) && clean(row.__id) !== clean(existing?.__id));
      if (duplicate) { const err = new Error(`Item code ${itemCode} is already in use. Edit that item instead.`); err.status = 409; throw err; }
      const configuredClasses = await listCollection(env, 'settings/academics/classes').catch(() => []);
      const category = await resolveStoreCategory(env, body, storeType);
      const payload = {
        ...(existing || {}),
        StoreType: storeType, ItemCode: itemCode, ItemName: itemName,
        CategoryId: category.CategoryId, Category: category.Name, Size: clean(body.Size), Gender: section === 'organizationStore' ? 'All' : (clean(body.Gender) || 'All'),
        ClassName: section === 'organizationStore' ? 'All' : canonicalConfiguredClass(clean(body.ClassName) || 'All', configuredClasses), Price: Math.max(0, Number(body.Price || 0) || 0),
        Quantity: Math.max(0, Math.floor(Number(body.Quantity || 0) || 0)), Active: yes(body.Active ?? true) ? 'YES' : 'NO',
        BranchId: clean(existing?.BranchId || user.branchId) || 'main',
        OrganisationEdition: clean(existing?.OrganisationEdition || user.edition || user.OrganisationEdition) || 'school',
        SchoolSection: clean(existing?.SchoolSection) || (clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary')),
        UpdatedAt: new Date().toISOString(), UpdatedBy: user.displayName || user.username
      };
      delete payload.__id;
      delete payload.__name;
      const desiredDocumentId = safeId(`${storeType}-${itemCode}-${payload.BranchId}-${payload.SchoolSection}`);
      const codeChanged = Boolean(existing) && lower(existing.ItemCode) !== lower(itemCode);
      const targetConflict = codeChanged && scopedItems.find((row) => clean(row.__id) === desiredDocumentId && clean(row.__id) !== clean(existing.__id));
      if (targetConflict) { const err = new Error('The updated item code conflicts with another stored item identity. Choose a different code.'); err.status = 409; throw err; }
      const documentId = codeChanged ? desiredDocumentId : (clean(existing?.__id) || desiredDocumentId);
      if (codeChanged) {
        await batchCommitDocuments(env, [
          { collectionPath: 'storeItems', documentId, data: payload },
          { collectionPath: 'storeItems', documentId: existing.__id, operation: 'delete' }
        ]);
      } else {
        await upsertDocument(env, 'storeItems', documentId, payload);
      }
      return Response.json({ ok: true, message: existing ? 'Store item updated.' : 'Store item saved.', item: { ...payload, __id: documentId } });
    }
    if (action === 'recordsale') {
      if (section !== 'organizationStore') {
        const err = new Error('Walk-in commerce payments are available only in the Organisation Store workspace.');
        err.status = 403;
        throw err;
      }
      idempotency = await beginIdempotentRequest(env, request, body, {
        scope: 'organisation-store-record-sale',
        actor: user.username,
        ttlMinutes: 30 * 24 * 60
      });
      if (idempotency.replay) {
        return Response.json(idempotency.response, {
          status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
          headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
        });
      }
      const method = normalizeCommercePaymentMethod(body.PaymentMethod);
      const emailOptions = typeof context.waitUntil === 'function'
        ? { waitUntil: (task) => context.waitUntil(task) }
        : {};
      const result = method === 'Paystack Online'
        ? await initializeOnlineOrganizationCommerceSale(env, request, section, body, user, emailOptions)
        : await recordManualOrganizationCommerceSale(env, section, body, user, emailOptions);
      await completeIdempotentRequest(env, idempotency, result, 200);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
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
        if (!verifiedReference) { const err = new Error(section === 'organizationStore' ? 'Order number or customer collection reference is required.' : 'Student card ID, admission number, or parent verification code is required.'); err.status = 400; throw err; }
        let allowed;
        if (section === 'organizationStore') {
          allowed = [order.OrderNo, order.Reference, order.CustomerReference, order.Email, order.Phone].map(referenceKey).filter(Boolean);
        } else {
          const students = await listSchoolCollection(env, 'students', {
            branchId: user.branchId,
            schoolSectionAccess: user.schoolSectionAccess
          });
          const student = students.find((row) => [row.AccountRef, row.AdmissionNo, row.ApplicationReference].map(referenceKey).filter(Boolean).includes(referenceKey(order.AccountRef || order.AdmissionNo)));
          allowed = [order.AccountRef, order.AdmissionNo, student?.AccountRef, student?.AdmissionNo, student?.WalletCardId, student?.VerificationCode, student?.ParentLoginCode].map(referenceKey).filter(Boolean);
        }
        if (!allowed.includes(referenceKey(verifiedReference))) { const err = new Error('The collection reference does not match this order. Nothing was marked collected.'); err.status = 409; throw err; }
      }
      const payload = { ...order, Status: status, UpdatedAt: new Date().toISOString(), UpdatedBy: user.displayName || user.username };
      if (status === 'Collected') { payload.CollectedAt = new Date().toISOString(); payload.CollectedBy = user.displayName || user.username; payload.CollectionReferenceVerified = verifiedReference; }
      delete payload.__id; delete payload.__name;
      await upsertDocument(env, 'storeOrders', order.__id || safeId(orderNo), payload);
      return Response.json({ ok: true, message: 'Order collection status updated.', order: payload });
    }
    const [{ categories, items }, orders, sales] = await Promise.all([
      ensureStoreCategories(env),
      listCollection(env, 'storeOrders'),
      section === 'organizationStore'
        ? listOrganizationCommerceSales(env, section, user)
        : Promise.resolve([])
    ]);
    return Response.json({
      ok: true,
      categories: categories.filter((row) => categoryApplies(row, storeType)),
      items: visible(items, user).filter((row) => clean(row.StoreType) === storeType),
      orders: visible(orders, user).filter((row) => clean(row.StoreType) === storeType),
      sales
    });
  } catch (err) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, err);
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
