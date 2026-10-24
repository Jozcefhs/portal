import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { enforceActorBranch } from '../functions/lib/branch-scope.js';
import * as procurementGuards from '../functions/lib/procurement-inventory-guard.js';
import { assertNoKeyHandoff, guestAccessWrite } from '../functions/lib/hotel-self-service.js';

const root = new URL('../', import.meta.url);
const clone = value => value == null ? value : structuredClone(value);
const clean = value => String(value ?? '').trim();
function database() {
  const documents = new Map();
  let version = 0;
  const read = (c, id) => {
    const row = documents.get(`${c}/${id}`);
    return row ? { ...clone(row), __id: id, __updateTime: row.__updateTime || 'initial' } : null;
  };
  const commit = async (_env, writes) => {
    for (const write of writes) {
      const row = read(write.collectionPath, write.documentId);
      if ((write.exists === false && row) || (write.updateTime && row?.__updateTime !== write.updateTime)) throw Object.assign(new Error('Concurrent version conflict'), { status: 409 });
    }
    for (const write of writes) {
      const key = `${write.collectionPath}/${write.documentId}`;
      if (write.operation === 'delete') documents.delete(key);
      else documents.set(key, { ...clone(write.data), __updateTime: `v${++version}` });
    }
  };
  const api = {
    getDocument: async (_env, c, id) => read(c, id),
    listCollection: async (_env, c) => [...documents.keys()].filter(key => key.startsWith(`${c}/`)).map(key => read(c, key.slice(c.length + 1))),
    queryCollection: async (env, c, { filters = [], limit = 1000 } = {}) => (await api.listCollection(env, c)).filter(row => filters.every(({ field, value }) => row[field] === value)).slice(0, limit),
    batchCommitDocuments: commit, batchUpsertDocuments: commit,
    createDocumentIfAbsent: async (env, c, id, data) => {
      if (read(c, id)) return { created: false, document: read(c, id) };
      await commit(env, [{collectionPath:c,documentId:id,data,exists:false}]);
      return {created:true,document:read(c,id)};
    },
    upsertDocument: async (env,c,id,data) => commit(env,[{collectionPath:c,documentId:id,data}]),
    patchDocumentFields: async (env,c,id,data) => commit(env,[{collectionPath:c,documentId:id,data:{...read(c,id),...data}}])
  };
  return { documents, read, api };
}
async function load(file, db, extra = {}, slice) {
  const context = {
    assertNoKeyHandoff, guestAccessWrite,
    hotelSelfServiceData: async () => ({ roomTypes: [], keyDispenser: null }),
    publicRoomMedia: async () => [],
    ...procurementGuards,
    loadProcurementInventoryControl: (env, scope) => procurementGuards.loadProcurementInventoryControl(env, scope, db.api.getDocument),
    ...db.api, crypto:globalThis.crypto, Response, URL, URLSearchParams, TextEncoder, console,
    enforceActorBranch, schoolSectionFor: row => clean(row.SchoolSection || 'Secondary').toLowerCase(),
    resolveOrganizationConfig: ({env}) => ({Edition:env.edition || 'faith',FeatureFlags:{hotel:true},Code:'TEST'}),
    normalizeOrganizationEdition: value=>value,
    fetch:()=>{throw new Error('Unexpected network access');}, ...extra
  };
  context.listBranchCollection = context.listCollection;
  vm.createContext(context);
  let source=await readFile(new URL(file,root),'utf8');
  if (slice) source=source.slice(source.indexOf(slice[0]),source.indexOf(slice[1]));
  source=source.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm,'').replace(/^export /gm,'');
  vm.runInContext(source,context,{filename:file});
  return context;
}
const user={role:'Hotel User',branchId:'main',username:'clerk'};
const room={RoomId:'room1',RoomNumber:'1',BranchId:'main',Capacity:2,NightlyRate:1000,Status:'Available'};
const stay={ReservationId:'stay1',RoomId:'room1',GuestName:'Synthetic guest',ArrivalDate:'2026-11-01',DepartureDate:'2026-11-02'};

