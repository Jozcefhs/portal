const clean = (value) => String(value ?? '').trim();

// Only business fields are compared. Never archive passwords, approval proofs or client-supplied actors.
const EDIT_FIELDS = Object.freeze({
  Date: 'Required date', Vendor: 'Vendor', Description: 'Description', Amount: 'Amount',
  MaterialItems: 'Material items', ExpenseAccount: 'Expense account', PaymentAccount: 'Payment account',
  Department: 'Department', CostCentre: 'Cost centre', BudgetCode: 'Budget code',
  PaymentMethod: 'Payment method', Reference: 'Reference', AttachmentUrl: 'Attachment', Notes: 'Notes'
});

export function requisitionChangedFields(before = {}, after = {}) {
  return Object.entries(EDIT_FIELDS).filter(([key]) => {
    if (key === 'MaterialItems') return JSON.stringify(before[key] || []) !== JSON.stringify(after[key] || []);
    if (key === 'Amount') return Number(before[key] || 0) !== Number(after[key] || 0);
    return clean(before[key]) !== clean(after[key]);
  }).map(([, label]) => label);
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
