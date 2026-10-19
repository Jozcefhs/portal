const clean = (value) => String(value ?? '').trim();

export function feeDueDate(value) {
  const text = clean(value);
  if (!text) return '';
  const dayFirst = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const candidate = dayFirst
    ? `${dayFirst[3]}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`
    : text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return '';
  const date = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate ? '' : candidate;
}

export function invoiceIsDue(invoice = {}, today = new Date().toISOString().slice(0, 10)) {
  const dueDate = feeDueDate(invoice.DueDate || invoice.dueDate);
  return !dueDate || dueDate <= today;
}
