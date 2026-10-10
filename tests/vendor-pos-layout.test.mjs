import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const source = await readFile(new URL('../js/vendor-pos.js',import.meta.url),'utf8');
const css = await readFile(new URL('../css/vendor-settlements.css',import.meta.url),'utf8');
const sharedCss = await readFile(new URL('../css/style.css',import.meta.url),'utf8');

// Lightweight event/markup harness: browser QA covers actual DOM and responsive layout.
function rootHarness() {
  let html = '', nodes = [];
  const decode = value => String(value ?? '').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
  const matches = (node,selector) => {
    if (node.removed) return false;
    if (selector.includes(',')) return selector.split(',').some(part => matches(node,part));
    const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute) return Object.hasOwn(node.attrs,attribute[1]) && (attribute[2] === undefined || node.attrs[attribute[1]] === attribute[2]);
    return node.tagName.toLowerCase() === selector;
  };
  const root = {
    get innerHTML() {return html;},
    set innerHTML(value) {
      nodes.forEach(node => {node.isConnected = false;}); html = value; nodes = [];
      for (const match of html.matchAll(/<(button|input|select|article|p|form|details|div|datalist|span)\b([^>]*)>/g)) {
        const attrs = {};
        for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[attr[1]] = decode(attr[2]);
        const node = {attrs,position:match.index,tagName:match[1].toUpperCase(),dataset:{},name:attrs.name,
          value:attrs.value || '',disabled:Object.hasOwn(attrs,'disabled'),hidden:Object.hasOwn(attrs,'hidden'),
          open:Object.hasOwn(attrs,'open'),isConnected:true,checked:false,classList:{toggle(){}},
          addEventListener(event,handler) {this[`on${event}`] = handler;},
          remove() {this.removed = true;},closest() {return this;},focus() {},
          querySelector:selector => root.querySelector(selector),querySelectorAll:selector => root.querySelectorAll(selector)};
        for (const [key,value] of Object.entries(attrs)) if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())] = value;
        if (node.tagName === 'SELECT') {
          const options = html.slice(match.index + match[0].length).split('</select>')[0];
          const selected = [...options.matchAll(/<option([^>]*)>([^<]*)<\/option>/g)];
          const option = selected.find(row => /\bselected\b/.test(row[1])) || selected[0];
          node.value = option ? decode(option[1].match(/value="([^"]*)"/)?.[1] ?? option[2]) : '';
        }
        nodes.push(node);
      }
      for (const form of root.querySelectorAll('form')) {
        const end = html.indexOf('</form>',form.position);
        const children = nodes.filter(node => node.position > form.position && node.position < end);
        form.elements = Object.fromEntries(children.filter(node=>node.name).map(node=>[node.name,node]));
        form.querySelector = selector => children.find(node=>matches(node,selector)) || null;
        form.requestSubmit = () => form.onsubmit({preventDefault(){}});
      }
    },
    querySelector:selector => nodes.find(node=>matches(node,selector)) || null,
    querySelectorAll:selector => nodes.filter(node=>matches(node,selector))
  };
  return root;
}

async function fixture(section = 'tuckShop', options = {}) {
  const root = rootHarness(), window = {}, calls = [];
  const products = options.products || [{InventoryId:'stock-1',ItemCode:'WATER',ItemName:'Water',Category:'Drinks',Unit:'bottle',Price:100,Quantity:5}];
  let failSale = false;
  const request = async(action,body) => {
    calls.push({action,body:structuredClone(body)});
    if (action === 'salesBootstrap') return {products,sellingEnabled:options.enabled !== false,message:'Linked vendor products only.'};
    if (action === 'recentVendorSales') {if(options.historyError) throw new Error(options.historyError); return options.historyRequest ? options.historyRequest(body) : {sales:options.recentSales || []};}
    if (action === 'vendorCustomerSearch') return {customers:options.customers || [{CustomerRef:'FIXTURE/001',CustomerName:'Fixture child',Detail:'Grade 7'}]};
    if (action === 'vendorWalletLookup') {if(options.lookupError) throw new Error(options.lookupError); return {account:{AccountRef:'FIXTURE/001',DisplayName:'Fixture child',WalletBalance:30900,WalletSpentToday:200,...options.walletSummary}};}
    if (action === 'previewVendorSale') return {Amount:333};
    if (failSale) throw new Error('Fixture response interrupted; retry the same checkout.');
    return {message:'Fixture sale recorded.',sale:{SaleNo:'FIXTURE-SALE',Amount:body.ExpectedAmount}};
  };
  runInNewContext(source,{window,Intl,AbortController,setTimeout,clearTimeout,crypto:webcrypto});
  const mounted = window.DynamaxVendorPOS.mount(root,request,section,options.tools);
  await new Promise(resolve=>setImmediate(resolve));
  const input = (name,value) => {const field=root.querySelector(`[name="${name}"]`),form=root.querySelectorAll('form').find(form=>form.elements[name]===field); field.value=value; form.oninput({target:field});};
  const find = () => root.querySelector('[data-lookup-form]').requestSubmit();
  return {root,calls,input,find,mounted,setFailure:value=>{failSale=value;}};
}

