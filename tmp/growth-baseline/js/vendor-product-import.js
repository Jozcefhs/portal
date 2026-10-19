/* CSV contract shared by the browser and the authoritative vendor backend. */
export const PRODUCT_IMPORT_LIMITS = Object.freeze({ rows: 1000, bytes: 512 * 1024, batch: 20 });
export const PRODUCT_COLUMNS = Object.freeze(['InventoryId', 'ItemCode', 'ItemName', 'Owner', 'Store', 'Quantity', 'Price', 'Category', 'Unit', 'Active', 'SchoolSection', 'CurrentOwner']);
const clean = value => String(value ?? '').trim();
const headers = new Map(PRODUCT_COLUMNS.map(name => [name.toLowerCase(), name]));

export function normalizeProductRow(raw, mode) {
  const row = Object.fromEntries(PRODUCT_COLUMNS.map(key => [key, clean(raw?.[key])]));
  row.RowNumber = Number.isSafeInteger(raw?.RowNumber) && raw.RowNumber > 0 ? raw.RowNumber : 0;
  const errors = [];
  if (!['assign', 'create'].includes(mode)) errors.push('Choose assign existing products or create new products.');
  for (const [key, limit] of Object.entries({ InventoryId: 240, ItemCode: 80, ItemName: 160, Owner: 160, Store: 40, Category: 120, Unit: 40, SchoolSection: 40 })) {
    if (row[key].length > limit) errors.push(`${key} is too long (maximum ${limit}).`);
  }
  if (!row.Owner) errors.push('Owner is required: use a registered vendor name / ID, or ORGANISATION.');
  if (mode === 'assign') {
    if (!row.InventoryId || /[\\/]/.test(row.InventoryId)) errors.push('InventoryId is required. Use the existing-products download.');
  } else if (mode === 'create') {
    if (row.InventoryId) errors.push('Leave InventoryId blank when creating new products.');
    row.ItemCode = row.ItemCode.toUpperCase();
    if (!row.ItemCode || !/^[A-Z0-9][A-Z0-9._-]*$/.test(row.ItemCode)) errors.push('ItemCode must contain letters, numbers, dots, underscores or hyphens.');
    if (!row.ItemName) errors.push('ItemName is required.');
    if (!/^\d+$/.test(row.Quantity) || !Number.isSafeInteger(Number(row.Quantity))) errors.push('Quantity must be a non-negative whole number.');
    // Commas are accepted only as properly grouped thousands (quote the CSV cell).
    const price = row.Price.replace(/,/g, '');
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(row.Price) || !Number.isSafeInteger(Math.round(Number(price) * 100)) || Number(price) <= 0) errors.push('Price must be positive, with at most two decimal places.');
    row.Quantity = Number(row.Quantity); row.Price = Number(price);
    row.Category ||= 'General Item'; row.Unit ||= 'pcs'; row.Active = row.Active.toUpperCase() || 'YES';
    if (!['YES', 'NO'].includes(row.Active)) errors.push('Active must be YES or NO.');
  }
  return { row, errors };
}

export function parseProductCsv(text, mode) {
  if (new TextEncoder().encode(text).length > PRODUCT_IMPORT_LIMITS.bytes) throw new Error('CSV exceeds 512 KB. Split it into smaller files.');
  text = String(text).replace(/^\uFEFF/, '');
  const records = [];
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
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow(); line++;
    } else if (closed && !/\s/.test(char)) throw new Error(`Unexpected text after a quoted cell on line ${line}.`);
    else if (!closed) cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted cell.');
  if (cell || fields.length || closed) endRow();
  if (records.length < 2) throw new Error('Choose a CSV containing at least one product row.');
  const names = records.shift().fields.map(name => headers.get(name.toLowerCase()));
  if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error('CSV has unknown or duplicate columns. Use the supplied template.');
  const required = mode === 'assign' ? ['InventoryId', 'Owner'] : ['ItemCode', 'ItemName', 'Owner', 'Quantity', 'Price'];
  if (required.some(name => !names.includes(name))) throw new Error(`Required columns: ${required.join(', ')}.`);
  if (records.length > PRODUCT_IMPORT_LIMITS.rows) throw new Error('Maximum 1,000 products per CSV. Split it into smaller files.');
  return records.map(record => {
    if (record.fields.length !== names.length) throw new Error(`Line ${record.line} has ${record.fields.length} cells; expected ${names.length}.`);
    return { ...Object.fromEntries(names.map((name, index) => [name, record.fields[index]])), RowNumber: record.line };
  });
}

export function productCsv(columns, rows = []) {
  const cell = value => {
    let text = clean(value);
    if (/^[=+@-]/.test(text)) text = `'${text}`; // Do not execute spreadsheet formulas in downloaded labels.
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\uFEFF' + [columns, ...rows.map(row => columns.map(name => row[name] ?? ''))].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function productChunks(rows) {
  const result = [];
  for (let i = 0; i < rows.length; i += PRODUCT_IMPORT_LIMITS.batch) result.push(rows.slice(i, i + PRODUCT_IMPORT_LIMITS.batch));
  return result;
}

export function duplicatePreviewRows(previews) {
  const seen = new Map(), duplicates = new Set();
  for (const preview of previews) for (const row of preview.rows) {
    if (!row.InventoryId || row.Errors.length) continue;
    const key = `${row.Section}/${row.InventoryId}`;
    if (seen.has(key)) { duplicates.add(seen.get(key)); duplicates.add(row.RowNumber); }
    else seen.set(key, row.RowNumber);
  }
  return duplicates;
}
