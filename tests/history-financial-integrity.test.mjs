import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { historyDateRange, loadDatedHistory } from '../functions/lib/history-date-range.js';
import { enforceActorBranch } from '../functions/lib/branch-scope.js';

function load(file, context) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/^export /gm, '');
  vm.createContext(context); vm.runInContext(source, context, { filename: file }); return context;
}
const matches = (row, filters) => filters.every(({field, op, value}) => op === 'in' ? value.includes(row[field])
  : op === '>=' ? row[field] >= value : op === '<=' ? row[field] <= value : row[field] === value);

test('payroll requires dates, queries only own months, retains YTD and cannot download another staff payslip', async () => {
  const items = [
    { ItemId: 'jan', RunId: 'r1', Username: 'clerk', Month: '2026-01', GrossPay: 100, FinalPaye: 5 },
    { ItemId: 'oct', RunId: 'r2', Username: 'clerk', Month: '2026-10', GrossPay: 200, FinalPaye: 10 },
    { ItemId: 'other', RunId: 'r2', Username: 'other', Month: '2026-10', GrossPay: 999 },
    { ItemId: 'future', RunId: 'r3', Username: 'clerk', Month: '2026-11', GrossPay: 300 },
    { ItemId: 'draft', RunId: 'r4', Username: 'clerk', Month: '2026-10', GrossPay: 500 }
  ];
  const before = structuredClone(items); const calls = [], runs = [];
  const api = load('functions/api/staff-payroll.js', {
    historyDateRange, Response, URL, TextEncoder, requireFirestoreEnv() {},
    requireStaffSession: async () => ({ username: 'clerk' }),
    queryCollectionPages: async (_env, collection, options) => {
      calls.push({collection, options}); return items.filter(row => matches(row, options.filters));
    },
    getDocument: async (_env, collection, id) => {
      assert.equal(collection, 'payrollRuns'); runs.push(id);
      return {RunId: id, Status: id === 'r4' ? 'Draft' : 'Paid'};
    }
  });
  const request = query => api.onRequestGet({env: {}, request: new Request(`https://test.invalid/api/staff-payroll?${query}`)});
  assert.equal((await request('')).status, 400); assert.equal(calls.length, 0);
  const dates = 'fromDate=2026-10-01&toDate=2026-10-25';
  const result = await (await request(dates)).json();
  assert.equal(result.items.length, 1); assert.equal(result.items[0].ItemId, 'oct');
  assert.equal(result.items[0].YtdGross, 300); assert.equal(result.items[0].YtdPaye, 15);
  assert.deepEqual(runs.sort(), ['r1', 'r2', 'r4']);
  assert.equal(calls[0].options.filters[0].field, 'Username');
  assert.equal(calls[0].options.filters[0].value, 'clerk');
  assert.equal((await request(`${dates}&action=payslip&itemId=other`)).status, 404);
  assert.equal((await request(`${dates}&action=payslip&itemId=oct`)).headers.get('Content-Type'), 'application/pdf');
  assert.deepEqual(items, before);
});

for (const edition of ['faith', 'organization']) test(`${edition} hotel dates bound history without truncating linked balances or changing any records`, async () => {
  const records = {
    hotelRooms: [{RoomId:'room', BranchId:'main', RoomNumber:'1', Status:'Available'}],
    hotelReservations: [{ReservationId:'stay', BranchId:'main', CreatedAt:'2026-10-24T10:00:00Z', ArrivalDate:'2026-10-24', DepartureDate:'2026-10-25', NightlyRate:1000},
      {ReservationId:'old', BranchId:'main', CreatedAt:'2026-09-01'}, {ReservationId:'elsewhere', BranchId:'east', CreatedAt:'2026-10-24'}],
    hotelCharges: [{ReservationId:'stay', BranchId:'main', Amount:200, CreatedAt:'2026-09-01'}],
    hotelPayments: [{ReservationId:'stay', BranchId:'main', Amount:300, CreatedAt:'2026-09-01'},
      {ReservationId:'stay', BranchId:'main', Amount:500, CreatedAt:'2026-11-01'},
      {ReservationId:'elsewhere', BranchId:'east', Amount:999, CreatedAt:'2026-10-24'}]
  };
  const before = structuredClone(records), queries = [];
  const query = async (_env, collection, options = {}) => {
    queries.push({collection, options});
    return structuredClone((records[collection] || []).filter(row => matches(row, options.filters || [])));
  };
  const db = {queryCollectionPages: query, listBranchCollection: (env, c, b, options) => query(env,c,{...options,filters:[...(options?.filters || []),{field:'BranchId',op:'==',value:b}]})};
  const api = load('functions/lib/hotel-services.js', {
    enforceActorBranch, getDocument: async () => null,
    resolveOrganizationConfig: () => ({Edition:edition, FeatureFlags:{hotel:true}}), normalizeOrganizationEdition: value => value,
    queryCollection: query, queryCollectionPages: query,
    loadDatedHistory: (env,c,body,field,b) => loadDatedHistory(env,c,body,field,b,db),
    hotelSelfServiceData: async () => ({})
  });
  const user = {role:'Super Admin', username:'admin', branchId:'main'};
  const unopened = await api.listHotelServices({}, user, {HistoryDateRange:{}});
  assert.equal(unopened.rooms.length,1); assert.equal(unopened.reservations.length,0);
  assert.deepEqual(queries.map(x => x.collection), ['hotelRooms']); queries.length=0;
  const result = await api.listHotelServices({}, user, {HistoryDateRange:{fromDate:'2026-10-23',toDate:'2026-10-25'}});
  assert.equal(result.reservations.length,1); assert.equal(result.reservations[0].ReservationId,'stay');
  assert.equal(result.reservations[0].TotalAmount,1200); assert.equal(result.reservations[0].AmountPaid,800);
  assert.equal(result.reservations[0].Balance,400);
  for (const c of ['hotelPayments','hotelCharges']) {
    assert.equal(queries.find(x=>x.collection===c).options.filters[0].field,'ReservationId');
  }
  assert.deepEqual(records,before);
});
