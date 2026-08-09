import {
  batchUpsertDocuments,
  createDocumentIfAbsent,
  getDocument,
  listCollection,
  patchDocumentFields,
  upsertDocument
} from './firestore.js';
import {
  sendOrganizationCommercePaymentLinkEmail,
  sendOrganizationCommerceReceiptEmail
} from './organization-commerce-email.js';
import { createDirectTransferRequest, publicPaymentMethods } from './direct-bank-transfer.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const money = (value) => {
  const parsed = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : 0;
};
const safeId = (value) => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));
const COMMERCE_EMAIL_DELIVERIES = 'organizationCommerceEmailDeliveries';

async function commerceEmailTask(env, sale = {}, type = 'receipt', deliveryId = '') {
  const prefix = type === 'payment-link' ? 'PaymentLinkEmail' : 'ReceiptEmail';
  let result;
  try {
    result = type === 'payment-link'
      ? await sendOrganizationCommercePaymentLinkEmail(env, sale)
      : await sendOrganizationCommerceReceiptEmail(env, sale);
  } catch (deliveryError) {
    const failedAt = nowIso();
    const errorMessage = clean(deliveryError?.message || deliveryError).slice(0, 500);
    await Promise.allSettled([
      patchDocumentFields(env, COMMERCE_CONFIG.organizationStore.sales, safeId(sale.SaleNo), {
      [`${prefix}Status`]: 'Failed',
        [`${prefix}Error`]: errorMessage,
        UpdatedAt: failedAt
      }),
      patchDocumentFields(env, COMMERCE_EMAIL_DELIVERIES, deliveryId, {
        Status: 'Failed', Error: errorMessage, UpdatedAt: failedAt
      })
    ]);
    return { ok: false, message: deliveryError?.message || String(deliveryError), deliveryUncertain: true };
  }
  const deliveredAt = nowIso();
  const status = result.ok ? 'Sent' : (result.skipped ? 'Skipped' : 'Failed');
  const tracking = await Promise.allSettled([
    patchDocumentFields(env, COMMERCE_CONFIG.organizationStore.sales, safeId(sale.SaleNo), {
      [`${prefix}Status`]: status,
      [`${prefix}At`]: result.ok ? deliveredAt : '',
      [`${prefix}ProviderId`]: clean(result.providerMessageId),
      [`${prefix}Error`]: result.ok ? '' : clean(result.message),
      UpdatedAt: deliveredAt
    }),
    patchDocumentFields(env, COMMERCE_EMAIL_DELIVERIES, deliveryId, {
      Status: status,
      ProviderId: clean(result.providerMessageId),
      Error: result.ok ? '' : clean(result.message),
      DeliveredAt: result.ok ? deliveredAt : '',
      UpdatedAt: deliveredAt
    })
  ]);
  return { ...result, trackingPersisted: tracking.every((entry) => entry.status === 'fulfilled') };
}

async function scheduleCommerceEmail(env, sale = {}, type = 'receipt', options = {}) {
  if (!clean(sale.CustomerEmail)) return { ok: false, skipped: true, message: 'Customer email was not provided.' };
  const prefix = type === 'payment-link' ? 'PaymentLinkEmail' : 'ReceiptEmail';
  if (lower(sale[`${prefix}Status`]) === 'sent') return { ok: true, replayed: true };
  const deliveryId = safeId(`${sale.SaleNo}-${type}`);
  let claim;
  try {
    claim = await createDocumentIfAbsent(env, COMMERCE_EMAIL_DELIVERIES, deliveryId, {
      DeliveryId: deliveryId,
      SaleNo: clean(sale.SaleNo),
      Type: type,
      RecipientEmail: lower(sale.CustomerEmail),
      BranchId: clean(sale.BranchId || 'main'),
      OrganisationEdition: canonicalEdition(sale.OrganisationEdition),
      Status: 'Queued',
      CreatedAt: nowIso(),
      UpdatedAt: nowIso()
    });
  } catch (trackingError) {
    return {
      ok: false,
      deliveryUncertain: true,
      type,
      message: `Email delivery could not be queued: ${clean(trackingError?.message || trackingError)}`
    };
  }
  if (!claim.created) {
    const claimedStatus = lower(claim.document?.Status || 'queued');
    return {
      ok: claimedStatus === 'sent',
      queued: claimedStatus === 'queued',
      replayed: true,
      deliveryUncertain: !['sent', 'queued'].includes(claimedStatus),
      type
    };
  }
  const task = commerceEmailTask(env, sale, type, deliveryId);
  if (typeof options.waitUntil === 'function') {
    try {
      options.waitUntil(task);
      return { ok: true, queued: true, type };
    } catch {
      return task;
    }
  }
  return task;
}

