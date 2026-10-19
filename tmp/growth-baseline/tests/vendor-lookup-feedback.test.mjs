import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const [feedback, cacheSource, admin] = await Promise.all([
  'js/staff-action-feedback.js', 'js/staff-workspace-cache.js', 'js/admin.js'
].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
const requestSource = admin.slice(admin.indexOf('const TRANSIENT_API_STATUS_CODES'), admin.indexOf('async function refreshStaffSiteProfile'));
const reads = ['salesBootstrap', 'recentVendorSales', 'vendorCustomerSearch', 'vendorWalletLookup', 'previewVendorSale'];
const post = (action, extra = {}) => ({ method: 'POST', body: JSON.stringify({ action, Section: 'tuckShop', ...extra }) });
function fixture(network = async () => Response.json({ ok: true })) {
  const alerts = [], requests = [], session = new AbortController();
  const window = {
    location: { href: 'https://school.example/admin.html', origin: 'https://school.example' },
    DynamaxDialogs: { alert: async options => alerts.push(options) }, setTimeout,
    fetch: async (input, init) => { requests.push({input, init}); return network(input, init); }
  };
  const context = vm.createContext({ window, URL, Headers, Request, Response, TextEncoder, DOMException,
    staffSessionAbortController: session, selectedBranchId: 'main', staffBearerToken: 'fixture-vendor',
    clean: value => String(value ?? '').trim() });
  vm.runInContext(`${feedback}\n${cacheSource}`, context);
  const cache = window.DynamaxWorkspaceCache.create({ context: () => ({scope:'main|vendor|secondary',signal:session.signal}) });
  context.staffWorkspaceReads = cache;
  vm.runInContext(requestSource, context);
  return { alerts, requests, cache, feedback:window.DynamaxStaffActionFeedback,
    send: (action, options = {}) => context.staffFetch('/api/staff-vendor-settlements', {...post(action), ...options}) };
}

test('vendor searches, wallet reads, stock loads, history and previews are quiet live reads', async () => {
  const f = fixture(); const revision = f.cache.version();
  for (const action of reads) {
    assert.equal(f.feedback.isMutation(new URL('https://school.example/api/staff-vendor-settlements'), post(action)), false, action);
    await f.send(action); await f.send(action);
  }
  assert.equal(f.alerts.length, 0);
  assert.equal(f.requests.length, reads.length * 2, 'wallet, inventory and identity must stay live, not be cached');
  assert.equal(f.cache.version(), revision, 'searching must not invalidate other workspace reads');
  assert.equal(f.requests[0].init.headers.get('X-Dynamax-Branch'), 'main');
  assert.equal(f.requests[0].init.headers.get('Authorization'), 'Bearer fixture-vendor');
});

test('typing cancels an older vendor suggestion request without opening an uncertain-action popup', async () => {
  let started;
  const ready = new Promise(resolve => {started=resolve;});
  const f = fixture(async (_input, init) => {
    if (JSON.parse(init.body).Query === 'Fi') {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('Search replaced', 'AbortError')), {once:true});
        started();
      });
    }
    return Response.json({ok:true,customers:[{CustomerRef:'FIXTURE/001',CustomerName:'Fixture child'}]});
  });
  const old = new AbortController(), revision = f.cache.version();
  const pending = f.send('vendorCustomerSearch', {...post('vendorCustomerSearch',{Query:'Fi'}),signal:old.signal});
  const rejected = assert.rejects(pending, {name:'AbortError'});
  await ready; old.abort(); await rejected;
  const response = await f.send('vendorCustomerSearch',post('vendorCustomerSearch',{Query:'Fixture child'}));
  assert.equal((await response.json()).customers.length,1);
  assert.equal(f.alerts.length,0);
  assert.equal(f.cache.version(),revision);
});

test('read failures remain available to the lookup UI without a modal or saved-action claim', async () => {
  for (const status of [404,403,500]) {
    const f=fixture(async()=>Response.json({ok:false,message:'Lookup unavailable'}, {status}));
    const result=await f.send('vendorWalletLookup');
    assert.equal(result.status,status); assert.equal((await result.json()).message,'Lookup unavailable');
    assert.equal(f.alerts.length,0);
  }
  const f=fixture(async()=>{throw new TypeError('Offline');});
  await assert.rejects(f.send('vendorCustomerSearch'),/Offline/);
  assert.equal(f.alerts.length,0);
});

test('actual vendor sales still report success, refusal and uncertain outcomes and invalidate balances', async () => {
  for (const action of ['recordVendorSale','recordVendorWalletPurchase']) {
    const success=fixture(async()=>Response.json({ok:true,message:'Sale recorded.'}));
    const revision=success.cache.version(); await success.send(action);
    assert.equal(success.alerts.length,1); assert.equal(success.alerts[0].message,'Sale recorded.');
    assert.ok(success.cache.version()>revision);
    const refused=fixture(async()=>Response.json({ok:false,message:'Insufficient balance.'},{status:409}));
    await refused.send(action); assert.equal(refused.alerts[0].title,'Action not completed');
    assert.equal(refused.alerts[0].message,'Insufficient balance.');
    const uncertain=fixture(async()=>{throw new DOMException('Connection interrupted','AbortError');});
    await assert.rejects(uncertain.send(action),{name:'AbortError'});
    assert.equal(uncertain.alerts[0].title,'Check the outcome before retrying');
  }
  const f=fixture();
  for(const action of ['approve','reject','saveVendor','futureUnknownAction'])
    assert.equal(f.feedback.isMutation(new URL('https://school.example/api/staff-vendor-settlements'),post(action)),true);
});
