import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext,constants} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const source = await readFile(new URL('../js/vendor-settlements.js',import.meta.url),'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Small DOM/event fixture. Browser checks cover the rendered page; these tests
// deliberately control response order without making real financial requests.
function workspaceRoot() {
  const matches = (node,selector) => selector.startsWith('.') ? (node.attrs.class || '').split(' ').includes(selector.slice(1))
    : selector.startsWith('[') ? Object.hasOwn(node.attrs,selector.slice(1,-1)) : node.tag === selector;
  const flatten = nodes => nodes.flatMap(node => [node,...flatten(node.children)]);
  const detach = nodes => flatten(nodes).forEach(node => {node.isConnected = false;});
  function container() {
    let html = '';
    return {children:[],isConnected:true,
      get innerHTML(){return html;},
      set innerHTML(value){detach(this.children);html=value;this.children=parse(value);},
      set textContent(value){this.innerHTML=value;},get textContent(){return html;},
      querySelector(selector){return this.querySelectorAll(selector)[0] || null;},
      querySelectorAll(selector){return flatten(this.children).filter(node => matches(node,selector));}};
  }
  function parse(html) {
    const nodes = [...html.matchAll(/<(button|input|select|p|form|div)\b([^>]*)>/g)].map(match => {
      const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(row => [row[1],row[2] || '']));
      const node = Object.assign(container(),{attrs,tag:match[1],position:match.index,dataset:{},name:attrs.name,value:attrs.value || '',classList:{toggle(){}},
        addEventListener(event,handler){this[`on${event}`]=handler;}});
      for (const [key,value] of Object.entries(attrs)) if(key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
      if(node.tag==='select') {
        const options=[...html.slice(match.index).split('</select>')[0].matchAll(/<option value="([^"]*)"([^>]*)>/g)];
        node.value=(options.find(row=>row[2].includes('selected')) || options[0])?.[1] || '';
      }
      return node;
    });
    for(const form of nodes.filter(node=>node.tag==='form')) {
      const children=nodes.filter(node=>node.position>form.position && node.position<html.indexOf('</form>',form.position));
      form.elements=Object.fromEntries(children.filter(node=>node.name).map(node=>[node.name,node]));
    }
    return nodes;
  }
  return container();
}

async function fixture(options = {}) {
  const root=workspaceRoot(),window={},reads=[],calls=[];
  class FormDataFixture {constructor(form){this.rows=Object.values(form.elements).map(node=>[node.name,node.value]);}[Symbol.iterator](){return this.rows[Symbol.iterator]();}}
  const request=async(action,body,signal)=>{
    calls.push({action,body});
    if(action==='bootstrap') return {vendors:[{VendorId:'v1',Name:'First vendor'},{VendorId:'v2',Name:'Second vendor'}],balances:[],products:options.products || [],requests:[],settings:{Enabled:true,AccountingConfirmed:true},capabilities:{vendor:true,products:true}};
    if(action==='statement') return new Promise((resolve,reject)=>reads.push({body,signal,resolve,reject}));
    throw new Error(`Unexpected action: ${action}`);
  };
  runInNewContext(source,{window,FormData:FormDataFixture,Intl,AbortController,setTimeout,clearTimeout,crypto:webcrypto},
    {filename:fileURLToPath(new URL('../js/vendor-settlements.js',import.meta.url)),importModuleDynamically:constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
  const mounted=window.DynamaxVendors.mount(root,request);
  await tick();
  root.querySelectorAll('[data-tab]').find(node=>node.dataset.tab===(options.tab || (options.products ? 'products' : 'statement'))).onclick();
  const filter=()=>root.querySelector(options.tab==='analysis' ? '[data-analysis-filter]' : '[data-statement-filter]');
  const change=(name,value)=>{filter().elements[name].value=value;filter().onchange({target:filter().elements[name]});};
  return {root,reads,calls,mounted:{destroy(){mounted.destroy();reads.forEach(read=>read.resolve(null));}},change,filter,result:()=>root.querySelector(options.tab==='analysis' ? '[data-analysis-result]' : '[data-statement-result]'),
    response(index,amount=0,details={}){const read=reads[index];read.resolve({vendor:{VendorId:read.body.VendorId,Name:read.body.VendorId==='v1'?'First vendor':'Second vendor'},from:read.body.From,to:read.body.To,balance:{Available:amount},availableInPeriod:amount,entries:[],payments:[],...details});}};
}

test('statement renders every monetary column with a no-wrap class without changing values',async t=>{
  const f=await fixture();t.after(()=>f.mounted.destroy());
  f.response(0,341000,{directChargeDue:1500,entries:[{Date:'2026-10-10',SaleNo:'SAMPLE',Type:'Sale',
    Gross:170900,Refund:0,SchoolCharge:1600,Net:169300,Items:[]}],payments:[{Date:'2026-10-10',Reference:'SAMPLE-PAYMENT',Amount:1234567.89}]});
  await tick();
  const html=f.result().innerHTML;
  assert.deepEqual([...html.matchAll(/<td class="vendor-amount">([^<]*)<\/td>/g)].map(match=>match[1]),
    ['₦170,900.00','₦0.00','₦1,600.00','₦169,300.00','₦1,234,567.89']);
  assert.match(html,/<strong class="vendor-amount">₦341,000\.00<\/strong>/);
  assert.match(html,/<span class="vendor-amount">₦1,500\.00<\/span>/);
});

test('responsive product rows preserve stock, escaping and working edit / delivery handlers',async t=>{
  const f=await fixture({products:[{InventoryId:'main-Secondary-test',VendorId:'v1',ItemName:'Water <sample>',Section:'tuckShop',Quantity:5,Price:500}]});
  t.after(()=>f.mounted.destroy());
  const panel=f.root.querySelector('[data-panel]');
  assert.match(panel.innerHTML,/vendor-table vendor-product-table/);
  assert.match(panel.innerHTML,/Water &lt;sample&gt;/);
  assert.match(panel.innerHTML,/data-label="Owner">First vendor/);
  assert.match(panel.innerHTML,/data-label="Stock \/ price">5 · ₦500\.00/);
  assert.equal(typeof panel.querySelector('[data-edit-product]').onclick,'function');
  assert.equal(typeof panel.querySelector('[data-delivery]').onclick,'function');
  assert.match(panel.innerHTML,/class="vendor-icon-action" title="Edit product" aria-label="Edit product: Water &lt;sample&gt;"/);
  assert.match(panel.innerHTML,/aria-label="Record delivery: Water &lt;sample&gt;"/);
  assert.equal((panel.innerHTML.match(/aria-hidden="true" focusable="false"/g) || []).length,2);
  assert.deepEqual(f.calls.map(call=>call.action),['bootstrap']);
});

test('switching vendors automatically loads their statement and preserves the date range',async t=>{
  const f=await fixture();t.after(()=>f.mounted.destroy());
  f.change('From','2026-09-01');f.change('To','2026-09-30');
  f.change('VendorId','v2');
  assert.equal(f.reads.length,2);
  assert.deepEqual({...f.reads[1].body},{VendorId:'v2',From:'2026-09-01',To:'2026-09-30'});
  assert.equal(f.reads[0].signal.aborted,true);
  assert.match(f.result().textContent,/Loading statement/);
  f.response(1,75);await tick();
  assert.match(f.result().innerHTML,/Second vendor/);
  assert.match(f.result().innerHTML,/75\.00/);
});

test('rapid A → B → A switching cannot display an older A or B response',async t=>{
  const f=await fixture();t.after(()=>f.mounted.destroy());
  f.change('VendorId','v2');f.change('VendorId','v1');
  assert.equal(f.reads.length,3);
  f.response(0,111);f.response(1,222);await tick();
  assert.match(f.result().textContent,/Loading statement/);
  f.response(2,333);await tick();
  assert.match(f.result().innerHTML,/First vendor/);assert.match(f.result().innerHTML,/333\.00/);
  assert.doesNotMatch(f.result().innerHTML,/111\.00|222\.00/);
});

test('old errors are ignored; the latest failed read can be retried without refreshing',async t=>{
  const f=await fixture();t.after(()=>f.mounted.destroy());
  f.change('VendorId','v2');f.reads[0].reject(new Error('Old failure'));await tick();
  assert.doesNotMatch(f.root.querySelector('.vendor-status').textContent,/Old failure/);
  f.reads[1].reject(new Error('Connection interrupted'));await tick();
  assert.match(f.result().textContent,/Use Load statement to retry/);
  f.filter().onsubmit({preventDefault(){}});
  assert.equal(f.reads[2].body.VendorId,'v2');
  f.response(2);await tick();assert.match(f.result().innerHTML,/Second vendor/);
});

test('date changes clear old balances and block payment requests until a fresh statement loads',async t=>{
  const f=await fixture();t.after(()=>f.mounted.destroy());
  f.response(0,100);await tick();
  f.change('To','2026-09-30');
  f.root.querySelector('[data-request-new]').onclick();
  assert.match(f.root.querySelector('.vendor-status').textContent,/Load a fresh statement/);
  assert.equal(f.calls.filter(row=>row.action==='requestSettlement').length,0);
  assert.doesNotMatch(f.result().innerHTML,/100\.00/);
  f.change('VendorId','v2');
  assert.equal(f.reads.length,1,'invalid date ranges make no request');
  assert.match(f.result().textContent,/valid date range/);
});

test('destroying the workspace aborts statement reads and ignores their results',async()=>{
  const f=await fixture();f.mounted.destroy();
  assert.equal(f.reads[0].signal.aborted,true);
  f.response(0,999);await tick();
  assert.doesNotMatch(f.result().innerHTML,/999\.00/);
});

test('sales analysis uses scoped statement reads, auto-loads filters and ignores stale vendors',async t=>{
  const f=await fixture({tab:'analysis'});t.after(()=>f.mounted.destroy());
  assert.equal(f.calls[1].action,'statement');
  f.change('From','2026-10-01');f.change('To','2026-10-10');f.change('VendorId','v2');
  assert.deepEqual({...f.reads.at(-1).body},{VendorId:'v2',From:'2026-10-01',To:'2026-10-10'});
  assert.ok(f.reads.slice(0,-1).every(read=>read.signal.aborted));
  f.response(0);await tick();assert.match(f.result().innerHTML,/Loading sales analysis/);
  f.response(f.reads.length-1);
  // Dynamic chart module import may take a few event-loop turns on a cold run.
  for(let i=0;i<40 && !f.result().innerHTML.includes('vendor-analysis-charts');i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.match(f.result().innerHTML,/Second vendor · Sales analysis/);
  assert.match(f.result().innerHTML,/vendor-trend-chart/);
  assert.equal(f.root.querySelector('[data-request-new]'),null,'charts cannot initiate payments');
  assert.ok(f.calls.every(row=>['bootstrap','statement'].includes(row.action)));
});

test('analysis errors and invalid ranges are visible and retryable, and refresh preserves its range',async t=>{
  const f=await fixture({tab:'analysis'});t.after(()=>f.mounted.destroy());
  f.reads[0].reject(new Error('Sample connection failure'));await tick();
  assert.match(f.result().textContent,/Use Load analysis to retry/);
  f.change('From','2026-09-01');f.change('To','2026-09-30');
  f.root.querySelector('[data-refresh]').onclick();await tick();
  assert.equal(f.filter().elements.From.value,'2026-09-01');
  assert.equal(f.filter().elements.To.value,'2026-09-30');
  const count=f.reads.length;f.change('To','2026-08-31');
  assert.equal(f.reads.length,count);assert.match(f.result().textContent,/valid date range/);
  f.mounted.destroy();assert.ok(f.reads.slice(1).every(read=>read.signal.aborted));
});
