import {stockFixture,env,request,createHospitalService,stockOwner,actors} from './hospital-stock-control-fixture.mjs';
export {env,request,createHospitalService,stockOwner,actors};
export async function disposalFixture(){
  const f=await stockFixture();
  await f.pharmacist.quarantineStock(request({BatchId:f.batch().BatchId,Revision:f.batch().__updateTime,Quantity:8,Reason:'Quarantined synthetic stock for disposal verification'}));
  const proposal=(extra={})=>request({BatchId:f.batch().BatchId,BatchRevision:f.batch().__updateTime,Reference:crypto.randomUUID(),Quantity:3,DisposedAt:'2026-10-26T12:00:00Z',Method:'Recorded facility disposal process',Reason:'Damaged packaging',Evidence:'Disposal certificate example',Confirmed:true,...extra});
  const submit=(extra={})=>f.pharmacist.submitStockDisposal(proposal(extra));
  const review=async(DisposalId,Decision='Approve',extra={})=>request({DisposalId,Revision:(await f.owner.stockDisposalDetails(request({DisposalId}))).disposal.Revision,Decision,Reason:'Independently checked the recorded disposal',Evidence:'Witness register example',Confirmed:true,Witnessed:Decision==='Approve',...extra});
  return {...f,proposal,submit,review};
}
