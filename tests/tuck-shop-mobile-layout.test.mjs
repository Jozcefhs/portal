import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const [admin, css] = await Promise.all([
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../css/style.css', import.meta.url), 'utf8')
]);
const start = admin.indexOf('function tuckShopLookupIcon(');
const end = admin.indexOf('async function searchTuckShopCustomer(', start);

function render(options = {}) {
  const context = {
    tuckShopLastSale: null,
    tuckShopCatalogSearch: '',
    tuckShopCustomerSearch: '',
    tuckShopCustomerType: options.customerType || 'Student',
    tuckShopWalletAccount: options.wallet || null,
    tuckShopStaffCustomer: options.staff || null,
    commerceCart: () => new Map([['item-1', { item: { ItemName: 'Notebook', SalePrice: 1500, Quantity: 4 }, quantity: 1 }]]),
    commerceItemPrice: (item) => Number(item.SalePrice),
    commerceItemStock: (item) => Number(item.Quantity),
    commerceItemReference: () => 'item-1',
    commerceQuantityOptions: () => '<option value="1">1</option>',
    commerceReceiptPreview: () => '',
    table: () => '<h2>Recent Tuck Shop Sales</h2><div class="admin-table-wrap"></div>',
    clean: (value) => String(value ?? '').trim(),
    escapeHtml: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    money: (value) => `₦${Number(value).toFixed(2)}`
  };
  return runInNewContext(`${admin.slice(start, end)}\nrenderTuckShopPOS`, context)({
    inventory: [{ ItemName: 'Notebook', SalePrice: 1500, Quantity: 4 }],
    sales: [{ SaleNo: 'TUK-001', CustomerName: 'Ada', PaymentMethod: 'Wallet', Amount: 1500, SaleDate: '2026-09-30' }]
  });
}

test('mobile student checkout groups lookup methods and hides payment until a wallet is found', () => {
  const html = render();
  assert.match(html, /class="tuck-shop-lookup-actions" role="group"/);
  assert.match(html, /aria-label="Find student wallet"/);
  assert.match(html, /aria-label="Scan NFC student card"/);
  assert.match(html, /aria-label="Find student by face"/);
  assert.match(html, /<details class="tuck-shop-manual-lookup">/);
  assert.match(html, /name="WalletCardId"/);
  assert.match(html, /name="AccountRef"/);
  assert.doesNotMatch(html, /id="walletPurchaseForm"/);
  assert.match(html, /Find the student wallet to continue to payment/);
});

test('resolved customer shows a complete checkout and recent sales have a mobile view', () => {
  const html = render({ wallet: { AccountRef: 'DCA/001', DisplayName: 'Ada', WalletBalance: 5000 } });
  assert.match(html, /id="walletPurchaseForm"/);
  assert.match(html, /name="WalletPin"/);
  assert.match(html, /Complete wallet sale/);
  assert.match(html, /class="tuck-shop-mobile-history"/);
  assert.match(html, /class="tuck-shop-sale-card"/);
  assert.match(html, /data-commerce-print="TUK-001"/);
  assert.match(css, /@media\(max-width:680px\)\{[\s\S]*?\.tuck-shop-desktop-history\{display:none\}/);
  assert.match(css, /\.tuck-shop-lookup-actions\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test('staff lookup and checkout remain available', () => {
  const unresolved = render({ customerType: 'Staff' });
  assert.match(unresolved, /id="tuckShopStaffLookupForm"/);
  assert.doesNotMatch(unresolved, /id="tuckShopStaffSaleForm"/);
  const resolved = render({ customerType: 'Staff', staff: { CustomerRef: 'staff-1', DisplayName: 'Officer' } });
  assert.match(resolved, /id="tuckShopStaffSaleForm"/);
  assert.match(resolved, /Complete staff sale/);
});
