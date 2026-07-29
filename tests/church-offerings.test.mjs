import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeChurchOffering,
  normalizeDenominations,
  normalizeOfferingApprovalRoute,
  normalizeOfferingApprovalRouteForSave,
  resolveOfferingApprovalRoute,
  isRoleAllowedForRoute,
  offeringCapabilities,
  offeringDuplicate,
  offeringSummary,
  validateOfferingForReconciliation
} from '../functions/lib/church-offerings.js';

test('offering roles separate capture, reconciliation, and read-only audit access', () => {
  assert.equal(offeringCapabilities({ role: 'Church Administrator' }).canCapture, true);
  assert.equal(offeringCapabilities({ role: 'Church Administrator' }).canReconcile, false);
  assert.equal(offeringCapabilities({ role: 'Treasurer' }).canReconcile, true);
  assert.equal(offeringCapabilities({ role: 'Church Administrator' }).canManageApprovalRoutes, true);
  assert.equal(offeringCapabilities({ role: 'Treasurer' }).canManageApprovalRoutes, true);
  assert.equal(offeringCapabilities({ role: 'Pastor' }).canManageApprovalRoutes, false);
  assert.equal(offeringCapabilities({ role: 'Pastor' }).canView, true);
  assert.equal(offeringCapabilities({ role: 'Auditor' }).canCapture, false);
  assert.equal(offeringCapabilities({ role: 'Membership Officer' }).canView, false);
});

test('denomination input supports value x quantity and rejects ambiguous duplicates', () => {
  assert.deepEqual(normalizeDenominations('1000x10, 500x4'), [
    { Denomination: 1000, Quantity: 10, Amount: 10000 },
    { Denomination: 500, Quantity: 4, Amount: 2000 }
  ]);
  assert.throws(() => normalizeDenominations('1000x2,1000x3'), /more than once/);
  assert.throws(() => normalizeDenominations('1000x1.5'), /whole numbers/);
});

test('offering batches reconcile payment components against counted cash', () => {
  const offering = normalizeChurchOffering({
    OfferingId: 'OFF-001',
    BatchReference: 'SUN-AM-20260726',
    Date: '2026-07-26',
    FundId: 'GENERAL',
    CashAmount: 12000,
    TransferAmount: 3000,
    DenominationBreakdown: '1000x10,500x4'
  }, 'Lagos');
  assert.equal(offering.BranchId, 'lagos');
  assert.equal(offering.TotalAmount, 15000);
  assert.equal(offering.DenominationTotal, 12000);
  assert.equal(offering.ReconciliationDifference, 0);
  assert.equal(offering.Status, 'Draft');
});

test('offering totals and dates are validated before persistence', () => {
  assert.throws(() => normalizeChurchOffering({
    OfferingId: 'OFF-1', BatchReference: 'B-1', Date: '26/07/2026',
    FundId: 'GENERAL', CashAmount: 100
  }), /YYYY-MM-DD/);
  assert.throws(() => normalizeChurchOffering({
    OfferingId: 'OFF-1', BatchReference: 'B-1', Date: '2026-07-26',
    FundId: 'GENERAL', CashAmount: 100, TotalAmount: 200
  }), /components total/);
});

test('duplicate controls cover batch and external references while allowing edits', () => {
  const existing = [
    { OfferingId: 'OFF-001', BatchReference: 'SUN-AM-1', ExternalReference: 'BANK-1' }
  ];
  assert.equal(
    offeringDuplicate(existing, { OfferingId: 'OFF-002', BatchReference: 'sun-am-1' }).OfferingId,
    'OFF-001'
  );
  assert.equal(
    offeringDuplicate(existing, { OfferingId: 'OFF-002', BatchReference: 'OTHER', ExternalReference: 'bank-1' }).OfferingId,
    'OFF-001'
  );
  assert.equal(
    offeringDuplicate(existing, { OfferingId: 'OFF-001', BatchReference: 'SUN-AM-1' }, 'OFF-001'),
    null
  );
});

test('offering summary keeps cash and non-cash totals separate', () => {
  assert.deepEqual(offeringSummary([
    { Status: 'Draft', TotalAmount: 15000, CashAmount: 12000 },
    { Status: 'Reconciled', TotalAmount: 8000, CashAmount: 0, ApprovalStatus: 'Approved', AccountingStatus: 'Posted' }
  ]), {
    count: 2, total: 23000, cash: 12000, nonCash: 11000, draft: 1,
    reconciled: 1, pendingApproval: 0, approved: 1, posted: 1,
    byType: { Offering: 23000 }
  });
});

