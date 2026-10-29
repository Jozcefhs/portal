import {clean,fail,id,digest,patientSummary} from './hospital-model.js';
import {medicineCatalogSnapshot} from './hospital-medicines-service.js';
import {field,quantity,qty,money,chargeCents,cumulativeCredit,dateOnly,watDay,dateFilters,medicine,prescription,investigation,allergySnapshot,specimenLabel} from './hospital-orders-model.js';

export function createHospitalOrdersService(ctx){
  const {env,user,db,collection,capabilities,requireCapability,branch,patient,clock,actor,condition,strip,eq,auditWrite,auditRead,operation,page}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const publicRow=row=>row?{...strip(row),Revision:row.__updateTime}:null;
  const can=name=>capabilities.includes(name);
  const requiredAny=names=>{if(!names.some(can))fail('Your role does not permit this hospital operation.',403);};
  const stamp=()=>({ActorUsername:actor,ActorName:clean(user.displayName)||actor,CreatedAt:clock()});
  const kindAccess=kind=>{
    if(!['Prescription','Laboratory','Imaging'].includes(kind))fail('Choose a valid order type.');
    requiredAny(['orders.read',kind==='Prescription'?'pharmacy.work':kind==='Laboratory'?'laboratory.work':'imaging.work']);
  };
  const worker=kind=>{if(kind==='Laboratory')requireCapability('laboratory.work');else if(kind==='Imaging')requireCapability('imaging.work');else fail('Choose an investigation order.');};
  function revision(body,row,key='Revision'){if(clean(body[key])!==clean(row?.__updateTime))fail('This record changed. Refresh before continuing.',409);}
  const confirmed=body=>{if(body.ConfirmPatient!==true)fail('Confirm the patient identity and review the displayed information.');};
  async function visitContext(body,creating=false){
    const BranchId=await branch(body),visit=await read('Visits',body.VisitId);
    if(!visit||visit.BranchId!==BranchId)fail('This visit is not available in the selected branch.',404);
    if(visit.PatientId!==body.PatientId)fail('The patient does not match this visit.',409);
    const person=await patient(visit.PatientId,BranchId);
    if(creating&&(person.Status!=='Active'||!['Waiting','In progress'].includes(visit.Status)))fail('Open an active patient visit before issuing a new order.',409);
    const care=await read('CareSummaries',visit.PatientId);
    if(care&&care.PatientId!==visit.PatientId)fail('Review this patient’s allergy reference.',409);
    return {BranchId,visit,person,care};
  }
  async function orderContext(body){
    const BranchId=await branch(body),order=await read('Orders',body.OrderId);
    if(!order||order.BranchId!==BranchId)fail('This order is not available in the selected branch.',404);
    kindAccess(order.Kind);
    if(order.PatientId!==body.PatientId)fail('The patient does not match this order.',409);
    const current=await visitContext({...body,VisitId:order.VisitId});
    return {...current,order};
  }
  function careLock(current){return write('CareSummaries',current.person.PatientId,{...strip(current.care),PatientId:current.person.PatientId,
    AllergyStatus:current.care?.AllergyStatus||'Unknown',Allergies:current.care?.Allergies||'',LastOrderActivityAt:clock()},current.care);}
  function event(key,current,Action,details={}){
    return write('OrderEvents',key,{EventId:key,OrderId:current.order.OrderId,PatientId:current.person.PatientId,BranchId:current.BranchId,
      Action,...stamp(),...details},null);
  }
  function changes(key,current,Action,updates={},details={}){
    const next={...strip(current.order),...updates,UpdatedAt:clock()};
    return [write('Orders',next.OrderId,next,current.order),event(key,current,Action,details),
      ...(current.visit.AdmissionId&&['Waiting','In progress'].includes(current.visit.Status)?[write('Visits',current.visit.VisitId,{...strip(current.visit),DischargeApprovalId:''},current.visit)]:[]),
      auditWrite(key,Action,current.BranchId,current.person,{OrderId:next.OrderId,OrderNumber:next.OrderNumber})];
  }
  const result=current=>({OrderId:current.order.OrderId,PatientId:current.person.PatientId});
  const notCancelled=order=>{if(order.Status==='Cancelled')fail('This order is cancelled.',409);};
  function pharmacyCurrent(body,current){
    if(current.order.Kind!=='Prescription')fail('Choose a prescription.');
    notCancelled(current.order);confirmed(body);revision(body,current.care,'CareRevision');
    if(current.person.Status!=='Active'||current.visit.Status==='Cancelled')fail('This patient or visit is inactive.',409);
  }
  async function report(order,reportId){
    if(!reportId)return null;
    const row=await read('InvestigationReports',reportId);
    if(!row||row.OrderId!==order.OrderId||row.BranchId!==order.BranchId||row.PatientId!==order.PatientId)fail('Review this investigation report’s references.',409);
    return row;
  }
  return {
    async orderVisitContext(body){
      requireCapability('orders.create');const c=await visitContext(body,true);
      await auditRead(body,'View prescribing context',c.BranchId,c.person,{VisitId:c.visit.VisitId});
      return {ok:true,patient:patientSummary(c.person),visit:publicRow(c.visit),care:publicRow(c.care)||{AllergyStatus:'Unknown',Allergies:'',Revision:''}};
    },
    async createOrder(body){
      requireCapability('orders.create');await branch(body);confirmed(body);
      const Kind=body.Kind,Fields=Kind==='Prescription'?await prescription(body.Prescription):investigation({...body.Investigation,Kind});
      return operation(body,'createOrder',async key=>{
        const c=await visitContext(body,true);revision(body,c.visit,'VisitRevision');revision(body,c.care,'CareRevision');
        if(body.MedicineCatalogId && Kind!=='Prescription')fail('Choose a prescription before selecting a medicine.');
        const MedicineCatalogSnapshot=await medicineCatalogSnapshot(body,Fields,c.BranchId,read);
        let CatalogSnapshot = null;
        if (body.CatalogId) {
          if (Kind === 'Prescription') fail('Choose an investigation before selecting the catalogue.');
          const item = await read('InvestigationCatalog', body.CatalogId);
          if (!item || item.BranchId !== c.BranchId || item.Kind !== Kind || !item.Active) fail('This investigation catalogue item is unavailable. Reload the catalogue.',409);
          if (body.CatalogRevision !== item.__updateTime) fail('The investigation catalogue changed. Reload it and review the saved instructions.',409);
          if (Fields.Service !== item.Name || Fields.Specimen !== item.Specimen) fail('The selected service or specimen was changed. Reselect the catalogue item, or choose a custom investigation.');
          CatalogSnapshot = { CatalogId:item.CatalogId, VersionId:item.VersionId, Code:item.Code, Name:item.Name, Specimen:item.Specimen,
            Preparation:item.Preparation, Instructions:item.Instructions };
        }
        const order={OrderId:key,OrderNumber:`${Kind==='Prescription'?'RX':'INV'}-${key.slice(0,12).toUpperCase()}`,
          PatientId:c.person.PatientId,PatientName:patientSummary(c.person).DisplayName,HospitalNumber:c.person.HospitalNumber,VisitId:c.visit.VisitId,BranchId:c.BranchId,
          Kind,Fields,...(MedicineCatalogSnapshot?{MedicineCatalogSnapshot}:{}),...(CatalogSnapshot?{CatalogSnapshot}:{}),...(Kind==='Laboratory'?{SpecimenWorkflow:2,SpecimenSequence:0}:{}),Status:Kind==='Prescription'?'Awaiting pharmacy review':'Requested',CreatedAt:clock(),UpdatedAt:clock(),
          PrescriberUsername:actor,PrescriberName:clean(user.displayName)||actor,AllergySnapshot:allergySnapshot(c.care),
          DispensedQuantity:0,ReturnedQuantity:0,CriticalNeedsAcknowledgement:false,CriticalPendingCount:0};
        c.order=order;
        return {writes:[write('Orders',key,order,null),careLock(c),
          write('Visits',c.visit.VisitId,{...strip(c.visit),LastOrderAt:clock(),...(c.visit.AdmissionId?{DischargeApprovalId:''}:{})},c.visit),
          event(key,c,'Issue hospital order',{Kind}),auditWrite(key,'Issue hospital order',c.BranchId,c.person,{OrderId:key,OrderNumber:order.OrderNumber})],result:result(c)};
      });
    },
    async listOrders(body){
      kindAccess(body.Kind);const BranchId=await branch(body),filters=[eq('BranchId',BranchId),eq('Kind',body.Kind),...dateFilters(body.DateRange)];
      if(body.PatientId){await patient(body.PatientId,BranchId);filters.push(eq('PatientId',id(body.PatientId)));}
      const rows=await page('Orders',filters,'CreatedAt',body);
      await auditRead(body,'View dated hospital orders',BranchId,{}, {Kind:body.Kind,ResultCount:rows.rows.length});
      return {ok:true,orders:rows.rows.map(row=>({OrderId:row.OrderId,OrderNumber:row.OrderNumber,PatientId:row.PatientId,PatientName:row.PatientName,
        HospitalNumber:row.HospitalNumber,Kind:row.Kind,Service:row.Fields.Medicine||row.Fields.Service,Status:row.Status,CreatedAt:row.CreatedAt,
        CriticalNeedsAcknowledgement:row.CriticalNeedsAcknowledgement})),next:rows.next};
    },
    async orderDetails(body){
      const c=await orderContext(body),isWorker=can(c.order.Kind==='Laboratory'?'laboratory.work':c.order.Kind==='Imaging'?'imaging.work':'pharmacy.work');
      const latestRead=isWorker?report(c.order,c.order.LatestReportId):Promise.resolve(null);
      const releasedRead=isWorker&&c.order.ReleasedReportId&&c.order.ReleasedReportId===c.order.LatestReportId?latestRead:report(c.order,c.order.ReleasedReportId);
      const [latest,released]=await Promise.all([latestRead,releasedRead]);
      await auditRead(body,'View hospital order',c.BranchId,c.person,{OrderId:c.order.OrderId});
      return {ok:true,order:{...publicRow(c.order),LabelToPrint:specimenLabel(c.order)},patient:patientSummary(c.person),care:publicRow(c.care)||{AllergyStatus:'Unknown',Allergies:'',Revision:''},
        latestReport:publicRow(latest),releasedReport:publicRow(released),canVerify:!!latest&&latest.ActorUsername!==actor&&isWorker,
        canCancel:can('orders.create')&&(c.order.PrescriberUsername===actor||user.role==='Medical Director')};
    },
    async orderHistory(body){
      const filters=dateFilters(body.DateRange),c=await orderContext(body);
      const rows=await page('OrderEvents',[eq('BranchId',c.BranchId),eq('OrderId',c.order.OrderId),...filters],'CreatedAt',body);
      await auditRead(body,'View hospital order history',c.BranchId,c.person,{OrderId:c.order.OrderId,ResultCount:rows.rows.length});
      return {ok:true,events:rows.rows.map(publicRow),next:rows.next};
    },
    async releasedReportHistory(body){
      const filters=dateFilters(body.DateRange),c=await orderContext(body);
      if(c.order.Kind==='Prescription')fail('Choose an investigation order.');
      const rows=await page('ReleasedReports',[eq('BranchId',c.BranchId),eq('OrderId',c.order.OrderId),...filters],'CreatedAt',body);
      if(rows.rows.some(row=>row.PatientId!==c.person.PatientId))fail('Review these report references.',409);
      await auditRead(body,'View released report history',c.BranchId,c.person,{OrderId:c.order.OrderId,ResultCount:rows.rows.length});
      return {ok:true,reports:rows.rows.map(publicRow),next:rows.next};
    },
    async cancelOrder(body){
      requireCapability('orders.create');await branch(body);const Reason=field(body,'Reason',2000,true);
      return operation(body,'cancelOrder',async key=>{
        const c=await orderContext(body);revision(body,c.order);notCancelled(c.order);
        if(c.order.PrescriberUsername!==actor&&user.role!=='Medical Director')fail('Only the prescriber or Medical Director can cancel this order.',403);
        if(c.order.ReleasedReportId||c.order.Status==='Dispensed')fail('This order has been fulfilled. Record a return or report amendment instead.',409);
        return {writes:changes(key,c,'Cancel hospital order',{Status:'Cancelled',CancelledAt:clock(),CancelledBy:actor,CancelReason:Reason},{Reason}),result:result(c)};
      });
    },
    async reviewPrescription(body){
      requireCapability('pharmacy.work');await branch(body);const Reason=field(body,'Reason',2000,true),Decision=body.Decision;
      if(!['Approved','On hold'].includes(Decision))fail('Approve or place the prescription on hold.');
      return operation(body,'reviewPrescription',async key=>{
        const c=await orderContext(body);revision(body,c.order);pharmacyCurrent(body,c);
        notCancelled(c.order);
        const ReviewedAllergies=await digest(JSON.stringify(allergySnapshot(c.care)));
        if(c.order.PharmacyReview===Decision&&c.order.ReviewReason===Reason&&c.order.ReviewedAllergies===ReviewedAllergies)return {writes:[],result:{...result(c),Unchanged:true}};
        return {writes:[...changes(key,c,'Review prescription',{Status:Decision==='Approved'?(c.order.DispensedQuantity>=c.order.Fields.Quantity?'Dispensed':c.order.DispensedQuantity?'Partially dispensed':'Ready to dispense'):'On hold',
          PharmacyReview:Decision,ReviewedBy:actor,ReviewedAt:clock(),ReviewReason:Reason,ReviewedAllergies},{Decision,Reason}),careLock(c)],result:result(c)};
      });
    },
    async receiveMedicine(body){
      requireCapability('pharmacy.work');const BranchId=await branch(body),m=await medicine(body.Stock),Quantity=quantity(body.Stock?.Quantity);
      const BatchNumber=field(body.Stock,'BatchNumber',120,true),ExpiryDate=dateOnly(body.Stock?.ExpiryDate),Supplier=field(body.Stock,'Supplier',160,true),
        ReceiptReference=field(body.Stock,'ReceiptReference',160,true),LineReference=field(body.Stock,'LineReference',60,true),UnitPriceCents=money(body.Stock?.UnitPrice);
      if(ExpiryDate<=watDay(clock()))fail('Receive only stock with a future expiry date into usable inventory.');
      const BatchId=await digest(JSON.stringify([BranchId,m.MedicineKey,BatchNumber,ExpiryDate]));
      const receiptKey=await digest(JSON.stringify([BranchId,Supplier.toLowerCase(),ReceiptReference.toLowerCase(),LineReference.toLowerCase()]));
      return operation(body,'receiveMedicine',async key=>{
        const MedicineCatalogSnapshot=await medicineCatalogSnapshot(body,m,BranchId,read);
        if(await read('StockReceipts',receiptKey))fail('This supplier receipt line has already been recorded.',409);
        const old=await read('MedicineBatches',BatchId);
        if(old&&old.UnitPriceCents!==UnitPriceCents)fail('This batch has a different selling price. Use the existing batch price to receive additional stock.',409);
        const batch={...strip(old),...m,BatchId,BranchId,BatchNumber,ExpiryDate,UnitPriceCents,OnHand:qty((old?.OnHand||0)+Quantity),
          Quarantined:old?.Quarantined||0,CreatedAt:old?.CreatedAt||clock(),UpdatedAt:clock()};
        return {writes:[write('MedicineBatches',BatchId,batch,old),write('StockReceipts',receiptKey,{ReceiptId:receiptKey,BatchId,BranchId,Quantity,Supplier,ReceiptReference,LineReference,...(MedicineCatalogSnapshot?{MedicineCatalogSnapshot}:{}),...stamp()},null),
          write('StockMovements',key,{MovementId:key,BatchId,BranchId,Type:'Receipt',Quantity,ReceiptId:receiptKey,Supplier,ReceiptReference,LineReference,...(MedicineCatalogSnapshot?{MedicineCatalogSnapshot}:{}),...stamp()},null),
          auditWrite(key,'Receive pharmacy stock',BranchId,{}, {BatchId,Medicine:m.Medicine,Quantity})],result:{BatchId}};
      });
    },
    async stockBatches(body){
      requireCapability('pharmacy.work');const BranchId=await branch(body);
      const m=body.OrderId?(await orderContext(body)).order.Fields:await medicine(body.Medicine);
      if(!m.MedicineKey)fail('Choose a prescription medicine.');
      const rows=await page('MedicineBatches',[eq('BranchId',BranchId),eq('MedicineKey',m.MedicineKey)],'ExpiryDate',body);
      await auditRead(body,'View matching medicine batches',BranchId,{}, {Medicine:m.Medicine,ResultCount:rows.rows.length});
      return {ok:true,batches:rows.rows.map(row=>({...publicRow(row),Expired:row.ExpiryDate<=watDay(clock())})),next:rows.next};
    },
    async stockHistory(body){
      requireCapability('pharmacy.work');const filters=dateFilters(body.DateRange),BranchId=await branch(body),batch=await read('MedicineBatches',body.BatchId);
      if(!batch||batch.BranchId!==BranchId)fail('Choose a medicine batch in this branch.',404);
      const rows=await page('StockMovements',[eq('BranchId',BranchId),eq('BatchId',batch.BatchId),...filters],'CreatedAt',body);
      await auditRead(body,'View dated pharmacy stock movements',BranchId,{}, {BatchId:batch.BatchId});
      return {ok:true,movements:rows.rows.map(publicRow),next:rows.next};
    },
    async quarantineStock(body){
      requireCapability('pharmacy.work');const BranchId=await branch(body),Quantity=quantity(body.Quantity),Reason=field(body,'Reason',2000,true);
      return operation(body,'quarantineStock',async key=>{
        const batch=await read('MedicineBatches',body.BatchId);
        if(!batch||batch.BranchId!==BranchId)fail('Choose a medicine batch in this branch.',404);
        revision(body,batch);if(Quantity>batch.OnHand)fail('The quantity exceeds the stock on hand.',409);
        return {writes:[write('MedicineBatches',batch.BatchId,{...strip(batch),OnHand:qty(batch.OnHand-Quantity),Quarantined:qty(batch.Quarantined+Quantity),UpdatedAt:clock()},batch),
          write('StockMovements',key,{MovementId:key,BatchId:batch.BatchId,BranchId,Type:'Quarantine',Quantity:-Quantity,QuarantinedQuantity:Quantity,Reason,...stamp()},null),
          auditWrite(key,'Quarantine pharmacy stock',BranchId,{}, {BatchId:batch.BatchId,Quantity})],result:{BatchId:batch.BatchId}};
      });
    },
    async dispensePrescription(body){
      requireCapability('pharmacy.work');await branch(body);const Quantity=quantity(body.Quantity);
      return operation(body,'dispensePrescription',async key=>{
        const c=await orderContext(body);revision(body,c.order);pharmacyCurrent(body,c);
        if(!['Ready to dispense','Partially dispensed'].includes(c.order.Status)||c.order.PharmacyReview!=='Approved')fail('The pharmacist must approve this prescription before dispensing.',409);
        if(c.order.ReviewedAllergies!==await digest(JSON.stringify(allergySnapshot(c.care))))fail('Allergy information changed. Review this prescription again before dispensing.',409);
        const batch=await read('MedicineBatches',body.BatchId);
        if(!batch||batch.BranchId!==c.BranchId||batch.MedicineKey!==c.order.Fields.MedicineKey)fail('Choose a matching medicine, strength, form and unit in this branch.',409);
        revision(body,batch,'BatchRevision');
        if(batch.ExpiryDate<=watDay(clock()))fail('Expired stock cannot be dispensed.',409);
        const total=qty(c.order.DispensedQuantity+Quantity);
        if(Quantity>batch.OnHand||total>c.order.Fields.Quantity)fail('The quantity exceeds the available stock or the remaining prescription.',409);
        const AmountCents=chargeCents(Quantity,batch.UnitPriceCents);
        const dispensing={DispenseId:key,OrderId:c.order.OrderId,PatientId:c.person.PatientId,BranchId:c.BranchId,BatchId:batch.BatchId,BatchNumber:batch.BatchNumber,
          ExpiryDate:batch.ExpiryDate,Quantity,Unit:c.order.Fields.Unit,UnitPriceCents:batch.UnitPriceCents,AmountCents,ReturnedQuantity:0,...stamp()};
        return {writes:[...changes(key,c,'Dispense prescription',{DispensedQuantity:total,Status:total===c.order.Fields.Quantity?'Dispensed':'Partially dispensed'},{DispenseId:key,Quantity,BatchNumber:batch.BatchNumber}),
          careLock(c),write('MedicineBatches',batch.BatchId,{...strip(batch),OnHand:qty(batch.OnHand-Quantity),UpdatedAt:clock()},batch),write('Dispenses',key,dispensing,null),
          write('StockMovements',key,{MovementId:key,BatchId:batch.BatchId,BranchId:c.BranchId,Type:'Dispense',Quantity:-Quantity,OrderId:c.order.OrderId,...stamp()},null),
          write('ChargeEvents',key,{ChargeId:key,OrderId:c.order.OrderId,PatientId:c.person.PatientId,VisitId:c.order.VisitId,BranchId:c.BranchId,Source:'Dispense',SourceId:key,
            ServiceCode:`MED-${c.order.Fields.MedicineKey.slice(0,20).toUpperCase()}`,Description:`${c.order.Fields.Medicine} ${c.order.Fields.Strength} (${c.order.Fields.Unit})`,Quantity,
            AmountCents,Currency:'NGN',Status:'Awaiting billing',...stamp()},null)],result:{...result(c),DispenseId:key}};
      });
    },
    async returnDispensedMedicine(body){
      requireCapability('pharmacy.work');await branch(body);const Quantity=quantity(body.Quantity),Reason=field(body,'Reason',2000,true);confirmed(body);
      return operation(body,'returnDispensedMedicine',async key=>{
        const c=await orderContext(body);revision(body,c.order);
        const original=await read('Dispenses',body.DispenseId);
        if(!original||original.OrderId!==c.order.OrderId||original.PatientId!==c.person.PatientId||original.BranchId!==c.BranchId)fail('Choose a dispensing entry for this order.',404);
        revision(body,original,'DispenseRevision');
        const returned=qty(original.ReturnedQuantity+Quantity);
        if(returned>qty(original.Quantity-(original.AdministeredQuantity||0)))fail('The return exceeds the unused dispensed quantity; recorded administration must be accounted for.',409);
        const batch=await read('MedicineBatches',original.BatchId);
        if(!batch||batch.BranchId!==c.BranchId)fail('The original medicine batch is unavailable.',409);
        const credit=cumulativeCredit(original.AmountCents,returned,original.Quantity)-cumulativeCredit(original.AmountCents,original.ReturnedQuantity,original.Quantity);
        return {writes:[...changes(key,c,'Return dispensed medicine',{ReturnedQuantity:qty(c.order.ReturnedQuantity+Quantity)},{DispenseId:original.DispenseId,Quantity,Reason}),
          write('Dispenses',original.DispenseId,{...strip(original),ReturnedQuantity:returned},original),
          write('MedicineBatches',batch.BatchId,{...strip(batch),Quarantined:qty(batch.Quarantined+Quantity),UpdatedAt:clock()},batch),
          write('MedicineReturns',key,{ReturnId:key,DispenseId:original.DispenseId,OrderId:c.order.OrderId,PatientId:c.person.PatientId,BranchId:c.BranchId,Quantity,Reason,Disposition:'Quarantined',...stamp()},null),
          write('StockMovements',key,{MovementId:key,BatchId:batch.BatchId,BranchId:c.BranchId,Type:'Patient return',Quantity:0,QuarantinedQuantity:Quantity,...stamp()},null),
          write('ChargeEvents',key,{ChargeId:key,OrderId:c.order.OrderId,PatientId:c.person.PatientId,VisitId:c.order.VisitId,BranchId:c.BranchId,Source:'Return',SourceId:key,
            OriginalChargeId:original.DispenseId,AmountCents:-credit,Currency:'NGN',Status:'Awaiting billing',...stamp()},null)],result:result(c)};
      });
    },
    async dispensingHistory(body){
      requireCapability('pharmacy.work');const filters=dateFilters(body.DateRange),c=await orderContext(body);
      const rows=await page('Dispenses',[eq('BranchId',c.BranchId),eq('OrderId',c.order.OrderId),...filters],'CreatedAt',body);
      await auditRead(body,'View dated dispensing entries',c.BranchId,c.person,{OrderId:c.order.OrderId});
      return {ok:true,dispenses:rows.rows.map(publicRow),next:rows.next};
    },
    async recordSpecimen(body){
      requireCapability('laboratory.work');await branch(body);confirmed(body);const Note=field(body,'Note',2000,true);
      if(!['Collected','Received','Rejected'].includes(body.Decision))fail('Choose Collected, Received or Rejected.');
      return operation(body,'recordSpecimen',async key=>{
        const c=await orderContext(body);revision(body,c.order);notCancelled(c.order);
        if(c.order.Kind!=='Laboratory'||!['Requested','Specimen rejected','Specimen collected','Specimen received'].includes(c.order.Status))fail('This order is not awaiting specimen handling.',409);
        if(body.SpecimenLabel!==specimenLabel(c.order))fail('Match the specimen label to this patient and collection attempt.');
        if(c.order.SpecimenWorkflow===2){
          const old=c.order.CurrentSpecimen,Decision=body.Decision;
          if(Decision==='Collected'&&!['Requested','Specimen rejected'].includes(c.order.Status))fail('This collection is already recorded. Receive or reject the specimen before another collection.',409);
          if(Decision==='Received'&&old?.Status!=='Collected')fail('Record collection before laboratory receipt. A received specimen cannot be received twice.',409);
          if(Decision==='Rejected'&&c.order.Status==='Specimen rejected')fail('This specimen is already rejected. Record a new collection.',409);
          const OccurredAt=clean(body.OccurredAt)||clock(),previousTime=old?.RejectedAt||old?.ReceivedAt||old?.CollectedAt;
          if(!/^\d{4}-\d{2}-\d{2}T/.test(OccurredAt)||!Number.isFinite(Date.parse(OccurredAt))||Date.parse(OccurredAt)>Date.parse(clock())||Date.parse(OccurredAt)<Date.parse(c.order.CreatedAt)
            ||previousTime&&Date.parse(OccurredAt)<Date.parse(previousTime))fail('Choose a handling time between the order/previous handling time and now.');
          const fresh=Decision==='Collected'||!old,Sequence=fresh?(c.order.SpecimenSequence||0)+1:old.Sequence;
          const specimen={...(fresh?{}:old),Label:body.SpecimenLabel,Sequence,Status:Decision,Note,
            [`${Decision}At`]:new Date(OccurredAt).toISOString(),[`${Decision}By`]:actor,RecordedAt:clock()};
          return {writes:changes(key,c,'Record laboratory specimen',{Status:`Specimen ${Decision.toLowerCase()}`,SpecimenSequence:Sequence,CurrentSpecimen:specimen,
            SpecimenLabel:specimen.Label,SpecimenHandledAt:clock(),SpecimenHandledBy:actor},{Decision,Note,Specimen:specimen}),result:result(c)};
        }
        if(body.Decision==='Received')fail('This earlier order uses the original collection workflow. Its recorded specimen and reports are preserved.');
        return {writes:changes(key,c,'Record laboratory specimen',{Status:body.Decision==='Collected'?'Specimen collected':'Specimen rejected',
          SpecimenLabel:c.order.OrderNumber,SpecimenHandledAt:clock(),SpecimenHandledBy:actor},{Decision:body.Decision,Note}),result:result(c)};
      });
    },
    async recordInvestigationReport(body){
      await branch(body);requiredAny(['laboratory.work','imaging.work']);
      const Text=field(body,'Text',12000,true),Reason=field(body,'Reason',2000),Critical=body.Critical===true;
      const ReportFingerprint=await digest(JSON.stringify({Text,Reason,Critical}));
      return operation(body,'recordInvestigationReport',async key=>{
        const c=await orderContext(body);worker(c.order.Kind);revision(body,c.order);notCancelled(c.order);
        if(c.order.Kind==='Laboratory'&&(c.order.SpecimenWorkflow===2?c.order.CurrentSpecimen?.Status!=='Received':!['Specimen collected','Result draft','Verified','Released'].includes(c.order.Status)))fail('Collect, identify and receive the specimen in the laboratory before recording results.',409);
        if(c.order.ReportFingerprint===ReportFingerprint)return {writes:[],result:{...result(c),ReportId:c.order.LatestReportId,Unchanged:true}};
        if(c.order.LatestReportId&&!Reason)fail('Record why this report is being corrected. Earlier versions will be retained.');
        const row={ReportId:key,OrderId:c.order.OrderId,PatientId:c.person.PatientId,BranchId:c.BranchId,Text,Critical,Reason,
          PreviousReportId:c.order.LatestReportId||'',...(c.order.CurrentSpecimen?{SpecimenSnapshot:c.order.CurrentSpecimen}:{}),...stamp()};
        return {writes:[...changes(key,c,'Record investigation report',{Status:'Result draft',LatestReportId:key,ReportFingerprint,VerifiedReportId:'',VerifiedBy:'',VerifiedAt:''},{ReportId:key}),
          write('InvestigationReports',key,row,null)],result:{...result(c),ReportId:key}};
      });
    },
    async verifyInvestigationReport(body){
      await branch(body);requiredAny(['laboratory.work','imaging.work']);confirmed(body);
      return operation(body,'verifyInvestigationReport',async key=>{
        const c=await orderContext(body);worker(c.order.Kind);revision(body,c.order);
        if(c.order.Status!=='Result draft'||body.ReportId!==c.order.LatestReportId)fail('Refresh and select the latest draft report.',409);
        const draft=await report(c.order,c.order.LatestReportId);
        if(draft.ActorUsername===actor)fail('A second authorised officer must verify this report.',403);
        return {writes:changes(key,c,'Verify investigation report',{Status:'Verified',VerifiedReportId:draft.ReportId,VerifiedBy:actor,VerifiedAt:clock()},{ReportId:draft.ReportId}),result:result(c)};
      });
    },
    async releaseInvestigationReport(body){
      await branch(body);requiredAny(['laboratory.work','imaging.work']);confirmed(body);
      return operation(body,'releaseInvestigationReport',async key=>{
        const c=await orderContext(body);worker(c.order.Kind);revision(body,c.order);
        if(c.order.Status!=='Verified'||body.ReportId!==c.order.LatestReportId||c.order.VerifiedReportId!==body.ReportId)fail('Verify the latest report before release.',409);
        const verified=await report(c.order,body.ReportId);
        const communication=verified.Critical?field(body,'Communication',2000,true):'';
        const pending=Number(c.order.CriticalPendingCount||0)+(verified.Critical?1:0);
        return {writes:[...changes(key,c,'Release investigation report',{Status:'Released',ReleasedReportId:verified.ReportId,ReleasedAt:clock(),ReleasedBy:actor,
          ReleasedVerifiedBy:c.order.VerifiedBy,ReleasedVerifiedAt:c.order.VerifiedAt,
          CriticalNeedsAcknowledgement:pending>0,CriticalPendingCount:pending,CriticalCommunication:communication},
          {ReportId:verified.ReportId,Critical:verified.Critical,Communication:communication,VerifiedBy:c.order.VerifiedBy}),
          write('ReleasedReports',verified.ReportId,{...strip(verified),AuthoredAt:verified.CreatedAt,CreatedAt:clock(),ReleasedBy:actor,ReleasedAt:clock(),
            VerifiedBy:c.order.VerifiedBy,VerifiedAt:c.order.VerifiedAt,PreviousReleasedReportId:c.order.ReleasedReportId||''},null),
          ...(verified.Critical?[write('CriticalAlerts',verified.ReportId,{AlertId:verified.ReportId,ReportId:verified.ReportId,OrderId:c.order.OrderId,
            PatientId:c.person.PatientId,BranchId:c.BranchId,Status:'Pending',Communication:communication,Report:strip(verified),...stamp()},null)]:[])],result:result(c)};
      });
    },
    async pendingCriticalAlerts(body){
      requireCapability('orders.create');const c=await orderContext(body);
      const rows=await page('CriticalAlerts',[eq('BranchId',c.BranchId),eq('OrderId',c.order.OrderId),eq('Status','Pending')],'CreatedAt',body);
      const alerts=await Promise.all(rows.rows.map(async row=>{
        if(row.PatientId!==c.person.PatientId)fail('Review this critical alert’s patient reference.',409);
        const snapshot=row.Report||await report(c.order,row.ReportId);
        if(snapshot.OrderId!==c.order.OrderId||snapshot.PatientId!==c.person.PatientId||snapshot.BranchId!==c.BranchId||snapshot.ReportId!==row.ReportId)fail('Review this critical report snapshot.',409);
        const {Report:_storedSnapshot,...alert}=publicRow(row);
        return {...alert,report:publicRow(snapshot)};
      }));
      await auditRead(body,'View pending critical results',c.BranchId,c.person,{OrderId:c.order.OrderId,ResultCount:alerts.length});
      return {ok:true,alerts,next:rows.next};
    },
    async acknowledgeCriticalResult(body){
      requireCapability('orders.create');await branch(body);confirmed(body);const Note=field(body,'Note',2000,true);
      return operation(body,'acknowledgeCriticalResult',async key=>{
        const c=await orderContext(body);revision(body,c.order);
        const alert=await read('CriticalAlerts',body.ReportId);
        if(!alert||alert.OrderId!==c.order.OrderId||alert.PatientId!==c.person.PatientId||alert.BranchId!==c.BranchId||alert.Status!=='Pending')fail('Select a released critical result awaiting acknowledgement.',409);
        const pending=Math.max(0,Number(c.order.CriticalPendingCount||0)-1);
        return {writes:[...changes(key,c,'Acknowledge critical result',{CriticalNeedsAcknowledgement:pending>0,CriticalPendingCount:pending,CriticalAcknowledgedBy:actor,CriticalAcknowledgedAt:clock()},{ReportId:body.ReportId,Note}),
          write('CriticalAlerts',alert.AlertId,{...strip(alert),Status:'Acknowledged',AcknowledgedBy:actor,AcknowledgedAt:clock(),Acknowledgement:Note},alert)],result:result(c)};
      });
    }
  };
}
