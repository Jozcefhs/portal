import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import * as rules from '../functions/lib/vendor-settlement-rules.js';

const read = file => readFile(new URL(`../${file}`,import.meta.url),'utf8');
const strip = text => text.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm,'').replace(/export /g,'');
const historySource = await read('functions/lib/vendor-sales-history.js');
const salesSource = await read('functions/lib/vendor-sales.js');
const accessSource = await read('functions/lib/vendor-sales-access.js');
const user = {username:'seller',role:'Vendor User',edition:'school',branchId:'main',schoolSectionAccess:'All',allowedSections:['vendorSettlements','tuckShop']};
const scope = rules.settlementScope(user);
function fixture(actor = user) {
  const entries = [], receipts = new Map(), queries = [], reads = [];
  const vendors = [{...rules.settlementScope(actor),VendorId:'v1',SchoolSection:'Secondary',LoginUsername:'seller',Active:'YES'}];
  const getDocument = async (_env,collection,id) => {reads.push({collection,id});return receipts.get(id) || null;};
  const queryCollection = async (_env,collection,options) => {
    queries.push({collection,options});
    let rows = entries.filter(row => options.filters.every(f => f.op === 'in' ? f.value.includes(row[f.field]) : row[f.field] === f.value))
      .sort((a,b) => b.Date.localeCompare(a.Date) || b.__name.localeCompare(a.__name));
    if(options.startAfterName) rows = rows.slice(rows.findIndex(row=>row.__name===options.startAfterName)+1);
    return rows.slice(0,options.limit);
  };
  const COMMERCE_CONFIG = Object.fromEntries(['tuckShop','restaurant','organizationStore'].map(section=>[section,{sales:'organizationCommerceSales'}]));
  const history = runInNewContext(`${strip(historySource)}\n({recentVendorSales,recentVendorHistoricalOpenings})`,{...rules,getDocument,queryCollection,COMMERCE_CONFIG});
  const access = runInNewContext(`${strip(accessSource)}\n({linkedSalesVendors})`,{...rules,queryCollectionPages:async()=>vendors});
  const handle = runInNewContext(`${strip(salesSource)}\nhandleVendorSalesAction`,{...rules,...access,...history});
  const add = (SaleNo,overrides = {},receiptOverrides = {}) => {
    const entry = {...rules.settlementScope(actor),SchoolSection:'Secondary',VendorId:'v1',SaleNo,Type:'Sale',Date:'2026-10-10T10:00:00Z',
      SaleDate:'2026-10-10T10:00:00Z',GrossCents:10000,OriginalPaymentMethod:'Student Wallet',CollectionMode:'School collected',
      Items:[{ItemName:'Owned item',Quantity:1,UnitPrice:100,Amount:100,InventoryDocumentId:'private-stock-id'}],...overrides};
    entry.__name = `projects/fixture/databases/(default)/documents/vendorEarnings/${SaleNo}--${entry.VendorId}`;
    entries.push(entry);
    receipts.set(SaleNo,{...rules.settlementScope(actor),SaleNo,SaleType:actor.edition==='school'?'tuckShop':'organizationStore',
      SaleDate:entry.Date,PaymentStatus:'Paid',PaymentMethod:'Student Wallet',CustomerName:'Sample customer',Amount:900,
      WalletPinHash:'private',CustomerEmail:'private@example.test',AccountRef:'private-student',Items:[{ItemName:'Unrelated school product',Amount:800}],...receiptOverrides});
    return entry;
  };
  const addOpening = (reference = 'VINCENT-HIST-20261008',overrides = {}) => {
    const entry = {...rules.settlementScope(actor),SchoolSection:'Secondary',VendorId:'v1',OpeningReference:reference,
      Type:'Reviewed historical opening',Source:'Reviewed historical opening',Date:'2026-10-08',GrossCents:20000000,
      RefundCents:1000000,ChargeCents:910000,PaidCents:1000000,NetCents:18090000,OutstandingCents:17090000,
      EvidenceReference:'private-evidence',OffsetAccount:'private-account',Notes:'private-review',AuthorizationMethod:'private-auth',...overrides};
    entry.EntryId = `${entry.ScopeKey}--OPEN-${reference}`;
    entry.__name = `projects/fixture/databases/(default)/documents/vendorEarnings/${entry.EntryId}`;
    entries.push(entry);return entry;
  };
  return {entries,receipts,queries,reads,vendors,add,addOpening,saleQueries:()=>queries.filter(row=>row.options.filters.some(f=>f.op==='in')),
    run:(body={},actorOverride=actor)=>handle({},actorOverride,{action:'recentVendorSales',Section:actor.edition==='school'?'tuckShop':'organizationStore',...body})};
}

