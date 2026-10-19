import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const helpers = admin.slice(admin.indexOf('function showTuckShopStudentMatches('), admin.indexOf('function tuckShopSaleItems('));
function fixture({ query = 'dca / 25 / 2024', lookup, search } = {}) {
  const input = { value: query }, account = { value: '' }, card = { value: '' };
  const results = { children: [], replaceChildren() { this.children = []; }, append(node) { this.children.push(node); } };
  const form = { isConnected: true, elements: {AccountRef:account,WalletCardId:card},
    querySelector: selector => selector === '#tuckShopStudentSearch' ? input : results,
    requestSubmit() { this.submissions = (this.submissions || 0) + 1; }
  };
  const calls = [], searches = [];
  const context = {
    clean: value => String(value ?? '').trim(), tuckShopCustomerSearch: '',
    FormData: class { constructor(form) {this.form=form;} entries() {return Object.entries(this.form.elements).map(([key,el])=>[key,el.value]);} },
    requestDepartmentAction: async (...args) => { calls.push(args); return lookup ? lookup(...args) : {ok:true,walletAccount:{AccountRef:'DCA/25/2024',DisplayName:'Sample Child',WalletBalance:2000}}; },
    searchTuckShopCustomer: async (...args) => { searches.push(args); return search ? search(...args) : []; },
    document: { createElement: tag => ({tag,children:[],append(...nodes){this.children.push(...nodes);},addEventListener(event,listener){this[event]=listener;}}) }
  };
  const api = runInNewContext(`${helpers}\n({loadTuckShopStudentWallet,showTuckShopStudentMatches})`,context);
  return {...api,form,input,account,card,results,calls,searches};
}
const notFound = () => {throw Object.assign(new Error('Not found'),{status:404});};

test('admission search uses authoritative exact wallet lookup without requiring borrower suggestions', async () => {
  const f=fixture();
  const result=await f.loadTuckShopStudentWallet(f.form);
  assert.equal(result.walletAccount.AccountRef,'DCA/25/2024');
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0][1],'lookupWallet');
  assert.deepEqual({...f.calls[0][2]},{AccountRef:'dca / 25 / 2024'});
  assert.equal(f.searches.length,0);
});

test('name, card and partial-number searches show tappable identities; never auto-select a fuzzy match', async () => {
  for(const query of ['Sample','CARD-0001','DCA/25/202']) {
    const f=fixture({query,lookup:notFound,search:()=>[{CustomerRef:'DCA/25/2024',CustomerName:'Sample Child',Detail:'Grade 7'}]});
    assert.equal(await f.loadTuckShopStudentWallet(f.form),null);
    const button=f.results.children.find(node=>node.tag==='button');
    assert.equal(button.type,'button');
    assert.equal(button.children[0].textContent,'Sample Child');
    assert.equal(button.children[1].textContent,'DCA/25/2024 · Grade 7');
    button.click();
    assert.equal(f.input.value,'DCA/25/2024');
    assert.equal(f.form.submissions,1);
    assert.equal(f.calls.length,1); // A selection only submits the normal wallet lookup.
  }
});

test('manual card/admission lookup preserves explicit identifiers without searching names', async () => {
  const f=fixture(); f.card.value='CARD-0001';
  await f.loadTuckShopStudentWallet(f.form);
  assert.equal(f.calls[0][2].WalletCardId,'CARD-0001');
  assert.equal(f.searches.length,0);
});

test('permission, network and server errors are not disguised as no matching student', async () => {
  for(const status of [401,403,429,500,undefined]) {
    const f=fixture({lookup:()=>{throw Object.assign(new Error('Original failure'),{status});}});
    await assert.rejects(f.loadTuckShopStudentWallet(f.form),/Original failure/);
    assert.equal(f.searches.length,0);
  }
});

test('a genuine miss explains permitted scope; an empty input makes no requests', async () => {
  const f=fixture({lookup:notFound});
  await assert.rejects(f.loadTuckShopStudentWallet(f.form),/permitted branch and school section/);
  const empty=fixture({query:'   '});
  await assert.rejects(empty.loadTuckShopStudentWallet(empty.form),/Enter the student/);
  assert.equal(empty.calls.length,0);
});

test('slow exact lookup cannot load the previous student after the input changes or the form is removed', async () => {
  for(const change of [f=>{f.input.value='DCA/25/2025';},f=>{f.form.isConnected=false;}]) {
    let finish;
    const f=fixture({lookup:()=>new Promise(resolve=>{finish=resolve;})});
    const pending=f.loadTuckShopStudentWallet(f.form);
    change(f); finish({ok:true,walletAccount:{AccountRef:'DCA/25/2024'}});
    assert.equal(await pending,null);
  }
});

test('stale suggestion responses do not render for another student', async () => {
  let finish;
  const f=fixture({query:'Sample',lookup:notFound,search:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=f.loadTuckShopStudentWallet(f.form);
  await new Promise(resolve=>setImmediate(resolve));
  f.input.value='Different'; finish([{CustomerRef:'old'}]);
  assert.equal(await pending,null);
  assert.equal(f.results.children.length,0);
});

test('typing clears previous manual identifiers and mobile search does not depend on native datalist', () => {
  const binding=admin.slice(admin.indexOf('const customerSearch = workspace.querySelector'),admin.indexOf("workspace.querySelector('#tuckShopStaffLookupForm')"));
  assert.match(binding,/removeAttribute\('list'\)/);
  assert.match(binding,/setAttribute\('autocorrect', 'off'\)/);
  assert.match(binding,/lookupForm\.elements\.AccountRef\.value = ''/);
  assert.match(binding,/lookupForm\.elements\.WalletCardId\.value = ''/);
  assert.match(binding,/generation !== searchGeneration/);
  assert.match(binding,/customerSearch\.isConnected/);
});
