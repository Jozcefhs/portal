export async function mountSalesCounter(host,section,request,escape,money,print) {
  host.innerHTML=`<h2>${section==='restaurant'?'Catering sales':'Sales counter'}</h2>
    <form data-sale class="workflow-form workflow-form-grid">
      <label>Item<select name="item"></select></label><label>Quantity<input name="quantity" type="number" min="0" step="any" value="1"></label>
      <label>Unit<select name="unit"></select></label><label data-serial-label hidden>Serial numbers, one per piece<input name="serials"></label>
      <button type="button" data-add>Add item</button><ul data-cart></ul>
      <label>Customer<input name="customer" placeholder="Walk-in customer"></label><label>Payment method<select name="method"><option>Cash</option><option>Bank Transfer</option></select></label>
      <label data-bank hidden>Bank payment reference<input name="reference"></label>
      <button type="submit">Complete sale</button>
    </form><div data-receipt></div>
    ${section==='organizationStore'?'<h3>Issue a paid QR order</h3><form data-lookup class="workflow-form"><label>Customer receipt number or payment reference<input name="reference" required></label><button>Find paid purchase</button></form><div data-order></div>':''}
    <p role="status" aria-live="polite"></p>`;
  const form=host.querySelector('[data-sale]'), fields=form.elements, cart=[], status=host.querySelector('[role=status]');
  let stock=[], requestId=crypto.randomUUID(), lastSale, purchase, lookup='';
  const updateUnits=()=>{
    const item=stock.find(i=>i.InventoryDocumentId===fields.item.value);
    fields.unit.innerHTML=(item?.TradeMode==='cable'?['metre','yard','coil']:['piece']).map(u=>'<option>'+u+'</option>').join('');
    fields.serials.value='';
    host.querySelector('[data-serial-label]').hidden=item?.TradeMode!=='serial';
  };
  const locationText = item => item.StoreLocation ? ' · ' + escape(item.StoreLocation) : '';
  const loadStock=async()=>{
    stock=(await request({action:'catalogue'})).items;
    fields.item.innerHTML='<option value="">Choose item</option>'+stock.map(i=>'<option value="'+escape(i.InventoryDocumentId)+'">'+escape(i.ItemName)+' · '+money(i.Price)+(i.TradeMode==='cable'?' / metre':'')+locationText(i)+'</option>').join('');
    updateUnits();
  };
  const drawCart=()=>{host.querySelector('[data-cart]').innerHTML=cart.map((l,i)=>'<li>'+escape(l.ItemName)+' × '+escape(l.Quantity)+' '+escape(l.Unit)+' <button type="button" data-remove="'+i+'">Remove</button></li>').join('');};
  const info=s=>'<p>'+escape(s.CustomerName)+' · '+escape(s.SaleNo)+' · '+money(s.Amount)+'</p><ul>'+s.Items.map(i=>'<li>'+escape(i.ItemName)+' × '+escape(i.SaleQuantity ?? i.Quantity)+' '+escape(i.SaleUnit || i.Unit || '')+locationText(i)+'</li>').join('')+'</ul>';
  const showPurchase=()=>{host.querySelector('[data-order]').innerHTML=info(purchase)+(purchase.IssuedAt?'<p>Already issued by '+escape(purchase.IssuedBy)+' · '+escape(purchase.IssuedAt)+'</p>':'<button type="button" data-issue>Confirm items handed over</button>');};
  async function run(task) {
    if(host.dataset.busy) return;
    host.dataset.busy='1';
    try {await task();} catch(e) {status.textContent=e.message;} finally {delete host.dataset.busy;}
  }
  fields.item.onchange=updateUnits;
  fields.method.onchange=()=>{const bank=fields.method.value==='Bank Transfer';host.querySelector('[data-bank]').hidden=!bank;fields.reference.required=bank;};
  host.querySelector('[data-lookup] input')?.addEventListener('input',()=>{purchase=null;host.querySelector('[data-order]').replaceChildren();});
  host.onclick=e=>{
    const b=e.target.closest('button');if(!b || b.type==='submit' && b.closest('form')) return;
    run(async()=>{
      if(b.hasAttribute('data-add')) {
        const item=stock.find(i=>i.InventoryDocumentId===fields.item.value),qty=Number(fields.quantity.value);
        if(!item || !(qty>0) || cart.some(l=>l.InventoryDocumentId===item.InventoryDocumentId)) throw Error('Choose an item and quantity. Remove an existing line before changing it.');
        const serials=fields.serials.value.split(',').map(s=>s.trim()).filter(Boolean);
        if(item.TradeMode==='serial' && serials.length!==qty) throw Error('Enter one serial number per piece.');
        cart.push({...item,Quantity:qty,Unit:fields.unit.value,Serials:serials});drawCart();
      } else if(b.hasAttribute('data-remove')) {cart.splice(Number(b.dataset.remove),1);drawCart();}
      else if(b.hasAttribute('data-print')) print(lastSale);
      else if(b.hasAttribute('data-issue') && purchase) {
        const r=await request({action:'issue',Reference:lookup,SaleNo:purchase.SaleNo});
        purchase=r.sale;showPurchase();status.textContent=r.alreadyIssued?'This order was already handed over.':'Handover recorded.';
      }
    });
  };
  host.onsubmit=e=>{
    e.preventDefault();
    run(async()=>{
      if(e.target===form) {
        if(!cart.length) throw Error('Add an item first.');
        const r=await request({action:'sell',RequestId:requestId,Method:fields.method.value,CustomerName:fields.customer.value,Reference:fields.reference.value,
          Items:cart.map(({InventoryDocumentId,Quantity,Unit})=>({InventoryDocumentId,Quantity,Unit})),
          Serials:cart.map(l=>l.Serials),SpecialItems:cart.some(l=>l.TradeMode==='cable' || l.TradeMode==='serial')});
        lastSale=r.sale;requestId=crypto.randomUUID();cart.length=0;form.reset();fields.method.onchange();drawCart();
        host.querySelector('[data-receipt]').innerHTML=info(lastSale)+'<button type="button" data-print>Print receipt</button>';
        status.textContent='Sale recorded.';await loadStock();
      } else {
        lookup=e.target.elements.reference.value.trim();purchase=null;host.querySelector('[data-order]').replaceChildren();
        const r=await request({action:'lookup',Reference:lookup});purchase=r.sale;showPurchase();
        status.textContent=purchase.IssuedAt?'This order was already handed over.':'Check the items against the customer’s receipt before handing them over.';
      }
    });
  };
  await loadStock();
}