test('recent vendor sales expose only immutable owner lines and gross amount, not the full mixed receipt or wallet data',async()=>{
  const f = fixture(); f.add('MIXED');
  const {sales} = await f.run({VendorId:'unlinked',BranchId:'other',SchoolSection:'Primary'});
  assert.equal(sales.length,1); assert.equal(sales[0].Amount,100);
  assert.deepEqual(JSON.parse(JSON.stringify(sales[0].Items)),[{ItemName:'Owned item',Quantity:1,UnitPrice:100,Amount:100}]);
  assert.deepEqual(Object.keys(sales[0]).sort(),['Amount','CollectionMode','CustomerName','Items','PaymentMethod','PaymentStatus','SaleDate','SaleNo']);
  assert.doesNotMatch(JSON.stringify(sales),/private|Unrelated school product/);
  assert.ok(f.reads.every(row=>row.collection==='organizationCommerceSales'));
  assert.equal(f.queries[0].options.filters[0].value,'school--main');
  assert.equal(f.queries[0].options.filters[1].value,'v1');
});

test('history rejects unlinked identities, roles, branches, sections and modules before reading receipts',async()=>{
  const f=fixture();f.add('SAFE');
  for(const change of [{username:'other'},{role:'Teacher'},{branchId:'other'},{schoolSectionAccess:'Primary'},{allowedSections:['vendorSettlements']}]) {
    const result = await f.run({}, {...user,...change}).catch(error=>error);
    assert.ok(result.status===403 || result.sales?.length===0);
  }
  assert.equal(f.reads.length,0);
  f.vendors[0].Active='NO';assert.equal((await f.run()).sales.length,0);
  f.vendors[0].Active='YES';f.vendors[0].PosEnabled=false;assert.equal((await f.run()).sales.length,0);
});

test('branch, edition, school-section, payment state and receipt type must match stored ownership',async()=>{
  const f=fixture(); f.add('GOOD');
  f.add('PRIMARY',{SchoolSection:'Primary'});f.add('UNLINKED',{VendorId:'v2'});
  f.add('OTHERBRANCH',{ScopeKey:'school--other',BranchId:'other'});
  f.add('OTHEREDITION',{ScopeKey:'faith--main',OrganisationEdition:'faith'});
  f.add('CONFLICT',{BranchId:'other'});f.add('UNPAID',{}, {PaymentStatus:'Pending'});
  f.add('WRONGTYPE',{}, {SaleType:'restaurant'});f.add('WRONGRECEIPT',{}, {BranchId:'other'});
  f.add('REFUND',{Type:'Refund'});f.addOpening();
  assert.deepEqual(Array.from((await f.run()).sales,s=>s.SaleNo),['GOOD']);
});

test('a sale shared by linked vendors appears once with just their combined products and amounts',async()=>{
  const f=fixture();f.vendors.push({...f.vendors[0],VendorId:'v2'});
  f.add('SHARED');f.add('SHARED',{VendorId:'v2',GrossCents:25000,Items:[{ItemName:'Second vendor item',Quantity:1,Amount:250,UnitPrice:250}]});
  f.add('SHARED',{VendorId:'v3',GrossCents:80000,Items:[{ItemName:'Unlinked item',Amount:800}]});
  const {sales}=await f.run();assert.equal(sales.length,1);assert.equal(sales[0].Amount,350);assert.equal(sales[0].Items.length,2);
  assert.doesNotMatch(JSON.stringify(sales),/Unlinked item/);
});

test('latest 30 receipts use bounded descending queries and are not financial balance totals',async()=>{
  const f=fixture();for(let i=0;i<65;i++)f.add(`SALE-${String(i).padStart(3,'0')}`);
  const {sales}=await f.run();assert.equal(sales.length,30);assert.equal(sales[0].SaleNo,'SALE-064');assert.equal(sales.at(-1).SaleNo,'SALE-035');
  assert.equal(f.saleQueries().length,1);assert.equal(f.reads.length,30);assert.equal(f.queries[0].options.limit,30);
  assert.equal(f.queries[0].options.orderBy[0].direction,'DESCENDING');
});

test('non-school shops page past the other sales workspace without exposing its receipts',async()=>{
  const actor={...user,edition:'organization',allowedSections:['vendorSettlements','organizationStore','restaurant']};
  const f=fixture(actor);
  for(let i=0;i<35;i++) f.add(`OTHER-${i}`,{Date:'2026-10-10T11:00:00Z'}, {SaleType:'restaurant',CustomerName:'Other workspace'});
  f.add('STORE');const {sales}=await f.run();assert.equal(sales.length,1);assert.equal(sales[0].SaleNo,'STORE');
  assert.equal(f.saleQueries().length,2);assert.ok(f.saleQueries()[1].options.startAfterName);
});

test('read-only subscriptions can read history, and query failures never return a false empty history',async()=>{
  const f=fixture();f.add('PAID');assert.equal((await f.run({}, {...user,subscriptionReadOnly:true})).sales.length,1);
  const broken=runInNewContext(`${strip(historySource)}\nrecentVendorSales`,{...rules,queryCollection:async()=>{throw new Error('Index not ready');}});
  await assert.rejects(broken({},user,'tuckShop',f.vendors),/Index not ready/);
  await assert.rejects(broken({},user,'tuckShop',Array(21).fill(f.vendors[0])),error=>error.status===413);
});

