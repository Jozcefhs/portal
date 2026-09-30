import { batchCommitDocuments, getDocument, listCollection, queryCollection } from './firestore.js';
import { enforceActorBranch } from './branch-scope.js';
import { getSchoolStructure, listSchoolCollection, safeScopeId, schoolSectionFor } from './school-scope.js';
import { createNotification } from './notifications.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const COLLECTIONS = Object.freeze({
  titles: 'libraryTitles', copies: 'libraryCopies', loans: 'libraryLoans',
  reservations: 'libraryReservations', borrowers: 'libraryBorrowers',
  policy: 'libraryPolicies', audit: 'libraryAudit'
});
const MANAGERS = new Set(['Super Admin', 'Director', 'Admin', 'Management', 'Principal', 'Head Teacher', 'Librarian']);
const DEFAULT_POLICY = Object.freeze({ StudentLoanDays: 14, StudentLoanLimit: 3, StaffLoanDays: 21, StaffLoanLimit: 5, MaxRenewals: 1 });

function failure(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireAccess(user, write = false) {
  if (lower(user.edition || user.Edition) !== 'school' || !(user.allowedSections || []).includes('library')) {
    throw failure('School Library is not enabled for this account or subscription.', 403);
  }
  if (write && (user.subscriptionActive === false || user.subscriptionReadOnly === true)) {
    throw failure(user.subscriptionMessage || 'Library records are read-only until the subscription is renewed.', 403);
  }
  if (write && !MANAGERS.has(clean(user.assignedRole || user.AssignedRole || user.role || user.Role))) {
    throw failure('Only an authorised library officer can change lending records.', 403);
  }
}

async function branchFor(env, user, body = {}) {
  const structure = await getSchoolStructure(env);
  return safeScopeId(enforceActorBranch(
    user, clean(body.BranchId || body.branchId || user.branchId || user.BranchId),
    '', structure.ActiveBranchId || 'main'
  ));
}

function branchRows(rows, branchId) {
  return rows.filter((row) => safeScopeId(row.BranchId) === branchId);
}

function branchCollection(env, collection, branchId) {
  return queryCollection(env, COLLECTIONS[collection], {
    filters: [{ field: 'BranchId', op: '==', value: branchId }]
  });
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function write(collection, documentId, data, precondition = {}) {
  return { collectionPath: COLLECTIONS[collection], documentId, data, ...precondition };
}

function audit(user, branchId, action, details = {}) {
  const AuditId = id('LIB-AUD');
  return write('audit', AuditId, {
    AuditId, Action: action, BranchId: branchId,
    Actor: clean(user.displayName || user.DisplayName || user.username || user.Username),
    ActorUsername: clean(user.username || user.Username),
    ActorRole: clean(user.assignedRole || user.AssignedRole || user.role || user.Role),
    Details: details, Timestamp: nowIso()
  }, { exists: false });
}

function current(row) {
  const updateTime = clean(row?.__updateTime);
  if (!updateTime) throw failure('The library record version is missing. Reload and try again.', 409);
  return { updateTime };
}

function conflict(error) {
  if ([409, 412].includes(Number(error?.status))) {
    throw failure('A library record changed at the same time. Reload the register and try again.', 409);
  }
  throw error;
}

function localDate() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function plusDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function normalizeLibraryPolicy(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_POLICY).map(([key, fallback]) => {
    const input = Number(value[key] ?? fallback);
    if (!Number.isSafeInteger(input) || input < 0 || input > (key.endsWith('Days') ? 365 : 50)) {
      throw failure(`Enter a valid ${key.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}.`);
    }
    if (key !== 'MaxRenewals' && input === 0) throw failure('Loan days and borrowing limits must be greater than zero.');
    return [key, input];
  }));
}

function borrowerKey(branchId, type, ref) {
  return `${branchId}--${type.toLowerCase()}--${encodeURIComponent(ref.toLowerCase())}`;
}

