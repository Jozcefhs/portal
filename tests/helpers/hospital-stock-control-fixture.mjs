import {ordersFixture,actors} from './hospital-orders-fixture.mjs';
import {env,request} from './hospital-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
export {env,request,createHospitalService,actors};
export const stockOwner={...actors.pharmacist,username:'stock-owner',displayName:'Stock Reviewer',role:'Hospital Administrator'};
export async function stockFixture(){
  const f=await ordersFixture(),owner=createHospitalService(env,stockOwner,f.db),received=await f.receive();
  const batch=()=>f.rows('MedicineBatches').find(b=>b.BatchId===received.BatchId);
  const proposal=(extra={})=>request({BatchId:received.BatchId,BatchRevision:batch().__updateTime,Reference:crypto.randomUUID(),CountedAt:'2026-10-26T12:00:00Z',OnHand:18,Quarantined:0,Reason:'Physical count checked against the shelf and receipt',Confirmed:true,...extra});
  const submit=(extra={})=>f.pharmacist.submitStockCount(proposal(extra));
  const review=async(CountId,Decision='Approve',extra={})=>request({CountId,Revision:(await owner.stockCountDetails(request({CountId}))).count.Revision,Decision,Reason:'Independently reviewed physical count evidence',Confirmed:true,...extra});
  return {...f,owner,batch,proposal,submit,review};
}
