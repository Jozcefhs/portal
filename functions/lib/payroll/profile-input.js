import { financeFailure, financeMoney } from '../accounting-mutation-guards.js';

const clean = value => String(value ?? '').trim();
const fields = ['EmployeeId', 'Username', 'DisplayName', 'Department', 'Position', 'EmploymentType',
  'BasicSalary', 'Allowances', 'Deductions', 'PensionRate', 'TaxRate', 'CalculationMode',
  'ComponentAssignments', 'TaxStatus', 'TaxJurisdiction', 'TaxProfileId', 'TIN',
  'PensionParticipating', 'PensionRateOverride', 'PensionScheme', 'NhfParticipating', 'NhfRate',
  'AdditionalReliefs', 'BeginningYearCumulative', 'BankName', 'AccountName', 'AccountNumber',
  'SalaryExpenseAccount', 'Active', 'Notes'];
const fieldNames = new Map(fields.map(field => [field.toLowerCase(), field]));
fieldNames.set('name', 'DisplayName');

// Import data must never be merged into authenticated request metadata.
export function payrollImportRows(sourceRows) {
  const usernames = new Set();
  const employeeIds = new Set();
  return sourceRows.map((source, index) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw financeFailure(`CSV row ${index + 2} is invalid.`);
    const row = {};
    for (const [key, value] of Object.entries(source)) {
      const field = fieldNames.get(clean(key).toLowerCase());
      if (!field) throw financeFailure(`CSV row ${index + 2}: unsupported column ${clean(key) || '(extra cell)'}. Use the payroll template.`);
      if (Object.hasOwn(row, field)) throw financeFailure(`CSV row ${index + 2}: duplicate column ${field}.`);
      row[field] = value;
    }
    const username = clean(row.Username).toLowerCase();
    const employeeId = clean(row.EmployeeId).toLowerCase();
    if (!username || !clean(row.DisplayName)) throw financeFailure(`CSV row ${index + 2}: username and display name are required.`);
    if (usernames.has(username)) throw financeFailure(`CSV row ${index + 2}: duplicate username ${row.Username}. No rows were imported by this request.`);
    if (employeeId && employeeIds.has(employeeId)) throw financeFailure(`CSV row ${index + 2}: duplicate employee ID ${row.EmployeeId}.`);
    usernames.add(username);
    if (employeeId) employeeIds.add(employeeId);
    row.BasicSalary = financeMoney(row.BasicSalary, `CSV row ${index + 2} basic salary`);
    for (const [field, choices] of [
      ['CalculationMode', ['LEGACY_FLAT_RATE', 'CONFIGURABLE_PAYE']],
      ['TaxStatus', ['TAXABLE', 'EXEMPT', 'TAX_EXEMPT']]
    ]) {
      if (clean(row[field]) && !choices.includes(clean(row[field]).toUpperCase())) {
        throw financeFailure(`CSV row ${index + 2}: invalid ${field}. Choose ${choices.join(' or ')}.`);
      }
    }
    for (const key of ['PensionRate', 'TaxRate', 'PensionRateOverride', 'NhfRate']) {
      if (key === 'PensionRateOverride' && (row[key] == null || clean(row[key]) === '')) { delete row[key]; continue; }
      if (Object.hasOwn(row, key)) row[key] = financeMoney(row[key], key, { max: 100, defaultValue: 0 });
    }
    for (const key of ['Allowances', 'Deductions']) {
      if (Object.hasOwn(row, key)) row[key] = payrollProfileComponents(row[key], key);
    }
    Object.assign(row, payrollAdvancedValues(row));
    return row;
  });
}

function payrollJson(value, label, list) {
  let parsed = value;
  if (typeof value === 'string') {
    if (!value.trim()) parsed = list ? [] : {};
    else {
      try { parsed = JSON.parse(value); }
      catch { throw financeFailure(`${label} must contain valid JSON.`); }
    }
  }
  if (list ? !Array.isArray(parsed) : !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw financeFailure(`${label} must be a JSON ${list ? 'list' : 'object'}.`);
  }
  const checkFinite = item => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw financeFailure(`${label} must not contain nonfinite values.`);
    if (item && typeof item === 'object') Object.values(item).forEach(checkFinite);
  };
  checkFinite(parsed);
  return parsed;
}