test('R11: school stock confirmation resolves scoped and legacy IDs, never another branch',async()=>{
  const db=database(), stock=await load('functions/lib/school-store-stock.js',db);
  const payment=await load('functions/api/verify-payment.js',db,{resolveSchoolStoreStock:stock.resolveSchoolStoreStock});
  for(const StoreType of ['Bookstore','Uniform Store']) {
    const id=`${StoreType.replaceAll(' ','_')}-BOOK-main-Secondary`;
    db.documents.set(`storeItems/${id}`,{StoreType,ItemCode:'BOOK',BranchId:'main',SchoolSection:'Secondary',Quantity:5});
    db.documents.set(`storeItems/${id}-other`,{StoreType,ItemCode:'BOOK',BranchId:'other',SchoolSection:'Secondary',Quantity:9});
    const item={ItemCode:'BOOK',StoreType,BranchId:'main',SchoolSection:'Secondary',Quantity:2};
    const result=await payment.createPaidStoreOrder({}, {OrderNo:`order-${StoreType}`,BranchId:'main'},[item],StoreType);
    assert.equal(result.created,true); assert.equal(result.warning,'');
    assert.equal(db.read('storeItems',id).Quantity,3);
    assert.equal(db.read('storeItems',`${id}-other`).Quantity,9);
    await payment.createPaidStoreOrder({}, {OrderNo:`order-${StoreType}`,BranchId:'main'},[item],StoreType);
    assert.equal(db.read('storeItems',id).Quantity,3,'replay does not deduct twice');
    assert.equal(await stock.resolveSchoolStoreStock({}, {...item,InventoryDocumentId:`${id}-other`}),null);
  }
  db.documents.set('storeItems/Bookstore-OLD',{StoreType:'Bookstore',Quantity:5});
  const legacy = await stock.resolveSchoolStoreStock({}, {StoreType:'Bookstore',ItemCode:'OLD'},{BranchId:'main'});
  assert.equal(legacy.__id,'Bookstore-OLD');
  assert.equal(legacy.ItemCode,'OLD');
  assert.equal((await stock.resolveSchoolStoreStock({}, {StoreType:'Bookstore',ItemCode:'OLD',InventoryDocumentId:legacy.__id},{BranchId:'main'})).__id,legacy.__id);
});

test('school paid store writes preserve actual stock IDs and fractional balances without changing order IDs',async()=>{
  const db=database(), stock=await load('functions/lib/school-store-stock.js',db), commit=db.api.batchUpsertDocuments;
  let submitted;
  db.api.batchUpsertDocuments=async(env,writes)=>{submitted=writes;return commit(env,writes);};
  const payment=await load('functions/api/verify-payment.js',db,{resolveSchoolStoreStock:stock.resolveSchoolStoreStock});
  for(const StoreType of ['Bookstore','Uniform Store']) {
    const id=`${StoreType}-café%20stock`;
    db.documents.set(`storeItems/${id}`,{StoreType,ItemCode:'BOOK',BranchId:'main',SchoolSection:'Secondary',Quantity:2.125,ProcurementManaged:'YES'});
    const item={ItemCode:'BOOK',InventoryDocumentId:id,StoreType,BranchId:'main',SchoolSection:'Secondary',Quantity:1};
    const result=await payment.createPaidStoreOrder({}, {OrderNo:`order-${StoreType}`,BranchId:'main'},[item],StoreType);
    assert.equal(result.created,true); assert.equal(result.warning,'');
    assert.equal(db.read('storeItems',id).Quantity,1.125);
    const stockWrite=submitted.find(write=>write.collectionPath==='storeItems');
    assert.equal(stockWrite.documentId,id); assert.equal(stockWrite.literalDocumentId,true);
    assert.equal(submitted.find(write=>write.collectionPath==='storeOrders').literalDocumentId,undefined);
    await payment.createPaidStoreOrder({}, {OrderNo:`order-${StoreType}`,BranchId:'main'},[item],StoreType);
    assert.equal(db.read('storeItems',id).Quantity,1.125,'replay does not deduct twice');
  }
});

