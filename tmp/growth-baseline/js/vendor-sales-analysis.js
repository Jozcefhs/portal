// Read-only visualisation of the complete, server-scoped vendor statement.
// Never use this presentation model to calculate a payment or change a sale.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(value / 100);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const minor = (row,key,display) => Number.isSafeInteger(row[key]) ? row[key] : Math.round(number(row[display]) * 100);
const saleTypes = new Set(['Sale','Vendor collected sale']);

export function analyseVendorSales(statement) {
  const entries = statement.entries || [], sales = entries.filter(row => saleTypes.has(row.Type));
  const refunds = entries.filter(row => row.Type === 'Refund');
  const openings = entries.filter(row => row.Type === 'Reviewed historical opening');
  const days = (Date.parse(statement.to) - Date.parse(statement.from)) / 86400000 + 1;
  const months = (Number(statement.to.slice(0,4)) - Number(statement.from.slice(0,4))) * 12
    + Number(statement.to.slice(5,7)) - Number(statement.from.slice(5,7)) + 1;
  const interval = days <= 45 ? 'day' : months <= 60 ? 'month' : 'year';
  const keyFor = date => String(date || '').slice(0,interval === 'day' ? 10 : interval === 'month' ? 7 : 4);
  const timeline = new Map(), products = new Map(), receipts = new Set();
  // Include zero-sale intervals, so quiet days do not disappear from the chart.
  const cursor = new Date(`${statement.from}T00:00:00Z`), end = new Date(`${statement.to}T00:00:00Z`);
  if (interval === 'month') cursor.setUTCDate(1);
  if (interval === 'year') { cursor.setUTCMonth(0,1); }
  while (cursor <= end && timeline.size < 10000) {
    const date = keyFor(cursor.toISOString()); timeline.set(date,{label:date,sales:0,refunds:0});
    if (interval === 'day') cursor.setUTCDate(cursor.getUTCDate()+1);
    else if (interval === 'month') cursor.setUTCMonth(cursor.getUTCMonth()+1);
    else cursor.setUTCFullYear(cursor.getUTCFullYear()+1);
  }
  let gross = 0, refunded = 0, units = 0, schoolCollected = 0, vendorCollected = 0, held = 0;
  for (const row of sales) {
    const amount = minor(row,'GrossCents','Gross'); gross += amount;
    receipts.add(row.SaleNo || row.EntryId);
    if (row.CollectionMode === 'Vendor collected' || row.Type === 'Vendor collected sale') vendorCollected += amount;
    else schoolCollected += amount;
    if (row.SettlementHold) held++;
    const bucket = timeline.get(keyFor(row.Date)); if (bucket) bucket.sales += amount;
    for (const item of row.Items || []) {
      const quantity = number(item.Quantity), key = item.InventoryDocumentId || item.ItemName;
      const product = products.get(key) || {label:item.ItemName || 'Unnamed product',quantity:0,amount:0};
      product.quantity += quantity; units += quantity;
      product.amount += Math.round(number(item.Amount ?? number(item.UnitPrice) * quantity) * 100);
      products.set(key,product);
    }
  }
  for (const row of refunds) {
    const amount = minor(row,'RefundCents','Refund'); refunded += amount;
    const bucket = timeline.get(keyFor(row.Date)); if (bucket) bucket.refunds += amount;
  }
  return {gross,refunded,afterRefunds:gross-refunded,receipts:receipts.size,units,schoolCollected,vendorCollected,held,
    average:receipts.size ? Math.round(gross/receipts.size) : 0,interval,timeline:[...timeline.values()],
    products:[...products.values()].sort((a,b) => b.amount-a.amount || a.label.localeCompare(b.label)),openings};
}

function trendChart(rows) {
  const maximum = Math.max(100,...rows.map(row => Math.max(row.sales,row.refunds)));
  const left = 66, top = 18, width = 516, height = 188, step = width / Math.max(1,rows.length), bar = Math.min(22,step*.34);
  const ticks = [0,.5,1].map(ratio => {
    const y = top+height*(1-ratio), label = new Intl.NumberFormat('en-NG',{notation:'compact',maximumFractionDigits:1}).format(maximum*ratio/100);
    return `<line x1="${left}" y1="${y}" x2="${left+width}" y2="${y}" class="vendor-chart-gridline"/><text x="${left-8}" y="${y+4}" text-anchor="end">₦${esc(label)}</text>`;
  }).join('');
  const bars = rows.map((row,index) => {
    const centre = left+(index+.5)*step;
    return [['sales',-bar],['refunds',0]].map(([key,offset]) => {
      const h = row[key]/maximum*height;
      return `<rect class="vendor-chart-${key}" x="${centre+offset}" y="${top+height-h}" width="${bar}" height="${h}"><title>${esc(row.label)} · ${key === 'sales' ? 'Sales' : 'Refunds'}: ${money(row[key])}</title></rect>`;
    }).join('') + (index % Math.max(1,Math.ceil(rows.length/6)) === 0
      ? `<text x="${centre}" y="${top+height+24}" text-anchor="middle">${esc(row.label)}</text>` : '');
  }).join('');
  return `<div class="vendor-trend-scroll"><svg class="vendor-trend-chart" viewBox="0 0 600 246" role="img" aria-label="Sales and refunds by date. Exact amounts are in the chart data table below."><title>Sales and refunds by date</title>${ticks}${bars}</svg></div>`;
}

