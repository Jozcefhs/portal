import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyseVendorSales,renderVendorSalesAnalysis} from '../js/vendor-sales-analysis.js';

const statement = (entries,from='2026-10-01',to='2026-10-10') => ({vendor:{Name:'Vincent <Stores>'},from,to,entries});
const sale = (overrides={}) => ({Type:'Sale',SaleNo:'SALE-1',Date:'2026-10-02T13:00:00Z',GrossCents:30000,
  Items:[{ItemName:'Water',InventoryDocumentId:'water',Quantity:2,UnitPrice:100,Amount:200},
    {ItemName:'Biscuit',InventoryDocumentId:'biscuit',Quantity:1,UnitPrice:100,Amount:100}],...overrides});

test('charts use actual paid sales including direct collection; refunds never count the original products twice',()=>{
  const model=analyseVendorSales(statement([sale(),sale({SaleNo:'SALE-2',Type:'Vendor collected sale',GrossCents:5000,NetCents:0,
    Items:[{ItemName:'Water',InventoryDocumentId:'water',Quantity:1,UnitPrice:50,Amount:50}]}),
    {Type:'Refund',Date:'2026-10-03',RefundCents:10000,Items:sale().Items},
    {Type:'Stock issue reviewed',Date:'2026-10-04',Items:sale().Items}]));
  assert.equal(model.gross,35000);assert.equal(model.refunded,10000);assert.equal(model.afterRefunds,25000);
  assert.equal(model.receipts,2);assert.equal(model.units,4);assert.equal(model.average,17500);
  assert.equal(model.schoolCollected,30000);assert.equal(model.vendorCollected,5000);
  assert.deepEqual(model.products,[{label:'Water',quantity:3,amount:25000},{label:'Biscuit',quantity:1,amount:10000}]);
  assert.equal(model.timeline[1].sales,35000);assert.equal(model.timeline[2].refunds,10000);
  assert.equal(model.timeline.length,10);assert.equal(model.timeline[0].sales,0);
});

test('historical openings are shown separately, never as a receipt, a sale day or product revenue',()=>{
  const s=statement([{Type:'Reviewed historical opening',Date:'2026-10-08',OpeningReference:'HIST-1',GrossCents:20000000,
    RefundCents:1000000,ChargeCents:910000,PaidCents:1000000,OutstandingCents:17090000}]);
  const model=analyseVendorSales(s),html=renderVendorSalesAnalysis(s);
  assert.equal(model.gross,0);assert.equal(model.refunded,0);assert.equal(model.receipts,0);assert.equal(model.products.length,0);
  assert.ok(model.timeline.every(row=>row.sales===0 && row.refunds===0));
  assert.match(html,/Reviewed historical openings · separate from charts/);assert.match(html,/₦170,900\.00/);
  assert.match(html,/No confirmed sale receipts/);assert.match(html,/Vincent &lt;Stores&gt;/);
});

test('date buckets include quiet days, leap days, monthly ranges and long-range year grouping',()=>{
  assert.deepEqual(analyseVendorSales(statement([],'2028-02-28','2028-03-01')).timeline.map(row=>row.label),['2028-02-28','2028-02-29','2028-03-01']);
  const monthly=analyseVendorSales(statement([sale()],'2026-01-15','2026-12-10'));
  assert.equal(monthly.interval,'month');assert.equal(monthly.timeline.length,12);assert.equal(monthly.timeline[9].sales,30000);
  const yearly=analyseVendorSales(statement([sale()],'2020-01-01','2026-12-31'));
  assert.equal(yearly.interval,'year');assert.equal(yearly.timeline.length,7);assert.equal(yearly.timeline[6].sales,30000);
});

test('money is aggregated in minor units, snapshots outrank current prices and chart labels are escaped',()=>{
  const s=statement([sale({GrossCents:undefined,Gross:.3,SettlementHold:true,Items:[{ItemName:'<img onerror="bad">',Quantity:3,UnitPrice:.1}]}),
    sale({SaleNo:'SALE-2',GrossCents:10,Items:[{ItemName:'<img onerror="bad">',Quantity:1,UnitPrice:999,Amount:.1}]})]);
  const model=analyseVendorSales(s),html=renderVendorSalesAnalysis(s);
  assert.equal(model.gross,40);assert.equal(model.products[0].amount,40);assert.equal(model.held,1);
  assert.doesNotMatch(html,/<img|NaN|Infinity/);assert.match(html,/&lt;img/);assert.match(html,/stock-issue review/);
  assert.match(html,/role="img" aria-label="Sales and refunds by date/);assert.match(html,/View exact chart data/);
});

test('empty and refund-only periods are honest, finite and preserve a negative period result',()=>{
  const s=statement([{Type:'Refund',Date:'2026-10-03',RefundCents:10000}]);
  const model=analyseVendorSales(s),html=renderVendorSalesAnalysis(s);
  assert.equal(model.afterRefunds,-10000);assert.equal(model.average,0);assert.equal(model.receipts,0);
  assert.doesNotMatch(html,/NaN|Infinity/);assert.match(html,/No itemised sales/);assert.match(html,/earlier sales/);
});

test('chart code is lazy-loaded and included in the offline shell, with responsive bounded containers',async()=>{
  const [client,worker,css]=await Promise.all(['js/vendor-settlements.js','sw.js','css/vendor-settlements.css'].map(path=>readFile(new URL('../'+path,import.meta.url),'utf8')));
  assert.match(client,/await import\('\.\/vendor-sales-analysis\.js'\)/);
  assert.match(worker,/'\/js\/vendor-sales-analysis\.js'/);
  assert.match(css,/\.vendor-trend-scroll\{overflow-x:auto/);
  assert.match(css,/\.vendor-analysis-charts\{grid-template-columns:minmax\(0,1fr\)\}/);
});
