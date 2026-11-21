import { fail } from './hospital-model.js';

const eq = (field, value) => ({ field, op: '==', value });
const orders = kind => [eq('Kind', kind)];
const modules = {
  hospitalPatients: ['Patients', 'Registered patients', []],
  hospitalReception: ['Visits', 'Registered visits', ['Waiting', 'In progress', 'Completed']],
  hospitalTriage: ['ClinicalEntries', 'Signed triage entries', [], [eq('Type', 'Triage')]],
  hospitalConsultations: ['Consultations', 'Consultations', ['Draft', 'Signed']],
  hospitalOrders: ['Orders', 'Clinical orders', ['Prescription', 'Laboratory', 'Imaging'], [], 'Kind'],
  hospitalPharmacy: ['Orders', 'Prescriptions', ['Awaiting pharmacy review', 'Ready to dispense', 'Dispensed'], orders('Prescription')],
  hospitalLaboratory: ['Orders', 'Laboratory requests', ['Requested', 'Verified', 'Released'], orders('Laboratory')],
  hospitalImaging: ['Orders', 'Imaging requests', ['Requested', 'Verified', 'Released'], orders('Imaging')],
  hospitalTheatre: ['ProcedureCases', 'Procedure bookings', ['Scheduled', 'In procedure', 'Recovery']],
  hospitalNursing: ['NursingHandovers', 'Nursing handovers', ['Awaiting acknowledgement', 'Acknowledged']],
  hospitalInpatients: ['Admissions', 'Admissions', ['Admitted', 'Discharged']],
  hospitalBilling: ['Payments', 'Recorded payments', ['Patient', 'Hmo', 'Corporate'], [], 'Payer'],
  hospitalHmo: ['Claims', 'Insurance claims', ['Prepared', 'Submitted', 'Settled']]
};

export function createHospitalDashboards({ env, user, db, branch, collection }) {
  return {
    async moduleDashboard(body) {
      const key = body.Module;
      if (!Object.hasOwn(modules, key) || !user.allowedSections?.includes(key)) fail('This dashboard is outside your module access.', 403);
      const branchId = await branch(body);
      const [register, label, indicators, fixed = [], field = 'Status'] = modules[key];
      const scope = register === 'Patients'
        ? { field: 'AccessBranchIds', op: 'ARRAY_CONTAINS', value: branchId }
        : eq('BranchId', branchId);
      const filters = [scope, ...fixed];
      const path = collection(register);
      const total = await db.countCollection(env, path, { filters });
      const metrics = await Promise.all(indicators.map(async label => {
        const count = total.count ? (await db.countCollection(env, path, {
          filters: [...filters, eq(field, label)], readTime: total.readTime
        })).count : 0;
        return { label, count };
      }));
      return { ok: true, total: { label, count: total.count }, metrics, readTime: total.readTime };
    }
  };
}
