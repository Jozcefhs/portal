import { getDocument, batchCommitDocuments, queryCollectionPages } from './firestore.js';
import { procurementVendorOwned, procurementMovementBalance } from './procurement-inventory-guard.js';
import { createRow, reviseRow, businessReference, publicRow } from './commerce-documents.js';

const db = { getDocument, batchCommitDocuments, queryCollectionPages };
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function field(value, limit = 240) {
  const text = String(value ?? '').trim();
  if (text.length > limit) fail('Shorten the information entered.');
  return text;
}
function kobo(value) {
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 1e12 || Math.abs(cents - amount * 100) > 0.0001) fail('Enter a positive amount with up to two decimal places.');
  return cents;
}
function posting(ref, meta, description, lines) {
  const total = lines.reduce((s,l)=>s + Math.round(l.Debit * 100),0) / 100;
  return createRow('accountingJournals', ref, {...meta, JournalNo:ref, Source:'Catering', SourceId:meta.OrderNo, Reference:ref,
    Department:'Restaurant', Date:meta.UpdatedAt, CreatedAt:meta.UpdatedAt, Status:'Posted', Description:description, Lines:lines, TotalDebit:total, TotalCredit:total});
}
const debit = (AccountCode, Debit) => ({AccountCode, Debit, Credit:0});
const credit = (AccountCode, Credit) => ({AccountCode, Debit:0, Credit});

