// Read-only inventory/payment discovery. No remote write endpoint is permitted.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { buildStructuredQuery, firestoreDocumentToObject } from '../functions/lib/firestore.js';
const require = createRequire('C:/Users/DYNAMAX/AppData/Roaming/npm/node_modules/firebase-tools/lib/auth.js');
const auth = require('./auth.js'), { requireAuth } = require('./requireAuth.js'), { Client } = require('./apiv2.js');
const project = 'school-management-suite-27064';
const account = auth.getProjectDefaultAccount(process.cwd());
if (!account) throw new Error('Existing Firebase CLI sign-in required.');
await requireAuth({ project, ...account });
const client = new Client({ urlPrefix:'https://firestore.googleapis.com', apiVersion:'v1' });
const base = `/projects/${project}/databases/(default)/documents`;
const readTime = new Date(Date.now()-5000).toISOString();
const allowed = new Set(['storeItems','storeOrders','payments','ledger','invoices','accountSummaries','accountingAdjustments','accountingJournals','accountingAudit','students','schoolBranches/main/sections/secondary/students','schoolBranches/main/sections/primary/students']);
['tuckShopInventory','organizationCommerceSales','vendorEarnings','vendorClaimLots','vendorBalances','vendorSettlementPayments','vendorSettlementRequests'].forEach(value=>allowed.add(value));
async function query(collection, options={}) {
  if (!allowed.has(collection)) throw new Error('Out-of-scope collection refused.');
  const rows=[]; let startAfterName='';
  for (let page=0; page<50; page++) {
    const {endpoint,structuredQuery}=buildStructuredQuery(collection,{...options,orderBy:[{field:'__name__'}],limit:500,...(startAfterName?{startAfterName}:{})});
    if (!endpoint.endsWith(':runQuery')) throw new Error('Write operation refused.');
    const response=await client.post(`${base}/${endpoint}`,{structuredQuery,readTime},{resolveOnHTTPError:true});
    const entries=Array.isArray(response.body)?response.body:[response.body];
    if(response.status>=400||entries.some(row=>row?.error))throw new Error(`Read failed: ${collection} (${response.status}).`);
    const batch=entries.flatMap(row=>row.document?[firestoreDocumentToObject(row.document)]:[]);
    rows.push(...batch);
    if(batch.length<500)return rows;
    const next=batch.at(-1).__name;
    if(!next||next===startAfterName)throw new Error('Pagination stalled.');
    startAfterName=next;
  }
  throw new Error('Incomplete collection refused.');
}
const [items,orders,inventory,sales,ledger,payments]=await Promise.all(['storeItems','storeOrders','tuckShopInventory','organizationCommerceSales','ledger','payments'].map(collection=>query(collection)));
const pattern=/\b(?:rfid|s70|nfc)\b/i;
const matchingItems=items.filter(row=>pattern.test(`${row.ItemName} ${row.ItemCode}`));
const matchingOrders=orders.filter(row=>pattern.test(JSON.stringify(row)));
const matchingInventory=inventory.filter(row=>pattern.test(`${row.ItemName} ${row.Name} ${row.ItemCode}`));
const matchingSales=sales.filter(row=>pattern.test(JSON.stringify(row)));
const matchingLedger=ledger.filter(row=>pattern.test(`${row.Description} ${row.FeeName} ${row.Metadata}`));
const matchingPayments=payments.filter(row=>pattern.test(`${row.FeeName} ${row.Description} ${row.Metadata}`));
const vendorIds=[...new Set(matchingInventory.map(row=>row.VendorId))];
const vendorData={};
if(vendorIds.length)await Promise.all(['vendorEarnings','vendorClaimLots','vendorBalances','vendorSettlementPayments','vendorSettlementRequests'].map(async collection=>{
  vendorData[collection]=await query(collection,{filters:[{field:'VendorId',op:'in',value:vendorIds}]});
}));
const references=[...new Set(matchingSales.map(row=>row.CustomerRef))];
const relatedLedger=ledger.filter(row=>references.includes(row.AccountRef)||references.includes(row.AdmissionNo));
const output={readOnly:true,readTime,counts:{items:items.length,orders:orders.length,inventory:inventory.length,sales:sales.length,ledger:ledger.length,payments:payments.length},matchingItems,matchingOrders,matchingInventory,matchingSales,matchingLedger,matchingPayments,vendorData,relatedLedger};
await writeFile('tmp/card-refund-discovery.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({readOnly:true,readTime,matchCounts:{orders:matchingOrders.length,sales:matchingSales.length,students:references.length,ledger:matchingLedger.length,payments:matchingPayments.length},vendorCounts:Object.fromEntries(Object.entries(vendorData).map(([key,rows])=>[key,rows.length])),balances:vendorData.vendorBalances,refunds:vendorData.vendorEarnings?.filter(row=>row.Type==='Refund').map(row=>({SaleNo:row.SaleNo,RefundCents:row.RefundCents,Reference:row.Reference})),requests:vendorData.vendorSettlementRequests?.map(row=>({SettlementId:row.SettlementId,Status:row.Status,AmountCents:row.AmountCents,PaidCents:row.PaidCents})),duplicateStudents:references.filter(ref=>matchingSales.filter(row=>row.CustomerRef===ref).length>1)}));
