import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../js/payment-corrections.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const Student = { AccountRef:'TEST/001', DisplayName:'Test Student', ClassName:'Grade 10' };
const row = (id, extra = {}) => ({ Id:id, Reference:`REF-${id}`, ReceiptNo:`RECEIPT-${id}`, AccountRef:'TEST/001',
  FeeName:'Student Wallet Top-up', Amount:22400, Currency:'NGN', PaidAt:'2025-10-10T09:00:00Z', Source:'Batch import', CanSelect:true, ...extra });
const page = (Rows, NextCursor = '') => ({ok:true,Student,Rows,NextCursor,Complete:!NextCursor});
function element(name = '') {
  return { name, value:'', innerHTML:'', textContent:'', hidden:false, disabled:false, isConnected:true, attributes:{}, dataset:{}, children:[], listeners:new Map(),
    setAttribute(key,value) { this.attributes[key]=value; }, hasAttribute(key) { return Object.hasOwn(this.attributes,key); },
    addEventListener(type,fn) { this.listeners.set(type,fn); },
    fire(type,extra = {}) { const event={target:this,preventDefault(){this.prevented=true;},...extra}; return this.listeners.get(type)?.(event); },
    contains(node) { return this.children.includes(node); }, focus(){this.focused=true;}, showModal(){}, scrollIntoView(){},
    close(){this.fire('close');}, remove(){this.isConnected=false;}, querySelector(){return null;}, querySelectorAll(){return [];} };
}
function fixture(handle) {
  const names=['Reference','SearchAccountRef','Kind','CorrectAmount','TargetAccountRef','TargetSchoolSection','Reason'];
  const form=element(), dialog=element(), password=element('approvalPassword'), moveOption=element();
  form.elements=Object.fromEntries(names.map(name=>[name,element(name)])); form.elements.Kind.value='reduce';
  form.elements.Kind.querySelector=()=>moveOption;
  const nodes=new Map(['data-close','data-status','data-history-status','data-history-results','data-more','data-search','data-receipt',
    'data-summary','data-confirm','data-reduce','data-move','data-lookup','data-preview','data-post'].map(attr=>{
      const node=element(); node.setAttribute(attr,''); return [`[${attr}]`,node];
    }));
  nodes.get('[data-more]').hidden=true; nodes.get('[data-confirm]').hidden=true;
  dialog.querySelector=selector=>selector==='form'?form:selector==='[name="approvalPassword"]'?password:nodes.get(selector);
  const results=nodes.get('[data-history-results]'); let markup='', text='';
  Object.defineProperty(results,'innerHTML',{get:()=>markup,set(value){markup=value;text='';results.children=[...value.matchAll(/data-use-receipt="(\d+)"([^>]*)/g)].map(match=>{
    const button=element(); button.dataset.useReceipt=match[1]; button.setAttribute('data-use-receipt',match[1]);
    if(match[2].includes('data-unavailable')) {button.setAttribute('data-unavailable','');button.disabled=true;}
    button.closest=()=>button; return button;
  });}});
  Object.defineProperty(results,'textContent',{get:()=>text,set(value){text=value;markup='';results.children=[];}});
  dialog.querySelectorAll=()=>[...Object.values(form.elements),password,...[...nodes.values()].filter(node=>['data-close','data-more','data-search','data-lookup','data-preview','data-post'].some(attr=>node.hasAttribute(attr))),...results.children];
  const document={getElementById:()=>null,createElement:()=>dialog,body:{append(){}}},window={},calls=[];
  const FormData=class { constructor(form){this.values=Object.values(form.elements).filter(node=>!node.disabled).map(node=>[node.name,node.value]);} [Symbol.iterator](){return this.values[Symbol.iterator]();} };
  runInNewContext(source,{document,window,crypto:webcrypto,Intl,Date,FormData});
  window.DynamaxPaymentCorrections.open({user:{edition:'school',role:'Accounts Officer',allowedSections:['accounts']},
    payments:[row('cached-unrelated')],accounts:[],fetch:async (url,options)=>{
      assert.equal(url,'/api/staff-payment-corrections'); assert.equal(options.cache,'no-store');
      const body=JSON.parse(options.body);calls.push(body);const result=await handle(body);
      return {ok:result.ok!==false,json:async()=>result};
    }});
  return {form,dialog,nodes,password,results,calls,node:key=>nodes.get(`[data-${key}]`),
    async search(value='TEST/001'){form.elements.SearchAccountRef.value=value;await nodes.get('[data-search]').fire('click');},
    async select(index=0){await results.fire('click',{target:results.children[index]});await tick();}};
}
const receipt = Reference => ({ok:true,Receipt:{Reference,Student,Type:'Wallet',OriginalAmount:22400,RemainingAmount:22400,CurrentWalletBalance:44800}});

test('student search fetches server history rather than cached dashboard receipts and selection loads current balance',async()=>{
  const f=fixture(body=>body.action==='search'?page([row('old')]):receipt(body.Reference));
  await f.search('test/001');
  assert.deepEqual(f.calls,[{action:'search',AccountRef:'test/001'}]);
  assert.match(f.results.innerHTML,/REF-old/);assert.doesNotMatch(f.dialog.innerHTML,/cached-unrelated|correctionReceipts/);
  assert.match(f.results.innerHTML,/Receipt amount:.*22,400/);assert.match(f.results.innerHTML,/Batch import/);
  assert.equal(f.form.elements.Reference.value,'','requires deliberate receipt selection');
  await f.select();
  assert.equal(f.form.elements.Reference.value,'REF-old');assert.deepEqual(f.calls[1],{action:'lookup',Reference:'REF-old'});
  assert.match(f.node('receipt').innerHTML,/Current wallet balance/);assert.match(f.node('receipt').innerHTML,/44,800/);
  assert.equal(f.calls.some(body=>body.action==='post'),false);
});

