import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [vendorCss, shellCss, vendorJs, html, posJs] = await Promise.all([
  'css/vendor-settlements.css','css/style.css','js/vendor-settlements.js','admin.html','js/vendor-pos.js'
].map(file => readFile(new URL(`../${file}`,import.meta.url),'utf8')));

function assertVersionedAsset(asset, minimumDate) {
  const version = html.split(`${asset}?v=`)[1]?.split('"')[0];
  assert.match(version || '', /^\d{8}-[a-z0-9-]+$/, `${asset} must be cache-versioned`);
  assert.ok(Number(version.slice(0,8)) >= minimumDate, `${asset} must retain this release or a newer one`);
}

test('live products retain labelled table semantics and separate action controls',()=>{
  const products = vendorJs.slice(vendorJs.indexOf("if (tab === 'products')"),vendorJs.indexOf("if (tab === 'settings')"));
  assert.match(products,/class="vendor-table vendor-product-table" role="table" aria-label="Products and sale status"/);
  assert.match(products,/<thead role="rowgroup"><tr role="row"><th scope="col">Product/);
  assert.match(products,/role="cell" data-label="Owner"/);
  assert.match(products,/role="cell" data-label="Stock \/ price"/);
  assert.match(products,/<div class="vendor-product-actions">\s*<button data-edit-product=/);
  assert.match(products,/data-delivery="\$\{index\}"/);
});

test('phone product rows keep all details and actions visible with full-width wrapping',()=>{
  const mobile = vendorCss.slice(vendorCss.indexOf('@media(max-width:600px)'),vendorCss.indexOf('.vendor-form [hidden]'));
  assert.match(mobile,/\.vendor-product-table tr \{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(mobile,/td:first-child, \.vendor-product-table td:last-child \{ grid-column:1\/-1/);
  assert.match(mobile,/content:attr\(data-label\)/);
  assert.match(mobile,/\.vendor-product-actions button:not\(\.vendor-icon-action\) \{ flex:1 0 auto/);
  assert.match(vendorCss,/\.vendor-product-actions \{ display:flex; flex-wrap:wrap; gap:6px/);
  assert.match(vendorCss,/\.vendor-product-actions button \{[^}]*min-height:44px;[^}]*white-space:nowrap; overflow-wrap:normal; word-break:normal/);
  assert.match(vendorCss,/\.vendor-product-actions \.vendor-icon-action \{[^}]*flex:0 0 44px; width:44px; height:44px; padding:0/);
});

test('sales amounts and product request statuses never split across lines on narrow screens',()=>{
  assert.match(posJs,/<th class="vendor-amount">Amount<\/th>/);
  assert.match(posJs,/<td class="vendor-amount">\$\{money\(sale.Amount\)\}<\/td>/);
  assert.match(vendorJs,/<th class="vendor-request-status">Status<\/th>/);
  assert.match(vendorJs,/<td class="vendor-request-status">\$\{esc\(r.Status\)\}<small>\$\{esc\(r.ReviewNotes\)\}/);
  assert.match(vendorCss,/\.vendor-workspace \.vendor-amount, \.vendor-table \.vendor-request-status \{ white-space:nowrap; overflow-wrap:normal; word-break:normal; \}/);
  assert.match(vendorCss,/\.vendor-table-wrap \{ overflow:auto;/);
  for (const asset of ['css/vendor-settlements.css','js/vendor-settlements.js','js/vendor-pos.js']) {
    assertVersionedAsset(asset,20261010);
  }
});

test('all statement figures stay intact, including balances, period totals and payments',()=>{
  for (const field of ['Gross','Refund','SchoolCharge','Net']) {
    assert.ok(vendorJs.includes('<td class="vendor-amount">${money(e.' + field + ')}</td>'));
  }
  assert.match(vendorJs,/<td class="vendor-amount">\$\{money\(p.Amount\)\}<\/td>/);
  assert.match(vendorJs,/<strong class="vendor-amount">\$\{money\(s.availableInPeriod\)\}<\/strong>/);
  assert.match(vendorJs,/<span class="vendor-amount">\$\{money\(s.directChargeDue\)\}<\/span>/);
  assert.match(vendorCss,/\.vendor-metric strong \{[^}]*white-space:nowrap; overflow-wrap:normal; word-break:normal/);
  assert.match(vendorCss,/\.vendor-statement-table \{ min-width:720px; table-layout:auto; \}/);
  assert.match(vendorCss,/\.vendor-payment-table \{ min-width:560px; table-layout:auto; \}/);
  assert.match(vendorJs,/class="vendor-table vendor-statement-table"/);
  assert.match(vendorJs,/class="vendor-table vendor-payment-table"/);
});

test('landscape tablet chrome is compact without reducing touch targets or hiding navigation',()=>{
  const landscapeStart = shellCss.indexOf('/* Short landscape screens');
  const landscape = shellCss.slice(landscapeStart, shellCss.indexOf('.paystack-connection-heading', landscapeStart));
  assert.match(landscape,/@media \(orientation:landscape\) and \(max-height:820px\) and \(max-width:1280px\)/);
  assert.match(landscape,/\.staff-page\{--staff-topbar-height:52px\}/);
  assert.match(landscape,/\.staff-topbar\{height:52px/);
  assert.match(landscape,/min-width:44px;min-height:44px/);
  assert.match(landscape,/\.staff-mobile-nav\{height:calc\(56px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(landscape,/\.mobile-nav-centre\{top:0;[^}]*box-shadow:none/);
  assert.match(landscape,/\.mobile-nav-centre>small\{position:static;top:auto\}/);
  assert.match(landscape,/padding-bottom:calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(landscape,/display:none|zoom:|transform:scale/);
});

test('sticky vendor search follows portrait, desktop and landscape header heights',()=>{
  assert.match(shellCss,/\.staff-page\{--staff-topbar-height:68px/);
  assert.match(shellCss,/@media \(max-width:680px\)\{\s*\.staff-page\{--staff-topbar-height:76px/);
  assert.match(vendorCss,/\.staff-page \.vendor-pos \.commerce-search-label\{top:var\(--staff-topbar-height,68px\)\}/);
  assert.match(html,/css\/style\.css\?v=[^"]*responsive-vendor-navigation/);
  assertVersionedAsset('css/vendor-settlements.css',20261013);
  assertVersionedAsset('js/vendor-settlements.js',20261013);
});
