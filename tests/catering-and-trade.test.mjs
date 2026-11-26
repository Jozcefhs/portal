import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeCounter, tradeLine, tradeItemSetup } from '../functions/lib/trade-counter.js';
import { cateringOrders } from '../functions/lib/catering-orders.js';

const user={edition:'organization',branchId:'main',allowedSections:['restaurant','organizationStore'],username:'staff'};
function fixture() {
  const rows=new Map();
  let version=0;
  const key=(path,id)=>path+'/'+id;
  const put=(path,id,data)=>rows.set(key(path,id),structuredClone({...data,__id:id,__updateTime:String(++version)}));
  const io={
    getDocument:async(_,path,id)=>structuredClone(rows.get(key(path,id))),
    queryCollectionPages:async(_,path)=>Array.from(rows.entries()).filter(([k])=>k.startsWith(path+'/')).map(([,row])=>structuredClone(row)),
    batchCommitDocuments:async(_,writes)=>{
      const keys=new Set();
      for(const w of writes) {
        const k=key(w.collectionPath,w.documentId);
        assert.ok(!keys.has(k));keys.add(k);
        const row=rows.get(k);
        if((w.exists===false && row) || (w.updateTime && row?.__updateTime!==w.updateTime)) throw Error('Conflicting transaction');
      }
      for(const w of writes) put(w.collectionPath,w.documentId,w.data);
    }
  };
  const item={BranchId:'main',OrganisationEdition:'organization',StoreType:'Organisation Store',ItemCode:'CAB',ItemName:'Cable',Quantity:100,Price:100,TradeMode:'cable',CoilMetres:10};
  put('storeItems','cab',item);
  put('storeItems','fan',{...item,ItemCode:'FAN',ItemName:'Fan',TradeMode:'serial',WarrantyDays:365,Quantity:4});
  put('restaurantInventory','meal',{BranchId:'main',ItemName:'Party rice',Unit:'portion',Quantity:20,SalePrice:500});
  const trade=(operation,payload,staff=user)=>tradeCounter({},staff,{Operation:operation,QuoteNo:'Q1',...payload},io);
  const catering=(operation,payload,staff=user)=>cateringOrders({},staff,{Operation:operation,OrderNo:'B1',...payload},io);
  return {rows,put,trade,catering,version:()=>version};
}
const order={Kind:'Event catering',CustomerName:'Example client',Contact:'Demo contact',Guests:10,ServiceAt:'2027-03-01T14:00',Fulfilment:'On-site service',Venue:'Event hall',Items:[{InventoryDocumentId:'meal',Quantity:10}]};
const bookQuote=(trade,item,qty,unit)=>trade('quote',{CustomerName:'Builder',Items:[{InventoryDocumentId:item,Quantity:qty,Unit:unit}]});
test('cable measurements and item setup use canonical metres with locked quotation prices',async()=>{
  const f=fixture(), cable=f.rows.get('storeItems/cab');
  assert.equal(tradeLine(cable,{Quantity:2,Unit:'yard'}).Quantity,1.8288);
  assert.equal(tradeLine(cable,{Quantity:2,Unit:'coil'}).Quantity,20);
  assert.equal(tradeLine(cable,{Quantity:2.5,Unit:'metre'}).Amount,250);
  assert.throws(()=>tradeLine(cable,{Quantity:0.5,Unit:'coil'}));
  assert.throws(()=>tradeItemSetup({TradeMode:'standard'},cable));
  await bookQuote(f.trade,'cab',2,'yard');
  f.put('storeItems','cab',{...cable,Price:200});
  const sale=await f.trade('sell',{Method:'Credit'});
  assert.equal(sale.quote.Balance,182.88);
  assert.equal(f.rows.get('storeItems/cab').Quantity,98.1712);
  const before=f.version();
  await f.trade('sell',{Method:'Credit'});assert.equal(f.version(),before);
  await f.trade('payment',{Method:'Bank',Reference:'RC1',Amount:100});
  const v=f.version();await f.trade('payment',{Method:'Bank',Reference:'RC1',Amount:100});assert.equal(f.version(),v);
  await assert.rejects(f.trade('payment',{Method:'Bank',Reference:'RC1',Amount:50}));
  await assert.rejects(f.trade('payment',{Method:'Bank',Reference:'RC2',Amount:90}));
  assert.equal((await f.trade('payment',{Method:'Bank',Reference:'RC2',Amount:82.88})).quote.Status,'Paid');
});
test('serial sale and warranty replacement reject duplicates and retain expiry',async()=>{
  const f=fixture();await bookQuote(f.trade,'fan',2,'piece');
  await assert.rejects(f.trade('sell',{Method:'Cash',Serials:{0:['a','A']}}));
  assert.equal(f.rows.get('storeItems/fan').Quantity,4);
  await f.trade('sell',{Method:'Cash',Serials:{0:['a','b']}});
  assert.equal(f.rows.get('storeItems/fan').Quantity,2);
  await assert.rejects(f.trade('replace',{Serial:'A',NewSerial:'B',Reason:'Faulty'}));
  const old=(await f.trade('lookup',{Serial:'A'})).serial;
  const swap={Serial:'a',NewSerial:'C',Reason:'Faulty motor'};
  await f.trade('replace',swap);
  assert.equal((await f.trade('lookup',{Serial:'c'})).serial.ExpiresAt,old.ExpiresAt);
  await f.trade('replace',swap);assert.equal(f.rows.get('storeItems/fan').Quantity,1);
  await assert.rejects(f.trade('replace',{...swap,NewSerial:'D'}));
});
test('event deposit, kitchen stages, handover and balance collection post once',async()=>{
  const f=fixture();
  const booked=(await f.catering('create',order)).order;
  assert.equal(booked.Amount,5000);assert.equal(booked.Guests,10);
  const stages=status=>f.catering('progress',{Status:status});
  const pay=(ref,amount)=>f.catering('payment',{Reference:ref,Amount:amount,Method:'Cash'});
  await pay('A',2000);const v=f.version();await pay('A',2000);assert.equal(f.version(),v);
  await assert.rejects(stages('Cancelled'));await assert.rejects(stages('Fulfilled'));
  await stages('Preparing');await stages('Ready');await stages('Fulfilled');
  assert.equal(f.rows.get('restaurantInventory/meal').Quantity,10);
  const after=f.version();await stages('Fulfilled');assert.equal(f.version(),after);
  assert.equal((await pay('B',3000)).order.Balance,0);
  const journals=Array.from(f.rows.entries()).filter(([k])=>k.startsWith('accountingJournals/')).map(([,j])=>j);
  assert.equal(journals.length,3);
  for(const j of journals) assert.equal(j.TotalDebit,j.TotalCredit);
  assert.deepEqual(journals[1].Lines.map(l=>[l.AccountCode,l.Debit,l.Credit]),[['2110',2000,0],['1110',3000,0],['4130',0,5000]]);
  assert.equal((await f.catering('list',{})).orders[0].Status,'Fulfilled');
});
test('supply bookings support collection, cancellation and short-stock recovery',async()=>{
  const f=fixture(), supply={...order,Kind:'Supply order',Fulfilment:'Collection',Venue:'',Guests:0};
  await f.catering('create',supply);await f.catering('progress',{Status:'Cancelled'});
  await assert.rejects(f.catering('payment',{Reference:'A',Amount:10,Method:'Cash'}));
  await f.catering('create',{...supply,OrderNo:'B2'});
  for (const Status of ['Preparing','Ready']) await f.catering('progress',{OrderNo:'B2',Status});
  const row=f.rows.get('restaurantInventory/meal');f.put('restaurantInventory','meal',{...row,Quantity:9});
  const v=f.version();await assert.rejects(f.catering('progress',{OrderNo:'B2',Status:'Fulfilled'}));assert.equal(f.version(),v);
  f.put('restaurantInventory','meal',row);
  await f.catering('progress',{OrderNo:'B2',Status:'Fulfilled'});
  assert.equal(f.rows.get('restaurantInventory/meal').Quantity,10);
});
test('module, edition, subscription and working branch checks apply on the server',async()=>{
  const f=fixture(), before=f.version();
  for(const override of [{edition:'school'},{branchId:'all'},{allowedSections:[]},{subscriptionReadOnly:true},{branchId:'west'}]) {
    await assert.rejects(f.catering('create',order,{...user,...override}));
    await assert.rejects(f.trade('quote',{CustomerName:'Client',Items:[{InventoryDocumentId:'cab',Quantity:2,Unit:'coil'}]},{...user,...override}));
  }
  assert.equal(f.version(),before);
});

test('a paid counter sale issues measured cable and serial goods atomically and replays once',async()=>{
  const f=fixture();
  const inputs={Method:'Cash',CustomerName:'Walk-in',Items:[
    {InventoryDocumentId:'cab',Unit:'yard',Quantity:1},{InventoryDocumentId:'fan',Unit:'piece',Quantity:1}],Serials:[[],['00019']]};
  await assert.rejects(f.trade('counterSale',{...inputs,Serials:[]}));
  assert.equal(f.rows.get('storeItems/cab').Quantity,100);
  const saved=(await f.trade('counterSale',inputs)).quote;
  assert.equal(saved.Status,'Paid');assert.equal(saved.Balance,0);assert.equal(saved.Amount,191.44);
  assert.equal(f.rows.get('storeItems/cab').Quantity,99.0856);
  const version=f.version();await f.trade('counterSale',inputs);assert.equal(f.version(),version);
});
