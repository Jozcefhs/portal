import {portalFixture,portalEnv} from './hospital-portal-fixture.mjs';
import {createHospitalService} from '../../functions/lib/hospital-service.js';
import {request,actor} from './hospital-fixture.mjs';
export const clinician={...actor,username:'doctor',displayName:'Demo clinician',role:'Doctor',allowedSections:['hospitalOrders','hospitalInpatients','hospitalPatients','hospitalReception']};
export async function clinicalPortalFixture(){
 const f=await portalFixture(),doctor=createHospitalService(portalEnv,clinician,f.db),base={PatientId:f.PatientId,BranchId:'main',CreatedAt:'2026-10-26T10:00:00.000Z'};
 f.put('Orders','order001',{...base,OrderId:'order001',OrderNumber:'HO-DEMO',Kind:'Laboratory',Fields:{Service:'Demo investigation'},Status:'Released',LatestReportId:'report001',ReleasedReportId:'report001'});
 f.put('ReleasedReports','report001',{...base,ReportId:'report001',OrderId:'order001',Text:'Synthetic result. <script>never run</script>',ActorName:'Sample scientist',ActorUsername:'scientist',VerifiedBy:'other-scientist',ReleasedBy:'scientist',ReleasedAt:'2026-10-26T11:00:00.000Z',Reason:'Internal correction notes',SpecimenSnapshot:{Private:'internal'}});
 f.put('Admissions','admit001',{...base,AdmissionId:'admit001',Status:'Discharged',DischargedAt:'2026-10-26T11:30:00.000Z',DischargeSummaryId:'summary001',VisitId:'visit001'});
 f.put('DischargeSummaries','summary001',{...base,SummaryId:'summary001',AdmissionId:'admit001',VisitId:'visit001',SignedBy:'doctor',SignedByName:'Demo clinician',Disposition:'Home',Diagnosis:'Synthetic diagnosis',Course:'Demo course\nSecond line',Treatment:'Demo instructions only',FollowUp:'Demo follow-up',Reason:'Internal replacement reason'});
 const scope=(type='investigations')=>request({DocumentType:type,ParentId:type==='investigations'?'order001':'admit001',PatientId:f.PatientId,GrantId:f.access.GrantId});
 async function publishing(type='investigations',extra={}){
  const body={...scope(type),...extra},c=await doctor.clinicalPortalContext(body),sharing=await doctor.clinicalPortalSharing(body),g=f.rows('PortalGrants').find(g=>g.GrantId===body.GrantId);
  return {...body,SourceId:c.SourceId,SourceRevision:c.SourceRevision,ParentRevision:c.ParentRevision,GrantRevision:g.__updateTime,Revision:sharing.publication?.Revision||'',ConfirmConsent:true,ConfirmClinicalReview:true,Reason:'Synthetic verified recipient consent'};
 }
 return {...f,doctor,scope,publishing};
}