test('all edition index manifests support the bounded recent vendor query',async()=>{
  for(const edition of ['school','church','organization']) {
    const manifest=JSON.parse(await read(`firestore.${edition}.indexes.json`));
    assert.ok(manifest.indexes.some(index=>index.collectionGroup==='vendorEarnings' && JSON.stringify(index.fields)===JSON.stringify([
      {fieldPath:'ScopeKey',order:'ASCENDING'},{fieldPath:'VendorId',order:'ASCENDING'},{fieldPath:'Type',order:'ASCENDING'},{fieldPath:'Date',order:'DESCENDING'}])));
  }
  const gateway=await read('functions/lib/vendor-settlements.js');
  assert.match(gateway,/case 'salesBootstrap':\s*case 'recentVendorSales':/);
  assert.match(gateway,/\['bootstrap'[^\n]*'recentVendorSales'[^\n]*\]\.includes\(action\)/);
});

test('long unmatched history stops at its read budget instead of scanning indefinitely or returning partial results',async()=>{
  const f=fixture();
  for(let i=0;i<301;i++)f.add(`OTHER-${String(i).padStart(3,'0')}`,{}, {SaleType:'restaurant'});
  await assert.rejects(f.run(),error=>error.status===413);
  assert.equal(f.saleQueries().length,10);assert.equal(f.reads.length,300);
});

test('committed historical openings are separate reviewed summaries, without exposing or creating old receipts',async()=>{
  const f=fixture();f.vendors[0].Name='Vincent Stores';f.addOpening();
  f.receipts.set('OLD-ORGANISATION-SALE',{SaleNo:'OLD-ORGANISATION-SALE',Amount:200000,PaymentStatus:'Paid'});
  const result=await f.run({VendorId:'v2',BranchId:'other',SchoolSection:'Primary'});
  assert.equal(result.sales.length,0);assert.equal(result.historicalOpenings.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.historicalOpenings[0])),{
    VendorName:'Vincent Stores',Reference:'VINCENT-HIST-20261008',Date:'2026-10-08',HistoricalSales:200000,
    Refunds:10000,Deductions:9100,PreviouslyPaid:10000,OpeningAmountOwed:170900
  });
  assert.equal(f.reads.length,0);assert.doesNotMatch(JSON.stringify(result),/private|OLD-ORGANISATION-SALE/);
  assert.equal(f.entries.length,1);assert.equal(f.receipts.size,1);
  const query=f.queries.find(row=>row.options.filters.some(filter=>filter.value==='Reviewed historical opening'));
  assert.equal(query.collection,'vendorEarnings');assert.equal(query.options.limit,30);
});

test('historical opening visibility follows the linked vendor, branch, edition and school section, including read-only access',async()=>{
  const f=fixture();f.addOpening('GOOD');
  f.addOpening('UNLINKED',{VendorId:'v2'});f.addOpening('OTHER-BRANCH',{ScopeKey:'school--other',BranchId:'other'});
  f.addOpening('OTHER-EDITION',{ScopeKey:'faith--main',OrganisationEdition:'faith'});
  f.addOpening('CONFLICT',{BranchId:'other'});f.addOpening('PRIMARY',{SchoolSection:'Primary'});
  f.addOpening('NOT-COMMITTED',{Type:'Preview historical opening'});
  const result=await f.run({}, {...user,subscriptionReadOnly:true});
  assert.deepEqual(Array.from(result.historicalOpenings,row=>row.Reference),['GOOD']);
  for (const actor of [{...user,username:'other'},{...user,schoolSectionAccess:'Primary'},{...user,branchId:'other'}])
    assert.equal((await f.run({},actor)).historicalOpenings.length,0);
  assert.equal(f.reads.length,0);
});

test('each edition returns only the latest 30 vendor-level openings and never a misleading partial aggregate',async()=>{
  for (const edition of ['school','faith','organization']) {
    const actor={...user,edition,allowedSections:['vendorSettlements',edition==='school'?'tuckShop':'organizationStore','restaurant']};
    const f=fixture(actor);f.vendors.push({...f.vendors[0],VendorId:'v2',Name:'Second linked vendor'});
    for(let i=0;i<35;i++)f.addOpening(`HIST-${String(i).padStart(3,'0')}`);
    f.addOpening('SECOND',{VendorId:'v2',Date:'2026-10-09'});
    const result=await f.run();assert.equal(result.historicalOpenings.length,30);
    assert.equal(result.historicalOpenings[0].Reference,'SECOND');assert.equal(result.historicalOpenings.at(-1).Reference,'HIST-006');
    assert.equal(result.sales.length,0);assert.equal(f.reads.length,0);
    assert.equal(f.queries.length,4);assert.ok(f.queries.every(query=>query.options.limit===30));
  }
});

test('invalid historical money never becomes a false zero or an unreviewed figure',async()=>{
  for(const change of [{GrossCents:'20000000'},{RefundCents:-1},{OutstandingCents:1},{NetCents:1},{PaidCents:NaN},{Date:'wrong'}]) {
    const f=fixture();f.addOpening('INVALID',change);
    await assert.rejects(f.run(),error=>error.status===409 && /Accounts review/.test(error.message));
  }
});
