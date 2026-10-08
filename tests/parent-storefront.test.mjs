import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [script, html, css, serviceWorker] = await Promise.all([
  'js/parent-dashboard.js', 'parent-dashboard.html', 'css/parent-store.css', 'sw.js'
].map((path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
const storeSource = script.slice(script.indexOf('function storeItemMatchesChild'), script.indexOf('async function loadDashboard'));
const viewSource = script.slice(script.indexOf('function parentStoreCatalogView'), script.indexOf('function renderStores'));
const catalogView = vm.runInNewContext(`${viewSource}; parentStoreCatalogView`);
const child = { AccountRef: 'STUDENT-1', BranchId: 'main', SchoolSection: 'secondary', ClassName: 'JSS1' };
const catalog = Array.from({ length: 25 }, (_, index) => ({
  ItemCode: `BOOK-${index + 1}`, ItemName: `Book ${index + 1}`, StoreType: 'Bookstore',
  Category: index % 2 ? 'Textbooks' : 'Exercise Books', Price: (index + 1) * 100,
  Quantity: 500, ClassName: 'All', BranchId: 'main', SchoolSection: 'secondary', Unit: 'pcs'
}));
const codes = (view) => Array.from(view.items, (item) => item.ItemCode);

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {};
    this.value = ''; this.className = ''; this.disabled = false; this.hidden = false; this.open = true;
    this.classList = { add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); } };
  }
  set innerHTML(value) { this.markup = value; this.children = []; }
  get innerHTML() { return this.markup || ''; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  setAttribute(name, value) { this.attributes[name] = value; }
  scrollIntoView() { this.scrolled = true; }
  fire(name) { for (const handler of this.listeners[name] || []) handler({ target: this }); }
}

