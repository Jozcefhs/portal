import { printCustomerDocument } from './commerce-print.js';
export function mountTradeCounter(panel, stock, request, escape, money) {
  const items = stock.filter(item => !item.VendorId && String(item.Active).toUpperCase() !== 'NO');
  let lines = [], quoteNo = crypto.randomUUID(), quotes = [], selected = null;
  const status = panel.querySelector('[role=status]');
  const form = panel.querySelector('form');
  const field = name => form.elements.namedItem(name);
  const summary = panel.querySelector('[data-lines]');
  const register = panel.querySelector('[data-register]');
  const detail = panel.querySelector('[data-detail]');
  const message = text => { status.textContent = text; };
  const run = async fn => {
    if (panel.dataset.busy) return;
    panel.dataset.busy = '1';
    try { await fn(); } catch (error) { message(error.message); }
    finally { delete panel.dataset.busy; }
  };
  const drawLines = () => {
    summary.innerHTML = lines.map((line,i)=>'<li>'+escape(items.find(x=>x.__id===line.InventoryDocumentId)?.ItemName)+' · '+escape(line.Quantity)+' '+escape(line.Unit)+' <button type="button" data-remove="'+i+'">Remove</button></li>').join('');
  };
  field('Item').innerHTML = '<option value="">Choose item</option>'+items.map(item=>'<option value="'+escape(item.__id)+'">'+escape(item.ItemCode+' · '+item.ItemName)+'</option>').join('');
  field('Item').onchange = () => {
    const item = items.find(x=>x.__id===field('Item').value);
    const units = item?.TradeMode==='cable'?['metre','yard','coil']:['piece'];
    field('Unit').innerHTML = units.map(unit=>'<option>'+unit+'</option>').join('');
  };
  field('Item').onchange();
  const refresh = async () => {
    quotes = (await request({Operation:'list'})).quotes;
    register.innerHTML = quotes.length ? quotes.map((q,i)=>'<p><button data-open="'+i+'">'+escape(q.CustomerName)+' · '+escape(q.QuoteNo)+'</button> '+escape(q.Status)+' · '+money(q.Amount)+(q.Balance?' · Due '+money(q.Balance):'')+'</p>').join('') : '<p>No trade quotations saved.</p>';
  };
  const show = q => {
    selected = q;
    detail.innerHTML = '<h4>'+escape(q.CustomerName)+' · '+escape(q.Status)+'</h4><p>Quote '+escape(q.QuoteNo)+'</p>'+q.Items.map((line,i)=>'<p>'+escape(line.ItemName)+' · '+escape(line.SaleQuantity)+' '+escape(line.SaleUnit)+' · '+money(line.Amount)+(q.Status==='Quoted' && line.TradeMode==='serial'?'<label>Serial numbers, one per piece (comma separated)<input data-serials="'+i+'"></label>':'')+'</p>').join('')+'<p>Total '+money(q.Amount)+'</p><button data-print>Print quotation or invoice</button>'+
      (q.Status==='Quoted'?'<label>Sale terms<select data-method><option>Credit</option><option>Cash</option><option>Bank</option></select></label><button data-sell>Convert quote to sale</button>':q.Status==='On credit'?'<p>Outstanding '+money(q.Balance)+'</p><label>Payment amount<input data-amount type="number" min="0.01" step="0.01"></label><label>Payment reference<input data-ref></label><label>Received by<select data-method><option>Cash</option><option>Bank</option></select></label><button data-pay>Record payment</button>':'');
  };
  form.onsubmit = event => {
    event.preventDefault();
    run(async()=>{
      const result=await request({Operation:'quote',QuoteNo:quoteNo,CustomerName:field('CustomerName').value,Items:lines});
      lines=[];quoteNo=crypto.randomUUID();drawLines();show(result.quote);message('Quotation saved.');await refresh();
    });
  };
  panel.onclick = event => {
    const button=event.target.closest('button');
    if (!button || panel.dataset.busy || (form.contains(button) && button.type==='submit')) return;
    run(async()=>{
      if (button.hasAttribute('data-add')) {
        const id=field('Item').value, qty=Number(field('Quantity').value);
        if (!id || !(qty>0) || lines.some(l=>l.InventoryDocumentId===id)) throw Error('Select an item and quantity. Remove an existing line before changing it.');
        lines.push({InventoryDocumentId:id,Quantity:qty,Unit:field('Unit').value});drawLines();
      } else if (button.hasAttribute('data-remove')) { lines.splice(Number(button.dataset.remove),1);drawLines(); }
      else if (button.hasAttribute('data-print')) {
        const q=selected;
        printCustomerDocument(q.Status==='Quoted'?'Quotation':'Sales invoice',[q.CustomerName,q.SaleNo || q.QuoteNo,q.CreatedAt.slice(0,10),...q.Items.map(l=>l.ItemName+' · '+l.SaleQuantity+' '+l.SaleUnit+' · '+money(l.Amount)),'Total '+money(q.Amount),q.Balance!=null?'Balance '+money(q.Balance):'']);
      } else if (button.hasAttribute('data-list')) await refresh();
      else if (button.hasAttribute('data-open')) show(quotes[Number(button.dataset.open)]);
      else if (button.hasAttribute('data-sell') || button.hasAttribute('data-pay')) {
        const serials={};
        detail.querySelectorAll('[data-serials]').forEach(el=>serials[el.dataset.serials]=el.value.split(',').map(s=>s.trim()).filter(Boolean));
        const result=await request({Operation:button.hasAttribute('data-pay')?'payment':'sell', QuoteNo:selected.QuoteNo,
          Method:detail.querySelector('[data-method]').value,Serials:serials,Reference:detail.querySelector('[data-ref]')?.value,Amount:detail.querySelector('[data-amount]')?.value});
        show(result.quote);message('Transaction recorded.');await refresh();
      } else if (button.hasAttribute('data-lookup') || button.hasAttribute('data-replace')) {
        const replace=button.hasAttribute('data-replace');
        const result=await request({Operation:replace?'replace':'lookup',Serial:panel.querySelector('[data-old]').value,
          NewSerial:panel.querySelector('[data-new]').value,Reason:panel.querySelector('[data-reason]').value});
        const s=result.serial;
        message([s.ItemCode,s.Serial,s.CustomerName,s.SaleNo,'Warranty ends '+s.ExpiresAt.slice(0,10),s.ReplacedBy && 'Replaced by '+s.ReplacedBy,s.Replaces && 'Replaces '+s.Replaces].filter(Boolean).join(' · '));
      }
    });
  };
}

export const tradeCounterForm = '<h3>Trade counter</h3><form><label>Customer or contractor<input name="CustomerName" required></label><label>Stock item<select name="Item"></select></label><label>Quantity<input name="Quantity" type="number" step="any" min="0" value="1"></label><label>Sell by<select name="Unit"></select></label><button type="button" data-add>Add line</button><ul data-lines></ul><button>Save quotation</button></form><h3>Quotations and credit invoices</h3><button data-list>Load register</button><div data-register></div><section data-detail></section><h3>Warranty lookup and replacement</h3><label>Original serial number<input data-old></label><button data-lookup>Look up warranty</button><label>Replacement serial number<input data-new></label><label>Reason for return<input data-reason></label><button data-replace>Issue replacement</button><p role="status"></p>';
