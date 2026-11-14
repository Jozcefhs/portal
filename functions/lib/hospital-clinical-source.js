import {fail,id} from './hospital-model.js';

export const clinicalAccessVersion=grant=>grant.ClinicalAccessVersion||grant.CreatedAt;
export const clinicalTypes={investigations:{parent:'Orders',source:'ReleasedReports',capability:'orders.create'},discharges:{parent:'Admissions',source:'DischargeSummaries',capability:'inpatient.discharge'}};
export async function clinicalSource({read,type,parentId,patientId,branchId}){
  const config=clinicalTypes[type];if(!config)fail('Choose an investigation result or discharge summary.');
  const parent=await read(config.parent,id(parentId));
  if(!parent||parent.PatientId!==patientId||parent.BranchId!==branchId)fail('This clinical record is not available for this patient.',404);
  const sourceId=type==='investigations'?parent.ReleasedReportId:parent.LatestDischargeSummaryId||parent.DischargeSummaryId;
  const blocked=message=>({parent,ready:false,message,source:null});
  if(type==='investigations'&&(!['Laboratory','Imaging'].includes(parent.Kind)||parent.Status!=='Released'||!sourceId||parent.LatestReportId!==sourceId))return blocked('The latest investigation must be independently verified and released before portal sharing.');
  if(type==='discharges'&&(parent.Status!=='Discharged'||!parent.DischargedAt||!sourceId))return blocked('Complete the discharge and sign its summary before portal sharing.');
  const source=await read(config.source,id(sourceId));
  if(!source||source.PatientId!==patientId||source.BranchId!==branchId||(type==='investigations'?source.OrderId!==parentId||source.ReportId!==sourceId:source.AdmissionId!==parentId||source.SummaryId!==sourceId))return blocked('The signed source could not be verified. Ask the clinical team to review it.');
  if(type==='investigations'){
    if(!source.VerifiedBy||!source.ReleasedBy||!source.ReleasedAt)return blocked('Independent verification and release are required.');
    if(source.Critical){const alert=await read('CriticalAlerts',sourceId);if(!alert||alert.PatientId!==patientId||alert.BranchId!==branchId||alert.OrderId!==parentId||alert.Status!=='Acknowledged')return blocked('The critical result needs clinician acknowledgement before portal sharing.');}
  }else if(!source.SignedBy||!source.CreatedAt)return blocked('A signed discharge summary is required.');
  return {parent,source,sourceId,ready:true,title:type==='investigations'?parent.Fields?.Service||parent.Service||'Investigation result':'Discharge summary',
    number:type==='investigations'?parent.OrderNumber||'Investigation result':parent.AdmissionNumber||'Discharge summary'};
}
export function clinicalDocument(c){
  const s=c.source;
  return s.ReportId?{Title:c.title,Number:c.number,CreatedAt:s.ReleasedAt,Text:s.Text,Author:s.ActorName||s.ActorUsername||'',VerifiedBy:s.VerifiedBy,ReleasedBy:s.ReleasedBy,Critical:!!s.Critical}:
    {Title:'Discharge summary',Number:c.number,CreatedAt:s.CreatedAt,DischargedAt:c.parent.DischargedAt,Author:s.SignedByName||s.SignedBy,
      Amendment:s.Type==='Post-discharge amendment',Disposition:s.Disposition,Diagnosis:s.Diagnosis,Course:s.Course,Treatment:s.Treatment,FollowUp:s.FollowUp};
}
