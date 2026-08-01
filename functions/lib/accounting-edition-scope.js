import { normalizeOrganizationEdition } from './organization-config.js';

export const SCHOOL_ONLY_REVENUE_ACCOUNT_CODES = Object.freeze([
  '4000', // Tuition and School Fee Revenue
  '4010', // Admission Form Revenue
  '4020', // Boarding Revenue
  '4030', // Transport Revenue
  '4040', // Books and Uniform Revenue
  '4050', // Clinic Revenue
  '4060', // Kitchen and Feeding Revenue
  '4070', // Club and Activity Revenue
  '4100', // Discounts, Scholarships and Refunds
  '4110'  // Acceptance Fee Revenue
]);

const SCHOOL_ONLY_REVENUE_CODES = new Set(SCHOOL_ONLY_REVENUE_ACCOUNT_CODES);
const clean = (value) => String(value ?? '').trim();

export function excludedAccountingCodesForEdition(edition) {
  return normalizeOrganizationEdition(edition) === 'school'
    ? new Set()
    : new Set(SCHOOL_ONLY_REVENUE_CODES);
}

export function accountingCodeAllowedForEdition(code, edition) {
  return !excludedAccountingCodesForEdition(edition).has(clean(code));
}

export function accountingChartForEdition(chart = [], edition = 'school') {
  const excluded = excludedAccountingCodesForEdition(edition);
  return (chart || []).filter((row) => !excluded.has(clean(row?.Code || row?.code || row?.__id)));
}

function journalLines(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

export function accountingJournalsForEdition(journals = [], edition = 'school') {
  const excluded = excludedAccountingCodesForEdition(edition);
  if (!excluded.size) return [...(journals || [])];
  return (journals || []).filter((journal) => !journalLines(journal?.Lines || journal?.lines).some((line) =>
    excluded.has(clean(line?.AccountCode || line?.accountCode))
  ));
}
