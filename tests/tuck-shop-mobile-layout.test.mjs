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
    commerceCart: () => new Map(options.emptyCart ? [] : [['item-1', { item: { ItemName: 'Notebook', SalePrice: 1500, Quantity: 4 }, quantity: 1 }]]),
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
    inventory: options.inventory || [{ ItemName: 'Notebook', SalePrice: 1500, Quantity: 4 }],
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

test('compact catalogue keeps product details and labelled quantity/add controls', () => {
  const html = render({ inventory: [{ ItemName: 'Replacement screen for e-learning tablet', Category: 'Devices', Unit: '11 inches', SalePrice: 250000, Quantity: 16 }] });
  assert.match(html, /<strong>Replacement screen for e-learning tablet<\/strong>/);
  assert.match(html, /Devices · 11 inches/);
  assert.match(html, /₦250000\.00 · 16 in stock/);
  assert.match(html, /aria-label="Quantity for Replacement screen for e-learning tablet"/);
  assert.match(html, /aria-label="Add Replacement screen for e-learning tablet to cart"/);
  assert.match(css, /\.commerce-product\{grid-template-rows:auto auto;gap:3px;min-height:0;padding:6px/);
  assert.match(css, /\.commerce-product strong\{min-height:0;font-size:11px/);
  assert.match(css, /\.commerce-product-action \.commerce-add-button\{flex:0 0 32px;width:32px!important;min-width:32px!important;height:32px!important;min-height:32px!important\}/);
});

test('empty-cart spacing collapses without hiding stock warnings or checkout safeguards', () => {
  const html = render({ emptyCart: true, inventory: [], wallet: { AccountRef: 'DCA/001', DisplayName: 'Ada', WalletBalance: 5000 } });
  assert.match(html, /No priced items in stock/);
  assert.match(html, /class="commerce-cart-lines"><p class="muted commerce-empty">Select an item to begin/);
  assert.match(html, /<button type="submit" disabled>Complete wallet sale/);
  assert.match(css, /\.commerce-cart-lines:has\(>\.commerce-empty\)\{display:none\}/);
  assert.doesNotMatch(css, /\.commerce-empty\{display:none\}/);
});

test('compact page styles cover header, search, buyer, checkout, history and workspace shell', () => {
  assert.match(css, /\.tuck-shop-pos-workspace \.config-card-heading\{gap:8px;padding:9px 10px\}/);
  assert.match(css, /\.commerce-search-label\{gap:3px;margin-bottom:6px/);
  assert.match(css, /\.tuck-shop-step-heading\{gap:7px;margin:8px 0 6px;padding-top:8px\}/);
  assert.match(css, /\.tuck-shop-lookup-form,\.tuck-shop-pos-workspace \.commerce-checkout-form\{gap:8px;padding:8px\}/);
  assert.match(css, /\.tuck-shop-lookup-action\{flex-direction:column;gap:3px;min-height:44px/);
  assert.match(css, /\.tuck-shop-mobile-history>summary\{[^}]*padding:9px 10px/);
  assert.match(css, /#adminPanel:has\(\[data-workspace-section="organizationStore"\]\)\{min-height:0;padding:8px\}/);
  assert.match(css, /#adminPanel:has\(\.commerce-pos-layout\) \.module-workspace-panel\{padding:6px 0 0\}/);
  assert.match(css, /#adminPanel:has\(\.commerce-pos-layout\)>\.workflow-intro h2\{margin:0;font-size:17px;line-height:1\.25\}/);
  assert.match(css, /\.commerce-product-list>\.commerce-empty\{margin:2px 0;padding:8px;font-size:11px;line-height:1\.35\}/);
  assert.match(css, /\.staff-main-content:has\(\.commerce-pos-layout\) \.staff-summary>\.module-summary-card\{gap:1px;min-height:0;padding:7px 9px\}/);
  assert.match(css, /html\[data-theme="dark"\][^\n]+\.tuck-shop-pos-workspace \.commerce-checkout-form>label\{color:#edf4ff\}/);
});

test('shared product backgrounds support light/dark themes and preserve added state', () => {
  assert.match(css, /\.commerce-product:nth-child\(3n\+2\)\{background:#edf8f3\}/);
  assert.match(css, /\.commerce-product:nth-child\(3n\)\{background:#fff7e8\}/);
  assert.match(css, /html\[data-theme="dark"\] \.commerce-product:nth-child\(3n\+2\)\{background:#153b36\}/);
  assert.match(css, /html\[data-theme="dark"\] \.commerce-product:nth-child\(3n\)\{background:#3b3224\}/);
  assert.match(css, /html\[data-theme="dark"\] \.commerce-product:has\(\.commerce-add-button\.is-added\)\{border-color:#2d8168;background:#123a34\}/);
});