function storefront(items = catalog, { mobile = false } = {}) {
  const elements = Object.fromEntries([
    'schoolStores', 'storeOrders', 'storeSearch', 'storeSearchSummary', 'storeTypeFilter', 'storeCategoryFilter',
    'storeSort', 'storePagination', 'storePreviousPage', 'storeNextPage', 'storePageStatus', 'storeCartPanel',
    'storeCartShortcut', 'storeCartCount', 'storeCartSummaryCount', 'storeCartTotal', 'storeCartEl',
    'checkoutStoreCartBtn', 'storeCheckoutStatus'
  ].map((name) => [name, new Element()]));
  const context = {
    ...elements, document: { createElement: (tag) => new Element(tag) },
    window: { matchMedia: () => ({ matches: mobile }) },
    childIdentity: (record) => record.AccountRef, selectedChild: () => child,
    dashboard: { storeCatalogByChild: { [child.AccountRef]: items }, storeOrdersByChild: {} },
    storeCart: new Map(), storePage: 1, storePageSize: 12, storeCatalogIdentity: '',
    money: (amount) => `₦${Number(amount).toFixed(2)}`,
    escapeHtml: (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  };
  vm.createContext(context);
  vm.runInContext(storeSource, context);
  context.renderStores(child);
  const controls = (index = 0) => elements.schoolStores.children[index].children[0].children;
  return { context, elements, controls };
}

test('catalog uses twelve products per page, natural names, and bounded page navigation', () => {
  const first = catalogView(catalog);
  assert.deepEqual(codes(first), catalog.slice(0, 12).map((item) => item.ItemCode));
  assert.equal(first.pageCount, 3);
  assert.equal(first.first, 1);
  assert.equal(first.last, 12);
  const final = catalogView(catalog, { page: 99 });
  assert.deepEqual(codes(final), ['BOOK-25']);
  assert.equal(final.page, 3);
  assert.equal(final.first, 25);
  assert.equal(catalogView(catalog, { page: -2 }).page, 1);
});

test('search combines words across product identifiers, category, size and class', () => {
  const items = [{ ...catalog[0], ItemName: 'School Shirt', ItemCode: 'SH-1', Barcode: '9004', SKU: 'BLUE-M',
    StoreType: 'Uniform Store', Category: 'Uniforms', Size: 'Medium', ClassName: 'JSS2' }, catalog[1]];
  assert.deepEqual(codes(catalogView(items, { query: '  SHIRT medium 9004  ' })), ['SH-1']);
  assert.deepEqual(codes(catalogView(items, { query: 'blue-m jss2' })), ['SH-1']);
  assert.equal(catalogView(items, { query: 'shirt textbooks' }).total, 0);
});

test('store and category filters combine with price sorting without mutating the catalog', () => {
  const before = JSON.stringify(catalog);
  const low = catalogView(catalog, { category: 'Textbooks', sort: 'price-low' });
  assert.equal(low.total, 12);
  assert.equal(low.items[0].Price, 200);
  const high = catalogView(catalog, { category: 'Textbooks', sort: 'price-high' });
  assert.equal(high.items[0].Price, 2400);
  assert.equal(catalogView(catalog, { storeType: 'Uniform Store', category: 'Textbooks' }).total, 0);
  assert.equal(JSON.stringify(catalog), before);
});

test('empty results have a valid page and zero range', () => {
  const empty = catalogView(catalog, { query: 'not-in-catalog', page: 8 });
  assert.deepEqual(codes(empty), []);
  assert.equal(empty.page, 1);
  assert.equal(empty.pageCount, 1);
  assert.equal(empty.first, 0);
  assert.equal(empty.last, 0);
});

test('rendering respects the selected child branch and section before paging', () => {
  const foreign = [
    { ...catalog[0], ItemCode: 'FOREIGN-BRANCH', BranchId: 'other' },
    { ...catalog[0], ItemCode: 'FOREIGN-SECTION', SchoolSection: 'primary' }
  ];
  const { elements, context } = storefront([...catalog, ...foreign]);
  assert.equal(elements.schoolStores.children.length, 12);
  assert.equal(elements.storeSearchSummary.textContent, 'Showing 1–12 of 25 items');
  elements.storeNextPage.fire('click');
  elements.storeNextPage.fire('click');
  assert.equal(context.storePage, 3);
  assert.equal(elements.schoolStores.children.length, 1);
  assert.equal(elements.storeNextPage.disabled, true);
  assert.equal(elements.storePageStatus.textContent, 'Page 3 of 3');
});

test('search, category and sort reset pagination, and invalid categories clear when shop changes', () => {
  const shirt = { ...catalog[0], ItemCode: 'SHIRT', ItemName: 'School shirt', StoreType: 'Uniform Store', Category: 'Uniforms' };
  const { elements, context } = storefront([...catalog, shirt]);
  elements.storeNextPage.fire('click');
  elements.storeSearch.value = 'Book 25';
  elements.storeSearch.fire('input');
  assert.equal(context.storePage, 1);
  assert.equal(elements.schoolStores.children.length, 1);
  assert.equal(elements.storePagination.hidden, true);
  elements.storeSearch.value = '';
  elements.storeSearch.fire('input');
  elements.storeCategoryFilter.value = 'Textbooks';
  elements.storeCategoryFilter.fire('change');
  assert.equal(elements.schoolStores.children.length, 12);
  elements.storeTypeFilter.value = 'Uniform Store';
  elements.storeTypeFilter.fire('change');
  assert.equal(elements.storeCategoryFilter.value, '');
  assert.equal(elements.schoolStores.children.length, 1);
  elements.storeTypeFilter.value = '';
  elements.storeTypeFilter.fire('change');
  elements.storeNextPage.fire('click');
  elements.storeSort.value = 'price-high';
  elements.storeSort.fire('change');
  assert.equal(context.storePage, 1);
  assert.match(elements.schoolStores.children[0].innerHTML, /Book 25/);
});

test('cart quantities, totals and added state survive paging and filtering without duplicate adds', () => {
  const { elements, context, controls } = storefront();
  const [quantity, add] = controls();
  quantity.value = '3';
  add.fire('click');
  add.fire('click');
  assert.equal(context.storeCart.size, 1);
  assert.equal(context.storeCart.get('Bookstore|BOOK-1').quantity, 3);
  assert.equal(elements.storeCartCount.textContent, '3');
  assert.equal(elements.storeCartSummaryCount.textContent, '3');
  assert.equal(elements.storeCartTotal.textContent, '₦300.00');
  assert.equal(elements.checkoutStoreCartBtn.disabled, false);
  elements.storeNextPage.fire('click');
  elements.storePreviousPage.fire('click');
  assert.equal(controls()[0].value, '3');
  assert.equal(controls()[1].disabled, true);
  elements.storeSearch.value = 'Book 25';
  elements.storeSearch.fire('input');
  assert.equal(context.storeCart.size, 1);
  assert.equal(elements.storeCartCount.textContent, '3');
  elements.storeCartEl.children[0].children[0].fire('click');
  assert.equal(context.storeCart.size, 0);
  assert.equal(elements.checkoutStoreCartBtn.disabled, true);
  assert.equal(elements.storeCartTotal.textContent, '₦0.00');
  elements.storeSearch.value = '';
  elements.storeSearch.fire('input');
  assert.equal(controls()[1].disabled, false);
});

test('quantities are clamped to stock and sold-out products cannot be added', () => {
  const { context, controls } = storefront([{ ...catalog[0], Quantity: 2 }, { ...catalog[1], Quantity: 0 }]);
  controls()[0].value = '500';
  controls()[1].fire('click');
  assert.equal(context.storeCart.get('Bookstore|BOOK-1').quantity, 2);
  assert.equal(controls(1)[0].disabled, true);
  assert.equal(controls(1)[1].textContent, 'Sold out');
  controls(1)[1].fire('click');
  assert.equal(context.storeCart.size, 1);
});

test('quantity dropdown lists every available unit including large stock counts', () => {
  for (const available of [1, 2, 150, 500]) {
    const { controls } = storefront([{ ...catalog[0], Quantity: available }]);
    const [quantity] = controls();
    assert.equal(quantity.tagName, 'select');
    assert.equal(quantity.value, '1');
    assert.equal(quantity.children.length, available);
    assert.deepEqual(quantity.children.map((option) => option.value), Array.from({ length: available }, (_, index) => String(index + 1)));
    assert.deepEqual(quantity.children.map((option) => option.textContent), quantity.children.map((option) => option.value));
    assert.equal(quantity.attributes['aria-label'], 'Quantity for Book 1');
  }
});

test('narrow phones retain room for the native quantity arrow and cart button labels', () => {
  assert.match(css, /grid-template-columns: 54px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 360px\)\s*\{\s*\.parent-store \.store-cart-action \{ padding: 5px 0; font-size: 10px;/);
});

test('unavailable and invalid stock produce a disabled zero option rather than selectable quantities', () => {
  for (const stock of [0, -2, '', 'invalid', Infinity, NaN]) {
    const { context, controls } = storefront([{ ...catalog[0], Quantity: stock }]);
    const [quantity, add] = controls();
    assert.equal(quantity.children.length, 1);
    assert.equal(quantity.children[0].value, '0');
    assert.equal(quantity.value, '0');
    assert.equal(quantity.disabled, true);
    assert.equal(add.disabled, true);
    add.fire('click');
    assert.equal(context.storeCart.size, 0);
  }
});

test('selecting the highest available quantity adds exactly that quantity and locks the dropdown', () => {
  const { context, elements, controls } = storefront([{ ...catalog[0], Quantity: 500 }]);
  const [quantity, add] = controls();
  quantity.value = quantity.children.at(-1).value;
  add.fire('click');
  assert.equal(context.storeCart.get('Bookstore|BOOK-1').quantity, 500);
  assert.equal(elements.storeCartTotal.textContent, '₦50000.00');
  assert.equal(quantity.disabled, true);
  context.renderStores(child);
  assert.equal(controls()[0].value, '500');
  assert.equal(controls()[0].disabled, true);
  elements.storeCartEl.children[0].children[0].fire('click');
  assert.equal(controls()[0].disabled, false);
  assert.equal(controls()[0].value, '1');
});

test('fractional stock only lists available whole units', () => {
  const { controls } = storefront([{ ...catalog[0], Quantity: 2.9 }]);
  assert.deepEqual(controls()[0].children.map((option) => option.value), ['1', '2']);
});

test('mobile cart starts collapsed and its shortcut opens it', () => {
  const { elements } = storefront(catalog, { mobile: true });
  assert.equal(elements.storeCartPanel.open, false);
  elements.storeCartShortcut.fire('click');
  assert.equal(elements.storeCartPanel.open, true);
  assert.equal(elements.storeCartPanel.scrolled, true);
  assert.equal(storefront().elements.storeCartPanel.open, true);
});

test('checkout still submits the selected child, quantities and idempotency key to the existing payment endpoint', async () => {
  const { elements, context, controls } = storefront();
  controls()[0].value = '2';
  controls()[1].fire('click');
  let request, destination;
  context.window.DynamaxPaymentMethods = { choose: async () => ({ paymentMethod: 'paystack' }) };
  context.window.location = { assign: (url) => { destination = url; } };
  context.newIdempotencyKey = () => 'test-only-checkout-key';
  context.authPayload = () => ({ testSession: true });
  context.setActionLoading = (button, loading) => { button.disabled = loading; };
  context.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, authorizationUrl: 'https://checkout.example.test/demo' }) };
  };
  await elements.checkoutStoreCartBtn.onclick();
  assert.equal(request.url, '/api/init-payment');
  assert.equal(request.options.headers['Idempotency-Key'], 'test-only-checkout-key');
  assert.equal(request.body.accountRef, child.AccountRef);
  assert.equal(request.body.feeCode, 'STORE_CART');
  assert.equal(request.body.amount, 200);
  assert.equal(request.body.testSession, true);
  assert.deepEqual(request.body.storeCart, [{ itemCode: 'BOOK-1', storeType: 'Bookstore', quantity: 2 }]);
  assert.equal(destination, 'https://checkout.example.test/demo');
});

