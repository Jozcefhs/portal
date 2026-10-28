import { getDocument, batchCommitDocuments, queryCollection } from './firestore.js';
import { findStaffUserRecord, staffAccessFor } from './staff-auth.js';

const clean = value => String(value ?? '').trim();
const actor = user => clean(user.username || user.Username).toLowerCase();
const plain = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
const fail = (message, status = 400, code = 'ACADEMIC_SUBMISSION_INVALID') => Object.assign(new Error(message), { status, code });
const ioDefault = { getDocument, batchCommitDocuments, queryCollection, findStaffUserRecord, staffAccessFor, fetch: (...args) => fetch(...args) };
export const SUBMISSION_TYPES = Object.freeze({ cbt: 'CBT test upload', scheme: 'Scheme of work',
  'diary-entry': 'Weekly subject work', diary: 'Compiled weekly diary', scorebook: 'Scorebook submission', attendance: 'Attendance register' });
export const SUBMISSION_COLLECTIONS = Object.freeze({ settings: 'academicSubmissionSettings', pending: 'academicPendingSubmissions', receipts: 'academicSubmissionReceipts', history: 'academicSubmissionSettingsHistory' });
const fields = ['BranchId', 'SchoolSection', 'SessionId', 'TermId'];
const selectorFields = ['ClassId', 'SubjectId', 'Week', 'AssessmentComponentId'];
const summaryFields = ['Reference', ...fields, 'Context', 'RecordType', 'Description', 'Actor', 'AmountKobo', 'Currency', 'Deadline', 'Status', 'CreatedAt', 'PaidAt', 'SubmittedAt', 'Message'];
const scopeOf = context => ({ BranchId: context.scope.branchId, SchoolSection: context.scope.section,
  SessionId: context.session.SessionId, TermId: context.term.TermId });
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export async function submissionHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))), b => b.toString(16).padStart(2, '0')).join('');
}
export function normalizeSubmissionRules(rules) {
  if (!Array.isArray(rules) || rules.length > 100) throw fail('Configure at most 100 deadline rules per term.');
  const seen = new Set();
  const normalized = rules.map((rule, index) => {
    if (!SUBMISSION_TYPES[rule.RecordType]) throw fail('Choose a supported academic record type.');
    const Deadline = clean(rule.Deadline);
    if (!/(Z|[+-]\d\d:\d\d)$/.test(Deadline) || !Number.isFinite(Date.parse(Deadline))) throw fail('Each deadline must include its timezone.');
    const AmountKobo = Number(rule.AmountKobo);
    if (!Number.isSafeInteger(AmountKobo) || AmountKobo < 100 || AmountKobo > 100000000) throw fail('Set a surcharge between NGN 1 and NGN 1,000,000, with at most two decimal places.');
    const row = { RuleId: `rule-${index + 1}`, RecordType: rule.RecordType, Enabled: rule.Enabled !== false,
      Deadline: new Date(Deadline).toISOString(), AmountKobo };
    selectorFields.forEach(key => { row[key] = clean(rule[key]); if (row[key].length > 200) throw fail('A deadline selector is too long.'); });
    if (row.Week && (!/^\d+$/.test(row.Week) || Number(row.Week) < 1 || Number(row.Week) > 53)) throw fail('Diary week must be 1 to 53, or blank for all weeks.');
    if (row.Week && !['diary', 'diary-entry'].includes(row.RecordType)) throw fail('Week filters apply only to weekly diary submissions. Leave Week blank for this record type.');
    if (row.AssessmentComponentId && row.RecordType !== 'cbt') throw fail('Test component filters apply only to CBT uploads. Leave Test ID blank for this record type.');
    if (row.SubjectId && row.RecordType === 'diary') throw fail('A compiled diary covers all subjects. Use a class/week rule instead of a subject filter.');
    const key = JSON.stringify([row.RecordType, ...selectorFields.map(k => row[k])]);
    if (seen.has(key)) throw fail('Do not repeat the same deadline scope.');
    seen.add(key); return row;
  });
  for (let index = 0; index < normalized.length; index += 1) {
    const a = normalized[index];
    for (const b of normalized.slice(index + 1)) {
      if (a.Enabled && b.Enabled && a.RecordType === b.RecordType
        && selectorFields.filter(k => a[k]).length === selectorFields.filter(k => b[k]).length
        && selectorFields.every(k => !a[k] || !b[k] || a[k] === b[k])) throw fail('Equally specific deadline rules overlap. Use one combined rule or disable one rule.');
    }
  }
  return normalized;
}
export function applicableSubmissionRule(settings, type, input, now = Date.now()) {
  if (settings?.Enabled !== true) return null;
  const matches = (settings.Rules || []).filter(rule => rule.Enabled && rule.RecordType === type
    && selectorFields.every(key => !rule[key] || clean(rule[key]) === clean(input[key])));
  const rank = rule => selectorFields.filter(key => rule[key]).length;
  matches.sort((a, b) => rank(b) - rank(a));
  if (matches.length > 1 && rank(matches[0]) === rank(matches[1])) throw fail('Overlapping deadline rules need Academic Management review.', 409);
  const rule = matches[0];
  return rule && now > Date.parse(rule.Deadline) ? rule : null;
}
export async function submissionSettings(env, context, user, input, save = false, io = ioDefault) {
  const scope = scopeOf(context), id = await submissionHash(fields.map(key => scope[key]));
  const previous = await io.getDocument(env, SUBMISSION_COLLECTIONS.settings, id);
  const canManage = !!context.permissions.canReviewScores;
  if (!save) {
    const choices = (key, id) => (context.state?.[key] || [])
      .filter(row => !['archived', 'inactive', 'deleted', 'closed'].includes(clean(row.Status).toLowerCase()))
      .map(row => ({ [id]: row[id], Name: row.Name || row[id] }))
      .sort((a, b) => a.Name.localeCompare(b.Name));
    return { ok: true, settings: { ...scope, Enabled: false, Rules: [], ...plain(previous), RevisionToken: previous?.__updateTime || '' }, canManage, recordTypes: SUBMISSION_TYPES,
      ...(input.IncludeChoices === true ? { classes: choices('classes', 'ClassId'), subjects: choices('subjects', 'SubjectId') } : {}) };
  }
  if (!canManage) throw fail('Only authorised Academic Management reviewers can configure submission deadlines.', 403);
  if (input.Enabled === true && !/^sk_(live|test)_/.test(clean(env.PAYSTACK_SECRET_KEY))) throw fail('Connect the school Paystack account before enabling surcharges.', 409);
  if (previous && (!input.RevisionToken || input.RevisionToken !== previous.__updateTime)) throw fail('These settings changed. Reload before saving.', 409);
  const next = { ...scope, Enabled: input.Enabled === true, Rules: normalizeSubmissionRules(input.Rules),
    UpdatedBy: actor(user), UpdatedAt: new Date().toISOString() };
  await io.batchCommitDocuments(env, [
    { collectionPath: SUBMISSION_COLLECTIONS.settings, documentId: id, data: next, ...(previous ? { updateTime: previous.__updateTime } : { exists: false }) },
    { collectionPath: SUBMISSION_COLLECTIONS.history, documentId: crypto.randomUUID(), exists: false,
      data: { ...scope, Actor: actor(user), At: next.UpdatedAt, Previous: plain(previous), Current: next } }
  ]);
  return submissionSettings(env, context, user, input, false, io);
}
export function submissionSummary(row) {
  return Object.fromEntries(summaryFields.map(key => [key, row[key] ?? '']));
}

