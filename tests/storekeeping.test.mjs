import test from 'node:test';
import assert from 'node:assert/strict';
import { handleStorekeeping } from '../functions/lib/storekeeping.js';
import { staffUserForAccess } from '../functions/lib/staff-auth.js';
import { defaultModulesForRole } from '../functions/lib/role-module-access.js';
import { normalizeOrganizationEdition } from '../functions/lib/organization-config.js';

function fixture(edition) {
  const state = new Map(), commits = []; let counter=0, lost=false;
  const scope={BranchId:'main',OrganisationEdition:edition,ScopeKey:edition+'--main'};
  const user=(username,role)=>staffUserForAccess({ username,role,branchId:'main',schoolSectionAccess:'All' },{
    edition, featureFlags:{procurement:true,clinic:true},subscriptionActive:true,allowedSections:role==='Department User'?['payroll']:['storekeeping'] });
  const buyer=user('buyer','Procurement Officer'), keeper=user('keeper','Storekeeper'), office=user('office','Department User');
  function put(c,key,data){state.set(c+'/'+key,{...structuredClone(data),__id:key,__name:c+'/'+key,__updateTime:String(++counter)});}
  const get=(c,key)=>structuredClone(state.get(c+'/'+key) ?? null);
  const deps={get:async(_,c,key)=>get(c,key),page:async(_,c,q)=>Array.from(state.values()).filter(r=>r.__name.startsWith(c+'/') &&
    q.filters.every(f=>f.op==='in'?f.value.includes(r[f.field]):r[f.field]===f.value)).slice(0,q.limit),
    recipientAccess:async(_,account)=>({allowedSections:account.Role==='Storekeeper'?['storekeeping']:[]}),
    findStaff:async(_,name)=>({Role:name==='office'?'Department User':'Storekeeper',BranchId:name==='foreign'?'east':'main'}),
    commit:async(_,writes)=>{
      if(writes.some(w=>{const old=get(w.collectionPath,w.documentId);return w.exists===false?!!old:!old||w.updateTime!==old.__updateTime;})) throw Object.assign(Error('Conflict'),{status:409});
      assert.equal(new Set(writes.map(w=>w.collectionPath+'/'+w.documentId)).size,writes.length);
      for(const w of writes) put(w.collectionPath,w.documentId,w.data);
      commits.push(writes); if(lost){lost=false;throw Error('lost acknowledgement');}
    }};
  put('procurementItems','item',{...scope,ItemId:'item',ItemName:'Chair',Unit:'pcs',Quantity:10,Revision:8,Legacy:'preserved'});
  put('procurementPurchases','purchase',{...scope,PurchaseId:'purchase',Lines:[{ItemId:'item',ReceivedQuantity:5}]});
  const run=(u,action,values={})=>handleStorekeeping({},u,{BranchId:'main',action,...values},deps);
  return {run,buyer,keeper,office,get,put,scope,commits,lose:()=>lost=true};
}
const editions=['school','faith','organization'];
if(normalizeOrganizationEdition('hospital')==='hospital') editions.push('hospital');
for(const edition of editions) {
  test(edition+' purchase allocation, stores, department return and linked replacement conserve stock under retries',async()=>{
    const f=fixture(edition), {run,buyer,keeper,office}=f;
    assert.ok(defaultModulesForRole('Storekeeper',{edition}).includes('storekeeping'));
    assert.ok(!defaultModulesForRole('Storekeeper',{edition}).includes('procurement'));
    const issue={Reference:'R1',ItemId:'item',Quantity:3,Recipient:'keeper',DestinationType:'Store',Destination:'Annex',Notes:'Split delivery',PurchaseId:'purchase'};
    f.lose();
    const main=await run(buyer,'issue',issue);
    assert.equal((await run(buyer,'issue',issue)).replayed,true);
    assert.equal(f.commits.length,1);
    await assert.rejects(run(buyer,'issue',{...issue,Quantity:2}),/reference/);
    await assert.rejects(run(buyer,'issue',{...issue,Reference:'over'}),/exceeds/);
    await assert.rejects(run(office,'accept',main));
    await run(keeper,'accept',main);
    await run(keeper,'accept',main);
    const dispatch=await run(keeper,'issue',{...issue,PurchaseId:'',SourceId:main.SlipId,Quantity:1,Reference:'R2',Recipient:'office',DestinationType:'Department',Destination:'Administration',AssetTag:'A01'});
    await run(office,'accept',dispatch);
    const back=await run(office,'return',{...issue,PurchaseId:'',SourceId:dispatch.SlipId,Quantity:1,Reference:'R3',Recipient:'keeper',Condition:'Damaged'});
    await run(keeper,'accept',back);
    const replacement=await run(keeper,'replace',{...issue,PurchaseId:'',SourceId:back.SlipId,Quantity:1,Reference:'R4',Recipient:'office',AssetTag:'B02'});
    await run(office,'accept',replacement);
    await assert.rejects(run(keeper,'replace',{...issue,PurchaseId:'',SourceId:back.SlipId,Quantity:1,Reference:'R5',Recipient:'office'}));
    assert.equal(f.get('procurementItems','item').Quantity,6);
    assert.equal(f.get('procurementItems','item').Legacy,'preserved');
    assert.equal(f.get('storekeepingHandovers',main.SlipId).HeldQuantity,2);
    assert.equal(f.get('storekeepingHandovers',back.SlipId).HeldQuantity,1);
    assert.equal(f.get('storekeepingHandovers',replacement.SlipId).HeldQuantity,1);
    assert.equal((await run(office,'mine')).rows.length,2);
    assert.equal((await run(keeper,'card',{ItemId:'item'})).rows.length,8);
    assert.equal(f.get('procurementPurchases','purchase').Lines[0].ReceivedQuantity,5);
  });
  test(edition+' permissions, concurrent posting, cancellation, inventory ownership and supplier reallocation',async()=>{
    const f=fixture(edition), {run,buyer,keeper,office}=f;
    const issue={Reference:'R1',ItemId:'item',Quantity:5,Recipient:'keeper',Destination:'Annex',DestinationType:'Store',Notes:'Custody',PurchaseId:'purchase',AssetTag:''};
    assert.equal((await run(office,'access')).keeper,false);
    await assert.rejects(run(office,'stock'));
    await assert.rejects(run(office,'issue',issue));
    await assert.rejects(run(buyer,'issue',{...issue,BranchId:'east'}));
    await assert.rejects(run(buyer,'issue',{...issue,Recipient:'foreign'}));
    await assert.rejects(run({...buyer,subscriptionReadOnly:true},'issue',issue));
    const [a,b]=await Promise.all([run(buyer,'issue',issue),run(buyer,'issue',issue)]);
    assert.equal(a.SlipId,b.SlipId);assert.equal(f.commits.length,1);
    await run(buyer,'cancel',a);await run(buyer,'cancel',a);
    assert.equal(f.get('procurementItems','item').Quantity,10);
    await run(buyer,'issue',{...issue,Reference:'R2'});
    assert.equal(f.commits.length,3);
    f.put('procurementItems','item',{...f.get('procurementItems','item'),VendorId:'third-party'});
    await assert.rejects(run(buyer,'issue',{...issue,Reference:'vendor'}),/organisation-owned/);
    await assert.rejects(run(keeper,'createpurchase',issue));
  });
  test(edition+' existing department receipt can be returned and replaced without duplicating departmental inventory', async()=>{
    const f=fixture(edition),{run,buyer,keeper,office,scope}=f;
    const school=edition==='school',dept=school?'clinic':'organizationStore',collection=school?'clinicInventory':'storeItems';
    f.put(collection,'original',{...scope,ItemName:'Chair',Unit:'pcs',Quantity:5,SchoolSection:'Primary',ProcurementItemId:'item',StoreType:'Organisation Store'});
    f.put('procurementTransfers','TRF-existing',{...scope,Revision:2,TransferId:'TRF-existing',Department:dept,SchoolSection:school?'Primary':'All',Lines:[{ItemId:'item',InventoryId:'original',ReceivedQuantity:3}]});
    const payload={Reference:'RET1',ItemId:'item',Quantity:2,SourceId:'TRF-existing',Recipient:'keeper',Destination:'Central store',Notes:'Exchanged',Condition:'Needs repair'};
    const back=await run(buyer,'return',payload);
    await run(keeper,'accept',back);
    assert.equal(f.get(collection,'original').Quantity,3);
    await assert.rejects(run(buyer,'return',{...payload,Reference:'RET2'}),/exceeds/);
    const replacement=await run(keeper,'replace',{...payload,Reference:'REPL1',SourceId:back.SlipId,Recipient:'office'});
    await run(office,'accept',replacement);
    assert.equal(f.get(collection,'original').Quantity,5);
    assert.equal(f.get('procurementItems','item').Quantity,8);
  });
}
test('storekeeper dispatches an approved request through Procurement without purchase authority',async()=>{
  const f=fixture('school');
  const line={ItemId:'item',InventoryId:'office-inventory',ItemName:'Chair',Unit:'pcs',Quantity:3,IssuedQuantity:0};
  f.put('procurementRequests','REQ-1',{...f.scope,SchoolSection:'Primary',Department:'clinic',RequisitionId:'REQ-1',Status:'APPROVED',Revision:1,Lines:[line]});
  f.put('clinicInventory','office-inventory',{...f.scope,SchoolSection:'Primary',Unit:'pcs',ItemName:'Chair',Quantity:2,ProcurementItemId:'item'});
  const body={RequisitionId:'REQ-1',RequestId:'keeper-request-1',ExpectedRevision:1,Notes:'Delivered for confirmation',Lines:[{ItemId:'item',Quantity:2}]};
  const sent=await f.run(f.keeper,'issueRequest',body);
  assert.equal((await f.run(f.keeper,'issueRequest',body)).TransferId,sent.TransferId);
  assert.equal(f.get('procurementItems','item').Quantity,8);
  assert.equal(f.get('clinicInventory','office-inventory').Quantity,2);
  assert.equal(f.get('procurementTransfers',sent.TransferId).Status,'IN_TRANSIT');
  await assert.rejects(f.run(f.office,'issueRequest',body));
});

test('an issued serial cannot be issued again from central or split by leaving the tag field blank',async()=>{
  const f=fixture('school');
  const issue={Reference:'SER1',ItemId:'item',Quantity:1,Recipient:'keeper',DestinationType:'Store',Destination:'Central',Notes:'Office goods',AssetTag:'A1'};
  const original=await f.run(f.buyer,'issue',issue);
  await f.run(f.keeper,'accept',original);
  await assert.rejects(f.run(f.buyer,'issue',{...issue,Reference:'SER2'}),/assigned/);
  await assert.rejects(f.run(f.keeper,'issue',{...issue,Reference:'SER3',SourceId:original.SlipId,Recipient:'office',DestinationType:'Department',Quantity:0.5,AssetTag:''}),/whole tagged unit/);
  assert.equal(f.get('procurementItems','item').Quantity,9);
  assert.equal(f.get('storekeepingHandovers',original.SlipId).HeldQuantity,1);
});