export function shouldEmailOrganizationCommercePaymentLink(sale = {}) {
  return lower(sale.CheckoutSource) !== 'public store';
}

async function scheduleCommercePaymentLinkEmail(env, sale = {}, options = {}) {
  if (!shouldEmailOrganizationCommercePaymentLink(sale)) {
    return {
      ok: true,
      skipped: true,
      type: 'payment-link',
      reason: 'public-self-service-checkout'
    };
  }
  return scheduleCommerceEmail(env, sale, 'payment-link', options);
}

function commerceEmailNotice(delivery = {}, label = 'Email') {
  if (delivery.skipped) return '';
  if (delivery.ok || delivery.queued) return ` ${label} queued.`;
  return ` ${label} could not be queued: ${clean(delivery.message) || 'delivery tracking is unavailable'}.`;
}

export const COMMERCE_CONFIG = Object.freeze({
  organizationStore: Object.freeze({
    label: 'Organisation Store',
    inventory: 'storeItems',
    movements: 'organizationCommerceMovements',
    sales: 'organizationCommerceSales',
    revenueAccount: '4120',
    itemKey: 'ItemCode'
  }),
  restaurant: Object.freeze({
    label: 'Restaurant',
    inventory: 'restaurantInventory',
    movements: 'restaurantMovements',
    sales: 'organizationCommerceSales',
    revenueAccount: '4130',
    itemKey: 'ItemName'
  })
});

function error(message, status = 400, code = '') {
  const failure = new Error(message);
  failure.status = status;
  if (code) failure.code = code;
  return failure;
}

function configFor(section) {
  const config = COMMERCE_CONFIG[clean(section)];
  if (!config) throw error('Choose a valid organisation sales workspace.');
  return config;
}

function canonicalEdition(value) {
  const edition = lower(value);
  if (['church', 'faith', 'religious'].includes(edition)) return 'faith';
  if (['organization', 'organisation', 'other'].includes(edition)) return 'organization';
  return edition || 'school';
}

function scopeFor(user = {}) {
  return {
    BranchId: clean(user.branchId || user.BranchId) || 'main',
    OrganisationEdition: canonicalEdition(
      user.edition || user.Edition || user.OrganisationEdition || user.OrganizationEdition
    )
  };
}

function visibleInScope(row = {}, user = {}) {
  const scope = scopeFor(user);
  const branchMatches = lower(row.BranchId || 'main') === lower(scope.BranchId);
  const rowEdition = clean(row.OrganisationEdition || row.OrganizationEdition);
  const editionMatches = !rowEdition || canonicalEdition(rowEdition) === scope.OrganisationEdition;
  return branchMatches && editionMatches;
}

function withoutMetadata(row = {}) {
  const payload = { ...row };
  delete payload.__id;
  delete payload.__name;
  delete payload.__createTime;
  delete payload.__updateTime;
  return payload;
}

export function normalizeCommercePaymentMethod(value) {
  const method = lower(value).replace(/[^a-z0-9]+/g, '');
  if (method === 'cash') return 'Cash';
  if (['transfer', 'banktransfer', 'bank'].includes(method)) return 'Bank Transfer';
  if (['pos', 'card', 'poscard', 'cardpos'].includes(method)) return 'POS / Card';
  if (['online', 'paystack', 'paystackonline', 'onlinepaystack'].includes(method)) return 'Paystack Online';
  throw error('Choose Cash, Bank Transfer, POS / Card, or Paystack Online.');
}