test('cancelling the payment-method chooser leaves the cart intact and makes no payment request', async () => {
  const { elements, context, controls } = storefront();
  controls()[1].fire('click');
  context.window.DynamaxPaymentMethods = { choose: async () => null };
  context.fetch = () => { throw new Error('Payment request must not be made'); };
  await elements.checkoutStoreCartBtn.onclick();
  assert.equal(context.storeCart.size, 1);
  assert.equal(elements.checkoutStoreCartBtn.disabled, false);
});

test('changing children resets catalog controls to the new authorized catalog', () => {
  const { elements, context } = storefront();
  elements.storeSearch.value = 'Book 25';
  elements.storeTypeFilter.value = 'Bookstore';
  elements.storeCategoryFilter.value = 'Textbooks';
  context.storePage = 3;
  const other = { ...child, AccountRef: 'STUDENT-2' };
  context.dashboard.storeCatalogByChild[other.AccountRef] = [{ ...catalog[0], ItemName: 'Other child item' }];
  context.renderStores(other);
  assert.equal(context.storePage, 1);
  assert.equal(elements.storeSearch.value, '');
  assert.equal(elements.storeTypeFilter.value, '');
  assert.equal(elements.storeCategoryFilter.value, '');
  assert.equal(elements.schoolStores.children.length, 1);
  assert.match(elements.schoolStores.children[0].innerHTML, /Other child item/);
});

