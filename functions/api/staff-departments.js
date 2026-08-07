import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { listSchoolCollection, schoolSectionFor } from '../lib/school-scope.js';
import { getWalletCardAccount, recordWalletPurchase } from './backend.js';
import { escapeEmailHtml, sendConfiguredEmail } from '../lib/email-service.js';
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

function clean(value) { return String(value ?? '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function number(value) {
  const parsed = Number(String(value ?? 0).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function safeId(value) { return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140); }
function nowIso() { return new Date().toISOString(); }
function sameRef(a, b) { return lower(a).replace(/[^a-z0-9]/g, '') === lower(b).replace(/[^a-z0-9]/g, ''); }
function editionKey(value) {
  const edition = lower(value);
  if (['church', 'faith', 'religious'].includes(edition)) return 'faith';
  if (['organization', 'organisation', 'other'].includes(edition)) return 'organization';
  return edition || 'school';
}

const CONFIG = {
  clinic: { label: 'Clinic', inventory: 'clinicInventory', movements: 'clinicMovements', prefix: 'MED', category: 'Medical Supply', unit: 'pcs' },
  kitchen: { label: 'Kitchen', inventory: 'kitchenInventory', movements: 'kitchenMovements', prefix: 'KIT', category: 'Foodstuff', unit: 'kg' },
  restaurant: { label: 'Restaurant', inventory: 'restaurantInventory', movements: 'restaurantMovements', prefix: 'RST', category: 'Food & Beverage', unit: 'pcs' },
  tuckShop: { label: 'Tuck Shop', inventory: 'tuckShopInventory', movements: 'tuckShopMovements', prefix: 'TUK', category: 'General Item', unit: 'pcs' }
};

const IDEMPOTENT_ACTIONS = Object.freeze({
  'tuckShop:recordwalletpurchase': 'staff-department-wallet-purchase',
  'clinic:sendclinicreport': 'staff-department-clinic-report-email',
  'clinic:sendmarketlist': 'staff-department-clinic-market-list-email',
  'kitchen:sendmarketlist': 'staff-department-kitchen-market-list-email',
  'restaurant:sendmarketlist': 'staff-department-restaurant-market-list-email',
  'restaurant:recordsale': 'restaurant-record-sale'
});

export function staffDepartmentIdempotencyOptions(action, section, user = {}) {
  const scope = IDEMPOTENT_ACTIONS[`${clean(section)}:${lower(action)}`];
  if (!scope) return null;
  return {
    scope,
    actor: scope === 'restaurant-record-sale'
      ? clean(user.username)
      : [
          editionKey(user.edition || user.OrganisationEdition),
          lower(user.branchId || 'main'),
          lower(user.username || user.displayName || 'staff')
        ].join(':'),
    ttlMinutes: 30 * 24 * 60
  };
}

function scopeFields(user) {
  return {
    BranchId: clean(user.branchId) || 'main',
    OrganisationEdition: clean(user.edition || user.OrganisationEdition) || 'school',
    SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary')
  };
}

function visible(rows, user) {
  const section = lower(user.schoolSectionAccess || 'All');
  const branch = lower(user.branchId || '');
  const edition = editionKey(user.edition || user.OrganisationEdition);
  return (rows || []).filter((row) => {
    const branchAllowed = !branch || lower(row.BranchId || 'main') === branch;
    const rowEdition = clean(row.OrganisationEdition || row.OrganizationEdition);
    const editionAllowed = !rowEdition || editionKey(rowEdition) === edition;
    return branchAllowed && editionAllowed && (section === 'all' || schoolSectionFor(row) === section);
  });
}

function publicRows(rows) {
  return (rows || []).map(({ PasswordHash, WalletPinHash, ...row }) => row);
}

async function loadDepartment(env, section, user) {
  const config = CONFIG[section];
  const [inventory, movements, records, sales] = await Promise.all([
    listCollection(env, config.inventory),
    listCollection(env, config.movements),
    section === 'clinic' ? listCollection(env, 'clinicRecords') : Promise.resolve([]),
    section === 'restaurant'
      ? listOrganizationCommerceSales(env, section, user)
      : Promise.resolve([])
  ]);
  const scopedInventory = visible(inventory, user);
  return {
    ok: true,
    inventory: publicRows(scopedInventory),
    movements: publicRows(visible(movements, user).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date))).slice(0, 100)),
    records: publicRows(visible(records, user).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date))).slice(0, 100)),
    lowStock: publicRows(scopedInventory.filter((row) => number(row.ReorderLevel) > 0 && number(row.Quantity) <= number(row.ReorderLevel))),
    sales: publicRows(sales)
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
    Price: section === 'restaurant'
      ? Math.max(0, number(body.Price ?? body.SalePrice ?? existing.Price ?? existing.SalePrice))
      : number(existing.Price),
    Active: section === 'restaurant'
      ? (['no', 'false', '0', 'inactive'].includes(lower(body.Active ?? existing.Active ?? 'yes')) ? 'NO' : 'YES')
      : clean(existing.Active),
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
  const student = await findScopedStudent(env, user, body.AdmissionNo || body.AccountRef);
  if (!student) { const err = new Error('Find an enrolled student with a valid admission number before recording a clinic visit.'); err.status = 404; throw err; }
  const studentName = clean(student.DisplayName || student.StudentName || student.ApplicantName);
  const complaint = clean(body.Complaint);
  if (!complaint) { const err = new Error('Complaint is required.'); err.status = 400; throw err; }
  const recordId = clean(body.RecordId) || `CLN-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await upsertDocument(env, 'clinicRecords', safeId(recordId), {
    ...scopeFields(user),
    RecordId: recordId,
    RecordNo: recordId,
    Date: clean(body.Date) || nowIso().slice(0, 10),
    StudentName: studentName,
    AdmissionNo: studentReference(student),
    ClassName: clean(student.ClassName || student.ClassAdmitted),
    Complaint: complaint,
    Treatment: clean(body.Treatment),
    Disposition: clean(body.Disposition),
    Notes: clean(body.Notes),
    RecordedBy: user.displayName || user.username,
    UpdatedAt: nowIso()
  });
  return { ok: true, message: 'Clinic visit saved.' };
}

function studentReference(row) {
  return clean(row.AdmissionNo || row.AccountRef || row.ApplicationReference || row.Reference);
}

async function scopedStudents(env, user) {
  return visible(await listSchoolCollection(env, 'students', {
    branchId: user.branchId,
    schoolSectionAccess: user.schoolSectionAccess
  }), user);
}

async function findScopedStudent(env, user, reference, cardId = '') {
  const students = await scopedStudents(env, user);
  const card = clean(cardId).toUpperCase();
  const ref = clean(reference);
  return students.find((row) => (card && clean(row.WalletCardId).toUpperCase() === card)
    || (ref && [row.AdmissionNo, row.AccountRef, row.ApplicationReference, row.Reference].some((value) => sameRef(value, ref))));
}

async function lookupWallet(env, body, user) {
  const student = await findScopedStudent(env, user, body.AccountRef, body.WalletCardId);
  if (!student) { const err = new Error('No student wallet was found for that card or admission number.'); err.status = 404; throw err; }
  const result = await getWalletCardAccount(env, { AccountRef: studentReference(student) });
  return result.account;
}

async function postWalletPurchase(env, body, user) {
  const student = await findScopedStudent(env, user, body.AccountRef, body.WalletCardId);
  if (!student) { const err = new Error('No student wallet was found for that card or admission number.'); err.status = 404; throw err; }
  return recordWalletPurchase(env, {
    AccountRef: studentReference(student),
    Amount: body.Amount,
    Description: clean(body.Description) || 'Tuck shop purchase',
    WalletPin: body.WalletPin,
    Department: 'Tuck Shop',
    Terminal: 'Web Tuck Shop POS',
    RecordedBy: user.displayName || user.username,
    Reference: `TUK-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  });
}