function paymentAccount(method) {
  if (method === 'Cash') return '1010';
  if (method === 'Paystack Online') return '1030';
  return '1020';
}

function itemReference(entry = {}) {
  return clean(entry.ItemCode || entry.itemCode || entry.ItemName || entry.itemName || entry.Reference);
}

function requestedQuantity(entry = {}) {
  const quantity = Math.floor(money(entry.Quantity || entry.quantity || 1));
  if (quantity <= 0) throw error('Every sale item must have a quantity greater than zero.');
  return quantity;
}

function requestedItems(body = {}) {
  let rows = body.Items || body.items || [];
  if (typeof rows === 'string' && rows.trim()) {
    try {
      rows = JSON.parse(rows);
    } catch {
      throw error('The sale item list is invalid.');
    }
  }
  if (!Array.isArray(rows) || !rows.length) throw error('Choose at least one item for this sale.');
  if (rows.length > 50) throw error('A sale may contain at most 50 item lines.');
  const demand = new Map();
  rows.forEach((entry) => {
    const reference = itemReference(entry);
    if (!reference) throw error('Every sale line must identify an inventory item.');
    const key = lower(reference);
    const previous = demand.get(key) || { Reference: reference, Quantity: 0 };
    previous.Quantity += requestedQuantity(entry);
    demand.set(key, previous);
  });
  return [...demand.values()];
}

async function scopedInventory(env, section, user) {
  const config = configFor(section);
  const rows = (await listCollection(env, config.inventory)).filter((row) => visibleInScope(row, user));
  if (section === 'organizationStore') {
    return rows.filter((row) => clean(row.StoreType) === 'Organisation Store');
  }
  return rows;
}

function findInventoryItem(rows, section, reference) {
  const wanted = lower(reference);
  if (section === 'organizationStore') {
    return rows.find((row) => lower(row.ItemCode || row.__id) === wanted);
  }
  return rows.find((row) => lower(row.ItemName || row.__id) === wanted);
}

async function authoritativeCart(env, section, body, user) {
  const inventory = await scopedInventory(env, section, user);
  const demand = requestedItems(body);
  return demand.map((requested) => {
    const item = findInventoryItem(inventory, section, requested.Reference);
    if (!item) throw error(`${requested.Reference} was not found in this branch.`, 404);
    if (clean(item.Active || 'YES').toUpperCase() === 'NO') {
      throw error(`${clean(item.ItemName) || requested.Reference} is not available for sale.`, 409);
    }
    const available = Math.floor(money(item.Quantity));
    if (requested.Quantity > available) {
      throw error(`${clean(item.ItemName) || requested.Reference} has only ${available} available.`, 409);
    }
    const price = money(item.Price ?? item.SalePrice);
    if (price <= 0) throw error(`${clean(item.ItemName) || requested.Reference} does not have a valid sale price.`);
    return {
      InventoryDocumentId: clean(item.__id),
      InventoryUpdateTime: clean(item.__updateTime),
      ItemCode: clean(item.ItemCode),
      ItemName: clean(item.ItemName || item.__id),
      Category: clean(item.Category),
      Unit: clean(item.Unit || 'pcs'),
      Variant: clean(item.Size),
      Quantity: requested.Quantity,
      UnitPrice: price,
      Amount: money(price * requested.Quantity),
      AvailableBeforeSale: available
    };
  });
}

