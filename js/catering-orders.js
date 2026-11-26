import { printCustomerDocument } from './commerce-print.js';
export function mountCateringOrders(panel, inventory, request, escape, money) {
  const options = values => values.map(v=>'<option>'+escape(v)+'</option>').join('');
  panel.innerHTML = `<h3>Orders and events</h3><form class="workflow-form workflow-form-grid">
    <label>Booking type<select name="Kind">${options(['Supply order','Event catering'])}</select></label>
    <label>Customer<input name="CustomerName" required></label><label>Phone or email<input name="Contact" required></label>
    <label>Service date and local time<input type="datetime-local" name="ServiceAt" required></label>
    <label>Fulfilment<select name="Fulfilment">${options(['Collection','Delivery','On-site service'])}</select></label>
    <label>Venue or delivery address<input name="Venue"></label><label hidden data-guests>Guest count<input type="number" name="Guests" min="1" max="100000"></label>
    <label>Menu item<select name="Menu"><option value="">Choose item</option>${inventory.filter(i=>!i.VendorId && i.Active!==false && String(i.Active).toUpperCase()!=='NO' && Number(i.SalePrice ?? i.Price)>0).map(i=>'<option value="'+escape(i.__id)+'">'+escape(i.ItemName)+' · '+money(i.SalePrice ?? i.Price)+'</option>').join('')}</select></label>
    <label>Servings or packages<input name="Quantity" type="number" min="1" value="1"></label><button type="button" data-add>Add menu item</button>
    <ul data-cart></ul><label>Dietary, preparation or delivery instructions<textarea name="Notes" maxlength="1500"></textarea></label>
    <button>Confirm booking</button></form>
    <h3>Booking register</h3><button type="button" data-list>Load bookings</button><div data-register></div>
    <div data-detail></div><p role="status" aria-live="polite"></p>`;
  const form = panel.querySelector('form'), f = form.elements;
  const status = panel.querySelector('[role=status]'), detail = panel.querySelector('[data-detail]');
  let id = crypto.randomUUID(), cart = [], rows = [], current;
  function drawCart() {
    panel.querySelector('[data-cart]').innerHTML = cart.map((line,i)=>'<li>'+escape(line.name)+' × '+escape(line.Quantity)+' <button type="button" data-remove="'+i+'">Remove</button></li>').join('');
  }
  function toggle() {
    const event = f.Kind.value==='Event catering';
    panel.querySelector('[data-guests]').hidden = !event;
    f.Guests.required = event;
    f.Venue.required = event || f.Fulfilment.value!=='Collection';
  }
  f.Kind.onchange = f.Fulfilment.onchange = toggle;
  async function list() {
    rows = (await request({Operation:'list'})).orders;
    panel.querySelector('[data-register]').innerHTML = rows.map((o,i)=>'<p><button data-open="'+i+'">'+escape(o.ServiceAt.replace('T',' ')+' · '+o.CustomerName)+'</button> '+escape(o.Kind+' · '+o.Status)+'</p>').join('') || '<p>No bookings in this branch.</p>';
  }
  function show(o) {
    current = o;
    const next = {Confirmed:'Preparing',Preparing:'Ready',Ready:'Fulfilled'}[o.Status];
    detail.innerHTML = '<h4>'+escape(o.CustomerName+' · '+o.Status)+'</h4><p>'+escape([o.OrderNo,o.Kind,o.ServiceAt.replace('T',' '),o.Contact,o.Fulfilment,o.Venue,o.Guests?o.Guests+' guests':''].filter(Boolean).join(' · '))+'</p>'+
      '<ul>'+o.Items.map(i=>'<li>'+escape(i.ItemName)+' × '+escape(i.Quantity)+' · '+money(i.Amount)+'</li>').join('')+'</ul><p>'+escape(o.Notes)+'</p><p>Total '+money(o.Amount)+' · Paid '+money(o.Paid)+' · Balance '+money(o.Balance)+'</p><button data-print>Print order confirmation</button>'+
      (next?'<button data-stage="'+next+'">Mark '+next.toLowerCase()+'</button> ':'')+
      (next && !o.Paid?'<button data-stage="Cancelled">Cancel booking</button>':'')+
      (o.Status!=='Cancelled' && o.Balance?'<form data-payment class="workflow-form workflow-form-grid"><label>Receipt reference<input name="Reference" required></label><label>Amount received<input name="Amount" required type="number" step="0.01" min="0.01" max="'+escape(o.Balance)+'"></label><label>Paid by<select name="Method"><option>Cash</option><option>Bank</option></select></label><button>Record payment</button></form>':'');
  }
  async function run(task) {
    if (panel.dataset.busy) return;
    panel.dataset.busy='1';
    try { await task(); } catch(e) {status.textContent=e.message;}
    finally {delete panel.dataset.busy;}
  }
  panel.onsubmit = e=>{
    e.preventDefault();
    const payment=e.target.hasAttribute('data-payment');
    const payload=Object.fromEntries(new FormData(e.target));
    run(async()=>{
      const result=await request(payment?{...payload,Operation:'payment',OrderNo:current.OrderNo}:
        {...payload,Operation:'create',OrderNo:id,Items:cart.map(({InventoryDocumentId,Quantity})=>({InventoryDocumentId,Quantity}))});
      if (!payment) {id=crypto.randomUUID();cart=[];form.reset();drawCart();toggle();}
      show(result.order);status.textContent=payment?'Payment recorded.':'Booking confirmed.';await list();
    });
  };
  panel.onclick=e=>{
    const b=e.target.closest('button');
    if(!b || b.closest('form') && b.type==='submit') return;
    run(async()=>{
      if(b.hasAttribute('data-add')) {
        const item=inventory.find(i=>i.__id===f.Menu.value), qty=Number(f.Quantity.value);
        if(!item || !Number.isSafeInteger(qty) || qty<1 || cart.some(i=>i.InventoryDocumentId===item.__id)) throw Error('Choose a menu item and a whole quantity. Remove the existing line to change its quantity.');
        cart.push({InventoryDocumentId:item.__id,name:item.ItemName,Quantity:qty});drawCart();
      } else if(b.hasAttribute('data-remove')) {cart.splice(Number(b.dataset.remove),1);drawCart();}
      else if(b.hasAttribute('data-print')) {
        const o=current;
        printCustomerDocument(o.Kind,[o.OrderNo,o.CustomerName,o.Contact,o.Status,o.ServiceAt.replace('T',' '),o.Fulfilment,o.Venue,o.Guests?o.Guests+' guests':'',...o.Items.map(l=>l.ItemName+' × '+l.Quantity+' · '+money(l.Amount)),o.Notes,'Total '+money(o.Amount),'Paid '+money(o.Paid),'Balance '+money(o.Balance)]);
      } else if(b.hasAttribute('data-list')) await list();
      else if(b.hasAttribute('data-open')) show(rows[Number(b.dataset.open)]);
      else if(b.dataset.stage) {
        const result=await request({Operation:'progress',OrderNo:current.OrderNo,Status:b.dataset.stage});
        show(result.order);status.textContent='Booking updated.';await list();
      }
    });
  };
}