test('offering summary separates giving sources', () => {
  const summary = offeringSummary([
    { GivingTypeName: 'Offering', TotalAmount: 12000, CashAmount: 12000 },
    { GivingTypeName: 'Tithe', TotalAmount: 8000, CashAmount: 0 }
  ]);
  assert.deepEqual(summary.byType, { Offering: 12000, Tithe: 8000 });
});

test('offering approval route resolution prefers fund-specific active route and defaults by sort', () => {
  const routes = [
    { RouteId: 'GENERAL-FUND', FundId: 'GENERAL', ApprovalRoles: 'Pastor', PostingRoles: 'Treasurer', SortOrder: 10 },
    { RouteId: 'FALLBACK', FundId: '', ApprovalRoles: 'Treasurer', PostingRoles: 'Super Admin', SortOrder: 20 }
  ];
  const specific = resolveOfferingApprovalRoute(routes, { FundId: 'general' });
  assert.equal(specific.RouteId, 'GENERAL-FUND');
  assert.equal(specific.Active, 'YES');
  const normalized = normalizeOfferingApprovalRoute({ FundId: 'general', ApprovalRoles: 'Pastor, Treasurer' }, 'main');
  assert.equal(normalized.BranchId, 'main');
  assert.equal(normalized.RouteId, 'ROUTE-1');
  const fallback = resolveOfferingApprovalRoute([{ RouteId: 'Z', FundId: '', SortOrder: 5 }], { FundId: 'CHURCH' });
  assert.equal(fallback.RouteId, 'Z');
});

test('route save normalization requires both approval and posting role lists', () => {
  const normalized = normalizeOfferingApprovalRouteForSave({
    RouteId: 'CHURCH-DEFAULT',
    FundId: 'GENERAL',
    Description: 'Default Route',
    ApprovalRoles: 'Pastor, Treasurer',
    PostingRoles: ['Super Admin', 'Treasurer'],
    SortOrder: '10'
  }, 'main');
  assert.equal(normalized.RouteId, 'CHURCH-DEFAULT');
  assert.equal(normalized.ApprovalRoles.length, 2);
  assert.equal(normalized.PostingRoles.length, 2);
  assert.equal(normalized.SortOrder, 10);
  assert.throws(() => normalizeOfferingApprovalRouteForSave({
    RouteId: 'BROKEN',
    FundId: 'GENERAL',
    ApprovalRoles: [],
    PostingRoles: 'Treasurer'
  }), /approval role/);
  assert.throws(() => normalizeOfferingApprovalRouteForSave({
    RouteId: 'BROKEN2',
    FundId: 'GENERAL',
    PostingRoles: [],
    ApprovalRoles: 'Treasurer'
  }), /posting role/);
});

test('offering route role checks support approval and posting role lists', () => {
  const row = normalizeOfferingApprovalRoute({
    RouteId: 'ROUTE-1',
    FundId: 'general',
    ApprovalRoles: 'Pastor, Church Administrator',
    PostingRoles: 'Treasurer; Super Admin'
  }, 'main');
  assert.equal(isRoleAllowedForRoute(row, 'pastor', 'approval'), true);
  assert.equal(isRoleAllowedForRoute(row, 'treasurer', 'approval'), false);
  assert.equal(isRoleAllowedForRoute(row, 'super admin', 'post'), true);
  assert.equal(isRoleAllowedForRoute(row, 'member', 'post'), false);
});

test('reconciliation requires a balanced cash count and independent witness', () => {
  assert.equal(validateOfferingForReconciliation({
    CashAmount: 12000,
    Denominations: [{ Denomination: 1000, Quantity: 12, Amount: 12000 }],
    ReconciliationDifference: 0,
    CountedBy: 'Counter One',
    WitnessedBy: 'Witness Two'
  }), true);
  assert.throws(() => validateOfferingForReconciliation({
    CashAmount: 1000, Denominations: [], ReconciliationDifference: 1000,
    CountedBy: 'A', WitnessedBy: 'B'
  }), /denomination count/);
  assert.throws(() => validateOfferingForReconciliation({
    CashAmount: 0, Denominations: [], ReconciliationDifference: 0,
    CountedBy: 'Same Person', WitnessedBy: 'same person'
  }), /different people/);
});
