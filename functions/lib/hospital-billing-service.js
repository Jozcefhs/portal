import {clean,fail,id,digest,nameKey,patientSummary} from './hospital-model.js';
import {field,quantity,dateFilters,watDay,cumulativeCredit,chargeCents} from './hospital-orders-model.js';
import {ACCOUNT_TYPES,amount,cents,equal,code,planFields,eligibility,splitCharge,balances,paymentFields} from './hospital-billing-model.js';
import {accountingCodeAllowedForEdition} from './accounting-edition-scope.js';

export function createHospitalBillingService(ctx){
  const {env,user,db,collection,capabilities,requireCapability,branch,patient,clock,actor,condition,strip,eq,auditWrite,auditRead,operation,page}=ctx;
  const read=(name,key)=>db.getDocument(env,collection(name),id(key));
  const write=(name,key,data,old)=>({collectionPath:collection(name),documentId:key,data,currentDocument:condition(old)});
  const view=row=>row?{...strip(row),Revision:row.__updateTime}:null;
  const stamp=()=>({CreatedAt:clock(),ActorUsername:actor,ActorName:clean(user.displayName)||actor});
  const any=(...names)=>{if(!names.some(n=>capabilities.includes(n)))fail('Your role does not permit this billing operation.',403);};
  const revision=(body,row,key='Revision')=>{if(!body[key]||body[key]!==row?.__updateTime)fail('This record changed. Refresh before saving.',409);};
  const confirmed=body=>{if(body.ConfirmPatient!==true)fail('Confirm the patient and financial information before saving.');};
  const unchanged=result=>({writes:[],result:{...result,Unchanged:true}});
  const keyFor=(...parts)=>digest(JSON.stringify(parts));
  async function visit(body){
    const BranchId=await branch(body),row=await read('Visits',body.VisitId);
    if(!row||row.BranchId!==BranchId||row.PatientId!==body.PatientId)fail('Choose a visit for this patient in the selected branch.',404);
    return {BranchId,visit:row,person:await patient(row.PatientId,BranchId)};
  }
  async function invoice(body){
    const BranchId=await branch(body),row=await read('Invoices',body.InvoiceId);
    if(!row||row.BranchId!==BranchId||row.PatientId!==body.PatientId)fail('This invoice is not available for this patient in this branch.',404);
    return {BranchId,invoice:row,person:await patient(row.PatientId,BranchId)};
  }
  function event(key,c,Action,details={}){return write('BillingEvents',key,{EventId:key,BranchId:c.BranchId,PatientId:c.person.PatientId,
    InvoiceId:c.invoice?.InvoiceId||'',VisitId:c.invoice?.VisitId||c.visit?.VisitId||'',Action,...details,...stamp()},null);}
  function audit(key,c,Action){return auditWrite(key,Action,c.BranchId,c.person,{InvoiceId:c.invoice?.InvoiceId||'',VisitId:c.invoice?.VisitId||c.visit?.VisitId||''});}
  async function settings(BranchId){return read('BillingSettings',await keyFor('settings',BranchId));}
  async function accounts(mapping,keys){
    const rows=await Promise.all([...new Set(keys.map(k=>mapping[k]))].map(k=>db.getDocument(env,'chartOfAccounts',k)));
    for(const key of keys){const row=rows.find(r=>r&&(r.Code||r.__id)===mapping[key]);
      if(!row||['no','false','inactive'].includes(clean(row.Active).toLowerCase())||clean(row.Type).toLowerCase()!==ACCOUNT_TYPES[key]||!accountingCodeAllowedForEdition(mapping[key],'hospital'))fail(`Choose an active ${ACCOUNT_TYPES[key]} account for ${key}.`);}
  }
  async function posting(BranchId,keys,mapping){
    const config=mapping||await settings(BranchId);if(!config)fail('Set Hospital billing account mappings before posting.');
    await accounts(config,keys);
    const day=watDay(clock());
    // Only periods that can still contain today; fail closed on an unexpectedly large configuration.
    // Shared accounting also accepts legacy lower-case period fields. Check both
    // indexed shapes so restored closed periods cannot be silently bypassed.
    const periodGroups=await Promise.all(['EndDate','endDate'].map(field=>db.queryCollection(env,'accountingPeriods',{filters:[{field,op:'>=',value:day}],limit:101})));
    if(periodGroups.some(rows=>rows.length>100))fail('Review the accounting period configuration before posting.',409);
    if(periodGroups.flat().some(r=>clean(r.Status||r.status).toLowerCase()==='closed'&&clean(r.StartDate||r.startDate)<=day))fail('This accounting period is closed.',409);
    return config;
  }
  function journal(key,c,Action,lines){
    const nonzero=lines.filter(l=>l.DebitCents||l.CreditCents),debit=nonzero.reduce((n,l)=>n+cents(l.DebitCents||0),0),credit=nonzero.reduce((n,l)=>n+cents(l.CreditCents||0),0);
    if(debit!==credit)fail('The hospital posting is not balanced.',409);if(!debit)return [];
    const JournalNo=`HOSP-${key}`;
    return [{collectionPath:'accountingJournals',documentId:JournalNo,currentDocument:{exists:false},data:{JournalNo,Date:watDay(clock()),BranchId:c.BranchId,
      Source:`Hospital ${Action}`,SourceId:key,Reference:c.invoice?.InvoiceNumber||key,Description:`Hospital ${Action}`,Currency:'NGN',BaseCurrency:'NGN',Status:'Posted',System:'YES',
      Edition:'hospital',WorkspaceId:env.DYNAMAX_WORKSPACE_ID,HospitalPatientId:c.person.PatientId,HospitalInvoiceId:c.invoice?.InvoiceId||'',
      Lines:nonzero.map((l,i)=>({LineNo:i+1,AccountCode:l.AccountCode,Debit:(l.DebitCents||0)/100,Credit:(l.CreditCents||0)/100})),
      TotalDebit:debit/100,TotalCredit:credit/100,CreatedAt:clock(),UpdatedAt:clock(),PostedAt:clock(),CreatedBy:actor,PostedBy:actor}}];
  }
  const line=(AccountCode,DebitCents=0,CreditCents=0)=>({AccountCode,DebitCents,CreditCents});
  async function dated(body,name,extra=[]){
    any('billing.read','hmo.work');const filters=dateFilters(body.DateRange),BranchId=await branch(body);
    const result=await page(name,[eq('BranchId',BranchId),...extra,...filters],'CreatedAt',body);
    await auditRead(body,`View dated hospital ${name.toLowerCase()}`,BranchId,{}, {ResultCount:result.rows.length});
    return {ok:true,rows:result.rows.map(view),next:result.next};
  }
  return {
    async billingSettings(body){any('billing.read','hmo.work');const BranchId=await branch(body);return {ok:true,settings:view(await settings(BranchId))};},
    async saveBillingSettings(body){
      requireCapability('billing.configure');const BranchId=await branch(body),fields=Object.fromEntries(Object.keys(ACCOUNT_TYPES).map(k=>[k,code(body.Settings?.[k])]));
      if(new Set(Object.values(fields)).size!==Object.keys(fields).length)fail('Use separate accounts for patient debt, HMO debt, revenue, cash and bank.');
      return operation(body,'saveBillingSettings',async key=>{
        const settingId=await keyFor('settings',BranchId),old=await read('BillingSettings',settingId);if(old)revision(body,old);
        if(old&&Object.keys(fields).every(k=>old[k]===fields[k]))return unchanged({});await accounts(fields,Object.keys(fields));
        return {writes:[write('BillingSettings',settingId,{...fields,BranchId,UpdatedAt:clock(),UpdatedBy:actor},old),
          write('BillingSettingVersions',key,{...fields,BranchId,...stamp()},null),auditWrite(key,'Save Hospital billing accounts',BranchId)],result:{}};
      });
    },
    async saveHmoPlan(body){
      requireCapability('hmo.work');const BranchId=await branch(body),fields=planFields(body.Plan);
      return operation(body,'saveHmoPlan',async key=>{
        const PlanId=await keyFor('plan',BranchId,fields.Code),old=await read('HmoPlans',PlanId);if(old)revision(body,old);
        if(old&&equal(Object.fromEntries(Object.keys(fields).map(k=>[k,old[k]])),fields))return unchanged({PlanId});
        return {writes:[write('HmoPlans',PlanId,{...fields,PlanId,BranchId,CreatedAt:old?.CreatedAt||clock(),UpdatedAt:clock(),UpdatedBy:actor},old),
          write('HmoPlanVersions',key,{...fields,PlanId,BranchId,...stamp()},null),auditWrite(key,'Save HMO plan and tariffs',BranchId)],result:{PlanId}};
      });
    },
    async findHmoPlans(body){
      any('billing.read','hmo.work');const BranchId=await branch(body),query=code(body.Code);
      const row=await read('HmoPlans',await keyFor('plan',BranchId,query));return {ok:true,plan:view(row)};
    },
    async billingVisit(body){
      any('billing.read','hmo.work');const c=await visit(body),coverage=await read('HmoEligibility',await keyFor('eligibility',c.BranchId,c.visit.VisitId));
      await auditRead(body,'View patient billing context',c.BranchId,c.person,{VisitId:c.visit.VisitId});
      return {ok:true,patient:patientSummary(c.person),visit:{VisitId:c.visit.VisitId,Department:c.visit.Department,Status:c.visit.Status},coverage:view(coverage)};
    },
    async saveHmoEligibility(body){
      requireCapability('hmo.work');confirmed(body);const fields=eligibility(body.Eligibility);await branch(body);
      return operation(body,'saveHmoEligibility',async key=>{
        const c=await visit(body),plan=await read('HmoPlans',body.PlanId);if(!plan||plan.BranchId!==c.BranchId||!plan.Active)fail('Choose an active plan in this branch.');
        revision(body,plan,'PlanRevision');const EligibilityId=await keyFor('eligibility',c.BranchId,c.visit.VisitId),old=await read('HmoEligibility',EligibilityId);if(old)revision(body,old);
        const next={...fields,PlanId:plan.PlanId,PlanRevision:plan.__updateTime,Plan:strip(plan),PatientId:c.person.PatientId,VisitId:c.visit.VisitId,BranchId:c.BranchId};
        if(old&&equal(Object.fromEntries(Object.keys(next).map(k=>[k,old[k]])),next))return unchanged({EligibilityId});
        return {writes:[write('HmoEligibility',EligibilityId,{...next,EligibilityId,...stamp()},old),write('HmoEligibilityVersions',key,{...next,EligibilityId,...stamp()},null),
          event(key,c,'Record staff-verified HMO eligibility'),audit(key,c,'Record staff-verified HMO eligibility')],result:{EligibilityId}};
      });
    },
    async createServiceCharge(body){
      requireCapability('billing.write');confirmed(body);const ServiceCode=code(body.ServiceCode),Description=field(body,'Description',200,true),Quantity=quantity(body.Quantity),UnitPriceCents=amount(body.UnitPrice),Reference=field(body,'Reference',160,true);
      if(!['Consultation','Laboratory','Imaging','Procedure','Bed','Other'].includes(body.Category))fail('Choose a service category.');
      if(body.OrderId&&!['Laboratory','Imaging'].includes(body.Category))fail('Only investigation charges use an investigation order reference.');await branch(body);
      return operation(body,'createServiceCharge',async key=>{
        const c=await visit(body);if(c.visit.Status==='Cancelled')fail('This visit is cancelled.',409);
        if(['Laboratory','Imaging'].includes(body.Category)){
          const order=await read('Orders',body.OrderId);if(!order||order.BranchId!==c.BranchId||order.VisitId!==c.visit.VisitId||order.PatientId!==c.person.PatientId||order.Kind!==body.Category||order.Status==='Cancelled')fail('Choose the matching investigation order.',409);
        }
        const source=body.OrderId?`order:${id(body.OrderId)}`:nameKey(Reference),ChargeId=await keyFor('service',c.BranchId,c.visit.VisitId,source);
        const old=await read('ChargeEvents',ChargeId),fields={ServiceCode,Description,Quantity,UnitPriceCents,Reference,Category:body.Category,OrderId:body.OrderId||''};
        if(old){if(!equal(old.Service,fields))fail('This service reference was already charged with different details.',409);return unchanged({ChargeId});}
        return {writes:[write('ChargeEvents',ChargeId,{ChargeId,BranchId:c.BranchId,PatientId:c.person.PatientId,VisitId:c.visit.VisitId,Source:'Service',SourceId:source,Service:fields,
          ServiceCode,Description,Quantity,AmountCents:cents(chargeCents(Quantity,UnitPriceCents)),Currency:'NGN',Status:'Awaiting billing',...stamp()},null),
          event(key,c,'Record service charge',{ChargeId}),audit(key,c,'Record service charge')],result:{ChargeId}};
      });
    },
    async voidServiceCharge(body){
      requireCapability('billing.write');const Reason=field(body,'Reason',2000,true);await branch(body);
      return operation(body,'voidServiceCharge',async key=>{
        const c=await visit(body),row=await read('ChargeEvents',body.ChargeId);
        if(!row||row.BranchId!==c.BranchId||row.PatientId!==c.person.PatientId||row.VisitId!==c.visit.VisitId||row.Source!=='Service')fail('Choose a service charge from this visit.',404);
        if(row.Status==='Voided')return unchanged({ChargeId:row.ChargeId});revision(body,row);
        if(row.Status!=='Awaiting billing')fail('An invoiced charge requires a credit note; it cannot be voided.',409);
        return {writes:[write('ChargeEvents',row.ChargeId,{...strip(row),Status:'Voided',VoidReason:Reason,VoidedAt:clock(),VoidedBy:actor},row),event(key,c,'Void unbilled service charge',{ChargeId:row.ChargeId,Reason}),audit(key,c,'Void unbilled service charge')],result:{ChargeId:row.ChargeId}};
      });
    },
    async billingCharges(body){const extra=body.VisitId?[eq('VisitId',id(body.VisitId))]:[];return dated(body,'ChargeEvents',extra);},
    async billingInvoices(body){return dated(body,'Invoices');},
    async hmoClaims(body){requireCapability('hmo.work');return dated(body,'Claims');},
    async issueHospitalInvoice(body){
      requireCapability('billing.write');confirmed(body);await branch(body);
      if(!Array.isArray(body.ChargeIds)||!body.ChargeIds.length||body.ChargeIds.length>30||new Set(body.ChargeIds).size!==body.ChargeIds.length)fail('Select between 1 and 30 distinct charges.');body.ChargeIds.forEach(id);
      return operation(body,'issueHospitalInvoice',async key=>{
        const c=await visit(body),charges=await Promise.all(body.ChargeIds.map(k=>read('ChargeEvents',k)));
        if(charges.some(r=>!r||r.BranchId!==c.BranchId||r.VisitId!==c.visit.VisitId||r.PatientId!==c.person.PatientId||r.AmountCents<0||r.Source==='Return'||r.Status!=='Awaiting billing'))fail('One or more charges are already billed, are credits, or belong to another visit.',409);
        let coverage=null;if(body.UseHmo===true){coverage=await read('HmoEligibility',await keyFor('eligibility',c.BranchId,c.visit.VisitId));
          if(!coverage||coverage.PatientId!==c.person.PatientId)fail('Record verified eligibility for this visit first.');revision(body,coverage,'EligibilityRevision');
          if(coverage.From>watDay(clock())||coverage.To<watDay(clock()))fail('The staff-verified eligibility is outside its valid dates.',409);
        }
        const Lines=charges.map(r=>({ChargeId:r.ChargeId,Source:r.Source,Description:r.Description||'Dispensed medicine',...splitCharge(r,coverage?.Plan)}));
        const PatientCents=cents(Lines.reduce((s,l)=>s+l.PatientCents,0)),HmoCents=cents(Lines.reduce((s,l)=>s+l.HmoCents,0));
        const mapping=await posting(c.BranchId,['PatientReceivable','HmoReceivable','Revenue']);
        const row={InvoiceId:key,InvoiceNumber:`HI-${key.slice(0,16).toUpperCase()}`,BranchId:c.BranchId,PatientId:c.person.PatientId,PatientName:patientSummary(c.person).DisplayName,
          HospitalNumber:c.person.HospitalNumber,VisitId:c.visit.VisitId,Currency:'NGN',Lines,PatientCents,HmoCents,PatientCreditCents:0,HmoCreditCents:0,PatientPaidCents:0,HmoPaidCents:0,PatientRefundCents:0,HmoRefundCents:0,
          Coverage:coverage?strip(coverage):null,Accounts:{PatientReceivable:mapping.PatientReceivable,HmoReceivable:mapping.HmoReceivable,Revenue:mapping.Revenue},Status:'Issued',...stamp()};c.invoice=row;
        const writes=[write('Invoices',key,row,null),...charges.map(r=>write('ChargeEvents',r.ChargeId,{...strip(r),InvoiceId:key,Status:'Billed',BilledAt:clock()},r)),
          ...journal(key,c,'Invoice',[line(mapping.PatientReceivable,PatientCents),line(mapping.HmoReceivable,HmoCents),line(mapping.Revenue,0,PatientCents+HmoCents)]),event(key,c,'Issue invoice'),audit(key,c,'Issue invoice')];
        if(HmoCents)writes.push(write('Claims',key,{ClaimId:key,InvoiceId:key,InvoiceNumber:row.InvoiceNumber,PatientId:row.PatientId,PatientName:row.PatientName,BranchId:c.BranchId,
          Insurer:coverage.Plan.Insurer,MemberNumber:coverage.MemberNumber,Authorization:coverage.Authorization,AmountCents:HmoCents,Status:'Prepared',SubmissionNumber:0,...stamp()},null));
        return {writes,result:{InvoiceId:key,PatientId:row.PatientId}};
      });
    },
    async hospitalInvoiceDetails(body){
      any('billing.read','hmo.work');const c=await invoice(body),claim=c.invoice.HmoCents?await read('Claims',c.invoice.InvoiceId):null;
      await auditRead(body,'View hospital invoice',c.BranchId,c.person,{InvoiceId:c.invoice.InvoiceId});
      return {ok:true,invoice:{...view(c.invoice),...balances(c.invoice)},claim:view(claim)};
    },
    async hospitalBillingHistory(body){any('billing.read','hmo.work');const filters=dateFilters(body.DateRange),c=await invoice(body),rows=await page('BillingEvents',[eq('BranchId',c.BranchId),eq('InvoiceId',c.invoice.InvoiceId),...filters],'CreatedAt',body);
      await auditRead(body,'View dated invoice history',c.BranchId,c.person,{InvoiceId:c.invoice.InvoiceId});return {ok:true,rows:rows.rows.map(view),next:rows.next};},
    async creditHospitalCharge(body){
      requireCapability('billing.write');confirmed(body);await branch(body);
      let adjustment=null;
      if(body.Adjustment){requireCapability('billing.refund');adjustment={OriginalChargeId:id(body.Adjustment.OriginalChargeId),AmountCents:amount(body.Adjustment.Amount),
        Reason:field(body.Adjustment,'Reason',2000,true),Reference:field(body.Adjustment,'Reference',160,true)};}
      return operation(body,'creditHospitalCharge',async key=>{
        const c=await invoice(body);let credit;
        if(adjustment){
          const ChargeId=await keyFor('adjustment',c.BranchId,c.invoice.InvoiceId,nameKey(adjustment.Reference)),prior=await read('ChargeEvents',ChargeId);
          if(prior){if(!equal(prior.Adjustment,adjustment))fail('This credit reference already records a different adjustment.',409);return unchanged({InvoiceId:c.invoice.InvoiceId});}
          credit={ChargeId,BranchId:c.BranchId,PatientId:c.person.PatientId,VisitId:c.invoice.VisitId,Source:'Service adjustment',SourceId:ChargeId,OriginalChargeId:adjustment.OriginalChargeId,
            AmountCents:-adjustment.AmountCents,Status:'Awaiting billing',Adjustment:adjustment,Currency:'NGN',...stamp()};
        }else credit=await read('ChargeEvents',body.ChargeId);
        if(!credit||credit.BranchId!==c.BranchId||credit.PatientId!==c.person.PatientId||credit.VisitId!==c.invoice.VisitId||(!adjustment&&credit.Source!=='Return')||credit.AmountCents>0)fail('Choose a return credit for this invoice.',409);
        if(credit.Status==='Credited'&&credit.InvoiceId===c.invoice.InvoiceId)return unchanged({InvoiceId:c.invoice.InvoiceId});
        revision(body,c.invoice);
        if(credit.Status!=='Awaiting billing')fail('This credit was already processed.',409);
        const original=c.invoice.Lines.find(l=>l.ChargeId===credit.OriginalChargeId);if(!original)fail('The original charge is not on this invoice.',409);
        if(adjustment&&original.Source!=='Service')fail('Use the pharmacy return workflow to credit dispensed medicine.',409);
        const totalId=await keyFor('credit-total',original.ChargeId),total=await read('CreditTotals',totalId),sourceTotal=(total?.SourceCents||0)-credit.AmountCents;
        if(sourceTotal>original.SourceAmountCents)fail('Returns exceed the original source charge.',409);
        const gross=original.SourceAmountCents?cumulativeCredit(original.GrossCents,sourceTotal,original.SourceAmountCents):0;
        const pat=original.SourceAmountCents?cumulativeCredit(original.PatientCents,sourceTotal,original.SourceAmountCents):0;
        const PatientCreditCents=pat-(total?.PatientCents||0),HmoCreditCents=gross-pat-(total?.HmoCents||0);
        const next={...strip(c.invoice),PatientCreditCents:c.invoice.PatientCreditCents+PatientCreditCents,HmoCreditCents:c.invoice.HmoCreditCents+HmoCreditCents};
        const mapping=await posting(c.BranchId,['PatientReceivable','HmoReceivable','Revenue'],c.invoice.Accounts);
        const action=adjustment?'Credit hospital service':'Credit returned medicine';
        const writes=[write('Invoices',c.invoice.InvoiceId,next,c.invoice),write('ChargeEvents',credit.ChargeId,{...strip(credit),InvoiceId:c.invoice.InvoiceId,Status:'Credited',CreditedAt:clock()},adjustment?null:credit),
          write('CreditTotals',totalId,{ChargeId:original.ChargeId,SourceCents:sourceTotal,PatientCents:pat,HmoCents:gross-pat},total),
          write('CreditNotes',credit.ChargeId,{CreditNoteId:credit.ChargeId,InvoiceId:c.invoice.InvoiceId,BranchId:c.BranchId,PatientId:c.person.PatientId,PatientCreditCents,HmoCreditCents,Reason:adjustment?.Reason||'Pharmacy return',Reference:adjustment?.Reference||credit.SourceId,...stamp()},null),
          ...journal(key,c,'Credit',[line(mapping.Revenue,PatientCreditCents+HmoCreditCents),line(mapping.PatientReceivable,0,PatientCreditCents),line(mapping.HmoReceivable,0,HmoCreditCents)]),
          event(key,c,action,{ChargeId:credit.ChargeId,PatientCreditCents,HmoCreditCents,Reason:adjustment?.Reason||'Pharmacy return'}),audit(key,c,action)];
        if(HmoCreditCents){const claim=await read('Claims',c.invoice.InvoiceId);if(!claim)fail('The HMO claim is missing. Review before crediting.',409);
          writes.push(write('Claims',claim.ClaimId,{...strip(claim),AmountCents:next.HmoCents-next.HmoCreditCents,Status:claim.Status==='Prepared'?'Prepared':'Adjustment required',UpdatedAt:clock()},claim));}
        return {writes,result:{InvoiceId:c.invoice.InvoiceId}};
      });
    },
    async updateHmoClaim(body){
      requireCapability('hmo.work');confirmed(body);const Note=field(body,'Note',2000,true),Reference=field(body,'Reference',160,true);
      if(!['Submitted','Approved','Rejected'].includes(body.Status))fail('Choose Submitted, Approved or Rejected.');await branch(body);
      return operation(body,'updateHmoClaim',async key=>{
        const c=await invoice(body),claim=await read('Claims',c.invoice.InvoiceId);if(!claim)fail('This invoice has no HMO claim.');revision(body,claim);
        if(claim.Status===body.Status&&claim.Reference===Reference&&claim.Note===Note)return unchanged({InvoiceId:c.invoice.InvoiceId});
        const allowed=body.Status==='Submitted'?['Prepared','Rejected','Adjustment required']:['Submitted'];
        if(!allowed.includes(claim.Status))fail('This claim cannot make that transition. Refresh and review its current state.',409);
        const next={...strip(claim),Status:body.Status==='Approved'&&balances(c.invoice).HmoBalanceCents===0?'Settled':body.Status,Reference,Note,UpdatedAt:clock(),UpdatedBy:actor,SubmissionNumber:claim.SubmissionNumber+(body.Status==='Submitted'?1:0)};
        return {writes:[write('Claims',claim.ClaimId,next,claim),write('ClaimVersions',key,{...next,...stamp()},null),event(key,c,`Record HMO claim ${body.Status.toLowerCase()}`,{Reference,Note,AmountCents:claim.AmountCents}),audit(key,c,`Record HMO claim ${body.Status.toLowerCase()}`)],result:{InvoiceId:c.invoice.InvoiceId}};
      });
    },
    async recordHospitalPayment(body){
      requireCapability('billing.collect');confirmed(body);const fields=paymentFields(body);if(!['Patient','Hmo'].includes(body.Payer))fail('Choose Patient or Hmo.');await branch(body);
      return operation(body,'recordHospitalPayment',async key=>{
        // Bank transfer references are unique across this hospital workspace,
        // including branches sharing the receiving bank account.
        const c=await invoice(body),referenceId=await keyFor('receipt',fields.Method==='Cash'?c.BranchId:'all-branches',fields.Method,nameKey(fields.Reference)),prior=await read('PaymentReferences',referenceId);
        const signature={...fields,InvoiceId:c.invoice.InvoiceId,Payer:body.Payer};
        if(prior){if(!equal(prior.Signature,signature))fail('This receipt or bank reference is already used for another payment.',409);return unchanged({InvoiceId:c.invoice.InvoiceId,PaymentId:prior.PaymentId});}
        revision(body,c.invoice);const due=balances(c.invoice)[`${body.Payer}BalanceCents`];if(fields.AmountCents>due)fail('Payment exceeds the remaining balance for this payer.',409);
        let claim=null;if(body.Payer==='Hmo'){claim=await read('Claims',c.invoice.InvoiceId);if(!claim||!['Approved','Partially settled'].includes(claim.Status))fail('Record insurer approval before settlement.',409);}
        const config=await settings(c.BranchId);if(!config)fail('Set billing accounts first.');const cashKey=fields.Method==='Cash'?'Cash':'Bank',debtKey=body.Payer==='Patient'?'PatientReceivable':'HmoReceivable';
        const mapping=await posting(c.BranchId,[cashKey,debtKey],{...config,...c.invoice.Accounts});
        const row={PaymentId:key,ReceiptNumber:`HR-${key.slice(0,16).toUpperCase()}`,InvoiceId:c.invoice.InvoiceId,PatientId:c.person.PatientId,BranchId:c.BranchId,...fields,Payer:body.Payer,
          RefundedCents:0,ReceiptAccount:mapping[cashKey],ReceivableAccount:mapping[debtKey],...stamp()};
        const next={...strip(c.invoice),[`${body.Payer}PaidCents`]:c.invoice[`${body.Payer}PaidCents`]+fields.AmountCents};
        const writes=[write('Invoices',c.invoice.InvoiceId,next,c.invoice),write('Payments',key,row,null),write('PaymentReferences',referenceId,{Signature:signature,PaymentId:key},null),
          ...journal(key,c,'Payment',[line(mapping[cashKey],fields.AmountCents),line(mapping[debtKey],0,fields.AmountCents)]),
          event(key,c,'Record hospital payment',{PaymentId:key,ReceiptNumber:row.ReceiptNumber,AmountCents:fields.AmountCents,Payer:body.Payer,Reference:fields.Reference}),audit(key,c,'Record hospital payment')];
        if(claim)writes.push(write('Claims',claim.ClaimId,{...strip(claim),Status:fields.AmountCents===due?'Settled':'Partially settled',SettledCents:next.HmoPaidCents-next.HmoRefundCents,UpdatedAt:clock()},claim));
        return {writes,result:{InvoiceId:c.invoice.InvoiceId,PaymentId:key}};
      });
    },
    async hospitalPayments(body){return dated(body,'Payments',[eq('InvoiceId',id(body.InvoiceId))]);},
    async refundHospitalPayment(body){
      requireCapability('billing.refund');confirmed(body);const AmountCents=amount(body.Amount),Reason=field(body,'Reason',2000,true),Reference=field(body,'Reference',160,true);await branch(body);
      return operation(body,'refundHospitalPayment',async key=>{
        const c=await invoice(body),payment=await read('Payments',body.PaymentId);if(!payment||payment.InvoiceId!==c.invoice.InvoiceId||payment.BranchId!==c.BranchId||payment.PatientId!==c.person.PatientId)fail('Choose a receipt for this invoice.',404);
        const refId=await keyFor('refund',c.BranchId,nameKey(Reference)),prior=await read('RefundReferences',refId),signature={PaymentId:payment.PaymentId,AmountCents,Reason,Reference};
        if(prior){if(!equal(prior.Signature,signature))fail('This refund reference is already used.',409);return unchanged({InvoiceId:c.invoice.InvoiceId});}
        revision(body,c.invoice);revision(body,payment,'PaymentRevision');
        if(AmountCents>payment.AmountCents-payment.RefundedCents||AmountCents>-balances(c.invoice)[`${payment.Payer}BalanceCents`])fail('Refund exceeds the credited overpayment or the original receipt.',409);
        const cashKey=payment.Method==='Cash'?'Cash':'Bank',debtKey=payment.Payer==='Patient'?'PatientReceivable':'HmoReceivable';
        await posting(c.BranchId,[cashKey,debtKey],{[cashKey]:payment.ReceiptAccount,[debtKey]:payment.ReceivableAccount});
        const next={...strip(c.invoice),[`${payment.Payer}RefundCents`]:c.invoice[`${payment.Payer}RefundCents`]+AmountCents};
        const writes=[write('Invoices',c.invoice.InvoiceId,next,c.invoice),write('Payments',payment.PaymentId,{...strip(payment),RefundedCents:payment.RefundedCents+AmountCents},payment),
          write('Refunds',key,{RefundId:key,BranchId:c.BranchId,PatientId:c.person.PatientId,InvoiceId:c.invoice.InvoiceId,...signature,...stamp()},null),write('RefundReferences',refId,{Signature:signature,RefundId:key},null),
          ...journal(key,c,'Refund',[line(payment.ReceivableAccount,AmountCents),line(payment.ReceiptAccount,0,AmountCents)]),event(key,c,'Record hospital refund',{PaymentId:payment.PaymentId,AmountCents,Reason,Reference}),audit(key,c,'Record hospital refund')];
        if(payment.Payer==='Hmo'){const claim=await read('Claims',c.invoice.InvoiceId);if(!claim)fail('The HMO claim is missing.',409);writes.push(write('Claims',claim.ClaimId,{...strip(claim),SettledCents:next.HmoPaidCents-next.HmoRefundCents,UpdatedAt:clock()},claim));}
        return {writes,result:{InvoiceId:c.invoice.InvoiceId}};
      });
    }
  };
}
