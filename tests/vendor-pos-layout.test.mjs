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
      for (const match of html.matchAll(/<(button|input|select|article|p|form|details|div)\b([^>]*)>/g)) {
        const attrs = {};
        for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[attr[1]] = decode(attr[2]);
        const node = {attrs,tagName:match[1].toUpperCase(),dataset:{},name:attrs.name,
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
      const form = root.querySelector('form');
      if (form) form.elements = Object.fromEntries(nodes.filter(node=>node.name).map(node=>[node.name,node]));
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
    if (action === 'vendorWalletLookup') return {account:{AccountRef:'FIXTURE/001',DisplayName:'Fixture child'}};
    if (action === 'previewVendorSale') return {Amount:333};
    if (failSale) throw new Error('Fixture response interrupted; retry the same checkout.');
    return {message:'Fixture sale recorded.',sale:{SaleNo:'FIXTURE-SALE',Amount:body.ExpectedAmount}};
  };
  runInNewContext(source,{window,Intl,AbortController,setTimeout,clearTimeout,crypto:webcrypto});
  const mounted = window.DynamaxVendorPOS.mount(root,request,section);
  await new Promise(resolve=>setImmediate(resolve));
  const input = (name,value) => {const form=root.querySelector('form'),field=form.elements[name]; field.value=value; form.oninput({target:field});};
  return {root,calls,input,mounted,setFailure:value=>{failSale=value;}};
}

test('vendor counter uses the original shared POS structure, colours and compact mobile catalogue',async () => {
  const f = await fixture();
  for (const component of ['tuck-shop-pos-workspace','config-card-heading','commerce-pos-layout','commerce-catalog','commerce-product-list','commerce-product-action','commerce-cart-title','commerce-cart-lines','tuck-shop-step-heading','tuck-shop-lookup-form']) assert.ok(f.root.innerHTML.includes(component),component);
  assert.match(f.root.innerHTML,/Stock-linked checkout/);
  assert.match(f.root.innerHTML,/Drinks · bottle/);
  assert.match(f.root.innerHTML,/aria-label="Quantity for Water"/);
  assert.match(f.root.innerHTML,/aria-label="Add Water to cart"/);
  assert.doesNotMatch(f.root.innerHTML,/Stock in \/ out|Purchase history|Save product ownership|Wallet balance|Use face|Inventory<\/strong>/);
  assert.match(sharedCss,/\.commerce-product:nth-child\(3n\+2\)\{background:#edf8f3\}/);
  assert.match(sharedCss,/@media\(max-width:680px\)\{\s*\.commerce-product-list\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css,/\.vendor-pos-products\{display:grid|\.vendor-pos-layout\{/);
  assert.match(css,/\.staff-page:has\(\.vendor-workspace\) \.staff-sidebar>\.staff-tabs\{align-content:start\}/);
  f.mounted.destroy();
});

test('quantity dropdowns respect stock and changing quantities never sends client prices',async () => {
  const f = await fixture('restaurant');
  const addQty=f.root.querySelector('[data-add-quantity]'); addQty.value='3'; addQty.onchange();
  f.root.querySelector('[data-add]').onclick();
  assert.match(f.root.innerHTML,/<select data-quantity="stock-1"[^>]*>[^]*?<option value="3" selected>/);
  assert.match(f.root.innerHTML,/₦300\.00/);
  await f.root.querySelector('[data-preview]').onclick();
  const body=f.calls.find(row=>row.action==='previewVendorSale').body;
  assert.deepEqual(body.Items,[{Reference:'stock-1',Quantity:3}]);
  assert.equal(body.Section,'restaurant'); assert.equal(body.Price,undefined);
  assert.match(f.root.innerHTML,/Server-confirmed total<\/span><strong>₦333\.00/);
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
  await f.root.querySelector('[data-preview]').onclick();
  assert.equal(f.calls.find(row=>row.action==='previewVendorSale').body.Items[0].Reference,'WATER');
  f.root.querySelector('[data-search]').oninput({target:{value:'nonexistent'}});
  assert.equal(f.root.querySelector('[data-product]').hidden,true);
  assert.equal(f.root.querySelector('[data-search-empty]').hidden,false);
  f.mounted.destroy();
});

test('wallet checkout exposes identity only and clears previous customer and PIN when identity changes',async () => {
  const f = await fixture();
  f.root.querySelector('[data-add]').onclick();
  assert.equal(f.root.querySelector('[data-payment]').hidden,true);
  assert.equal(f.root.querySelector('[name="WalletPin"]'),null);
  f.input('WalletCardId','FIXTURE-CARD');
  await f.root.querySelector('[data-find]').onclick();
  assert.match(f.root.innerHTML,/Fixture child/);
  assert.equal(f.root.querySelector('[data-payment]').hidden,false);
  f.input('WalletPin','1234');
  f.input('AccountRef','FIXTURE/002');
  assert.equal(f.root.querySelector('[data-customer]'),null);
  assert.equal(f.root.querySelector('[name="WalletPin"]'),null);
  assert.equal(f.root.querySelector('[data-payment]').hidden,true);
  assert.equal(f.root.querySelector('[data-preview]').disabled,true);
  await f.root.querySelector('[data-find]').onclick();
  assert.equal(f.root.querySelector('[name="WalletPin"]').value,'');
  assert.equal(f.root.querySelector('form').elements.WalletCardId.value,'');
  f.mounted.destroy();
});

test('failed checkout keeps the same request ID and confirmation, success clears the cart',async () => {
  const f = await fixture('restaurant');
  f.root.querySelector('[data-add]').onclick();
  await f.root.querySelector('[data-preview]').onclick();
  f.root.querySelector('form').elements.Confirmed.checked=true;
  f.setFailure(true);
  await f.root.querySelector('form').onsubmit({preventDefault(){}});
  f.setFailure(false);
  await f.root.querySelector('form').onsubmit({preventDefault(){}});
  const sales=f.calls.filter(row=>row.action==='recordVendorSale');
  assert.equal(sales.length,2);
  assert.equal(sales[0].body.SaleRequestId,sales[1].body.SaleRequestId);
  assert.equal(sales[0].body.ExpectedAmount,333);
  assert.equal(sales[0].body.Confirmed,true);
  assert.match(f.root.innerHTML,/Select an item to begin/);
  assert.equal(f.root.querySelector('[data-preview]').disabled,true);
  f.mounted.destroy();
});

test('disabled sales and out-of-stock products retain stock and permission guards',async () => {
  const f=await fixture('organizationStore',{enabled:false,products:[{InventoryId:'empty',ItemCode:'EMPTY',ItemName:'Empty item',Quantity:0,Price:100}]});
  assert.equal(f.root.querySelector('[data-add]').disabled,true);
  assert.equal(f.root.querySelector('[data-add-quantity]').disabled,true);
  assert.equal(f.root.querySelector('[data-preview]').disabled,true);
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
  await f.root.querySelector('[data-find]').onclick();
  assert.equal(f.calls.length,1);
});
