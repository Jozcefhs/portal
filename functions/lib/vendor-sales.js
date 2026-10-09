import { getDocument, listCollection } from './firestore.js';
import { COMMERCE_CONFIG, previewOrganizationCommerceSale, recordManualOrganizationCommerceSale } from './organization-commerce.js';
import { clean, lower, fail, settlementScope } from './vendor-settlement-rules.js';
import { linkedSalesVendors, restrictVendorInventory, vendorCustomerScope } from './vendor-sales-access.js';
import { searchTuckShopCustomers, canonicalTuckShopStudentReference } from './school-tuck-shop.js';

const publicAccount = account => Object.fromEntries(['AccountRef', 'DisplayName', 'ClassName', 'BranchId', 'SchoolSection', 'WalletCardStatus']
  .map(key => [key, account[key] || '']));
export function publicVendorSale(sale = {}) {
  return { SaleNo:sale.SaleNo, SaleType:sale.SaleType, SaleDate:sale.SaleDate, Amount:sale.Amount,
    PaymentMethod:sale.PaymentMethod, PaymentStatus:sale.PaymentStatus, CollectionMode:sale.CollectionMode || 'School collected',
    CustomerName:sale.CustomerName, Items:(sale.Items || []).map(item => ({ItemName:item.ItemName, Quantity:item.Quantity,
      UnitPrice:item.UnitPrice, Amount:item.Amount})), Currency:sale.Currency || 'NGN' };
}
async function saleReference(user, value) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(clean(value))) fail('Use a valid checkout reference.');
  const text = JSON.stringify([settlementScope(user).ScopeKey, lower(user.username), value]);
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return `VSAL-${[...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('')}`;
}
function saleBody(body, user, saleId) {
  if (!Array.isArray(body.Items) || !body.Items.length || body.Items.length > 50) fail('Choose between 1 and 50 product lines.');
  const Items = body.Items.map(item => {
    const Quantity = Number(item.Quantity);
    if (!clean(item.Reference) || !Number.isSafeInteger(Quantity) || Quantity < 1) fail('Choose exact stock references and positive whole-number quantities.');
    return {Reference:clean(item.Reference), Quantity};
  });
  return {Items, SaleRequestId:saleId, CustomerName:clean(body.CustomerName).slice(0,160) || 'Walk-in customer',
    CustomerRef:clean(body.AccountRef), PaymentMethod:clean(body.PaymentMethod), PaymentReference:clean(body.PaymentReference).slice(0,200),
    CollectionMode:body.CollectionMode === 'Vendor collected' ? 'Vendor collected' : 'School collected',
    ExpectedAmount:Number(body.ExpectedAmount), RecordedBy:user.displayName || user.username};
}
export async function handleVendorSalesAction(env, user, body) {
  const scope = settlementScope(user), section = clean(body.Section || (scope.OrganisationEdition === 'school' ? 'tuckShop' : 'organizationStore'));
  const vendors = await linkedSalesVendors(env,user,section);
  if (body.action === 'salesBootstrap') {
    const rows = (await listCollection(env,COMMERCE_CONFIG[section].inventory)).filter(row => lower(row.BranchId || 'main') === scope.BranchId
      && (!row.OrganisationEdition || row.OrganisationEdition === scope.OrganisationEdition)
      && (section !== 'organizationStore' || row.StoreType === 'Organisation Store'));
    const own = await restrictVendorInventory(env,user,section,rows);
    const settings = await getDocument(env,'settings',`vendor-settlement-${scope.ScopeKey}`) || {};
    return {ok:true, Section:section, products:own.map(row => ({InventoryId:row.__id, ItemCode:row.ItemCode,
      ItemName:row.ItemName, Category:row.Category, Unit:row.Unit || 'pcs', Quantity:row.Quantity,
      Price:row.Price ?? row.SalePrice, VendorId:row.VendorId, Active:row.Active || 'YES'})),
      vendors:vendors.map(v => ({VendorId:v.VendorId,Name:v.Name})),
      sellingEnabled:settings.Enabled === true && settings.AccountingConfirmed === true
        && user.subscriptionActive !== false && user.subscriptionReadOnly !== true && vendors.length > 0,
      message:vendors.length ? 'Only products belonging to your linked vendor accounts are shown.'
        : 'No active selling vendor is linked to this login in this branch/section. Ask Accounts to link the username and enable counter sales.'};
  }
  if (!vendors.length) fail('No active selling vendor is linked to this login in this branch/section.',403);
  if (user.subscriptionActive === false || user.subscriptionReadOnly === true) fail('Selling is disabled for this subscription.',403);
  if (body.action === 'vendorCustomerSearch' || body.action === 'vendorWalletLookup') {
    if (section !== 'tuckShop') fail('Student wallet payments are available only in the school Tuck Shop.',403);
    const actor = vendorCustomerScope(user,vendors);
    if (body.action === 'vendorCustomerSearch') return searchTuckShopCustomers(env,actor,{
      CustomerType:clean(body.CustomerType || 'Student'),Query:clean(body.Query).slice(0,120)});
    const {getWalletCardAccount} = await import('../api/backend.js');
    const lookup = {AccountRef:clean(body.AccountRef),WalletCardId:clean(body.WalletCardId),
      UserBranchId:actor.branchId,UserSchoolSectionAccess:actor.schoolSectionAccess};
    if (!lookup.AccountRef && !lookup.WalletCardId) fail('Enter a card ID or admission number, or select a student from Find student.');
    let result;
    try {result = await getWalletCardAccount(env,lookup);}
    catch (error) {
      if (Number(error.status) !== 404 || lookup.WalletCardId) throw error;
      lookup.AccountRef = await canonicalTuckShopStudentReference(env,actor,lookup.AccountRef);
      result = await getWalletCardAccount(env,lookup);
    }
    return {ok:true,account:publicAccount(result.account)};
  }
  const payload = saleBody(body,user,body.action === 'previewVendorSale' ? '' : await saleReference(user,body.SaleRequestId));
  if (body.action === 'previewVendorSale') {
    const result = await previewOrganizationCommerceSale(env,section,payload,user);
    if (payload.CollectionMode === 'Vendor collected' && new Set(result.items.map(item => item.VendorId)).size !== 1)
      fail('Direct vendor collection requires products from one vendor.');
    return {ok:true,Amount:result.Amount,items:publicVendorSale({Items:result.items}).Items};
  }
  if (body.Confirmed !== true || !Number.isFinite(payload.ExpectedAmount) || payload.ExpectedAmount <= 0)
    fail('Preview the cart and confirm the payment before completing this sale.');
  const input = JSON.stringify([section,payload.Items,payload.CustomerRef,clean(body.WalletCardId),payload.CustomerName,
    body.action,payload.PaymentMethod,payload.CollectionMode,payload.PaymentReference,payload.ExpectedAmount]);
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
  payload.VendorCheckoutDigest = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
  if (body.action === 'recordVendorWalletPurchase') {
    if (section !== 'tuckShop' || payload.CollectionMode === 'Vendor collected') fail('Student wallets are school-collected Tuck Shop payments.',403);
    const actor = vendorCustomerScope(user,vendors);
    const {recordWalletPurchase} = await import('../api/backend.js');
    const result = await recordWalletPurchase(env,{Items:payload.Items,SaleRequestId:payload.SaleRequestId,
      Amount:payload.ExpectedAmount,AccountRef:clean(body.AccountRef),WalletCardId:clean(body.WalletCardId),WalletPin:clean(body.WalletPin),
      UserBranchId:actor.branchId,UserSchoolSectionAccess:actor.schoolSectionAccess,Department:'Tuck Shop',
      Terminal:'Vendor Tuck Shop POS',RecordedBy:user.displayName || user.username}, {vendorUser:user,vendorCheckoutDigest:payload.VendorCheckoutDigest});
    return {ok:true,replayed:result.replayed === true,message:result.message,sale:publicVendorSale(result.sale)};
  }
  if (body.action !== 'recordVendorSale') fail('Unknown vendor selling action.');
  const result = await recordManualOrganizationCommerceSale(env,section,payload,user);
  return {ok:true,replayed:result.replayed === true,message:result.message,sale:publicVendorSale(result.sale)};
}
