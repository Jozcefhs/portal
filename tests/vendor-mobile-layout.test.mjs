import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const [vendorCss, shellCss, vendorJs, html, posJs] = await Promise.all([
  'css/vendor-settlements.css','css/style.css','js/vendor-settlements.js','admin.html','js/vendor-pos.js'
].map(file => readFile(new URL(`../${file}`,import.meta.url),'utf8')));

test('live products retain labelled table semantics and separate action controls',()=>{
  const products = vendorJs.slice(vendorJs.indexOf("if (tab === 'products')"),vendorJs.indexOf("if (tab === 'settings')"));
  assert.match(products,/class="vendor-table vendor-product-table" role="table" aria-label="Live products"/);
  assert.match(products,/<thead role="rowgroup"><tr role="row"><th scope="col">Product/);
  assert.match(products,/role="cell" data-label="Owner"/);
  assert.match(products,/role="cell" data-label="Stock \/ price"/);
  assert.match(products,/<div class="vendor-product-actions"><button data-edit-product=/);
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
  assert.match(vendorCss,/\.vendor-table \.vendor-amount, \.vendor-table \.vendor-request-status \{ white-space:nowrap; overflow-wrap:normal; word-break:normal; \}/);
  assert.match(vendorCss,/\.vendor-table-wrap \{ overflow:auto;/);
  for (const asset of ['css/vendor-settlements.css','js/vendor-settlements.js','js/vendor-pos.js']) {
    assert.ok(html.includes(asset + '?v=') && html.split(asset + '?v=')[1].split('"')[0].endsWith('-nowrap-columns'));
  }
});

test('landscape tablet chrome is compact without reducing touch targets or hiding navigation',()=>{
  const landscape = shellCss.slice(shellCss.indexOf('/* Short landscape screens'));
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
  assert.match(html,/css\/vendor-settlements\.css\?v=20261010-responsive-vendor-navigation/);
  assert.match(html,/js\/vendor-settlements\.js\?v=20261010-responsive-vendor-navigation/);
});
