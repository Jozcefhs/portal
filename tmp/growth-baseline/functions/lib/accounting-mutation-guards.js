const clean = value => String(value ?? '').trim();

export function financeFailure(message, status = 400, code = 'FINANCE_VALIDATION_FAILED') {
  return Object.assign(new Error(message), { status, code });
}

export function financeMoney(value, label = 'Amount', options = {}) {
  const { min = 0, max = Number.MAX_SAFE_INTEGER / 100, defaultValue } = options;
  if ((value === undefined || value === null || clean(value) === '') && defaultValue !== undefined) value = defaultValue;
  if (typeof value !== 'string' && typeof value !== 'number') throw financeFailure(`${label} must be a valid amount.`);
  // Arithmetic on already validated cents can leave a binary floating-point tail.
  // Remove only machine-precision noise, never genuine fractions of a cent.
  if (typeof value === 'number' && Number.isFinite(value)) {
    const cents = Math.round((value + Number.EPSILON) * 100) / 100;
    if (Math.abs(value - cents) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 4) value = cents;
  }
  const text = clean(value).replace(/^₦\s*/, '');
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) throw financeFailure(`${label} must be a valid amount with at most two decimal places.`);
  const number = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(number) || number < min || number > max) throw financeFailure(`${label} must be between ${min} and ${max}.`);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function financeDate(value, label = 'Date', options = {}) {
  let date = clean(value);
  // Internal receipt/invoice sources carry ISO timestamps. Keep their source
  // calendar day (the historical posting convention), not the server timezone.
  if (options.allowTimestamp && /^\d{4}-\d{2}-\d{2}[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(date) && Number.isFinite(Date.parse(date))) date = date.slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw financeFailure(`${label} must be a valid YYYY-MM-DD date.`);
  return date;
}

export function financeData(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('__')));
}

export function financeWrite(collectionPath, documentId, data, current = null) {
  const exists = current && Object.keys(current).length > 0;
  if (exists && !clean(current.__updateTime)) throw financeFailure('Refresh this financial record before saving it.', 409, 'FINANCE_WRITE_CONFLICT');
  return { collectionPath, documentId: clean(current?.__id) || documentId, data: financeData(data),
    ...(exists ? { updateTime: current.__updateTime } : { exists: false }) };
}

export async function financeOperationId(prefix, ...identity) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(identity)));
  return `${prefix}-${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function journalFinancialSignature(journal = {}) {
  return JSON.stringify({ Date: clean(journal.Date), BranchId: clean(journal.BranchId || 'main'),
    Source: clean(journal.Source), SourceId: clean(journal.SourceId), Reference: clean(journal.Reference),
    ReversalOf: clean(journal.ReversalOf), Currency: clean(journal.Currency),
    Lines: (Array.isArray(journal.Lines) ? journal.Lines : []).map(line => ({
      AccountCode: clean(line.AccountCode), Debit: Number(line.Debit || 0), Credit: Number(line.Credit || 0),
      Department: clean(line.Department), CostCentre: clean(line.CostCentre), Description: clean(line.Description)
    })) });
}

export function assertFinanceRoleLimit(rows, role, transactionType, amount) {
  const normalize = value => clean(value).toLowerCase();
  const matches = rows.filter(row => normalize(row.Role) === normalize(role) && normalize(row.TransactionType) === normalize(transactionType));
  const explicitId = `${role}-${transactionType}`.replace(/\s+/g, '_').toLowerCase();
  const explicit = matches.filter(row => Number(row.PolicyVersion) >= 2 || normalize(row.__id) === explicitId);
  // A saved administrator choice supersedes the older automatically seeded row.
  const effective = explicit.length ? explicit : matches;
  if (effective.some(row => !['yes', 'true', '1'].includes(normalize(row.Active ?? 'YES')) || financeMoney(row.MaxAmount, 'Approval limit') < amount)) {
    throw financeFailure('This amount exceeds the configured approval limit for this role and transaction type.', 403);
  }
}
