import {billingFixture,mapping,period} from './hospital-billing-fixture.mjs';
import {env,actor,request} from './hospital-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
export {request,period,env};
export const procurementActors=Object.fromEntries(Object.entries({owner:'Super Admin',manager:'Hospital Administrator',pharmacist:'Pharmacist',cashier:'Hospital Cashier',director:'Medical Director',nurse:'Nurse',doctor:'Doctor',reception:'Registration Officer'}).map(([key,role])=>[key,{...actor,role,username:`procurement-${key}`,displayName:`Test ${role}`,allowedSections:['hospitalPatients','hospitalReception','hospitalPharmacy','hospitalBilling','hospitalOrders','hospitalConsultations','hospitalTriage']} ]));
export async function procurementFixture(){
  const f=await billingFixture();const services=Object.fromEntries(Object.entries(procurementActors).map(([k,u])=>[k,createHospitalService(env,u,f.db)]));
  for(const [Code,Type]of [['5005','Expense'],['2100','Liability']])f.store.set(`chartOfAccounts/${Code}`,{Code,Name:'Synthetic procurement account',Type,Active:'YES',__id:Code,__updateTime:`account-${Code}`});
  const current=(await services.owner.billingSettings(request())).settings;
  await services.owner.saveBillingSettings(request({Revision:current.Revision,Settings:{...mapping,PharmacyPurchases:'5005',SupplierPayable:'2100'}}));
  await services.owner.saveMedicineCatalogItem(request({Item:{Code:'MED-PROC',Medicine:'Synthetic training medicine',Strength:'500 mg',Form:'Tablet',Unit:'Tablet',Active:true}}));
  const item=(await services.pharmacist.medicineCatalog(request())).items[0];
  await services.owner.savePharmacySupplier(request({Supplier:{Code:'SUP-TEST',Name:'Synthetic supplier',Active:true}}));
  const supplier=(await services.owner.pharmacySuppliers(request({Code:'SUP-TEST'}))).items[0];
  const draftBody=(extra={})=>request({SupplierId:supplier.SupplierId,Reference:`PO-${crypto.randomUUID()}`,Lines:[{LineCode:'L1',CatalogId:item.CatalogId,CatalogRevision:item.Revision,Quantity:10,UnitCost:'2.00'}],...extra});
  const purchase=async extra=>{const result=await services.pharmacist.savePharmacyPurchase(draftBody(extra));return (await services.owner.pharmacyPurchase(request(result))).purchase;};
  const transition=async(row,Decision,service=services.owner)=>{await service.transitionPharmacyPurchase(request({PurchaseId:row.PurchaseId,Revision:row.Revision,Decision,Reason:'Verified synthetic purchase'}));return (await services.owner.pharmacyPurchase(request({PurchaseId:row.PurchaseId}))).purchase;};
  const approved=async(extra={})=>transition(await transition(await purchase(extra),'Submit',services.pharmacist),'Approve');
  const receiveBody=(row,extra={})=>request({PurchaseId:row.PurchaseId,Revision:row.Revision,LineCode:'L1',Quantity:5,BatchNumber:'LOT-PROC',ExpiryDate:'2027-10-01',UnitPrice:'3.00',DeliveryReference:`DEL-${crypto.randomUUID()}`,DeliveryLine:'1',Confirmed:true,...extra});
  const receive=async(row,extra={})=>{const saved=await services.pharmacist.receivePharmacyPurchase(receiveBody(row,extra));const receipt=f.rows('PharmacyReceipts').find(r=>r.ReceiptId===saved.ReceiptId);return {...receipt,Revision:receipt.__updateTime};};
  const billBody=(receipts,extra={})=>request({SupplierId:supplier.SupplierId,Reference:`INV-${crypto.randomUUID()}`,InvoiceDate:'2026-10-26',DueDate:'2026-11-25',ReceiptIds:receipts.map(r=>r.ReceiptId),Amount:(receipts.reduce((s,r)=>s+r.AmountCents-r.ReturnedCostCents,0)/100).toFixed(2),Confirmed:true,...extra});
  const bill=async(receipts,extra={})=>{const r=await services.cashier.saveSupplierBill(billBody(receipts,extra));return (await services.owner.supplierBill(request(r))).bill;};
  const billTransition=async(row,Decision,service=services.owner)=>{await service.transitionSupplierBill(request({BillId:row.BillId,Revision:row.Revision,Decision,Reason:'Verified synthetic invoice',Confirmed:true}));return (await services.owner.supplierBill(request({BillId:row.BillId}))).bill;};
  const approvedBill=async(receipts,extra={})=>billTransition(await billTransition(await bill(receipts,extra),'Submit',services.cashier),'Approve');
  return {...f,...services,item,supplier,draftBody,purchase,transition,approved,receiveBody,receive,billBody,bill,billTransition,approvedBill};
}
