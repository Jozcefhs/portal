/* Restricted vendor counter: amounts and all financial postings come from the server. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(Number(value || 0));
  let mounted;
  function mount(root, request, section) {
    mounted?.destroy();
    let data, disposed = false, busy = false, preview = null, checkoutId = '', customer = null, notice = '', failed = false;
    let draft = {PaymentMethod:section === 'tuckShop' ? 'Student Wallet' : 'Cash', CollectionMode:'School collected', CustomerName:''};
    const cart = new Map(), pending = new Set();
    const label = section === 'tuckShop' ? 'Tuck Shop' : section === 'restaurant' ? 'Restaurant' : 'Organisation Store';
    function status(message,error = false) {
      notice = message; failed = error;
      const el = root.querySelector('[data-status]');
      if (el) {el.textContent = message; el.classList.toggle('error',error);}
    }
    function invalidate() {preview = null; checkoutId = ''; draw();}
    async function call(action, body = {}) {
      if (busy || disposed) return null;
      busy = true;
      const controls = [...root.querySelectorAll('button,input,select')].map(el => [el,el.disabled]);
      controls.forEach(([el]) => {el.disabled = true;});
      const controller = new AbortController(); pending.add(controller);
      const timer = setTimeout(() => controller.abort(),45000);
      status(action.startsWith('record') ? 'Completing sale… Do not submit another checkout.' : 'Loading…');
      try {
        const result = await request(action,{...body,Section:section},controller.signal);
        return disposed ? null : result;
      } catch (error) {
        if (!disposed) status(error.name === 'AbortError'
          ? 'No response was confirmed. Keep this cart and retry the same checkout; the server prevents duplicate posting.' : error.message,true);
        return null;
      } finally {
        clearTimeout(timer); pending.delete(controller); busy = false;
        controls.forEach(([el,disabled]) => {if (el.isConnected) el.disabled = disabled;});
      }
    }
    async function load() {
      const result = await call('salesBootstrap');
      if (!result) return;
      data = result; cart.clear(); preview = null; checkoutId = ''; customer = null;
      status(result.message); draw();
    }
    function payload() {
      return {...draft, Items:[...cart].map(([Reference,Quantity]) => ({Reference,Quantity})),
        CollectionMode:draft.PaymentMethod === 'Student Wallet' ? 'School collected' : draft.CollectionMode};
    }
    function draw() {
      if (!data || disposed) return;
      const school = section === 'tuckShop', wallet = draft.PaymentMethod === 'Student Wallet';
      root.innerHTML = `<section class="vendor-workspace vendor-pos"><header class="vendor-header"><div><h2>${label}</h2><p>Sell your linked vendors’ products. Stock, payment and earnings are posted together.</p></div><button data-refresh>Refresh</button></header>
        <p class="vendor-status${failed ? ' error' : ''}" data-status role="status">${esc(notice)}</p>
        ${!data.sellingEnabled ? '<p class="vendor-notice">Selling is unavailable until Accounts confirms the setup, links this login and enables counter sales. Statements remain separate.</p>' : ''}
        <div class="vendor-pos-layout"><div><label>Search products<input data-search type="search" placeholder="Name or category"></label><div class="vendor-pos-products">
        ${data.products.filter(p => p.Active !== 'NO').map((p,index) => `<article data-product data-search-text="${esc(`${p.ItemName} ${p.Category}`.toLowerCase())}"><small>${esc(p.Category || 'Product')}</small><h3>${esc(p.ItemName)}</h3><strong>${money(p.Price)}</strong><small>${esc(p.Quantity)} available</small><button data-add="${index}" ${!data.sellingEnabled || Number(p.Quantity) < 1 ? 'disabled' : ''}>+ Add</button></article>`).join('') || '<p>No products are assigned to your linked selling vendors in this store.</p>'}
        </div></div><section class="vendor-pos-checkout"><h3>Current sale</h3>
        ${[...cart].map(([ref,qty]) => {const p = data.products.find(item => reference(item) === ref); return `<div class="vendor-pos-cart-row"><strong>${esc(p.ItemName)}</strong><label>Quantity<input data-quantity="${esc(ref)}" type="number" min="1" max="${esc(p.Quantity)}" step="1" value="${qty}"></label><button data-remove="${esc(ref)}" aria-label="Remove ${esc(p.ItemName)}">×</button></div>`;}).join('') || '<p>Select a product to begin.</p>'}
        <form class="vendor-form"><label class="vendor-full">Payment method<select name="PaymentMethod">${[...(school ? ['Student Wallet'] : []),'Cash','Bank Transfer','POS / Card'].map(method => `<option${method === draft.PaymentMethod ? ' selected' : ''}>${method}</option>`).join('')}</select></label>
        ${wallet ? `<label>Card ID<input name="WalletCardId" value="${esc(draft.WalletCardId)}" autocomplete="off" placeholder="Scan / enter NFC card"></label><label>Admission number<input name="AccountRef" value="${esc(draft.AccountRef)}" autocomplete="off"></label><button type="button" data-find class="vendor-full">Find customer</button>${customer ? `<p class="vendor-full">Customer: <strong>${esc(customer.DisplayName)}</strong> · ${esc(customer.AccountRef)}</p>` : ''}<label class="vendor-full">Wallet PIN (when required)<input name="WalletPin" type="password" inputmode="numeric" autocomplete="off" value="${esc(draft.WalletPin)}"></label>`
        : `<label class="vendor-full">Customer name<input name="CustomerName" value="${esc(draft.CustomerName)}" maxlength="160" placeholder="Walk-in customer"></label><label class="vendor-full">Who receives the money?<select name="CollectionMode"><option${draft.CollectionMode === 'School collected' ? ' selected' : ''}>School collected</option><option${draft.CollectionMode === 'Vendor collected' ? ' selected' : ''}>Vendor collected</option></select></label>${draft.PaymentMethod !== 'Cash' ? `<label class="vendor-full">Payment reference<input name="PaymentReference" value="${esc(draft.PaymentReference)}" required maxlength="200"></label>` : ''}`}
        <button type="button" data-preview class="vendor-full" ${!data.sellingEnabled || !cart.size || wallet && !customer ? 'disabled' : ''}>Preview total</button>
        ${preview ? `<p class="vendor-full">Confirmed total: <strong>${money(preview.Amount)}</strong></p><label class="vendor-check vendor-full"><input name="Confirmed" type="checkbox" required> ${wallet ? 'Customer has authorised this wallet purchase.' : 'I have received / confirmed the payment.'}</label><button type="submit" class="vendor-full">Complete sale</button>` : ''}</form></section></div></section>`;
      root.querySelector('[data-refresh]').onclick = load;
      root.querySelector('[data-search]').oninput = event => root.querySelectorAll('[data-product]').forEach(card => {card.hidden = !card.dataset.searchText.includes(event.target.value.toLowerCase());});
      const products = data.products.filter(p => p.Active !== 'NO');
      root.querySelectorAll('[data-add]').forEach(button => button.onclick = () => {
        const p = products[Number(button.dataset.add)], ref = reference(p), qty = (cart.get(ref) || 0) + 1;
        if (qty > Number(p.Quantity)) return status('The selected quantity exceeds available stock.',true);
        cart.set(ref,qty); invalidate();
      });
      root.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => {cart.delete(button.dataset.remove); invalidate();});
      root.querySelectorAll('[data-quantity]').forEach(input => input.onchange = () => {
        const p = data.products.find(item => reference(item) === input.dataset.quantity), qty = Number(input.value);
        if (!Number.isSafeInteger(qty) || qty < 1 || qty > Number(p.Quantity)) {draw(); return status('Enter a whole-number quantity within available stock.',true);}
        cart.set(input.dataset.quantity,qty); invalidate();
      });
      const form = root.querySelector('form');
      form.oninput = event => {
        if (event.target.name === 'Confirmed') return;
        draft[event.target.name] = event.target.value; preview = null; checkoutId = '';
        if (event.target.name === 'WalletCardId') {draft.AccountRef = ''; form.elements.AccountRef.value = '';}
        if (event.target.name === 'AccountRef') {draft.WalletCardId = ''; form.elements.WalletCardId.value = '';}
        if (['AccountRef','WalletCardId'].includes(event.target.name)) customer = null;
        if (event.target.tagName === 'SELECT') draw();
        else {form.querySelector('[type="submit"]')?.remove(); form.querySelector('[name="Confirmed"]')?.closest('label')?.remove();
          form.querySelectorAll('p').forEach(el => {if (el.textContent.startsWith('Confirmed total:') || ['AccountRef','WalletCardId'].includes(event.target.name)) el.remove();});
          const btn = form.querySelector('[data-preview]'); if (btn) btn.disabled = !data.sellingEnabled || !cart.size || wallet && !customer;}
      };
      root.querySelector('[data-find]')?.addEventListener('click',async () => {
        const result = await call('vendorWalletLookup',{AccountRef:draft.AccountRef,WalletCardId:draft.WalletCardId});
        if (result) {customer = result.account; draft.AccountRef = customer.AccountRef; preview = null; checkoutId = ''; status('Customer found. Preview the cart before completing payment.'); draw();}
      });
      root.querySelector('[data-preview]').onclick = async () => {
        const result = await call('previewVendorSale',payload());
        if (result) {preview = result; checkoutId ||= crypto.randomUUID(); status('Review the server-confirmed total and payment before completing the sale.'); draw();}
      };
      form.onsubmit = async event => {
        event.preventDefault(); if (!preview || !form.elements.Confirmed.checked || busy) return;
        const body = {...payload(),ExpectedAmount:preview.Amount,Confirmed:true,SaleRequestId:checkoutId};
        const result = await call(wallet ? 'recordVendorWalletPurchase' : 'recordVendorSale',body);
        if (!result) return;
        draft.WalletPin = ''; draft.WalletCardId = ''; draft.AccountRef = ''; cart.clear(); preview = null; checkoutId = ''; customer = null; draw(); await load();
        status(`${result.message} Receipt ${result.sale.SaleNo}; total ${money(result.sale.Amount)}.`,false);
      };
    }
    const reference = p => section === 'organizationStore' ? p.ItemCode || p.InventoryId : p.InventoryId;
    root.innerHTML = '<p class="vendor-status" data-status role="status">Loading vendor point of sale…</p>'; load();
    mounted = {destroy() {disposed = true; for (const controller of pending) controller.abort(); draft.WalletPin = ''; cart.clear();}};
    return mounted;
  }
  window.DynamaxVendorPOS = Object.freeze({mount,unmount() {mounted?.destroy(); mounted = undefined;}});
})();
