import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { quoteSchoolFeePaymentPlan } from '../functions/lib/school-fee-payment-plans.js';
import { schoolFeeTotalItem } from '../functions/api/parent-dashboard.js';
import { allocateSchoolFeePayment, onRequestPost } from '../functions/api/init-payment.js';
import { normalizePublicPaymentMethod, withPaystackBranchRouting } from '../functions/lib/direct-bank-transfer.js';
import { enforceDesktopDeviceActionScope } from '../functions/api/backend.js';
import { SCHOOL_FEES_ADVANCE_CODE, SCHOOL_FEES_ADVANCE_TYPE, schoolFeeAdvanceItem } from '../functions/lib/school-fee-advance.js';
import { applyBillingCategoryOverrides, feeMatchesApplication } from '../functions/api/backend.js';
import { billingFeesWithPostedAmounts, selectBillingDiscount } from '../functions/lib/billing-category-discounts.js';
import { DEFAULT_BILLING_CATEGORIES } from '../functions/lib/billing-category-discounts.js';

const source = await readFile(new URL('../functions/api/init-payment.js', import.meta.url), 'utf8');
const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
const components = [
  { FeeCode: 'TUITION', FeeName: 'Tuition', FeeCategory: 'School Fee', OriginalAmount: 100000, Amount: 60000, PaidAmount: 40000, AllowInstallment: 'NO' },
  { FeeCode: 'BOOKS', FeeName: 'Books', FeeCategory: 'School Fee', OriginalAmount: 20000, Amount: 20000, AllowInstallment: 'NO' }
];
const makeRule = (changes = {}) => ({ Name: 'Regular', AcademicSession: 'All', Term: 'All', Mode: 'Fixed minimum', Value: 15000, policyVersion: 'version-1', ...changes });
function quote(rule, items = components) {
  return quoteSchoolFeePaymentPlan({ rule, components: items,
    originalTotal: items.reduce((sum, item) => sum + item.OriginalAmount, 0),
    balance: items.reduce((sum, item) => sum + item.Amount, 0) });
}

