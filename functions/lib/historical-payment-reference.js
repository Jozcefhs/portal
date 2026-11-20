import { canonicalSchoolBranchId, schoolSectionFor } from './school-scope.js';

const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const conflict = () => Object.assign(new Error('Reference already belongs to a different payment in this branch or payment channel.'), { status: 409 });

export async function historicalPaymentReference(reference, student) {
  const identity = JSON.stringify([canonicalSchoolBranchId(student.BranchId || 'main'), schoolSectionFor(student), key(reference)]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
  return `HIST-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

// Local receipt numbers may repeat between branches. Gateway references remain
// global; a provider payment must never be duplicated into another branch.
export async function resolveHistoricalPaymentReference(row, student, find, matches) {
  const scopedReference = await historicalPaymentReference(row.Reference, student);
  const scoped = await find(scopedReference, { canonicalOnly: true, strictReads: true });
  const legacy = await find(row.Reference, { strictReads: true });
  const sameScope = payment => canonicalSchoolBranchId(payment.BranchId || 'main') === canonicalSchoolBranchId(student.BranchId || 'main')
    && (!clean(payment.SchoolSection) || schoolSectionFor(payment) === schoolSectionFor(student));
  if (scoped && (!sameScope(scoped) || !matches(scoped))) throw conflict();
  if (legacy) {
    if (sameScope(legacy)) {
      if (!matches(legacy) || (scoped && clean(scoped.__id || scoped.Reference) !== clean(legacy.__id || legacy.Reference))) throw conflict();
      return { reference: clean(legacy.Reference) || row.Reference, existing: legacy };
    }
    if (clean(legacy.Channel).toLowerCase() !== 'historical payment import'
        || clean(legacy.Gateway).toLowerCase() !== 'manual') throw conflict();
  }
  return { reference: scopedReference, existing: scoped };
}
