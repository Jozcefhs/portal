import { queryCollectionPages } from './firestore.js';
import { recordReferenceKey } from './records-desk.js';

const clean = (value) => String(value ?? '').trim();
const REFERENCE_FIELDS = ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo',
  'ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationID', 'StudentRef', 'studentRef'];

export function recordsDeskFinanceQueries(student = {}) {
  const references = [...new Set([student.AccountRef, student.AdmissionNo,
    student.ApplicationReference, student.ApplicationID, student.__id].map(clean).filter(Boolean))];
  const values = [...new Set(references.flatMap((value) => [value, value.toUpperCase(), value.toLowerCase()]))];
  const filters = REFERENCE_FIELDS.flatMap((field) => values.map((value) => ({ field, op: '==', value })));
  for (const field of ['AccountRefNormalized', 'accountRefNormalized']) {
    for (const value of new Set(references.map(recordReferenceKey).filter(Boolean))) filters.push({ field, op: '==', value });
  }
  // Firestore OR queries have at most 30 disjunctions. Do not fall back to a
  // whole-school collection scan if an indexed, account-specific read fails.
  const queries = [];
  for (let index = 0; index < filters.length; index += 30) {
    queries.push({ filters: filters.slice(index, index + 30), filterJoin: 'OR', pageSize: 1000, maxRows: 2000 });
  }
  return queries;
}

export async function loadRecordsDeskStudentFinance(env, student, capabilities, { queryRows = queryCollectionPages } = {}) {
  const queries = recordsDeskFinanceQueries(student);
  const collections = [
    capabilities.canViewStudentFinance && 'payments',
    capabilities.canViewStudentFinance && 'invoices',
    (capabilities.canViewStudentFinance || capabilities.canViewStudentWallet) && 'ledger'
  ].filter(Boolean);
  const result = { payments: [], invoices: [], ledger: [] };
  if (!collections.length) return result;
  if (!queries.length) throw new Error('The selected student has no financial account reference.');
  await Promise.all(collections.map(async (collection) => {
    const unique = new Map();
    for (const options of queries) {
      const rows = await queryRows(env, collection, options);
      for (const row of rows) unique.set(clean(row.__name || row.__id) || JSON.stringify(row), row);
      if (unique.size > 2000) throw new Error('This student has too many financial records for the Records Desk. Open Accounts for a full review; no partial totals were shown.');
    }
    result[collection] = [...unique.values()];
  }));
  return result;
}