function saleId(body = {}, section = '') {
  const supplied = safeId(body.SaleRequestId || body.saleRequestId || body.SaleNo || body.saleNo);
  if (supplied) return supplied;
  const prefix = section === 'restaurant' ? 'RST-SALE' : 'STORE-SALE';
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function paymentReference(body = {}) {
  return clean(body.PaymentReference || body.paymentReference || body.Reference || body.reference);
}

function baseSale(section, body, user, cart, id, method) {
  const config = configFor(section);
  const scope = scopeFor(user);
  const total = money(cart.reduce((sum, item) => sum + item.Amount, 0));
  if (total <= 0) throw error('The sale total must be greater than zero.');
  const customerEmail = lower(body.CustomerEmail || body.customerEmail || body.Email || body.email);
  if (customerEmail && !validEmail(customerEmail)) throw error('Enter a valid customer email address.');
  return {
    SaleNo: id,
    SaleType: section,
    Department: config.label,
    ...scope,
    CustomerName: clean(body.CustomerName || body.customerName) || 'Walk-in customer',
    CustomerEmail: customerEmail,
    CustomerPhone: clean(body.CustomerPhone || body.customerPhone || body.Phone || body.phone),
    Items: cart,
    ItemCount: cart.reduce((sum, item) => sum + item.Quantity, 0),
    Amount: total,
    GrossAmount: total,
    Currency: 'NGN',
    PaymentMethod: method,
    PaymentReference: paymentReference(body),
    PaymentStatus: method === 'Paystack Online' ? 'Pending' : 'Paid',
    Status: method === 'Paystack Online' ? 'Pending Payment' : 'Paid',
    InventoryStatus: method === 'Paystack Online' ? 'Pending Payment' : 'Deducted',
    CheckoutSource: lower(body.CheckoutSource || body.checkoutSource) === 'public store' ? 'Public Store' : 'Staff Point of Sale',
    SaleDate: clean(body.SaleDate || body.saleDate) || nowIso(),
    RecordedBy: clean(user.displayName || user.DisplayName || user.username || user.Username),
    RecordedByUsername: clean(user.username || user.Username),
    CreatedAt: nowIso(),
    UpdatedAt: nowIso()
  };
}

export function buildOrganizationCommerceJournal(sale = {}, settlement = {}) {
  const section = clean(sale.SaleType);
  const config = configFor(section);
  const gross = money(settlement.GrossAmount ?? sale.GrossAmount ?? sale.Amount);
  if (gross <= 0 || !clean(sale.SaleNo)) return null;
  const method = normalizeCommercePaymentMethod(settlement.PaymentMethod || sale.PaymentMethod);
  const online = method === 'Paystack Online';
  const suppliedFee = online ? Math.max(0, money(settlement.GatewayFee ?? sale.GatewayFee)) : 0;
  const suppliedNet = online ? money(settlement.NetAmount ?? sale.NetAmount) : gross;
  const net = online ? Math.min(gross, suppliedNet > 0 ? suppliedNet : money(gross - suppliedFee)) : gross;
  const fee = online ? Math.max(0, money(gross - net)) : 0;
  const department = config.label;
  const lines = [
    {
      AccountCode: paymentAccount(method),
      Debit: net,
      Credit: 0,
      Description: `${department} payment`,
      Department: department
    }
  ];
  if (fee > 0) {
    lines.push({
      AccountCode: '6060',
      Debit: fee,
      Credit: 0,
      Description: 'Online payment transaction charge',
      Department: department
    });
  }
  lines.push({
    AccountCode: config.revenueAccount,
    Debit: 0,
    Credit: gross,
    Description: `${department} sales revenue`,
    Department: department
  });
  return {
    JournalNo: `SYS-COM-${safeId(sale.SaleNo)}`,
    Date: clean(settlement.PaidAt || sale.PaidAt || sale.SaleDate) || nowIso(),
    Status: 'Posted',
    Description: `${department} sale - ${clean(sale.CustomerName) || 'Walk-in customer'}`,
    Reference: clean(settlement.Reference || sale.PaymentReference || sale.SaleNo),
    Source: 'Organisation Commerce Sale',
    SourceId: clean(sale.SaleNo),
    RecordedBy: clean(sale.RecordedBy) || 'System',
    Department: department,
    BranchId: clean(sale.BranchId) || 'main',
    OrganisationEdition: clean(sale.OrganisationEdition),
    Lines: lines,
    TotalDebit: gross,
    TotalCredit: gross,
    CreatedAt: clean(sale.CreatedAt) || nowIso(),
    UpdatedAt: nowIso()
  };
}

function inventoryWrites(section, cart, inventoryRows, timestamp) {
  return cart.map((line) => {
    const item = findInventoryItem(inventoryRows, section, line.ItemCode || line.ItemName);
    if (!item) throw error(`${line.ItemName} is no longer in inventory.`, 409);
    const available = Math.floor(money(item.Quantity));
    if (line.Quantity > available) {
      throw error(`${line.ItemName} has only ${available} available.`, 409);
    }
    return {
      collectionPath: configFor(section).inventory,
      documentId: clean(item.__id),
      data: {
        ...withoutMetadata(item),
        Quantity: available - line.Quantity,
        LastUpdated: timestamp,
        UpdatedAt: timestamp
      },
      updateTime: clean(item.__updateTime)
    };
  });
}

function movementWrites(section, sale, timestamp) {
  const config = configFor(section);
  return (sale.Items || []).map((line, index) => ({
    collectionPath: config.movements,
    documentId: safeId(`${sale.SaleNo}-${index + 1}`),
    data: {
      MovementNo: `${sale.SaleNo}-${index + 1}`,
      SaleNo: sale.SaleNo,
      BranchId: sale.BranchId,
      OrganisationEdition: sale.OrganisationEdition,
      SchoolSection: clean(sale.SchoolSection),
      Date: timestamp,
      ItemCode: clean(line.ItemCode),
      ItemName: clean(line.ItemName),
      MovementType: 'OUT',
      Quantity: Number(line.Quantity || 0),
      UnitPrice: money(line.UnitPrice),
      Amount: money(line.Amount),
      Reason: `Paid ${config.label} sale`,
      RecordedBy: clean(sale.RecordedBy) || 'System'
    },
    exists: false
  }));
}

async function existingSale(env, id) {
  return getDocument(env, COMMERCE_CONFIG.organizationStore.sales, safeId(id)).catch(() => null);
}

export async function listOrganizationCommerceSales(env, section, user) {
  configFor(section);
  return (await listCollection(env, COMMERCE_CONFIG.organizationStore.sales))
    .filter((row) => clean(row.SaleType) === section && visibleInScope(row, user))
    .sort((left, right) => clean(right.PaidAt || right.SaleDate).localeCompare(clean(left.PaidAt || left.SaleDate)))
    .slice(0, 200);
}

export async function listPublicOrganizationStoreItems(env, branchId = 'main', edition = 'faith') {
  const rows = await scopedInventory(env, 'organizationStore', { branchId, edition });
  return rows
    .filter((row) => clean(row.Active || 'YES').toUpperCase() !== 'NO')
    .map((row) => ({
      ItemCode: clean(row.ItemCode || row.__id),
      ItemName: clean(row.ItemName || row.__id),
      Category: clean(row.Category),
      Size: clean(row.Size),
      Unit: clean(row.Unit || 'pcs'),
      Price: money(row.Price ?? row.SalePrice),
      Quantity: Math.max(0, Math.floor(money(row.Quantity)))
    }))
    .filter((row) => row.ItemCode && row.ItemName && row.Price > 0 && row.Quantity > 0)
    .sort((left, right) => left.ItemName.localeCompare(right.ItemName));
}

export async function recordManualOrganizationCommerceSale(env, section, body = {}, user = {}, options = {}) {
  const method = normalizeCommercePaymentMethod(body.PaymentMethod || body.paymentMethod);
  if (method === 'Paystack Online') throw error('Use online payment initialization for a Paystack sale.');
  const id = saleId(body, section);
  const previous = await existingSale(env, id);
  if (previous) {
    if (lower(previous.PaymentStatus) === 'paid') {
      const emailDelivery = await scheduleCommerceEmail(env, previous, 'receipt', options);
      return { ok: true, replayed: true, message: 'This sale was already paid and recorded.', sale: previous, emailDelivery };
    }
    throw error('A sale with this request reference already exists.', 409);
  }
  const cart = await authoritativeCart(env, section, body, user);
  const expectedAmount = money(body.ExpectedAmount || body.expectedAmount);
  const currentAmount = money(cart.reduce((sum, item) => sum + item.Amount, 0));
  if (expectedAmount > 0 && currentAmount !== expectedAmount) {
    throw error('The current store total no longer matches the verified transfer amount. Review item prices before approving this transfer.', 409);
  }
  const sale = baseSale(section, body, user, cart, id, method);
  sale.PaidAt = nowIso();
  if (method !== 'Cash' && !sale.PaymentReference) {
    throw error('Enter the bank, transfer, or POS payment reference.');
  }
  const timestamp = nowIso();
  const inventory = await scopedInventory(env, section, user);
  const journal = buildOrganizationCommerceJournal(sale);
  await batchUpsertDocuments(env, [
    ...inventoryWrites(section, cart, inventory, timestamp),
    ...movementWrites(section, sale, timestamp),
    {
      collectionPath: COMMERCE_CONFIG.organizationStore.sales,
      documentId: safeId(id),
      data: sale,
      exists: false
    },
    {
      collectionPath: 'accountingJournals',
      documentId: safeId(journal.JournalNo),
      data: journal,
      exists: false
    }
  ]);
  const emailDelivery = await scheduleCommerceEmail(env, sale, 'receipt', options);
  const emailMessage = sale.CustomerEmail ? commerceEmailNotice(emailDelivery, 'Receipt email') : '';
  return { ok: true, message: `${configFor(section).label} payment received and sale recorded.${emailMessage}`, sale, journal, emailDelivery };
}

export async function initializeOnlineOrganizationCommerceSale(env, request, section, body = {}, user = {}, options = {}) {
  const paymentMethods = await publicPaymentMethods(env, clean(body.BranchId || user.branchId || 'main'));
  if (!paymentMethods.online.enabled) throw error('Automated online payment is disabled for this branch.', 503);
  if (!clean(env.PAYSTACK_SECRET_KEY)) throw error('Paystack is not configured for online sales.', 503);
  const email = lower(body.CustomerEmail || body.customerEmail || body.Email || body.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw error('Enter the customer email for the Paystack receipt and payment confirmation.');
  }
  const id = saleId(body, section);
  const previous = await existingSale(env, id);
  if (previous?.AuthorizationUrl && lower(previous.PaymentStatus) === 'pending') {
    const emailDelivery = await scheduleCommercePaymentLinkEmail(env, previous, options);
    return {
      ok: true,
      replayed: true,
      message: 'The existing secure payment link was returned.',
      sale: previous,
      authorizationUrl: previous.AuthorizationUrl,
      reference: previous.PaymentReference,
      emailDelivery
    };
  }
  if (previous && lower(previous.PaymentStatus) === 'paid') {
    const emailDelivery = await scheduleCommerceEmail(env, previous, 'receipt', options);
    return { ok: true, replayed: true, message: 'This sale is already paid.', sale: previous, emailDelivery };
  }
  const cart = await authoritativeCart(env, section, body, user);
  const sale = baseSale(section, body, user, cart, id, 'Paystack Online');
  const reference = safeId(`DYN-COM-${Date.now()}-${crypto.randomUUID().slice(0, 10).toUpperCase()}`);
  sale.PaymentReference = reference;
  const created = await createDocumentIfAbsent(
    env,
    COMMERCE_CONFIG.organizationStore.sales,
    safeId(id),
    sale
  );
  if (!created.created && created.document?.AuthorizationUrl) {
    const emailDelivery = await scheduleCommercePaymentLinkEmail(env, created.document, options);
    return {
      ok: true,
      replayed: true,
      message: 'The existing secure payment link was returned.',
      sale: created.document,
      authorizationUrl: created.document.AuthorizationUrl,
      reference: created.document.PaymentReference,
      emailDelivery
    };
  }
  const intent = {
    Reference: reference,
    PaymentType: 'OrganizationCommerce',
    SaleId: id,
    SaleType: section,
    BranchId: sale.BranchId,
    OrganisationEdition: sale.OrganisationEdition,
    Amount: sale.Amount,
    Currency: sale.Currency,
    Status: 'Pending',
    CreatedAt: nowIso()
  };
  await createDocumentIfAbsent(env, 'paymentIntents', safeId(reference), intent);
  const origin = new URL(request.url).origin;
  const publicCheckout = sale.CheckoutSource === 'Public Store';
  const callbackParams = new URLSearchParams({ reference, commerce: '1' });
  if (publicCheckout) {
    callbackParams.set('source', 'public-store');
    callbackParams.set('branch', sale.BranchId);
  }
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      amount: Math.round(sale.Amount * 100),
      currency: sale.Currency,
      reference,
      callback_url: `${origin}/payment-success.html?${callbackParams.toString()}`,
      metadata: {
        paymentType: 'OrganizationCommerce',
        commerceSaleId: id,
        commerceSection: section,
        branchId: sale.BranchId
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.status || !data.data?.authorization_url) {
    await upsertDocument(env, COMMERCE_CONFIG.organizationStore.sales, safeId(id), {
      ...sale,
      Status: 'Payment Initialization Failed',
      UpdatedAt: nowIso()
    });
    throw error(data.message || 'Could not start the secure Paystack payment.', 502);
  }
  const updated = {
    ...sale,
    AuthorizationUrl: data.data.authorization_url,
    PaymentReference: clean(data.data.reference || reference),
    UpdatedAt: nowIso()
  };
  await upsertDocument(env, COMMERCE_CONFIG.organizationStore.sales, safeId(id), updated);
  const emailDelivery = await scheduleCommercePaymentLinkEmail(env, updated, options);
  const paymentMessage = shouldEmailOrganizationCommercePaymentLink(updated)
    ? `Secure payment initialized.${commerceEmailNotice(emailDelivery, 'Payment link email')}`
    : 'Secure payment initialized. A receipt will be emailed after payment is confirmed.';
  return {
    ok: true,
    message: paymentMessage,
    sale: updated,
    authorizationUrl: updated.AuthorizationUrl,
    reference: updated.PaymentReference,
    emailDelivery
  };
}

export async function initializeDirectTransferOrganizationCommerceSale(env, section, body = {}, user = {}) {
  const email = lower(body.CustomerEmail || body.customerEmail || body.Email || body.email);
  if (!email || !validEmail(email)) throw error('Enter the customer email for the payment confirmation and receipt.');
  const id = saleId(body, section);
  const cart = await authoritativeCart(env, section, body, user);
  const sale = baseSale(section, body, user, cart, id, 'Bank Transfer');
  const reference = safeId(`DBT-${id}`);
  const result = await createDirectTransferRequest(env, {
    reference,
    context: 'organization-store',
    branchId: sale.BranchId,
    amount: sale.Amount,
    currency: sale.Currency,
    payerName: sale.CustomerName,
    payerEmail: sale.CustomerEmail,
    payerPhone: sale.CustomerPhone,
    evidence: body,
    payload: {
      Section: section,
      SaleRequestId: id,
      BranchId: sale.BranchId,
      OrganisationEdition: sale.OrganisationEdition,
      CustomerName: sale.CustomerName,
      CustomerEmail: sale.CustomerEmail,
      CustomerPhone: sale.CustomerPhone,
      Items: cart.map((item) => ({ Reference: item.InventoryDocumentId || item.ItemCode || item.ItemName, Quantity: item.Quantity })),
      CheckoutSource: sale.CheckoutSource
    }
  });
  return {
    ...result,
    sale: {
      ...sale,
      PaymentStatus: 'Awaiting Verification',
      Status: 'Awaiting Verification',
      InventoryStatus: 'Not deducted until verification',
      PaymentReference: reference
    }
  };
}

export async function finalizeOnlineOrganizationCommerceSale(env, intent = {}, settlement = {}, options = {}) {
  const id = clean(intent.SaleId || settlement.SaleId);
  const section = clean(intent.SaleType || settlement.SaleType);
  if (!id || !COMMERCE_CONFIG[section]) throw error('The commerce payment intent is incomplete.', 409);
  let sale = await existingSale(env, id);
  if (!sale) throw error('The pending commerce sale was not found.', 404);
  if (lower(sale.PaymentStatus) === 'paid') {
    const emailDelivery = await scheduleCommerceEmail(env, sale, 'receipt', options);
    return { ok: true, replayed: true, message: 'This online sale was already completed.', sale, emailDelivery };
  }
  const gross = money(settlement.GrossAmount);
  if (Math.abs(gross - money(sale.Amount)) > 0.01) {
    throw error('The verified online amount does not match the sale total.', 409);
  }
  const timestamp = clean(settlement.PaidAt) || nowIso();
  const paidSale = {
    ...withoutMetadata(sale),
    PaymentMethod: 'Paystack Online',
    PaymentStatus: 'Paid',
    Status: 'Paid',
    PaymentReference: clean(settlement.Reference || sale.PaymentReference),
    Gateway: 'Paystack',
    GrossAmount: gross,
    GatewayFee: Math.max(0, money(settlement.GatewayFee)),
    NetAmount: money(settlement.NetAmount),
    PaidAt: timestamp,
    UpdatedAt: nowIso(),
    InventoryStatus: 'Deducted'
  };
  const journal = buildOrganizationCommerceJournal(paidSale, settlement);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userScope = {
      branchId: paidSale.BranchId,
      edition: paidSale.OrganisationEdition
    };
    const inventory = await scopedInventory(env, section, userScope);
    let stockWrites;
    try {
      stockWrites = inventoryWrites(section, paidSale.Items || [], inventory, timestamp);
    } catch (stockError) {
      paidSale.InventoryStatus = 'Review Required';
      paidSale.InventoryIssue = stockError.message;
      stockWrites = [];
    }
    try {
      await batchUpsertDocuments(env, [
        ...stockWrites,
        ...(stockWrites.length ? movementWrites(section, paidSale, timestamp) : []),
        {
          collectionPath: COMMERCE_CONFIG.organizationStore.sales,
          documentId: safeId(id),
          data: paidSale,
          updateTime: clean(sale.__updateTime)
        },
        {
          collectionPath: 'accountingJournals',
          documentId: safeId(journal.JournalNo),
          data: journal,
          exists: false
        }
      ]);
      const emailDelivery = await scheduleCommerceEmail(env, paidSale, 'receipt', options);
      const receiptNotice = commerceEmailNotice(emailDelivery, 'Receipt email');
      return {
        ok: true,
        message: paidSale.InventoryStatus === 'Review Required'
          ? `Payment recorded. Inventory requires review: ${paidSale.InventoryIssue}.${receiptNotice}`
          : `Online payment received and sale completed.${receiptNotice}`,
        sale: paidSale,
        journal,
        emailDelivery
      };
    } catch (writeError) {
      if (![409, 412].includes(Number(writeError?.status))) throw writeError;
      sale = await existingSale(env, id);
      if (lower(sale?.PaymentStatus) === 'paid') {
        const emailDelivery = await scheduleCommerceEmail(env, sale, 'receipt', options);
        return { ok: true, replayed: true, message: 'This online sale was already completed.', sale, emailDelivery };
      }
      if (attempt === 0) continue;
      throw error('The sale changed while payment was being completed. Reload and reconcile it.', 409);
    }
  }
  throw error('The online sale could not be completed.', 500);
}
