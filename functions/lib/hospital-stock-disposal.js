import {clean,fail,id,digest,nameKey} from './hospital-model.js';
import {field,quantity,qty,dateOnly,dateFilters} from './hospital-orders-model.js';

const statuses=['Pending','Approved','Rejected','Cancelled'];

export function createHospitalStockDisposal(ctx){
  const {env,user,db,collection,capabilities,requireCapability,branch,clock,actor,condition,strip,eq,auditWrite,operation,page}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const view=row=>({...strip(row),Revision:row.__updateTime});
  const stamp=()=>({CreatedAt:clock(),Actor:actor,ActorName:clean(user.displayName)||actor});
  const revision=(row,value)=>{if(!clean(value)||value!==row.__updateTime)fail('This record changed. Refresh it before continuing.',409);};
  const isSubmitter=row=>nameKey(row.SubmittedBy)===nameKey(actor);
  async function batchInBranch(BatchId,BranchId){const row=await read('MedicineBatches',BatchId);if(!row||row.BranchId!==BranchId)fail('This medicine batch is unavailable in the selected branch.',404);return row;}
  async function disposalInBranch(DisposalId,BranchId){const row=await read('StockDisposals',DisposalId);if(!row||row.BranchId!==BranchId)fail('This disposal record is unavailable in the selected branch.',404);return row;}
  function event(key,row,Action,extra={}){return write('StockDisposalEvents',key,{EventId:key,DisposalId:row.DisposalId,BatchId:row.BatchId,BranchId:row.BranchId,Reference:row.Reference,Medicine:row.Medicine,BatchNumber:row.BatchNumber,Action,...stamp(),...extra},null);}
  return {
    async stockDisposalQueue(body){
      requireCapability('stock.read');const BranchId=await branch(body);
      const result=await page('StockDisposals',[eq('BranchId',BranchId),eq('Status','Pending')],'CreatedAt',body);
      return {ok:true,disposals:result.rows.map(view),next:result.next};
    },
    async stockDisposalRegister(body){
      requireCapability('stock.read');const filters=dateFilters(body.DateRange),BranchId=await branch(body);
      if(body.Status&&!statuses.includes(body.Status))fail('Choose a valid disposal status.');
      const result=await page('StockDisposals',[eq('BranchId',BranchId),...(body.Status?[eq('Status',body.Status)]:[]),...filters],'CreatedAt',body);
      return {ok:true,disposals:result.rows.map(view),next:result.next};
    },
    async stockDisposalDetails(body){
      requireCapability('stock.read');const BranchId=await branch(body),disposal=await disposalInBranch(body.DisposalId,BranchId),batch=await batchInBranch(disposal.BatchId,BranchId);
      return {ok:true,disposal:view(disposal),batch:view(batch),Stale:disposal.Status==='Pending'&&disposal.BatchRevision!==batch.__updateTime,
        CanReview:disposal.Status==='Pending'&&capabilities.includes('stock.review')&&!isSubmitter(disposal),
        CanCancel:disposal.Status==='Pending'&&capabilities.includes('stock.count')&&isSubmitter(disposal)};
    },
    async stockDisposalHistory(body){
      requireCapability('stock.read');const filters=dateFilters(body.DateRange),BranchId=await branch(body),disposal=await disposalInBranch(body.DisposalId,BranchId);
      const result=await page('StockDisposalEvents',[eq('BranchId',BranchId),eq('DisposalId',disposal.DisposalId),...filters],'CreatedAt',body);
      return {ok:true,events:result.rows.map(view),next:result.next};
    },
    async submitStockDisposal(body){
      requireCapability('stock.count');const BranchId=await branch(body),BatchId=id(body.BatchId);
      const Reference=field(body,'Reference',120,true),Quantity=quantity(body.Quantity),Method=field(body,'Method',500,true),Reason=field(body,'Reason',2000,true),Evidence=field(body,'Evidence',2000,true),DisposedAt=field(body,'DisposedAt',40,true);
      if(body.Confirmed!==true)fail('Confirm the actual physical disposal, medicine batch, quantity and evidence.');
      dateOnly(DisposedAt.slice(0,10));
      if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(DisposedAt)||!Number.isFinite(Date.parse(DisposedAt))||Date.parse(DisposedAt)>Date.parse(clock()))fail('Enter a valid physical disposal time that is not in the future.');
      return operation(body,'submitStockDisposal',async key=>{
        const DisposalId=await digest(JSON.stringify([BranchId,BatchId,nameKey(Reference)]));
        const Fingerprint=await digest(JSON.stringify({Reference:nameKey(Reference),Quantity,Method,Reason,Evidence,DisposedAt,BatchRevision:body.BatchRevision,SubmittedBy:actor}));
        const old=await read('StockDisposals',DisposalId);
        if(old){if(old.Fingerprint!==Fingerprint)fail('This disposal reference already exists. Open its retained record; use a new reference for a different disposal.',409);return {writes:[],result:{DisposalId,Status:old.Status,Unchanged:true}};}
        const [batch,guard]=await Promise.all([batchInBranch(BatchId,BranchId),read('StockDisposalGuards',BatchId)]);
        revision(batch,body.BatchRevision);
        if(guard?.PendingDisposalId)fail('This batch already has a pending disposal. Confirm, reject or cancel that record first.',409);
        if(Quantity>(batch.Quarantined||0))fail('The disposal exceeds the quarantined quantity. Shelf stock cannot be disposed through this workflow.',409);
        if(Math.floor(Date.parse(DisposedAt)/1000)<Math.floor(Date.parse(batch.UpdatedAt||batch.CreatedAt)/1000))fail('Stock changed after the recorded disposal time. Reconcile the batch before recording disposal.',409);
        const row={DisposalId,BranchId,BatchId,Reference,Quantity,DisposedAt,Method,Reason,Evidence,SubmittedBy:actor,SubmittedByName:clean(user.displayName)||actor,
          Medicine:batch.Medicine,Strength:batch.Strength,Form:batch.Form,Unit:batch.Unit,BatchNumber:batch.BatchNumber,ExpiryDate:batch.ExpiryDate,
          BatchRevision:batch.__updateTime,Before:{OnHand:batch.OnHand,Quarantined:batch.Quarantined||0},Fingerprint,Status:'Pending',CreatedAt:clock(),UpdatedAt:clock()};
        return {writes:[write('StockDisposals',DisposalId,row,null),write('StockDisposalGuards',BatchId,{BatchId,BranchId,PendingDisposalId:DisposalId,UpdatedAt:clock()},guard),
          event(key,row,'Submit quarantined stock disposal',{Quantity,DisposedAt,Method,Reason,Evidence}),
          auditWrite(key,'Submit quarantined pharmacy disposal',BranchId,{}, {SubjectName:row.Medicine,Subject:`${row.Medicine} · ${row.BatchNumber}`,DisposalId,Reference})],result:{DisposalId,Status:'Pending'}};
      });
    },
    async reviewStockDisposal(body){
      const Decision=body.Decision;if(!['Approve','Reject','Cancel'].includes(Decision))fail('Choose Approve, Reject or Cancel.');
      requireCapability(Decision==='Cancel'?'stock.count':'stock.review');const BranchId=await branch(body),Reason=field(body,'Reason',2000,true),Evidence=field(body,'Evidence',2000,Decision==='Approve');
      if(body.Confirmed!==true)fail('Confirm the disposal record, quantity and supporting evidence before continuing.');
      if(Decision==='Approve'&&body.Witnessed!==true)fail('Confirm that you independently witnessed the recorded physical disposal.');
      return operation(body,'reviewStockDisposal',async key=>{
        const row=await disposalInBranch(body.DisposalId,BranchId);
        if(Decision==='Cancel'?!isSubmitter(row):isSubmitter(row))fail(Decision==='Cancel'?'Only the officer who submitted this disposal can cancel it.':'A different authorised officer must witness or reject this disposal.',403);
        const DecisionFingerprint=await digest(JSON.stringify({Decision,Reason,Evidence,Actor:actor}));
        if(row.Status!=='Pending'){
          if(row.DecisionFingerprint===DecisionFingerprint)return {writes:[],result:{DisposalId:row.DisposalId,Status:row.Status,Unchanged:true}};
          fail('This disposal has already been decided. Its original record is retained.',409);
        }
        revision(row,body.Revision);const guard=await read('StockDisposalGuards',row.BatchId);
        if(guard?.PendingDisposalId!==row.DisposalId)fail('The pending disposal reference changed. Reload the disposal record.',409);
        const writes=[];
        if(Decision==='Approve'){
          const batch=await batchInBranch(row.BatchId,BranchId);revision(batch,row.BatchRevision);
          if(row.Quantity>(batch.Quarantined||0))fail('The disposal exceeds the quarantined quantity. Refresh and reconcile the batch.',409);
          const After={OnHand:batch.OnHand,Quarantined:qty(batch.Quarantined-row.Quantity)};
          writes.push(write('MedicineBatches',batch.BatchId,{...strip(batch),Quarantined:After.Quarantined,LastStockDisposalId:row.DisposalId,UpdatedAt:clock()},batch),
            write('StockMovements',key,{MovementId:key,BatchId:row.BatchId,BranchId,Type:'Witnessed quarantine disposal',DisposalId:row.DisposalId,Reference:row.Reference,
              Quantity:0,QuarantinedQuantity:-row.Quantity,Before:row.Before,After,DisposedAt:row.DisposedAt,Method:row.Method,Reason,Evidence,...stamp()},null));
        }
        const Status={Approve:'Approved',Reject:'Rejected',Cancel:'Cancelled'}[Decision],next={...strip(row),Status,DecisionReason:Reason,DecisionEvidence:Evidence,DecisionFingerprint,DecidedBy:actor,DecidedByName:clean(user.displayName)||actor,DecidedAt:clock(),UpdatedAt:clock(),...(Decision==='Approve'?{Witnessed:true}:{})};
        writes.push(write('StockDisposals',row.DisposalId,next,row),write('StockDisposalGuards',row.BatchId,{...strip(guard),PendingDisposalId:'',LastDisposalId:row.DisposalId,UpdatedAt:clock()},guard),
          event(key,row,`${Decision} quarantined stock disposal`,{Reason,Evidence,Status,...(Decision==='Approve'?{Witnessed:true}:{})}),
          auditWrite(key,`${Decision} quarantined pharmacy disposal`,BranchId,{}, {SubjectName:row.Medicine,Subject:`${row.Medicine} · ${row.BatchNumber}`,DisposalId:row.DisposalId,Reference:row.Reference,Reason}));
        return {writes,result:{DisposalId:row.DisposalId,Status}};
      });
    }
  };
}