test('Load more retains old receipts, removes overlapping duplicate rows and only reports complete at the end',async()=>{
  const f=fixture(body=>body.Cursor?page([row('a'),row('b')]):page([row('a')],'cursor1'));
  await f.search(); assert.match(f.node('history-status').textContent,/More history/);assert.equal(f.node('more').hidden,false);
  await f.node('more').fire('click');assert.equal(f.calls[1].Cursor,'cursor1');assert.equal(f.results.children.length,2);
  assert.match(f.node('history-status').textContent,/2 payment.*Full payment history/);assert.equal(f.node('more').hidden,true);
});

test('a failed next page remains retryable without dropping loaded rows or claiming completeness',async()=>{
  let fail=true;
  const f=fixture(body=>{if(body.Cursor && fail)throw Error('Connection failed');return body.Cursor?page([row('b')]):page([row('a')],'next');});
  await f.search();await f.node('more').fire('click');assert.match(f.node('status').textContent,/Connection failed/);
  assert.match(f.results.innerHTML,/REF-a/);assert.equal(f.node('more').hidden,false);assert.equal(f.node('more').disabled,false);
  fail=false;await f.node('more').fire('click');assert.equal(f.results.children.length,2);assert.equal(f.calls[2].Cursor,'next');
});

test('changing student clears selection, current balance and correction preview before another search',async()=>{
  const f=fixture(body=>body.action==='search'?page([row('a')]):receipt(body.Reference));await f.search();await f.select();
  f.node('summary').textContent='old preview';f.node('confirm').hidden=false;f.password.value='private';
  f.form.elements.SearchAccountRef.value='TEST/002';f.form.fire('input',{target:f.form.elements.SearchAccountRef});
  assert.equal(f.results.innerHTML,'');assert.equal(f.node('receipt').textContent,'');assert.equal(f.form.elements.Reference.value,'');
  assert.equal(f.node('confirm').hidden,true);assert.equal(f.node('summary').textContent,'');assert.equal(f.password.value,'');
  await f.node('more').fire('click');assert.equal(f.calls.length,2);
});

test('Enter in the student search runs search only, never a correction preview or post',async()=>{
  const f=fixture(()=>page([]));f.form.elements.SearchAccountRef.value='TEST/001';let prevented=false;
  f.form.elements.SearchAccountRef.fire('keydown',{key:'Enter',preventDefault(){prevented=true;}});await tick();
  assert.equal(prevented,true);assert.deepEqual(f.calls.map(body=>body.action),['search']);assert.match(f.node('history-status').textContent,/0 payment/);
  assert.equal(f.node('more').hidden,true);
});

test('unavailable payments stay disabled after requests, and history output escapes all untrusted values',async()=>{
  const f=fixture(()=>page([row('online',{CanSelect:false,UnavailableReason:'Online <script>',FeeName:'<img src=x>',RecordedBy:'<svg>',Reference:'<script>'})]));
  await f.search();assert.equal(f.results.children[0].disabled,true);await f.select();assert.equal(f.calls.length,1);
  assert.match(f.results.innerHTML,/&lt;img/);assert.match(f.results.innerHTML,/&lt;svg/);assert.doesNotMatch(f.results.innerHTML,/<script>|<img|<svg/);
});

test('stale search responses and duplicate clicks cannot replace a changed search or send multiple requests',async()=>{
  let resolve;const f=fixture(()=>new Promise(done=>{resolve=done;}));
  const pending=f.search();await tick();await f.node('search').fire('click');assert.equal(f.calls.length,1);
  f.form.elements.SearchAccountRef.value='TEST/002';f.form.fire('input',{target:f.form.elements.SearchAccountRef});
  resolve(page([row('old')]));await pending;assert.equal(f.results.innerHTML,'');assert.equal(f.node('more').hidden,true);
});

test('exact reference lookup remains available without a student search',async()=>{
  const f=fixture(body=>receipt(body.Reference));f.form.elements.Reference.value='PAYMENT-EXACT';await f.node('lookup').fire('click');
  assert.deepEqual(f.calls,[{action:'lookup',Reference:'PAYMENT-EXACT'}]);assert.match(f.node('receipt').innerHTML,/44,800/);
});

test('a page with no visible rows can still advance to older permitted receipts',async()=>{
  const f=fixture(body=>body.Cursor?page([row('older')]):page([],'more'));
  await f.search();assert.equal(f.node('more').hidden,false);assert.match(f.node('history-status').textContent,/More history/);
  await f.node('more').fire('click');assert.match(f.results.innerHTML,/REF-older/);assert.equal(f.node('more').hidden,true);
});

test('search errors appear alongside the search field instead of only below the correction form',async()=>{
  const f=fixture(()=>({ok:false,message:'Student not found in your permitted branch.'}));
  await f.search();assert.match(f.node('history-status').textContent,/Student not found/);assert.equal(f.node('history-status').className,'bad');
  assert.equal(f.results.innerHTML,'');assert.equal(f.node('more').hidden,true);
  await f.search('');assert.match(f.node('history-status').textContent,/full admission number/);assert.equal(f.calls.length,1);
});