test('product and category content remains escaped in the new storefront', () => {
  const { elements } = storefront([{ ...catalog[0], ItemName: '<script>bad</script>', Category: '"bad" & category' }]);
  assert.match(elements.schoolStores.children[0].innerHTML, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(elements.schoolStores.children[0].innerHTML, /<script>/);
  assert.match(elements.storeCategoryFilter.innerHTML, /&quot;bad&quot; &amp; category/);
});

test('responsive cards, pagination, cart and order history use scoped accessible markup', () => {
  assert.match(html, /css\/parent-store\.css\?v=20261008-stock-dropdown/);
  assert.match(html, /js\/parent-dashboard\.js\?v=20261008-stock-dropdown/);
  assert.match(html, /id="storePagination"[^>]*aria-label="Store pages" hidden/);
  assert.match(html, /<details id="storeCartPanel"[^>]*open>/);
  assert.match(html, /<details class="parent-store-orders">/);
  assert.match(css, /\.parent-store-grid\s*\{[^}]*repeat\(auto-fill, minmax\(160px, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.parent-store-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /html\[data-theme="dark"\] \.parent-store-product/);
  assert.match(css, /\.parent-store \.parent-store-header h2\s*\{[^}]*color: var\(--store-text\)/);
  assert.match(serviceWorker, /SHELL\.push\('\/css\/parent-store\.css'\)/);
});