function borrowerIdentity(row, type) {
  if (type === 'Student') return [row.AdmissionNo, row.AccountRef, row.ApplicationReference, row.__id,
    row.WalletCardId, row.walletCardId, row.CardId, row.cardId, row.DisplayName, row.ApplicantName,
    row.StudentName, row.FullName, [row.FirstName, row.MiddleName, row.LastName].filter(Boolean).join(' '),
    row.ParentEmail, row.VerificationEmail, row.Email, row.FatherEmail, row.MotherEmail, row.GuardianEmail,
    row.ParentPhone, row.FatherPhone, row.MotherPhone, row.GuardianPhone, row.Phone];
  return [row.Username, row.LoginUsername, row.__id, row.EmployeeId, row.StaffId,
    row.DisplayName, row.FullName, row.WorkEmail, row.Email, row.Phone, row.PhoneNumber];
}

function compact(value) {
  return lower(value).replace(/[^\p{L}\p{N}]/gu, '');
}

function identityVariants(values) {
  return values.flatMap((value) => {
    const original = lower(value);
    if (!original) return [];
    const digits = original.replace(/\D/g, '');
    if (/^234\d{10}$/.test(digits)) return [original, `0${digits.slice(3)}`];
    if (/^0\d{10}$/.test(digits)) return [original, `234${digits.slice(1)}`];
    return [original];
  });
}

function borrowerReference(row, type) {
  return clean(type === 'Student' ? row.AdmissionNo || row.AccountRef || row.__id
    : row.Username || row.LoginUsername || row.__id);
}

function borrowerName(row, type) {
  return clean(type === 'Student' ? row.DisplayName || row.ApplicantName || row.StudentName
    || row.FullName || [row.FirstName, row.MiddleName, row.LastName].filter(Boolean).join(' ')
    : row.DisplayName || row.FullName || row.Username);
}

function borrowerActive(row, type) {
  return type === 'Student'
    ? !['withdrawn', 'inactive', 'deleted', 'archived'].includes(lower(row.Status || row.StudentStatus))
    : row.Active !== false && !['inactive', 'disabled', 'terminated'].includes(lower(row.Status));
}

export function searchLibraryBorrowers(query, type, students = [], staff = []) {
  const wanted = lower(query);
  if (wanted.length < 2 || !['Student', 'Staff'].includes(type)) return [];
  const terms = wanted.split(/\s+/).filter(Boolean);
  const source = type === 'Student' ? students : staff;
  const found = new Map();
  for (const row of source) {
    if (!borrowerActive(row, type)) continue;
    const reference = borrowerReference(row, type);
    if (!reference || found.has(lower(reference))) continue;
    const fields = identityVariants([...borrowerIdentity(row, type), row.ClassName, row.ClassArm,
      row.Department, row.Role]);
    if (!terms.every((term) => fields.some((field) => field.includes(term) || compact(field).includes(compact(term))))) continue;
    found.set(lower(reference), {
      BorrowerType: type, BorrowerRef: reference, BorrowerName: borrowerName(row, type),
      ClassName: clean(type === 'Student' ? row.ClassName : row.Department)
    });
    if (found.size >= 20) break;
  }
  return [...found.values()];
}

export function borrowerFrom(reference, type, students, staff) {
  const wanted = lower(reference);
  if (!wanted) throw failure('Choose a student or staff borrower.');
  if (!['Student', 'Staff'].includes(type)) throw failure('Choose Student or Staff as the borrower type.');
  const source = type === 'Student' ? students : staff;
  const matches = source.filter((row) => identityVariants(borrowerIdentity(row, type)).some((candidate) => {
    return candidate && (candidate === wanted || compact(candidate) === compact(wanted));
  }));
  const unique = [...new Map(matches.map((row) => [lower(borrowerReference(row, type)), row])).values()];
  if (!unique.length) throw failure(`The ${type.toLowerCase()} was not found in this branch.`, 404);
  if (unique.length > 1) throw failure('Multiple borrowers match. Search and select the correct admission number or staff username.', 409);
  if (type === 'Student') {
    const student = unique[0];
    if (['withdrawn', 'inactive', 'deleted', 'archived'].includes(lower(student.Status || student.StudentStatus))) {
      throw failure('Only an active student can borrow a library book.', 409);
    }
    return {
      BorrowerType: 'Student', BorrowerRef: borrowerReference(student, type),
      BorrowerName: borrowerName(student, type),
      ClassName: clean(student.ClassName), SchoolSection: schoolSectionFor(student),
      ParentEmail: lower(student.ParentEmail || student.VerificationEmail || student.Email)
    };
  }
  if (type === 'Staff') {
    const person = unique[0];
    if (person.Active === false || ['inactive', 'disabled', 'terminated'].includes(lower(person.Status))) {
      throw failure('Only an active staff member can borrow a library book.', 409);
    }
    return {
      BorrowerType: 'Staff', BorrowerRef: borrowerReference(person, type),
      BorrowerName: borrowerName(person, type)
    };
  }
  throw failure('Choose Student or Staff as the borrower type.');
}