test('vendor inventory edits opt into literal IDs only for resolved existing stock records',async()=>{
  const db=database(), api=await load('functions/lib/vendor-settlements.js',db,{
    inventoryCollections:{tuckShop:'tuckShopInventory',organizationStore:'storeItems',restaurant:'restaurantInventory'},
    clean, plain:row=>({...row}), fail:message=>{throw new Error(message);}
  },['function write(', 'function audit(']);
  for(const collection of ['tuckShopInventory','storeItems','restaurantInventory']) {
    const previous={__id:'café%20stock',__updateTime:'v1'};
    assert.equal(api.write(collection,previous.__id,{Quantity:3},previous).literalDocumentId,true);
    assert.equal(api.write(collection,'NEW-ITEM',{Quantity:0}).literalDocumentId,undefined);
    assert.equal(api.write(collection,'different-id',{Quantity:3},previous).literalDocumentId,undefined);
  }
  assert.equal(api.write('vendorBalances','legacy%20id',{}, {__id:'legacy%20id',__updateTime:'v1'}).literalDocumentId,undefined);
});

test('R12: both organisation editions approve transfer using exact immutable stock ID',async()=>{
  for(const edition of ['faith','organization']) {
    const db=database(); let transfer;
    const api=await load('functions/lib/organization-commerce.js',db,{
      restrictVendorInventory:async(_e,_u,_s,rows)=>rows,snapshotVendorCart:async(_e,cart)=>cart,
      createDirectTransferRequest:async(_e,input)=>{transfer=input;return {ok:true};},
      prepareVendorSale:async(_e,_sale,journal)=>({journal,writes:[],settlements:[]}),
      sendOrganizationCommerceReceiptEmail:async()=>({ok:true})
    });
    db.documents.set('storeItems/scoped-book',{StoreType:'Organisation Store',ItemCode:'BOOK',ItemName:'Book',BranchId:'main',OrganisationEdition:edition,Quantity:5,Price:1000});
    const actor={branchId:'main',edition};
    await api.initializeDirectTransferOrganizationCommerceSale({},'organizationStore',{SaleRequestId:`transfer-${edition}`,CustomerEmail:'test@example.invalid',Items:[{ItemCode:'BOOK',Quantity:1}]},actor);
    const paid=await api.recordManualOrganizationCommerceSale({},'organizationStore',{...transfer.payload,PaymentMethod:'Bank Transfer',PaymentReference:'BANK',ExpectedAmount:1000},actor);
    assert.equal(paid.ok,true); assert.equal(db.read('storeItems','scoped-book').Quantity,4);
  }
});

test('R13: branch-assigned hotel staff cannot read or write another branch',async()=>{
  for(const edition of ['faith','organization']) {
    const db=database(), api=await load('functions/lib/hotel-services.js',db);
    db.documents.set('hotelRooms/other',{...room,RoomId:'other',BranchId:'other'});
    await assert.rejects(api.listHotelServices({edition},user,{BranchId:'other'}),e=>e.status===403);
    await assert.rejects(api.saveHotelRoom({edition},user,{...room,RoomId:'other',BranchId:'other'}),e=>e.status===403);
    assert.equal(db.read('hotelRooms','other').RoomNumber,'1');
  }
});

