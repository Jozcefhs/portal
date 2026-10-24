import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as rules from '../functions/lib/vendor-settlement-rules.js';

const source = (await readFile(new URL('../functions/lib/vendor-store-policy.js', import.meta.url), 'utf8'))
  .replace(/^import[^;]+;\r?\n/gm, '').replace(/export /g, '');

for (const edition of ['faith', 'organization', 'school']) {
  test(`${edition}: owner labels use one read per owner, preserve stock and exclude private vendor details`, async () => {
    const actor = { edition, branchId: 'main' }, scope = rules.settlementScope(actor), reads = [];
    const vendor = { ...scope, SchoolSection: 'Secondary', VendorId: 'v1', Name: 'Independent Books', BankAccountNumber: 'private', OrganisationSalesEnabled: false };
    const policy = vm.runInNewContext(`${source}\n({withVendorStorePolicy})`, { ...rules,
      getDocuments: async (_env, collection, ids) => { reads.push([collection, Array.from(ids)]); return ids.map(id => id === 'v1' ? vendor : { ...vendor, ScopeKey: 'faith--elsewhere', Name: 'Other branch' }); } });
    const stock = [{ ItemName: 'Oil', VendorId: 'v1', Quantity: 26 }, { ItemName: 'Book', VendorId: 'v1', Quantity: 10 },
      { ItemName: 'Envelope', Quantity: 99 }, { ItemName: 'Wrong owner', VendorId: 'v2', Quantity: 3 }];
    const before = structuredClone(stock), result = await policy.withVendorStorePolicy({}, actor, stock);
    assert.deepEqual(reads, [['commerceVendors', ['v1', 'v2']]]);
    assert.equal(result[0].VendorName, 'Independent Books'); assert.equal(result[1].OrganisationSalesEnabled, false);
    assert.equal(result[2].OrganisationSalesEnabled, undefined);
    assert.equal(result[3].VendorName, ''); assert.equal(result[3].OrganisationSalesEnabled, false);
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.deepEqual(stock, before); assert.deepEqual(Array.from(result, r => r.Quantity), [26, 10, 99, 3]);
    await policy.withVendorStorePolicy({}, actor, [stock[2]]); assert.equal(reads.length, 1);
    delete vendor.OrganisationSalesEnabled;
    assert.equal((await policy.withVendorStorePolicy({}, actor, [stock[0]]))[0].OrganisationSalesEnabled, true);
  });
}

const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const renderSource = adminSource.slice(adminSource.indexOf('function renderOrganizationCommerceWorkspace('), adminSource.indexOf('function updateCommerceWorkspace('));
for (const edition of ['faith', 'organization']) {
  test(`${edition}: POS shows owner names, correct collection label and removes disabled vendor stock from cart/counts`, () => {
    let cartInventory;
    const esc = text => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const render = vm.runInNewContext(`${renderSource}\nrenderOrganizationCommerceWorkspace`, {
      clean: rules.clean, escapeHtml: esc, currentUser: {edition}, resolveDashboardEdition: user => user.edition,
      commerceInventory: (_s,data) => data.items, syncCommerceCart: (_s, rows) => { cartInventory=rows; },
      commerceCart: () => new Map(), commerceSalesSummary: () => ({todayAmount:0,paid:0,pending:0}),
      organizationCommerceSearch: {}, organizationCommerceCustomerDraft: {organizationStore:{}}, organizationCommerceLastSale: {},
      commerceItemStock: row => row.Quantity, commerceItemPrice: row => row.Price, commerceItemReference: (_s,row) => row.ItemName,
      commerceQuantityOptions: () => '<option>1</option>', money: value => String(value)
    });
    const html=render('organizationStore',{items:[
      {ItemName:'Oil',VendorId:'owner',VendorName:'Books <Owner>',Quantity:26,Price:1000},
      {ItemName:'Hidden product',VendorId:'other',OrganisationSalesEnabled:false,Quantity:10,Price:500},
      {ItemName:'Envelope',Quantity:99,Price:200}
    ]});
    assert.match(html,/Vendor: Books &lt;Owner&gt;/); assert.doesNotMatch(html,/>Books <Owner>/);
    assert.doesNotMatch(html,/Hidden product/);assert.equal(cartInventory.length,2);
    const owner=edition==='faith'?'Church':'Organisation';
    assert.ok(html.includes(`${owner} owned`));
    assert.ok(html.includes(`<option value="School collected">${owner} collected</option>`));
    assert.match(html,/<small>Available items<\/small><strong>2<\/strong>/);
  });
}
