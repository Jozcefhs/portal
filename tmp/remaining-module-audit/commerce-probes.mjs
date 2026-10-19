import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Isolated audit probes only. All database/network functions are synthetic.
const root = new URL('../../', import.meta.url);
const clone = x => x == null ? x : structuredClone(x);
async function harness(file, extra = {}) {
  const docs = new Map();
  const ctx = {
    crypto: globalThis.crypto, URL, URLSearchParams, TextEncoder, console,
    fetch: () => { throw new Error('Live network forbidden'); },
    getDocument: async (_, c, id) => clone(docs.get(`${c}/${id}`) || null),
    listCollection: async (_, c) => [...docs].filter(([key]) => key.startsWith(`${c}/`)).map(([key, value]) => ({...clone(value), __id: key.slice(c.length + 1)})),
    queryCollection: async (_, c, {filters = [], limit = 1000} = {}) => [...docs].filter(([key]) => key.startsWith(`${c}/`)).map(([key, value]) => ({...clone(value), __id:key.slice(c.length+1)})).filter(row => filters.every(({field,value}) => row[field] === value)).slice(0,limit),
    upsertDocument: async (_, c, id, value) => { docs.set(`${c}/${id}`,clone(value)); return clone(value); },
    schoolSectionFor: row => (row.SchoolSection || 'Secondary').toLowerCase(),
    resolveOrganizationConfig: () => ({Edition:'faith', FeatureFlags:{hotel:true}}),
    normalizeOrganizationEdition: x => x,
    ...extra,
  };
  vm.createContext(ctx);
  const source = (await readFile(new URL(file, root),'utf8')).replace(/^import[\s\S]*?from '[^']+';\r?\n/gm,'').replace(/^export /gm,'');
  vm.runInContext(source,ctx,{filename:file});
  return {ctx,docs};
}
const hotel = await harness('functions/lib/hotel-services.js');
const hotelUser = {role:'Hotel User', branchId:'main', username:'main-clerk'};
hotel.docs.set('hotelRooms/other-101',{RoomId:'other-101',RoomNumber:'101',BranchId:'other',Status:'Available',Capacity:2,NightlyRate:10000});
await hotel.ctx.saveHotelRoom({},hotelUser,{BranchId:'other',RoomId:'other-101',RoomNumber:'CHANGED',Status:'Available',Capacity:2,NightlyRate:10000});
assert.equal(hotel.docs.get('hotelRooms/other-101').RoomNumber,'CHANGED');
console.log('CONFIRMED: main-branch Hotel User can change room in other branch using body.BranchId');
hotel.docs.set('hotelRooms/main-101',{RoomId:'main-101',RoomNumber:'101',BranchId:'main',Status:'Available',Capacity:2,NightlyRate:10000});
await hotel.ctx.saveHotelReservation({},hotelUser,{ReservationId:'unpaid',GuestName:'Synthetic Guest',RoomId:'main-101',ArrivalDate:'2026-11-01',DepartureDate:'2026-11-02',Status:'Checked In'});
assert.equal(hotel.docs.get('hotelReservations/unpaid').Status,'Checked In');
assert.equal(hotel.docs.get('hotelRooms/main-101').Status,'Available');
console.log('CONFIRMED: unpaid stay saved Checked In via reservation editor route; room still Available');
hotel.docs.delete('hotelReservations/unpaid');
const res = await Promise.all([1,2].map(n=>hotel.ctx.saveHotelReservation({},hotelUser,{ReservationId:`race-${n}`,GuestName:`Synthetic Guest ${n}`,RoomId:'main-101',ArrivalDate:'2026-11-01',DepartureDate:'2026-11-02'})));
assert.equal(res.length,2);
assert.ok(hotel.docs.has('hotelReservations/race-1') && hotel.docs.has('hotelReservations/race-2'));
console.log('CONFIRMED: simultaneous overlapping bookings both saved for same room/dates');

