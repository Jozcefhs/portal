const clean = value => String(value ?? '').trim();

// Routing commands arrive as camelCase, snake_case, uppercase or joined lowercase.
// Split only fully recognised compounds; never guess words inside record identifiers.
const vocabulary = new Set(`accept acceptance access account accounts accounting academic academics activate activity add admission all allocation amend announcement application apply approval approve archive assign assignment attendance authentication authorize backup balance batch begin bill billing boarding book booking books borrow branch bulk cancel candidate card case category cbt change check checkout church class classes clinic clock close collect collection compensation complete compliance component conduct confirm connect correction correspondence create credit currency customer daily data deactivate decision delete delivery department destination detail device direction disable disburse document donation donor draft edit email employee employment enable end enroll enrollment entry entries exam exchange exit expense export face fee fees fetch file finalize finding form fund funds generate generation generic get grade grading group guest help history homework hotel hr id import imprest income inherit initialize inventory invoice issue item items journal key leave lesson library link list load loan lock login logout lookup manual mark material media meeting member membership merge message mode module movement network notification notifications offer offering onboarding online operation order organisation organization outcome parent password payment payroll period permission permissions photo plan policy poll post prepare presence preview print process product profile proof provision publish purchase push qr quantity quick read receipt receive reconcile reconciliation record records recovery reduce refresh refund register registration reject release remove renew reopen replace report reports request reschedule reservation reset respond response restore restrict restrictions resubmit result results retire retirement return review revoke role room roster route rule rules run sale sales save schedule scheduler school score scorebook scores search section security send service session settings setup shift sibling sign site staff start status stock store student students subject submit subscription sync system target template term test time timetable token training transaction transfer trial type unarchive unlock unpublish unsubscribe update upload use user users vacancy validate vendor verification verify view visit void wallet withdrawal write`.split(/\s+/));
for (const word of `advance borrowers cleanup command copy customers departments details donations foreign market migrate paid participant people position preferences repair reissue requisition resolve settle slot storage subscribe title visitor`.split(' ')) vocabulary.add(word);
for (const word of `acknowledge active allocate arm templates calculate cumulative midterm promotion promotions decisions substitution version scoresheet transcript selection decide constraint download package conversion management context clearance init members open local identity cloud papers reactivate total charge rollback probation resit remarks mapping giving household occurrence program set paystack housekeeping rate passwords withdraw defaults groups teachers teacher subjects memberships services offerings conduct cases`.split(' ')) vocabulary.add(word);

function splitCompound(token) {
  const memo = new Map();
  const split = at => {
    if (at === token.length) return [];
    if (memo.has(at)) return memo.get(at);
    for (let end = token.length; end > at; end--) {
      const word = token.slice(at, end);
      if (!vocabulary.has(word)) continue;
      const rest = split(end);
      if (rest) { const result = [word, ...rest]; memo.set(at, result); return result; }
    }
    memo.set(at, null); return null;
  };
  return split(0)?.join(' ') || token;
}

export function auditWords(value) {
  return clean(value).slice(0, 500).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_./:-]+/g, ' ').toLowerCase().replace(/[a-z]+/g, splitCompound)
    .replace(/\s+/g, ' ').trim();
}

