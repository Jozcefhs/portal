import { assertManualPaymentScope, bindManualPaymentIdentity } from './manual-payment-scope.js';
import { financeFailure } from './accounting-mutation-guards.js';
import { isAvailableSchoolCreditReceipt } from '../api/backend.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const normalized = value => lower(value).replace(/[^a-z0-9]/g, '');
const PAGE_SIZE = 100;
const fields = ['Reference', 'ReceiptNo', 'AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo', 'AdmissionNumber', 'admissionNumber',
  'ApplicationReference', 'applicationReference', 'ApplicationID', 'BranchId', 'branchId',
  'SchoolSection', 'schoolSection', 'ClassName', 'ClassApplyingFor', 'AcademicSession', 'Term', 'FeeCode', 'FeeName', 'FeeCategory',
  'Amount', 'GrossAmount', 'NetAmount', 'GatewayFee', 'Currency', 'Gateway', 'Method', 'Channel', 'Status',
  'ProcessingStatus', 'PaidAt', 'RecordedAt', 'Date', 'RecordedBy', 'CorrectionTotal', 'CorrectionStatus'];

function resultRow(row) {
  const amount = Number(row.Amount), corrected = Number(row.CorrectionTotal || 0);
  const wallet = lower(row.FeeCategory) === 'wallet' || clean(row.FeeCode).toUpperCase() === 'WALLET_TOPUP';
  let unavailable = '';
  if (lower(row.Gateway) !== 'manual') unavailable = 'Not a manual payment — cannot be corrected here';
  else if (lower(row.Status) !== 'paid' || (row.ProcessingStatus && lower(row.ProcessingStatus) !== 'completed')) unavailable = 'Payment is not completed';
  else if (!wallet && (!isAvailableSchoolCreditReceipt(row) || /acceptance/i.test(`${row.FeeCode} ${row.FeeName}`))) unavailable = 'Not a wallet top-up or school-fee receipt';
  else if (!clean(row.Reference) || !clean(row.AccountRef) || !Number.isFinite(amount) || amount <= 0
    || !Number.isFinite(corrected) || corrected < 0 || corrected > amount
    || clean(row.Currency || 'NGN').toUpperCase() !== 'NGN' || Number(row.GatewayFee || 0) !== 0
    || (row.GrossAmount !== undefined && Math.round(Number(row.GrossAmount) * 100) !== Math.round(amount * 100))
    || (row.NetAmount !== undefined && Math.round(Number(row.NetAmount) * 100) !== Math.round(amount * 100))) unavailable = 'Receipt needs finance review';
  else if (Math.round((amount - corrected) * 100) <= 0) unavailable = 'Already fully corrected';
  return { Id: row.__id, Reference: clean(row.Reference), ReceiptNo: clean(row.ReceiptNo),
    AccountRef: clean(row.AccountRef || row.AdmissionNo), FeeName: clean(row.FeeName || row.FeeCode),
    PaidAt: clean(row.PaidAt || row.Date || row.RecordedAt), AcademicSession: clean(row.AcademicSession), Term: clean(row.Term),
    Amount: Number.isFinite(amount) ? amount : null, Currency: clean(row.Currency || 'NGN'),
    Source: lower(row.Channel) === 'historical payment import' ? 'Batch import'
      : lower(row.Gateway) === 'manual' ? 'Manual payment' : clean(row.Gateway) || 'Other payment',
    RecordedBy: clean(row.RecordedBy), CorrectionStatus: clean(row.CorrectionStatus),
    CanSelect: !unavailable, UnavailableReason: unavailable };
}

// Indexed, read-only pages for one verified student, across every date and session.
// The dashboard's recent-payment list is deliberately not an input to this search.
export async function searchStudentPaymentHistory(env, body, scope, io) {
  const query = clean(body.AccountRef);
  if (query.length < 2 || query.length > 180 || !normalized(query)) {
    throw financeFailure('Enter the full student admission number (2–180 characters).', 400);
  }
  let student = null;
  for (const candidate of new Set([query, query.toUpperCase(), query.toLowerCase()])) {
    student = await io.student(env, candidate, scope);
    if (student) break;
  }
  if (!student) throw financeFailure('No student with that admission number was found in your permitted branch and school section.', 404);
  assertManualPaymentScope(student, scope, 'Student');
  const accountRef = clean(student.AdmissionNo || student.AccountRef);
  if (!accountRef) throw financeFailure('This student has no verified admission/account number. Accounts must review the record.', 409);
  const bound = bindManualPaymentIdentity({ AccountRef: accountRef }, student, scope).scope;
  const references = [...new Set([student.AdmissionNo, student.AccountRef, student.ApplicationReference].map(clean).filter(Boolean))];
  const variants = [...new Set(references.flatMap(value => [value, value.toUpperCase(), value.toLowerCase()]))];
  const filters = ['AccountRef', 'AdmissionNo', 'ApplicationReference'].flatMap(field => variants.map(value => ({ field, op: '==', value })));
  filters.push(...[...new Set(references.map(normalized))].map(value => ({ field: 'AccountRefNormalized', op: '==', value })));
  const binding = JSON.stringify([scope.branchId, scope.schoolSectionAccess, lower(query), student.__scopePath, student.__id, references]);
  let startAfterName = '';
  if (body.Cursor) {
    let cursor;
    try { if (typeof body.Cursor === 'string' && body.Cursor.length <= 4000) cursor = JSON.parse(body.Cursor); } catch { /* rejected below */ }
    const prefix = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/payments/`;
    if (cursor?.version !== 1 || cursor.binding !== binding || typeof cursor.last !== 'string'
      || !cursor.last.startsWith(prefix) || !cursor.last.slice(prefix.length) || cursor.last.slice(prefix.length).includes('/')) {
      throw financeFailure('This payment-history page belongs to a different search or scope. Search again.', 400);
    }
    startAfterName = cursor.last;
  }
  const page = await io.page(env, 'payments', { filters, filterJoin: 'OR', select: fields,
    orderBy: [{ field: '__name__' }], limit: PAGE_SIZE + 1, ...(startAfterName ? { startAfterName } : {}) });
  const scanned = page.slice(0, PAGE_SIZE), rows = [];
  for (const row of scanned) {
    try { assertManualPaymentScope(row, bound, 'Payment'); }
    catch (error) { if (error.code === 'MANUAL_PAYMENT_SCOPE_MISMATCH') continue; throw error; }
    rows.push(resultRow(row));
  }
  let next = '';
  if (page.length > PAGE_SIZE) {
    const last = clean(scanned.at(-1)?.__name);
    if (!last || last === startAfterName) throw financeFailure('Payment history could not be paged safely. Search again.', 503);
    next = JSON.stringify({ version: 1, binding, last });
  }
  return { ok: true, Student: { AccountRef: accountRef, DisplayName: clean(student.DisplayName),
    ClassName: clean(student.ClassName), SchoolSection: bound.schoolSectionAccess }, Rows: rows, NextCursor: next, Complete: !next };
}
