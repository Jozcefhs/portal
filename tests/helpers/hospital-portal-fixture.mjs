import {fixture,env,request,actor} from './hospital-fixture.mjs';
import {hospitalPatientPortalAction} from '../../functions/lib/hospital-patient-portal.js';
import {hospitalCollectionPath} from '../../functions/lib/hospital-storage.js';
export const portalEnv={...env,HOSPITAL_PORTAL_SECRET:'fixture-only-long-random-portal-pepper-secret'};
export const password='Fixture patient passphrase 2026!';
export async function portalFixture(){
  const f=fixture(actor,portalEnv);f.db.staffAccessFor=async()=>({edition:'hospital',subscriptionActive:true,allowedSections:['hospitalBilling']});
  const saved=await f.register();const PatientId=saved.PatientId;
  const issue=request({PatientId,Kind:'Guardian',RecipientName:'Fixture Guardian',Contact:'guardian@example.invalid',Relationship:'Parent',AccessUntil:'2027-10-26',Reason:'Verified guardian authority',ConfirmIdentity:true,ConfirmAuthority:true,InvitationToken:'a'.repeat(64)});
  const access=await f.service.issuePatientPortalAccess(issue);
  const call=(body,token='')=>hospitalPatientPortalAction(portalEnv,token,body,f.db);
  const activate=()=>call({action:'activate',AccessCode:access.AccessCode,InvitationToken:issue.InvitationToken,Password:password,RequestId:crypto.randomUUID()});
  const put=(name,key,row)=>f.store.set(`${hospitalCollectionPath(portalEnv,name)}/${key}`,{...row,__id:key,__updateTime:'seed-'+key});
  const base={PatientId,BranchId:'main',CreatedAt:'2026-10-26T12:00:00.000Z',Currency:'NGN'};
  const invoice={...base,InvoiceId:'invoice001',InvoiceNumber:'HI-TEST001',Status:'Issued',PatientCents:100000,PatientCreditCents:10000,PatientPaidCents:45000,PatientRefundCents:5000,PatientAllocationReturnCents:1000,HmoCents:80000,CorporateCents:0,Accounts:{Bank:'private'},Coverage:{MemberNumber:'private'},Lines:[{Description:'Consultation',PatientCents:100000,HmoCents:80000,ChargeId:'hidden'}]};
  put('Invoices','invoice001',invoice);
  put('Payments','payment001',{...base,PaymentId:'payment001',InvoiceId:'invoice001',ReceiptNumber:'HR-TEST001',Payer:'Patient',AmountCents:40000,RefundedCents:5000,Method:'Cash',Reference:'cash-fixture',ReceiptAccount:'private'});
  put('Payments','payment002',{...base,PaymentId:'payment002',InvoiceId:'invoice001',ReceiptNumber:'HR-ALLOC001',Payer:'Patient',SourceFundId:'deposit001',SourceReceiptNumber:'HA-TEST001',AmountCents:5000,RefundedCents:0,ReturnedToFundCents:1000,Method:'Deposit allocation'});
  put('Payments','paymentHmo',{...base,PaymentId:'paymentHmo',Payer:'Hmo',AmountCents:80000,ReceiptNumber:'PRIVATE-HMO'});
  put('Funds','deposit001',{...base,FundId:'deposit001',ReceiptNumber:'HA-TEST001',Kind:'Patient',AmountCents:20000,AppliedCents:4000,RefundedCents:2000,Method:'Bank transfer',Reference:'advance-fixture'});
  put('Invoices','invoiceOther',{...invoice,InvoiceId:'invoiceOther',PatientId:'another-patient'});
  put('Invoices','invoiceNorth',{...invoice,InvoiceId:'invoiceNorth',BranchId:'north'});
  return {...f,PatientId,issue,access,call,activate,put,invoice};
}
