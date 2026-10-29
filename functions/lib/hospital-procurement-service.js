import {fail,id,nameKey} from './hospital-model.js';
import {field,quantity,qty,money,chargeCents,cumulativeCredit,dateOnly,dateFilters,watDay} from './hospital-orders-model.js';
import {code,cents,amount,equal,paymentFields} from './hospital-billing-model.js';
import {stockReceiptFields,prepareStockReceipt} from './hospital-stock-receipt.js';

export function createHospitalProcurementService(ctx){
  const {user,capabilities,requireCapability,branch,clock,actor,strip,eq,auditWrite,operation,page,
    read,write,view,stamp,revision,unchanged,keyFor,settings,posting,postingMany,journal,line}=ctx;
  const can=cap=>capabilities.includes(cap),need=cap=>requireCapability(`procurement.${cap}`);
  const confirm=body=>{if(body.Confirmed!==true)fail('Confirm the supplier, quantities and financial details before saving.');};
  const snapshot=row=>Object.fromEntries(['SupplierId','Code','Name','Phone','Email','Address'].map(k=>[k,row[k]||'']));
  const balance=bill=>cents(bill.AmountCents-bill.CreditCents-bill.PaidCents);
  const billStatus=bill=>balance(bill)===0?'Settled':bill.PaidCents?'Part paid':'Approved';
  async function scoped(name,key,BranchId){const row=await read(name,key);if(!row||row.BranchId!==BranchId)fail('This record is unavailable in the selected branch.',404);return row;}
  function events(key,BranchId,Action,row,extra={}){
    const EntityId=row.PurchaseId||row.BillId||row.SupplierId;
    return [write('ProcurementEvents',key,{EventId:key,BranchId,EntityId,SupplierId:row.SupplierId,Action,Snapshot:strip(row),...extra,...stamp()},null),
      auditWrite(key,Action,BranchId,{}, {SupplierName:row.Supplier?.Name||row.Name,Reference:row.Reference||row.Code,EntityId,EntityType:'Hospital pharmacy procurement'})];
  }
  const financeContext=bill=>({BranchId:bill.BranchId,person:{PatientId:''},Reference:bill.Reference,SupplierId:bill.SupplierId,SupplierBillId:bill.BillId});
  const supplierChange=(row,delta)=>write('PharmacySuppliers',row.SupplierId,{...strip(row),OutstandingCents:cents((row.OutstandingCents||0)+delta),UpdatedAt:clock()},row);
  function approvalOfficer(row){if(row.CreatedBy===actor&&user.role!=='Super Admin')fail('A different authorised officer must approve this record.',403);}
  async function billReceipts(ids,BranchId,SupplierId,BillId='',allowReturned=false){
    if(!Array.isArray(ids)||!ids.length||ids.length>20||new Set(ids).size!==ids.length)fail('Select between 1 and 20 distinct goods receipts.');
    const rows=await Promise.all(ids.map(k=>scoped('PharmacyReceipts',id(k),BranchId)));
    if(rows.some(r=>r.SupplierId!==SupplierId||r.BillId&&r.BillId!==BillId||r.AmountCents-r.ReturnedCostCents<=0&&!allowReturned))fail('A receipt belongs to another supplier, is fully returned, or is already claimed by a bill.',409);
    return rows;
  }
  function supplierView(row){if(!row)return null;const result=view(row);if(!can('procurement.finance'))delete result.OutstandingCents;return result;}
  return {
    async pharmacySuppliers(body){
      need('read');const BranchId=await branch(body);
      if(body.Code)return {ok:true,items:[supplierView(await read('PharmacySuppliers',await keyFor('supplier',BranchId,code(body.Code))))].filter(Boolean),next:null};
      const filters=[eq('BranchId',BranchId)],Query=nameKey(field(body,'Query',120));if(body.IncludeInactive!==true)filters.push(eq('Active',true));
      if(Query)filters.push({field:'SearchName',op:'>=',value:Query},{field:'SearchName',op:'<=',value:Query+'\uf8ff'});
      const data=await page('PharmacySuppliers',filters,'SearchName',body);return {ok:true,items:data.rows.map(supplierView),next:data.next};
    },
    async savePharmacySupplier(body){
      need('suppliers');const BranchId=await branch(body),input=body.Supplier||{},Code=code(input.Code);
      if(input.Active!==undefined&&typeof input.Active!=='boolean')fail('Choose the supplier availability.');
      const fields={Code,Name:field(input,'Name',160,true),Phone:field(input,'Phone',60),Email:field(input,'Email',254),Address:field(input,'Address',1000),Active:input.Active!==false};
      return operation(body,'savePharmacySupplier',async key=>{
        const SupplierId=await keyFor('supplier',BranchId,Code),old=await read('PharmacySuppliers',SupplierId);
        if(body.SupplierId&&body.SupplierId!==SupplierId)fail('Supplier code and branch cannot change.',409);
        if(old){if(!body.SupplierId)fail('This supplier code exists. Load it before editing.',409);revision(body,old);}
        else if(body.SupplierId)fail('Supplier is unavailable.',404);
        if(old&&Object.keys(fields).every(k=>old[k]===fields[k]))return unchanged({SupplierId});
        const Reason=old?field(body,'Reason',1000,true):'',identityWrites=[];
        if(!old||nameKey(old.Name)!==nameKey(fields.Name)){const identityId=await keyFor('supplier-name',BranchId,nameKey(fields.Name)),identity=await read('ProcurementReferences',identityId);
          if(identity&&identity.SupplierId!==SupplierId)fail('This supplier name already belongs to a saved supplier. Load that supplier, including inactive entries.',409);
          if(!identity)identityWrites.push(write('ProcurementReferences',identityId,{BranchId,SupplierId},null));}
        const row={...strip(old),...fields,SupplierId,BranchId,SearchName:nameKey(fields.Name),OutstandingCents:old?.OutstandingCents||0,CreatedAt:old?.CreatedAt||clock(),UpdatedAt:clock(),CreatedBy:old?.CreatedBy||actor};
        return {writes:[...identityWrites,write('PharmacySuppliers',SupplierId,row,old),...events(key,BranchId,old?'Update pharmacy supplier':'Create pharmacy supplier',row,{Reason})],result:{SupplierId}};
      });
    },
    async savePharmacyPurchase(body){
      need('request');const BranchId=await branch(body),Reference=field(body,'Reference',120,true),SupplierId=id(body.SupplierId),Note=field(body,'Note',2000);
      if(!Array.isArray(body.Lines)||!body.Lines.length||body.Lines.length>20)fail('Enter between 1 and 20 purchase lines.');
      const inputs=body.Lines.map(r=>({LineCode:code(r.LineCode),CatalogId:id(r.CatalogId),CatalogRevision:field(r,'CatalogRevision',160,true),Quantity:quantity(r.Quantity),UnitCostCents:money(r.UnitCost)}));
      if(new Set(inputs.map(r=>r.LineCode)).size!==inputs.length)fail('Each purchase line needs a different line code.');
      return operation(body,'savePharmacyPurchase',async key=>{
        const PurchaseId=await keyFor('purchase',BranchId,SupplierId,nameKey(Reference)),old=await read('PharmacyPurchases',PurchaseId);
        if(body.PurchaseId&&body.PurchaseId!==PurchaseId)fail('The supplier and purchase reference cannot change.',409);
        if(old){if(!body.PurchaseId)fail('This purchase reference already exists. Open it instead.',409);revision(body,old);if(old.Status!=='Draft')fail('Only a draft purchase can be edited.',409);}
        else if(body.PurchaseId)fail('Purchase is unavailable.',404);
        if(old&&old.Note===Note&&equal(inputs,old.Lines.map(l=>({LineCode:l.LineCode,CatalogId:l.Medicine.CatalogId,CatalogRevision:l.CatalogRevision,Quantity:l.Quantity,UnitCostCents:l.UnitCostCents}))))return unchanged({PurchaseId});
        const supplier=await scoped('PharmacySuppliers',SupplierId,BranchId);if(!supplier.Active)fail('Choose an active supplier.');
        const items=new Map(await Promise.all([...new Set(inputs.map(r=>r.CatalogId))].map(async catalogId=>[catalogId,await scoped('MedicineCatalog',catalogId,BranchId)])));
        const Lines=inputs.map(input=>{const item=items.get(input.CatalogId);if(!item.Active||item.__updateTime!==input.CatalogRevision)fail('A medicine changed or became inactive. Load its current catalogue entry.',409);
          const Medicine=Object.fromEntries(['CatalogId','VersionId','Code','Medicine','Strength','Form','Unit','MedicineKey','HandlingNotes'].map(k=>[k,item[k]]));
          return {LineCode:input.LineCode,Medicine,CatalogRevision:input.CatalogRevision,Quantity:input.Quantity,UnitCostCents:input.UnitCostCents,AmountCents:cents(chargeCents(input.Quantity,input.UnitCostCents)),ReceivedQuantity:0};});
        if(old&&equal(old.Lines,Lines)&&old.Note===Note)return unchanged({PurchaseId});
        const row={PurchaseId,BranchId,SupplierId,Supplier:snapshot(supplier),Reference,Note,Lines,AmountCents:cents(Lines.reduce((s,l)=>s+l.AmountCents,0)),Status:'Draft',CreatedAt:old?.CreatedAt||clock(),CreatedBy:old?.CreatedBy||actor,UpdatedAt:clock()};
        return {writes:[write('PharmacyPurchases',PurchaseId,row,old),...events(key,BranchId,old?'Revise pharmacy purchase draft':'Create pharmacy purchase',row)],result:{PurchaseId}};
      });
    },
    async pharmacyPurchase(body){need('read');const BranchId=await branch(body);return {ok:true,purchase:view(await scoped('PharmacyPurchases',body.PurchaseId,BranchId))};},
    async transitionPharmacyPurchase(body){
      const Decision=field(body,'Decision',30,true),BranchId=await branch(body);need(Decision==='Approve'?'approve':'request');
      const Reason=field(body,'Reason',1000,Decision!=='Submit');
      return operation(body,'transitionPharmacyPurchase',async key=>{
        const old=await scoped('PharmacyPurchases',body.PurchaseId,BranchId);revision(body,old);let Status;
        if(Decision==='Submit'&&old.Status==='Draft')Status='Submitted';
        else if(Decision==='Approve'&&old.Status==='Submitted'){
          approvalOfficer(old);const supplier=await scoped('PharmacySuppliers',old.SupplierId,BranchId);if(!supplier.Active)fail('The supplier is inactive.',409);
          for(const catalogId of new Set(old.Lines.map(l=>l.Medicine.CatalogId))){const item=await scoped('MedicineCatalog',catalogId,BranchId);if(!item.Active)fail('A medicine is inactive. Return the purchase to draft for review.',409);}
          Status='Approved';
        }else if(Decision==='Return to draft'&&old.Status==='Submitted'){need('approve');Status='Draft';}
        else if(Decision==='Cancel'&&['Draft','Submitted','Approved'].includes(old.Status)&&old.Lines.every(l=>!l.ReceivedQuantity)){if(old.Status==='Approved')need('approve');Status='Cancelled';}
        else if(Decision==='Close remaining'&&['Approved','Part received'].includes(old.Status)){need('approve');Status='Closed';}
        else fail('This purchase cannot make that transition. Refresh its current status.',409);
        const row={...strip(old),Status,UpdatedAt:clock(),...(Status==='Approved'?{ApprovedAt:clock(),ApprovedBy:actor}:{})};
        return {writes:[write('PharmacyPurchases',old.PurchaseId,row,old),...events(key,BranchId,`Pharmacy purchase: ${Decision}`,row,{Reason})],result:{PurchaseId:old.PurchaseId}};
      });
    },
    async receivePharmacyPurchase(body){
      need('receive');confirm(body);const BranchId=await branch(body),Quantity=quantity(body.Quantity),LineCode=code(body.LineCode),DeliveryReference=field(body,'DeliveryReference',160,true),DeliveryLine=field(body,'DeliveryLine',60,true);
      return operation(body,'receivePharmacyPurchase',async key=>{
        const old=await scoped('PharmacyPurchases',body.PurchaseId,BranchId);revision(body,old);
        if(!['Approved','Part received'].includes(old.Status))fail('Receive only an approved, open purchase.',409);
        const original=old.Lines.find(l=>l.LineCode===LineCode);if(!original||qty(original.ReceivedQuantity+Quantity)>original.Quantity)fail('The delivery exceeds the remaining approved quantity.',409);
        const guardId=await keyFor('delivery',BranchId,old.SupplierId,nameKey(DeliveryReference),nameKey(DeliveryLine));
        if(await read('ProcurementReferences',guardId))fail('This supplier delivery line was already received.',409);
        const fields=await stockReceiptFields({...original.Medicine,Quantity,BatchNumber:body.BatchNumber,ExpiryDate:body.ExpiryDate,UnitPrice:body.UnitPrice,Supplier:old.Supplier.Name,ReceiptReference:DeliveryReference,LineReference:DeliveryLine},BranchId,clock);
        const prepared=await prepareStockReceipt({read,write,strip,clock,stamp},fields,BranchId,key,{PurchaseId:old.PurchaseId,SupplierId:old.SupplierId,MedicineCatalogSnapshot:original.Medicine});
        const received=qty(original.ReceivedQuantity+Quantity),AmountCents=cents(chargeCents(received,original.UnitCostCents)-chargeCents(original.ReceivedQuantity,original.UnitCostCents));
        const Lines=old.Lines.map(l=>l.LineCode===LineCode?{...l,ReceivedQuantity:received}:l),purchase={...strip(old),Lines,Status:Lines.every(l=>l.ReceivedQuantity===l.Quantity)?'Received':'Part received',UpdatedAt:clock()};
        const receipt={ReceiptId:prepared.ReceiptId,BatchId:prepared.BatchId,BranchId,SupplierId:old.SupplierId,Supplier:old.Supplier,PurchaseId:old.PurchaseId,PurchaseReference:old.Reference,LineCode,DeliveryReference,DeliveryLine,Medicine:original.Medicine,
          Quantity,UnitCostCents:original.UnitCostCents,AmountCents,ReturnedQuantity:0,ReturnedCostCents:0,BillId:'',BatchNumber:fields.BatchNumber,ExpiryDate:fields.ExpiryDate,...stamp()};
        return {writes:[...prepared.writes,write('PharmacyPurchases',old.PurchaseId,purchase,old),write('PharmacyReceipts',receipt.ReceiptId,receipt,null),
          write('ProcurementReferences',guardId,{ReceiptId:receipt.ReceiptId,BranchId,SupplierId:old.SupplierId},null),...events(key,BranchId,'Receive approved pharmacy purchase',purchase,{Receipt:receipt})],result:{PurchaseId:old.PurchaseId,ReceiptId:receipt.ReceiptId}};
      });
    },
    async returnPharmacyPurchase(body){
      need('receive');confirm(body);const BranchId=await branch(body),Quantity=quantity(body.Quantity),Reference=field(body,'Reference',160,true),Reason=field(body,'Reason',2000,true);
      return operation(body,'returnPharmacyPurchase',async key=>{
        const receipt=await scoped('PharmacyReceipts',body.ReceiptId,BranchId);revision(body,receipt);
        const returned=qty(receipt.ReturnedQuantity+Quantity);if(returned>receipt.Quantity)fail('The return exceeds the original receipt quantity.',409);
        if(receipt.BillId){const bill=await scoped('SupplierBills',receipt.BillId,BranchId);if(['Draft','Submitted'].includes(bill.Status))fail('Cancel or revise the draft supplier bill before returning its stock.',409);}
        const batch=await scoped('MedicineBatches',receipt.BatchId,BranchId);if(Quantity>batch.OnHand)fail('The return exceeds usable stock remaining in the batch. Dispensed and quarantined quantities are excluded.',409);
        const referenceId=await keyFor('supplier-return',BranchId,receipt.SupplierId,nameKey(Reference));if(await read('ProcurementReferences',referenceId))fail('This supplier return reference was already recorded.',409);
        const ReturnedCostCents=cumulativeCredit(receipt.AmountCents,returned,receipt.Quantity),AmountCents=ReturnedCostCents-receipt.ReturnedCostCents;
        const returnedRow={ReturnId:key,ReceiptId:receipt.ReceiptId,BatchId:receipt.BatchId,BranchId,SupplierId:receipt.SupplierId,Supplier:receipt.Supplier,PurchaseId:receipt.PurchaseId,BillId:receipt.BillId,Reference,Reason,Quantity,AmountCents,CreditedBillId:'',...stamp()};
        return {writes:[write('PharmacyReceipts',receipt.ReceiptId,{...strip(receipt),ReturnedQuantity:returned,ReturnedCostCents},receipt),
          write('MedicineBatches',batch.BatchId,{...strip(batch),OnHand:qty(batch.OnHand-Quantity),UpdatedAt:clock()},batch),write('PharmacySupplierReturns',key,returnedRow,null),
          write('StockMovements',key,{MovementId:key,BatchId:batch.BatchId,BranchId,Type:'Supplier return',Quantity:-Quantity,ReceiptId:receipt.ReceiptId,Reference,Reason,...stamp()},null),
          write('ProcurementReferences',referenceId,{ReturnId:key,BranchId,SupplierId:receipt.SupplierId},null),...events(key,BranchId,'Return unused pharmacy stock to supplier',{...receipt,Reference},{Return:returnedRow})],result:{ReturnId:key,ReceiptId:receipt.ReceiptId}};
      });
    },
    async procurementRegister(body){
      need('read');const BranchId=await branch(body),filters=[eq('BranchId',BranchId),...dateFilters(body.DateRange)];
      const name={Purchases:'PharmacyPurchases',Receipts:'PharmacyReceipts',Returns:'PharmacySupplierReturns',Bills:'SupplierBills',Payments:'SupplierPayments'}[body.Kind];if(!name)fail('Choose a procurement register.');
      if(['Bills','Payments'].includes(body.Kind))need('finance');
      if(body.SupplierId)filters.push(eq('SupplierId',id(body.SupplierId)));if(body.Status){if(!['Purchases','Bills'].includes(body.Kind))fail('Status filtering is available for purchases and bills.');filters.push(eq('Status',field(body,'Status',40,true)));}
      const data=await page(name,filters,'CreatedAt',body);return {ok:true,rows:data.rows.map(view),next:data.next};
    },
    async procurementHistory(body){
      need('read');const BranchId=await branch(body),filters=dateFilters(body.DateRange);
      const name={Purchase:'PharmacyPurchases',Supplier:'PharmacySuppliers',Bill:'SupplierBills'}[body.Kind];if(!name)fail('Choose a supplier, purchase or bill.');if(body.Kind==='Bill')need('finance');
      await scoped(name,body.EntityId,BranchId);const data=await page('ProcurementEvents',[eq('BranchId',BranchId),eq('EntityId',id(body.EntityId)),...filters],'CreatedAt',body);
      return {ok:true,rows:data.rows.map(r=>{const result=view(r);if(body.Kind==='Supplier'&&!can('procurement.finance'))delete result.Snapshot.OutstandingCents;return result;}),next:data.next};
    },
    async saveSupplierBill(body){
      need('bill');confirm(body);const BranchId=await branch(body),SupplierId=id(body.SupplierId),Reference=field(body,'Reference',160,true),InvoiceDate=dateOnly(body.InvoiceDate),DueDate=dateOnly(body.DueDate),AmountCents=amount(body.Amount),VarianceReason=field(body,'VarianceReason',2000);
      if(InvoiceDate>watDay(clock())||DueDate<InvoiceDate)fail('Use a valid invoice date and due date.');
      return operation(body,'saveSupplierBill',async key=>{
        const BillId=await keyFor('supplier-bill',BranchId,SupplierId,nameKey(Reference)),old=await read('SupplierBills',BillId);
        if(body.BillId&&body.BillId!==BillId)fail('Supplier and invoice reference cannot change.',409);
        if(old){if(!body.BillId)fail('This supplier invoice reference already exists. Open its bill.',409);revision(body,old);if(old.Status!=='Draft')fail('Only draft bills can be edited.',409);}else if(body.BillId)fail('Bill is unavailable.',404);
        const supplier=await scoped('PharmacySuppliers',SupplierId,BranchId),receipts=await billReceipts(body.ReceiptIds,BranchId,SupplierId,BillId);
        const Lines=receipts.map(r=>({ReceiptId:r.ReceiptId,PurchaseId:r.PurchaseId,PurchaseReference:r.PurchaseReference,DeliveryReference:r.DeliveryReference,DeliveryLine:r.DeliveryLine,Medicine:r.Medicine,Quantity:qty(r.Quantity-r.ReturnedQuantity),AmountCents:r.AmountCents-r.ReturnedCostCents}));
        const ExpectedCents=cents(Lines.reduce((s,l)=>s+l.AmountCents,0));if(ExpectedCents!==AmountCents&&!VarianceReason)fail('Explain the difference between the received-stock cost and the supplier invoice total.');
        const fields={InvoiceDate,DueDate,AmountCents,ExpectedCents,VarianceReason,Lines};if(old&&Object.keys(fields).every(k=>equal(old[k],fields[k])))return unchanged({BillId});
        const row={BillId,BranchId,SupplierId,Supplier:snapshot(supplier),Reference,...fields,PaidCents:0,CreditCents:0,Status:'Draft',CreatedAt:old?.CreatedAt||clock(),CreatedBy:old?.CreatedBy||actor,UpdatedAt:clock()};
        const writes=receipts.filter(r=>r.BillId!==BillId).map(r=>write('PharmacyReceipts',r.ReceiptId,{...strip(r),BillId},r));
        for(const removed of old?.Lines.filter(l=>!body.ReceiptIds.includes(l.ReceiptId))||[]){const r=await scoped('PharmacyReceipts',removed.ReceiptId,BranchId);if(r.BillId!==BillId)fail('A receipt claim changed. Refresh the bill.',409);writes.push(write('PharmacyReceipts',r.ReceiptId,{...strip(r),BillId:''},r));}
        return {writes:[...writes,write('SupplierBills',BillId,row,old),...events(key,BranchId,old?'Revise supplier bill draft':'Create supplier bill',row)],result:{BillId}};
      });
    },
    async supplierBill(body){need('finance');const BranchId=await branch(body),bill=await scoped('SupplierBills',body.BillId,BranchId);return {ok:true,bill:{...view(bill),BalanceCents:balance(bill)}};},
    async transitionSupplierBill(body){
      const Decision=field(body,'Decision',30,true);need(Decision==='Approve'?'approveBill':'bill');confirm(body);const BranchId=await branch(body),Reason=field(body,'Reason',1000,Decision!=='Submit');
      return operation(body,'transitionSupplierBill',async key=>{
        const old=await scoped('SupplierBills',body.BillId,BranchId);revision(body,old);let Status,writes=[],Mapping=old.Mapping,adjustments={};
        if(Decision==='Submit'&&old.Status==='Draft'){if(old.ExpectedCents!==old.AmountCents&&!old.VarianceReason)fail('Review the invoice total and explain its difference from the current received-stock cost.');Status='Submitted';}
        else if(Decision==='Return to draft'&&old.Status==='Submitted'){need('approveBill');Status='Draft';}
        else if(Decision==='Approve'&&old.Status==='Submitted'){
          approvalOfficer(old);const claimed=await billReceipts(old.Lines.map(l=>l.ReceiptId),BranchId,old.SupplierId,old.BillId);
          if(claimed.some(r=>r.BillId!==old.BillId||r.AmountCents-r.ReturnedCostCents!==old.Lines.find(l=>l.ReceiptId===r.ReceiptId).AmountCents))fail('A received-stock claim changed. Return the bill to draft and review it.',409);
          const supplier=await scoped('PharmacySuppliers',old.SupplierId,BranchId);Mapping=await posting(BranchId,['PharmacyPurchases','SupplierPayable']);
          Mapping={PharmacyPurchases:Mapping.PharmacyPurchases,SupplierPayable:Mapping.SupplierPayable};Status='Approved';
          writes.push(supplierChange(supplier,old.AmountCents),...journal(key,financeContext(old),'Supplier bill',[line(Mapping.PharmacyPurchases,old.AmountCents),line(Mapping.SupplierPayable,0,old.AmountCents)]));
        }else if(Decision==='Cancel'&&['Draft','Submitted'].includes(old.Status)){
          Status='Cancelled';for(const l of old.Lines){const r=await scoped('PharmacyReceipts',l.ReceiptId,BranchId);if(r.BillId!==old.BillId)fail('A receipt claim changed.',409);writes.push(write('PharmacyReceipts',r.ReceiptId,{...strip(r),BillId:''},r));}
        }else if(Decision==='Reopen'&&old.Status==='Cancelled'){
          Status='Draft';const receipts=(await billReceipts(old.Lines.map(l=>l.ReceiptId),BranchId,old.SupplierId,old.BillId,true)).filter(r=>r.AmountCents>r.ReturnedCostCents);
          if(!receipts.length)fail('All stock for this cancelled bill was returned. There is no remaining received-stock cost to invoice.',409);
          const Lines=receipts.map(r=>({...old.Lines.find(l=>l.ReceiptId===r.ReceiptId),Quantity:qty(r.Quantity-r.ReturnedQuantity),AmountCents:r.AmountCents-r.ReturnedCostCents}));
          const ExpectedCents=cents(Lines.reduce((sum,l)=>sum+l.AmountCents,0));adjustments={Lines,ExpectedCents,VarianceReason:ExpectedCents===old.ExpectedCents?old.VarianceReason:''};
          writes.push(...receipts.map(r=>write('PharmacyReceipts',r.ReceiptId,{...strip(r),BillId:old.BillId},r)));
        }else fail('This bill cannot make that transition. Refresh its current status.',409);
        const row={...strip(old),...adjustments,Status,UpdatedAt:clock(),...(Mapping?{Mapping}:{}),...(Status==='Approved'?{ApprovedAt:clock(),ApprovedBy:actor}:{})};
        return {writes:[...writes,write('SupplierBills',old.BillId,row,old),...events(key,BranchId,`Supplier bill: ${Decision}`,row,{Reason})],result:{BillId:old.BillId}};
      });
    },
    async recordSupplierPayment(body){
      need('pay');confirm(body);const BranchId=await branch(body),fields={...paymentFields(body),Note:field(body,'Note',1000)};
      return operation(body,'recordSupplierPayment',async key=>{
        const bill=await scoped('SupplierBills',body.BillId,BranchId);revision(body,bill);if(!['Approved','Part paid'].includes(bill.Status)||fields.AmountCents>balance(bill))fail('Pay only the outstanding amount of an approved supplier bill.',409);
        const referenceId=await keyFor('supplier-payment',fields.Method==='Cash'?BranchId:'all-branches',fields.Method,nameKey(fields.Reference));if(await read('ProcurementReferences',referenceId))fail('This supplier payment reference was already recorded.',409);
        const supplier=await scoped('PharmacySuppliers',bill.SupplierId,BranchId),config=await settings(BranchId),cashKey=fields.Method==='Cash'?'Cash':'Bank';
        const Mapping={SupplierPayable:bill.Mapping.SupplierPayable,[cashKey]:config?.[cashKey]};await postingMany([Mapping]);
        const row={PaymentId:key,BillId:bill.BillId,BranchId,SupplierId:bill.SupplierId,Supplier:bill.Supplier,BillReference:bill.Reference,...fields,Mapping,ReversedCents:0,...stamp()};
        const next={...strip(bill),PaidCents:bill.PaidCents+fields.AmountCents,UpdatedAt:clock()};next.Status=billStatus(next);
        return {writes:[write('SupplierBills',bill.BillId,next,bill),supplierChange(supplier,-fields.AmountCents),write('SupplierPayments',key,row,null),write('ProcurementReferences',referenceId,{PaymentId:key,BranchId},null),
          ...journal(key,financeContext(bill),'Supplier payment',[line(Mapping.SupplierPayable,fields.AmountCents),line(Mapping[cashKey],0,fields.AmountCents)]),...events(key,BranchId,'Record confirmed supplier payment',next,{Payment:row})],result:{BillId:bill.BillId,PaymentId:key}};
      });
    },
    async reverseSupplierPayment(body){
      need('correct');confirm(body);const BranchId=await branch(body),AmountCents=amount(body.Amount),Reference=field(body,'Reference',160,true),Reason=field(body,'Reason',2000,true);
      return operation(body,'reverseSupplierPayment',async key=>{
        const payment=await scoped('SupplierPayments',body.PaymentId,BranchId);revision(body,payment);
        if(AmountCents>payment.AmountCents-payment.ReversedCents)fail('The reversal exceeds the unreversed payment.',409);
        const bill=await scoped('SupplierBills',payment.BillId,BranchId),supplier=await scoped('PharmacySuppliers',payment.SupplierId,BranchId),guardId=await keyFor('supplier-reversal',payment.Method==='Cash'?BranchId:'all-branches',nameKey(Reference));
        if(await read('ProcurementReferences',guardId))fail('This supplier payment reversal reference already exists.',409);
        await postingMany([payment.Mapping]);const cashKey=payment.Method==='Cash'?'Cash':'Bank',next={...strip(bill),PaidCents:cents(bill.PaidCents-AmountCents),UpdatedAt:clock()};next.Status=billStatus(next);
        return {writes:[write('SupplierPayments',payment.PaymentId,{...strip(payment),ReversedCents:payment.ReversedCents+AmountCents},payment),write('SupplierBills',bill.BillId,next,bill),supplierChange(supplier,AmountCents),
          write('SupplierPaymentReversals',key,{ReversalId:key,PaymentId:payment.PaymentId,BillId:bill.BillId,BranchId,SupplierId:payment.SupplierId,AmountCents,Reference,Reason,...stamp()},null),write('ProcurementReferences',guardId,{ReversalId:key,BranchId},null),
          ...journal(key,financeContext(bill),'Supplier payment reversal',[line(payment.Mapping[cashKey],AmountCents),line(payment.Mapping.SupplierPayable,0,AmountCents)]),...events(key,BranchId,'Record supplier payment reversal',next,{AmountCents,Reference,Reason,PaymentId:payment.PaymentId})],result:{BillId:bill.BillId}};
      });
    },
    async creditSupplierBill(body){
      need('correct');confirm(body);const BranchId=await branch(body),AmountCents=amount(body.Amount),Reference=field(body,'Reference',160,true),Reason=field(body,'Reason',2000,true);
      return operation(body,'creditSupplierBill',async key=>{
        const bill=await scoped('SupplierBills',body.BillId,BranchId);revision(body,bill);if(!['Approved','Part paid'].includes(bill.Status)||AmountCents>balance(bill))fail('Credit only an approved bill’s unpaid balance. Record any actual payment refund/reversal first.',409);
        const referenceId=await keyFor('supplier-credit',BranchId,bill.SupplierId,nameKey(Reference));if(await read('ProcurementReferences',referenceId))fail('This supplier credit reference already exists.',409);
        const writes=[];if(body.ReturnId){const returned=await scoped('PharmacySupplierReturns',body.ReturnId,BranchId);if(returned.BillId!==bill.BillId||returned.CreditedBillId&&returned.CreditedBillId!==bill.BillId||AmountCents>returned.AmountCents-(returned.CreditedCents||0))fail('This returned-stock credit does not match the bill or was already used.',409);writes.push(write('PharmacySupplierReturns',returned.ReturnId,{...strip(returned),CreditedBillId:bill.BillId,CreditedCents:(returned.CreditedCents||0)+AmountCents},returned));}
        const supplier=await scoped('PharmacySuppliers',bill.SupplierId,BranchId);await postingMany([bill.Mapping]);
        const next={...strip(bill),CreditCents:bill.CreditCents+AmountCents,UpdatedAt:clock()};next.Status=billStatus(next);
        return {writes:[...writes,write('SupplierBills',bill.BillId,next,bill),supplierChange(supplier,-AmountCents),write('SupplierCredits',key,{CreditId:key,BillId:bill.BillId,BranchId,SupplierId:bill.SupplierId,AmountCents,Reference,Reason,ReturnId:body.ReturnId||'',...stamp()},null),
          write('ProcurementReferences',referenceId,{CreditId:key,BranchId},null),...journal(key,financeContext(bill),'Supplier credit',[line(bill.Mapping.SupplierPayable,AmountCents),line(bill.Mapping.PharmacyPurchases,0,AmountCents)]),
          ...events(key,BranchId,'Record supplier credit',next,{AmountCents,Reference,Reason,ReturnId:body.ReturnId||''})],result:{BillId:bill.BillId}};
      });
    }
  };
}