async function readerDirectory(env, branchId) {
  const [students, allStaff] = await Promise.all([
    listSchoolCollection(env, 'students', { branchId }),
    listCollection(env, 'staffUsers')
  ]);
  return {
    students,
    staff: allStaff.filter((row) => !clean(row.BranchId) || safeScopeId(row.BranchId) === branchId)
  };
}

async function policyFor(env, branchId) {
  const saved = await getDocument(env, COLLECTIONS.policy, branchId);
  return { ...DEFAULT_POLICY, ...(saved || {}) };
}

async function load(env, user, body) {
  requireAccess(user);
  const branchId = await branchFor(env, user, body);
  const [titles, copies, loans, reservations, policy] = await Promise.all([
    branchCollection(env, 'titles', branchId), branchCollection(env, 'copies', branchId),
    branchCollection(env, 'loans', branchId), branchCollection(env, 'reservations', branchId),
    policyFor(env, branchId)
  ]);
  const scopedTitles = branchRows(titles, branchId);
  const titleById = new Map(scopedTitles.map((row) => [row.TitleId, row.Title]));
  const scopedCopies = branchRows(copies, branchId).map((row) => ({
    ...row, Title: titleById.get(row.TitleId) || row.Title
  }));
  const scopedLoans = branchRows(loans, branchId);
  const scopedReservations = branchRows(reservations, branchId);
  const today = localDate();
  return {
    ok: true, branchId,
    permissions: { canManage: user.subscriptionActive !== false && user.subscriptionReadOnly !== true
      && MANAGERS.has(clean(user.assignedRole || user.AssignedRole || user.role || user.Role)) },
    policy: normalizeLibraryPolicy(policy),
    titles: scopedTitles.sort((a, b) => clean(a.Title).localeCompare(clean(b.Title))),
    copies: scopedCopies.sort((a, b) => clean(a.Barcode).localeCompare(clean(b.Barcode))),
    loans: scopedLoans.sort((a, b) => clean(b.CheckedOutAt).localeCompare(clean(a.CheckedOutAt))),
    reservations: scopedReservations.sort((a, b) => clean(a.CreatedAt).localeCompare(clean(b.CreatedAt))),
    summary: {
      Titles: scopedTitles.length, Copies: scopedCopies.length,
      Available: scopedCopies.filter((row) => row.Status === 'Available').length,
      OnLoan: scopedLoans.filter((row) => row.Status === 'On Loan').length,
      Overdue: scopedLoans.filter((row) => row.Status === 'On Loan' && clean(row.DueDate) < today).length,
      Reservations: scopedReservations.filter((row) => row.Status === 'Pending').length
    },
    today
  };
}

async function saveTitle(env, user, body, branchId) {
  const title = clean(body.Title).slice(0, 200);
  if (!title) throw failure('Enter the book title.');
  const titleId = clean(body.TitleId);
  const existing = titleId ? await getDocument(env, COLLECTIONS.titles, titleId) : null;
  if (titleId && (!existing || safeScopeId(existing.BranchId) !== branchId)) throw failure('This title is not in your branch.', 404);
  const TitleId = existing?.TitleId || id('LIB-TITLE');
  const saved = {
    TitleId, BranchId: branchId, Title: title, Author: clean(body.Author).slice(0, 160),
    ISBN: clean(body.ISBN).slice(0, 32), Publisher: clean(body.Publisher).slice(0, 120),
    Category: clean(body.Category).slice(0, 100), RecommendedClass: clean(body.RecommendedClass).slice(0, 100),
    Description: clean(body.Description).slice(0, 1000),
    CreatedAt: clean(existing?.CreatedAt) || nowIso(), UpdatedAt: nowIso()
  };
  try {
    await batchCommitDocuments(env, [
      write('titles', TitleId, saved, existing ? current(existing) : { exists: false }),
      audit(user, branchId, existing ? 'Update book title' : 'Create book title', { TitleId, Title: title })
    ]);
  } catch (error) { conflict(error); }
  return { ok: true, message: existing ? 'Book details updated.' : 'Book title added.', title: saved };
}

