import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { paymentPlanExample } from '../js/school-fee-payment-plans.js';
import { quoteSchoolFeePaymentPlan } from '../functions/lib/school-fee-payment-plans.js';
const payments=await readFile(new URL('../js/payments.js',import.meta.url),'utf8');
const parent=await readFile(new URL('../js/parent-dashboard.js',import.meta.url),'utf8');
const fn=(source,name)=>source.match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
const context=vm.createContext({SCHOOL_FEES_TOTAL_CODE:'SCHOOL_FEES_TOTAL'});
vm.runInContext(['toAmount','isYes','isSchoolFee','isWalletFee','schoolFeeTotalItem','buildPayableItems','isSchoolFeesTotal','paymentAmountRules'].map(name=>fn(payments,name)).join('\n'),context);
const fees=[{FeeCode:'TUI',FeeCategory:'School Fee',Amount:600,OriginalAmount:1000,AllowInstallment:'YES',PartPaymentMode:'Item',MinAmount:300},
  {FeeCode:'TXT',FeeCategory:'School Fee',Amount:400,AllowInstallment:'YES',PartPaymentMode:'Total',MinAmount:100}];

test('a supplied server quote overrides item installment flags and is retained for display',()=>{
  const quote={total:900,minAmount:225,maxAmount:900,allowInstallment:true,planMode:'Percentage',policyVersion:'v1',schedule:[]};
  const total=context.schoolFeeTotalItem(fees,quote);
  assert.equal(total.Amount,900);assert.equal(total.MinAmount,225);assert.equal(total.AllowInstallment,'YES');assert.equal(total.SchoolFeePaymentPlan,quote);
  assert.equal(context.paymentAmountRules(total).defaultAmount,225);
  const full=context.schoolFeeTotalItem(fees,{...quote,minAmount:900,allowInstallment:false,planMode:'Full payment'});
  assert.equal(context.paymentAmountRules(full).show,false);
  assert.equal(context.schoolFeeTotalItem(fees,{...quote,total:0}),null);
});

test('legacy total payments use only Total/Both item modes and the largest minimum',()=>{
  assert.equal(context.schoolFeeTotalItem(fees).MinAmount,100);
  assert.equal(context.schoolFeeTotalItem([fees[0]]).AllowInstallment,'NO');
  assert.equal(context.schoolFeeTotalItem([...fees,{...fees[1],FeeCode:'OTHER',MinAmount:200,PartPaymentMode:'Both'}]).MinAmount,200);
  assert.equal(context.schoolFeeTotalItem([{...fees[1],Amount:35,MinAmount:100}]).Amount,35);
});

test('total plans do not rewrite wallet or optional item rules',()=>{
  const optional={FeeCode:'CLUB',FeeCategory:'Club',Amount:90,AllowInstallment:'NO'},wallet={FeeCode:'WALLET_TOPUP',FeeCategory:'Wallet',MinAmount:500};
  const result=context.buildPayableItems([optional,wallet],fees,{total:1000,minAmount:250,allowInstallment:true});
  assert.equal(result[1],optional);assert.equal(result[2],wallet);assert.equal(context.paymentAmountRules(wallet).min,500);
  vm.runInContext(fn(parent,'allowsItemPartPayment'),context);
  assert.equal(context.allowsItemPartPayment({FeeCode:'SCHOOL_FEES_TOTAL',PartPaymentMode:'Total',AllowInstallment:'YES'}),true);
  assert.equal(context.allowsItemPartPayment({...optional,PartPaymentMode:'Total',AllowInstallment:'YES'}),false);
  assert.equal(context.allowsItemPartPayment({...optional,PartPaymentMode:'Item',AllowInstallment:'YES'}),true);
});

test('local examples cover percentage basis, fixed residual, cumulative installments and exact cents',()=>{
  assert.equal(paymentPlanExample({Mode:'Percentage',Value:25,PercentageBasis:'Total school fees'},1000,600).minimum,250);
  assert.equal(paymentPlanExample({Mode:'Percentage',Value:25,PercentageBasis:'Outstanding balance'},1000,600).minimum,100);
  assert.equal(paymentPlanExample({Mode:'Fixed minimum',Value:300},1000,975).minimum,25);
  assert.equal(paymentPlanExample({Mode:'Existing fee-item rules'},1000,500).minimum,null);
  const example=paymentPlanExample({Mode:'Equal installments',InstallmentCount:3},100,45);
  assert.deepEqual(example.schedule.map(row=>row.amount),[33.33,33.33,33.34]);assert.equal(example.minimum,21.66);
  const overdue=paymentPlanExample({Mode:'Equal installments',InstallmentCount:3,DueDates:['2026-01-01','2026-02-01','2026-03-01']},300,50,'2026-02-10');
  assert.equal(overdue.minimum,150);assert.equal(paymentPlanExample({Mode:'Equal installments',InstallmentCount:3},100,120).minimum,0);
});

test('illustrative preview agrees with authoritative quotes for exact cents and partially paid installments',()=>{
  const modes=[{Mode:'Percentage',Value:29.33},{Mode:'Percentage',Value:5,PercentageBasis:'Outstanding balance'},
    {Mode:'Fixed minimum',Value:33.33},{Mode:'Full payment'},{Mode:'Equal installments',InstallmentCount:3},
    {Mode:'Equal installments',InstallmentCount:4,DueDates:['2026-01-01','2026-02-01','2026-03-01','2026-04-01']}];
  for(const values of modes)for(const [total,credited] of [[0.01,0],[0.04,0.01],[100,45],[9999.99,1111.11],[1000000.03,700000.02]]){
    const rule={Name:'All',AcademicSession:'2026/2027',Term:'First Term',...values};
    const server=quoteSchoolFeePaymentPlan({rule,originalTotal:total,balance:Number((total-credited).toFixed(2)),now:'2026-02-10'});
    const preview=paymentPlanExample(rule,total,credited,'2026-02-10');
    assert.equal(preview.minimum,server.minAmount,JSON.stringify({rule,total,credited}));assert.deepEqual(preview.schedule,server.schedule);
  }
});
