import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as rules from '../functions/lib/vendor-settlement-rules.js';
import { buildWalletPurchaseAccountingJournal } from '../functions/api/backend.js';

const withoutImports = source => source.replace(/^import[\s\S]*?from '[^']+';\r?\n/gm,'').replace(/export /g,'');
const accessSource = withoutImports(await readFile(new URL('../functions/lib/vendor-sales-access.js',import.meta.url),'utf8'));
const posSource = withoutImports(await readFile(new URL('../functions/lib/vendor-sales.js',import.meta.url),'utf8'))
  .replace(/const \{getWalletCardAccount\} = await import\('[^']+'\);/g,'')
  .replace(/const \{recordWalletPurchase\} = await import\('[^']+'\);/g,'');
const backendSource = await readFile(new URL('../functions/api/backend.js',import.meta.url),'utf8');
const walletSource = backendSource.slice(backendSource.indexOf('export async function recordWalletPurchase('),backendSource.indexOf('export function buildCreditActionAccountingJournal('))
  .replace('export ','').replace(/const \{ assertVendorSaleReplay \} = await import\('[^']+'\);/g,'');
import { handleProductImport } from '../functions/lib/vendor-product-import.js';
import { assertRequisitionTransition } from '../functions/lib/requisition-workflow.js';
import { validateRequisitionPosting } from '../functions/lib/requisition-posting.js';
import { accountingChartForEdition } from '../functions/lib/accounting-edition-scope.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';
import { rolesForEdition } from '../functions/lib/role-module-access.js';

globalThis.crypto ||= webcrypto;
const source = (await readFile(new URL('../functions/lib/vendor-settlements.js', import.meta.url),'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm,'').replace(/export /g,'');
const timestamp = '2026-10-08T09:00:00.000Z';
const scope = { ScopeKey:'school--main', BranchId:'main', OrganisationEdition:'school', SchoolSection:'Secondary' };
const user = { username:'accounts', role:'Accounts Officer', branchId:'main', edition:'school', allowedSections:['vendorSettlements'], schoolSectionAccess:'All' };
const vendor = (id = 'v1', extra = {}) => ({ ...scope, VendorId:id, Name:`Vendor ${id}`, Active:'YES', BankName:'Test bank',
  BankAccountName:'Vendor name', BankAccountNumber:'1234567890', BankDetailsVersion:'bank1', RuleHistory:[], ...extra });
const settings = { ...scope, Enabled:true, AccountingConfirmed:true, PayableAccount:'2000', CommissionAccount:'4090', VendorReceivableAccount:'1110', BusinessTimezone:'Africa/Lagos', RuleHistory:[] };
const chart = [['1010','Asset'],['1020','Asset'],['1030','Asset'],['1110','Asset'],['2000','Liability'],['2100','Liability'],['2200','Liability'],['4090','Revenue'],['4040','Revenue'],['4120','Revenue'],['4130','Revenue'],['6060','Expense'],['3000','Equity']].map(([Code,Type]) => ({Code,Name:Code,Type,Active:'YES'}));
function fixture(initial = []) {
  const store = new Map(), commits = []; let version = 0, forcedConflict = false;
  const put = (collection,id,row) => store.set(`${collection}/${id}`, { ...structuredClone(row), __id:id, __updateTime:`r${++version}` });
  put('settings','vendor-settlement-school--main',settings); put('commerceVendors','v1',vendor());
  for (const [collection,id,row] of initial) put(collection,id,row);
  const get = (collection,id) => store.get(`${collection}/${id}`);
  const list = collection => [...store.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([,row]) => structuredClone(row));
  const commit = async (_env,writes) => {
    if (forcedConflict) { forcedConflict = false; throw Object.assign(new Error('Conflict'),{status:409}); }
    assert.equal(new Set(writes.map(w => `${w.collectionPath}/${w.documentId}`)).size,writes.length,'No duplicate document mutations in a commit');
    for (const w of writes) {
      const previous = get(w.collectionPath,w.documentId);
      if (w.exists === false && previous || w.updateTime && previous?.__updateTime !== w.updateTime) throw Object.assign(new Error('Conflict'),{status:409});
    }
    commits.push(structuredClone(writes)); for (const w of writes) put(w.collectionPath,w.documentId,w.data);
  };
  const functions = vm.runInNewContext(`${source}\n({ handleVendorSettlementAction, prepareVendorSale, snapshotVendorCart })`, {
    ...rules, handleProductImport, crypto:webcrypto, Intl, Date, TextEncoder, console, assertRequisitionTransition, validateRequisitionPosting, accountingChartForEdition,
    getDocument:async (_env,c,id) => structuredClone(get(c,id) || null), listCollection:async (_env,c) => c === 'accountingPeriods' ? list(c) : list(c),
    getAccountingChartRows:async () => chart, verifyStaffApprovalPassword:async (_env,username,password) => password === 'test-confirmation',
    findStaffUserRecord:async (_env,username) => list('staffUsers').find(r => [r.Username,r.LoginUsername,r.__id].some(v => String(v || '').toLowerCase() === username.toLowerCase())),
    queryCollectionPages:async (_env,c,opts) => list(c).filter(row => opts.filters.every(f => f.op === 'in' ? f.value.includes(row[f.field]) : row[f.field] === f.value)), batchCommitDocuments:commit
  });
  const run = (action,body = {},actor = user,options = {}) => functions.handleVendorSettlementAction({},actor,{action,...body},options);
  async function sale(id = 'sale1', gross = 100, extra = {}, items = null) {
    const ownerItems = items || [{VendorId:'v1',ItemName:'Water',InventoryDocumentId:'stock1',Quantity:1,UnitPrice:gross,Amount:gross,SchoolSection:'Secondary'}];
    const snapshots = await functions.snapshotVendorCart({},ownerItems,user,timestamp);
    const row = { ...scope, SaleNo:id, Items:snapshots, SaleDate:timestamp, PaidAt:timestamp, PaymentMethod:'Cash', RecordedBy:'cashier', ...extra };
    const journal = { JournalNo:`SYS-COM-${id}`, Date:'2026-10-08', Status:'Posted', Lines:[{AccountCode:'1010',Debit:gross,Credit:0},{AccountCode:'4040',Debit:0,Credit:gross}] };
    const result = await functions.prepareVendorSale({},row,journal); await commit({},result.writes); return result;
  }
  const request = async (amount = 100, id = 'claim1', extra = {}) => run('requestSettlement',{RequestId:id,VendorId:'v1',From:'2026-10-01',To:'2026-10-31',Amount:amount,...extra});
  async function decision(status, assignedRole, requestId = 'claim1') {
    const row = get('vendorSettlementRequests',`VREQ-${requestId}`);
    return run('decision',{SettlementId:row.SettlementId,VendorId:'v1',RequestId:`decision-${status.replaceAll(' ','')}-${requestId}`,Status:status,
      RecordVersion:row.__updateTime,approvalPassword:'test-confirmation',Notes:'Reviewed'}, {...user,role:assignedRole,username:assignedRole});
  }
  const approve = async () => { await decision('Accounts Confirmed','Accounts Officer'); await decision('Admin Reviewed','Admin'); await decision('Approved','Director'); };
const pay = async (amount,id = 'pay1') => { const r = get('vendorSettlementRequests','VREQ-claim1'); return run('pay',{
    SettlementId:r.SettlementId,VendorId:'v1',RequestId:id,RecordVersion:r.__updateTime,Amount:amount,Date:'2026-10-08',
    Reference:'BANK-1',EvidenceReference:'Slip-1',approvalPassword:'test-confirmation'}); };
  const refund = async (value,id = 'refund1',entryId = 'sale1--v1') => run('refund',{VendorId:'v1',EntryId:entryId,Amount:value,RequestId:id,
    Date:'2026-10-08',Reference:'REFUND-1',EvidenceReference:'REFUND-SLIP',Notes:'Returned unopened',approvalPassword:'test-confirmation'});
  return { store,put,get,list,commits,commit,run,sale,request,decision,approve,pay,refund,functions, conflict:() => { forcedConflict = true; } };
}
test('integer money, percent validation, full-payment override and prospective rules', () => {
  assert.equal(rules.cents(12.34),1234); assert.throws(() => rules.cents(Infinity));
  for (const value of [-1,101,10.111,NaN]) assert.throws(() => rules.normalizeRule({Mode:'Percentage',Rate:value},timestamp));
  const percent = rules.normalizeRule({Mode:'Percentage',Rate:5.1},timestamp);
  assert.equal(rules.chargeFor(percent,10001),510);
  const full = rules.normalizeRule({Mode:'Full payment'},timestamp,true);
  assert.equal(rules.effectiveRule({RuleHistory:[full]},{RuleHistory:[percent]},timestamp).Mode,'Full payment');
  assert.equal(rules.effectiveRule({RuleHistory:[{...full,EffectiveAt:'2026-11-01T00:00:00.000Z'}]},{RuleHistory:[percent]},timestamp).Mode,'Percentage');
  assert.throws(() => rules.normalizeRule({EffectiveDate:'2026-10-01'},timestamp),/backdated/);
  assert.throws(() => rules.dateOnly('2026-02-30'));
});
test('period boundaries use the business timezone, weekly Monday and fixed-charge cap', () => {
  assert.equal(rules.periodKey({Cycle:'Daily'},'2026-10-08T23:30:00Z'),'2026-10-09');
  assert.equal(rules.periodKey({Cycle:'Weekly'},'2026-10-08T00:00:00Z'),'2026-10-05');
  assert.equal(rules.chargeFor({Mode:'Fixed charge',FixedCents:10000},999),999);
});
test('vendor role is available in every edition and custom modules cannot expand it', () => {
  for (const edition of ['school','faith','organization']) {
    assert.ok(rolesForEdition(edition).includes('Vendor User'));
    assert.deepEqual(allowedSectionsFor({role:'Vendor User',tabAccess:['students','accounts','staffUsers']},null,{edition}),
      ['vendorSettlements',...(edition === 'school' ? ['tuckShop'] : ['organizationStore','restaurant'])]);
  }
});
test('school-owned carts use no vendor reads or extra mutations', async () => {
  const f = fixture(); assert.deepEqual(await f.functions.snapshotVendorCart({},[{ItemName:'School'}],user,timestamp),[{ItemName:'School'}]);
  const journal = {Lines:[]}; const result = await f.functions.prepareVendorSale({},{Items:[]},journal);
  assert.equal(result.journal,journal); assert.equal(result.writes.length,0);
});
test('confirmed sale creates immutable earnings and the payable, not another expense', async () => {
  const f = fixture(); const result = await f.sale();
  assert.equal(f.get('vendorBalances','v1').NetCents,10000);
  assert.equal(result.journal.Lines.find(l => l.AccountCode === '2000').Credit,100);
  assert.ok(!result.journal.Lines.some(l => l.AccountCode === '4040'));
  await assert.rejects(f.sale(),/Conflict/);
});
test('mixed basket separates vendors; exact stock and immutable ownership remain on each earning', async () => {
  const f = fixture([['commerceVendors','v2',vendor('v2')]]);
  const result = await f.sale('mixed',150,{},[{VendorId:'v1',ItemName:'Water',InventoryDocumentId:'stock1',Quantity:1,Amount:50},{VendorId:'v2',ItemName:'Water',InventoryDocumentId:'stock2',Quantity:2,Amount:100}]);
  assert.equal(result.settlements.length,2); assert.equal(f.get('vendorBalances','v2').NetCents,10000);
  f.put('commerceVendors','v1',vendor('v1',{Name:'New name'}));
  assert.equal(f.get('vendorEarnings','mixed--v1').VendorName,'Vendor v1');
  assert.equal(f.get('vendorEarnings','mixed--v2').Items[0].InventoryDocumentId,'stock2');
});
test('percentage deduction and full override produce balanced journals', async () => {
  const rule = rules.normalizeRule({Mode:'Percentage',Rate:10},timestamp);
  const f = fixture([['settings','vendor-settlement-school--main',{...settings,RuleHistory:[rule]}]]);
  const result = await f.sale(); assert.equal(f.get('vendorBalances','v1').NetCents,9000);
  assert.equal(result.journal.Lines.find(l => l.AccountCode === '4090').Credit,10);
  f.put('commerceVendors','v1',vendor('v1',{RuleHistory:[rules.normalizeRule({Mode:'Full payment'},timestamp,true)]}));
  await f.sale('full'); assert.equal(f.get('vendorBalances','v1').NetCents,19000);
});
test('fixed period charge is taken once across sales and never deducted again on a request', async () => {
  const f = fixture([['settings','vendor-settlement-school--main',{...settings,RuleHistory:[rules.normalizeRule({Mode:'Fixed charge',FixedAmount:30,Basis:'Per period',Cycle:'Monthly'},timestamp)]}]]);
  await f.sale('sale1',20); await f.sale('sale2',100); await f.request(90);
  assert.equal(f.get('vendorBalances','v1').ChargeCents,3000); assert.equal(f.get('vendorBalances','v1').ReservedCents,9000);
  assert.equal(f.get('vendorClaimLots','sale2--v1').ChargeCents,1000);
});
test('vendor-collected money creates no school payable or fictitious cash receipt', async () => {
  const f = fixture([['settings','vendor-settlement-school--main',{...settings,RuleHistory:[rules.normalizeRule({Mode:'Percentage',Rate:10},timestamp)]}]]);
  const result = await f.sale('direct',100,{CollectionMode:'Vendor collected'});
  assert.equal(f.get('vendorBalances','v1').NetCents,0); assert.equal(f.get('vendorBalances','v1').DirectChargeCents,1000);
  assert.ok(result.journal.Lines.some(l => l.AccountCode === '1110' && l.Debit === 10));
  assert.ok(!result.journal.Lines.some(l => ['2000','1010','1020'].includes(l.AccountCode)));
  await assert.rejects(f.request(),/unavailable/);
});
test('direct full-payment sale requires no accounting journal; wallet/direct collection is forbidden', async () => {
  const f = fixture(); assert.equal((await f.sale('direct',100,{CollectionMode:'Vendor collected'})).journal,null);
  await assert.rejects(f.sale('bad',100,{CollectionMode:'Vendor collected',PaymentMethod:'Student Wallet'}),/Direct vendor/);
});
test('disabled setup and mismatched section/branch/edition fail closed', async () => {
  const f = fixture(); f.put('settings','vendor-settlement-school--main',{...settings,Enabled:false}); await assert.rejects(f.sale(),/Accounts must confirm/);
  for (const extra of [{BranchId:'annex',ScopeKey:'school--annex'},{SchoolSection:'Primary'},{OrganisationEdition:'faith',ScopeKey:'faith--main'}]) {
    const g = fixture([['commerceVendors','v1',vendor('v1',extra)]]); await assert.rejects(g.sale(),/unavailable|section differ/);
  }
});
test('claims reserve balances; overlaps and stale simultaneous claims cannot double claim', async () => {
  const f = fixture(); await f.sale();
  const results = await Promise.allSettled([f.request(80,'claim1'),f.request(80,'claim2')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
  assert.equal(f.get('vendorBalances','v1').ReservedCents,8000);
  await assert.rejects(f.request(30,'claim3'),/unavailable/);
});
test('claim retries replay without re-reserving and changed amounts cannot reuse the same reference', async () => {
  const f = fixture(); await f.sale(); await f.request(); assert.equal((await f.request()).replayed,true);
  await assert.rejects(f.request(90),/another operation/); assert.equal(f.get('vendorBalances','v1').ReservedCents,10000);
});
test('all approval stages and roles are enforced; approval alone remains unpaid', async () => {
  const f = fixture(); await f.sale(); await f.request();
  await assert.rejects(f.decision('Approved','Director'),/Only Accounts/);
  await assert.rejects(f.pay(100),/final-approved/);
  await f.approve(); assert.equal(f.get('vendorSettlementRequests','VREQ-claim1').PaymentStatus,'Awaiting payment');
  await assert.rejects(f.decision('Posted','Accounts Officer'),/Record payment/);
  assert.equal(f.get('vendorBalances','v1').PaidCents,0);
});
test('partial then full payment clears payable with no expense and no duplicate payment', async () => {
  const f = fixture(); await f.sale(); await f.request(); await f.approve();
  await f.pay(40); assert.equal(f.get('vendorSettlementRequests','VREQ-claim1').PaymentStatus,'Part-paid');
  assert.equal((await f.pay(40)).replayed,true);
  await f.pay(60,'pay2'); assert.equal(f.get('vendorBalances','v1').PaidCents,10000); assert.equal(f.get('vendorBalances','v1').ReservedCents,0);
  const journals = f.list('accountingJournals'); assert.ok(journals.every(j => j.Lines.some(l => l.AccountCode === '2000' && l.Debit > 0)));
  assert.equal(f.list('accountingExpenses').length,0); await assert.rejects(f.pay(1,'pay3'),/unpaid balance/);
});
test('rejection releases claims; revision resets all approvals without deleting old history', async () => {
  const f = fixture(); await f.sale(); await f.request(); await f.decision('Rejected','Accounts Officer');
  assert.equal(f.get('vendorBalances','v1').ReservedCents,0);
  const previous = f.get('vendorSettlementRequests','VREQ-claim1');
  await f.request(80,'revision',{ReplacesSettlementId:previous.SettlementId,RecordVersion:previous.__updateTime});
  assert.equal(f.get('vendorSettlementRequests','VREQ-revision').Revision,2);
  assert.equal(f.get('vendorSettlementRequests','VREQ-revision').Status,'Submitted');
  assert.equal(f.get('vendorSettlementRequests','VREQ-claim1').Status,'Rejected');
});
test('bank change blocks payment; reviewed withdrawal releases only unpaid remainder', async () => {
  const f = fixture(); await f.sale(); await f.request(); await f.approve(); await f.pay(40);
  f.put('commerceVendors','v1',vendor('v1',{BankDetailsVersion:'bank2'}));
  await assert.rejects(f.pay(60,'pay2'),/bank details changed/);
  await f.decision('Cancelled','Accounts Officer'); assert.equal(f.get('vendorBalances','v1').ReservedCents,0);
  assert.equal(f.get('vendorBalances','v1').PaidCents,4000);
});
test('refund uses original rule, preserves sale and flags reserved claims until withdrawal', async () => {
  const f = fixture([['settings','vendor-settlement-school--main',{...settings,RuleHistory:[rules.normalizeRule({Mode:'Percentage',Rate:10},timestamp)]}]]);
  await f.sale(); await f.request(90); await f.refund(50);
  assert.equal(f.get('vendorBalances','v1').NetCents,4500); assert.equal(f.get('vendorBalances','v1').ChargeCents,500);
  assert.equal(f.get('vendorEarnings','sale1--v1').GrossCents,10000); assert.equal(f.get('vendorBalances','v1').ReviewRequired,true);
  await assert.rejects(f.decision('Accounts Confirmed','Accounts Officer'),/reconcile/);
  await f.decision('Cancelled','Accounts Officer'); assert.equal(f.get('vendorBalances','v1').ReviewRequired,false);
});
test('period refund redistributes a capped charge and each affected lot reconciles', async () => {
  const f = fixture([['settings','vendor-settlement-school--main',{...settings,RuleHistory:[rules.normalizeRule({Mode:'Fixed charge',FixedAmount:30,Basis:'Per period',Cycle:'Monthly'},timestamp)]}]]);
  await f.sale('sale1',20); await f.sale('sale2',100); await f.refund(20);
  assert.equal(f.get('vendorBalances','v1').NetCents,7000);
  assert.equal(f.get('vendorClaimLots','sale1--v1').NetCents,0);
  assert.equal(f.get('vendorClaimLots','sale2--v1').ChargeCents,3000);
  assert.equal(f.list('vendorClaimLots').reduce((sum,l) => sum+l.NetCents,0),7000);
});
test('paid refund becomes a recoverable overpayment; receipt clears it with linked journal', async () => {
  const f = fixture(); await f.sale(); await f.request(); await f.approve(); await f.pay(100); await f.refund(25);
  assert.equal(f.get('vendorBalances','v1').ReviewRequired,true);
  await f.run('recordRecovery',{VendorId:'v1',Kind:'Overpayment recovery',Amount:25,Date:'2026-10-08',RequestId:'recover1',Reference:'REC1',EvidenceReference:'SLIP',approvalPassword:'test-confirmation'});
  assert.equal(f.get('vendorBalances','v1').PaidCents,7500); assert.equal(f.get('vendorBalances','v1').ReviewRequired,false);
  assert.equal(f.get('vendorSettlementRequests','VREQ-claim1').PaidCents,10000,'Original paid request remains historical evidence');
});
test('wallet refunds credit the original wallet, not a new payment or school fee', async () => {
  const f = fixture([['ledger','original-wallet',{BranchId:'main',AccountRef:'TEST/001',Debit:100,FeeCategory:'Wallet'}]]);
  await f.sale('sale1',100,{PaymentMethod:'Student Wallet',LedgerNo:'original-wallet'}); await f.refund(20);
  const row = f.get('ledger','WALLET-VREF-refund1'); assert.equal(row.Credit,20); assert.equal(row.AccountRef,'TEST/001'); assert.equal(row.FeeCategory,'Wallet');
});
test('payment conflict is atomic and closed accounting period prevents new payment', async () => {
  const f = fixture(); await f.sale(); await f.request(); await f.approve();
  f.conflict(); await assert.rejects(f.pay(50),/nothing was partially posted/);
  assert.equal(f.get('vendorBalances','v1').PaidCents,0); assert.equal(f.list('accountingJournals').length,0);
  f.put('accountingPeriods','closed',{StartDate:'2026-10-01',EndDate:'2026-10-31',Status:'Closed'});
  await assert.rejects(f.pay(50,'pay2'),/closed/i);
});
test('historical preview is non-mutating; confirmed opening is idempotent and never rewrites old records', async () => {
  const f = fixture([['accountingJournals','OLD',{Description:'Preserved'}]]);
  const body = {VendorId:'v1',OpeningReference:'PRE-OCT',Date:'2026-10-01',GrossSales:1000,Refunds:100,SchoolDeductions:50,PriorPayments:500,OffsetAccount:'4090',EvidenceReference:'Reviewed statement',Notes:'Reviewed ownership and receipts'};
  const p = await f.run('previewHistorical',body); assert.equal(p.Outstanding,350); assert.equal(f.commits.length,0);
  await assert.rejects(f.run('recordOpening',{...body,Confirmed:true,PreviewDigest:'bad',RequestId:'open1'}),/preview/);
  await f.run('recordOpening',{...body,Confirmed:true,PreviewDigest:p.PreviewDigest,RequestId:'open1',approvalPassword:'test-confirmation'});
  assert.equal(f.get('vendorBalances','v1').NetCents,85000); assert.equal(f.get('vendorBalances','v1').PaidCents,50000);
  assert.equal(f.get('accountingJournals','OLD').Description,'Preserved');
  assert.equal((await f.run('recordOpening',{...body,Confirmed:true,PreviewDigest:p.PreviewDigest,RequestId:'open1',approvalPassword:'test-confirmation'})).replayed,true);
  assert.equal(rules.balanceView(f.get('vendorBalances','v1')).ReconciliationDifference,0);
});
test('vendor access returns only own data and masks other payment details', async () => {
  const f = fixture([['commerceVendors','v1',vendor('v1',{LoginUsername:'vendor-login'})],['commerceVendors','v2',vendor('v2')]]);
  const owner = {...user,role:'Vendor User',username:'vendor-login'};
  const data = await f.run('bootstrap',{},owner); assert.equal(data.vendors.length,1); assert.equal(data.vendors[0].BankAccountNumber,undefined);
  await assert.rejects(f.run('statement',{VendorId:'v2'},owner),/not linked/);
  await assert.rejects(f.run('saveSettings',{},owner),/role/);
  await assert.rejects(f.run('requestSettlement',{}, {...user,subscriptionReadOnly:true}),/read-only/);
  await assert.rejects(f.run('bootstrap',{}, {...user,role:'Teacher'}),/role/);
});
test('idempotency records and audit never capture credentials posted by desktop', async () => {
  const f = fixture(); await f.sale(); await f.request(100,'claim1',{ActorPassword:'sensitive',secret:'device-secret'});
  assert.ok(!JSON.stringify(f.list('vendorSettlementOperations')).includes('sensitive'));
  assert.ok(!JSON.stringify(f.list('accountingAudit')).includes('device-secret'));
});

test('a fixed period charge spans school and direct collections; refund moves its accounting mapping safely', async () => {
  const f = fixture([['settings','vendor-settlement-school--main',{...settings,RuleHistory:[rules.normalizeRule({Mode:'Fixed charge',FixedAmount:30,Basis:'Per period',Cycle:'Monthly'},timestamp)]}]]);
  await f.sale('sale1',100,{CollectionMode:'Vendor collected'}); await f.sale('sale2',100);
  assert.equal(f.list('vendorChargePeriods').length,1);
  assert.equal(f.get('vendorBalances','v1').DirectChargeCents,3000); assert.equal(f.get('vendorBalances','v1').ChargeCents,0);
  await f.refund(100);
  assert.equal(f.get('vendorBalances','v1').DirectChargeCents,0); assert.equal(f.get('vendorBalances','v1').ChargeCents,3000);
  assert.equal(f.get('vendorBalances','v1').NetCents,7000);
  const j = f.get('accountingJournals','SYS-VREF-refund1'); assert.equal(j.TotalDebit,j.TotalCredit);
  assert.ok(j.Lines.some(l => l.AccountCode === '1110' && l.Credit === 30));
  assert.ok(j.Lines.some(l => l.AccountCode === '2000' && l.Debit === 30));
  assert.equal(rules.balanceView(f.get('vendorBalances','v1')).ReconciliationDifference,0);
});
test('collected direct commission can be returned after a refund; limits and retries are enforced', async () => {
  const f = fixture([['settings','vendor-settlement-school--main',{...settings,RuleHistory:[rules.normalizeRule({Mode:'Percentage',Rate:10},timestamp)]}]]);
  await f.sale('sale1',100,{CollectionMode:'Vendor collected'});
  const receipt = {VendorId:'v1',Kind:'Commission received',Amount:10,Date:'2026-10-08',RequestId:'commission1',Reference:'COM-1',EvidenceReference:'Slip',approvalPassword:'test-confirmation'};
  await f.run('recordRecovery',receipt); await f.refund(50);
  const returned = {...receipt,Kind:'Commission returned',Amount:5,RequestId:'return1'};
  await assert.rejects(f.run('recordRecovery',{...returned,Amount:6}),/refundable/);
  await f.run('recordRecovery',returned); assert.equal((await f.run('recordRecovery',returned)).replayed,true);
  assert.equal(f.get('vendorBalances','v1').DirectChargePaidCents,500);
  const journal = f.get('accountingJournals','SYS-VREC-return1'); assert.equal(journal.TotalCredit,5);
  assert.ok(journal.Lines.some(l => l.AccountCode === '1020' && l.Credit === 5));
  await assert.rejects(f.run('recordRecovery',{...receipt,RequestId:'wrong-kind',Kind:'Made up'}),/valid vendor/);
});
for (const edition of ['school','faith','organization']) {
  test(`${edition} vendor registration requires a name and saves inherited-rule vendors without financial posting`, async () => {
    const f = fixture(), actor = {...user,edition};
    const body = {VendorId:`VND-fixture-${edition}`,Name:'',SchoolSection:'Secondary',BankAccountNumber:'0012345678',PosEnabled:true,
      Rule:{Mode:'Inherit default',EffectiveDate:new Date().toISOString().slice(0,10)}};
    await assert.rejects(f.run('saveVendor',body,actor),/Enter a vendor name/);
    assert.equal(f.commits.length,0);
    const result = await f.run('saveVendor',{...body,Name:'Fixture registered vendor'},actor);
    const saved = f.get('commerceVendors',result.VendorId);
    assert.equal(saved.Name,'Fixture registered vendor'); assert.equal(saved.OrganisationEdition,edition);
    assert.equal(saved.BankAccountNumber,'0012345678'); assert.equal(saved.RuleHistory[0].Mode,'Inherit default');
    assert.equal(saved.SchoolSection,edition === 'school' ? 'Secondary' : 'All');
    assert.equal(f.list('accountingJournals').length,0); assert.equal(f.list('ledger').length,0); assert.equal(f.list('vendorBalances').length,0);
    assert.ok((await f.run('bootstrap',{},actor)).vendors.some(v=>v.VendorId===result.VendorId));
  });
}

test('bank-only vendor updates preserve rule history and canonical vendor email usernames', async () => {
  const f = fixture([['staffUsers','staff-unique-id',{Username:'vendor-canonical',LoginUsername:'owner@example.test',Role:'Vendor User',Active:true,BranchId:'main',SchoolSectionAccess:'Secondary'}]]);
  const v = f.get('commerceVendors','v1');
  await f.run('saveVendor',{VendorId:'v1',RecordVersion:v.__updateTime,Name:v.Name,BankName:v.BankName,BankAccountName:v.BankAccountName,LoginUsername:'owner@example.test'});
  assert.equal(f.get('commerceVendors','v1').LoginUsername,'vendor-canonical');
  assert.equal(f.get('commerceVendors','v1').RuleHistory.length,0);
  assert.equal((await f.run('bootstrap',{}, {...user,role:'Vendor User',username:'vendor-canonical'})).vendors.length,1);
  f.put('staffUsers','staff-unique-id',{Username:'vendor-canonical',LoginUsername:'owner@example.test',Role:'Vendor User',Active:false});
  await assert.rejects(f.run('saveVendor',{VendorId:'new-vendor',Name:'New vendor',LoginUsername:'owner@example.test'}),/active Vendor User/);
});
test('statement dates filter earnings and payment history without altering the full balance', async () => {
  const f = fixture(); await f.sale(); await f.request(); await f.approve(); await f.pay(100);
  const statement = await f.run('statement',{VendorId:'v1',From:'2026-09-01',To:'2026-09-30'});
  assert.equal(statement.entries.length,0); assert.equal(statement.payments.length,0); assert.equal(statement.balance.Paid,100);
});
test('claims against different payable mappings clear their original accounts after settings change', async () => {
  const f = fixture(); await f.sale('sale1',40);
  f.put('settings','vendor-settlement-school--main',{...settings,PayableAccount:'2100'}); await f.sale('sale2',60);
  await f.request(); await f.approve(); await f.pay(100);
  const lines = f.get('accountingJournals','SYS-VPAY-pay1').Lines;
  assert.ok(lines.some(l => l.AccountCode === '2000' && l.Debit === 40));
  assert.ok(lines.some(l => l.AccountCode === '2100' && l.Debit === 60));
});
test('pending / failed payments cannot earn a vendor balance', async () => {
  for (const PaymentStatus of ['Pending','Failed','Cancelled']) {
    const f = fixture(); await assert.rejects(f.sale('not-paid',100,{PaymentStatus}),/confirmed paid/); assert.equal(f.commits.length,0);
  }
});

const commerceSource = (await readFile(new URL('../functions/lib/organization-commerce.js',import.meta.url),'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm,'').replace(/export /g,'');
function commerceFixture(edition = 'school', section = 'tuckShop') {
  const scoped = {...scope,ScopeKey:`${edition}--main`,OrganisationEdition:edition,SchoolSection:edition === 'school' ? 'Secondary' : 'All'};
  const f = fixture([['commerceVendors','v1',vendor('v1',scoped)],['settings',`vendor-settlement-${edition}--main`,{...settings,...scoped}]]);
  const collection = ({tuckShop:'tuckShopInventory',organizationStore:'storeItems',restaurant:'restaurantInventory'})[section];
  for (const stockId of ['stock1','stock2']) f.put(collection,stockId,{...scoped,ItemCode:stockId,StoreType:'Organisation Store',ItemName:'Water',VendorId:'v1',Price:50,Quantity:5,Active:'YES'});
  const access = vm.runInNewContext(`${accessSource}\n({linkedSalesVendors,restrictVendorInventory,assertVendorSaleReplay,vendorCustomerScope})`,{
    ...rules,queryCollectionPages:async (_env,c,opts) => f.list(c).filter(row => opts.filters.every(q => row[q.field] === q.value))});
  const context = {...f.functions,...access,crypto:webcrypto,Date,console,URL,URLSearchParams,
    batchUpsertDocuments:f.commit,getDocument:async (_env,c,id) => structuredClone(f.get(c,id) || null),listCollection:async (_env,c) => f.list(c),
    upsertDocument:async (_env,c,id,row) => f.put(c,id,row),patchDocumentFields:async (_env,c,id,row) => f.put(c,id,{...f.get(c,id),...row}),
    createDocumentIfAbsent:async (_env,c,id,row) => { const previous = f.get(c,id); if (!previous) f.put(c,id,row); return {created:!previous,document:previous || f.get(c,id)}; },
    branchPaymentConfiguration:async () => ({online:{enabled:true},paystack:{}}),withPaystackBranchRouting:body => body,
    sendOrganizationCommercePaymentLinkEmail:async () => ({ok:true}),sendOrganizationCommerceReceiptEmail:async () => ({ok:true}),
    fetch:async (_url,options) => { const body = JSON.parse(options.body); return {ok:true,json:async () => ({status:true,data:{authorization_url:'https://payment.example.test',reference:body.reference}})}; }
  };
  const commerce = vm.runInNewContext(`${commerceSource}\n({COMMERCE_CONFIG,recordManualOrganizationCommerceSale,initializeOnlineOrganizationCommerceSale,finalizeOnlineOrganizationCommerceSale,previewOrganizationCommerceSale,preparePaidCommerceInventoryCompletion,prepareTuckShopWalletCart})`,context);
  const sha256Hex = async value => [...new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v => v.toString(16).padStart(2,'0')).join('');
  const findStudent = async () => structuredClone(f.get('students','child') || null);
  const walletAccountPayload = async (_env,student) => ({...student,WalletBalance:Number(student.OpeningWallet || 0)-f.list('ledger').reduce((sum,r) => sum+Number(r.Debit || 0),0),WalletSpentToday:f.list('ledger').reduce((sum,r) => sum+Number(r.Debit || 0),0)});
  const wallet = vm.runInNewContext(`${walletSource}\nrecordWalletPurchase`,{...context,...rules,...commerce,
    normalizeMatchText:rules.lower,asMoneyNumber:v => Math.round(Number(v || 0)*100)/100,
    requestedStudentScope:b => ({branchId:b.UserBranchId,schoolSection:b.UserSchoolSectionAccess}),
    findStudentByWalletCard:findStudent,findStudentByAccountRef:findStudent,walletAccountPayload,
    safeDocumentId:v => String(v).replace(/[^a-zA-Z0-9_-]/g,'_'),schoolSectionFor:r => r.SchoolSection,
    nowIso:() => timestamp,sha256Hex,requireConfiguredDesktopSecret:() => 'fixture-secret',
    buildWalletPurchaseAccountingJournal,batchCommitDocuments:f.commit});
  const pos = vm.runInNewContext(`${posSource}\nhandleVendorSalesAction`,{...context,...rules,...commerce,TextEncoder,
    recordWalletPurchase:wallet,getWalletCardAccount:async () => ({account:await walletAccountPayload({},await findStudent())})});
  return {...f,commerce,pos,wallet,sha256Hex,section,collection,actor:{...user,edition},body:{SaleRequestId:'sale1',PaymentMethod:'Cash',Items:[{Reference:'stock1',Quantity:2}]}};
}
for (const [edition,section] of [['school','tuckShop'],['faith','restaurant'],['organization','organizationStore']]) {
  test(`${edition} direct vendor checkout needs no preview request but still reprices and prevents double posting`,async () => {
    const f = commerceFixture(edition,section);
    f.put('commerceVendors','v1',{...f.get('commerceVendors','v1'),LoginUsername:'seller'});
    const actor = {...f.actor,role:'Vendor User',username:'seller',allowedSections:['vendorSettlements',section]};
    const body = {action:'recordVendorSale',Section:section,Items:[{Reference:'stock1',Quantity:2}],
      SaleRequestId:'direct-checkout-001',PaymentMethod:'Cash',ExpectedAmount:100,Confirmed:true};
    await assert.rejects(f.pos({},actor,{...body,ExpectedAmount:1}),/changed|total|amount/i);
    assert.equal(f.commits.length,0);
    const result = await f.pos({},actor,body);
    assert.equal(result.sale.Amount,100);
    assert.equal(f.get(f.collection,'stock1').Quantity,3);
    assert.equal(f.get('vendorBalances','v1').NetCents,10000);
    const journal = f.list('accountingJournals')[0];
    assert.equal(journal.TotalDebit,journal.TotalCredit);
    assert.equal((await f.pos({},actor,body)).replayed,true);
    assert.equal(f.list('vendorEarnings').length,1);
  });

  test(`${edition} checkout refuses unversioned stock without any financial or stock mutation`, async () => {
    const f = commerceFixture(edition,section);
    f.get(f.collection,'stock1').__updateTime = '';
    await assert.rejects(f.commerce.recordManualOrganizationCommerceSale({},section,f.body,f.actor),/stock version/);
    assert.equal(f.get(f.collection,'stock1').Quantity,5);
    assert.equal(f.list('vendorEarnings').length,0);
    assert.equal(f.list('accountingJournals').length,0);
  });
}

for (const [edition,section] of [['school','tuckShop'],['faith','restaurant'],['organization','organizationStore']]) {
  test(`${edition} restricted vendor POS scopes stock and posts/retries the same balanced sale only once`,async () => {
    const f = commerceFixture(edition,section);
    f.put('commerceVendors','v1',{...f.get('commerceVendors','v1'),LoginUsername:'seller'});
    f.put(f.collection,'stock2',{...f.get(f.collection,'stock2'),VendorId:''});
    const actor = {...f.actor,role:'Vendor User',username:'seller',allowedSections:['vendorSettlements',section]};
    const run = (action,body={}) => f.pos({},actor,{action,Section:section,...body});
    const boot = await run('salesBootstrap');
    assert.equal(boot.products.length,1); assert.equal(boot.sellingEnabled,true);
    await assert.rejects(run('previewVendorSale',{Items:[{Reference:'stock2',Quantity:1}]}),/available|stock|found/i);
    await assert.rejects(run('previewVendorSale',{Items:[{Reference:'stock1',Quantity:1.5}]}),/whole-number/);
    const body = {Items:[{Reference:'stock1',Quantity:2}],SaleRequestId:'same-checkout-001',PaymentMethod:'Cash',ExpectedAmount:100,Confirmed:true};
    const preview = await run('previewVendorSale',body); assert.equal(preview.Amount,100);
    const result = await run('recordVendorSale',body);
    assert.equal(f.get(f.collection,'stock1').Quantity,3);
    assert.equal(f.get('vendorBalances','v1').NetCents,10000);
    const journal = f.list('accountingJournals')[0];
    assert.equal(journal.TotalDebit,journal.TotalCredit);
    assert.ok(journal.Lines.some(l => l.AccountCode === '2000' && l.Credit === 100));
    assert.equal((await run('recordVendorSale',body)).replayed,true);
    assert.equal(f.list('vendorEarnings').length,1);
    await assert.rejects(run('recordVendorSale',{...body,Items:[{Reference:'stock1',Quantity:1}],ExpectedAmount:50}),/different cart/);
    assert.equal(f.get(f.collection,'stock1').Quantity,3);
    assert.equal(result.sale.RecordedByUsername,undefined); assert.equal(result.sale.Items[0].VendorRule,undefined);
    f.put('commerceVendors','v1',{...f.get('commerceVendors','v1'),PosEnabled:false});
    assert.equal((await run('salesBootstrap')).sellingEnabled,false);
    await assert.rejects(run('recordVendorSale',{...body,SaleRequestId:'disabled-checkout'}),/No active/);
  });
}

test('vendor selling fails closed for another login, section, subscription and wallet limits',async () => {
  const f = commerceFixture();
  f.put('commerceVendors','v1',{...f.get('commerceVendors','v1'),LoginUsername:'seller'});
  const actor = {...f.actor,role:'Vendor User',username:'seller',schoolSectionAccess:'Secondary',allowedSections:['vendorSettlements','tuckShop']};
  const body = {action:'recordVendorWalletPurchase',Section:'tuckShop',Items:[{Reference:'stock1',Quantity:2}],SaleRequestId:'wallet-limit-checkout',
    PaymentMethod:'Student Wallet',AccountRef:'CHILD/001',ExpectedAmount:100,Confirmed:true};
  for (const changed of [{username:'other'},{allowedSections:['vendorSettlements']},{subscriptionReadOnly:true},{branchId:'other'},{schoolSectionAccess:'Primary'}])
    await assert.rejects(f.pos({}, {...actor,...changed},body));
  for (const [limits,message] of [[{OpeningWallet:50},/Insufficient/],[{WalletTxnLimit:50},/transaction limit/],
    [{WalletDailyLimit:50},/daily wallet limit/],[{WalletCardStatus:'Blocked'},/blocked/]]) {
    f.put('students','child',{AccountRef:'CHILD/001',DisplayName:'Fixture child',BranchId:'main',SchoolSection:'Secondary',
      WalletCardStatus:'Active',OpeningWallet:1000,__scopePath:'students',...limits});
    await assert.rejects(f.pos({},actor,body),message);
  }
  assert.equal(f.list('ledger').length,0); assert.equal(f.list('vendorEarnings').length,0);
  assert.equal(f.get(f.collection,'stock1').Quantity,5);
});

test('vendor wallet checkout atomically links stock, wallet liability, commission, payable and approved settlement',async () => {
  const f = commerceFixture();
  f.put('commerceVendors','v1',{...f.get('commerceVendors','v1'),LoginUsername:'seller',RuleHistory:[rules.normalizeRule({Mode:'Percentage',Rate:10},timestamp)]});
  f.put('students','child',{AccountRef:'CHILD/001',DisplayName:'Fixture child',BranchId:'main',SchoolSection:'Secondary',
    WalletCardId:'CARD-1',WalletCardStatus:'Active',OpeningWallet:1000,WalletPinThreshold:10,
    WalletPinHash:await f.sha256Hex('fixture-secret:1234'),__scopePath:'students'});
  const actor = {...f.actor,role:'Vendor User',username:'seller',allowedSections:['vendorSettlements','tuckShop']};
  const run = (action,body={}) => f.pos({},actor,{action,Section:'tuckShop',...body});
  const lookup = await run('vendorWalletLookup',{AccountRef:'CHILD/001'});
  assert.equal(lookup.account.WalletBalance,1000); assert.equal(lookup.account.WalletSpentToday,0);
  for (const field of ['WalletPinHash','OpeningWallet','__scopePath','WalletCardId','WalletPinThreshold']) assert.equal(lookup.account[field],undefined);
  const body = {Items:[{Reference:'stock1',Quantity:2}],SaleRequestId:'wallet-checkout-001',PaymentMethod:'Student Wallet',
    AccountRef:'CHILD/001',ExpectedAmount:100,Confirmed:true,WalletPin:'1234'};
  await assert.rejects(run('recordVendorWalletPurchase',{...body,WalletPin:'bad'}),/Invalid wallet PIN/);
  assert.equal(f.list('ledger').length,0); assert.equal(f.get(f.collection,'stock1').Quantity,5);
  f.conflict(); await assert.rejects(run('recordVendorWalletPurchase',body),/changed during checkout/);
  assert.equal(f.list('ledger').length,0); assert.equal(f.list('vendorEarnings').length,0);
  const result = await run('recordVendorWalletPurchase',body);
  assert.equal(result.account,undefined); assert.equal(result.balance,undefined);
  assert.equal(f.get(f.collection,'stock1').Quantity,3); assert.equal(f.list('ledger')[0].Debit,100);
  assert.equal(f.get('vendorBalances','v1').NetCents,9000);
  const journal = f.list('accountingJournals')[0];
  assert.equal(journal.TotalDebit,100); assert.equal(journal.TotalCredit,100);
  assert.ok(journal.Lines.some(l => l.AccountCode === '2200' && l.Debit === 100));
  assert.ok(journal.Lines.some(l => l.AccountCode === '2000' && l.Credit === 90));
  assert.ok(journal.Lines.some(l => l.AccountCode === '4090' && l.Credit === 10));
  assert.equal((await run('recordVendorWalletPurchase',body)).replayed,true);
  assert.equal(f.list('ledger').length,1); assert.equal(f.list('vendorEarnings').length,1);
  const refreshed = await run('vendorWalletLookup',{AccountRef:'CHILD/001'});
  assert.equal(refreshed.account.WalletBalance,900); assert.equal(refreshed.account.WalletSpentToday,100);
  assert.equal(f.list('ledger').length,1,'Reading the checkout balance never posts another payment');
  await f.run('requestSettlement',{VendorId:'v1',RequestId:'wallet-claim',From:'1970-01-01',To:'2099-12-31',Amount:90},actor);
  for (const [status,role] of [['Accounts Confirmed','Accounts Officer'],['Admin Reviewed','Admin'],['Approved','Director']]) await f.decision(status,role,'wallet-claim');
  const request = f.get('vendorSettlementRequests','VREQ-wallet-claim');
  await f.run('pay',{VendorId:'v1',SettlementId:request.SettlementId,RecordVersion:request.__updateTime,RequestId:'wallet-settle',
    Amount:90,Date:'2026-10-08',Reference:'BANK-SETTLE',EvidenceReference:'SLIP',approvalPassword:'test-confirmation'});
  assert.equal(f.get('vendorBalances','v1').PaidCents,9000); assert.equal(f.get('vendorBalances','v1').ReservedCents,0);
  assert.equal(f.list('ledger').length,1,'Paying vendor never debits the child wallet again');
});

test('web shell caches vendor assets and printable requisitions retain the complete rule label', async () => {
  const [shell,client,admin] = await Promise.all([
    readFile(new URL('../sw.js',import.meta.url),'utf8'),
    readFile(new URL('../js/vendor-settlements.js',import.meta.url),'utf8'),
    readFile(new URL('../js/admin.js',import.meta.url),'utf8')
  ]);
  assert.match(shell,/\/css\/vendor-settlements\.css/);
  assert.match(shell,/\/js\/vendor-settlements\.js/);
  assert.match(client,/s\.RuleLabel \|\| JSON\.stringify\(s\.RuleSnapshot/);
  assert.match(client,/mounted\?\.destroy\(\)/);
  assert.match(client,/generation === statementGeneration && vendorId === selected/);
  assert.match(client,/filter\.onchange[\s\S]{0,180}statement = null; statementGeneration\+\+/);
  assert.match(client,/if \(!replaced && !currentStatement\)/);
  assert.match(admin,/active === 'vendorSettlements'\)[\s\S]{0,180}summaryEl\.replaceChildren\(\)/);
});

for (const [edition,section] of [['school','tuckShop'],['faith','restaurant'],['organization','organizationStore']]) {
  test(`${edition} actual checkout, approvals and partial payment use shared vendor accounting`, async () => {
    const f = commerceFixture(edition,section);
    const result = await f.commerce.recordManualOrganizationCommerceSale({},section,f.body,f.actor);
    assert.equal(result.sale.Amount,100); assert.equal(f.get(f.collection,'stock1').Quantity,3); assert.equal(f.get('vendorBalances','v1').NetCents,10000);
    assert.ok(result.journal.Lines.some(l => l.AccountCode === '2000' && l.Credit === 100));
    const claim = {VendorId:'v1',RequestId:'claim1',From:'1970-01-01',To:'2099-12-31',Amount:100}; await f.run('requestSettlement',claim,f.actor);
    for (const [Status,role] of [['Accounts Confirmed','Accounts Officer'],['Admin Reviewed','Admin'],['Approved','Director']]) {
      const r = f.get('vendorSettlementRequests','VREQ-claim1'); await f.run('decision',{VendorId:'v1',SettlementId:r.SettlementId,RequestId:`decision-${Status.replaceAll(' ','')}`,
        RecordVersion:r.__updateTime,Status,Notes:'Reviewed',approvalPassword:'test-confirmation'}, {...f.actor,role,username:role});
    }
    const r = f.get('vendorSettlementRequests','VREQ-claim1'); await f.run('pay',{VendorId:'v1',SettlementId:r.SettlementId,RequestId:'pay1',RecordVersion:r.__updateTime,
      Amount:40,Date:'2026-10-08',Reference:'PAY-1',EvidenceReference:'SLIP',approvalPassword:'test-confirmation'},f.actor);
    assert.equal(f.get('vendorBalances','v1').PaidCents,4000); assert.equal(f.get('vendorBalances','v1').ReservedCents,6000);
    assert.equal((await f.commerce.recordManualOrganizationCommerceSale({},section,f.body,f.actor)).replayed,true);
    assert.equal(f.get(f.collection,'stock1').Quantity,3); assert.equal(f.list('vendorEarnings').length,1);
  });
}
test('checkout conflict rolls back stock, earnings and journal together; exact restaurant IDs disambiguate names', async () => {
  const f = commerceFixture('faith','restaurant');
  await assert.rejects(f.commerce.previewOrganizationCommerceSale({},'restaurant',{Items:[{Reference:'Water',Quantity:1}]},f.actor),/exact stock/);
  f.conflict(); await assert.rejects(f.commerce.recordManualOrganizationCommerceSale({},f.section,f.body,f.actor),/Conflict/);
  assert.equal(f.get(f.collection,'stock1').Quantity,5); assert.equal(f.list('vendorEarnings').length,0); assert.equal(f.list('accountingJournals').length,0);
});
test('online initialization earns nothing; verified payment posts vendor earning once', async () => {
  const f = commerceFixture('organization','organizationStore'), env = {PAYSTACK_SECRET_KEY:'fixture-only'};
  await assert.rejects(f.commerce.initializeOnlineOrganizationCommerceSale(env,{url:'https://store.example.test'},f.section,{...f.body,CollectionMode:'Vendor collected'},f.actor),/organisation/);
  await f.commerce.initializeOnlineOrganizationCommerceSale(env,{url:'https://store.example.test'},f.section,{...f.body,CustomerEmail:'fixture@example.test'},f.actor);
  assert.equal(f.list('vendorEarnings').length,0); assert.equal(f.get(f.collection,'stock1').Quantity,5);
  const intent = {SaleId:'sale1',SaleType:f.section};
  const posted = await f.commerce.finalizeOnlineOrganizationCommerceSale(env,intent,{GrossAmount:100,GatewayFee:2,NetAmount:98,Reference:'ONLINE-1',PaidAt:timestamp});
  assert.equal(posted.journal.TotalDebit,100); assert.equal(f.get('vendorBalances','v1').NetCents,10000); assert.equal(f.get(f.collection,'stock1').Quantity,3);
  const replay = await f.commerce.finalizeOnlineOrganizationCommerceSale(env,intent,{GrossAmount:100,GatewayFee:2,NetAmount:98,Reference:'ONLINE-1',PaidAt:timestamp});
  assert.equal(replay.replayed,true); assert.equal(f.list('vendorEarnings').length,1);
});

test('paid online stock shortage holds claims; completing the original issue releases the hold without new earnings', async () => {
  const f = commerceFixture('organization','organizationStore'), env = {PAYSTACK_SECRET_KEY:'fixture-only'};
  await f.commerce.initializeOnlineOrganizationCommerceSale(env,{url:'https://store.example.test'},f.section,{...f.body,CustomerEmail:'fixture@example.test'},f.actor);
  f.put(f.collection,'stock1',{...f.get(f.collection,'stock1'),Quantity:0});
  const result = await f.commerce.finalizeOnlineOrganizationCommerceSale(env,{SaleId:'sale1',SaleType:f.section},{GrossAmount:100,GatewayFee:2,NetAmount:98,Reference:'PAID',PaidAt:timestamp});
  assert.equal(result.sale.InventoryStatus,'Review Required'); assert.equal(f.get('vendorClaimLots','sale1--v1').SettlementHold,true);
  await assert.rejects(f.run('requestSettlement',{VendorId:'v1',RequestId:'claim1',From:'1970-01-01',To:'2099-12-31',Amount:100},f.actor),/review/);
  assert.equal((await f.run('statement',{VendorId:'v1'},f.actor)).balance.Available,0);
  f.put(f.collection,'stock1',{...f.get(f.collection,'stock1'),Quantity:5});
  const body = {VendorId:'v1',EntryId:'sale1--v1',RequestId:'issue1',EvidenceReference:'Delivery slip',Notes:'Stock received and physical order issued',approvalPassword:'test-confirmation'};
  await f.run('completeInventoryReview',body,f.actor,{commerce:f.commerce});
  assert.equal(f.get(f.collection,'stock1').Quantity,3); assert.equal(f.get('vendorClaimLots','sale1--v1').SettlementHold,false);
  assert.equal(f.get('vendorBalances','v1').NetCents,10000); assert.equal(f.get('vendorBalances','v1').ReviewRequired,false);
  assert.equal(f.list('accountingJournals').length,1);
  assert.equal((await f.run('completeInventoryReview',body,f.actor,{commerce:f.commerce})).replayed,true);
  assert.equal(f.get(f.collection,'stock1').Quantity,3);
});

const stock = (extra = {}) => ({ BranchId:'main',OrganisationEdition:'school',SchoolSection:'Secondary',ItemCode:'WATER',ItemName:'Water',
  Quantity:37,Price:100,SalePrice:100,Category:'Drinks',Unit:'bottle',Active:'YES',VendorId:'',Barcode:'keep-barcode',...extra });
const createRow = (extra = {}) => ({RowNumber:2,ItemCode:'WATER',ItemName:'Water',Owner:'v1',Store:'tuckShop',Quantity:'5',Price:'100',...extra});
async function importPreview(f, Mode, Rows, actor = user, RequestId = 'import1') {
  const preview = await f.run('previewProductImport',{Mode,Rows},actor);
  return {preview,body:{Mode,Rows,RequestId,Confirmed:true,PreviewDigest:preview.PreviewDigest}};
}
test('ownership batch previews are read-only and assign existing stock without changing any other fields', async () => {
  const f = fixture([['tuckShopInventory','stock1',stock()]]);
  const original = structuredClone(f.get('tuckShopInventory','stock1'));
  const {preview,body} = await importPreview(f,'assign',[{InventoryId:'stock1',Owner:'Vendor v1',Quantity:'0',Price:'1',Category:'do not use',RowNumber:2}]);
  assert.equal(preview.valid,true); assert.equal(preview.rows[0].Status,'Assign owner'); assert.equal(preview.rows[0].Quantity,37);
  assert.equal(f.commits.length,0);
  const result = await f.run('importProducts',body);
  assert.equal(result.assigned,1);
  const saved = f.get('tuckShopInventory','stock1');
  for (const key of ['ItemName','ItemCode','Quantity','Price','SalePrice','Category','Unit','Active','Barcode','SchoolSection']) assert.equal(saved[key],original[key]);
  assert.equal(saved.VendorId,'v1');
  assert.ok(f.commits[0].every(w=>['tuckShopInventory','accountingAudit','vendorSettlementOperations'].includes(w.collectionPath)));
  assert.equal(f.list('accountingJournals').length,0); assert.equal(f.list('vendorBalances').length,0);
});
test('reassigning a product preserves earlier vendor earnings and allows explicit organisation ownership', async () => {
  const f = fixture([['commerceVendors','v2',vendor('v2')],['tuckShopInventory','stock1',stock({VendorId:'v1'})]]);
  await f.sale(); const earnings = structuredClone(f.get('vendorEarnings','sale1--v1'));
  const first = await importPreview(f,'assign',[{InventoryId:'stock1',Owner:'v2'}]);
  await f.run('importProducts',first.body);
  assert.equal(f.get('tuckShopInventory','stock1').VendorId,'v2'); assert.deepEqual(f.get('vendorEarnings','sale1--v1'),earnings);
  const second = await importPreview(f,'assign',[{InventoryId:'stock1',Owner:'ORGANISATION'}],user,'import2');
  await f.run('importProducts',second.body); assert.equal(f.get('tuckShopInventory','stock1').VendorId,'');
  assert.deepEqual(f.get('vendorEarnings','sale1--v1'),earnings);
});
test('ownership batch retries replay even after stock changes; changed rows cannot reuse the request', async () => {
  const f = fixture([['tuckShopInventory','stock1',stock()]]);
  const {body} = await importPreview(f,'assign',[{InventoryId:'stock1',Owner:'v1'}]);
  await f.run('importProducts',body); f.put('tuckShopInventory','stock1',{...f.get('tuckShopInventory','stock1'),Quantity:36});
  assert.equal((await f.run('importProducts',body)).replayed,true); assert.equal(f.commits.length,1);
  assert.equal(f.get('tuckShopInventory','stock1').Quantity,36);
  await assert.rejects(f.run('importProducts',{...body,Rows:[{InventoryId:'stock1',Owner:'School'}]}),/another operation/);
});
test('stale stock or vendor previews stop the entire batch before any write', async () => {
  for (const change of ['stock','vendor']) {
    const f = fixture([['tuckShopInventory','stock1',stock()],['tuckShopInventory','stock2',stock({ItemCode:'PEN',ItemName:'Pen'})]]);
    const {body} = await importPreview(f,'assign',[{InventoryId:'stock1',Owner:'v1'},{InventoryId:'stock2',Owner:'v1'}]);
    if (change === 'stock') f.put('tuckShopInventory','stock1',{...f.get('tuckShopInventory','stock1'),Quantity:36});
    else f.put('commerceVendors','v1',vendor('v1',{Name:'Updated owner'}));
    await assert.rejects(f.run('importProducts',body),/changed/); assert.equal(f.commits.length,0); assert.equal(f.get('tuckShopInventory','stock2').VendorId,'');
  }
});
test('atomic commit conflict leaves every stock record and operation unchanged', async () => {
  const f = fixture([['tuckShopInventory','stock1',stock()]]);
  const {body} = await importPreview(f,'assign',[{InventoryId:'stock1',Owner:'v1'}]);
  f.conflict(); await assert.rejects(f.run('importProducts',body),/nothing was partially/);
  assert.equal(f.get('tuckShopInventory','stock1').VendorId,''); assert.equal(f.list('vendorSettlementOperations').length,0);
  assert.equal((await f.run('importProducts',body)).assigned,1);
});
test('invalid owner, ambiguous name, inactive vendor, missing stock and duplicate rows block import', async () => {
  const f = fixture([['commerceVendors','v2',vendor('v2',{Name:'Vendor v1'})],['commerceVendors','inactive',vendor('inactive',{Active:'NO'})],['tuckShopInventory','stock1',stock()]]);
  for (const Rows of [[{InventoryId:'stock1',Owner:'missing'}],[{InventoryId:'stock1',Owner:'Vendor v1'}],
    [{InventoryId:'stock1',Owner:'inactive'}],[{InventoryId:'missing',Owner:'v1'}],[{InventoryId:'stock1',Owner:''}],
    [{InventoryId:'stock1',Owner:'v1'},{InventoryId:'stock1',Owner:'v2'}]]) {
    const {preview,body} = await importPreview(f,'assign',Rows); assert.equal(preview.valid,false);
    await assert.rejects(f.run('importProducts',body),/invalid/);
  }
  assert.equal(f.commits.length,0);
  assert.equal((await f.run('previewProductImport',{Mode:'assign',Rows:[{InventoryId:'stock1',Owner:'v1'}]})).valid,true);
});
test('CSV cannot move stock across branches, editions or school sections', async () => {
  const f = fixture([['commerceVendors','primary',vendor('primary',{SchoolSection:'Primary'})],
    ['commerceVendors','other',vendor('other',{ScopeKey:'school--other',BranchId:'other'})],
    ['tuckShopInventory','stock1',stock()],['tuckShopInventory','foreign',stock({BranchId:'other'})],
    ['tuckShopInventory','faith',stock({OrganisationEdition:'faith'})]]);
  for (const row of [{InventoryId:'stock1',Owner:'primary'},{InventoryId:'stock1',Owner:'other'},
    {InventoryId:'foreign',Owner:'v1'},{InventoryId:'faith',Owner:'v1'},{InventoryId:'stock1',Owner:'v1',SchoolSection:'Primary'}]) {
    assert.equal((await f.run('previewProductImport',{Mode:'assign',Rows:[row]})).valid,false);
  }
  assert.equal((await f.run('previewProductImport',{Mode:'assign',Rows:[{InventoryId:'stock1',Owner:'v1'}]}, {...user,schoolSectionAccess:'Primary'})).valid,false);
  assert.equal(f.commits.length,0);
});
test('an out-of-scope stock ID does not disclose its product, quantity, price or owner in a preview', async () => {
  const f = fixture([['tuckShopInventory','foreign',stock({BranchId:'other',ItemName:'Private item',Quantity:1234,Price:9876,VendorId:'private-owner'})]]);
  const preview = await f.run('previewProductImport',{Mode:'assign',Rows:[{InventoryId:'foreign',Owner:'v1'}]});
  assert.equal(preview.valid,false);
  assert.ok(!JSON.stringify(preview).includes('Private item')); assert.ok(!JSON.stringify(preview).includes('private-owner'));
  assert.notEqual(preview.rows[0].Quantity,1234); assert.notEqual(preview.rows[0].Price,9876);
});
test('invalid owners still show permitted existing product details for correction without any writes', async () => {
  const f = fixture([['tuckShopInventory','stock1',stock()]]);
  const preview = await f.run('previewProductImport',{Mode:'assign',Rows:[{InventoryId:'stock1',Owner:'Unknown vendor'}]});
  assert.equal(preview.valid,false); assert.equal(preview.rows[0].ItemName,'Water'); assert.equal(preview.rows[0].Owner,'Unknown vendor');
  assert.equal(preview.rows[0].Quantity,37); assert.equal(f.commits.length,0);
});
test('batch action enforces staff permission, read-only subscription and explicit confirmation', async () => {
  const f = fixture(); const Rows = [createRow()];
  for (const actor of [{...user,allowedSections:[]},{...user,role:'Vendor User'},{...user,username:''}]) {
    await assert.rejects(f.run('previewProductImport',{Mode:'create',Rows},actor));
  }
  const readOnly = {...user,subscriptionReadOnly:true};
  const {preview,body} = await importPreview(f,'create',Rows,readOnly);
  assert.equal(preview.valid,true);
  await assert.rejects(f.run('importProducts',body,readOnly),/read-only/);
  await assert.rejects(f.run('importProducts',{...body,Confirmed:false}),/confirm/);
  assert.equal(f.commits.length,0);
});
test('create-only import skips existing stock; identical product codes for different owners remain separate', async () => {
  const f = fixture([['commerceVendors','v2',vendor('v2')],['tuckShopInventory','old',stock({VendorId:'v1'})]]);
  const old = structuredClone(f.get('tuckShopInventory','old'));
  const {preview,body} = await importPreview(f,'create',[createRow(),createRow({Owner:'v2',RowNumber:3})]);
  assert.equal(preview.rows[0].Status,'Skip existing'); assert.equal(preview.rows[1].Status,'Create');
  const result = await f.run('importProducts',body); assert.equal(result.created,1); assert.equal(result.skipped,1);
  assert.deepEqual(f.get('tuckShopInventory','old'),old); assert.equal(f.list('tuckShopInventory').length,2);
  const replayPreview = await importPreview(f,'create',[createRow({Owner:'v2'})],user,'new-upload');
  assert.equal(replayPreview.preview.rows[0].Status,'Skip existing');
  await f.run('importProducts',replayPreview.body); assert.equal(f.list('tuckShopInventory').length,2);
});
test('preview rejects mismatched item identity and ambiguous legacy SKU instead of overwriting stock', async () => {
  const f = fixture([['tuckShopInventory','stock1',stock({VendorId:'v1'})],['tuckShopInventory','stock2',stock({VendorId:'v1'})]]);
  for (const [Mode,Rows] of [['create',[createRow()]],['assign',[{InventoryId:'stock1',Owner:'v1',ItemName:'Other'}]],
    ['assign',[{InventoryId:'stock1',Owner:'v1',ItemCode:'Other'}]]]) {
    assert.equal((await f.run('previewProductImport',{Mode,Rows})).valid,false);
  }
  assert.equal(f.commits.length,0);
});
test('batch bounds are enforced and audit / operation fingerprints never capture arbitrary credentials', async () => {
  const f = fixture();
  await assert.rejects(f.run('previewProductImport',{Mode:'create',Rows:Array.from({length:21},()=>createRow())}),/20/);
  await assert.rejects(f.run('previewProductImport',{Mode:'create',Rows:[createRow({ItemName:'a'.repeat(62000)})]}),/60 KB/);
  const {body} = await importPreview(f,'create',[createRow({approvalPassword:'secret-row-value',Secret:'secret-row-value'})]);
  await f.run('importProducts',{...body,approvalPassword:'secret-top-level'});
  assert.ok(!JSON.stringify(f.commits).includes('secret-row-value')); assert.ok(!JSON.stringify(f.commits).includes('secret-top-level'));
});
for (const edition of ['school','faith','organization']) test(`${edition} existing-owner assignment and new-product import use the same safe backend`, async () => {
  const Section = edition === 'school' ? 'tuckShop' : 'organizationStore';
  const collection = edition === 'school' ? 'tuckShopInventory' : 'storeItems';
  const f = fixture([['commerceVendors','v1',vendor('v1',{OrganisationEdition:edition,ScopeKey:`${edition}--main`,SchoolSection:edition === 'school' ? 'Secondary' : 'All'})],
    [collection,'stock1',stock({OrganisationEdition:edition,SchoolSection:edition === 'school' ? 'Secondary' : 'All'})]]);
  const actor = {...user,edition};
  const assign = await importPreview(f,'assign',[{InventoryId:'stock1',Owner:'v1',Store:Section}],actor);
  assert.equal((await f.run('importProducts',assign.body,actor)).assigned,1);
  const add = await importPreview(f,'create',[createRow({ItemCode:'PEN',ItemName:'Pen',Store:Section})],actor,'add');
  assert.equal((await f.run('importProducts',add.body,actor)).created,1);
  assert.equal(f.get(collection,'stock1').Quantity,37); assert.equal(f.list('accountingJournals').length,0);
});
test('faith restaurant imports are supported and school users cannot select non-school stores', async () => {
  const f = fixture([['commerceVendors','v1',vendor('v1',{OrganisationEdition:'faith',ScopeKey:'faith--main',SchoolSection:'All'})]]);
  const {body} = await importPreview(f,'create',[createRow({Store:'Restaurant'})],{...user,edition:'faith'});
  await f.run('importProducts',body,{...user,edition:'faith'}); assert.equal(f.list('restaurantInventory').length,1);
  assert.equal((await f.run('previewProductImport',{Mode:'create',Rows:[createRow({Store:'Restaurant',Owner:'School'})]})).valid,false);
});