export async function cateringOrders(env, user, input, io = db) {
  if (user.edition !== 'organization' || !user.allowedSections?.includes('restaurant')) fail('Catering Operations access required.',403);
  const branch = businessReference(user.branchId,'working branch');
  if (branch.toLowerCase()==='all') fail('Select a working branch.');
  const orders = 'cateringBranches/'+branch+'/orders';
  const receipts = 'cateringBranches/'+branch+'/receipts';
  if (input.Operation === 'list') {
    const rows = await io.queryCollectionPages(env,orders,{});
    return {orders:rows.map(publicRow).sort((a,b)=>a.ServiceAt.localeCompare(b.ServiceAt))};
  }
  if (user.subscriptionReadOnly || user.subscriptionActive === false) fail('An active subscription is required.',403);
  const id = businessReference(input.OrderNo,'order reference');
  const saved = await io.getDocument(env,orders,id);
  const now = new Date().toISOString();
  const meta = {BranchId:branch, OrganisationEdition:'organization', OrderNo:id, RecordedBy:user.username, UpdatedAt:now};
  const prefix = 'CAT-'+branch.length+'-'+branch+'-';
  async function menuItem(id) {
    if (typeof id !== 'string' || !id || id.includes('/')) fail('Select a menu item.');
    const row = await io.getDocument(env,'restaurantInventory',id);
    if (!row || (row.BranchId || 'main')!==branch || (row.OrganisationEdition && row.OrganisationEdition!=='organization') ||
        procurementVendorOwned(row) || row.Active===false || String(row.Active).toUpperCase()==='NO') fail('Choose an available branch-owned menu item.',409);
    return row;
  }
  if (input.Operation === 'create') {
    if (saved) return {order:publicRow(saved)};
    const kind = input.Kind;
    const guests = Number(input.Guests || 0);
    if (!['Supply order','Event catering'].includes(kind) || !field(input.CustomerName) || !field(input.Contact)) fail('Enter the order type, customer and contact.');
    if (!['Collection','Delivery','On-site service'].includes(input.Fulfilment) || (input.Fulfilment!=='Collection' && !field(input.Venue))) fail('Choose a fulfilment method and enter the delivery or event address.');
    if (kind==='Event catering' && (!Number.isSafeInteger(guests) || guests<1 || guests>100000 || !field(input.Venue))) fail('Enter the event venue and guest count.');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.ServiceAt) || !Number.isFinite(Date.parse(input.ServiceAt))) fail('Choose a valid service date and local time.');
    if (!Array.isArray(input.Items) || !input.Items.length || input.Items.length>30 || new Set(input.Items.map(l=>l.InventoryDocumentId)).size!==input.Items.length) fail('Choose 1 to 30 different menu items.');
    const items = await Promise.all(input.Items.map(async l=>{
      const item = await menuItem(l.InventoryDocumentId);
      const qty = Number(l.Quantity);
      if (!Number.isSafeInteger(qty) || qty<1 || qty>1000000) fail('Enter a whole number of servings or packages.');
      const price = kobo(item.SalePrice ?? item.Price);
      const lineTotal = price * qty;
      if (!Number.isSafeInteger(lineTotal)) fail('Line total is too large.');
      return {InventoryDocumentId:item.__id,ItemName:item.ItemName,Unit:item.Unit || 'portion',Quantity:qty,UnitPrice:price/100,Amount:lineTotal/100};
    }));
    const total = items.reduce((sum,l)=>sum+kobo(l.Amount),0);
    if (!Number.isSafeInteger(total) || total>1e12) fail('Order total is too large.');
    const order = {...meta, CreatedAt:now, Kind:kind,CustomerName:field(input.CustomerName),Contact:field(input.Contact),
      Guests:kind==='Event catering'?guests:0,Venue:field(input.Venue), ServiceAt:input.ServiceAt, Fulfilment:input.Fulfilment,
      Notes:field(input.Notes,1500),Items:items,Amount:total/100,Paid:0,Balance:total/100,Status:'Confirmed'};
    await io.batchCommitDocuments(env,[createRow(orders,id,order)]);
    return {order};
  }
  if (!saved) fail('Order not found in this branch.',404);
  const saleId = prefix+id;
  const writes = [];
  let changes;
  if (input.Operation==='payment') {
    const ref = businessReference(input.Reference,'receipt reference').toUpperCase();
    const amount = kobo(input.Amount)/100;
    const prior = await io.getDocument(env,receipts,ref);
    if (prior) {
      if (prior.OrderNo!==id || prior.Amount!==amount || prior.Method!==input.Method) fail('Receipt reference already in use.',409);
      return {order:publicRow(saved)};
    }
    if (!['Cash','Bank'].includes(input.Method) || saved.Status==='Cancelled' || amount>saved.Balance) fail('Choose cash or bank and enter an amount within the balance.');
    const paid = (Math.round(saved.Paid*100)+Math.round(amount*100))/100;
    const due = (Math.round(saved.Amount*100)-Math.round(paid*100))/100;
    changes = {Paid:paid,Balance:due};
    writes.push(createRow(receipts,ref,{...meta,Reference:ref,Amount:amount,Method:input.Method}),
      posting('PAY-'+prefix+ref,meta,'Customer payment for '+id,[debit(input.Method==='Cash'?'1010':'1020',amount),credit(saved.Status==='Fulfilled'?'1110':'2110',amount)]));
    if (saved.Status==='Fulfilled') {
      const sale = await io.getDocument(env,'organizationCommerceSales',saleId);
      writes.push(reviseRow('organizationCommerceSales',sale,{...changes,PaymentStatus:due?'Part paid':'Paid',UpdatedAt:now}));
    }
  } else if (input.Operation==='progress') {
    const next = input.Status;
    if (saved.Status===next) return {order:publicRow(saved)};
    const allowed = {Confirmed:['Preparing','Cancelled'],Preparing:['Ready','Cancelled'],Ready:['Fulfilled','Cancelled']};
    if (!allowed[saved.Status]?.includes(next) || (next==='Cancelled' && saved.Paid>0)) fail('This change is unavailable at the current stage or while a deposit is held.',409);
    changes = {Status:next,[next+'At']:now,[next+'By']:user.username};
    if (next==='Fulfilled') {
      for (const [i,line] of saved.Items.entries()) {
        const item = await menuItem(line.InventoryDocumentId);
        const remaining = procurementMovementBalance(item,'OUT',line.Quantity);
        if (!Number.isFinite(remaining) || remaining<0) fail('Insufficient stock for '+line.ItemName+'.',409);
        writes.push(reviseRow('restaurantInventory',item,{Quantity:remaining,UpdatedAt:now}),
          createRow('restaurantMovements',saleId+'-'+i,{...meta,MovementNo:saleId+'-'+i,SaleNo:saleId,InventoryDocumentId:item.__id,ItemName:item.ItemName,Unit:item.Unit || 'portion',Date:now,MovementType:'OUT',Quantity:line.Quantity,Reason:'Catering order fulfilled'}));
      }
      const lines = [];
      if (saved.Paid) lines.push(debit('2110',saved.Paid));
      if (saved.Balance) lines.push(debit('1110',saved.Balance));
      lines.push(credit('4130',saved.Amount));
      writes.push(createRow('organizationCommerceSales',saleId,{...publicRow(saved),...meta,...changes,SaleNo:saleId, SaleDate:now,
        Department:'Restaurant',SaleType:'restaurant',InventoryStatus:'Deducted',GrossAmount:saved.Amount,Currency:'NGN',
        PaymentStatus:saved.Balance?(saved.Paid?'Part paid':'Unpaid'):'Paid',CheckoutSource:'Catering order'}),
        posting(saleId,meta,'Catering order fulfilled for '+saved.CustomerName,lines));
    }
  } else fail('Choose a valid catering action.');
  writes.push(reviseRow(orders,saved,{...changes,UpdatedAt:now}));
  await io.batchCommitDocuments(env,writes);
  return {order:{...publicRow(saved),...changes,UpdatedAt:now}};
}
