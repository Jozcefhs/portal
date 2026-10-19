// Shared by the browser and server. Central and department imports may record opening stock
// for new items only; existing balances, ownership and financial records stay intact.
export const PROCUREMENT_IMPORT_LIMITS = Object.freeze({ rows: 50, bytes: 64 * 1024, requestBytes: 256 * 1024 });
export const PROCUREMENT_IMPORT_COLUMNS = Object.freeze({
  central: Object.freeze(['ItemName', 'Unit', 'ItemCode', 'Category', 'ReorderLevel', 'QuantityAvailable']),
  department: Object.freeze(['ItemName', 'Unit', 'ItemCode', 'Category', 'ReorderLevel', 'QuantityAvailable', 'Notes'])
});
// Price is optional and remains accepted in older files, but is not needed in
// the standard department opening-stock template. Subsequent stock uses receipts.
const supportedColumns = mode => PROCUREMENT_IMPORT_COLUMNS[mode]
  ? [...PROCUREMENT_IMPORT_COLUMNS[mode], ...(mode === 'department' ? ['Price'] : [])] : null;
const clean = value => String(value ?? '').trim();
export const procurementImportKey = value => clean(value).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();

export function normalizeProcurementImportRow(raw, mode) {
  const columns = supportedColumns(mode);
  if (!columns) throw new Error('Choose Central stock or Department balances.');
  const errors = [], source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (source !== raw) errors.push('Each row must be an item record.');
  const unknown = Object.keys(source).filter(key => !columns.includes(key) && key !== 'RowNumber');
  if (unknown.length) errors.push(`Unsupported columns: ${unknown.join(', ')}. Use QuantityAvailable for new item opening stock; direct Quantity, ownership and branch fields cannot be imported.`);
  const row = Object.fromEntries(columns.map(key => [key, clean(source[key])]));
  const numericColumns = ['ReorderLevel', 'QuantityAvailable', 'Price'];
  for (const name of columns) if (source[name] != null && typeof source[name] !== 'string' && !(typeof source[name] === 'number' && numericColumns.includes(name)))
    errors.push(`${name} must be ${numericColumns.includes(name) ? 'a number' : 'text'}.`);
  row.RowNumber = Number.isSafeInteger(source.RowNumber) && source.RowNumber > 0 ? source.RowNumber : 0;
  for (const key of ['ItemName', 'Unit']) if (!row[key]) errors.push(`${key} is required.`);
  const lengths = { ItemName: 160, Unit: 40, ItemCode: 80, Category: 100, Notes: 2000 };
  for (const [key, maximum] of Object.entries(lengths)) {
    if (row[key]?.length > maximum) errors.push(`${key} exceeds ${maximum} characters.`);
    if (row[key] && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row[key])) errors.push(`${key} contains unsupported control characters.`);
    if (key !== 'Notes' && /[\r\n\t]/.test(row[key] || '')) errors.push(`${key} must be on one line.`);
  }
  const decimal = (key, places) => {
    const input = row[key] || '0', pattern = places === 3 ? /^\d+(?:\.\d{1,3})?$/ : /^\d+(?:\.\d{1,2})?$/;
    if (!pattern.test(input) || !Number.isFinite(Number(input)) || Number(input) > 1000000000)
      errors.push(`${key} must be between 0 and 1,000,000,000 with at most ${places} decimal places, without commas or currency symbols.`);
    row[key] = Number(input);
  };
  decimal('ReorderLevel', 3);
  decimal('QuantityAvailable', 3);
  if (mode === 'department') {
    if (row.Price) decimal('Price', 2);
    else row.Price = null;
  }
  return { row, errors };
}

export function parseProcurementItemCsv(value, mode) {
  const columns = supportedColumns(mode);
  if (!columns) throw new Error('Choose Central stock or Department balances.');
  if (typeof value !== 'string') throw new Error('Choose a CSV text file.');
  if (new TextEncoder().encode(value).length > PROCUREMENT_IMPORT_LIMITS.bytes) throw new Error('Maximum CSV size is 64 KB.');
  const text = value.replace(/^\uFEFF/, ''), records = [];
  let fields = [], cell = '', quoted = false, closed = false, line = 1, start = 1;
  const endCell = () => { fields.push(cell.trim()); cell = ''; closed = false; };
  const endRow = () => { endCell(); if (fields.some(Boolean)) records.push({ fields, line: start }); fields = []; start = line + 1; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else { cell += char; if (char === '\n') line++; }
    } else if (char === '"') {
      if (cell.trim() || closed) throw new Error(`Invalid CSV quote on line ${line}.`);
      cell = ''; quoted = true;
    } else if (char === ',') endCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; endRow(); line++; }
    else if (closed && !/\s/.test(char)) throw new Error(`Unexpected text after a quoted cell on line ${line}.`);
    else if (!closed) cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted cell.');
  if (cell || fields.length || closed) endRow();
  if (records.length < 2) throw new Error('Choose a CSV with at least one item row.');
  const aliases = new Map(columns.map(key => [key.toLowerCase(), key]));
  const headers = records.shift().fields.map(key => aliases.get(key.toLowerCase()));
  if (headers.some(key => !key) || new Set(headers).size !== headers.length) throw new Error('Unknown or duplicate columns. Use the Procurement template; direct Quantity and vendor fields are not allowed.');
  if (!['ItemName', 'Unit'].every(key => headers.includes(key))) throw new Error('Required columns: ItemName, Unit.');
  if (records.length > PROCUREMENT_IMPORT_LIMITS.rows) throw new Error('Maximum 50 item rows per CSV.');
  return records.map(record => {
    if (record.fields.length !== headers.length) throw new Error(`Line ${record.line}: expected ${headers.length} cells, found ${record.fields.length}.`);
    return { ...Object.fromEntries(headers.map((key, index) => [key, record.fields[index]])), RowNumber: record.line };
  });
}
