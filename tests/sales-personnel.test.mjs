import test from 'node:test';
import assert from 'node:assert/strict';
import { salesCounter } from '../functions/lib/sales-counter.js';
import { rolesForEdition, withRequiredRoleModules, explicitModulesForUser } from '../functions/lib/role-module-access.js';
import { sectionAccessFor } from '../functions/lib/staff-auth.js';
const user={role:'Sales Personnel',username:'staff',edition:'organization',branchId:'main',allowedSections:['organizationStore','restaurant']};
const paid={__id:'Q1',__updateTime:'v1',SaleNo:'Q1',BranchId:'main',OrganisationEdition:'organization',SaleType:'organizationStore',
  CheckoutSource:'Public Store',PaymentStatus:'Paid',Status:'Paid',InventoryStatus:'Deducted',PaymentReference:'PAY1',Items:[{ItemName:'Wire',Quantity:2}],Amount:100};
function fixture(row={...paid}) {
  const writes=[];
  const io={getDocument:async(_,p,id)=>id===row.__id?{...row}:null,queryCollection:async(_,p,q)=>q.filters[0].value===row.PaymentReference?[{...row}]:[],
    batchCommitDocuments:async(_,batch)=>{assert.equal(batch.length,1);const w=batch[0];assert.equal(w.collectionPath,'organizationCommerceSales');assert.equal(w.updateTime,row.__updateTime);
      assert.deepEqual(w.updateMask,['IssuedAt','IssuedBy']);Object.assign(row,w.data,{__updateTime:'v2'});writes.push(w);}};
  const act=(action,extra={},staff=user)=>salesCounter({},staff,{section:'organizationStore',action,Reference:'PAY1',SaleNo:'Q1',...extra},io);
  return {act,writes,io};
}
test('Sales Personnel is a fixed Other Organisation role limited to subscribed counters',()=>{
  assert.ok(rolesForEdition('organization').includes(user.role));
  assert.ok(!rolesForEdition('school').includes(user.role));assert.ok(!rolesForEdition('faith').includes(user.role));
  assert.deepEqual(withRequiredRoleModules(user.role,['staffUsers','procurement'],'organization'),user.allowedSections);
  assert.deepEqual(explicitModulesForUser(null,{...user,tabAccess:['restaurant','staffUsers']},'organization'),[]);
  const access=sectionAccessFor({...user,approvalEnabled:true,tabAccess:['staffUsers','procurement']},{Edition:'organization',FeatureFlags:{organizationStore:true,restaurant:false}});
  assert.ok(!access.allowedSections.some(s=>['financeRequests','staffUsers','vendorSettlements','restaurant'].includes(s)));
});
test('paid QR lookup and handover use the existing receipt without another sale, charge or stock movement',async()=>{
  const f=fixture();
  assert.equal((await f.act('lookup')).sale.Items[0].Quantity,2);assert.equal(f.writes.length,0);
  assert.equal((await f.act('issue',{Reference:'Q1'})).sale.IssuedBy,'staff');
  assert.equal((await f.act('issue')).alreadyIssued,true);assert.equal(f.writes.length,1);
});
test('only verified paid public orders with deducted stock in the current branch can be issued',async()=>{
  for(const fields of [{BranchId:'west'},{PaymentStatus:'Pending'},{InventoryStatus:'Review Required'},{CheckoutSource:'Staff Point of Sale'},{Status:'Refunded'},{OrganisationEdition:'faith'},{SaleType:'restaurant'}]) {
    const f=fixture({...paid,...fields});await assert.rejects(f.act('issue'));assert.equal(f.writes.length,0);
  }
  const f=fixture();await assert.rejects(f.act('issue',{SaleNo:'different'}));await assert.rejects(f.act('issue',{},{...user,subscriptionReadOnly:true}));
  for(const action of ['saveitem','updateorder','quote','replace','payment','approvetransfer']) await assert.rejects(f.act(action));
  assert.equal(f.writes.length,0);
});
test('ordinary counter sale uses server pricing and strips management or payment-status fields',async()=>{
  const f=fixture();
  f.io.recordManualOrganizationCommerceSale=async(_,section,payload)=>{
    assert.equal(section,'organizationStore');assert.equal(payload.PaymentMethod,'Cash');
    for(const field of ['CheckoutSource','PaymentStatus','CollectionMode','ExpectedAmount','SaleDate'])assert.ok(!(field in payload));
    return {sale:{...paid,SaleNo:payload.SaleRequestId}};
  };
  const payload={RequestId:crypto.randomUUID(),Method:'Cash',Items:[{InventoryDocumentId:'wire',Quantity:1}],CheckoutSource:'Public Store',PaymentStatus:'Paid'};
  assert.match((await f.act('sell',payload)).sale.SaleNo,/^POS-/);
  await assert.rejects(f.act('sell',{...payload,Method:'Credit'}));
});
