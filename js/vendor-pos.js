/* Restricted vendor counter: amounts and all financial postings come from the server. */
(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN'}).format(Number(value || 0));
  // Match the original POS's 100-per-add menu; retain larger quantities already in the cart.
  const quantityOptions = (stock, selected = 1) => {
    const max = Math.max(0,Math.min(100,Math.floor(Number(stock) || 0)));
    const values = Array.from({length:max},(_,i) => i + 1);
    if (Number.isSafeInteger(selected) && selected > max && selected <= Number(stock)) values.push(selected);
    return values.map(qty => `<option value="${qty}"${qty === selected ? ' selected' : ''}>${qty}</option>`).join('');
  };
  const lookupIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';
  let mounted;
  function mount(root, request, section) {
    mounted?.destroy();
    let data, disposed = false, busy = false, preview = null, checkoutId = '', customer = null, notice = '', failed = false;
    let draft = {PaymentMethod:section === 'tuckShop' ? 'Student Wallet' : 'Cash', CollectionMode:'School collected', CustomerName:''};
    const cart = new Map(), addQuantities = new Map(), pending = new Set();
    let search = '', manualLookupOpen = true;
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
      data = result; cart.clear(); addQuantities.clear(); preview = null; checkoutId = ''; customer = null;
      status(result.message); draw();
    }
    function payload() {
      return {...draft, Items:[...cart].map(([Reference,Quantity]) => ({Reference,Quantity})),
        CollectionMode:draft.PaymentMethod === 'Student Wallet' ? 'School collected' : draft.CollectionMode};
    }
    function draw() {
      if (!data || disposed) return;
      const school = section === 'tuckShop', wallet = draft.PaymentMethod === 'Student Wallet';
      const products = data.products.filter(p => p.Active !== 'NO');
      const entries = [...cart].map(([ref,qty]) => ({ref,qty,product:data.products.find(p => reference(p) === ref)}));
      const total = entries.reduce((sum,row) => sum + Number(row.product.Price || 0) * row.qty,0);
      root.innerHTML = `<section class="vendor-workspace vendor-pos"><header class="vendor-header workflow-intro"><div><h2>${label}</h2><p>Sell your linked vendors’ products. Stock, payment and earnings are posted together.</p></div><button type="button" data-refresh>Refresh</button></header>
        <p class="vendor-status${failed ? ' error' : ''}" data-status role="status">${esc(notice)}</p>
        ${!data.sellingEnabled ? '<p class="vendor-notice">Selling is unavailable until Accounts confirms the setup, links this login and enables counter sales. Statements remain separate.</p>' : ''}
        <div class="module-workspace-tabs vendor-pos-tabs" aria-label="Sales workspace"><button type="button" class="selected" data-pos-tab aria-current="page"><span aria-hidden="true">&#128722;</span><strong>Point of sale</strong></button></div>
        <section class="config-card department-primary-workflow tuck-shop-pos-workspace vendor-pos-shell">
        <header class="config-card-heading"><div><small>Stock-linked checkout</small><h3>${label} POS</h3><p>Select items, identify the customer, then complete payment. Stock updates automatically.</p></div><span class="workspace-feature-icon" aria-hidden="true">&#128722;</span></header>
        <div class="commerce-pos-layout"><section class="commerce-catalog" aria-label="Vendor product catalogue"><label class="commerce-search-label">Search items<input data-search type="search" value="${esc(search)}" placeholder="Name, category or unit"></label><div class="commerce-product-list vendor-pos-products">
        ${products.map((p,index) => {const ref = reference(p), searchText = `${p.ItemName} ${p.Category || ''} ${p.Unit || ''}`.toLowerCase(); return `<article class="commerce-product" data-product data-search-text="${esc(searchText)}"${searchText.includes(search.toLowerCase()) ? '' : ' hidden'}><div><strong>${esc(p.ItemName)}</strong><span>${esc([p.Category,p.Unit].filter(Boolean).join(' · '))}</span><small>${money(p.Price)} · ${esc(p.Quantity)} in stock</small></div><div class="commerce-product-action"><select data-add-quantity="${index}" aria-label="Quantity for ${esc(p.ItemName)}" ${!data.sellingEnabled || Number(p.Quantity) < 1 ? 'disabled' : ''}>${quantityOptions(p.Quantity,addQuantities.get(ref) || 1)}</select><button type="button" class="compact-icon-action commerce-add-button${cart.has(ref) ? ' is-added' : ''}" data-add="${index}" aria-label="Add ${esc(p.ItemName)} to cart" ${!data.sellingEnabled || Number(p.Quantity) < 1 ? 'disabled' : ''}>${cart.has(ref) ? '&#10003;' : '&#128722;'}</button></div></article>`;}).join('') || '<p class="muted commerce-empty">No products are assigned to your linked selling vendors in this store.</p>'}
        </div><p class="vendor-pos-search-empty muted" data-search-empty hidden>No products match this search.</p></section>
        <section class="commerce-cart vendor-pos-checkout" aria-label="Vendor sales cart"><div class="commerce-cart-title"><div><small>Current sale</small><h4>Cart</h4></div><strong>${money(total)}</strong></div>
        <div class="commerce-cart-lines">${entries.map(({ref,qty,product:p}) => `<article class="commerce-cart-line"><div><strong>${esc(p.ItemName)}</strong><span>${money(p.Price)} each</span></div><select data-quantity="${esc(ref)}" aria-label="Cart quantity for ${esc(p.ItemName)}">${quantityOptions(p.Quantity,qty)}</select><strong>${money(Number(p.Price) * qty)}</strong><button type="button" class="compact-icon-action compact-delete-action" data-remove="${esc(ref)}" aria-label="Remove ${esc(p.ItemName)}">&#128465;</button></article>`).join('') || '<p class="muted commerce-empty">Select an item to begin.</p>'}</div>
        <div class="tuck-shop-step-heading"><span>2</span><div><small>Customer</small><h5>Identify the buyer</h5></div></div>
        <form class="vendor-pos-form"><label class="tuck-shop-customer-type">Payment method<select name="PaymentMethod">${[...(school ? ['Student Wallet'] : []),'Cash','Bank Transfer','POS / Card'].map(method => `<option${method === draft.PaymentMethod ? ' selected' : ''}>${method}</option>`).join('')}</select></label>
        ${wallet ? `<div class="tuck-shop-lookup-form"><details class="tuck-shop-manual-lookup" data-manual-lookup${manualLookupOpen ? ' open' : ''}><summary>Enter card ID or admission number</summary><div><label>Wallet card ID<input name="WalletCardId" value="${esc(draft.WalletCardId)}" autocomplete="off" placeholder="Scan or enter NFC card ID"></label><label>Admission number<input name="AccountRef" value="${esc(draft.AccountRef)}" autocomplete="off" placeholder="Admission number"></label></div></details><div class="tuck-shop-lookup-actions vendor-pos-lookup-actions" role="group" aria-label="Student wallet lookup"><button type="button" data-find class="tuck-shop-lookup-action tuck-shop-lookup-primary">${lookupIcon}<span>Find wallet</span></button></div><small class="muted">Use the exact card ID or admission number. Only the customer identity is shown.</small></div>
        ${customer ? `<div class="wallet-account-result vendor-pos-customer" data-customer><div><small>Student</small><strong>${esc(customer.DisplayName)}</strong><span>${esc(customer.AccountRef)}</span></div></div>` : ''}<p class="vendor-pos-guidance muted" data-wallet-prompt${customer ? ' hidden' : ''}>Find the student wallet to continue to payment.</p>`
        : `<div class="commerce-checkout-form vendor-pos-payment"><label>Customer name<input name="CustomerName" value="${esc(draft.CustomerName)}" maxlength="160" placeholder="Walk-in customer"></label><label>Who receives the money?<select name="CollectionMode"><option${draft.CollectionMode === 'School collected' ? ' selected' : ''}>School collected</option><option${draft.CollectionMode === 'Vendor collected' ? ' selected' : ''}>Vendor collected</option></select></label>${draft.PaymentMethod !== 'Cash' ? `<label>Payment reference<input name="PaymentReference" value="${esc(draft.PaymentReference)}" required maxlength="200"></label>` : ''}</div>`}
        ${!wallet || customer ? `<div class="tuck-shop-step-heading" data-payment-heading><span>3</span><div><small>Payment</small><h5>Complete sale</h5></div></div>` : ''}
        <div class="commerce-checkout-form vendor-pos-payment" data-payment${wallet && !customer ? ' hidden' : ''}>${wallet && customer ? `<label>Wallet PIN <small>(when required)</small><input name="WalletPin" type="password" inputmode="numeric" autocomplete="off" value="${esc(draft.WalletPin)}"></label>` : ''}
        <button type="button" data-preview ${!data.sellingEnabled || !cart.size || wallet && !customer ? 'disabled' : ''}>Preview total</button>
        ${preview ? `<div class="commerce-checkout-total" data-confirmed-total><span>Server-confirmed total</span><strong>${money(preview.Amount)}</strong></div><label class="vendor-check"><input name="Confirmed" type="checkbox" required> ${wallet ? 'Customer has authorised this wallet purchase.' : 'I have received / confirmed the payment.'}</label><button type="submit">Complete sale</button>` : ''}</div></form></section></div></section></section>`;
      root.querySelector('[data-refresh]').onclick = load;
      root.querySelector('[data-pos-tab]').onclick = () => root.querySelector('[data-search]').focus();
      function filterProducts() {
        let matches = 0;
        root.querySelectorAll('[data-product]').forEach(card => {card.hidden = !card.dataset.searchText.includes(search.toLowerCase()); if (!card.hidden) matches++;});
        root.querySelector('[data-search-empty]').hidden = !search || matches > 0 || !products.length;
      }
      root.querySelector('[data-search]').oninput = event => {search = event.target.value; filterProducts();};
      filterProducts();
      root.querySelectorAll('[data-add-quantity]').forEach(select => select.onchange = () => {
        const p = products[Number(select.dataset.addQuantity)]; addQuantities.set(reference(p),Number(select.value));
      });
      root.querySelectorAll('[data-add]').forEach(button => button.onclick = () => {
        const p = products[Number(button.dataset.add)], ref = reference(p), qty = (cart.get(ref) || 0) + (addQuantities.get(ref) || 1);
        if (!Number.isSafeInteger(qty) || qty < 1 || qty > Number(p.Quantity)) return status('The selected quantity exceeds available stock.',true);
        cart.set(ref,qty); invalidate();
      });
      root.querySelectorAll('[data-remove]').forEach(button => button.onclick = () => {cart.delete(button.dataset.remove); invalidate();});
      root.querySelectorAll('[data-quantity]').forEach(input => input.onchange = () => {
        const p = data.products.find(item => reference(item) === input.dataset.quantity), qty = Number(input.value);
        if (!Number.isSafeInteger(qty) || qty < 1 || qty > Number(p.Quantity)) {draw(); return status('Enter a whole-number quantity within available stock.',true);}
        cart.set(input.dataset.quantity,qty); invalidate();
      });
      const form = root.querySelector('form');
      root.querySelector('[data-manual-lookup]')?.addEventListener('toggle',event => {manualLookupOpen = event.target.open;});
      form.oninput = event => {
        if (event.target.name === 'Confirmed') return;
        draft[event.target.name] = event.target.value; preview = null; checkoutId = '';
        if (event.target.name === 'WalletCardId') {draft.AccountRef = ''; form.elements.AccountRef.value = '';}
        if (event.target.name === 'AccountRef') {draft.WalletCardId = ''; form.elements.WalletCardId.value = '';}
        if (['AccountRef','WalletCardId'].includes(event.target.name)) {
          customer = null; draft.WalletPin = ''; form.querySelector('[data-customer]')?.remove();
          form.querySelector('[name="WalletPin"]')?.closest('label')?.remove();
          form.querySelector('[data-payment-heading]')?.remove();
          form.querySelector('[data-payment]').hidden = true;
          form.querySelector('[data-wallet-prompt]').hidden = false;
        }
        if (event.target.tagName === 'SELECT') draw();
        else {form.querySelector('[type="submit"]')?.remove(); form.querySelector('[name="Confirmed"]')?.closest('label')?.remove();
          form.querySelector('[data-confirmed-total]')?.remove();
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