// Called only AFTER the owning academic workflow has validated permissions,
// completeness and optimistic revisions. Store server-built writes, never client writes.
export async function commitAcademicSubmission(env, context, user, input, type, writes, io = ioDefault) {
  const scope = scopeOf(context), id = await submissionHash(fields.map(key => scope[key]));
  const settings = await io.getDocument(env, SUBMISSION_COLLECTIONS.settings, id);
  const rule = applicableSubmissionRule(settings, type, input);
  if (!rule || !writes.length) return io.batchCommitDocuments(env, writes, { allowLargeAtomicBatch: type === 'attendance' });
  // Attendance carries a membership revision guard per student so a transfer
  // cannot race the register. Keep one atomic save, including those guards.
  if (writes.length > (type === 'attendance' ? 997 : 497) || writes.some(write => !write.updateTime && write.exists !== false)) throw fail('This submission cannot be reserved safely. Ask Academic Management to review it.', 409);
  // The same actor/record/revision always resumes the same checkout, even after
  // a timeout. Audit/history UUIDs are excluded from the stable reservation key.
  const targets = writes.filter(w => !/audit|history/i.test(w.collectionPath))
    .sort((a, b) => `${a.collectionPath}/${a.documentId}`.localeCompare(`${b.collectionPath}/${b.documentId}`));
  const reservationKey = [clean(env.FIREBASE_PROJECT_ID), scope, actor(user), type, selectorFields.map(key => clean(input[key])), targets.map(w => [w.collectionPath, w.documentId, w.updateTime || 'new'])];
  const componentId = type === 'scorebook' ? clean(input.ComponentId) : '';
  // Different tests on the same saved sheet must not resume each other's
  // checkout. Keep the existing key unchanged for full-sheet submissions.
  if (componentId) reservationKey.push({ComponentId:componentId});
  const reference = `ACS-${await submissionHash(reservationKey)}`;
  let pending = await io.getDocument(env, SUBMISSION_COLLECTIONS.pending, reference);
  if (!pending) {
    pending = { ...scope, EnvironmentId: clean(env.FIREBASE_PROJECT_ID), ScopeKey: id, ActorScopeKey: `${id}:${actor(user)}`, Reference: reference, Actor: actor(user), RecordType: type,
      Description: SUBMISSION_TYPES[type], AmountKobo: rule.AmountKobo, Currency: 'NGN', Deadline: rule.Deadline,
      Rule: rule, Status: 'Awaiting payment', CreatedAt: new Date().toISOString(), Writes: writes,
      Context: {...Object.fromEntries([...selectorFields, 'ArmId'].map(key => [key, clean(input[key])])), ...(componentId ? {ComponentId:componentId} : {})} };
    if (new TextEncoder().encode(JSON.stringify(pending)).length > 500000) throw fail('This submission is too large to reserve for payment. No charge was created.', 413);
    try { await io.batchCommitDocuments(env, [{ collectionPath: SUBMISSION_COLLECTIONS.pending, documentId: reference, data: pending, exists: false }]); }
    catch (error) {
      const existing = await io.getDocument(env, SUBMISSION_COLLECTIONS.pending, reference);
      if (!existing) throw error;
      pending = existing;
    }
  }
  const error = fail('The submission deadline has passed. Pay the surcharge to submit the reserved record. An existing reservation keeps its original contents; later edits are not included.', 402, 'ACADEMIC_SURCHARGE_REQUIRED');
  error.submission = submissionSummary(pending); throw error;
}