function barChart(rows,label) {
  const maximum = Math.max(1,...rows.map(row => row.amount));
  return `<div class="vendor-bar-chart" role="list" aria-label="${esc(label)}">${rows.map(row => `<div class="vendor-bar-row" role="listitem"><div><span>${esc(row.label)}</span><strong>${money(row.amount)}</strong></div><div class="vendor-bar-track" aria-hidden="true"><span style="width:${Math.max(0,row.amount)/maximum*100}%"></span></div>${row.quantity === undefined ? '' : `<small>${esc(row.quantity)} units sold</small>`}</div>`).join('')}</div>`;
}

export function renderVendorSalesAnalysis(statement) {
  const model = analyseVendorSales(statement);
  const metric = (label,value) => `<div class="vendor-metric"><span>${label}</span><strong>${value}</strong></div>`;
  return `<div class="vendor-analysis"><h3>${esc(statement.vendor.Name)} · Sales analysis</h3><p>${esc(statement.from)} — ${esc(statement.to)} · Confirmed vendor receipts only. Amounts below are for this period, not the payable balance.</p>
    <div class="vendor-metrics">${metric('Confirmed sales',money(model.gross))}${metric('Refunds in period',money(model.refunded))}${metric('Sales less refunds',money(model.afterRefunds))}${metric('Sale receipts',model.receipts)}${metric('Units sold (before returns)',model.units)}${metric('Average receipt',money(model.average))}</div>
    ${model.held ? `<p class="vendor-notice">${model.held} paid sale(s) still need stock-issue review. They are included in sales, but may be held from settlement.</p>` : ''}
    ${!model.receipts ? '<p class="vendor-notice">No confirmed sale receipts in this period. Earlier organisation-owned sales are not reassigned by a product ownership upload.</p>' : ''}
    <div class="vendor-analysis-charts"><section class="vendor-chart-card vendor-chart-wide"><h4>Sales & refunds · by ${model.interval}</h4><div class="vendor-chart-legend"><span>Sales</span><span>Refunds</span></div>${trendChart(model.timeline)}
      <details><summary>View exact chart data</summary><div class="vendor-table-wrap"><table class="vendor-table"><caption>Period sales and refunds by statement date</caption><thead><tr><th scope="col">Date</th><th scope="col">Sales</th><th scope="col">Refunds</th></tr></thead><tbody>${model.timeline.map(row => `<tr><th scope="row">${esc(row.label)}</th><td>${money(row.sales)}</td><td>${money(row.refunds)}</td></tr>`).join('')}</tbody></table></div></details></section>
    <section class="vendor-chart-card"><h4>Top products · sales value</h4><p>Before refunds; based on the product details saved with each sale.</p>${model.products.length ? barChart(model.products.slice(0,8),'Top eight products by gross sales') : '<p>No itemised sales in this period.</p>'}
      ${model.products.length > 8 ? '<small>Showing the top 8 products.</small>' : ''}</section>
    <section class="vendor-chart-card"><h4>Who collected the sales money?</h4><p>Gross sales, before refunds or agreed charges. Vendor-collected sales are not money owed by the school / organisation.</p>${barChart([{label:'School / organisation collected',amount:model.schoolCollected},{label:'Vendor collected',amount:model.vendorCollected}],'Gross sales by collection method')}</section></div>
    ${model.openings.length ? `<section class="vendor-chart-card vendor-historical-analysis"><h4>Reviewed historical openings · separate from charts</h4><p>These are summaries of earlier sales, not new receipts or dated product-level sales. They are excluded from the charts and receipt counts above.</p><div class="vendor-table-wrap"><table class="vendor-table"><thead><tr><th scope="col">Opening date / reference</th><th scope="col">Historical sales</th><th scope="col">Refunds</th><th scope="col">Agreed deductions</th><th scope="col">Previously paid</th><th scope="col">Amount owed at opening</th></tr></thead><tbody>${model.openings.map(row => `<tr><td>${esc(row.Date)}<small>${esc(row.OpeningReference)}</small></td><td>${money(minor(row,'GrossCents','Gross'))}</td><td>${money(minor(row,'RefundCents','Refund'))}</td><td>${money(minor(row,'ChargeCents','SchoolCharge'))}</td><td>${money(number(row.PaidCents))}</td><td>${money(number(row.OutstandingCents))}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <p class="vendor-analysis-footnote">Refunds follow their recorded refund date and may relate to earlier sales. Units and product rankings do not infer returned quantities from a money-only refund. Use Statement & request for authoritative settlement balances.</p></div>`;
}