function checkout({ rule = makeRule(), paymentMethod = 'paystack', amount = 15000,
  feeCode = 'SCHOOL_FEES_TOTAL', items = components, replay = null, suppliedQuote = true, accountOverrides = {}, replayAfterCompletion = false } = {}) {
  const calls = { fees: [], intents: [], gateway: [], transfer: [], completed: [], failed: [] };
  const plan = quote(rule, items);
  const account = { AccountRef: 'DEMO/26/001', AdmissionNo: 'DEMO/26/001', BranchId: 'primary',
    SchoolSection: 'primary', AcademicSession: '2026/2027', Term: 'First Term', DisplayName: 'Demo Learner', ...accountOverrides };
  const body = { feeCode, amount, paymentMethod, accountRef: account.AccountRef, idempotencyKey: 'demo-plan-checkout',
    // These untrusted inputs must never change the server quote or authenticated branch.
    SchoolFeePaymentPlan: { minAmount: 1 }, branchId: 'main' };
  const handler = vm.runInNewContext(`${source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '')}\n;onRequestPost`, {
    Response, URL, Date, quoteSchoolFeePaymentPlan, normalizePublicPaymentMethod, withPaystackBranchRouting,
    SCHOOL_FEES_ADVANCE_CODE, SCHOOL_FEES_ADVANCE_TYPE, schoolFeeAdvanceItem,
    SCHOOL_FEES_TOTAL_CODE: 'SCHOOL_FEES_TOTAL', readJsonBody: request => request.json(),
    readParentSession: async () => ({ email: 'parent@example.org' }), verifyTurnstile: async () => {}, requireFirestoreEnv: () => {},
    getPayableFees: async (_env, input) => {
      calls.fees.push(input);
      return { ok: true, account, fees: items, schoolFeeBreakdown: items, ...(suppliedQuote ? { schoolFeePaymentPlan: plan } : {}) };
    },
    beginIdempotentRequest: async () => replay || (replayAfterCompletion && calls.completed.length)
      ? { replay: true, response: replay || calls.completed[0], status: 200 } : { owner: true },
    completeIdempotentRequest: async (_env, _claim, result) => calls.completed.push(result),
    failIdempotentRequest: async (_env, _claim, error) => calls.failed.push(error.message),
    getSchoolCode: async (_env, branch) => { assert.equal(branch, account.BranchId); return 'DEMO'; },
    branchPaymentConfiguration: async () => ({ online: { enabled: true }, paystack: {} }),
    createDocumentIfAbsent: async (_env, collection, id, document) => { calls.intents.push({ collection, id, document }); return { created: true }; },
    createDirectTransferRequest: async (_env, payload) => { calls.transfer.push(payload); return { ok: true, reference: payload.reference }; },
    fetch: async (url, input) => {
      assert.equal(url, 'https://api.paystack.co/transaction/initialize');
      calls.gateway.push(JSON.parse(input.body));
      return Response.json({ status: true, data: { authorization_url: 'https://checkout.example/demo', reference: calls.gateway.at(-1).reference } });
    }
  });
  return { calls, plan, async run() {
    const response = await handler({ env: { PAYSTACK_SECRET_KEY: 'test-only' }, request: new Request('https://school.example/api/init-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }) });
    return { response, data: await response.json() };
  } };
}

for (const paymentMethod of ['paystack', 'direct_bank_transfer']) {
  test(`${paymentMethod}: optional checkout works for every category and branch without duplicate intent on retry`,async()=>{
    for(const BillingCategory of [...DEFAULT_BILLING_CATEGORIES,'Community Bursary']){
      for(const BranchId of ['main','area-1-primary','the-lord-s-garden-primary']){
        const account={BillingCategory,BranchId,SchoolSection:BranchId==='main'?'secondary':'primary',ClassName:'Grade 3',Term:'First Term',AcademicSession:'2026/2027'};
        const rules=[{...account,BillingCategory:'All',FeeCode:'CLUB',FeeName:'Chess',FeeCategory:'Club',Amount:5000,AllowInstallment:'NO'},
          {...account,BillingCategory,FeeCode:'CLUB_RATE',FeeName:'Chess',FeeCategory:'Club',Amount:3000,AllowInstallment:'NO'},
          {...account,BillingCategory:'All',BranchId:'foreign',FeeCode:'FOREIGN',FeeName:'Other',FeeCategory:'Club',Amount:2000}];
        const items=applyBillingCategoryOverrides(rules.filter(row=>feeMatchesApplication(row,account)),account)
          .map(row=>({...row,OriginalAmount:row.Amount,PaidAmount:0}));
        assert.deepEqual(items.map(row=>row.FeeCode),['CLUB_RATE']);
        const f=checkout({paymentMethod,feeCode:'CLUB_RATE',amount:3000,items,accountOverrides:account,replayAfterCompletion:true});
        assert.equal((await f.run()).response.status,200);
        assert.equal((await f.run()).response.status,200);
        assert.equal(f.calls.intents.length,1);assert.equal(f.calls.intents[0].document.BranchId,BranchId);
        assert.equal(f.calls.intents[0].document.Amount,3000);
        assert.equal(f.calls.gateway.length+f.calls.transfer.length,1);
        const denied=checkout({paymentMethod,feeCode:'FOREIGN',amount:2000,items,accountOverrides:account});
        assert.equal((await denied.run()).response.status,400);assert.equal(denied.calls.intents.length,0);
      }
    }
  });

  test(`${paymentMethod}: Full Scholarship can buy an eligible optional item without compulsory fees`, async () => {
    const student = { BillingCategory: 'Full Scholarship', BranchId: 'primary', SchoolSection: 'primary',
      ClassName: 'Grade 3', AcademicSession: '2026/2027', Term: 'First Term' };
    const common = { BranchId: 'primary', SchoolSection: 'primary', ClassName: 'All', BillingCategory: 'All',
      StudentType: 'All', AcademicSession: 'All', Term: 'First Term', PayableOnline: 'YES', Active: 'YES' };
    const rules = [{ ...common, FeeCode: 'CLUB_CHESS', FeeName: 'Chess', FeeCategory: 'Club', Amount: 5000 },
      { ...common, FeeCode: 'TUITION', FeeName: 'Tuition', FeeCategory: 'School Fee', Amount: 100000 }];
    const items = applyBillingCategoryOverrides(rules.filter(row => feeMatchesApplication(row, student)), student)
      .map(row => ({ ...row, OriginalAmount: row.Amount, PaidAmount: 0, AllowInstallment: 'NO' }));
    assert.deepEqual(items.map(row => row.FeeCode), ['CLUB_CHESS']);
    const { run, calls } = checkout({ paymentMethod, feeCode: 'CLUB_CHESS', amount: 5000, items });
    const { response, data } = await run();
    assert.equal(response.status, 200, data.message);
    assert.equal(calls.intents.length, 1);
    assert.equal(calls.intents[0].document.Amount, 5000);
    assert.equal(calls.intents[0].document.FeeCode, 'CLUB_CHESS');
    assert.equal(calls.fees[0].IncludeSchoolFeePaymentPlan, false);
    const rejected = checkout({ paymentMethod, feeCode: 'TUITION', amount: 100000, items });
    assert.equal((await rejected.run()).response.status, 400);
    assert.equal(rejected.calls.intents.length, 0);
  });

  test(`${paymentMethod}: aggregate minimum allows partial total without relaxing individual fee rules`, async () => {
    const before = JSON.stringify(components);
    const { run, calls, plan } = checkout({ paymentMethod });
    const { response, data } = await run();
    assert.equal(response.status, 200, data.message);
    assert.equal(calls.fees[0].IncludeSchoolFeePaymentPlan, true);
    assert.equal(calls.intents.length, 1);
    assert.equal(calls.intents[0].collection, 'paymentIntents');
    assert.equal(calls.intents[0].document.Amount, 15000);
    assert.equal(calls.intents[0].document.BranchId, 'primary');
    assert.deepEqual(calls.intents[0].document.SchoolFeePaymentPlan, plan);
    const details = paymentMethod === 'paystack' ? calls.gateway[0].metadata : calls.transfer[0].payload;
    const allocations = details.feeItems || details.FeeItems;
    assert.equal(allocations.reduce((sum, row) => sum + row.Amount, 0), 15000);
    assert.equal(allocations.length, 1);
    assert.equal(allocations[0].FeeCode, 'TUITION');
    assert.deepEqual(details.schoolFeePaymentPlan || details.SchoolFeePaymentPlan, plan);
    assert.equal(JSON.stringify(components), before);
  });

  test(`${paymentMethod}: below minimum, overpayment and sub-cent inputs cannot create a payment intent`, async () => {
    for (const amount of [14999.99, 80000.01, 15000.001, -1, 0]) {
      const { run, calls } = checkout({ paymentMethod, amount });
      assert.equal((await run()).response.status, 400, `amount ${amount}`);
      assert.equal(calls.intents.length + calls.gateway.length + calls.transfer.length, 0);
    }
  });

  test(`${paymentMethod}: final remainder and early settlement are accepted`, async () => {
    for (const input of [{ amount: 80000 }, { amount: 2000, items: [
      { ...components[0], OriginalAmount: 120000, Amount: 2000, PaidAmount: 118000 }
    ] }]) {
      const { run, calls } = checkout({ paymentMethod, ...input });
      const { response, data } = await run();
      assert.equal(response.status, 200, data.message);
      assert.equal(calls.intents[0].document.Amount, input.amount);
    }
  });

  test(`${paymentMethod}: retry reuses accepted checkout without another intent, transfer or gateway request`, async () => {
    const replay = { ok: true, reference: 'DEMO-existing-payment' };
    const { run, calls } = checkout({ paymentMethod, replay });
    const { response, data } = await run();
    assert.equal(response.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(data, replay);
    assert.equal(calls.intents.length + calls.gateway.length + calls.transfer.length, 0);
  });
}

test('full-payment policy rejects a stale partial request rather than silently increasing the charge', async () => {
  const { run, calls } = checkout({ rule: makeRule({ Mode: 'Full payment' }), amount: 15000 });
  assert.equal((await run()).response.status, 400);
  assert.equal(calls.intents.length, 0);
});

test('full-payment checkout can omit the amount and uses the exact server balance', async () => {
  const { run, calls } = checkout({ rule: makeRule({ Mode: 'Full payment' }), amount: null });
  assert.equal((await run()).response.status, 200);
  assert.equal(calls.intents[0].document.Amount, 80000);
});

test('an accepted checkout replay is preserved after the minimum increases or the bill is fully settled', async () => {
  const replay = { ok: true, reference: 'DEMO-original-checkout' };
  for (const items of [components, components.map(item => ({ ...item, Amount: 0 }))]) {
    const { run, calls } = checkout({ rule: makeRule({ Value: 50000 }), amount: 15000, items, replay });
    const { response, data } = await run();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(data, replay);
    assert.equal(calls.intents.length + calls.gateway.length + calls.transfer.length, 0);
  }
});

test('existing per-item checkout remains available and does not load aggregate plan settings', async () => {
  const items = [{ ...components[0], AllowInstallment: 'YES', PartPaymentMode: 'Item', MinAmount: 1000 }];
  const { run, calls } = checkout({ feeCode: 'TUITION', amount: 1000, items, rule: makeRule({ Mode: 'Full payment' }) });
  assert.equal((await run()).response.status, 200);
  assert.equal(calls.fees[0].IncludeSchoolFeePaymentPlan, false);
  assert.equal(calls.intents[0].document.Amount, 1000);
  assert.equal(calls.intents[0].document.SchoolFeePaymentPlan, undefined);
});

test('legacy item total mode remains usable with no saved aggregate rule', async () => {
  const items = [{ ...components[0], AllowInstallment: 'YES', PartPaymentMode: 'Total', MinAmount: 1000 }, components[1]];
  const { run, calls } = checkout({ rule: null, amount: 1000, items, suppliedQuote: false });
  assert.equal((await run()).response.status, 200);
  assert.equal(calls.gateway[0].metadata.feeItems.reduce((sum, row) => sum + row.Amount, 0), 1000);
});

test('parent total uses the same immutable quote and keeps paid components in the installment base', () => {
  const items = [{ ...components[0], Amount: 0, PaidAmount: 100000 }, components[1]];
  const plan = quote(makeRule({ Mode: 'Equal installments', InstallmentCount: 3 }), items);
  const parent = schoolFeeTotalItem(items, plan);
  assert.equal(parent.OriginalAmount, 120000);
  assert.equal(parent.Amount, 20000);
  assert.equal(parent.PartPaymentMode, 'Total');
  assert.equal(parent.MinAmount || parent.Amount, plan.minAmount);
  assert.deepEqual(parent.SchoolFeePaymentPlan, plan);
  assert.equal(parent.Components.length, 2);
});

for (const paymentMethod of ['paystack', 'direct_bank_transfer']) {
  test(`${paymentMethod}: discounts precede total plans and confirmed credits reduce the next installment`, async () => {
    const account = { BranchId: 'primary', SchoolSection: 'primary', ClassName: 'Grade 3',
      AcademicSession: '2026/2027', Term: 'First Term', StudentType: 'Day Student', BillingCategory: 'Sibling Discount' };
    const baseFees = [
      { ...account, FeeCode: 'TUITION', FeeName: 'Tuition', FeeCategory: 'School Fee', BillingCategory: 'All', Amount: 80000 },
      { ...account, FeeCode: 'BOOKS', FeeName: 'Books', FeeCategory: 'School Fee', BillingCategory: 'All', Amount: 20000 }
    ];
    const before = JSON.stringify(baseFees);
    for (const [DiscountType, DiscountValue] of [['Percentage', 10], ['Fixed amount', 10000]]) {
      const policy = { Name: account.BillingCategory, BranchId: 'primary', DiscountType: 'None', DiscountValue: 0,
        Rates: [{ RateId: 'grade3-first', DiscountType, DiscountValue, ClassScope: 'Selected', ClassNames: ['Grade 3'],
          TermScope: 'Selected', TermNames: ['First Term'] }], recordVersion: 'discount-v1' };
      const pupil = { ...account, BillingDiscount: selectBillingDiscount([policy], account) };
      const discounted = applyBillingCategoryOverrides(baseFees.filter(fee => feeMatchesApplication(fee, pupil)), pupil);
      assert.deepEqual(discounted.map(fee => fee.Amount), [72000, 18000]);
      for (const [details, expectedMinimum] of [
        [{ Mode: 'Percentage', Value: 25, PercentageBasis: 'Total school fees' }, 22500],
        [{ Mode: 'Percentage', Value: 25, PercentageBasis: 'Outstanding balance' }, 13750],
        [{ Mode: 'Fixed minimum', Value: 20000 }, 20000],
        [{ Mode: 'Equal installments', InstallmentCount: 3 }, 25000],
        [{ Mode: 'Full payment' }, 55000]
      ]) {
        const items = discounted.map((fee, index) => ({ ...fee, OriginalAmount: fee.Amount,
          PaidAmount: index === 0 ? 35000 : 0, Amount: fee.Amount - (index === 0 ? 35000 : 0), AllowInstallment: 'NO' }));
        const harness = checkout({ paymentMethod, rule: makeRule(details), items, amount: expectedMinimum });
        assert.equal(harness.plan.originalTotal, 90000);
        assert.equal(harness.plan.total, 55000);
        assert.equal(harness.plan.minAmount, expectedMinimum);
        const parent = schoolFeeTotalItem(items, harness.plan);
        assert.equal(parent.MinAmount || parent.Amount, expectedMinimum);
        const { response, data } = await harness.run();
        assert.equal(response.status, 200, data.message);
        assert.equal(harness.calls.intents.length, 1);
        assert.equal(harness.calls.intents[0].document.Amount, expectedMinimum);
        const underpayment = checkout({ paymentMethod, rule: makeRule(details), items, amount: expectedMinimum - 0.01 });
        assert.equal((await underpayment.run()).response.status, 400);
        assert.equal(underpayment.calls.intents.length, 0);
      }
      // Saved bills remain the payment basis when a later discount is configured.
      const posted = baseFees.map(fee => ({ ...fee, InvoiceId: fee.FeeCode, Debit: fee.Amount, Credit: 0, Status: 'Unpaid' }));
      const retained = billingFeesWithPostedAmounts(discounted, pupil, posted);
      assert.equal(retained.reduce((sum, fee) => sum + fee.Amount, 0), 100000);
      assert.equal(quote(makeRule({ Mode: 'Percentage', Value: 25 }), retained.map(fee => ({ ...fee, OriginalAmount: fee.Amount }))).minAmount, 25000);
    }
    assert.equal(JSON.stringify(baseFees), before);
  });
}

test('aggregate allocations stop at the exact received amount without inventing credits', () => {
  for (const amount of [0.01, 15000, 60000.01, 80000]) {
    const rows = allocateSchoolFeePayment(components, amount, true);
    assert.equal(Math.round(rows.reduce((sum, row) => sum + row.Amount, 0) * 100), Math.round(amount * 100));
    assert.ok(rows.every(row => row.Amount > 0 && row.Amount <= row.OriginalAmount));
  }
});

test('desktop plan actions require a verified actor and are explicitly supported by paired devices', () => {
  assert.equal(typeof onRequestPost, 'function');
  for (const action of ['getPartPaymentSettings', 'savePartPaymentSettings']) {
    assert.match(backend.slice(backend.indexOf('const VERIFIED_ACTOR_ACTIONS'), backend.indexOf('const BRANCH_BOUND_DEVICE_ACTIONS')), new RegExp(`'${action}'`));
    const input = { BranchId: 'primary' };
    assert.equal(enforceDesktopDeviceActionScope({ type: 'device', branchId: 'primary' }, action, input), input);
  }
  assert.match(backend, /desktopSchoolOperationsActor\(env, body, 'accounts', action === 'savePartPaymentSettings'\)/);
});