let transfer;
const commerce = await harness('functions/lib/organization-commerce.js',{
  restrictVendorInventory: async (_,__,___,rows) => rows,
  snapshotVendorCart: async (_,cart) => cart,
  createDirectTransferRequest: async (_,input) => { transfer=input; return {ok:true}; },
});
commerce.docs.set('storeItems/Organisation_Store-BOOK-main-Secondary',{StoreType:'Organisation Store',ItemCode:'BOOK',ItemName:'Synthetic Book',BranchId:'main',OrganisationEdition:'faith',Quantity:5,Price:1000,__updateTime:'2026-01-01T00:00:00Z'});
await commerce.ctx.initializeDirectTransferOrganizationCommerceSale({},'organizationStore',{SaleRequestId:'audit-transfer',CustomerEmail:'synthetic@example.invalid',Items:[{ItemCode:'BOOK',Quantity:1}]},{branchId:'main',edition:'faith'});
assert.equal(transfer.payload.Items[0].Reference,'Organisation_Store-BOOK-main-Secondary');
await assert.rejects(commerce.ctx.recordManualOrganizationCommerceSale({},'organizationStore',{...transfer.payload,PaymentMethod:'Bank Transfer',PaymentReference:'synthetic-bank',ExpectedAmount:1000},{branchId:'main',edition:'faith'}),/not found in this branch/);
console.log('CONFIRMED: valid organisation-store transfer cannot be approved because saved Reference uses document ID but lookup only accepts ItemCode');

const departments = await harness('functions/api/staff-departments.js');
departments.docs.set('kitchenInventory/main-Secondary-Rice',{ItemName:'Rice',Quantity:10,BranchId:'main',SchoolSection:'Secondary',Unit:'kg'});
const kitchenUser={branchId:'main',schoolSectionAccess:'Secondary',edition:'school',username:'synthetic'};
await Promise.all([1,2].map(()=>departments.ctx.recordMovement({},'kitchen',{ItemName:'Rice',MovementType:'OUT',Quantity:7},kitchenUser)));
assert.equal(departments.docs.get('kitchenInventory/main-Secondary-Rice').Quantity,3);
assert.equal([...departments.docs.keys()].filter(k=>k.startsWith('kitchenMovements/')).length,2);
console.log('CONFIRMED: two 7kg issues from 10kg accepted; stock shows 3kg, movement ledger shows 14kg issued');

// Extract unchanged legacy handlers with their minimal scalar helpers.
const backendSource=await readFile(new URL('functions/api/backend.js',root),'utf8');
const legacy = {crypto:globalThis.crypto,clean:x=>String(x??'').trim(),sameText:(a,b)=>String(a??'').toLowerCase()===String(b??'').toLowerCase(),asMoneyNumber:x=>Number(x)||0,safeDocumentId:x=>String(x??'').replace(/[\/\\?#\[\]]/g,'-'),nowIso:()=>new Date().toISOString(),normalizeInventory:x=>x,ledgerDocumentId:p=>`${p}-audit`,listCollection:departments.ctx.listCollection,upsertDocument:departments.ctx.upsertDocument};
vm.createContext(legacy);
vm.runInContext(backendSource.slice(backendSource.indexOf('async function saveInventoryItem('),backendSource.indexOf('async function updateStudentBillingCategory(')),legacy);
await legacy.recordStockMovement({}, {ItemName:'Rice',MovementType:'OUT',Quantity:12,UserBranchId:'other'},'kitchenInventory','kitchenMovements',{label:'Kitchen',prefix:'KIT',actor:'Kitchen'});
assert.equal(departments.docs.get('kitchenInventory/Rice').Quantity,-9);
assert.equal(departments.docs.get('kitchenInventory/Rice').BranchId,'main');
assert.ok(departments.docs.has('kitchenInventory/main-Secondary-Rice'));
console.log('CONFIRMED: desktop other-branch request uses main-branch item and writes duplicate name-only stock at -9kg');

const paidOrder=await harness('functions/api/verify-payment.js',{
  createDocumentIfAbsent: async (_,c,id,data)=>{
    paidOrder.docs.set(`${c}/${id}`,clone(data)); return {created:true,document:data};
  }
});
paidOrder.docs.set('storeItems/Bookstore-BOOK-main-Secondary',{ItemCode:'BOOK',ItemName:'Synthetic Book',StoreType:'Bookstore',BranchId:'main',SchoolSection:'Secondary',Quantity:5,Price:1000});
const orderedItem={ItemCode:'BOOK',ItemName:'Synthetic Book',StoreType:'Bookstore',BranchId:'main',SchoolSection:'Secondary',Quantity:1,UnitPrice:1000};
const paid=await paidOrder.ctx.createPaidStoreOrder({}, {OrderNo:'audit-parent',BranchId:'main'},[orderedItem],'Bookstore');
assert.equal(paidOrder.docs.get('storeItems/Bookstore-BOOK-main-Secondary').Quantity,5);
assert.equal(paidOrder.docs.get('storeOrders/audit-parent').InventoryStatus,'Review Required');
console.log('CONFIRMED: paid parent order for web/import-created item leaves stock unchanged and reports zero available because confirmation looks for legacy unscoped ID');
