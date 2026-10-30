import {clean,fail,id,digest,nameKey} from './hospital-model.js';
import {field,qty,dateOnly,dateFilters,watDay} from './hospital-orders-model.js';

function counted(value){
  if(!['number','string'].includes(typeof value)||!/^\d+(?:\.\d{1,3})?$/.test(String(value))||!Number.isFinite(Number(value))||Number(value)>1000000)fail('Enter each counted quantity from zero to 1,000,000, with at most three decimal places.');
  return Number(value);
}
const statuses=['Pending','Approved','Rejected','Cancelled'];

export function createHospitalStockControl(ctx){
  const {env,db,collection,capabilities,requireCapability,branch,clock,actor,condition,strip,eq,auditWrite,operation,page}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const view=row=>({...strip(row),Revision:row.__updateTime});
  const stamp=()=>({CreatedAt:clock(),Actor:actor,ActorName:clean(ctx.user.displayName)||actor});
  const revision=(row,value)=>{if(!clean(value)||value!==row.__updateTime)fail('This record changed. Refresh it before continuing.',409);};
  async function batchInBranch(BatchId,BranchId){const row=await read('MedicineBatches',BatchId);if(!row||row.BranchId!==BranchId)fail('This medicine batch is unavailable in the selected branch.',404);return row;}
  async function countInBranch(CountId,BranchId){const row=await read('StockCounts',CountId);if(!row||row.BranchId!==BranchId)fail('This stock count is unavailable in the selected branch.',404);return row;}
  function event(key,row,Action,extra={}){return write('StockCountEvents',key,{EventId:key,CountId:row.CountId,BatchId:row.BatchId,BranchId:row.BranchId,Reference:row.Reference,Medicine:row.Medicine,BatchNumber:row.BatchNumber,Action,...stamp(),...extra},null);}
  return {
    async stockExpiryRegister(body){
      requireCapability('stock.read');dateFilters(body.DateRange);const BranchId=await branch(body);
      const result=await page('MedicineBatches',[eq('BranchId',BranchId),{field:'ExpiryDate',op:'>=',value:dateOnly(body.DateRange.fromDate)},{field:'ExpiryDate',op:'<=',value:dateOnly(body.DateRange.toDate)}],'ExpiryDate',body);
      return {ok:true,batches:result.rows.map(row=>({...view(row),Expired:row.ExpiryDate<=watDay(clock())})),next:result.next};
    },
    async stockBatchForCount(body){
      requireCapability('stock.read');const BranchId=await branch(body),batch=await batchInBranch(body.BatchId,BranchId);
      return {ok:true,batch:view(batch)};
    },
    async stockCountRegister(body){
      requireCapability('stock.read');const filters=dateFilters(body.DateRange),BranchId=await branch(body);
      if(body.Status&&!statuses.includes(body.Status))fail('Choose a valid stock count status.');
      const result=await page('StockCounts',[eq('BranchId',BranchId),...(body.Status?[eq('Status',body.Status)]:[]),...filters],'CreatedAt',body);
      return {ok:true,counts:result.rows.map(view),next:result.next};
    },
    async stockCountDetails(body){
      requireCapability('stock.read');const BranchId=await branch(body),count=await countInBranch(body.CountId,BranchId),batch=await batchInBranch(count.BatchId,BranchId);
      return {ok:true,count:view(count),batch:view(batch),Stale:count.Status==='Pending'&&count.BatchRevision!==batch.__updateTime,
        CanReview:count.Status==='Pending'&&capabilities.includes('stock.review')&&count.CountedBy!==actor,
        CanCancel:count.Status==='Pending'&&count.CountedBy===actor&&capabilities.includes('stock.count')};
    },
    async stockCountHistory(body){
      requireCapability('stock.read');const filters=dateFilters(body.DateRange),BranchId=await branch(body),count=await countInBranch(body.CountId,BranchId);
      const result=await page('StockCountEvents',[eq('BranchId',BranchId),eq('CountId',count.CountId),...filters],'CreatedAt',body);
      return {ok:true,events:result.rows.map(view),next:result.next};
    },
    async submitStockCount(body){
      requireCapability('stock.count');const BranchId=await branch(body),BatchId=id(body.BatchId);
      const Reference=field(body,'Reference',120,true),Reason=field(body,'Reason',2000,true),CountedAt=field(body,'CountedAt',40,true);
      const OnHand=counted(body.OnHand),Quarantined=counted(body.Quarantined);dateOnly(CountedAt.slice(0,10));
      if(body.Confirmed!==true)fail('Confirm that these are physical quantities for the selected medicine and batch.');
      if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(CountedAt)||!Number.isFinite(Date.parse(CountedAt))||Date.parse(CountedAt)>Date.parse(clock()))fail('Enter a valid physical count time that is not in the future.');
      return operation(body,'submitStockCount',async key=>{
        const CountId=await digest(JSON.stringify([BranchId,BatchId,nameKey(Reference)]));
        const Fingerprint=await digest(JSON.stringify({Reference:nameKey(Reference),Reason,CountedAt,OnHand,Quarantined,BatchRevision:body.BatchRevision,CountedBy:actor}));
        const old=await read('StockCounts',CountId);
        if(old){if(old.Fingerprint!==Fingerprint)fail('This count reference already exists. Open it; use a new reference for a new physical count.',409);return {writes:[],result:{CountId,Unchanged:true}};}
        const [batch,guard]=await Promise.all([batchInBranch(BatchId,BranchId),read('StockCountGuards',BatchId)]);
        revision(batch,body.BatchRevision);
        if(guard?.PendingCountId)fail('This batch already has a pending count. Review or cancel that count before recording another.',409);
        if(Math.floor(Date.parse(CountedAt)/1000)<Math.floor(Date.parse(batch.UpdatedAt||batch.CreatedAt)/1000))fail('Stock changed after this physical count. Refresh the batch and recount it.',409);
        if((OnHand>batch.OnHand&&Quarantined<batch.Quarantined)||(OnHand<batch.OnHand&&Quarantined>batch.Quarantined))fail('A physical count cannot move stock between shelf and quarantine. Use the quarantine workflow and record a new count.');
        const row={CountId,BranchId,BatchId,Reference,Reason,CountedAt,CountedBy:actor,CountedByName:clean(ctx.user.displayName)||actor,
          Medicine:batch.Medicine,Strength:batch.Strength,Form:batch.Form,Unit:batch.Unit,BatchNumber:batch.BatchNumber,ExpiryDate:batch.ExpiryDate,
          BatchRevision:batch.__updateTime,Before:{OnHand:batch.OnHand,Quarantined:batch.Quarantined},Counted:{OnHand,Quarantined},
          Difference:{OnHand:qty(OnHand-batch.OnHand),Quarantined:qty(Quarantined-batch.Quarantined)},Fingerprint,Status:'Pending',CreatedAt:clock(),UpdatedAt:clock()};
        return {writes:[write('StockCounts',CountId,row,null),write('StockCountGuards',BatchId,{BatchId,BranchId,PendingCountId:CountId,UpdatedAt:clock()},guard),
          event(key,row,'Submit physical stock count'),auditWrite(key,'Submit physical pharmacy count',BranchId,{}, {SubjectName:row.Medicine,Subject:`${row.Medicine} · ${row.BatchNumber}`,CountId,Reference})],result:{CountId}};
      });
    },
    async reviewStockCount(body){
      const Decision=body.Decision;if(!['Approve','Reject','Cancel'].includes(Decision))fail('Choose Approve, Reject or Cancel.');
      requireCapability(Decision==='Cancel'?'stock.count':'stock.review');const BranchId=await branch(body),Reason=field(body,'Reason',2000,true);
      if(body.Confirmed!==true)fail('Confirm the batch, quantities and supporting physical count evidence before continuing.');
      return operation(body,'reviewStockCount',async key=>{
        const row=await countInBranch(body.CountId,BranchId);revision(row,body.Revision);
        if(row.Status!=='Pending')fail('This count has already been decided. Its original record is retained.',409);
        if(Decision==='Cancel'?row.CountedBy!==actor:row.CountedBy===actor)fail(Decision==='Cancel'?'Only the officer who submitted this count can cancel it.':'A different authorised officer must review this stock count.',403);
        const guard=await read('StockCountGuards',row.BatchId);
        if(guard?.PendingCountId!==row.CountId)fail('The pending count reference changed. Reload the count.',409);
        const writes=[];
        if(Decision==='Approve'){
          const batch=await batchInBranch(row.BatchId,BranchId);revision(batch,row.BatchRevision);
          writes.push(write('MedicineBatches',batch.BatchId,{...strip(batch),...row.Counted,LastStockCountId:row.CountId,LastCountedAt:row.CountedAt,UpdatedAt:clock()},batch));
          if(row.Difference.OnHand||row.Difference.Quarantined)writes.push(write('StockMovements',key,{MovementId:key,BatchId:row.BatchId,BranchId,Type:'Approved physical count',CountId:row.CountId,Reference:row.Reference,
            Quantity:row.Difference.OnHand,QuarantinedQuantity:row.Difference.Quarantined,Before:row.Before,After:row.Counted,Reason,...stamp()},null));
        }
        const Status={Approve:'Approved',Reject:'Rejected',Cancel:'Cancelled'}[Decision],next={...strip(row),Status,DecisionReason:Reason,DecidedBy:actor,DecidedByName:clean(ctx.user.displayName)||actor,DecidedAt:clock(),UpdatedAt:clock()};
        writes.push(write('StockCounts',row.CountId,next,row),write('StockCountGuards',row.BatchId,{...strip(guard),PendingCountId:'',LastCountId:row.CountId,UpdatedAt:clock()},guard),
          event(key,row,`${Decision} physical stock count`,{Reason,Status}),auditWrite(key,`${Decision} physical pharmacy count`,BranchId,{}, {SubjectName:row.Medicine,Subject:`${row.Medicine} · ${row.BatchNumber}`,CountId:row.CountId,Reference:row.Reference,Reason}));
        return {writes,result:{CountId:row.CountId,Status}};
      });
    }
  };
}
