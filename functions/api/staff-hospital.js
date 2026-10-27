import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { createHospitalService } from '../lib/hospital-service.js';

export async function onRequestPost({ request, env, data }) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({ ok: false, message: 'Cross-site requests are not permitted.' }, { status: 403, headers });
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    if (body.action !== 'state' && cleanBranch(request.headers.get('X-Dynamax-Branch')) !== cleanBranch(body.BranchId)) return Response.json({ ok: false, message: 'Select the working branch before continuing.' }, { status: 403, headers });
    const user = await requireStaffSession(env, request);
    if (!['state', 'search', 'details', 'savePatient', 'assignCard', 'revokeCard', 'checkIn', 'visits', 'updateVisit',
      'prepareHospitalBed','inpatientWards','inpatientWard','inpatientBeds','saveHospitalWard','saveHospitalBed','inpatientVisit','admitHospitalPatient',
      'inpatientAdmissions','inpatientAdmission','transferHospitalBed','signHospitalDischarge','dischargeHospitalPatient','inpatientHistory',
      'clinicalContext','clinicalHistory','recordTriage','saveConsultation','signConsultation','amendClinicalEntry',
      'orderVisitContext','createOrder','listOrders','orderDetails','orderHistory','releasedReportHistory','cancelOrder','reviewPrescription','receiveMedicine','stockBatches','stockHistory','quarantineStock',
      'dispensePrescription','returnDispensedMedicine','dispensingHistory','recordSpecimen','recordInvestigationReport','verifyInvestigationReport',
      'releaseInvestigationReport','pendingCriticalAlerts','acknowledgeCriticalResult',
      'billingSettings','saveBillingSettings','saveHmoPlan','findHmoPlans','billingVisit','saveHmoEligibility','createServiceCharge','billingCharges',
      'voidServiceCharge','billingInvoices','hmoClaims','issueHospitalInvoice','hospitalInvoiceDetails','hospitalBillingHistory','creditHospitalCharge','updateHmoClaim',
      'recordHospitalPayment','hospitalPayments','refundHospitalPayment',
      'findCorporateAccount','saveCorporateAccount','hospitalCorporateVisit','saveCorporateCoverage','hospitalCorporateStatement',
      'hospitalDepositPatient','receiveHospitalFunds','hospitalFunds','hospitalFundDetails','hospitalFundInvoice','allocateHospitalFunds',
      'hospitalFundHistory','hospitalFundAllocations','returnHospitalAllocation','refundHospitalFunds'].includes(body.action)) return Response.json({ ok: false, message: 'Choose a valid Hospital action.' }, { status: 400, headers });
    const result = await createHospitalService(env, user)[body.action](body);
    // Hospital operations own their atomic audit trail. The middleware still records failures.
    if (data) data.securityAuditHandled = true;
    return Response.json(result, { headers });
  } catch (error) {
    const status = Number(error.status || 500);
    return Response.json({ ok: false, message: status >= 500 ? 'The Hospital request could not be completed. Retry with the same request reference.' : error.message }, { status, headers });
  }
}

function cleanBranch(value) { return String(value || '').trim().toLowerCase(); }