async function addCopy(env, user, body, branchId) {
  const titleId = clean(body.TitleId);
  const title = await getDocument(env, COLLECTIONS.titles, titleId);
  if (!title || safeScopeId(title.BranchId) !== branchId) throw failure('Choose a book title from this branch.', 404);
  const barcode = clean(body.Barcode).toUpperCase();
  if (!/^[A-Z0-9._-]{3,80}$/.test(barcode)) throw failure('Enter a unique barcode of 3–80 letters, numbers, dots, dashes or underscores.');
  const CopyId = `${branchId}--${barcode}`;
  const saved = {
    CopyId, TitleId: titleId, Title: clean(title.Title), BranchId: branchId,
    Barcode: barcode, Shelf: clean(body.Shelf).slice(0, 80),
    Condition: clean(body.Condition) || 'Good', Status: 'Available',
    AcquiredAt: clean(body.AcquiredAt), CreatedAt: nowIso(), UpdatedAt: nowIso()
  };
  if (!['New', 'Good', 'Worn'].includes(saved.Condition)) throw failure('Choose a valid copy condition.');
  try {
    await batchCommitDocuments(env, [
      write('copies', CopyId, saved, { exists: false }),
      audit(user, branchId, 'Add physical book copy', { CopyId, Barcode: barcode, TitleId: titleId })
    ]);
  } catch (error) { conflict(error); }
  return { ok: true, message: 'Physical copy added.', copy: saved };
}

async function restoreCopy(env, user, body, branchId) {
  const copy = await getDocument(env, COLLECTIONS.copies, clean(body.CopyId));
  if (!copy || safeScopeId(copy.BranchId) !== branchId) throw failure('The book copy was not found in this branch.', 404);
  if (!['Damaged', 'Lost'].includes(copy.Status) || clean(copy.CurrentLoanId)) {
    throw failure('Only a found or repaired copy with no active loan can be made available.', 409);
  }
  const condition = clean(body.Condition || 'Good');
  if (!['New', 'Good', 'Worn'].includes(condition)) throw failure('Choose New, Good or Worn as the copy condition.');
  const note = clean(body.Note).slice(0, 500);
  if (!note) throw failure('Record how this copy was found or repaired.');
  const saved = { ...copy, Status: 'Available', Condition: condition, RestoredAt: nowIso(),
    RestoredBy: clean(user.displayName || user.username), RestoreNote: note, UpdatedAt: nowIso() };
  try {
    await batchCommitDocuments(env, [
      write('copies', copy.CopyId, saved, current(copy)),
      audit(user, branchId, 'Restore physical book copy', { CopyId: copy.CopyId,
        PreviousStatus: copy.Status, Condition: condition, Note: note })
    ]);
  } catch (error) { conflict(error); }
  return { ok: true, message: 'Physical copy restored to available stock.', copy: saved };
}