test('R13: desktop hotel actions enforce effective edition, module and readonly subscription access',async()=>{
  const source=await readFile(new URL('functions/api/backend.js',root),'utf8');
  const cases=source.slice(source.indexOf("    case 'getHotelServices':"),source.indexOf("    case 'getChurchOfferings':",source.indexOf("    case 'getHotelServices':")));
  for(const edition of ['faith','organization']) {
    let calls=0;
    const access={edition,allowedSections:['hotel'],subscriptionActive:true,subscriptionReadOnly:false};
    const context={clean,staffAccessFor:async()=>access,handleHotelAction:async()=>{calls++;return {ok:true};},buildHotelSelfServiceQr:async()=>({})};
    context.listBranchCollection = context.listCollection;
  vm.createContext(context);
    vm.runInContext(`async function route(env,action,body,deploymentIdentity,publicOrigin){ switch(action){${cases}} }`,context);
    const body={UserUsername:'hotel-clerk',UserRole:'Hotel User',UserBranchId:'main'};
    const call=action=>context.route({},action,body,{edition},'https://example.invalid');
    access.subscriptionReadOnly=true;
    await assert.rejects(call('saveHotelRoom'),e=>e.status===403);
    assert.equal(calls,0);
    await call('getHotelServices');
    access.subscriptionReadOnly=false;
    await call('saveHotelReservation');
    assert.equal(calls,2);
    access.allowedSections=[];
    await assert.rejects(call('getHotelServices'),e=>e.status===403);
    access.allowedSections=['hotel']; access.subscriptionActive=false;
    await assert.rejects(call('recordHotelPayment'),e=>e.status===403);
    access.subscriptionActive=true; access.edition='school';
    await assert.rejects(call('saveHotelRoom'),e=>e.status===403);
    assert.equal(calls,2);
  }
});

test('R14: concurrent staff bookings only commit one overlapping reservation',async()=>{
  const db=database(),api=await load('functions/lib/hotel-services.js',db);
  db.documents.set('hotelRooms/room1',room);
  const results=await Promise.allSettled([1,2].map(n=>api.saveHotelReservation({},user,{...stay,ReservationId:`stay${n}`})));
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
  assert.equal([...db.documents.keys()].filter(key=>key.startsWith('hotelReservations/')).length,1);
});

test('R14: public booking and staff booking share the same atomic room guard',async()=>{
  const db=database(); let release,entered;
  const gate=new Promise(resolve=>{release=resolve;});
  const arrived=new Promise(resolve=>{entered=resolve;});
  const api=await load('functions/lib/hotel-services.js',db,{
    branchPaymentConfiguration:async()=>({online:{enabled:true},paystack:{}}),withPaystackBranchRouting:x=>x,
    fetch:async()=>{entered();await gate;return Response.json({status:true,data:{authorization_url:'https://pay.example.invalid/test'}});}
  });
  db.documents.set('hotelRooms/room1',room);
  const pending=api.initPublicHotelReservationPayment({PAYSTACK_SECRET_KEY:'synthetic'},{...stay,GuestEmail:'guest@example.invalid'},'https://example.invalid');
  await arrived;
  await api.saveHotelReservation({},user,stay);
  release();
  await assert.rejects(pending,e=>e.retryable===true);
  assert.equal([...db.documents.keys()].filter(key=>key.startsWith('hotelReservations/')).length,1);
  assert.equal([...db.documents.keys()].filter(key=>key.startsWith('paymentIntents/')).length,0);
});

test('R15: editor cannot bypass paid check-in or transition a saved stay',async()=>{
  const db=database(),api=await load('functions/lib/hotel-services.js',db);
  db.documents.set('hotelRooms/room1',room);
  await assert.rejects(api.saveHotelReservation({},user,{...stay,Status:'Checked In'}),/status action/);
  await api.saveHotelReservation({},user,stay);
  await assert.rejects(api.saveHotelReservation({},user,{...stay,Status:'Checked Out'}),/status action/);
  await assert.rejects(api.changeHotelReservationStatus({},user,{ReservationId:'stay1',Status:'Checked In'}),/Full payment/);
  assert.equal(db.read('hotelReservations','stay1').Status,'Reserved');
  assert.equal(db.read('hotelRooms','room1').Status,'Available');
  await api.changeHotelReservationStatus({},user,{ReservationId:'stay1',Status:'Cancelled'});
  assert.equal(db.read('hotelReservations','stay1').Status,'Cancelled');
  await api.saveHotelReservation({},user,{...stay,ReservationId:'replacement'});
});

