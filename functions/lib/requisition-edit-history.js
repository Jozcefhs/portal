const clean = (value) => String(value ?? '').trim();

// Only business fields are compared. Never archive passwords, approval proofs or client-supplied actors.
const EDIT_FIELDS = Object.freeze({
  Date: 'Required date', Vendor: 'Vendor', Description: 'Description', Amount: 'Amount',
  MaterialItems: 'Material items', ExpenseAccount: 'Expense account', PaymentAccount: 'Payment account',
  Department: 'Department', CostCentre: 'Cost centre', BudgetCode: 'Budget code',
  PaymentMethod: 'Payment method', Reference: 'Reference', AttachmentUrl: 'Attachment', Notes: 'Notes'
});

function materialRows(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

const MATERIAL_FIELDS = Object.freeze([
  ['Item', 'Item', false], ['Specification', 'Specification', false],
  ['Quantity', 'Quantity', true], ['UnitPrice', 'Unit price', true]
]);

function materialValue(row, key, numeric = false) {
  const value = row?.[key] ?? row?.[key.charAt(0).toLowerCase() + key.slice(1)];
  return numeric ? Number(value || 0) : clean(value);
}

export function materialChangedFields(before, after) {
  const previous = materialRows(before);
  const current = materialRows(after);
  const fields = [];
  if (current.length > previous.length) fields.push('Items added');
  if (current.length < previous.length) fields.push('Items removed');
  const signature = row => JSON.stringify(MATERIAL_FIELDS.map(([key, , numeric]) => materialValue(row, key, numeric)));
  const previousSignatures = previous.map(signature);
  const currentSignatures = current.map(signature);
  if (previous.length === current.length && JSON.stringify(previousSignatures) !== JSON.stringify(currentSignatures)
      && JSON.stringify([...previousSignatures].sort()) === JSON.stringify([...currentSignatures].sort())) {
    return ['Item order'];
  }
  // Compare the actual editable columns, not a serialized table (which also
  // changes when a numeric string is normalized or line totals are recomputed).
  // Match unchanged rows first so inserting/removing a line does not make every
  // following row appear to have changed its item, quantity and price.
  const unmatchedCurrent = current.map((row, index) => ({ row, index }));
  const unmatchedPrevious = [];
  const pairs = [];
  previous.forEach((row, index) => {
    const match = unmatchedCurrent.findIndex(candidate => currentSignatures[candidate.index] === previousSignatures[index]);
    if (match < 0) unmatchedPrevious.push(row);
    else pairs.push([row, unmatchedCurrent.splice(match, 1)[0].row]);
  });
  const remainingPrevious = [];
  unmatchedPrevious.forEach(row => {
    const match = unmatchedCurrent.findIndex(candidate =>
      materialValue(candidate.row, 'Item') === materialValue(row, 'Item')
      && materialValue(candidate.row, 'Specification') === materialValue(row, 'Specification'));
    if (match < 0) remainingPrevious.push(row);
    else pairs.push([row, unmatchedCurrent.splice(match, 1)[0].row]);
  });
  remainingPrevious.forEach((row, index) => {
    if (unmatchedCurrent[index]) pairs.push([row, unmatchedCurrent[index].row]);
  });
  for (const [key, label, numeric] of MATERIAL_FIELDS) {
    if (pairs.some(([oldRow, newRow]) =>
      materialValue(oldRow, key, numeric) !== materialValue(newRow, key, numeric))) fields.push(label);
  }
  if (!fields.length && pairs.some(([oldRow, newRow]) =>
    materialValue(oldRow, 'Total', true) !== materialValue(newRow, 'Total', true))) fields.push('Line total');
  return fields;
}

export function requisitionChangedFields(before = {}, after = {}) {
  return Object.entries(EDIT_FIELDS).flatMap(([key, label]) => {
    if (key === 'MaterialItems') return materialChangedFields(before[key], after[key]);
    const changed = key === 'Amount' ? Number(before[key] || 0) !== Number(after[key] || 0) : clean(before[key]) !== clean(after[key]);
    return changed ? [label] : [];
  });
}

export function requisitionEditHistory(record = {}) {
  if (Array.isArray(record.EditHistory) && record.EditHistory.length) return record.EditHistory;
  // Older web resubmissions already saved these facts. Do not infer edits from UpdatedBy,
  // which is also changed by approvals, rejections and payments.
  if (!record.ResubmittedAt) return [];
  return [{
    Action: 'EDIT AND RESUBMIT REQUISITION', Timestamp: clean(record.ResubmittedAt),
    Officer: clean(record.ResubmittedBy || record.ResubmittedByUsername),
    Username: clean(record.ResubmittedByUsername), Role: '',
    RevisionNumber: record.RevisionNumber || '', ChangedFields: [], Legacy: true
  }];
}

export async function resolvedRequisitionEditHistory(record, readRevision) {
  const history = requisitionEditHistory(record);
  const coarse = history.filter(entry => Array.isArray(entry.ChangedFields) && entry.ChangedFields.includes('Material items')
    && Number.isInteger(Number(entry.RevisionNumber)) && Number(entry.RevisionNumber) >= 2).slice(-50);
  if (!coarse.length) return history;
  const latest = Number(record.RevisionNumber || 1);
  const numbers = [...new Set(coarse.flatMap(entry => {
    const revision = Number(entry.RevisionNumber);
    return revision <= latest ? [revision - 1, ...(revision < latest ? [revision] : [])] : [];
  }))];
  const revisions = new Map();
  // Focused revision reads only, after the caller authorizes the parent record.
  for (let index = 0; index < numbers.length; index += 8) {
    await Promise.all(numbers.slice(index, index + 8).map(async number => {
      revisions.set(number, await readRevision(number).catch(() => null));
    }));
  }
  const valid = (archive, revision) => archive?.Snapshot
    && clean(archive.ExpenseNo) === clean(record.ExpenseNo)
    && Number(archive.RevisionNumber) === revision
    && clean(archive.BranchId || 'main') === clean(record.BranchId || 'main')
    && clean(archive.Snapshot.ExpenseNo) === clean(record.ExpenseNo)
    && clean(archive.Snapshot.BranchId || 'main') === clean(record.BranchId || 'main')
    && Number(archive.Snapshot.RevisionNumber || 1) === revision;
  return history.map(entry => {
    if (!coarse.includes(entry)) return entry;
    const revision = Number(entry.RevisionNumber);
    const archivedBefore = revisions.get(revision - 1);
    const archivedAfter = revisions.get(revision);
    if (!valid(archivedBefore, revision - 1) || (entry.Timestamp && clean(archivedBefore.ArchivedAt) !== clean(entry.Timestamp))) return entry;
    const after = revision === latest ? record : valid(archivedAfter, revision) ? archivedAfter.Snapshot : null;
    if (!after || !Array.isArray(archivedBefore.Snapshot.MaterialItems) || !Array.isArray(after.MaterialItems)) return entry;
    const fields = materialChangedFields(archivedBefore.Snapshot.MaterialItems, after.MaterialItems);
    return { ...entry, ChangedFields: [...new Set(entry.ChangedFields.flatMap(field => field === 'Material items' ? fields : [field]))],
      FieldDetailsSource: 'Saved revision snapshots' };
  });
}

export function recordRequisitionEdit(before, after, officer, timestamp, { resubmitted = false } = {}) {
  const changed = requisitionChangedFields(before, after);
  if (!resubmitted && !changed.length) return null;
  const prior = Number(before.RevisionNumber || 1);
  const revision = (Number.isInteger(prior) && prior > 0 ? prior : 1) + 1;
  const event = {
    Action: resubmitted ? 'EDIT AND RESUBMIT REQUISITION' : 'EDIT REQUISITION',
    Timestamp: timestamp, Officer: clean(officer.displayName || officer.username),
    Username: clean(officer.username), Role: clean(officer.assignedRole || officer.role),
    RevisionNumber: revision, PreviousStatus: clean(before.Status), Status: clean(after.Status),
    ChangedFields: changed
  };
  Object.assign(after, {
    RevisionNumber: revision, EditedBy: event.Officer, EditedByUsername: event.Username,
    EditedByRole: event.Role, EditedAt: timestamp, EditAction: event.Action,
    EditHistory: [...requisitionEditHistory(before), event]
  });
  return event;
}

export function requisitionEditDetails(event) {
  return `Revision ${event.RevisionNumber}; ${event.PreviousStatus || 'unspecified'} → ${event.Status || 'unspecified'}; `
    + (event.ChangedFields.length ? `changed: ${event.ChangedFields.join(', ')}` : 'resubmitted without changing business fields');
}
