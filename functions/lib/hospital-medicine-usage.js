import { fail } from './hospital-model.js';
import { dateFilters, qty } from './hospital-orders-model.js';

export function usageMedicine(fields) {
  const { MedicineKey, Medicine, Strength, Form, Unit } = fields;
  return { MedicineKey, Medicine, Strength, Form, Unit };
}

export function createMedicineUsageReport({ capabilities, branch, clock, page, eq, read }) {
  return async function getMedicineUsage(body) {
    if (!['pharmacy.work', 'pharmacy.configure'].some(cap => capabilities.includes(cap))) {
      fail('Pharmacy access is required to view medicine usage.', 403);
    }
    const dates = dateFilters(body.DateRange);
    const branchId = await branch(body);
    const now = clock();
    const readTime = body.Cursor ? body.ReadTime : now;
    const instant = Date.parse(readTime);
    if (!Number.isFinite(instant) || new Date(instant).toISOString() !== readTime ||
        instant > Date.parse(now) || Date.parse(now) - instant > 55 * 60000) {
      fail('This report snapshot has expired. Refresh the report to continue.', 409);
    }
    const filters = [eq('BranchId', branchId), {field:'Type', op:'in', value:['Dispense', 'Patient return']}, ...dates];
    const select = ['BatchId', 'Type', 'CreatedAt', 'Quantity', 'QuarantinedQuantity', 'UsageMedicine'];
    const { rows, next } = await page('StockMovements', filters, 'CreatedAt', body, { select, readTime });
    // Earlier movements contain only the batch ID. Resolve each distinct batch once per page.
    const labels = new Map(rows.filter(r => r.UsageMedicine?.MedicineKey).map(r => [r.BatchId, r.UsageMedicine]));
    const missing = [...new Set(rows.map(r => r.BatchId).filter(id => id && !labels.has(id)))];
    await Promise.all(missing.map(async id => {
      const batch = await read('MedicineBatches', id);
      if (batch?.BranchId === branchId && batch.MedicineKey) labels.set(id, usageMedicine(batch));
    }));
    const groups = new Map();
    for (const row of rows) {
      const medicine = row.UsageMedicine || labels.get(row.BatchId);
      const key = medicine?.MedicineKey || 'unknown:' + (row.BatchId || row.__id);
      const group = groups.get(key) || { key, medicine:medicine?.Medicine || 'Unresolved batch ' + (row.BatchId || row.__id),
        strength:medicine?.Strength || '', form:medicine?.Form || '', unit:medicine?.Unit || 'Unspecified',
        dispensed:0, returned:0 };
      if (row.Type === 'Dispense') group.dispensed = qty(group.dispensed - row.Quantity);
      else group.returned = qty(group.returned + row.QuarantinedQuantity);
      groups.set(key, group);
    }
    return { ok:true, groups:[...groups.values()], next, readTime };
  };
}
