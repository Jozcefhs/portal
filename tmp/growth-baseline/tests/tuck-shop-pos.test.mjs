import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildOrganizationCommerceJournal } from '../functions/lib/organization-commerce.js';
import { buildWalletPurchaseAccountingJournal } from '../functions/api/backend.js';

const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [backend, commerce, department, customers, admin] = await Promise.all([
  source('../functions/api/backend.js'),
  source('../functions/lib/organization-commerce.js'),
  source('../functions/api/staff-departments.js'),
  source('../functions/lib/school-tuck-shop.js'),
  source('../js/admin.js')
]);

test('staff tuck-shop sale posts cash and revenue for its item-derived total', () => {
  const journal = buildOrganizationCommerceJournal({
    SaleNo: 'TUK-SALE-TEST', SaleType: 'tuckShop', Department: 'Tuck Shop',
    CustomerName: 'Staff Member', CustomerType: 'Staff', CustomerRef: 'staff.one',
    PaymentMethod: 'Cash', Amount: 1800, BranchId: 'main', OrganisationEdition: 'school'
  });
  assert.equal(journal.TotalDebit, 1800);
  assert.equal(journal.TotalCredit, 1800);
  assert.deepEqual(journal.Lines.map((row) => [row.AccountCode, row.Debit, row.Credit]), [
    ['1010', 1800, 0], ['4040', 0, 1800]
  ]);
});

test('student tuck-shop sale releases wallet liability into sales revenue', () => {
  const journal = buildWalletPurchaseAccountingJournal({
    LedgerNo: 'WALLET-TUK-SALE-TEST', EntryType: 'Wallet Purchase',
    Department: 'Tuck Shop', Debit: 1800, BranchId: 'main', AccountRef: 'DCA/26/001'
  });
  assert.deepEqual(journal.Lines.map((row) => [row.AccountCode, row.Debit, row.Credit]), [
    ['2200', 1800, 0], ['4040', 0, 1800]
  ]);
});

test('tuck-shop cart resolves immutable inventory IDs and checks saved prices and stock', () => {
  assert.match(commerce, /if \(section === 'tuckShop'\) \{\s*return rows\.find\(\(row\) => lower\(row\.__id\) === wanted\)/);
  assert.match(commerce, /const price = money\(item\.Price \?\? item\.SalePrice\)/);
  assert.match(commerce, /requested\.Quantity > available/);
  assert.match(commerce, /prepareTuckShopWalletCart/);
  assert.match(commerce, /updateTime: clean\(item\.__updateTime\)/);
  assert.match(admin, /function tuckShopSaleItems\(\) \{[\s\S]*?\(\[Reference, entry\]\) => \(\{ Reference, Quantity:/);
});

test('student wallet checkout commits stock, movement, ledger, journal and sale together', () => {
  const checkout = backend.slice(backend.indexOf('export async function recordWalletPurchase'),
    backend.indexOf('async function saveClinicRecord'));
  assert.match(checkout, /prepareTuckShopWalletCart\(env/);
  assert.match(checkout, /amount = pricedSale\.total/);
  assert.match(checkout, /amount > asMoneyNumber\(account\.WalletBalance\)/);
  assert.match(checkout, /await batchCommitDocuments\(env, \[/);
  for (const collection of ['ledger', 'accountingJournals', 'organizationCommerceSales']) {
    assert.match(checkout, new RegExp(`collectionPath: '${collection}'`));
  }
  assert.match(checkout, /\.\.\.pricedSale\.writes/);
  assert.match(checkout, /student\.__updateTime/);
});

test('staff checkout verifies a real branch-scoped staff customer and uses sale idempotency', () => {
  assert.match(customers, /borrowerFrom\(body\.CustomerRef, 'Staff', \[\], staff\)/);
  assert.match(customers, /recordManualOrganizationCommerceSale\(env, 'tuckShop'/);
  assert.match(department, /'tuckShop:recordsale': 'staff-department-staff-sale'/);
  assert.match(department, /recordTuckShopStaffSale\(env, user, body\)/);
  assert.match(admin, /id="tuckShopStaffSaleForm"/);
  assert.match(admin, /tuckShopSaleRequestId \|\|= `TUK-SALE-\$\{newIdempotencyKey\(\)\}`/);
});
