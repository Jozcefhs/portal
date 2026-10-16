import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { clubMemberReceipts, getClubMembersPage } from '../functions/lib/club-members.js';

const user = { username: 'finance', assignedRole: 'Accounts Officer', allowedSections: ['accounts'], branchId: 'main', schoolSectionAccess: 'All', edition: 'school' };
const scope = { branchId: 'main', schoolSection: 'all', edition: 'school', academicSession: '', term: '' };
const payment = { __id: 'p1', BranchId: 'main', SchoolSection: 'secondary', AccountRef: 'ST/001', AdmissionNo: 'ST/001',
  DisplayName: 'Ada Test', ClassName: 'Grade 10', FeeCode: 'CLUB_CHESS', FeeName: 'Chess', FeeCategory: 'Club',
  AcademicSession: '2026/2027', Term: 'First Term', Amount: 10000, Status: 'Paid', ProcessingStatus: 'Completed', PaidAt: '2026-10-15' };
const context = vm.createContext({ Intl, Map, Set, JSON });
vm.runInContext(readFileSync(new URL('../js/club-members.js', import.meta.url), 'utf8'), context);
const ui = context.DynamaxClubMembers;

test('only confirmed, positive, in-scope club receipts are members', () => {
  const result = clubMemberReceipts([payment, { ...payment, Status: 'Pending' }, { ...payment, ProcessingStatus: 'Processing' },
    { ...payment, CorrectionTotal: 10000 }, { ...payment, Amount: 0 }, { ...payment, BranchId: 'other' },
    { ...payment, FeeCode: 'TUITION', FeeCategory: 'School Fee' }, { ...payment, CorrectionTotal: 4000 }], scope);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows.map(row => [row.paidCents, row.currency]), [[1000000, 'NGN'], [600000, 'NGN']]);
  assert.equal(result.warnings.unfinished, 2);
  assert.equal(clubMemberReceipts([payment], { ...scope, schoolSection: 'primary' }).rows.length, 0);
  assert.equal(clubMemberReceipts([{ ...payment, SchoolSection: '' }], { ...scope, schoolSection: 'secondary' }).rows.length, 0);
});
test('catalogue recognizes custom legacy codes only within the same branch', () => {
  const receipt = { ...payment, FeeCode: 'CUSTOM', FeeCategory: '' };
  const fee = { FeeCode: 'CUSTOM', FeeCategory: 'Club', FeeName: 'Chess', BranchId: 'other' };
  assert.equal(clubMemberReceipts([receipt], scope, [fee]).rows.length, 0);
  assert.equal(clubMemberReceipts([receipt], scope, [{ ...fee, BranchId: 'main' }]).rows.length, 1);
});
test('legacy paid imports supported; missing periods never inferred and missing identities excluded', () => {
  const result = clubMemberReceipts([{ ...payment, Status: undefined, ProcessingStatus: undefined, AcademicSession: '', Term: '' },
    { ...payment, AccountRef: '', AdmissionNo: '' }], scope);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].session, '');
  assert.equal(result.warnings.missingPeriod, 1);
  assert.equal(result.warnings.missingIdentity, 1);
  assert.equal(clubMemberReceipts([payment], { ...scope, term: 'Second Term' }).rows.length, 0);
});
test('invalid receipt corrections fail closed', () => {
  for (const change of [{ Amount: 'bad' }, { Amount: Infinity }, { Amount: 90071992547410 }, { Amount: -1 },
    { CorrectionTotal: -1 }, { CorrectionTotal: 11000 }, { Currency: '<script>' }]) {
    assert.throws(() => clubMemberReceipts([{ ...payment, ...change }], scope), error => error.status === 409);
  }
});
test('authentication, roles, modules, branch, section and edition enforced before reads', async () => {
  const io = { list: () => { throw Error('Must not read'); }, query: () => { throw Error('Must not read'); } };
  for (const actor of [{ ...user, username: '' }, { ...user, assignedRole: 'Teacher' }, { ...user, allowedSections: [] },
    { ...user, edition: 'faith' }, { ...user, schoolSectionAccess: 'unknown' }]) {
    await assert.rejects(getClubMembersPage({}, actor, {}, io), error => error.status === 403);
  }
  await assert.rejects(getClubMembersPage({}, user, { branchId: 'other' }, io), error => error.status === 403);
  await assert.rejects(getClubMembersPage({}, user, { pageToken: 'p2' }, io), /snapshot/);
  await assert.rejects(getClubMembersPage({}, user, { readTime: '2020-01-01T00:00:00.000Z' }, io), /snapshot/);
});
test('all pages share a snapshot, duplicate payments become one membership, filters and print agree', async () => {
  const calls = [];
  const io = { list: async (_env, collection, options) => {
    calls.push(options);
    return options.pageToken ? { documents: [{ ...payment, __id: 'p2' }, { ...payment, __id: 'p3', Term: 'Second Term' }], nextPageToken: '' }
      : { documents: [payment], nextPageToken: 'p2' };
  }, query: async () => [] };
  const report = await ui.loadReport(body => getClubMembersPage({}, user, body, io));
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.query === `readTime=${encodeURIComponent(report.readTime)}`));
  assert.equal(report.rows.length, 2);
  const rows = ui.filterRows(report, { club: 'Chess', term: 'First Term' });
  assert.equal(rows.length, 1); assert.equal(rows[0].receipts, 2);
  assert.equal(rows[0].paidTotals[0].paidCents, 2000000);
  assert.equal(ui.totalAmounts(report.rows)[0].paidCents, 3000000);
  const html = ui.printHtml(report, { club: 'Chess', term: 'First Term' });
  assert.match(html, /Ada Test/); assert.match(html, /1 membership/);
  assert.match(html, /Amount paid/); assert.match(html, /Total amount · NGN/);
  assert.equal((html.match(/₦20,000\.00/g) || []).length, 2);
  assert.doesNotMatch(html, /₦30,000\.00/);
  assert.doesNotMatch(html, /<td>Second Term/);
  assert.doesNotMatch(JSON.stringify(report), /ParentEmail|GatewayReference|CorrectionTotal/);
});
test('branch reads use scoped queries, never broad reads for another branch', async () => {
  let queried = false;
  const page = await getClubMembersPage({}, { ...user, branchId: 'annex' }, {}, {
    list: () => { throw Error('Broad read forbidden'); }, query: async (_env, collection, options) => {
      queried = true; assert.equal(collection, 'payments'); assert.ok(JSON.stringify(options.filters).includes('annex'));
      return [{ ...payment, BranchId: 'annex' }];
    }
  });
  assert.ok(queried); assert.equal(page.rows.length, 1);
});
test('incomplete/repeating/changed-scope responses cannot produce printable partial registers', async () => {
  const page = { ok: true, rows: clubMemberReceipts([payment], scope).rows, scope, readTime: new Date().toISOString(), scanned: 1, complete: false, next: { pageToken: 'p2' } };
  await assert.rejects(ui.loadReport(async () => page), /repeated/);
  let index = 0;
  await assert.rejects(ui.loadReport(async () => index++ ? { ...page, rows: [], scope: { ...scope, branchId: 'other' } } : page), /scope/);
  await assert.rejects(ui.loadReport(async () => ({ ok: true })), /Incomplete/);
});
test('print safely escapes stored names and preserves school section separation', () => {
  const receipts = clubMemberReceipts([payment, { ...payment, __id: 'p2', SchoolSection: 'primary', DisplayName: '<script>alert(1)</script>' }], scope).rows;
  const rows = ui.members(receipts);
  assert.equal(rows.length, 2);
  const output = ui.printHtml({ rows, scope, readTime: 'now', warnings: {} });
  assert.match(output, /&lt;script&gt;/); assert.doesNotMatch(output, /<script>alert/);
});
test('web and desktop routes and assets are wired with authoritative actor checks', () => {
  const backend = readFileSync(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.match(backend, /VERIFIED_ACTOR_ACTIONS = new Set\(\[[^\]]*'getClubMembers'/);
  assert.match(backend, /BRANCH_BOUND_DEVICE_ACTIONS = new Set\(\[[^\]]*'getClubMembers'/);
  const endpoint = readFileSync(new URL('../functions/api/club-members.js', import.meta.url), 'utf8');
  assert.match(endpoint, /requireStaffSession/); assert.match(endpoint, /no-store/);
  assert.match(readFileSync(new URL('../admin.html', import.meta.url), 'utf8'), /js\/club-members.js/);
});

test('amounts are receipt-based, net of corrections, and do not mutate source records', () => {
  const records = [payment, { ...payment, __id: 'p2', Amount: '1,234.56', CorrectionTotal: '234.45', Currency: 'ngn', PaidAt: '2026-10-16' },
    { ...payment, __id: 'p3', Amount: 0.2 }, { ...payment, __id: 'p4', Amount: 0.1 },
    { ...payment, __id: 'reversed', CorrectionTotal: 10000 }, { ...payment, __id: 'pending', Status: 'Pending' }];
  const before = structuredClone(records);
  const receipts = clubMemberReceipts(records, scope, [{ FeeCode: 'CLUB_CHESS', FeeCategory: 'Club', Amount: 999999 }]).rows;
  const rows = ui.members(receipts);
  assert.equal(rows.length, 1); assert.equal(rows[0].receipts, 4);
  assert.equal(rows[0].paidAt, '2026-10-16');
  assert.equal(rows[0].paidTotals[0].paidCents, 1100041);
  assert.match(ui.printHtml({ rows, scope, readTime: 'now', warnings: {} }), /₦11,000\.41/);
  assert.deepEqual(records, before);
});

test('currencies stay separate for the same member and for filtered register totals', () => {
  const documents = [payment, { ...payment, __id: 'usd', Amount: 25.5, Currency: 'USD' },
    { ...payment, __id: 'chess2', AdmissionNo: 'ST/002', Amount: 5000 },
    { ...payment, __id: 'robotics', FeeCode: 'CLUB_AI', FeeName: 'AI & Robotics', Amount: 9000 },
    { ...payment, __id: 'term2', Term: 'Second Term', Amount: 6000 },
    { ...payment, __id: 'session2', AcademicSession: '2027/2028', Amount: 7000 }];
  const report = { rows: ui.members(clubMemberReceipts(documents, scope).rows), scope, readTime: 'now', warnings: {} };
  const filters = { club: 'Chess', session: '2026/2027', term: 'First Term' };
  const filtered = ui.filterRows(report, filters);
  assert.equal(filtered.length, 2);
  assert.equal(filtered.find(row => row.student === 'ST/001').paidTotals.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.totalAmounts(filtered))), [{ currency: 'NGN', paidCents: 1500000 }, { currency: 'USD', paidCents: 2550 }]);
  const html = ui.printHtml(report, filters);
  const footer = html.match(/<tfoot>(.*?)<\/tfoot>/s)[1];
  assert.match(footer, /Total amount · NGN/); assert.match(footer, /₦15,000\.00/);
  assert.match(footer, /Total amount · USD/); assert.match(footer, /25\.50/);
  assert.doesNotMatch(footer, /15,025|₦37,000/);
  assert.match(html, /class="fee-summary-number">Amount paid/);
  assert.match(html, /tfoot\{display:table-row-group/);
});

test('empty filters report zero, not the unfiltered total', () => {
  const report = { rows: ui.members(clubMemberReceipts([payment], scope).rows), scope, readTime: 'now', warnings: {} };
  const html = ui.printHtml(report, { club: 'Unknown club' });
  assert.match(html, /colspan="10">No confirmed club members/);
  assert.match(html, /Total amount<\/td><td class="fee-summary-number">0\.00/);
  assert.doesNotMatch(html, /10,000/);
});

test('missing amounts, unsafe totals and repeated receipt IDs cannot produce a complete report', async () => {
  const receipt = clubMemberReceipts([payment], scope).rows[0];
  const page = rows => ({ ok: true, rows, scope, readTime: new Date().toISOString(), complete: true, next: null });
  for (const change of [{ paidCents: undefined }, { paidCents: '1000000' }, { paidCents: -1 }, { paidCents: 0 },
    { paidCents: 1.5 }, { currency: undefined }, { currency: 'invalid' }]) {
    await assert.rejects(ui.loadReport(async () => page([{ ...receipt, ...change }])), /amount is missing or invalid/);
  }
  await assert.rejects(ui.loadReport(async () => page([receipt, receipt])), /identity is missing or repeated/);
  for (const student of [receipt.student, 'ST/002']) {
    await assert.rejects(ui.loadReport(async () => page([
      { ...receipt, paidCents: Number.MAX_SAFE_INTEGER }, { ...receipt, id: 'p2', student, paidCents: 1 }
    ])), /safe reporting range/);
  }
});

test('complete multi-page totals include every receipt, not just a recent subset', async () => {
  const documents = Array.from({ length: 601 }, (_, index) => ({ ...payment, __id: `p${index}`, AdmissionNo: `ST/${index % 30}`, Amount: 0.1 }));
  let requests = 0;
  const report = await ui.loadReport(body => getClubMembersPage({}, user, body, {
    list: async (_env, _collection, options) => {
      requests++;
      const offset = Number(options.pageToken || 0);
      return { documents: documents.slice(offset, offset + 250), nextPageToken: offset + 250 < documents.length ? String(offset + 250) : '' };
    }, query: async () => []
  }));
  assert.equal(requests, 3); assert.equal(report.rows.length, 30);
  assert.equal(report.rows.reduce((count, row) => count + row.receipts, 0), 601);
  assert.equal(ui.totalAmounts(report.rows)[0].paidCents, 6010);
  assert.match(ui.printHtml(report), /₦60\.10/);
});
