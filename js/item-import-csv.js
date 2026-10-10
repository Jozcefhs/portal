// Shared CSV contract: the server repeats every validation before saving.
export const ITEM_IMPORT_LIMITS = Object.freeze({ rows: 1000, bytes: 512 * 1024, batch: 20 });
export const ITEM_IMPORT_MODULES = Object.freeze({
  clinic: { label: 'Clinic', columns: ['ItemName', 'Category', 'Unit', 'Quantity', 'ReorderLevel', 'Notes', 'SchoolSection'], required: ['ItemName', 'Quantity'], category: 'Medical Supply', unit: 'pcs' },
  kitchen: { label: 'Kitchen', columns: ['ItemName', 'Category', 'Unit', 'Quantity', 'ReorderLevel', 'Notes', 'SchoolSection'], required: ['ItemName', 'Quantity'], category: 'Foodstuff', unit: 'kg' },
  bookstore: { label: 'Books & Supplies', columns: ['ItemCode', 'ItemName', 'Category', 'Size', 'Gender', 'ClassName', 'Price', 'Quantity', 'Active', 'SchoolSection'], required: ['ItemCode', 'ItemName', 'Price', 'Quantity'] },
  uniformStore: { label: 'Clothing & Supplies', columns: ['ItemCode', 'ItemName', 'Category', 'Size', 'Gender', 'ClassName', 'Price', 'Quantity', 'Active', 'SchoolSection'], required: ['ItemCode', 'ItemName', 'Price', 'Quantity'] },
  library: { label: 'School Library', columns: ['Title', 'Author', 'ISBN', 'Publisher', 'Category', 'RecommendedClass', 'Description', 'Barcode', 'Shelf', 'Condition', 'AcquiredAt'], required: ['Title', 'Barcode'] }
});
const clean = value => String(value ?? '').trim();
export const itemImportKey = value => clean(value).normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();

export function normalizeItemImportRow(raw, section) {
  const config = ITEM_IMPORT_MODULES[section];
  if (!config) throw new Error('Choose a supported item module.');
  const row = Object.fromEntries(config.columns.map(key => [key, clean(raw?.[key])]));
  row.RowNumber = Number.isSafeInteger(raw?.RowNumber) && raw.RowNumber > 0 ? raw.RowNumber : 0;
  const errors = [];
  for (const key of config.required) if (!row[key]) errors.push(`${key} is required.`);
  const lengths = { ItemName: 160, ItemCode: 80, Title: 200, Author: 160, ISBN: 32, Publisher: 120, Category: 100, RecommendedClass: 100, Description: 1000, Barcode: 80, Shelf: 80, Unit: 40, Notes: 1000, Size: 80, ClassName: 100, SchoolSection: 40 };
  for (const [key, limit] of Object.entries(lengths)) if (row[key]?.length > limit) errors.push(`${key} exceeds ${limit} characters.`);
  const decimal = (key, fallback = '') => {
    const value = row[key] || fallback;
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)
      || !Number.isSafeInteger(Math.round(Number(value.replace(/,/g, '')) * 100))) errors.push(`${key} must be non-negative with at most two decimal places.`);
    row[key] = Number(value.replace(/,/g, ''));
  };
  if (section === 'library') {
    row.Barcode = row.Barcode.toUpperCase();
    if (!/^[A-Z0-9._-]{3,80}$/.test(row.Barcode)) errors.push('Barcode must be 3–80 letters, numbers, dots, underscores or hyphens.');
    row.Condition ||= 'Good';
    if (!['New', 'Good', 'Worn'].includes(row.Condition)) errors.push('Condition must be New, Good or Worn.');
    if (row.AcquiredAt && (!/^\d{4}-\d{2}-\d{2}$/.test(row.AcquiredAt) || !Number.isFinite(Date.parse(`${row.AcquiredAt}T12:00:00Z`)) || new Date(`${row.AcquiredAt}T12:00:00Z`).toISOString().slice(0, 10) !== row.AcquiredAt)) errors.push('AcquiredAt must be a valid YYYY-MM-DD date.');
  } else {
    decimal('Quantity');
    if (['clinic', 'kitchen'].includes(section)) {
      decimal('ReorderLevel', '0'); row.Category ||= config.category; row.Unit ||= config.unit;
    } else {
      decimal('Price');
      if (!Number.isSafeInteger(row.Quantity)) errors.push('Store Quantity must be a whole number.');
      row.ItemCode = row.ItemCode.toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9._-]{0,79}$/.test(row.ItemCode)) errors.push('ItemCode must contain letters, numbers, dots, underscores or hyphens.');
      row.Category ||= section === 'bookstore' ? 'Textbooks' : 'Uniform';
      row.Active = row.Active.toUpperCase() || 'YES'; row.Gender ||= 'All'; row.ClassName ||= 'All';
      if (!['YES', 'NO'].includes(row.Active)) errors.push('Active must be YES or NO.');
      if (!['All', 'Male', 'Female'].includes(row.Gender)) errors.push('Gender must be All, Male or Female.');
    }
    if (row.SchoolSection && !['primary', 'secondary'].includes(row.SchoolSection.toLowerCase())) errors.push('SchoolSection must be Primary or Secondary.');
  }
  return { row, errors };
}

export function parseItemImportCsv(text, section) {
  const config = ITEM_IMPORT_MODULES[section];
  if (!config) throw new Error('Choose a supported item module.');
  if (new TextEncoder().encode(text).length > ITEM_IMPORT_LIMITS.bytes) throw new Error('Maximum CSV size is 512 KB.');
  text = String(text).replace(/^\uFEFF/, '');
  const records = []; let fields = [], cell = '', quoted = false, closed = false, line = 1, start = 1;
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
  const headerMap = new Map(config.columns.map(key => [key.toLowerCase(), key]));
  const names = records.shift().fields.map(key => headerMap.get(key.toLowerCase()));
  if (names.some(key => !key) || new Set(names).size !== names.length) throw new Error('Unknown or duplicate columns. Use this module’s template.');
  if (config.required.some(key => !names.includes(key))) throw new Error(`Required columns: ${config.required.join(', ')}.`);
  if (records.length > ITEM_IMPORT_LIMITS.rows) throw new Error('Maximum 1,000 rows per CSV.');
  return records.map(record => {
    if (record.fields.length !== names.length) throw new Error(`Line ${record.line}: expected ${names.length} cells, found ${record.fields.length}.`);
    return { ...Object.fromEntries(names.map((key, index) => [key, record.fields[index]])), RowNumber: record.line };
  });
}

export function duplicateItemImportRows(rows, section, defaultSection = 'Secondary') {
  const seen = new Map(), duplicates = new Set();
  rows.forEach(raw => {
    const { row } = normalizeItemImportRow(raw, section);
    const identity = section === 'library' ? row.Barcode : `${row.SchoolSection || defaultSection}/${row.ItemCode || row.ItemName}`;
    const key = itemImportKey(identity);
    if (seen.has(key)) { duplicates.add(seen.get(key)); duplicates.add(row.RowNumber); }
    else seen.set(key, row.RowNumber);
  });
  return duplicates;
}
