import { storeLocationLabel } from './store-location.js';
import { getDocument, getDocuments, queryCollection, batchCommitDocuments } from './firestore.js';
import { salesCounterCatalogue, recordManualOrganizationCommerceSale } from './organization-commerce.js';
import { tradeCounter } from './trade-counter.js';

const db={getDocument,getDocuments,queryCollection,batchCommitDocuments,salesCounterCatalogue,recordManualOrganizationCommerceSale,tradeCounter};
function fail(message,status=400) {throw Object.assign(new Error(message),{status});}
const text=value=>String(value??'').trim();
function receipt(row) {
  const {SaleNo,SaleDate,PaidAt,CustomerName,PaymentMethod,PaymentReference,PaymentStatus,Amount,IssuedAt,IssuedBy,Department}=row;
  const Items=(row.Items||[]).map(({ItemName,Unit,Quantity,UnitPrice,Amount,SaleQuantity,SaleUnit})=>
    ({ItemName,Unit,Quantity,UnitPrice,Amount,SaleQuantity,SaleUnit}));
  return {SaleNo,SaleDate,PaidAt,CustomerName,PaymentMethod,PaymentReference,PaymentStatus,Amount,IssuedAt,IssuedBy,Department,Items};
}
async function findPurchase(env,branch,reference,io) {
  if (!reference || reference.length>140 || /[/\\?#]/.test(reference)) fail('Enter the receipt number or payment reference.');
  const collection='organizationCommerceSales';
  const eligible=r=>r && r.BranchId===branch && r.OrganisationEdition==='organization' && r.SaleType==='organizationStore'
    && r.CheckoutSource==='Public Store' && r.PaymentStatus==='Paid' && r.InventoryStatus==='Deducted'
    && r.Status==='Paid' && !r.RefundedAt && !r.VoidedAt;
  const direct=await io.getDocument(env,collection,reference);
  if(eligible(direct)) return direct;
  if(reference.startsWith('DBT-')) {
    const transferSale=await io.getDocument(env,collection,reference.slice(4));
    if(eligible(transferSale) && transferSale.PaymentMethod==='Bank Transfer') return transferSale;
  }
  const rows=await io.queryCollection(env,collection,{filters:[{field:'PaymentReference',op:'==',value:reference}],limit:3});
  const matches=rows.filter(eligible);
  if(rows.length>=3 || matches.length!==1) fail('No unique paid self-service purchase is available in this branch for that reference.',404);
  return matches[0];
}
export async function salesCounter(env,user,body,io=db) {
  const section=body.section, branch=text(user.branchId);
  if(user.role!=='Sales Personnel' || user.edition!=='organization' || !['organizationStore','restaurant'].includes(section) ||
     !user.allowedSections?.includes(section) || !branch || branch.toLowerCase()==='all' || user.subscriptionActive===false) fail('Sales counter access required in the working branch.',403);
  const action=body.action;
  if(action==='catalogue') return {items:await io.salesCounterCatalogue(env,section,user)};
  if(!['lookup','issue','sell'].includes(action)) fail('Only sales and paid collections are available.',403);
  if(action!=='lookup' && user.subscriptionReadOnly) fail('The subscription is read-only.',403);
  if(action!=='sell') {
    if(section!=='organizationStore') fail('Choose the retail counter for a QR purchase.',403);
    const row=await findPurchase(env,branch,text(body.Reference),io);
    if (action === 'lookup' || row.IssuedAt) {
      const sale = receipt(row);
      if (!row.IssuedAt) {
        const ids = [...new Set((row.Items || []).map(line => line.InventoryDocumentId).filter(Boolean))];
        if (ids.length) {
          const items = await io.getDocuments(env, 'storeItems', ids);
          const locations = new Map(items.filter(item => item && (item.BranchId || 'main') === branch &&
            item.StoreType === 'Organisation Store' && !(item.OrganisationEdition && item.OrganisationEdition !== user.edition))
            .map(item => [item.__id, storeLocationLabel(item)]));
          sale.Items.forEach((line, index) => { line.StoreLocation = locations.get(row.Items[index].InventoryDocumentId) || ''; });
        }
      }
      return { sale, alreadyIssued: !!row.IssuedAt };
    }
    if(body.SaleNo!==row.SaleNo || !row.__updateTime) fail('Look up this receipt again before issuing items.',409);
    const issue={IssuedAt:new Date().toISOString(),IssuedBy:user.username};
    await io.batchCommitDocuments(env,[{collectionPath:'organizationCommerceSales',documentId:row.__id,literalDocumentId:true,
      updateTime:row.__updateTime,updateMask:Object.keys(issue),data:issue}]);
    return {sale:receipt({...row,...issue}),alreadyIssued:false};
  }
  if(!/^[a-f0-9-]{36}$/i.test(body.RequestId) || !['Cash','Bank Transfer'].includes(body.Method)) fail('Choose cash or bank and start a valid sale.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([branch,user.username,section,body.RequestId])))),n=>n.toString(16).padStart(2,'0')).join('');
  const id='POS-'+hash.slice(0,32);
  if(!Array.isArray(body.Items) || !body.Items.length || body.Items.length>30) fail('Choose the items to sell.');
  const customer=text(body.CustomerName)||'Walk-in customer', reference=text(body.Reference);
  if(customer.length>240 || reference.length>140 || (body.Method==='Bank Transfer' && !reference)) fail('Check the customer and payment reference.');
  if(section==='organizationStore' && body.SpecialItems===true) {
    const result=await io.tradeCounter(env,user,{Operation:'counterSale',QuoteNo:id,CustomerName:customer,Items:body.Items,
      Serials:body.Serials,Reference:reference,Method:body.Method==='Cash'?'Cash':'Bank'});
    return {sale:receipt({...result.quote,SaleDate:result.quote.CreatedAt,PaymentStatus:'Paid',PaymentMethod:result.quote.PaymentMethod,PaymentReference:result.quote.PaymentReference,Department:'Organisation Store'})};
  }
  const payload={Items:body.Items,SaleRequestId:id,CustomerName:customer,PaymentMethod:body.Method,PaymentReference:reference};
  const result=await io.recordManualOrganizationCommerceSale(env,section,payload,user);
  return {sale:receipt(result.sale)};
}