test('empty checkout has no space-wasting placeholders but still requires products and a customer',async()=>{
  const f=await fixture();
  assert.doesNotMatch(f.root.innerHTML,/Select an item to begin|to continue to payment|data-wallet-prompt/);
  assert.equal(f.root.querySelector('[data-cart-lines]').hidden,true);
  assert.equal(f.root.querySelector('[data-payment-form]').hidden,true);
  f.root.querySelector('[data-add]').onclick();assert.equal(f.root.querySelector('[data-cart-lines]').hidden,false);
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  assert.equal(f.calls.some(row=>row.action.startsWith('record')),false);f.mounted.destroy();
});

test('vendor search is sticky under the staff header, without a clipping scroll ancestor',()=>{
  assert.match(css,/\.vendor-pos \.commerce-search-label\{position:sticky;top:0;z-index:13/);
  assert.match(css,/\.staff-page \.vendor-pos \.commerce-search-label\{top:68px\}/);
  assert.match(css,/@media\(max-width:680px\)\{\s*\.staff-page \.vendor-pos \.commerce-search-label\{top:76px\}/);
  assert.match(css,/\.vendor-pos \.vendor-pos-shell\{[^}]*overflow:clip/);
});

test('vendor history loads only when expanded and does not alter the current cart or customer',async()=>{
  const recentSales=[{SaleNo:'RECENT-1',SaleDate:'2026-10-10T12:00:00Z',CustomerName:'<script>private</script>',
    PaymentMethod:'Student Wallet',CollectionMode:'School collected',Amount:100,Items:[{ItemName:'Water',Quantity:1}]}];
  const f=await fixture('tuckShop',{recentSales});
  assert.match(f.root.innerHTML,/Recent Tuck Shop Sales/);assert.equal(f.calls.length,1);
  f.root.querySelector('[data-add]').onclick();f.input('AccountRef','FIXTURE/001');await f.find();
  const history=f.root.querySelector('[data-history]');history.open=true;history.ontoggle({target:history});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(f.root.querySelector('[data-history-content]').innerHTML,/RECENT-1|Water × 1/);
  assert.doesNotMatch(f.root.querySelector('[data-history-content]').innerHTML,/<script>/);
  assert.equal(f.root.querySelector('[data-history-count]').textContent,'1');
  assert.equal(f.root.querySelector('[data-complete]').disabled,false);
  assert.match(f.root.innerHTML,/data-customer/);assert.equal(f.calls.filter(row=>row.action.startsWith('record')).length,0);
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.filter(row=>row.action==='recentVendorSales').length,2,'successful sale refreshes open history');
  assert.equal(f.root.querySelector('[data-history]').open,true);f.mounted.destroy();
});

test('history failures are visible and retryable without disabling checkout',async()=>{
  const f=await fixture('restaurant',{historyError:'Recent sales unavailable'});
  const history=f.root.querySelector('[data-history]');history.open=true;history.ontoggle({target:history});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(f.root.querySelector('[data-history-content]').innerHTML,/Recent sales unavailable/);
  assert.doesNotMatch(f.root.querySelector('[data-history-content]').innerHTML,/No recent sales/);
  f.root.querySelector('[data-add]').onclick();assert.equal(f.root.querySelector('[data-complete]').disabled,false);
  assert.equal(f.root.querySelector('[data-history-refresh]').disabled,false);f.mounted.destroy();
});

test('slow history reads do not disable the cart and results cannot update an unmounted counter',async()=>{
  let resolveHistory;
  const f=await fixture('restaurant',{historyRequest:()=>new Promise(resolve=>{resolveHistory=resolve;})});
  const history=f.root.querySelector('[data-history]');history.open=true;history.ontoggle({target:history});
  f.root.querySelector('[data-add]').onclick();assert.equal(f.root.querySelector('[data-complete]').disabled,false);
  assert.equal(f.root.querySelector('[data-refresh]').disabled,false);
  const before=f.root.innerHTML;f.mounted.destroy();resolveHistory({sales:[]});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.root.innerHTML,before);
});

