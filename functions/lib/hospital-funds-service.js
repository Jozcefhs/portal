import {fail,id,nameKey,patientSummary} from './hospital-model.js';
import {field,dateFilters} from './hospital-orders-model.js';
import {amount,cents,equal,balances,netPaid,paymentFields,fundsAvailable} from './hospital-billing-model.js';

export function createHospitalFundsService(ctx){
  const {env,db,collection,requireCapability,branch,patient,clock,actor,strip,eq,auditWrite,auditRead,operation,page,
    read,write,view,stamp,any,revision,confirmed,unchanged,keyFor,settings,postingMany,journal,line,event}=ctx;
  function kind(value){if(!['Patient','Hmo'].includes(value))fail('Choose Patient deposit or HMO remittance.');return value;}
  const liabilityKey=fund=>fund.Kind==='Patient'?'PatientDeposit':'HmoPrepayment';
  const debtKey=fund=>fund.Kind==='Patient'?'PatientReceivable':'HmoReceivable';
  const fundView=row=>({...view(row),AvailableCents:fundsAvailable(row)});
  function access(Kind){kind(Kind);if(Kind==='Patient')requireCapability('billing.read');else any('billing.read','hmo.work');}
  async function fundContext(body){
    const BranchId=await branch(body),fund=await read('Funds',body.FundId);
    if(!fund||fund.BranchId!==BranchId)fail('This deposit or remittance is not available in this branch.',404);access(fund.Kind);
    const person=fund.Kind==='Patient'?await patient(fund.PatientId,BranchId):{PatientId:''};
    return {BranchId,fund,person};
  }
  function fundEvent(key,c,Action,details={}){return write('FundEvents',key,{EventId:key,FundId:c.fund.FundId,ReceiptNumber:c.fund.ReceiptNumber,
    BranchId:c.BranchId,PatientId:c.fund.PatientId||'',Insurer:c.fund.Insurer||'',Action,...details,...stamp()},null);}
  function fundAudit(key,c,Action){return auditWrite(key,Action,c.BranchId,c.person,{FundId:c.fund.FundId,ReceiptNumber:c.fund.ReceiptNumber,
    ...(c.fund.Kind==='Hmo'?{Subject:c.fund.Insurer,SubjectName:c.fund.Insurer,EntityType:'HMO remittance',EntityId:c.fund.FundId}:{})});}
  function matchingInvoice(fund,row){
    if(!row||row.BranchId!==fund.BranchId)fail('Select an invoice in this receipt’s branch.',404);
    if(fund.Kind==='Patient'&&row.PatientId!==fund.PatientId)fail('This deposit belongs to a different patient.',409);
    if(fund.Kind==='Hmo'&&(!row.Coverage||nameKey(row.Coverage.Plan.Insurer)!==fund.InsurerKey))fail('This invoice belongs to a different insurer.',409);
  }
  const paymentReference=(BranchId,fields)=>keyFor('receipt',fields.Method==='Cash'?BranchId:'all-branches',fields.Method,nameKey(fields.Reference));
  function sourceJournal(key,c,Action,lines){return journal(key,c,Action,lines).map(w=>({...w,data:{...w.data,HospitalFundId:c.fund.FundId,Reference:c.fund.ReceiptNumber}}));}
  return {
    async hospitalDepositPatient(body){
      requireCapability('billing.read');const BranchId=await branch(body),number=field(body,'HospitalNumber',30,true).toUpperCase();
      if(!/^H-[A-F0-9]{16}$/.test(number))fail('Enter a valid hospital number.');
      const index=await db.getDocument(env,collection('Numbers'),number);if(!index)fail('No patient has that hospital number.',404);
      const person=await patient(index.PatientId,BranchId);await auditRead(body,'Find patient for hospital prepayment',BranchId,person);
      return {ok:true,patient:patientSummary(person)};
    },
    async receiveHospitalFunds(body){
      requireCapability('billing.collect');confirmed(body);const Kind=kind(body.Kind),fields=paymentFields(body),BranchId=await branch(body);
      const identity=Kind==='Patient'?{PatientId:id(body.PatientId)}:{Insurer:field(body,'Insurer',160,true)};
      return operation(body,'receiveHospitalFunds',async key=>{
        const referenceId=await paymentReference(BranchId,fields),prior=await read('PaymentReferences',referenceId),signature={Kind,BranchId,...identity,...fields};
        if(prior){if(!equal(prior.Signature,signature))fail('This receipt or bank reference is already recorded. Open the original receipt instead.',409);return unchanged({FundId:prior.FundId});}
        const person=Kind==='Patient'?await patient(identity.PatientId,BranchId):{PatientId:''};
        const config=await settings(BranchId);if(!config)fail('Configure billing accounts first.');
        const cashKey=fields.Method==='Cash'?'Cash':'Bank',liability=Kind==='Patient'?'PatientDeposit':'HmoPrepayment';
        await postingMany([{[cashKey]:config[cashKey],[liability]:config[liability]}]);
        const fund={FundId:key,ReceiptNumber:`HA-${key.slice(0,16).toUpperCase()}`,Kind,BranchId,...identity,
          PatientName:person.PatientId?patientSummary(person).DisplayName:'',HospitalNumber:person.HospitalNumber||'',InsurerKey:identity.Insurer?nameKey(identity.Insurer):'',
          ...fields,Currency:'NGN',AppliedCents:0,RefundedCents:0,ReceiptAccount:config[cashKey],LiabilityAccount:config[liability],...stamp()};
        const c={BranchId,person,fund};
        return {writes:[write('Funds',key,fund,null),write('PaymentReferences',referenceId,{Signature:signature,FundId:key},null),
          ...sourceJournal(key,c,'Advance receipt',[line(fund.ReceiptAccount,fields.AmountCents),line(fund.LiabilityAccount,0,fields.AmountCents)]),
          fundEvent(key,c,'Receive hospital advance',{AmountCents:fields.AmountCents,Method:fields.Method,Reference:fields.Reference}),fundAudit(key,c,'Receive hospital advance')],result:{FundId:key}};
      });
    },
    async hospitalFunds(body){
      const Kind=kind(body.Kind);access(Kind);const dates=dateFilters(body.DateRange),BranchId=await branch(body),filters=[eq('BranchId',BranchId),eq('Kind',Kind),...dates];
      if(body.PatientId&&Kind==='Patient')filters.push(eq('PatientId',id(body.PatientId)));
      if(body.Insurer&&Kind==='Hmo')filters.push(eq('InsurerKey',nameKey(field(body,'Insurer',160,true))));
      const result=await page('Funds',filters,'CreatedAt',body);await auditRead(body,'View dated hospital advances',BranchId,{}, {ResultCount:result.rows.length});
      return {ok:true,rows:result.rows.map(fundView),next:result.next};
    },
    async hospitalFundDetails(body){
      any('billing.read','hmo.work');const c=await fundContext(body);await auditRead(body,'View hospital advance receipt',c.BranchId,c.person,{FundId:c.fund.FundId});return {ok:true,fund:fundView(c.fund)};
    },
    async hospitalFundInvoice(body){
      any('billing.read','hmo.work');const c=await fundContext(body),number=field(body,'InvoiceNumber',40,true).toUpperCase();
      if(!/^HI-[A-F0-9]{16}$/.test(number))fail('Enter a valid invoice number.');
      const rows=await db.queryCollection(env,collection('Invoices'),{filters:[eq('BranchId',c.BranchId),eq('InvoiceNumber',number)],limit:2});
      if(rows.length!==1)fail('This invoice number is missing or ambiguous in this branch.',404);const row=rows[0];matchingInvoice(c.fund,row);
      const claim=c.fund.Kind==='Hmo'?await read('Claims',row.InvoiceId):null;
      await auditRead(body,'Find invoice for advance allocation',c.BranchId,c.person,{FundId:c.fund.FundId,InvoiceId:row.InvoiceId});
      return {ok:true,invoice:{InvoiceId:row.InvoiceId,InvoiceNumber:row.InvoiceNumber,PatientId:row.PatientId,PatientName:row.PatientName,HospitalNumber:row.HospitalNumber,
        Revision:row.__updateTime,BalanceCents:balances(row)[`${c.fund.Kind}BalanceCents`],ClaimStatus:claim?.Status||''}};
    },
    async allocateHospitalFunds(body){
      requireCapability('billing.collect');confirmed(body);const Reference=field(body,'Reference',160,true);await branch(body);
      if(!Array.isArray(body.Allocations)||!body.Allocations.length||body.Allocations.length>20)fail('Choose between 1 and 20 invoices per allocation batch.');
      const allocations=body.Allocations.map(row=>({InvoiceId:id(row.InvoiceId),Revision:field(row,'Revision',200,true),AmountCents:amount(row.Amount)})).sort((a,b)=>a.InvoiceId.localeCompare(b.InvoiceId));
      if(new Set(allocations.map(r=>r.InvoiceId)).size!==allocations.length)fail('Each invoice must appear only once in an allocation batch.');
      const total=cents(allocations.reduce((sum,row)=>sum+row.AmountCents,0));
      return operation(body,'allocateHospitalFunds',async key=>{
        const c=await fundContext(body),batchId=await keyFor('fund-allocation',c.fund.FundId,nameKey(Reference)),prior=await read('FundAllocationBatches',batchId);
        const signature=allocations.map(({InvoiceId,AmountCents})=>({InvoiceId,AmountCents}));
        if(prior){if(!equal(prior.Signature,signature))fail('This allocation reference already records a different set of payments.',409);return unchanged({FundId:c.fund.FundId,BatchId:batchId});}
        revision(body,c.fund);if(total>fundsAvailable(c.fund))fail('The allocations exceed the receipt’s available balance.',409);
        const invoices=await Promise.all(allocations.map(row=>read('Invoices',row.InvoiceId))),people=new Map(c.person.PatientId?[[c.person.PatientId,c.person]]:[]),claims=new Map();
        for(let i=0;i<invoices.length;i++){
          const inv=invoices[i],allocation=allocations[i];matchingInvoice(c.fund,inv);revision(allocation,inv);
          if(allocation.AmountCents>balances(inv)[`${c.fund.Kind}BalanceCents`])fail(`The allocation exceeds the outstanding balance on ${inv.InvoiceNumber}.`,409);
          if(!people.has(inv.PatientId))people.set(inv.PatientId,await patient(inv.PatientId,c.BranchId));
          if(c.fund.Kind==='Hmo'){
            const claim=await read('Claims',inv.InvoiceId);if(!claim||claim.PatientId!==inv.PatientId||claim.BranchId!==c.BranchId||!['Approved','Partially settled'].includes(claim.Status))fail(`Record insurer approval for ${inv.InvoiceNumber} before allocating a remittance.`,409);claims.set(inv.InvoiceId,claim);
          }
        }
        await postingMany([{[liabilityKey(c.fund)]:c.fund.LiabilityAccount},...invoices.map(inv=>({[debtKey(c.fund)]:inv.Accounts[debtKey(c.fund)]}))]);
        const writes=[],paymentIds=[];
        for(let i=0;i<invoices.length;i++){
          const inv=invoices[i],a=allocations[i],paymentId=await keyFor('fund-payment',batchId,inv.InvoiceId),person=people.get(inv.PatientId),ic={BranchId:c.BranchId,person,invoice:inv,fund:c.fund};
          const next={...strip(inv),[`${c.fund.Kind}PaidCents`]:cents(inv[`${c.fund.Kind}PaidCents`]+a.AmountCents)};
          const payment={PaymentId:paymentId,ReceiptNumber:`HA-USE-${paymentId.slice(0,12).toUpperCase()}`,SourceFundId:c.fund.FundId,SourceReceiptNumber:c.fund.ReceiptNumber,
            AllocationBatchId:batchId,AllocationReference:Reference,InvoiceId:inv.InvoiceId,InvoiceNumber:inv.InvoiceNumber,PatientId:inv.PatientId,PatientName:inv.PatientName,BranchId:c.BranchId,
            Payer:c.fund.Kind,AmountCents:a.AmountCents,Method:c.fund.Kind==='Patient'?'Deposit allocation':'HMO remittance allocation',Reference:c.fund.Reference,
            RefundedCents:0,ReturnedToFundCents:0,ReceivableAccount:inv.Accounts[debtKey(c.fund)],LiabilityAccount:c.fund.LiabilityAccount,...stamp()};
          writes.push(write('Invoices',inv.InvoiceId,next,inv),write('Payments',paymentId,payment,null),
            ...sourceJournal(paymentId,ic,'Advance allocation',[line(c.fund.LiabilityAccount,a.AmountCents),line(payment.ReceivableAccount,0,a.AmountCents)]),
            event(paymentId,ic,'Apply hospital advance',{PaymentId:paymentId,FundId:c.fund.FundId,ReceiptNumber:c.fund.ReceiptNumber,Reference,AmountCents:a.AmountCents,Payer:c.fund.Kind}));
          const claim=claims.get(inv.InvoiceId);if(claim)writes.push(write('Claims',claim.ClaimId,{...strip(claim),Status:balances(next).HmoBalanceCents===0?'Settled':'Partially settled',SettledCents:netPaid(next,'Hmo'),UpdatedAt:clock()},claim));
          paymentIds.push(paymentId);
        }
        writes.push(write('Funds',c.fund.FundId,{...strip(c.fund),AppliedCents:cents(c.fund.AppliedCents+total),UpdatedAt:clock()},c.fund),
          write('FundAllocationBatches',batchId,{BatchId:batchId,FundId:c.fund.FundId,BranchId:c.BranchId,Reference,Signature:signature,PaymentIds:paymentIds,AmountCents:total,...stamp()},null),
          fundEvent(key,c,'Allocate hospital advance',{BatchId:batchId,Reference,AmountCents:total,InvoiceCount:invoices.length}),fundAudit(key,c,'Allocate hospital advance'));
        return {writes,result:{FundId:c.fund.FundId,BatchId:batchId,PaymentIds:paymentIds}};
      });
    },
    async hospitalFundHistory(body){
      any('billing.read','hmo.work');const dates=dateFilters(body.DateRange),c=await fundContext(body),result=await page('FundEvents',[eq('BranchId',c.BranchId),eq('FundId',c.fund.FundId),...dates],'CreatedAt',body);
      await auditRead(body,'View dated advance history',c.BranchId,c.person,{FundId:c.fund.FundId});return {ok:true,rows:result.rows.map(view),next:result.next};
    },
    async hospitalFundAllocations(body){
      any('billing.read','hmo.work');const dates=dateFilters(body.DateRange),c=await fundContext(body),result=await page('Payments',[eq('BranchId',c.BranchId),eq('SourceFundId',c.fund.FundId),...dates],'CreatedAt',body);
      await auditRead(body,'View dated advance allocations',c.BranchId,c.person,{FundId:c.fund.FundId});return {ok:true,rows:result.rows.map(view),next:result.next};
    },
    async returnHospitalAllocation(body){
      requireCapability('billing.refund');confirmed(body);const AmountCents=amount(body.Amount),Reference=field(body,'Reference',160,true),Reason=field(body,'Reason',2000,true);await branch(body);
      return operation(body,'returnHospitalAllocation',async key=>{
        const c=await fundContext(body),returnId=await keyFor('fund-return',c.fund.FundId,nameKey(Reference)),prior=await read('FundAllocationReturns',returnId),PaymentId=id(body.PaymentId),signature={PaymentId,AmountCents,Reference,Reason};
        if(prior){if(!equal(prior.Signature,signature))fail('This return reference already records a different allocation correction.',409);return unchanged({FundId:c.fund.FundId});}
        const payment=await read('Payments',PaymentId);if(!payment||payment.SourceFundId!==c.fund.FundId||payment.BranchId!==c.BranchId)fail('Choose an allocation from this receipt.',404);
        const inv=await read('Invoices',payment.InvoiceId);matchingInvoice(c.fund,inv);
        if(payment.PatientId!==inv.PatientId||payment.Payer!==c.fund.Kind)fail('The allocation reference does not match this invoice.',409);
        revision(body,c.fund);revision(body,payment,'PaymentRevision');revision(body,inv,'InvoiceRevision');
        if(AmountCents>payment.AmountCents-(payment.ReturnedToFundCents||0)-payment.RefundedCents||AmountCents>c.fund.AppliedCents)fail('The return exceeds this allocation’s remaining amount.',409);
        const person=c.person.PatientId?c.person:await patient(inv.PatientId,c.BranchId),ic={...c,person,invoice:inv};
        await postingMany([{[liabilityKey(c.fund)]:c.fund.LiabilityAccount,[debtKey(c.fund)]:payment.ReceivableAccount}]);
        const next={...strip(inv),[`${c.fund.Kind}AllocationReturnCents`]:cents((inv[`${c.fund.Kind}AllocationReturnCents`]||0)+AmountCents)};
        const writes=[write('Invoices',inv.InvoiceId,next,inv),write('Payments',PaymentId,{...strip(payment),ReturnedToFundCents:(payment.ReturnedToFundCents||0)+AmountCents},payment),
          write('Funds',c.fund.FundId,{...strip(c.fund),AppliedCents:c.fund.AppliedCents-AmountCents,UpdatedAt:clock()},c.fund),
          write('FundAllocationReturns',returnId,{ReturnId:returnId,FundId:c.fund.FundId,InvoiceId:inv.InvoiceId,BranchId:c.BranchId,Signature:signature,...stamp()},null),
          ...sourceJournal(key,ic,'Allocation return',[line(payment.ReceivableAccount,AmountCents),line(c.fund.LiabilityAccount,0,AmountCents)]),
          event(key,ic,'Return advance allocation',{FundId:c.fund.FundId,PaymentId,AmountCents,Reference,Reason}),fundEvent(key,c,'Return advance allocation',{InvoiceNumber:inv.InvoiceNumber,PaymentId,AmountCents,Reference,Reason}),fundAudit(key,c,'Return advance allocation')];
        if(c.fund.Kind==='Hmo'){
          const claim=await read('Claims',inv.InvoiceId);if(!claim||claim.BranchId!==c.BranchId||claim.PatientId!==inv.PatientId)fail('Review the missing HMO claim before returning this allocation.',409);
          let Status=claim.Status;if(['Settled','Partially settled','Approved'].includes(Status))Status=balances(next).HmoBalanceCents<=0?'Settled':netPaid(next,'Hmo')>0?'Partially settled':'Approved';
          writes.push(write('Claims',claim.ClaimId,{...strip(claim),Status,SettledCents:netPaid(next,'Hmo'),UpdatedAt:clock()},claim));
        }
        return {writes,result:{FundId:c.fund.FundId,InvoiceId:inv.InvoiceId}};
      });
    },
    async refundHospitalFunds(body){
      requireCapability('billing.refund');confirmed(body);const AmountCents=amount(body.Amount),Reference=field(body,'Reference',160,true),Reason=field(body,'Reason',2000,true);await branch(body);
      return operation(body,'refundHospitalFunds',async key=>{
        const c=await fundContext(body),refId=await keyFor('refund',c.BranchId,nameKey(Reference)),prior=await read('RefundReferences',refId),signature={FundId:c.fund.FundId,AmountCents,Reference,Reason};
        if(prior){if(!equal(prior.Signature,signature))fail('This refund reference is already recorded.',409);return unchanged({FundId:c.fund.FundId});}
        revision(body,c.fund);if(AmountCents>fundsAvailable(c.fund))fail('The refund exceeds the receipt’s unused balance. Return any incorrect allocation first.',409);
        const cashKey=c.fund.Method==='Cash'?'Cash':'Bank';await postingMany([{[cashKey]:c.fund.ReceiptAccount,[liabilityKey(c.fund)]:c.fund.LiabilityAccount}]);
        return {writes:[write('Funds',c.fund.FundId,{...strip(c.fund),RefundedCents:cents(c.fund.RefundedCents+AmountCents),UpdatedAt:clock()},c.fund),
          write('FundRefunds',key,{RefundId:key,BranchId:c.BranchId,...signature,...stamp()},null),write('RefundReferences',refId,{Signature:signature,RefundId:key},null),
          ...sourceJournal(key,c,'Advance refund',[line(c.fund.LiabilityAccount,AmountCents),line(c.fund.ReceiptAccount,0,AmountCents)]),
          fundEvent(key,c,'Refund unused hospital advance',{AmountCents,Reference,Reason}),fundAudit(key,c,'Refund unused hospital advance')],result:{FundId:c.fund.FundId}};
      });
    }
  };
}