function parentEmailFor(student) {
  return clean(student.ParentEmail || student.VerificationEmail || student.FatherEmail
    || student.MotherEmail || student.GuardianEmail || student.Email);
}

function clinicHistory(records, student) {
  const ref = studentReference(student);
  return records.filter((row) => sameRef(row.AdmissionNo || row.AccountRef, ref))
    .sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
}

async function prepareClinicReport(env, body, user) {
  const student = await findScopedStudent(env, user, body.AccountRef || body.AdmissionNo);
  if (!student) { const err = new Error('Student was not found in your branch and school section.'); err.status = 404; throw err; }
  const email = parentEmailFor(student);
  if (!email) { const err = new Error('No parent email is saved for this student.'); err.status = 400; throw err; }
  const records = clinicHistory(visible(await listCollection(env, 'clinicRecords'), user), student);
  return {
    AccountRef: studentReference(student),
    StudentName: clean(student.DisplayName || student.StudentName || student.ApplicantName),
    ClassName: clean(student.ClassName || student.ClassAdmitted),
    ParentEmail: email,
    RecordCount: records.length,
    Records: publicRows(records)
  };
}

async function auditMessage(env, type, section, user, data) {
  const id = `MSG-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await upsertDocument(env, 'departmentMessages', safeId(id), {
    ...scopeFields(user), MessageId: id, Type: type, Department: CONFIG[section].label,
    SentAt: nowIso(), SentBy: user.displayName || user.username, ...data
  });
}

async function sendClinicReport(env, body, user) {
  const report = await prepareClinicReport(env, body, user);
  const subject = clean(body.Subject) || `Clinic report - ${report.StudentName}`;
  const intro = clean(body.Message) || `Please find the clinic report for ${report.StudentName} below.`;
  const lines = report.Records.length ? report.Records.map((row, index) =>
    `${index + 1}. ${clean(row.Date)} - ${clean(row.Complaint)}; Treatment: ${clean(row.Treatment) || 'Not recorded'}; Disposition: ${clean(row.Disposition) || 'Not recorded'}${clean(row.Notes) ? `; Notes: ${clean(row.Notes)}` : ''}`
  ) : ['No clinic visits have been recorded.'];
  const htmlRows = report.Records.length ? report.Records.map((row) => `<tr><td>${escapeEmailHtml(row.Date)}</td><td>${escapeEmailHtml(row.Complaint)}</td><td>${escapeEmailHtml(row.Treatment || 'Not recorded')}</td><td>${escapeEmailHtml(row.Disposition || 'Not recorded')}</td><td>${escapeEmailHtml(row.Notes)}</td></tr>`).join('') : '<tr><td colspan="5">No clinic visits have been recorded.</td></tr>';
  await sendConfiguredEmail(env, {
    toEmail: report.ParentEmail, toName: `Parent of ${report.StudentName}`, subject,
    textContent: `Dear Parent/Guardian,\n\n${intro}\n\nStudent: ${report.StudentName}\nClass: ${report.ClassName}\n\n${lines.join('\n')}\n\nSent by ${user.displayName || user.username}`,
    htmlContent: `<div style="font-family:Arial,sans-serif"><p>Dear Parent/Guardian,</p><p>${escapeEmailHtml(intro)}</p><p><strong>Student:</strong> ${escapeEmailHtml(report.StudentName)}<br><strong>Class:</strong> ${escapeEmailHtml(report.ClassName)}</p><table style="border-collapse:collapse;width:100%" border="1" cellpadding="7"><thead><tr><th>Date</th><th>Complaint</th><th>Treatment</th><th>Disposition</th><th>Notes</th></tr></thead><tbody>${htmlRows}</tbody></table><p>Sent by ${escapeEmailHtml(user.displayName || user.username)}</p></div>`,
    branchId: user.branchId || user.BranchId
  });
  await auditMessage(env, 'Clinic Parent Report', 'clinic', user, { AccountRef: report.AccountRef, StudentName: report.StudentName, RecipientEmail: report.ParentEmail, Subject: subject, RecordCount: report.RecordCount });
  return report;
}

function marketItems(body) {
  const rows = Array.isArray(body.Items) ? body.Items : [];
  const items = rows.slice(0, 100).map((row) => ({
    ItemName: clean(row.ItemName), Unit: clean(row.Unit), OrderQuantity: number(row.OrderQuantity)
  })).filter((row) => row.ItemName && row.OrderQuantity > 0);
  if (!items.length) { const err = new Error('Select at least one item and enter an order quantity.'); err.status = 400; throw err; }
  return items;
}

async function sendMarketList(env, section, body, user) {
  const supplierEmail = clean(body.SupplierEmail);
  const supplierName = clean(body.SupplierName) || 'Supplier';
  const subject = clean(body.Subject) || `${CONFIG[section].label} market list`;
  const items = marketItems(body);
  const lines = items.map((row, index) => `${index + 1}. ${row.ItemName} - ${row.OrderQuantity} ${row.Unit || 'units'}`);
  const htmlRows = items.map((row, index) => `<tr><td>${index + 1}</td><td>${escapeEmailHtml(row.ItemName)}</td><td>${row.OrderQuantity}</td><td>${escapeEmailHtml(row.Unit || 'units')}</td></tr>`).join('');
  await sendConfiguredEmail(env, {
    toEmail: supplierEmail, toName: supplierName, subject,
    textContent: `Dear ${supplierName},\n\nKindly supply the following items for ${CONFIG[section].label}:\n\n${lines.join('\n')}\n\nRequested by ${user.displayName || user.username}`,
    htmlContent: `<div style="font-family:Arial,sans-serif"><p>Dear ${escapeEmailHtml(supplierName)},</p><p>Kindly supply the following items for <strong>${CONFIG[section].label}</strong>:</p><table style="border-collapse:collapse;width:100%" border="1" cellpadding="7"><thead><tr><th>S/No.</th><th>Item</th><th>Order quantity</th><th>Unit</th></tr></thead><tbody>${htmlRows}</tbody></table><p>Requested by ${escapeEmailHtml(user.displayName || user.username)}</p></div>`,
    branchId: user.branchId || user.BranchId
  });
  await auditMessage(env, 'Supplier Market List', section, user, { RecipientEmail: supplierEmail, RecipientName: supplierName, Subject: subject, ItemCount: items.length, Items: items });
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 512 * 1024 });
    const section = clean(body.section);
    if (!CONFIG[section] || !(user.allowedSections || []).includes(section)) {
      const err = new Error('This staff account is not allowed to manage that department.'); err.status = 403; throw err;
    }
    const action = lower(body.action || 'list');
    if (action === 'recordsale' && section !== 'restaurant') {
      const err = new Error('Direct commerce payments are available only in the Restaurant workspace.');
      err.status = 403;
      throw err;
    }
    const idempotencyOptions = staffDepartmentIdempotencyOptions(action, section, user);
    if (idempotencyOptions) {
      idempotency = await beginIdempotentRequest(env, request, body, {
        ...idempotencyOptions
      });
      if (idempotency.replay) {
        return Response.json(idempotency.response, {
          status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
          headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
        });
      }
    }
    let actionResult = null;
    if (action === 'saveitem') await saveInventory(env, section, body, user);
    else if (action === 'recordmovement') await recordMovement(env, section, body, user);
    else if (action === 'saveclinicrecord' && section === 'clinic') await saveClinicRecord(env, body, user);
    else if (action === 'lookupwallet' && section === 'tuckShop') actionResult = { walletAccount: await lookupWallet(env, body, user) };
    else if (action === 'recordwalletpurchase' && section === 'tuckShop') {
      const purchase = await postWalletPurchase(env, body, user);
      actionResult = { walletAccount: purchase.account, walletPurchase: purchase.ledger };
    }
    else if (action === 'prepareclinicreport' && section === 'clinic') actionResult = { clinicReport: await prepareClinicReport(env, body, user) };
    else if (action === 'sendclinicreport' && section === 'clinic') actionResult = { clinicReport: await sendClinicReport(env, body, user) };
    else if (action === 'sendmarketlist' && ['clinic', 'kitchen', 'restaurant'].includes(section)) await sendMarketList(env, section, body, user);
    else if (action === 'recordsale' && section === 'restaurant') {
      const method = normalizeCommercePaymentMethod(body.PaymentMethod);
      actionResult = method === 'Paystack Online'
        ? await initializeOnlineOrganizationCommerceSale(env, request, section, body, user)
        : await recordManualOrganizationCommerceSale(env, section, body, user);
    }
    else if (action !== 'list') { const err = new Error('Choose a valid department action.'); err.status = 400; throw err; }
    if (action === 'recordsale') {
      await completeIdempotentRequest(env, idempotency, actionResult, 200);
      return Response.json(actionResult, { headers: { 'Cache-Control': 'no-store' } });
    }
    const data = await loadDepartment(env, section, user);
    Object.assign(data, actionResult || {});
    if (action !== 'list') data.message = ({
      saveitem: `${CONFIG[section].label} inventory item saved.`,
      recordmovement: `${CONFIG[section].label} stock movement recorded.`,
      saveclinicrecord: 'Clinic visit saved.',
      lookupwallet: 'Wallet account loaded.',
      recordwalletpurchase: 'Wallet purchase recorded and posted to Finance and Accounting.',
      prepareclinicreport: 'Clinic report prepared for review.',
      sendclinicreport: 'Clinic report sent to the parent email.',
      sendmarketlist: 'Market list sent to the supplier.',
      recordsale: actionResult?.message || 'Restaurant payment recorded.'
    })[action] || 'Department action completed.';
    if (idempotencyOptions) await completeIdempotentRequest(env, idempotency, data, 200);
    return Response.json(data);
  } catch (err) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, err);
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