test('vendor counter uses the original shared POS structure, colours and compact mobile catalogue',async () => {
  const f = await fixture();
  for (const component of ['tuck-shop-pos-workspace','config-card-heading','commerce-pos-layout','commerce-catalog','commerce-product-list','commerce-product-action','commerce-cart-title','commerce-cart-lines','tuck-shop-step-heading','tuck-shop-lookup-form']) assert.ok(f.root.innerHTML.includes(component),component);
  assert.match(f.root.innerHTML,/Stock-linked checkout/);
  assert.match(f.root.innerHTML,/Drinks · bottle/);
  assert.match(f.root.innerHTML,/aria-label="Quantity for Water"/);
  assert.match(f.root.innerHTML,/aria-label="Add Water to cart"/);
  assert.doesNotMatch(f.root.innerHTML,/Stock in \/ out|Purchase history|Save product ownership|Wallet balance|Inventory<\/strong>/);
  for(const label of ['Find student','Find wallet','Scan card','Use face','Student · wallet','Staff · cash, transfer or POS']) assert.ok(f.root.innerHTML.includes(label));
  assert.equal(f.root.querySelector('[data-manual-lookup]').open,false);
  assert.match(sharedCss,/\.commerce-product:nth-child\(3n\+2\)\{background:#edf8f3\}/);
  assert.match(sharedCss,/@media\(max-width:680px\)\{\s*\.commerce-product-list\{grid-template-columns:repeat\(auto-fill,112px\)/);
  assert.doesNotMatch(css,/\.vendor-pos-products\{display:grid|\.vendor-pos-layout\{/);
  assert.doesNotMatch(css,/\.vendor-pos-customer\{grid-template-columns:/);
  assert.match(css,/\.staff-page:has\(\.vendor-workspace\) \.staff-sidebar>\.staff-tabs\{align-content:start\}/);
  f.mounted.destroy();
});

test('vendor counters remove the redundant intro and put Refresh at the right of the POS bar',async () => {
  for (const section of ['tuckShop','restaurant','organizationStore']) {
    const f=await fixture(section);
    assert.doesNotMatch(f.root.innerHTML, /vendor-header workflow-intro|Sell your linked vendors|Linked vendor products only/);
    assert.match(f.root.innerHTML, /vendor-pos-tabs[^>]*>[\s\S]*?data-pos-tab[\s\S]*?Point of sale[\s\S]*?<button type="button" data-refresh>Refresh<\/button><\/div>/);
    assert.equal(f.root.querySelector('[data-status]').hidden,true);
    assert.ok(f.root.innerHTML.indexOf('data-status') > f.root.innerHTML.indexOf('aria-label="Vendor sales cart"'), 'important notices stay beside checkout');
    f.mounted.destroy();
  }
  assert.match(css, /\.vendor-pos \.vendor-pos-tabs\{margin:0 0 12px\}/);
  assert.match(css, /\.vendor-pos \.vendor-pos-tabs \[data-refresh\]\{margin-left:auto;[^}]*background:#1768e8/);
  assert.match(css, /@media\(min-width:681px\)\{\s*\.vendor-pos \.commerce-product-list\{min-height:358px;max-height:max\(358px,calc\(100dvh - 300px\)\)\}/);
  assert.match(css, /@media\(min-width:981px\)\{\s*\.vendor-pos \.commerce-product-list\{min-height:max\(358px,calc\(100dvh - 300px\)\);max-height:none\}/);
});

test('relocated Refresh reloads stock and keeps the routine bootstrap notice hidden',async () => {
  const products=[{InventoryId:'stock-1',ItemName:'Water',Quantity:5,Price:100}];
  const f=await fixture('tuckShop',{products});
  products[0].Quantity=3;
  await f.root.querySelector('[data-refresh]').onclick();
  assert.match(f.root.innerHTML, /3 in stock/);
  assert.equal(f.calls.filter(row=>row.action==='salesBootstrap').length,2);
  assert.equal(f.calls.some(row=>row.action.startsWith('record')),false);
  assert.equal(f.root.querySelector('[data-status]').hidden,true);
  f.mounted.destroy();
});

test('compact header preserves visible checkout errors, loading notices and receipt confirmation',async () => {
  const f=await fixture('restaurant');
  f.root.querySelector('[data-add]').onclick(); f.setFailure(true);
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  assert.equal(f.root.querySelector('[data-status]').hidden,false);
  assert.match(f.root.querySelector('[data-status]').textContent,/interrupted; retry the same checkout/);
  f.setFailure(false); await f.root.querySelector('[data-payment-form]').requestSubmit();
  assert.equal(f.root.querySelector('[data-status]').hidden,false);
  assert.match(f.root.querySelector('[data-status]').textContent,/Receipt FIXTURE-SALE; total ₦100\.00/);
  f.mounted.destroy();
});

test('shared POS gives extra width to the catalogue and bounds card and cart widths', () => {
  assert.match(sharedCss,/@media\(min-width:981px\)\{\s*\.commerce-pos-layout\{grid-template-columns:minmax\(0,1fr\) 380px\}/);
  assert.match(sharedCss,/\.commerce-pos-layout>\.commerce-cart\{[^}]*max-width:380px;justify-self:start/);
  assert.match(sharedCss,/@media\(max-width:680px\)\{\s*\.commerce-pos-layout>\.commerce-cart\{max-width:none\}/);
  const catalogueRules = [...sharedCss.matchAll(/\.commerce-product-list\{([^}]*)\}/g)].map(match => match[1]);
  assert.ok(catalogueRules.some(rule => rule.includes('grid-template-columns:repeat(auto-fill,128px)')));
  assert.ok(catalogueRules.every(rule => !/grid-template-columns:[^;]*1fr/.test(rule)), 'No tablet or phone override should stretch cards into fractional columns');
});

test('original and vendor tuck shops share the compact inline search row', async () => {
  const original = await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
  const f = await fixture();
  assert.match(original, /class="commerce-search-label"><span>Search items · <span data-tuck-shop-product-count[^]*?<input id="tuckShopCatalogSearch" type="search"/);
  assert.match(f.root.innerHTML, /class="commerce-search-label"><span>Search items · <span data-product-count[^]*?<input data-search type="search"/);
  assert.equal(f.root.querySelector('[data-product-count]').textContent,'1 product');
  assert.match(sharedCss, /\.tuck-shop-pos-workspace \.commerce-search-label\{grid-template-columns:max-content minmax\(0,360px\);align-items:center;gap:10px\}/);
  assert.match(sharedCss, /\.tuck-shop-pos-workspace \.commerce-search-label input\{width:100%;min-width:0\}/);
  f.mounted.destroy();
});

test('wide tuck-shop catalogue stretches to the checkout row without unbounded stock or stretched cards', () => {
  assert.match(sharedCss, /@media\(min-width:981px\)\{\s*\.tuck-shop-pos-workspace \.commerce-catalog\{display:flex;flex-direction:column;align-self:stretch\}/);
  assert.match(sharedCss, /\.tuck-shop-pos-workspace \.commerce-product-list\{flex:1 1 0;height:0;min-height:358px;max-height:none\}/);
  assert.match(sharedCss, /\.commerce-product-list\{[\s\S]*?align-content:start;[\s\S]*?overflow-y:auto;/);
  assert.match(sharedCss, /@media\(max-width:680px\)\{[\s\S]*?\.tuck-shop-pos-workspace \.commerce-product-list\{max-height:clamp\(286px,36dvh,324px\)\}/);
});

test('quantity dropdowns respect stock and checkout submits once without preview or extra confirmation',async () => {
  const f = await fixture('restaurant');
  const addQty=f.root.querySelector('[data-add-quantity]'); addQty.value='3'; addQty.onchange();
  f.root.querySelector('[data-add]').onclick();
  assert.match(f.root.innerHTML,/<select data-quantity="stock-1"[^>]*>[^]*?<option value="3" selected>/);
  assert.match(f.root.innerHTML,/₦300\.00/);
  assert.equal(f.root.querySelector('[data-preview]'),null);
  assert.equal(f.root.querySelector('[name="Confirmed"]'),null);
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  const body=f.calls.find(row=>row.action==='recordVendorSale').body;
  assert.deepEqual(body.Items,[{Reference:'stock-1',Quantity:3}]);
  assert.equal(body.Section,'restaurant'); assert.equal(body.Price,undefined);
  assert.equal(body.ExpectedAmount,300);
  assert.equal(f.calls.some(row=>row.action==='previewVendorSale'),false);
  // A new cart still rejects quantities above stock before any write.
  f.root.querySelector('[data-add-quantity]').value='3'; f.root.querySelector('[data-add-quantity]').onchange();
  f.root.querySelector('[data-add]').onclick();
  f.root.querySelector('[data-add]').onclick(); // 3 + 3 exceeds available 5.
  assert.match(f.root.querySelector('[data-status]').textContent,/exceeds available stock/);
  f.mounted.destroy();
});

test('product search persists after cart redraws and includes units',async () => {
  const f = await fixture('organizationStore');
  f.root.querySelector('[data-search]').oninput({target:{value:'bottle'}});
  f.root.querySelector('[data-add]').onclick();
  assert.match(f.root.innerHTML,/data-search type="search" value="bottle"/);
  assert.equal(f.root.querySelector('[data-product]').hidden,false);
  assert.equal(f.root.querySelector('[data-complete]').disabled,false);
  assert.match(f.root.innerHTML,/Calculated total<\/span><strong>₦100\.00/);
  f.root.querySelector('[data-search]').oninput({target:{value:'nonexistent'}});
  assert.equal(f.root.querySelector('[data-product]').hidden,true);
  assert.equal(f.root.querySelector('[data-search-empty]').hidden,false);
  assert.equal(f.root.querySelector('[data-product-count]').textContent,'0 of 1 products');
  f.root.querySelector('[data-search]').oninput({target:{value:''}});
  assert.equal(f.root.querySelector('[data-product-count]').textContent,'1 product');
  f.mounted.destroy();
});

test('wallet checkout shows a limited summary and clears previous customer and PIN when identity changes',async () => {
  const f = await fixture();
  f.root.querySelector('[data-add]').onclick();
  assert.equal(f.root.querySelector('[data-payment]').hidden,true);
  assert.equal(f.root.querySelector('[name="WalletPin"]'),null);
  f.input('WalletCardId','FIXTURE-CARD');
  await f.find();
  assert.match(f.root.innerHTML,/Fixture child/);
  assert.equal(f.root.querySelector('[data-payment]').hidden,false);
  f.input('WalletPin','1234');
  f.input('AccountRef','FIXTURE/002');
  assert.equal(f.root.querySelector('[data-customer]'),null);
  assert.equal(f.root.querySelector('[name="WalletPin"]'),null);
  assert.equal(f.root.querySelector('[data-payment]').hidden,true);
  assert.equal(f.root.querySelector('[data-complete]'),null);
  await f.find();
  assert.equal(f.root.querySelector('[name="WalletPin"]').value,'');
  assert.equal(f.root.querySelector('[data-lookup-form]').elements.WalletCardId.value,'');
  f.mounted.destroy();
});

test('failed checkout keeps the same request ID without another confirmation, success clears the cart',async () => {
  const f = await fixture('restaurant');
  f.root.querySelector('[data-add]').onclick();
  f.setFailure(true);
  await f.root.querySelector('form').onsubmit({preventDefault(){}});
  f.setFailure(false);
  await f.root.querySelector('form').onsubmit({preventDefault(){}});
  const sales=f.calls.filter(row=>row.action==='recordVendorSale');
  assert.equal(sales.length,2);
  assert.equal(sales[0].body.SaleRequestId,sales[1].body.SaleRequestId);
  assert.equal(sales[0].body.ExpectedAmount,100);
  assert.equal(sales[0].body.Confirmed,true);
  assert.equal(f.root.querySelector('[data-cart-lines]').hidden,true);
  assert.equal(f.root.querySelector('[data-complete]').disabled,true);
  f.mounted.destroy();
});

test('disabled sales and out-of-stock products retain stock and permission guards',async () => {
  const f=await fixture('organizationStore',{enabled:false,products:[{InventoryId:'empty',ItemCode:'EMPTY',ItemName:'Empty item',Quantity:0,Price:100}]});
  assert.equal(f.root.querySelector('[data-add]').disabled,true);
  assert.equal(f.root.querySelector('[data-add-quantity]').disabled,true);
  assert.equal(f.root.querySelector('[data-complete]').disabled,true);
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  assert.match(f.root.innerHTML,/Selling is unavailable until Accounts confirms/);
  assert.equal(f.calls.length,1);
  f.mounted.destroy();
});

test('oversized stock cannot generate an unbounded quantity menu',async () => {
  const f=await fixture('restaurant',{products:[{InventoryId:'large',ItemName:'Bulk item',Quantity:1e9,Price:100}]});
  assert.equal((f.root.innerHTML.match(/<option value="/g) || []).length,100);
  const select=f.root.querySelector('[data-add-quantity]'); select.value='100'; select.onchange();
  f.root.querySelector('[data-add]').onclick(); f.root.querySelector('[data-add]').onclick();
  assert.match(f.root.innerHTML,/<option value="200" selected>200<\/option>/);
  f.mounted.destroy();
});

test('unmount cancels pending requests and cannot post a checkout after navigation',async () => {
  const f=await fixture();
  f.mounted.destroy();
  await f.find();
  assert.equal(f.calls.length,1);
});

test('Enter submits the separate lookup form, not a payment, and accepts the saved admission identity',async () => {
  const f=await fixture(); f.input('AccountRef','DNX26/006'); await f.find();
  assert.equal(f.calls.find(row=>row.action==='vendorWalletLookup').body.AccountRef,'DNX26/006');
  assert.equal(f.calls.some(row=>row.action.startsWith('record')),false);
  assert.match(f.root.innerHTML,/Fixture child/); f.mounted.destroy();
});

test('selected student shows the original wallet balance and spent-today summary without an extra request',async () => {
  const f=await fixture();
  assert.equal(f.root.querySelector('[data-wallet-summary]'),null);
  f.input('AccountRef','FIXTURE/001'); await f.find();
  assert.match(f.root.innerHTML,/<small>Wallet balance<\/small><strong>₦30,900\.00<\/strong><span>Spent today ₦200\.00<\/span>/);
  assert.ok(f.root.querySelector('[data-wallet-summary]'));
  assert.deepEqual(f.calls.map(row=>row.action),['salesBootstrap','vendorWalletLookup']);
  f.input('Query','Another child');
  assert.equal(f.root.querySelector('[data-customer]'),null);
  assert.equal(f.root.querySelector('[data-payment-form]').hidden,true);
  f.mounted.destroy();
});

test('zero wallet balances remain visible and the summary clears after checkout or customer-type changes',async () => {
  const f=await fixture('tuckShop',{walletSummary:{WalletBalance:0,WalletSpentToday:0}});
  f.input('AccountRef','FIXTURE/001'); await f.find();
  assert.match(f.root.innerHTML,/<small>Wallet balance<\/small><strong>₦0\.00<\/strong><span>Spent today ₦0\.00<\/span>/);
  f.root.querySelector('[data-add]').onclick();
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  assert.equal(f.root.querySelector('[data-wallet-summary]'),null);
  f.input('AccountRef','FIXTURE/001'); await f.find();
  f.root.querySelector('[data-customer-type]').onchange({target:{value:'Staff'}});
  assert.equal(f.root.querySelector('[data-wallet-summary]'),null);
  assert.doesNotMatch(f.root.innerHTML,/Wallet balance|Spent today/);
  f.mounted.destroy();
});

test('search by name selects one result, while ambiguous names never choose a wallet',async () => {
  const f=await fixture(); f.input('Query','Fixture child'); await f.find();
  assert.equal(f.calls.find(row=>row.action==='vendorWalletLookup').body.AccountRef,'FIXTURE/001'); f.mounted.destroy();
  const many=await fixture('tuckShop',{customers:[{CustomerRef:'A/001',CustomerName:'James'},{CustomerRef:'A/002',CustomerName:'James'}]});
  many.input('Query','James'); await many.find();
  assert.equal(many.calls.some(row=>row.action==='vendorWalletLookup'),false);
  assert.match(many.root.querySelector('[data-department-status]').textContent,/Choose one/); many.mounted.destroy();
});

test('lookup errors appear by the controls and leave payment disabled',async () => {
  const f=await fixture('tuckShop',{lookupError:'Account not found in this branch.'});
  f.input('AccountRef','unknown'); await f.find();
  assert.match(f.root.querySelector('[data-department-status]').textContent,/Account not found/);
  assert.equal(f.root.querySelector('[data-payment]').hidden,true); f.mounted.destroy();
});

test('scan uses the original NFC helper, clears old identity and aborts on navigation',async () => {
  let scanSignal;
  const f=await fixture('tuckShop',{tools:{scanNfc:async(form,_button,options)=>{
    scanSignal=options.signal; form.elements.WalletCardId.value='CARD-FIXTURE';
    form.oninput({target:form.elements.WalletCardId}); await form.requestSubmit();
  }}});
  f.input('AccountRef','old'); await f.root.querySelector('[data-scan]').onclick();
  assert.equal(f.calls.find(row=>row.action==='vendorWalletLookup').body.WalletCardId,'CARD-FIXTURE');
  assert.equal(f.calls.find(row=>row.action==='vendorWalletLookup').body.AccountRef,'');
  f.mounted.destroy(); assert.equal(scanSignal.aborted,true);
});

test('face confirmation resolves the wallet and stops the camera on navigation',async () => {
  let faceOptions;
  const f=await fixture('tuckShop',{tools:{openFaceLookup:async options=>{faceOptions=options; await options.onMatch({id:'FIXTURE/001'});}}});
  await f.root.querySelector('[data-face]').onclick();
  assert.equal(faceOptions.purpose,'tuck-shop-purchase'); assert.equal(faceOptions.allowCameraSelection,true);
  assert.equal(f.calls.find(row=>row.action==='vendorWalletLookup').body.AccountRef,'FIXTURE/001');
  f.mounted.destroy(); assert.equal(faceOptions.signal.aborted,true);
});

test('Staff customer mode uses the same directory selector and cannot debit a student wallet',async () => {
  const f=await fixture('tuckShop',{customers:[{CustomerRef:'staff.one',CustomerName:'Staff One'}]});
  f.root.querySelector('[data-customer-type]').onchange({target:{value:'Staff'}});
  assert.match(f.root.innerHTML,/Find staff member/); assert.equal(f.root.querySelector('[data-scan]'),null);
  f.input('Query','Staff One'); await f.find();
  assert.equal(f.calls.find(row=>row.action==='vendorCustomerSearch').body.CustomerType,'Staff');
  assert.match(f.root.innerHTML,/Staff One/);
  assert.equal(f.root.querySelector('[data-wallet-summary]'),null);
  assert.equal(f.root.querySelector('[name="CollectionMode"]').value,'Vendor collected');
  f.root.querySelector('[data-add]').onclick();
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  assert.equal(f.calls.some(row=>row.action==='recordVendorWalletPurchase'),false);
  const sale=f.calls.find(row=>row.action==='recordVendorSale').body;
  assert.equal(sale.CustomerName,'Staff One');
  assert.equal(sale.CollectionMode,'Vendor collected'); f.mounted.destroy();
});

test('staff collection default preserves explicit school collection through cart and payment redraws',async () => {
  const f=await fixture('tuckShop',{customers:[{CustomerRef:'staff.one',CustomerName:'Staff One'}]});
  f.root.querySelector('[data-customer-type]').onchange({target:{value:'Staff'}});
  f.input('Query','Staff One'); await f.find();
  f.input('CollectionMode','School collected');
  f.root.querySelector('[data-add]').onclick();
  assert.equal(f.root.querySelector('[name="CollectionMode"]').value,'School collected');
  f.input('PaymentMethod','Bank Transfer'); f.input('PaymentReference','FIXTURE-TRANSFER');
  assert.equal(f.root.querySelector('[name="CollectionMode"]').value,'School collected');
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  const sale=f.calls.find(row=>row.action==='recordVendorSale').body;
  assert.equal(sale.CollectionMode,'School collected');
  assert.equal(sale.PaymentMethod,'Bank Transfer');
  f.mounted.destroy();
});

test('switching back to staff resets its default but student wallet sales always remain school collected',async () => {
  const f=await fixture('tuckShop',{customers:[{CustomerRef:'staff.one',CustomerName:'Staff One'}]});
  f.root.querySelector('[data-customer-type]').onchange({target:{value:'Staff'}});
  f.input('Query','Staff One'); await f.find();
  f.input('CollectionMode','School collected');
  f.root.querySelector('[data-customer-type]').onchange({target:{value:'Student'}});
  f.input('AccountRef','FIXTURE/001'); await f.find();
  assert.equal(f.root.querySelector('[name="CollectionMode"]'),null);
  f.root.querySelector('[data-add]').onclick();
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  assert.equal(f.calls.find(row=>row.action==='recordVendorWalletPurchase').body.CollectionMode,'School collected');
  f.root.querySelector('[data-customer-type]').onchange({target:{value:'Staff'}});
  f.input('Query','Staff One'); await f.find();
  assert.equal(f.root.querySelector('[name="CollectionMode"]').value,'Vendor collected');
  f.mounted.destroy();
});

test('wallet sale completes directly after lookup and PIN retries keep the same checkout identity',async () => {
  const f=await fixture();
  f.root.querySelector('[data-add]').onclick();
  f.input('AccountRef','FIXTURE/001'); await f.find();
  assert.equal(f.root.querySelector('[data-preview]'),null);
  assert.equal(f.root.querySelector('[name="Confirmed"]'),null);
  assert.equal(f.root.querySelector('[data-complete]').disabled,false);
  f.input('WalletPin','1234'); f.setFailure(true);
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  f.input('WalletPin','4321'); f.setFailure(false);
  await f.root.querySelector('[data-payment-form]').requestSubmit();
  const sales=f.calls.filter(row=>row.action==='recordVendorWalletPurchase');
  assert.equal(sales.length,2);
  assert.equal(sales[0].body.SaleRequestId,sales[1].body.SaleRequestId);
  assert.equal(sales[1].body.WalletPin,'4321');
  assert.equal(sales[1].body.ExpectedAmount,100);
  assert.equal(f.calls.some(row=>row.action==='previewVendorSale'),false);
  assert.equal(f.root.querySelector('[data-cart-lines]').hidden,true);
  f.mounted.destroy();
});

test('all stores round the displayed total to currency precision and cannot submit an empty cart',async () => {
  for(const section of ['tuckShop','restaurant','organizationStore']) {
    const f=await fixture(section,{products:[{InventoryId:'small',ItemCode:'SMALL',ItemName:'Small',Quantity:5,Price:.1}]});
    await f.root.querySelector('[data-payment-form]').requestSubmit();
    assert.equal(f.calls.some(row=>row.action.startsWith('record')),false);
    const qty=f.root.querySelector('[data-add-quantity]'); qty.value='3'; qty.onchange();
    f.root.querySelector('[data-add]').onclick();
    if(section==='tuckShop') {f.input('AccountRef','FIXTURE/001'); await f.find();}
    await f.root.querySelector('[data-payment-form]').requestSubmit();
    assert.equal(f.calls.find(row=>row.action.startsWith('record')).body.ExpectedAmount,.3);
    f.mounted.destroy();
  }
});
