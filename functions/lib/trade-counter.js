import { procurementManagedItem, procurementMovementBalance, procurementVendorOwned } from './procurement-inventory-guard.js';
import { getDocument, batchCommitDocuments, queryCollectionPages } from './firestore.js';

const db = { getDocument, batchCommitDocuments, queryCollectionPages };
const clean = value => String(value ?? '').trim();
const invalid = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
import {publicRow as plain,createRow as add,reviseRow as update,businessReference as identifier} from './commerce-documents.js';
function positive(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) invalid('Enter a positive ' + label + '.');
  return n;
}
export function tradeItemSetup(body, existing) {
  const mode = clean(body.TradeMode ?? existing?.TradeMode) || 'standard';
  if (!['standard','cable','serial'].includes(mode)) invalid('Choose a valid stock mode.');
  const metreStock = /^(m|metres?|meters?)$/i.test(clean(existing?.Unit));
  if (!(mode === 'cable' && metreStock) && (existing?.TradeMode === 'cable') !== (mode === 'cable') && existing && Number(existing.Quantity)) invalid('Use a new metre-based item code for existing stock with a different unit.');
  if (mode === 'cable') return { TradeMode: mode, CoilMetres: positive(body.CoilMetres ?? existing?.CoilMetres, 'coil length'), Unit: metreStock ? existing.Unit : 'm' };
  const days = Number(body.WarrantyDays ?? existing?.WarrantyDays ?? 365);
  if (mode === 'serial' && (!Number.isInteger(days) || days < 1 || days > 3650)) invalid('Warranty must be 1 to 3650 days.');
  return { TradeMode: mode, ...(mode === 'serial' ? { WarrantyDays: days } : {}) };
}
export function tradeLine(item, input) {
  const qty = positive(input.Quantity, 'quantity');
  const unit = input.Unit || 'piece';
  const cable = item.TradeMode === 'cable';
  if (cable ? !['metre','yard','coil'].includes(unit) : unit !== 'piece') invalid('Choose a sale unit allowed for this item.');
  if ((!cable || unit === 'coil') && !Number.isSafeInteger(qty)) invalid('Enter a whole number of pieces or coils.');
  const factor = unit === 'yard' ? 0.9144 : unit === 'coil' ? positive(item.CoilMetres, 'coil length') : 1;
  const scale = Math.round(qty * factor * 1e6);
  if (!Number.isSafeInteger(scale) || scale < 1 || Math.abs(scale - qty * factor * 1e6) > 0.0001) invalid('Use a quantity measurable to one millionth of a metre.');
  const quantity = scale / 1e6;
  const cents = Math.round(100 * positive(item.Price, 'selling price') * quantity);
  if (!Number.isSafeInteger(cents) || cents < 1) invalid('Invalid line total.');
  return { InventoryDocumentId: item.__id, ItemName: item.ItemName, ItemCode: item.ItemCode,
    Quantity: quantity, Unit: cable ? 'm' : 'piece', SaleQuantity: qty, SaleUnit: unit, UnitPrice: Number(item.Price),
    Amount: cents / 100, TradeMode: item.TradeMode || 'standard', WarrantyDays: item.WarrantyDays || 0 };
}
function journal(ref, amount, debit, credit, meta) {
  return add('accountingJournals',ref,{ ...meta, JournalNo: ref, SourceId: ref, Reference: ref,
    Description: meta.Source, Status:'Posted', Date:meta.CreatedAt, TotalDebit:amount, TotalCredit:amount,
    Lines:[{AccountCode:debit,Debit:amount,Credit:0},{AccountCode:credit,Debit:0,Credit:amount}] });
}
export async function tradeCounter(env, user, input, io = db) {
  if (user.edition !== 'organization' || !user.allowedSections?.includes('organizationStore')) invalid('Inventory & Sales access required.',403);
  const branch = identifier(user.branchId,'working branch');
  if (branch.toLowerCase() === 'all') invalid('Choose one working branch.');
  const base = 'tradeBranches/'+branch, quotes = base+'/quotes', serials = base+'/serials', payments = base+'/payments';
  const op = clean(input.Operation);
  if (op === 'list') {
    const rows = await io.queryCollectionPages(env,quotes,{});
    return { quotes: rows.map(plain).sort((a,b)=>b.CreatedAt.localeCompare(a.CreatedAt)) };
  }
  const serialKey = value => identifier(value,'serial number').toUpperCase();
  if (op === 'lookup') {
    const serial = await io.getDocument(env,serials,serialKey(input.Serial));
    if (!serial) invalid('Serial number not found in this branch.',404);
    return {serial:plain(serial)};
  }
  if (user.subscriptionReadOnly || user.subscriptionActive === false) invalid('An active subscription is required.',403);
  const meta = {BranchId:branch, OrganisationEdition:'organization', CreatedAt:new Date().toISOString(), RecordedBy:user.username};
  const loadItem = async id => {
    if (!id || /[/]/.test(id)) invalid('Select a stock item.');
    const item = await io.getDocument(env,'storeItems',id);
    if (!item || (item.BranchId || 'main') !== branch || item.StoreType !== 'Organisation Store'
      || (item.OrganisationEdition && item.OrganisationEdition !== 'organization') || procurementVendorOwned(item)
      || item.Active === false || String(item.Active).toUpperCase() === 'NO') invalid('Active organisation-owned stock required.',409);
    return item;
  };
  const issue = (item, qty, reference, index, reason) => {
    const balance = procurementManagedItem(item) ? procurementMovementBalance(item,'OUT',qty) : Number(item.Quantity)-qty;
    const remaining = Math.round(balance*1e6)/1e6;
    if (!Number.isFinite(remaining) || remaining < 0) invalid('Insufficient stock for '+item.ItemName+'.',409);
    return [update('storeItems',item,{Quantity:remaining,UpdatedAt:meta.CreatedAt}),
      add('organizationCommerceMovements',reference+'-'+index,{...meta,MovementNo:reference+'-'+index,SaleNo:reference,
        ItemCode:item.ItemCode,ItemName:item.ItemName,MovementType:'OUT',Quantity:qty,Date:meta.CreatedAt,Reason:reason})];
  };
  if (op === 'replace') {
    const oldId = serialKey(input.Serial), nextId = serialKey(input.NewSerial);
    const old = await io.getDocument(env,serials,oldId);
    if (old?.ReplacedBy === nextId) return {serial:plain(old)};
    if (!old || old.ReplacedBy || nextId === oldId || old.ExpiresAt < meta.CreatedAt || !clean(input.Reason)) invalid('An in-warranty serial, a different replacement serial and a reason are required.');
    const item = await loadItem(old.InventoryDocumentId);
    const ref = 'WR-'+branch.length+'-'+branch+'-'+nextId;
    const replacement = {...plain(old),Serial:nextId,Replaces:oldId,IssuedAt:meta.CreatedAt};
    await io.batchCommitDocuments(env,[...issue(item,1,ref,1,'Warranty replacement'),
      update(serials,old,{ReplacedBy:nextId,ReturnedAt:meta.CreatedAt,ReturnCondition:'Faulty',Reason:clean(input.Reason)}),
      add(serials,nextId,replacement)]);
    return {serial:replacement};
  }
  const id = identifier(input.QuoteNo,'quote reference');
  let saved = await io.getDocument(env,quotes,id);
  let direct = false;
  if (op === 'quote' || op === 'counterSale') {
    if (saved) {
      if (op === 'counterSale' && (saved.RecordedBy !== user.username || !saved.CounterSale)) invalid('Sale reference already in use.',409);
      return {quote:plain(saved)};
    }
    if (!clean(input.CustomerName) || !Array.isArray(input.Items) || !input.Items.length || input.Items.length > 30) invalid('Enter a customer and between one and thirty items.');
    if (new Set(input.Items.map(x=>x.InventoryDocumentId)).size !== input.Items.length) invalid('Combine duplicate item lines.');
    const items = await Promise.all(input.Items.map(async line=>tradeLine(await loadItem(line.InventoryDocumentId),line)));
    const total = items.reduce((sum,line)=>sum+Math.round(100*line.Amount),0);
    if (!Number.isSafeInteger(total) || total > 1e12) invalid('Quote total is too large.');
    const quote = {...meta,QuoteNo:id,CustomerName:clean(input.CustomerName),Items:items,
      Amount:total/100,Status:'Quoted'};
    if (op === 'quote') {
      await io.batchCommitDocuments(env,[add(quotes,id,quote)]);
      return {quote};
    }
    direct = true;
    saved = {...quote,CounterSale:true,PaymentMethod:input.Method,PaymentReference:clean(input.Reference)};
    if (!['Cash','Bank'].includes(input.Method)) invalid('Choose cash or bank.');
    if (input.Method==='Bank' && !clean(input.Reference)) invalid('Enter the bank payment reference.');
  }
  if (!saved) invalid('Quote not found.',404);
  const saleNo = 'TRADE-'+branch.length+'-'+branch+'-'+id;
  if (op === 'sell' || direct) {
    if (saved.Status !== 'Quoted') return {quote:plain(saved)};
    const credit = input.Method === 'Credit';
    if (!['Credit','Cash','Bank'].includes(input.Method)) invalid('Choose cash, bank or credit.');
    const writes = [], used = new Set();
    for (const [index,line] of saved.Items.entries()) {
      const item = await loadItem(line.InventoryDocumentId);
      if ((item.TradeMode || 'standard') !== line.TradeMode || (line.SaleUnit === 'coil' && item.CoilMetres * line.SaleQuantity !== line.Quantity)) invalid('Item setup changed. Prepare a fresh quote.',409);
      writes.push(...issue(item,line.Quantity,saleNo,index+1,'Trade sale'));
      if (line.TradeMode === 'serial') {
        const ids = (input.Serials?.[index] || []).map(serialKey);
        if (ids.length !== line.Quantity || ids.length > 100 || used.size+ids.length>100) invalid('Supply one serial per piece, up to 100 per sale.');
        for (const serial of ids) {
          if (used.has(serial)) invalid('Duplicate serial number.');
          used.add(serial);
          writes.push(add(serials,serial,{...meta,Serial:serial,SaleNo:saleNo,CustomerName:saved.CustomerName,
            InventoryDocumentId:item.__id,ItemCode:item.ItemCode,IssuedAt:meta.CreatedAt,
            ExpiresAt:new Date(Date.parse(meta.CreatedAt)+line.WarrantyDays*86400000).toISOString()}));
        }
      }
    }
    const changes = {Status:credit?'On credit':'Paid',SaleNo:saleNo,Balance:credit?saved.Amount:0};
    const sale = {...plain(saved),...meta,...changes,SaleType:'organizationStore',SaleDate:meta.CreatedAt,
      Department:'Organisation Store',Currency:'NGN',PaymentReference:clean(input.Reference),PaymentMethod:input.Method,PaymentStatus:credit?'Unpaid':'Paid',InventoryStatus:'Deducted',GrossAmount:saved.Amount};
    writes.push(direct ? add(quotes,id,{...saved,...changes}) : update(quotes,saved,changes),add('organizationCommerceSales',saleNo,sale),
      journal(saleNo,saved.Amount,credit?'1110':input.Method==='Cash'?'1010':'1020','4120',{...meta,Source:'Trade sale'}));
    await io.batchCommitDocuments(env,writes);
    return {quote:{...plain(saved),...changes}};
  }
  if (op === 'payment') {
    const ref = identifier(input.Reference,'payment reference').toUpperCase();
    const amount = positive(input.Amount,'payment amount');
    const prior = await io.getDocument(env,payments,ref);
    if (prior) {
      if (prior.QuoteNo !== id || prior.Amount !== amount || prior.Method !== input.Method) invalid('Payment reference already belongs to a different payment.',409);
      return {quote:plain(saved)};
    }
    if (!['Cash','Bank'].includes(input.Method) || saved.Status !== 'On credit' || amount>saved.Balance || Number(amount.toFixed(2))!==amount) invalid('Enter a valid payment within the outstanding balance.');
    const balance = Math.round((saved.Balance-amount)*100)/100;
    const changes = {Balance:balance,Status:balance?'On credit':'Paid'};
    const sale = await io.getDocument(env,'organizationCommerceSales',saleNo);
    await io.batchCommitDocuments(env,[update(quotes,saved,changes),update('organizationCommerceSales',sale,{...changes,PaymentStatus:balance?'Part paid':'Paid'}),
      add(payments,ref,{...meta,QuoteNo:id,Amount:amount,Method:input.Method,Reference:ref}),
      journal('TRP-'+branch.length+'-'+branch+'-'+ref,amount,input.Method==='Cash'?'1010':'1020','1110',{...meta,Source:'Contractor payment'})]);
    return {quote:{...plain(saved),...changes}};
  }
  invalid('Unknown trade counter operation.');
}
