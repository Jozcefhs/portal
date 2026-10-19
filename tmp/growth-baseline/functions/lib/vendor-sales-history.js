import {getDocument, queryCollection} from './firestore.js';
import {COMMERCE_CONFIG} from './organization-commerce.js';
import {amount, clean, lower, fail, settlementScope, visible} from './vendor-settlement-rules.js';

// Owner snapshots, not today's stock ownership, determine historical access.
// Read lazily, in indexed slices; never scan a branch's entire sales collection.
export async function recentVendorSales(env, user, section, vendors) {
  const scope = settlementScope(user), sales = new Map();
  if (vendors.length > 20) fail('Recent sales supports up to 20 linked vendors. Ask Accounts for a vendor statement.',413);
  for (const vendor of vendors) {
    let cursor = null, count = 0;
    for (let page = 0; page < 10; page++) {
      const entries = await queryCollection(env,'vendorEarnings',{
        filters:[{field:'ScopeKey',op:'==',value:scope.ScopeKey},{field:'VendorId',op:'==',value:vendor.VendorId},
          {field:'Type',op:'in',value:['Sale','Vendor collected sale']}],
        orderBy:[{field:'Date',direction:'DESCENDING'},{field:'__name__',direction:'DESCENDING'}],limit:30,
        ...(cursor ? {startAfterName:cursor.__name,startAfterFieldValue:cursor.Date} : {})
      });
      const own = entries.filter(entry => visible(entry,scope) && lower(entry.BranchId) === scope.BranchId
        && entry.OrganisationEdition === scope.OrganisationEdition && entry.VendorId === vendor.VendorId
        && ['Sale','Vendor collected sale'].includes(entry.Type)
        && (scope.OrganisationEdition !== 'school' || lower(entry.SchoolSection) === lower(vendor.SchoolSection))
        && /^[a-zA-Z0-9_-]{1,120}$/.test(clean(entry.SaleNo)));
      const receipts = await Promise.all(own.map(entry => getDocument(env,COMMERCE_CONFIG[section].sales,entry.SaleNo)));
      for (let i = 0; i < own.length; i++) {
        const entry = own[i], receipt = receipts[i];
        if (!receipt || receipt.SaleNo !== entry.SaleNo || receipt.SaleType !== section || lower(receipt.BranchId) !== scope.BranchId
          || receipt.OrganisationEdition !== scope.OrganisationEdition || lower(receipt.PaymentStatus) !== 'paid') continue;
        const items = (entry.Items || []).map(item => ({ItemName:clean(item.ItemName),Quantity:item.Quantity,
          UnitPrice:item.UnitPrice,Amount:item.Amount}));
        if (!items.length || !Number.isSafeInteger(entry.GrossCents) || entry.GrossCents <= 0) continue;
        const sale = sales.get(entry.SaleNo) || {SaleNo:entry.SaleNo,SaleDate:clean(receipt.SaleDate || entry.SaleDate || entry.Date),SortDate:clean(entry.Date),
          CustomerName:clean(receipt.CustomerName),PaymentMethod:clean(receipt.PaymentMethod || entry.OriginalPaymentMethod),
          PaymentStatus:'Paid',CollectionMode:clean(entry.CollectionMode || 'School collected'),AmountCents:0,Items:[],vendors:new Set()};
        if (sale.vendors.has(vendor.VendorId)) continue;
        sale.vendors.add(vendor.VendorId); sale.AmountCents += entry.GrossCents; sale.Items.push(...items);
        sales.set(entry.SaleNo,sale); count++;
      }
      if (count >= 30 || entries.length < 30) break;
      cursor = entries.at(-1);
      if (!cursor.__name || page === 9) fail('This sales history needs a vendor statement. No partial history was shown.',413);
    }
  }
  return [...sales.values()].sort((a,b) => b.SortDate.localeCompare(a.SortDate) || b.SaleNo.localeCompare(a.SaleNo))
    .slice(0,30).map(({AmountCents,vendors,SortDate,...sale}) => ({...sale,Amount:amount(AmountCents)}));
}

// Committed opening adjustments are vendor-level summaries, never old receipts
// inferred from today's stock owner or new sales to be posted again.
export async function recentVendorHistoricalOpenings(env, user, vendors) {
  const scope = settlementScope(user), openings = [];
  if (vendors.length > 20) fail('Recent sales supports up to 20 linked vendors. Ask Accounts for a vendor statement.',413);
  for (const vendor of vendors) {
    const entries = await queryCollection(env,'vendorEarnings',{
      filters:[{field:'ScopeKey',op:'==',value:scope.ScopeKey},{field:'VendorId',op:'==',value:vendor.VendorId},
        {field:'Type',op:'==',value:'Reviewed historical opening'}],
      orderBy:[{field:'Date',direction:'DESCENDING'},{field:'__name__',direction:'DESCENDING'}],limit:30
    });
    for (const entry of entries) {
      if (!visible(entry,scope) || lower(entry.BranchId) !== scope.BranchId || entry.OrganisationEdition !== scope.OrganisationEdition
        || entry.VendorId !== vendor.VendorId || entry.Type !== 'Reviewed historical opening'
        || scope.OrganisationEdition === 'school' && lower(entry.SchoolSection) !== lower(vendor.SchoolSection)) continue;
      const values = ['GrossCents','RefundCents','ChargeCents','PaidCents','NetCents','OutstandingCents'].map(key => entry[key]);
      const [gross,refunds,charge,paid,net,outstanding] = values;
      if (values.some(value => !Number.isSafeInteger(value) || value < 0) || net !== gross - refunds - charge || outstanding !== net - paid
        || !clean(entry.OpeningReference) || !/^\d{4}-\d{2}-\d{2}$/.test(clean(entry.Date)))
        fail('A historical opening needs Accounts review. No incomplete history was shown.',409);
      openings.push({VendorName:clean(vendor.Name) || 'Vendor',Reference:clean(entry.OpeningReference),Date:clean(entry.Date),
        HistoricalSales:amount(gross),Refunds:amount(refunds),Deductions:amount(charge),PreviouslyPaid:amount(paid),
        OpeningAmountOwed:amount(outstanding),SortId:clean(entry.__name || entry.EntryId)});
    }
  }
  return openings.sort((a,b) => b.Date.localeCompare(a.Date) || b.SortId.localeCompare(a.SortId))
    .slice(0,30).map(({SortId,...opening}) => opening);
}