async function checkout(env, user, body, branchId) {
  const copy = await getDocument(env, COLLECTIONS.copies, clean(body.CopyId));
  if (!copy || safeScopeId(copy.BranchId) !== branchId) throw failure('The book copy was not found in this branch.', 404);
  if (copy.Status !== 'Available') throw failure('This copy is not available for lending.', 409);
  const type = clean(body.BorrowerType);
  const directory = await readerDirectory(env, branchId);
  const borrower = borrowerFrom(body.BorrowerRef, type, directory.students, directory.staff);
  const policy = normalizeLibraryPolicy(await policyFor(env, branchId));
  const borrowerId = borrowerKey(branchId, type, borrower.BorrowerRef);
  const state = await getDocument(env, COLLECTIONS.borrowers, borrowerId);
  const limit = type === 'Student' ? policy.StudentLoanLimit : policy.StaffLoanLimit;
  if (Number(state?.ActiveLoans || 0) >= limit) throw failure(`${borrower.BorrowerName} has reached the ${limit}-book borrowing limit.`, 409);
  const reservations = branchRows(await branchCollection(env, 'reservations', branchId), branchId)
    .filter((row) => row.TitleId === copy.TitleId && row.Status === 'Pending')
    .sort((a, b) => clean(a.CreatedAt).localeCompare(clean(b.CreatedAt)));
  const first = reservations[0];
  if (first && (first.BorrowerType !== type || lower(first.BorrowerRef) !== lower(borrower.BorrowerRef))) {
    throw failure('This title is reserved for the next borrower in the queue.', 409);
  }
  const LoanId = id('LIB-LOAN');
  const checkedOutDate = localDate();
  const currentTitle = await getDocument(env, COLLECTIONS.titles, copy.TitleId);
  if (!currentTitle || safeScopeId(currentTitle.BranchId) !== branchId) throw failure('The copy title is missing from this branch.', 409);
  const loan = {
    LoanId, CopyId: copy.CopyId, TitleId: copy.TitleId, Title: copy.Title,
    Barcode: copy.Barcode, BranchId: branchId, ...borrower,
    CheckedOutDate: checkedOutDate, CheckedOutAt: nowIso(),
    DueDate: plusDays(checkedOutDate, type === 'Student' ? policy.StudentLoanDays : policy.StaffLoanDays),
    Renewals: 0, Status: 'On Loan', IssuedBy: clean(user.displayName || user.username)
  };
  loan.Title = clean(currentTitle.Title);
  const nextCopy = { ...copy, Title: loan.Title, Status: 'On Loan', CurrentLoanId: LoanId, UpdatedAt: nowIso() };
  const nextState = {
    BorrowerId: borrowerId, BranchId: branchId, ...borrower,
    ActiveLoans: Number(state?.ActiveLoans || 0) + 1, UpdatedAt: nowIso()
  };
  try {
    await batchCommitDocuments(env, [
      write('copies', copy.CopyId, nextCopy, current(copy)),
      write('loans', LoanId, loan, { exists: false }),
      write('borrowers', borrowerId, nextState, state ? current(state) : { exists: false }),
      ...(first ? [write('reservations', first.ReservationId, {
        ...first, Status: 'Fulfilled', FulfilledAt: nowIso(), LoanId
      }, current(first))] : []),
      audit(user, branchId, 'Check out book copy', { LoanId, CopyId: copy.CopyId, BorrowerRef: borrower.BorrowerRef, DueDate: loan.DueDate })
    ]);
  } catch (error) { conflict(error); }
  if (loan.BorrowerType === 'Student') {
    try { await createNotification(env, libraryLoanNotification(loan, 'issued')); }
    catch (error) { console.error('Library issue notification failed', error); }
  }
  return { ok: true, message: `Book issued to ${borrower.BorrowerName}; due ${loan.DueDate}.`, loan };
}

function libraryLoanNotification(loan, stage) {
  const overdue = stage.startsWith('overdue');
  const message = stage === 'issued'
    ? `${loan.BorrowerName} borrowed ${loan.Title}. Please return it by ${loan.DueDate}.`
    : overdue
      ? `${loan.Title}, borrowed by ${loan.BorrowerName}, was due on ${loan.DueDate}. Please contact the school library.`
      : `${loan.Title}, borrowed by ${loan.BorrowerName}, is due on ${loan.DueDate}.`;
  return {
    EventKey: `library-${loan.LoanId}-${stage}-${loan.DueDate}`,
    Audience: 'Parent', Category: 'Library', Type: 'Library loan',
    Title: stage === 'issued' ? 'School library book issued' : overdue ? 'School library book overdue' : 'School library book due soon',
    Message: message, TargetEmails: loan.ParentEmail ? [loan.ParentEmail] : [],
    TargetAccountRefs: [loan.BorrowerRef], BranchId: loan.BranchId,
    SchoolSection: loan.SchoolSection, RecordType: 'Library Loan', RecordId: loan.LoanId,
    DueDate: loan.DueDate, ActionUrl: 'parent-dashboard.html',
    Severity: overdue ? 'High' : 'Normal'
  };
}

