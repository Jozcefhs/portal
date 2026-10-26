import {fail,id} from './hospital-model.js';
import {dateFilters,watDay} from './hospital-orders-model.js';
import {code,equal,balances} from './hospital-billing-model.js';
import {corporateFields,corporateCoverageFields,corporateBalance} from './hospital-corporate-model.js';

export function createHospitalCorporateService(ctx){
  const {requireCapability,branch,clock,actor,strip,eq,auditWrite,auditRead,operation,page,read,write,view,stamp,revision,confirmed,unchanged,keyFor,visit}=ctx;
  async function account(CompanyId,BranchId){const row=await read('CorporateAccounts',CompanyId);if(!row||row.BranchId!==BranchId)fail('This company account is not available in the selected branch.',404);return row;}
  const publicAccount=row=>row?{...view(row),BalanceCents:corporateBalance(row)}:null;
  async function financialChange(CompanyId,BranchId,deltas,key,Action,details={},old=null){
    if(!Object.values(deltas).some(Boolean))return [];
    const row=old||await account(CompanyId,BranchId),next={...strip(row),UpdatedAt:clock()};
    for(const [field,value]of Object.entries(deltas)){const total=(row[field]||0)+value;if(!Number.isSafeInteger(total)||total<0)fail('The corporate account total is outside the supported range.',409);next[field]=total;}
    if(deltas.BilledCents){if(!row.Active)fail('This corporate account is inactive. New corporate charges are not permitted.',409);if(row.CreditLimitCents!=null&&corporateBalance(next)>row.CreditLimitCents)fail('This invoice exceeds the company credit limit. Review its account before billing.',409);}
    return [write('CorporateAccounts',CompanyId,next,row),write('CorporateEvents',key,{EventId:key,CompanyId,CompanyName:row.Name,BranchId,Action,...details,...deltas,BalanceCents:corporateBalance(next),...stamp()},null)];
  }
  async function invoiceCoverage(c,body){
    const coverage=await read('CorporateCoverage',await keyFor('corporate-coverage',c.BranchId,c.visit.VisitId));
    if(!coverage||coverage.PatientId!==c.person.PatientId||coverage.BranchId!==c.BranchId)fail('Record verified corporate coverage for this visit first.');
    revision(body,coverage,'CorporateCoverageRevision');if(coverage.From>watDay(clock())||coverage.To<watDay(clock()))fail('The corporate authorisation is outside its valid dates.',409);
    const company=await account(coverage.CompanyId,c.BranchId);if(!company.Active)fail('This corporate account is inactive.',409);return {coverage,company};
  }
  return {account,financialChange,invoiceCoverage,actions:{
    async findCorporateAccount(body){requireCapability('billing.read');const BranchId=await branch(body),CompanyId=await keyFor('corporate-account',BranchId,code(body.Code));return {ok:true,company:publicAccount(await read('CorporateAccounts',CompanyId))};},
    async saveCorporateAccount(body){
      requireCapability('billing.configure');const BranchId=await branch(body),fields=corporateFields(body.Company);
      return operation(body,'saveCorporateAccount',async key=>{
        const CompanyId=await keyFor('corporate-account',BranchId,fields.Code),old=await read('CorporateAccounts',CompanyId);if(body.CompanyId&&body.CompanyId!==CompanyId)fail('Company codes cannot be changed. Create a separate account for another company.',409);if(old)revision(body,old);
        if(old&&equal(Object.fromEntries(Object.keys(fields).map(k=>[k,old[k]])),fields))return unchanged({CompanyId});
        const next={...strip(old),...fields,CompanyId,BranchId,CreatedAt:old?.CreatedAt||clock(),UpdatedAt:clock(),UpdatedBy:actor};
        return {writes:[write('CorporateAccounts',CompanyId,next,old),write('CorporateAccountVersions',key,{...fields,CompanyId,BranchId,...stamp()},null),
          auditWrite(key,'Save corporate hospital account',BranchId,{}, {Subject:fields.Name,SubjectName:fields.Name,CompanyId})],result:{CompanyId}};
      });
    },
    async hospitalCorporateVisit(body){requireCapability('billing.read');const c=await visit(body),coverage=await read('CorporateCoverage',await keyFor('corporate-coverage',c.BranchId,c.visit.VisitId));
      await auditRead(body,'View corporate visit coverage',c.BranchId,c.person,{VisitId:c.visit.VisitId});return {ok:true,coverage:view(coverage)};},
    async saveCorporateCoverage(body){
      requireCapability('billing.configure');confirmed(body);const fields=corporateCoverageFields(body.Coverage);await branch(body);
      return operation(body,'saveCorporateCoverage',async key=>{
        const c=await visit(body),company=await account(id(body.CompanyId),c.BranchId);revision(body,company,'CompanyRevision');if(!company.Active)fail('Choose an active corporate account.');
        const CoverageId=await keyFor('corporate-coverage',c.BranchId,c.visit.VisitId),old=await read('CorporateCoverage',CoverageId);if(old)revision(body,old);
        const snapshot={CompanyId:company.CompanyId,Code:company.Code,Name:company.Name,PaymentTermsDays:company.PaymentTermsDays};
        if(old&&old.CompanyId===company.CompanyId&&equal(old.Company,snapshot)&&equal(Object.fromEntries(Object.keys(fields).map(k=>[k,old[k]])),fields))return unchanged({CoverageId});
        const next={CoverageId,CompanyId:company.CompanyId,Company:snapshot,BranchId:c.BranchId,PatientId:c.person.PatientId,VisitId:c.visit.VisitId,...fields,...stamp()};
        return {writes:[write('CorporateCoverage',CoverageId,next,old),write('CorporateCoverageVersions',key,next,null),auditWrite(key,'Save verified corporate coverage',c.BranchId,c.person,{CompanyId:company.CompanyId,VisitId:c.visit.VisitId})],result:{CoverageId}};
      });
    },
    async hospitalCorporateStatement(body){
      requireCapability('billing.read');const dates=dateFilters(body.DateRange),BranchId=await branch(body),company=await account(id(body.CompanyId),BranchId);
      if(!['Invoices','Events'].includes(body.Kind))fail('Choose invoices or account movements.');
      const name=body.Kind==='Invoices'?'Invoices':'CorporateEvents',result=await page(name,[eq('BranchId',BranchId),eq('CompanyId',company.CompanyId),...dates],'CreatedAt',body);
      await auditRead(body,'View dated corporate statement',BranchId,{}, {CompanyId:company.CompanyId,Subject:company.Name,ResultCount:result.rows.length});
      return {ok:true,company:publicAccount(company),rows:result.rows.map(r=>body.Kind==='Invoices'?{InvoiceId:r.InvoiceId,InvoiceNumber:r.InvoiceNumber,PatientName:r.PatientName,PatientId:r.PatientId,HospitalNumber:r.HospitalNumber,CreatedAt:r.CreatedAt,DueDate:r.DueDate,CorporateCents:r.CorporateCents,CorporateCreditCents:r.CorporateCreditCents,CorporateBalanceCents:balances(r).CorporateBalanceCents}:view(r)),next:result.next};
    }
  }};
}