// Keep absent fields absent during CSV validation. The profile save chooses
// existing values only when a column was not supplied; [] / {} explicitly clear.
export function payrollAdvancedValues(body) {
  const result = {};
  for (const key of ['ComponentAssignments', 'AdditionalReliefs', 'BeginningYearCumulative']) {
    if (body[key] === undefined) continue;
    const parsed = payrollJson(body[key], key, key !== 'BeginningYearCumulative');
    if (key === 'BeginningYearCumulative') { result[key] = parsed; continue; }
    result[key] = parsed.map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw financeFailure(`${key} row ${index + 1} must be an object.`);
      const item = { ...row };
      if (key === 'ComponentAssignments') {
        item.ComponentId = clean(row.ComponentId ?? row.componentId);
        item.Code = clean(row.Code ?? row.code).toUpperCase();
        if (!item.ComponentId && !item.Code) throw financeFailure(`${key} row ${index + 1} needs a component ID or code.`);
        for (const field of ['Amount', 'Value', 'PercentageRate']) {
          const value = row[field] ?? row[field[0].toLowerCase() + field.slice(1)];
          if (value !== undefined) item[field] = financeMoney(value, `${key} row ${index + 1} ${field}`, field === 'PercentageRate' ? { max: 100 } : {});
        }
        for (const field of ['CalculationType', 'PercentageBase', 'Formula']) {
          const value = row[field] ?? row[field[0].toLowerCase() + field.slice(1)];
          if (value !== undefined) item[field] = clean(value);
        }
      } else {
        for (const field of ['AnnualAmount', 'MonthlyAmount', 'Amount']) {
          if (Object.hasOwn(row, field)) item[field] = financeMoney(row[field], `${key} row ${index + 1} ${field}`);
        }
      }
      return item;
    });
  }
  return result;
}

export function payrollProfileComponents(value, label) {
  if (value === undefined || value === null || value === '') return [];
  let rows = value;
  if (typeof value === 'string') {
    if (value.trim().startsWith('[')) {
      try { rows = JSON.parse(value); } catch { throw financeFailure(`${label} must be a valid list.`); }
    } else {
      rows = value.replace(/\r?\n/g, ';').split(';').filter(part => part.trim()).map(part => {
        const match = /^\s*([^=:]+?)\s*[=:]\s*(.+?)\s*$/.exec(part);
        if (!match) throw financeFailure(`${label}: use Name=Amount separated by semicolons.`);
        return { Name: match[1], Amount: match[2] };
      });
    }
  }
  if (!Array.isArray(rows)) throw financeFailure(`${label} must be a list.`);
  return rows.map(row => {
    const name = clean(row?.Name ?? row?.name ?? row?.Label ?? row?.label);
    if (!name) throw financeFailure(`${label}: every component needs a name.`);
    return { Name: name, Amount: financeMoney(row.Amount ?? row.amount, `${label}: ${name}`) };
  }).filter(row => row.Amount > 0);
}

export function payrollProfileValues(body, existing = {}) {
  const value = (key, fallback = '') => body[key] === undefined ? (existing[key] ?? fallback) : body[key];
  const result = {};
  const advanced = payrollAdvancedValues(body);
  for (const key of ['ComponentAssignments', 'AdditionalReliefs', 'BeginningYearCumulative']) {
    result[key] = Object.hasOwn(advanced, key) ? advanced[key] : (existing[key] ?? (key === 'BeginningYearCumulative' ? {} : []));
  }
  for (const key of ['Department', 'Position', 'BankName', 'AccountName', 'AccountNumber', 'Notes']) result[key] = clean(value(key));
  result.EmploymentType = clean(value('EmploymentType', 'Permanent')) || 'Permanent';
  result.SalaryExpenseAccount = clean(value('SalaryExpenseAccount', '6000')) || '6000';
  result.Active = clean(value('Active', 'YES'));
  result.BasicSalary = financeMoney(body.BasicSalary ?? body.basicSalary ?? existing.BasicSalary, 'Basic salary');
  for (const key of ['Allowances', 'Deductions']) result[key] = payrollProfileComponents(value(key, []), key);
  for (const key of ['PensionRate', 'TaxRate', 'NhfRate']) result[key] = financeMoney(value(key, 0), key, { max: 100, defaultValue: 0 });
  const override = body.PensionRateOverride == null || clean(body.PensionRateOverride) === ''
    ? existing.PensionRateOverride : body.PensionRateOverride;
  if (override != null && clean(override) !== '') result.PensionRateOverride = financeMoney(override, 'PensionRateOverride', { max: 100 });
  return result;
}