export async function processLibraryDueReminders(env, options = {}) {
  const today = clean(options.today) || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw failure('Enter a valid library reminder date.');
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 250)));
  const loans = (await queryCollection(env, COLLECTIONS.loans, {
    filters: [{ field: 'Status', op: '==', value: 'On Loan' }]
  }))
    .filter((row) => row.Status === 'On Loan' && row.BorrowerType === 'Student' && clean(row.DueDate));
  const candidates = loans.map((loan) => {
    const days = Math.round((Date.parse(`${loan.DueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
    return { loan, days, stage: days < 0 ? 'overdue' : 'due' };
  }).filter((row) => [3, 1, 0, -1, -7].includes(row.days)).slice(0, limit);
  let created = 0;
  let failed = 0;
  for (const item of candidates) {
    try {
      const result = await createNotification(env, libraryLoanNotification(item.loan, `${item.stage}-${Math.abs(item.days)}`));
      if (result.created) created += 1;
    } catch (_error) { failed += 1; }
  }
  return { processed: candidates.length, created, failed };
}

async function returnCopy(env, user, body, branchId) {
  const loan = await getDocument(env, COLLECTIONS.loans, clean(body.LoanId));
  if (!loan || safeScopeId(loan.BranchId) !== branchId) throw failure('The loan was not found in this branch.', 404);
  if (loan.Status !== 'On Loan') throw failure('This loan has already been closed.', 409);
  const copy = await getDocument(env, COLLECTIONS.copies, loan.CopyId);
  if (!copy || safeScopeId(copy.BranchId) !== branchId || copy.CurrentLoanId !== loan.LoanId) {
    throw failure('The copy and loan records disagree. Contact an administrator before returning it.', 409);
  }
  const outcome = clean(body.Outcome || 'Returned');
  if (!['Returned', 'Damaged', 'Lost'].includes(outcome)) throw failure('Choose Returned, Damaged or Lost.');
  const borrowerId = borrowerKey(branchId, loan.BorrowerType, loan.BorrowerRef);
  const state = await getDocument(env, COLLECTIONS.borrowers, borrowerId);
  if (!state || Number(state.ActiveLoans) < 1) throw failure('The borrower loan count is inconsistent. Contact an administrator.', 409);
  const closed = {
    ...loan, Status: outcome, ReturnedAt: nowIso(), ReturnedDate: localDate(),
    ReturnCondition: clean(body.Condition).slice(0, 100),
    ReturnNotes: clean(body.Notes).slice(0, 500), ReceivedBy: clean(user.displayName || user.username)
  };
  const nextCopy = {
    ...copy, Status: outcome === 'Returned' ? 'Available' : outcome,
    CurrentLoanId: '', Condition: outcome === 'Damaged' ? 'Damaged' : copy.Condition,
    UpdatedAt: nowIso()
  };
  try {
    await batchCommitDocuments(env, [
      write('loans', loan.LoanId, closed, current(loan)),
      write('copies', copy.CopyId, nextCopy, current(copy)),
      write('borrowers', borrowerId, { ...state, ActiveLoans: Number(state.ActiveLoans) - 1, UpdatedAt: nowIso() }, current(state)),
      audit(user, branchId, `${outcome} book copy`, { LoanId: loan.LoanId, CopyId: copy.CopyId, BorrowerRef: loan.BorrowerRef })
    ]);
  } catch (error) { conflict(error); }
  return { ok: true, message: `Book marked ${outcome.toLowerCase()}.`, loan: closed };
}

async function renew(env, user, body, branchId) {
  const loan = await getDocument(env, COLLECTIONS.loans, clean(body.LoanId));
  if (!loan || safeScopeId(loan.BranchId) !== branchId) throw failure('The loan was not found in this branch.', 404);
  if (loan.Status !== 'On Loan') throw failure('Only an active loan can be renewed.', 409);
  const policy = normalizeLibraryPolicy(await policyFor(env, branchId));
  if (Number(loan.Renewals || 0) >= policy.MaxRenewals) throw failure('This loan has reached its renewal limit.', 409);
  const pending = branchRows(await branchCollection(env, 'reservations', branchId), branchId)
    .some((row) => row.TitleId === loan.TitleId && row.Status === 'Pending');
  if (pending) throw failure('This title is reserved and cannot be renewed.', 409);
  const days = loan.BorrowerType === 'Staff' ? policy.StaffLoanDays : policy.StudentLoanDays;
  const updated = {
    ...loan, DueDate: plusDays(loan.DueDate > localDate() ? loan.DueDate : localDate(), days),
    Renewals: Number(loan.Renewals || 0) + 1, RenewedAt: nowIso(), RenewedBy: clean(user.displayName || user.username)
  };
  try {
    await batchCommitDocuments(env, [
      write('loans', loan.LoanId, updated, current(loan)),
      audit(user, branchId, 'Renew book loan', { LoanId: loan.LoanId, NewDueDate: updated.DueDate })
    ]);
  } catch (error) { conflict(error); }
  return { ok: true, message: `Loan renewed until ${updated.DueDate}.`, loan: updated };
}

async function reserve(env, user, body, branchId) {
  const title = await getDocument(env, COLLECTIONS.titles, clean(body.TitleId));
  if (!title || safeScopeId(title.BranchId) !== branchId) throw failure('Choose a title from this branch.', 404);
  const type = clean(body.BorrowerType);
  const directory = await readerDirectory(env, branchId);
  const borrower = borrowerFrom(body.BorrowerRef, type, directory.students, directory.staff);
  const reservationId = `${branchId}--${encodeURIComponent(title.TitleId)}--${borrowerKey(branchId, type, borrower.BorrowerRef)}`;
  const prior = await getDocument(env, COLLECTIONS.reservations, reservationId);
  if (prior?.Status === 'Pending') throw failure('This borrower already has a reservation for the title.', 409);
  const reservation = {
    ReservationId: reservationId, TitleId: title.TitleId, Title: title.Title,
    BranchId: branchId, ...borrower, Status: 'Pending', CreatedAt: nowIso()
  };
  try {
    await batchCommitDocuments(env, [
      write('reservations', reservationId, reservation, prior ? current(prior) : { exists: false }),
      audit(user, branchId, 'Reserve book title', { ReservationId: reservationId, TitleId: title.TitleId, BorrowerRef: borrower.BorrowerRef })
    ]);
  } catch (error) { conflict(error); }
  return { ok: true, message: 'Reservation added to the queue.' };
}

async function cancelReservation(env, user, body, branchId) {
  const row = await getDocument(env, COLLECTIONS.reservations, clean(body.ReservationId));
  if (!row || safeScopeId(row.BranchId) !== branchId) throw failure('The reservation was not found in this branch.', 404);
  if (row.Status !== 'Pending') throw failure('This reservation is no longer pending.', 409);
  try {
    await batchCommitDocuments(env, [
      write('reservations', row.ReservationId, { ...row, Status: 'Cancelled', CancelledAt: nowIso() }, current(row)),
      audit(user, branchId, 'Cancel book reservation', { ReservationId: row.ReservationId, BorrowerRef: row.BorrowerRef })
    ]);
  } catch (error) { conflict(error); }
  return { ok: true, message: 'Reservation cancelled.' };
}

async function savePolicy(env, user, body, branchId) {
  const policy = normalizeLibraryPolicy(body);
  const existing = await getDocument(env, COLLECTIONS.policy, branchId);
  try {
    await batchCommitDocuments(env, [
      write('policy', branchId, { ...policy, BranchId: branchId, UpdatedAt: nowIso() }, existing ? current(existing) : { exists: false }),
      audit(user, branchId, 'Update library lending policy', policy)
    ]);
  } catch (error) { conflict(error); }
  return { ok: true, message: 'Library lending policy saved.' };
}

export async function handleSchoolLibraryAction(env, user, body = {}) {
  const action = lower(body.action || body.Action || 'list');
  if (action === 'list') return load(env, user, body);
  if (action === 'searchborrowers') {
    requireAccess(user);
    const branchId = await branchFor(env, user, body);
    const directory = await readerDirectory(env, branchId);
    return { ok: true, borrowers: searchLibraryBorrowers(body.Query, clean(body.BorrowerType),
      directory.students, directory.staff) };
  }
  requireAccess(user, true);
  const branchId = await branchFor(env, user, body);
  if (action === 'savetitle') return saveTitle(env, user, body, branchId);
  if (action === 'addcopy') return addCopy(env, user, body, branchId);
  if (action === 'restorecopy') return restoreCopy(env, user, body, branchId);
  if (action === 'checkout') return checkout(env, user, body, branchId);
  if (action === 'return') return returnCopy(env, user, body, branchId);
  if (action === 'renew') return renew(env, user, body, branchId);
  if (action === 'reserve') return reserve(env, user, body, branchId);
  if (action === 'cancelreservation') return cancelReservation(env, user, body, branchId);
  if (action === 'savepolicy') return savePolicy(env, user, body, branchId);
  throw failure('Choose a valid School Library action.');
}
