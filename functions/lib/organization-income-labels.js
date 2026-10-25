// Stable identifiers and account codes keep existing mappings and postings intact.
// Only known default names are projected; custom organisation names are preserved.
export const ORGANIZATION_INCOME_DEFAULTS = Object.freeze([
  ['OFFERING', '4140', 'Offering', 'General Contribution'],
  ['DONATION', '4150', 'Donation', 'Donation'],
  ['TITHE', '4160', 'Tithe', 'Regular Contribution'],
  ['PROPHET-OFFERING', '4170', 'Prophet Offering', 'Programme Contribution'],
  ['PROPHETESS-OFFERING', '4180', 'Prophetess Offering', 'Project Contribution'],
  ['SEED', '4190', 'Seed', 'Development Contribution'],
  ['THANKSGIVING', '4200', 'Thanksgiving', 'Special Contribution'],
  ['BUILDING-FUND', '4210', 'Building Fund', 'Building Fund'],
  ['OTHER-GIVING', '4220', 'Other Giving', 'Other Contribution']
].map(row => Object.freeze(row)));
const clean = value => String(value ?? '').trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

export function legacyIncomeCategoryName(row = {}) {
  return ORGANIZATION_INCOME_DEFAULTS.find(([id, code]) =>
    same(row.GivingTypeId || row.__id, id) && same(row.RevenueAccountCode, code))?.[2] || '';
}

export function incomeCategoryForEdition(row = {}, edition) {
  if (edition !== 'organization') return row;
  const defaults = ORGANIZATION_INCOME_DEFAULTS.find(([id, code, oldName]) =>
    same(row.GivingTypeId || row.__id, id) && same(row.RevenueAccountCode, code) && same(row.Name, oldName));
  return defaults ? {...row, Name: defaults[3]} : row;
}

export function incomeAccountForEdition(row = {}, edition) {
  if (edition !== 'organization') return row;
  const defaults = ORGANIZATION_INCOME_DEFAULTS.find(([, code, oldName]) =>
    same(row.Code || row.__id, code) && same(row.Name, `${oldName} Income`));
  return defaults ? {...row, Name: `${defaults[3]} Income`,
    ...(['church revenue', 'giving income'].includes(clean(row.Group).toLowerCase()) ? {Group:'Contribution Income'} : {})} : row;
}