test('R16: clinic and kitchen concurrent stock movements commit once without partial logs',async()=>{
  for(const section of ['clinic','kitchen']) {
    const db=database(),api=await load('functions/api/staff-departments.js',db);
    db.documents.set(`${section}Inventory/main-Secondary-Item`,{ItemName:'Item',Quantity:10,BranchId:'main',SchoolSection:'Secondary'});
    const actor={branchId:'main',schoolSectionAccess:'Secondary',edition:'school'};
    const results=await Promise.allSettled([1,2].map(()=>api.recordMovement({},section,{ItemName:'Item',MovementType:'OUT',Quantity:7},actor)));
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(db.read(`${section}Inventory`,'main-Secondary-Item').Quantity,3);
    assert.equal([...db.documents.keys()].filter(key=>key.startsWith(`${section}Movements/`)).length,1);
  }
});

test('R14/R15: guest balance writes serialize with status changes and concurrent payments',async()=>{
  const db=database(),api=await load('functions/lib/hotel-services.js',db);
  db.documents.set('hotelRooms/room1',room);
  await api.saveHotelReservation({},user,stay);
  const payments=await Promise.allSettled([1,2].map(n=>api.recordHotelPayment({},user,{ReservationId:'stay1',PaymentId:`pay${n}`,Amount:700,Method:'Cash'})));
  assert.equal(payments.filter(row=>row.status==='fulfilled').length,1);
  assert.equal([...db.documents.keys()].filter(key=>key.startsWith('hotelPayments/')).length,1);
  await api.recordHotelPayment({},user,{ReservationId:'stay1',PaymentId:'remainder',Amount:300,Method:'Cash'});
  await api.changeHotelReservationStatus({},user,{ReservationId:'stay1',Status:'Checked In'});
  const finalization=await Promise.allSettled([
    api.changeHotelReservationStatus({},user,{ReservationId:'stay1',Status:'Checked Out'}),
    api.recordHotelCharge({},user,{ReservationId:'stay1',ChargeId:'late',Description:'Extra service',Amount:100})
  ]);
  assert.ok(finalization.some(row=>row.status==='rejected'));
  assert.ok(!(db.read('hotelReservations','stay1').Status==='Checked Out' && db.read('hotelCharges','late')),'a finalized stay cannot acquire a late unpaid charge');
});

test('R14: online verification changes payment fields atomically and preserves booking status on replay',async()=>{
  const db=database(),api=await load('functions/lib/hotel-services.js',db);
  db.documents.set('hotelRooms/room1',room);
  await api.saveHotelReservation({},user,stay);
  await api.finalizeHotelOnlinePayment({}, {ReservationId:'stay1',BranchId:'main',Reference:'online',Amount:1000});
  assert.equal(db.read('hotelReservations','stay1').PaymentStatus,'Paid');
  await api.changeHotelReservationStatus({},user,{ReservationId:'stay1',Status:'Checked In'});
  await api.finalizeHotelOnlinePayment({}, {ReservationId:'stay1',BranchId:'main',Reference:'online',Amount:1000});
  assert.equal(db.read('hotelReservations','stay1').Status,'Checked In');
  assert.equal([...db.documents.keys()].filter(key=>key.startsWith('hotelPayments/')).length,1);
});