export function auditSentence(value) {
  const words = clean(value).toLowerCase().replace(/\b(api|csv|pdf|cbt|nfc|mfa|otp|id|hr|qr)\b/g, word => word.toUpperCase());
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

// Scope is useful to every module, but free-text notes, medical details, messages,
// credentials, media and entire request/response objects must never enter this log.
export function auditActionContext(body = {}) {
  const fields = [
    ['Department', ['section', 'Section', 'Department']],
    ['Class', ['ClassName', 'Class']], ['School section', ['SchoolSection']],
    ['Academic year', ['AcademicYear', 'Session']], ['Term', ['Term']],
    ['Date', ['Date', 'AttendanceDate', 'VisitDate']],
    ['Attendance group', ['AttendanceGroupId', 'GroupId']], ['Shift', ['ShiftId']],
    ['Item', ['ItemId', 'BookId', 'CopyId', 'TitleId']],
    ['Quantity', ['Quantity']], ['Unit', ['Unit']], ['Stock direction', ['MovementType']],
    ['Room', ['RoomId']], ['Booking', ['BookingId']], ['Role', ['Role', 'role']]
  ];
  return fields.flatMap(([label, keys]) => {
    const key = keys.find(key => ['string', 'number'].includes(typeof body[key]) && clean(body[key]));
    return key ? [`${label}: ${clean(body[key]).replace(/[\r\n\t]+/g, ' ').slice(0, 80)}`] : [];
  }).join('; ').slice(0, 500);
}

const completedVerbs = Object.freeze({
  accept: 'accepted', activate: 'activated', add: 'added', approve: 'approved', archive: 'archived',
  assign: 'assigned', cancel: 'cancelled', change: 'changed', check: 'checked', complete: 'completed',
  confirm: 'confirmed', create: 'created', deactivate: 'deactivated', delete: 'deleted', disable: 'disabled',
  edit: 'edited', enable: 'enabled', export: 'exported', generate: 'generated', import: 'imported',
  issue: 'issued', link: 'linked', lock: 'locked', mark: 'marked', post: 'posted', print: 'printed',
  publish: 'published', record: 'recorded', register: 'registered', reject: 'rejected', remove: 'removed',
  renew: 'renewed', reopen: 'reopened', replace: 'replaced', request: 'requested', reset: 'reset',
  restore: 'restored', return: 'returned', review: 'reviewed', revoke: 'revoked', save: 'saved',
  send: 'sent', sign: 'signed', submit: 'submitted', sync: 'synchronised', unlock: 'unlocked',
  unpublish: 'unpublished', update: 'updated', upload: 'uploaded', verify: 'verified', void: 'voided'
});

function completedAction(action) {
  const words = action.split(' '), first = words[0].toLowerCase();
  if (completedVerbs[first]) return [completedVerbs[first], ...words.slice(1)].join(' ');
  if (/^(approved|rejected|posted|signed)\b/i.test(action)) return action[0].toLowerCase() + action.slice(1);
  return `recorded the action “${action}”`;
}

// Describes only evidence in the audit record. HTTP success alone does not prove
// that a business mutation completed, so request logs and business events differ.
export function auditNarrative(row = {}) {
  if (clean(row.Summary)) return clean(row.Summary).slice(0, 700);
  const actor = clean(row.Actor || row.ActorUsername) || 'An unidentified user';
  const action = clean(row.Action) || 'Action not recorded';
  const subject = clean(row.EntityId || row.Subject);
  const target = subject ? ` Affected record: ${subject}.` : '';
  const context = clean(row.ActionContext) ? ` Recorded scope: ${clean(row.ActionContext)}.` : '';
  const module = clean(row.Module) && row.Module !== 'Platform operations' ? ` in ${row.Module}` : '';
  const requestedAction = action[0]?.toLowerCase() + action.slice(1);
  const outcome = clean(row.Outcome).toLowerCase();
  if (outcome === 'denied') return `${actor} was denied permission to ${requestedAction}${module}.${target}${context}`;
  if (outcome === 'failed') return `${actor} attempted to ${requestedAction}${module}. The operation failed; completion was not confirmed.${target}${context}`;
  if (/stage not recorded/i.test(action)) return `${actor} processed a bank-transfer approval step. The historical record does not identify which step or establish another credit.${target}`;
  if (/^preview\b/i.test(action)) return `${actor} previewed ${action.replace(/^preview\s*/i, '')}${module}. This is a preview, not confirmation of a saved change.${target}${context}`;
  if (Number(row.HttpStatus) === 202) return `${actor} processed a step: ${action}${module}. The overall workflow is still in progress.${target}${context}`;
  if (row.SourceCollection === 'platformSecurityAudit' || row.Route) {
    return `${actor} requested to ${requestedAction}${module}. ${outcome && outcome !== 'success' ? `Reported outcome: ${row.Outcome}.` : 'The server reported success for this request.'}${target}${context}`;
  }
  // Business audits are emitted after their action; unlike an HTTP request log,
  // these can describe the recorded event in the past tense. Do not infer changes
  // or quantities that were never recorded in historical evidence.
  const detail = ['hrAudit', 'staffSecurityAudit', 'staffRecordsAudit', 'executiveCorrespondenceAudit'].includes(row.SourceCollection)
    && clean(row.Details) ? ` Recorded detail: ${clean(row.Details).slice(0, 200)}.` : '';
  return outcome === 'success'
    ? `${actor} ${completedAction(action)}${module}.${target}${context}${detail}`
    : `${actor} recorded the action “${action}”${module}. Reported outcome: ${row.Outcome || 'not recorded'}.${target}${context}${detail}`;
}

export function paymentAuditSummary(payment = {}, { duplicate = false, channel = 'manual entry' } = {}) {
  const amount = Number(payment.Amount);
  if (!Number.isFinite(amount)) return '';
  const currency = /^[A-Z]{3}$/.test(clean(payment.Currency).toUpperCase()) ? clean(payment.Currency).toUpperCase() : 'NGN';
  const money = new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(amount);
  const student = clean(payment.AccountRef || payment.AdmissionNo);
  const target = student ? `student ${student}` : 'the selected student';
  if (duplicate) return `${money} receipt for ${target} was already recorded. The existing payment was reused; this was not a second receipt.`;
  const wallet = clean(payment.FeeCode).toUpperCase() === 'WALLET_TOPUP' || clean(payment.FeeCategory).toLowerCase() === 'wallet';
  const reviewed = payment.DuplicateWalletReview;
  const reviewNote = wallet && reviewed?.MatchCount > 0
    ? ` ${clean(reviewed.ReviewedBy) || 'The accountant'} confirmed this was a separate payment after reviewing ${Number(reviewed.MatchCount)} existing same-amount wallet credit(s).` : '';
  return wallet ? `${money} credited to ${target}'s wallet through ${channel}.${reviewNote}`
    : `${money} recorded for ${target} through ${channel}${payment.FeeName ? ` (${clean(payment.FeeName)})` : ''}. This was not a wallet top-up.`;
}
