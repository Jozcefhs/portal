import {fail,id,nameKey} from './hospital-model.js';
import {field} from './hospital-orders-model.js';
import {amount,cents,paymentFields} from './hospital-billing-model.js';

// A remittance records one confirmed payment, allocated to at most 20 supplier
// invoices. It neither moves money nor changes stock or patient charges.
export function createHospitalSupplierRemittanceService(ctx){
  const {need,confirm,branch,operation,read,scoped,revision,keyFor,settings,postingMany,
    write,strip,view,stamp,clock,snapshot,balance,billStatus,supplierChange,events,journal,line}=ctx;
  return {
    async recordSupplierRemittance(body){
      need('pay');confirm(body);
      const BranchId=await branch(body),SupplierId=id(body.SupplierId);
      const fields={...paymentFields(body),Note:field(body,'Note',1000)};
      if(!Array.isArray(body.Allocations)||!body.Allocations.length||body.Allocations.length>20)fail('Select between 1 and 20 supplier invoices.');
      if(body.Allocations.some(row=>!row||typeof row!=='object'||Array.isArray(row)))fail('Use a valid invoice allocation.');
      const allocations=body.Allocations.map(row=>({BillId:id(row.BillId),Revision:field(row,'Revision',160,true),AmountCents:amount(row.Amount)}));
      if(new Set(allocations.map(row=>row.BillId)).size!==allocations.length)fail('Select each supplier invoice only once.');
      if(cents(allocations.reduce((sum,row)=>sum+row.AmountCents,0))!==fields.AmountCents)fail('The invoice allocations must equal the confirmed payment amount.');
      return operation(body,'recordSupplierRemittance',async key=>{
        // Share the single-payment reference guard: neither path can record the
        // same bank/cash evidence again with a fresh request ID.
        const referenceId=await keyFor('supplier-payment',fields.Method==='Cash'?BranchId:'all-branches',fields.Method,nameKey(fields.Reference));
        if(await read('ProcurementReferences',referenceId))fail('This supplier payment reference was already recorded.',409);
        const bills=await Promise.all(allocations.map(row=>scoped('SupplierBills',row.BillId,BranchId)));
        bills.forEach((bill,index)=>{
          revision(allocations[index],bill);
          if(bill.SupplierId!==SupplierId)fail('All selected invoices must belong to the same supplier.',409);
          if(!['Approved','Part paid'].includes(bill.Status)||allocations[index].AmountCents>balance(bill))fail('Allocate only the unpaid balance of an approved supplier invoice.',409);
        });
        const [supplier,config]=await Promise.all([scoped('PharmacySuppliers',SupplierId,BranchId),settings(BranchId)]);
        const cashKey=fields.Method==='Cash'?'Cash':'Bank';
        const mappings=bills.map(bill=>({SupplierPayable:bill.Mapping?.SupplierPayable,[cashKey]:config?.[cashKey]}));
        await postingMany(mappings);
        const paymentIds=await Promise.all(bills.map(bill=>keyFor('remittance-payment',key,bill.BillId)));
        const writes=[],debits=new Map(),saved=[];
        bills.forEach((bill,index)=>{
          const paid=allocations[index].AmountCents,PaymentId=paymentIds[index],Mapping=mappings[index];
          const payment={PaymentId,RemittanceId:key,BillId:bill.BillId,BranchId,SupplierId,Supplier:snapshot(supplier),BillReference:bill.Reference,
            ...fields,AmountCents:paid,Mapping,ReversedCents:0,...stamp()};
          const next={...strip(bill),PaidCents:cents(bill.PaidCents+paid),UpdatedAt:clock()};next.Status=billStatus(next);
          saved.push({BillId:bill.BillId,PaymentId,BillReference:bill.Reference,InvoiceDate:bill.InvoiceDate,AmountCents:paid,Mapping});
          debits.set(Mapping.SupplierPayable,cents((debits.get(Mapping.SupplierPayable)||0)+paid));
          writes.push(write('SupplierBills',bill.BillId,next,bill),write('SupplierPayments',PaymentId,payment,null),
            // Per-invoice business history, with one security audit for the remittance.
            ...events(PaymentId,BranchId,'Allocate supplier remittance',next,{RemittanceId:key,PaymentId,AmountCents:paid,Reference:fields.Reference}).slice(0,1));
        });
        const row={RemittanceId:key,BranchId,SupplierId,Supplier:snapshot(supplier),...fields,Allocations:saved,...stamp()};
        const postingContext={BranchId,person:{PatientId:''},SupplierId,SupplierBillId:'',SupplierRemittanceId:key,Reference:fields.Reference};
        return {writes:[...writes,write('SupplierRemittances',key,row,null),supplierChange(supplier,-fields.AmountCents),
          write('ProcurementReferences',referenceId,{RemittanceId:key,BranchId},null),
          ...journal(key,postingContext,'Supplier remittance',[...debits].map(([account,total])=>line(account,total)).concat(line(config[cashKey],0,fields.AmountCents))),
          ...events(key,BranchId,'Record confirmed supplier remittance',row,{InvoiceCount:saved.length})],result:{RemittanceId:key}};
      });
    },
    async supplierRemittance(body){
      need('finance');const BranchId=await branch(body),row=await scoped('SupplierRemittances',id(body.RemittanceId),BranchId);
      if(!Array.isArray(row.Allocations)||row.Allocations.length<1||row.Allocations.length>20)fail('This remittance requires an authorised record review.',409);
      const payments=await Promise.all(row.Allocations.map(a=>scoped('SupplierPayments',id(a.PaymentId),BranchId)));
      if(payments.some((p,i)=>p.RemittanceId!==row.RemittanceId||p.SupplierId!==row.SupplierId||p.BillId!==row.Allocations[i].BillId||p.AmountCents!==row.Allocations[i].AmountCents))fail('A payment allocation no longer matches the saved remittance. Review the records before proceeding.',409);
      const ReversedCents=cents(payments.reduce((sum,p)=>sum+p.ReversedCents,0));
      return {ok:true,remittance:{...view(row),ReversedCents,NetPaidCents:cents(row.AmountCents-ReversedCents)},payments:payments.map(view)};
    }
  };
}