test('R16: inventory edits and movements cannot overwrite each other or reassign section',async()=>{
  for(const section of ['clinic','kitchen']) {
    const db=database(),api=await load('functions/api/staff-departments.js',db);
    const id='main-Primary-Item', actor={branchId:'main',schoolSectionAccess:'All',edition:'school'};
    db.documents.set(`${section}Inventory/${id}`,{ItemName:'Item',Quantity:10,BranchId:'main',SchoolSection:'Primary'});
    const results=await Promise.allSettled([
      api.saveInventory({},section,{InventoryId:id,ItemName:'Item',Quantity:10,Notes:'Metadata edit'},actor),
      api.recordMovement({},section,{InventoryId:id,ItemName:'Item',MovementType:'OUT',Quantity:7},actor)
    ]);
    assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(db.read(`${section}Inventory`,id).SchoolSection,'Primary');
    const movements=[...db.documents.keys()].filter(key=>key.startsWith(`${section}Movements/`));
    assert.equal(db.read(`${section}Inventory`,id).Quantity,movements.length ? 3 : 10);
    for(const key of movements) assert.equal(db.documents.get(key).SchoolSection,'Primary');
  }
});

test('R17: desktop inventory preserves scoped IDs, rejects other branches and negative stock',async()=>{
  for(const section of ['clinic','kitchen']) {
    const db=database();
    const guard=await load('functions/api/backend.js',db,{clean,staffAccessFor:async()=>({edition:'school',allowedSections:[section]})},
      ['async function desktopSchoolOperationsActor(', 'function schoolOperationsScope(']);
    const api=await load('functions/api/backend.js',db,{
      clean,sameText:(a,b)=>clean(a).toLowerCase()===clean(b).toLowerCase(),asMoneyNumber:value=>Number(value)||0,
      safeDocumentId:value=>clean(value).replace(/[\/\\?#\[\]]/g,'-').replace(/\s+/g,'_'),nowIso:()=>new Date().toISOString(),
      normalizeInventory:value=>value,ledgerDocumentId:prefix=>`${prefix}-${crypto.randomUUID()}`,
      desktopSchoolOperationsActor:guard.desktopSchoolOperationsActor
    },['function desktopInventoryScope(', 'async function updateStudentBillingCategory(']);
    const collection=`${section}Inventory`, movements=`${section}Movements`;
    db.documents.set(`${collection}/main-Secondary-Rice`,{ItemName:'Rice',Quantity:10,BranchId:'main',SchoolSection:'Secondary'});
    db.documents.set(`${collection}/other-Secondary-Rice`,{ItemName:'Rice',Quantity:20,BranchId:'other',SchoolSection:'Secondary'});
    const body={UserUsername:'staff',UserBranchId:'main',UserSchoolSectionAccess:'Secondary',ItemName:'Rice',InventoryId:'main-Secondary-Rice'};
    await assert.rejects(api.desktopInventoryRows({}, {...body,UserUsername:''},collection),e=>e.status===403);
    await assert.rejects(api.recordStockMovement({}, {...body,MovementType:'OUT',Quantity:12},collection,movements,{label:section,prefix:'AUD'}),/Only 10/);
    await assert.rejects(api.recordStockMovement({}, {...body,InventoryId:'other-Secondary-Rice',MovementType:'OUT',Quantity:1},collection,movements,{label:section,prefix:'AUD'}),/outside/);
    await api.recordStockMovement({}, {...body,MovementType:'OUT',Quantity:3},collection,movements,{label:section,prefix:'AUD'});
    await api.saveInventoryItem({}, {...body,ItemName:'Rice renamed',OriginalItemName:'Rice',Quantity:7},collection,{label:section,unit:'kg',category:'Food'});
    assert.equal(db.read(collection,'main-Secondary-Rice').ItemName,'Rice renamed');
    assert.equal(db.read(collection,'main-Secondary-Rice').Quantity,7);
    assert.equal(db.read(collection,'other-Secondary-Rice').Quantity,20);
    assert.equal([...db.documents.keys()].filter(key=>key.startsWith(`${collection}/`)).length,2);
    assert.equal((await api.desktopInventoryRows({},body,collection)).length,1);
  }
});