async function paystack(env, path, body, io) {
  const secret = clean(env.PAYSTACK_SECRET_KEY);
  if (!/^sk_(live|test)_/.test(secret)) throw fail('The school Paystack account is not configured. No payment was requested.', 503);
  const response = await io.fetch(`https://api.paystack.co${path}`, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok || data.status !== true) throw fail('Paystack could not confirm this request. Retry the same reference; do not create a second payment.', 503);
  return data.data;
}
async function assertTargetsCurrent(env, pending, io) {
  // Bounded batches keep a large attendance register from flooding Firestore.
  for (let offset = 0; offset < pending.Writes.length; offset += 8) {
    await Promise.all(pending.Writes.slice(offset, offset + 8).map(async write => {
      const row = await io.getDocument(env, write.collectionPath, write.documentId);
      if ((write.exists === false && row) || (write.updateTime && row?.__updateTime !== write.updateTime)) {
        throw fail('The reserved record changed. No record was overwritten. Academic Management must review this submission.', 409, 'ACADEMIC_SUBMISSION_CHANGED');
      }
    }));
  }
}
async function submissionWritesForPayment(env, pending, io) {
  if (pending.RecordType !== 'diary-entry') return pending.Writes;
  const primary = pending.Writes[0], history = pending.Writes[1];
  const current = await io.getDocument(env, primary.collectionPath, primary.documentId);
  if (!current || current.__updateTime === primary.updateTime) return pending.Writes;
  const subject = pending.Context.SubjectId;
  const previous = history?.data?.Previous || {};
  const beforeEntry = (previous.Entries || []).find(row => row.SubjectId === subject) || null;
  const currentEntry = (current.Entries || []).find(row => row.SubjectId === subject) || null;
  // Another subject teacher can complete the SAME weekly diary while checkout
  // is open. Merge only our unchanged subject entry; never replace their work.
  if (!subject || !current.__updateTime || !['Draft', 'Returned'].includes(current.Status)
    || ![...fields, 'ClassId', 'ArmId', 'Week'].every(key => String(current[key]) === String(primary.data[key]))
    || current.WeekEnding !== primary.data.WeekEnding || JSON.stringify(canonical(beforeEntry)) !== JSON.stringify(canonical(currentEntry))) {
    throw fail('The reserved diary entry changed and requires review.', 409, 'ACADEMIC_SUBMISSION_CHANGED');
  }
  const entry = primary.data.Entries.find(row => row.SubjectId === subject);
  const timestamp = new Date().toISOString();
  const merged = { ...plain(current), Version: Number(current.Version) + 1, UpdatedAt: timestamp, UpdatedBy: pending.Actor,
    Entries: [...current.Entries.filter(row => row.SubjectId !== subject), { ...entry, At: timestamp }] };
  return [{ ...primary, exists: undefined, updateTime: current.__updateTime, data: merged },
    { ...history, documentId: `${primary.documentId}-${merged.Version}`, data: { ...history.data, Version: merged.Version,
      Timestamp: timestamp, Previous: plain(current), Current: merged } }];
}
async function activeAccount(env, pending, io) {
  const account = await io.findStaffUserRecord(env, pending.Actor, { allowListFallback: false });
  if (!account || account.Active === false || ['no', 'false', '0'].includes(clean(account.Active).toLowerCase())
    || ['disabled', 'inactive', 'deleted'].includes(clean(account.Status).toLowerCase())) throw fail('The submitting staff account is no longer active. Academic Management must review this submission.', 409);
  const access = await io.staffAccessFor(env, account);
  if (access.subscriptionActive === false || !access.allowedSections?.includes('academics')) throw fail('The submitting staff account no longer has Academic Management access.', 409);
  const branch = clean(account.BranchId || account.branchId);
  if (branch && branch !== 'all' && branch !== pending.BranchId) throw fail('The submitting staff account changed branch. Academic Management must review this submission.', 409);
  const section = clean(account.SchoolSectionAccess || account.schoolSectionAccess || 'all').toLowerCase();
  if (section !== 'all' && section !== pending.SchoolSection.toLowerCase()) throw fail('The submitting staff account changed school section. Academic Management must review this submission.', 409);
  const [session, term] = await Promise.all([io.getDocument(env, 'academicSessions', pending.SessionId), io.getDocument(env, 'academicTerms', pending.TermId)]);
  if (!session || !term || term.SessionId !== pending.SessionId || [session, term].some(row => ['closed', 'archived', 'inactive', 'deleted'].includes(clean(row.Status).toLowerCase()))) {
    throw fail('This academic period is no longer open. Academic Management must review the reserved submission.', 409);
  }
  return account;
}
export async function initializeSubmissionPayment(env, pending, io = ioDefault) {
  if (pending.Status === 'Submitted') return { ok: true, submission: submissionSummary(pending) };
  if (pending.PaidAt) throw fail('Payment has already been received. Do not pay again; Academic Management must review the reserved submission.', 409);
  if (pending.CheckoutUrl) return { ok: true, submission: submissionSummary(pending), checkoutUrl: pending.CheckoutUrl };
  await assertTargetsCurrent(env, { ...pending, Writes: await submissionWritesForPayment(env, pending, io) }, io);
  const account = await activeAccount(env, pending, io);
  const email = clean(account?.Email || account?.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || ['disabled', 'inactive', 'deleted'].includes(clean(account?.Status).toLowerCase())) throw fail('An active staff login account with an email address is required for checkout.', 409);
  const data = await paystack(env, '/transaction/initialize', { reference: pending.Reference, amount: pending.AmountKobo,
    currency: pending.Currency, email, metadata: { paymentType: 'AcademicSubmissionSurcharge', reference: pending.Reference } }, io);
  if (!/^https:\/\/checkout\.paystack\.com\//.test(clean(data.authorization_url))) throw fail('Paystack returned an invalid checkout address.', 502);
  await io.batchCommitDocuments(env, [{ collectionPath: SUBMISSION_COLLECTIONS.pending, documentId: pending.Reference,
    updateTime: pending.__updateTime, data: { ...plain(pending), CheckoutUrl: data.authorization_url } }]);
  return { ok: true, submission: submissionSummary(pending), checkoutUrl: data.authorization_url };
}
export async function verifySubmissionPayment(env, reference, io = ioDefault) {
  if (!/^ACS-[a-f0-9]{64}$/.test(clean(reference))) throw fail('Invalid surcharge reference.');
  const pending = await io.getDocument(env, SUBMISSION_COLLECTIONS.pending, reference);
  if (!pending) throw fail('Submission not found.', 404);
  if (pending.EnvironmentId !== clean(env.FIREBASE_PROJECT_ID)) throw fail('This payment belongs to a different school deployment.', 403);
  if (pending.Status === 'Submitted') return { ok: true, submission: submissionSummary(pending) };
  const payment = await paystack(env, `/transaction/verify/${encodeURIComponent(reference)}`, null, io);
  if (payment.status !== 'success') return { ok: true, submission: submissionSummary(pending), message: 'Payment has not succeeded yet. Your record has not been submitted.' };
  if (payment.reference !== reference || Number(payment.amount) !== pending.AmountKobo || payment.currency !== pending.Currency
    || payment.domain !== (clean(env.PAYSTACK_SECRET_KEY).startsWith('sk_live_') ? 'live' : 'test')) throw fail('The verified payment does not match this school submission. Nothing was submitted.', 409, 'ACADEMIC_SURCHARGE_MISMATCH');
  const timestamp = new Date().toISOString();
  const receipt = { ...submissionSummary(pending), Status: 'Paid', PaidAt: payment.paid_at || timestamp,
    EnvironmentId: pending.EnvironmentId, PaystackMode: payment.domain,
    PaystackTransactionId: String(payment.id), VerifiedAt: timestamp };
  const receiptWrite = { collectionPath: SUBMISSION_COLLECTIONS.receipts, documentId: reference, data: receipt };
  const paid = { ...plain(pending), PaidAt: receipt.PaidAt, Status: 'Submitted', SubmittedAt: timestamp, Message: 'Payment verified and reserved record submitted.' };
  try {
    await activeAccount(env, pending, io);
    const writes = await submissionWritesForPayment(env, pending, io);
    await assertTargetsCurrent(env, { ...pending, Writes: writes }, io);
    // Financial receipt, reserved academic writes and consumed-payment status
    // commit atomically. Repeated webhook/callback delivery cannot submit twice.
    await io.batchCommitDocuments(env, [...writes, receiptWrite,
      { collectionPath: SUBMISSION_COLLECTIONS.pending, documentId: reference, updateTime: pending.__updateTime, data: paid }],
      { allowLargeAtomicBatch: pending.RecordType === 'attendance' });
    return { ok: true, submission: submissionSummary(paid) };
  } catch (error) {
    const current = await io.getDocument(env, SUBMISSION_COLLECTIONS.pending, reference);
    if (current?.Status === 'Submitted') return { ok: true, submission: submissionSummary(current) };
    if (![409, 412].includes(Number(error.status))) throw error;
    const review = { ...plain(current), PaidAt: receipt.PaidAt, Status: 'Paid — review required',
      Message: 'Payment received, but the reserved record changed. Do not pay again. Academic Management must reconcile this paid submission.' };
    await io.batchCommitDocuments(env, [receiptWrite, { collectionPath: SUBMISSION_COLLECTIONS.pending,
      documentId: reference, updateTime: current.__updateTime, data: review }]);
    return { ok: true, submission: submissionSummary(review) };
  }
}
export async function submissionPaymentAction(env, context, user, input, action, io = ioDefault) {
  const scope = scopeOf(context);
  if (action === 'listacademicsubmissions') {
    const key = await submissionHash(fields.map(field => scope[field]));
    const cursor = clean(input.Cursor);
    if (cursor && !/^ACS-[a-f0-9]{64}$/.test(cursor)) throw fail('Invalid submission-register cursor.');
    const rows = await io.queryCollection(env, SUBMISSION_COLLECTIONS.pending, {
      filters: [{ field: context.permissions.canReviewScores ? 'ScopeKey' : 'ActorScopeKey', op: '==', value: context.permissions.canReviewScores ? key : `${key}:${actor(user)}` }],
      select: summaryFields, orderBy: [{ field: '__name__' }], limit: 100,
      ...(cursor ? { startAfterName: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${SUBMISSION_COLLECTIONS.pending}/${cursor}` } : {}) });
    return { ok: true, submissions: rows.filter(row => fields.every(key => row[key] === scope[key])
      && (context.permissions.canReviewScores || row.Actor === actor(user))).map(submissionSummary), nextCursor: rows.length === 100 ? rows.at(-1).Reference : '' };
  }
  const pending = await io.getDocument(env, SUBMISSION_COLLECTIONS.pending, clean(input.Reference));
  if (!pending || !fields.every(key => pending[key] === scope[key]) || (pending.Actor !== actor(user) && !context.permissions.canReviewScores)) throw fail('This submission is not available to your account in this school scope.', 403);
  if (action === 'payacademicsubmission') {
    if (pending.Actor !== actor(user)) throw fail('The submitting teacher must open their own checkout.', 403);
    return initializeSubmissionPayment(env, pending, io);
  }
  const result = await verifySubmissionPayment(env, pending.Reference, io);
  if (result.submission.Status === 'Submitted' && pending.RecordType === 'cbt') {
    const write = pending.Writes[0];
    const saved = await io.getDocument(env, write.collectionPath, write.documentId);
    result.CbtTest = { ...plain(saved), RevisionToken: saved.__updateTime };
    result.CbtTestId = saved.CbtTestId;
    result.supersededCbtTestIds = pending.Writes.slice(1).filter(w => w.data?.Status === 'Superseded').map(w => w.documentId);
  }
  return result;
}
