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
  function mount(root, request, section, tools = {}) {
    mounted?.destroy();
    let data, disposed = false, busy = false, checkoutId = '', customer = null, notice = '', failed = false;
    let draft = {PaymentMethod:section === 'tuckShop' ? 'Student Wallet' : 'Cash', CollectionMode:'School collected', CustomerName:''};
    const cart = new Map(), addQuantities = new Map(), pending = new Set();
    let historyOpen = false, history = null, historicalOpenings = [], historyError = '', historyController = null;
    let search = '', manualLookupOpen = false, customerType = 'Student', customerSearch = '', searchTimer = 0, searchGeneration = 0, searchController = null, scanController = null, faceController = null;
    const icon = kind => tools.lookupIcon?.(kind) || lookupIcon;
    const label = section === 'tuckShop' ? 'Tuck Shop' : section === 'restaurant' ? 'Restaurant' : 'Organisation Store';
    function status(message,error = false) {
      notice = message; failed = error;
      const el = root.querySelector('[data-status]');
      if (el) {el.textContent = message; el.hidden = !message; el.classList.toggle('error',error);}
      const lookupStatus = root.querySelector('[data-department-status]');
      if (lookupStatus) {lookupStatus.textContent = message; lookupStatus.classList.toggle('bad',error);}
    }
    function stopSearch() {clearTimeout(searchTimer); searchGeneration++; searchController?.abort(); searchController = null;}
    function clearCustomer() {
      customer = null; draft.WalletPin = ''; draft.CustomerName = ''; checkoutId = '';
      root.querySelector('[data-customer]')?.remove();
      root.querySelector('[name="WalletPin"]')?.closest('label')?.remove();
      root.querySelector('[data-payment-heading]')?.remove();
      const payment = root.querySelector('[data-payment]'); if (payment) payment.hidden = true;
      const paymentForm = root.querySelector('[data-payment-form]'); if (paymentForm) paymentForm.hidden = true;
      root.querySelector('[data-complete]')?.remove();
    }
    async function suggestCustomers(query, field) {
      stopSearch();
      if (query.trim().length < 2) return;
      const generation = searchGeneration, controller = new AbortController(); searchController = controller; pending.add(controller);
      const timer = setTimeout(() => controller.abort(),20000);
      try {
        const result = await request('vendorCustomerSearch',{Section:section,CustomerType:customerType,Query:query},controller.signal);
        if (disposed || generation !== searchGeneration || !field.isConnected || field.value !== query) return;
        root.querySelector('[data-customer-matches]').innerHTML = (result.customers || []).map(row => `<option value="${esc(row.CustomerRef)}">${esc([row.CustomerName,row.Detail].filter(Boolean).join(' · '))}</option>`).join('');
      } catch (error) {
        if (!disposed && generation === searchGeneration && error.name !== 'AbortError') status(error.message,true);
      } finally {clearTimeout(timer); pending.delete(controller); if (searchController === controller) searchController = null;}
    }
    function invalidate() {checkoutId = ''; draw();}
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
          ? action.startsWith('record') ? 'No response was confirmed. Keep this cart and retry the same checkout; the server prevents duplicate posting.'
            : 'This request timed out. Try again; no sale was submitted.' : error.message,true);
        return null;
      } finally {
        clearTimeout(timer); pending.delete(controller); busy = false;
        controls.forEach(([el,disabled]) => {if (el.isConnected) el.disabled = disabled;});
      }
    }
    async function load() {
      const result = await call('salesBootstrap');
      if (!result) return;
      historyController?.abort(); historyController = null; history = null; historicalOpenings = []; historyError = '';
      data = result; cart.clear(); addQuantities.clear(); checkoutId = ''; customer = null;
      draft.WalletPin = ''; draft.WalletCardId = ''; draft.AccountRef = ''; customerSearch = '';
      status(result.sellingEnabled ? '' : result.message); draw();
      if (historyOpen) void loadHistory();
    }
    function historyCount() {
      return history === null || historyError ? '' : historicalOpenings.length
        ? `${history.length} ${history.length === 1 ? 'receipt' : 'receipts'} · ${historicalOpenings.length} historical ${historicalOpenings.length === 1 ? 'opening' : 'openings'}` : String(history.length);
    }
    function historicalOpeningMarkup() {
      if (!historicalOpenings.length) return '';
      return `<section class="vendor-history-openings" aria-label="Historical sales opening"><h4>Historical sales opening</h4>
        <p>Latest 30 reviewed opening adjustments for your linked vendors. Summary only, not individual receipts or your current balance.${section !== 'tuckShop' ? ' These vendor-level openings are not shop-specific.' : ''}</p>
        ${historicalOpenings.map(opening => `<article class="vendor-card"><div class="vendor-header"><strong>${esc(opening.VendorName)}</strong><small>${esc(opening.Date)} · ${esc(opening.Reference)}</small></div>
          <dl class="vendor-opening-amounts">${[['Historical sales collected',opening.HistoricalSales],['Refunds',opening.Refunds],['Agreed deductions',opening.Deductions],['Previously paid',opening.PreviouslyPaid],['Amount owed at opening',opening.OpeningAmountOwed]].map(([title,value]) => `<div><dt>${title}</dt><dd>${money(value)}</dd></div>`).join('')}</dl>
        </article>`).join('')}</section>`;
    }
    function historyMarkup() {
      return `<div class="vendor-history-tools"><button type="button" data-history-refresh${historyController ? ' disabled' : ''}>Refresh recent sales</button></div>
        ${historyError ? `<p class="vendor-status error" role="status">${esc(historyError)}</p>` : history === null
          ? '<p class="vendor-status" role="status">Loading recent sales…</p>'
          : `${historicalOpeningMarkup()}${history.length ? `<div class="table-wrap vendor-table-wrap"><table class="vendor-table"><caption class="sr-only">Latest 30 sales for your linked vendors; amounts include only their products</caption><thead><tr><th>Receipt / date</th><th>Customer</th><th>Products</th><th>Payment</th><th>Amount</th></tr></thead><tbody>${history.map(sale => `<tr><td>${esc(sale.SaleNo)}<small>${esc(sale.SaleDate.replace('T',' ').slice(0,19))}</small></td><td>${esc(sale.CustomerName)}</td><td>${sale.Items.map(item => `${esc(item.ItemName)} × ${esc(item.Quantity)}`).join('<br>')}</td><td>${esc(sale.PaymentMethod)}<small>${esc(sale.CollectionMode)}</small></td><td>${money(sale.Amount)}</td></tr>`).join('')}</tbody></table></div>`
            : `<p class="vendor-status" role="status">${historicalOpenings.length ? 'Earlier sales are summarised in the historical opening above. No individual vendor-owned receipts yet in this shop.' : 'No recent sales for your linked vendors in this shop.'}</p>`}`}`;
    }
    function updateHistory() {
      const panel = root.querySelector('[data-history-content]');
      if (!panel) return;
      panel.innerHTML = historyMarkup();
      const count = root.querySelector('[data-history-count]'); if (count) count.textContent = historyCount();
      panel.querySelector('[data-history-refresh]').onclick = loadHistory;
    }
    async function loadHistory() {
      if (disposed || historyController) return;
      const controller = new AbortController(); historyController = controller; pending.add(controller); historyError = ''; updateHistory();
      const timer = setTimeout(() => controller.abort(),30000);
      try {
        const result = await request('recentVendorSales',{Section:section},controller.signal);
        if (!disposed && historyController === controller) {history = result.sales || []; historicalOpenings = result.historicalOpenings || [];}
      } catch (error) {
        if (!disposed && historyController === controller) historyError = error.name === 'AbortError'
          ? 'Recent sales timed out. Refresh recent sales to retry.' : error.message;
      } finally {
        clearTimeout(timer); pending.delete(controller);
        if (historyController === controller) {historyController = null; if (!disposed) updateHistory();}
      }
    }
    function payload() {
      return {...draft, Items:[...cart].map(([Reference,Quantity]) => ({Reference,Quantity})),
        CollectionMode:draft.PaymentMethod === 'Student Wallet' ? 'School collected' : draft.CollectionMode};
    }
    function draw() {
      if (!data || disposed) return;
      stopSearch(); scanController?.abort();
      const school = section === 'tuckShop', wallet = draft.PaymentMethod === 'Student Wallet';
      const products = data.products.filter(p => p.Active !== 'NO');
      const entries = [...cart].map(([ref,qty]) => ({ref,qty,product:data.products.find(p => reference(p) === ref)}));
      const total = entries.reduce((sum,row) => sum + Math.round((Number(row.product.Price || 0) + Number.EPSILON) * 100) * row.qty,0) / 100;
      root.innerHTML = `<section class="vendor-workspace vendor-pos" aria-label="${label} point of sale">
        ${!data.sellingEnabled ? '<p class="vendor-notice">Selling is unavailable until Accounts confirms the setup, links this login and enables counter sales. Statements remain separate.</p>' : ''}
        <div class="module-workspace-tabs vendor-pos-tabs" aria-label="Sales workspace"><button type="button" class="selected" data-pos-tab aria-current="page"><span aria-hidden="true">&#128722;</span><strong>Point of sale</strong></button><button type="button" data-refresh>Refresh</button></div>
        <section class="config-card department-primary-workflow tuck-shop-pos-workspace vendor-pos-shell">
        <header class="config-card-heading"><div><small>Stock-linked checkout</small><h3>${label} POS</h3><p>Select items, identify the customer, then complete payment. Stock updates automatically.</p></div><span class="workspace-feature-icon" aria-hidden="true">&#128722;</span></header>
        <div class="commerce-pos-layout"><section class="commerce-catalog" aria-label="Vendor product catalogue"><label class="commerce-search-label"><span>Search items · <span data-product-count aria-live="polite">${products.length} products</span></span><input data-search type="search" value="${esc(search)}" placeholder="Name, category or unit"></label><div class="commerce-product-list vendor-pos-products">
        ${products.map((p,index) => {const ref = reference(p), searchText = `${p.ItemName} ${p.Category || ''} ${p.Unit || ''}`.toLowerCase(); return `<article class="commerce-product" data-product data-search-text="${esc(searchText)}"${searchText.includes(search.toLowerCase()) ? '' : ' hidden'}><div><strong>${esc(p.ItemName)}</strong><span>${esc([p.Category,p.Unit].filter(Boolean).join(' · '))}</span><small>${money(p.Price)} · ${esc(p.Quantity)} in stock</small></div><div class="commerce-product-action"><select data-add-quantity="${index}" aria-label="Quantity for ${esc(p.ItemName)}" ${!data.sellingEnabled || Number(p.Quantity) < 1 ? 'disabled' : ''}>${quantityOptions(p.Quantity,addQuantities.get(ref) || 1)}</select><button type="button" class="compact-icon-action commerce-add-button${cart.has(ref) ? ' is-added' : ''}" data-add="${index}" aria-label="Add ${esc(p.ItemName)} to cart" ${!data.sellingEnabled || Number(p.Quantity) < 1 ? 'disabled' : ''}>${cart.has(ref) ? '&#10003;' : '&#128722;'}</button></div></article>`;}).join('') || '<p class="muted commerce-empty">No products are assigned to your linked selling vendors in this store.</p>'}
        </div><p class="vendor-pos-search-empty muted" data-search-empty hidden>No products match this search.</p></section>
        <section class="commerce-cart vendor-pos-checkout" aria-label="Vendor sales cart"><div class="commerce-cart-title"><div><small>Current sale</small><h4>Cart</h4></div><strong>${money(total)}</strong></div>
        <div class="commerce-cart-lines" data-cart-lines${entries.length ? '' : ' hidden'}>${entries.map(({ref,qty,product:p}) => `<article class="commerce-cart-line"><div><strong>${esc(p.ItemName)}</strong><span>${money(p.Price)} each</span></div><select data-quantity="${esc(ref)}" aria-label="Cart quantity for ${esc(p.ItemName)}">${quantityOptions(p.Quantity,qty)}</select><strong>${money(Number(p.Price) * qty)}</strong><button type="button" class="compact-icon-action compact-delete-action" data-remove="${esc(ref)}" aria-label="Remove ${esc(p.ItemName)}">&#128465;</button></article>`).join('')}</div>
        <div class="tuck-shop-step-heading"><span>2</span><div><small>Customer</small><h5>Identify the buyer</h5></div></div>
        ${school ? `<label class="tuck-shop-customer-type">Customer type<select data-customer-type><option value="Student"${customerType === 'Student' ? ' selected' : ''}>Student · wallet</option><option value="Staff"${customerType === 'Staff' ? ' selected' : ''}>Staff · cash, transfer or POS</option></select></label>
        <form data-lookup-form class="tuck-shop-lookup-form"><label>${wallet ? 'Find student' : 'Find staff member'}<input name="Query" data-customer-search type="search" list="vendorCustomerMatches" value="${esc(customerSearch)}" placeholder="${wallet ? 'Name, admission no., card, phone or email' : 'Name, username, staff ID, phone or email'}" autocomplete="off"><datalist id="vendorCustomerMatches" data-customer-matches></datalist></label>
        ${wallet ? `<details class="tuck-shop-manual-lookup" data-manual-lookup${manualLookupOpen ? ' open' : ''}><summary>Enter card ID or admission number manually</summary><div><label>Wallet card ID<input name="WalletCardId" value="${esc(draft.WalletCardId)}" autocomplete="off" placeholder="Scan or enter card ID"></label><label>Admission number<input name="AccountRef" value="${esc(draft.AccountRef)}" autocomplete="off" placeholder="Admission number"></label></div></details>` : ''}
        <div class="tuck-shop-lookup-footer"><p class="status" data-department-status role="status"></p>${wallet ? `<div class="tuck-shop-lookup-actions" role="group" aria-label="Student lookup methods"><button type="submit" data-find class="tuck-shop-lookup-action tuck-shop-lookup-primary" aria-label="Find student wallet" title="Find student wallet">${icon('search')}<span>Find wallet</span></button><button type="button" data-scan class="tuck-shop-lookup-action" aria-label="Scan NFC student card" title="Scan NFC student card">${icon('card')}<span>Scan card</span></button><button type="button" data-face class="tuck-shop-lookup-action" aria-label="Find student by face" title="Find student by face">${icon('face')}<span>Use face</span></button></div>` : '<button type="submit" data-find class="tuck-shop-staff-select">Select staff member</button>'}</div></form>
        ${customer ? `<div class="wallet-account-result vendor-pos-customer" data-customer><div><small>${wallet ? 'Student' : 'Staff customer'}</small><strong>${esc(customer.DisplayName)}</strong><span>${esc([customer.AccountRef,customer.ClassName].filter(Boolean).join(' · '))}</span></div>${wallet ? `<div data-wallet-summary><small>Wallet balance</small><strong>${money(customer.WalletBalance)}</strong><span>Spent today ${money(customer.WalletSpentToday)}</span></div>` : ''}</div>` : ''}` : ''}
        ${!school || customer ? `<div class="tuck-shop-step-heading" data-payment-heading><span>3</span><div><small>Payment</small><h5>Complete sale</h5></div></div>` : ''}
        <form class="vendor-pos-form" data-payment-form${school && !customer ? ' hidden' : ''}><div class="commerce-checkout-form vendor-pos-payment" data-payment${school && !customer ? ' hidden' : ''}>
        ${!wallet ? `<label>Payment method<select name="PaymentMethod">${['Cash','Bank Transfer','POS / Card'].map(method => `<option${method === draft.PaymentMethod ? ' selected' : ''}>${method}</option>`).join('')}</select></label>${!school ? `<label>Customer name<input name="CustomerName" value="${esc(draft.CustomerName)}" maxlength="160" placeholder="Walk-in customer"></label>` : ''}<label>Who receives the money?<select name="CollectionMode"><option${draft.CollectionMode === 'School collected' ? ' selected' : ''}>School collected</option><option${draft.CollectionMode === 'Vendor collected' ? ' selected' : ''}>Vendor collected</option></select></label>${draft.PaymentMethod !== 'Cash' ? `<label>Payment reference<input name="PaymentReference" value="${esc(draft.PaymentReference)}" required maxlength="200"></label>` : ''}` : ''}
        ${wallet && customer ? `<label>Wallet PIN <small>(when required)</small><input name="WalletPin" type="password" inputmode="numeric" autocomplete="off" value="${esc(draft.WalletPin)}"></label>` : ''}
        <div class="commerce-checkout-total"><span>Calculated total</span><strong>${money(total)}</strong></div>
        <div class="config-actionbar"><button type="submit" data-complete ${!data.sellingEnabled || !cart.size || school && !customer ? 'disabled' : ''}>${wallet ? 'Complete wallet sale' : school ? 'Complete staff sale' : 'Complete sale'}</button></div></div></form><p class="vendor-status${failed ? ' error' : ''}" data-status role="status"${notice ? '' : ' hidden'}>${esc(notice)}</p></section></div>
        <details class="commerce-sales-history vendor-pos-history" data-history${historyOpen ? ' open' : ''}><summary>Recent ${label} Sales <span data-history-count>${historyCount()}</span></summary><div data-history-content>${historyMarkup()}</div></details></section></section>`;
      root.querySelector('[data-history]').ontoggle = event => {
        historyOpen = event.target.open;
        if (historyOpen && history === null && !historyError) void loadHistory();
      };
      updateHistory();
      root.querySelector('[data-refresh]').onclick = load;
      root.querySelector('[data-pos-tab]').onclick = () => root.querySelector('[data-search]').focus();
      function filterProducts() {
        let matches = 0;
        root.querySelectorAll('[data-product]').forEach(card => {card.hidden = !card.dataset.searchText.includes(search.toLowerCase()); if (!card.hidden) matches++;});
        root.querySelector('[data-search-empty]').hidden = !search || matches > 0 || !products.length;
        root.querySelector('[data-product-count]').textContent = search ? `${matches} of ${products.length} products` : `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
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
      const form = root.querySelector('[data-payment-form]'), lookupForm = root.querySelector('[data-lookup-form]');
      root.querySelector('[data-customer-type]')?.addEventListener('change',event => {
        customerType = event.target.value; scanController?.abort(); faceController?.abort();
        clearCustomer(); customerSearch = ''; draft.AccountRef = ''; draft.WalletCardId = ''; draft.PaymentReference = '';
        draft.PaymentMethod = customerType === 'Student' ? 'Student Wallet' : 'Cash';
        draft.CollectionMode = customerType === 'Staff' ? 'Vendor collected' : 'School collected'; draw();
      });
      root.querySelector('[data-manual-lookup]')?.addEventListener('toggle',event => {manualLookupOpen = event.target.open;});
      if (lookupForm) lookupForm.oninput = event => {
        const field = event.target; clearCustomer();
        if (field.name === 'Query') {
          customerSearch = field.value; draft.AccountRef = ''; draft.WalletCardId = '';
          if (lookupForm.elements.AccountRef) lookupForm.elements.AccountRef.value = '';
          if (lookupForm.elements.WalletCardId) lookupForm.elements.WalletCardId.value = '';
          stopSearch(); root.querySelector('[data-customer-matches]').innerHTML = '';
          searchTimer = setTimeout(() => {void suggestCustomers(customerSearch,field);},350);
        } else {
          stopSearch(); customerSearch = ''; lookupForm.elements.Query.value = ''; draft[field.name] = field.value;
          const other = field.name === 'WalletCardId' ? 'AccountRef' : 'WalletCardId';
          draft[other] = ''; lookupForm.elements[other].value = '';
        }
      };
      form.oninput = event => {
        draft[event.target.name] = event.target.value;
        // Correcting a PIN is a retry of the same sale, not a new checkout.
        if (event.target.name !== 'WalletPin') checkoutId = '';
        if (event.target.tagName === 'SELECT') draw();
      };
      async function findCustomer() {
        if (busy || disposed) return;
        stopSearch(); scanController?.abort(); clearCustomer();
        let ref = draft.AccountRef;
        if (!wallet || !ref && !draft.WalletCardId) {
          const query = customerSearch.trim();
          if (query.length < 2) return status('Enter a name or reference, or scan a student card.',true);
          const result = await call('vendorCustomerSearch',{Query:query,CustomerType:customerType});
          if (!result) return;
          const matches = result.customers || [], key = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g,'');
          const exact = matches.filter(row => key(row.CustomerRef) === key(query));
          const selected = exact.length === 1 ? exact[0] : !exact.length && matches.length === 1 ? matches[0] : null;
          if (!selected) {
            root.querySelector('[data-customer-matches]').innerHTML = matches.map(row => `<option value="${esc(row.CustomerRef)}">${esc(row.CustomerName)}</option>`).join('');
            return status(matches.length ? 'Choose one customer from the suggested results, then select again.' : 'No matching customer found in your permitted branch and section.',true);
          }
          ref = selected.CustomerRef;
          if (!wallet) {
            customer = {AccountRef:ref,DisplayName:selected.CustomerName,ClassName:selected.Detail};
            draft.CustomerName = selected.CustomerName; draft.AccountRef = ref; status('Staff customer selected.'); draw(); return;
          }
        }
        const result = await call('vendorWalletLookup',{AccountRef:ref,WalletCardId:draft.WalletCardId});
        if (result) {customer = result.account; draft.AccountRef = customer.AccountRef; draft.WalletCardId = ''; customerSearch = customer.AccountRef;
          status('Customer found. Ready to complete the sale.'); draw();}
      }
      if (lookupForm) lookupForm.onsubmit = async event => {event.preventDefault(); await findCustomer();};
      const scanButton = root.querySelector('[data-scan]');
      if (scanButton) {
        scanButton.classList.toggle('nfc-unavailable',!('NDEFReader' in window));
        scanButton.title = 'NDEFReader' in window ? 'Scan a compatible NFC student card' : 'Direct NFC requires Android Chrome; USB readers and manual entry remain available';
        scanButton.onclick = async () => {
          stopSearch(); clearCustomer(); scanController?.abort(); scanController = new AbortController();
          draft.AccountRef = ''; draft.WalletCardId = ''; customerSearch = '';
          lookupForm.elements.AccountRef.value = ''; lookupForm.elements.WalletCardId.value = ''; lookupForm.elements.Query.value = '';
          if (!tools.scanNfc) return status('Card scanning is unavailable. Refresh the page or enter the card ID manually.',true);
          await tools.scanNfc(lookupForm,scanButton,{preserveMarkup:true,signal:scanController.signal});
        };
      }
      const faceButton = root.querySelector('[data-face]');
      if (faceButton) faceButton.onclick = async () => {
        stopSearch(); scanController?.abort(); clearCustomer(); faceController?.abort(); faceController = new AbortController();
        const controller = faceController;
        draft.AccountRef = ''; draft.WalletCardId = ''; customerSearch = '';
        lookupForm.elements.AccountRef.value = ''; lookupForm.elements.WalletCardId.value = ''; lookupForm.elements.Query.value = '';
        if (!tools.openFaceLookup) return status('Face lookup is unavailable. Refresh the page or use manual search.',true);
        try {
          await tools.openFaceLookup({purpose:'tuck-shop-purchase',allowCameraSelection:true,confirmText:'Use for this purchase',signal:controller.signal,
            onMatch:async match => {
              if (disposed || !wallet || controller.signal.aborted) return;
              draft.WalletCardId = ''; draft.AccountRef = match.id; customerSearch = '';
              await findCustomer();
            }});
        } catch (error) {if (!disposed) status(error.message,true);}
      };
      form.onsubmit = async event => {
        event.preventDefault(); if (disposed || busy || !data.sellingEnabled || !cart.size || school && !customer) return;
        checkoutId ||= crypto.randomUUID();
        // The deliberate Complete sale action replaces the extra checkbox.
        // The server still recalculates prices, validates stock/wallet/PIN and
        // atomically posts the sale. A changed price is rejected, not charged.
        const body = {...payload(),ExpectedAmount:total,Confirmed:true,SaleRequestId:checkoutId};
        const result = await call(wallet ? 'recordVendorWalletPurchase' : 'recordVendorSale',body);
        if (!result) return;
        draft.WalletPin = ''; draft.WalletCardId = ''; draft.AccountRef = ''; cart.clear(); checkoutId = ''; customer = null; draw(); await load();
        status(`${result.message} Receipt ${result.sale.SaleNo}; total ${money(result.sale.Amount)}.`,false);
      };
    }
    const reference = p => section === 'organizationStore' ? p.ItemCode || p.InventoryId : p.InventoryId;
    root.innerHTML = '<p class="vendor-status" data-status role="status">Loading vendor point of sale…</p>'; load();
    mounted = {destroy() {disposed = true; stopSearch(); scanController?.abort(); faceController?.abort(); for (const controller of pending) controller.abort(); draft.WalletPin = ''; cart.clear();}};
    return mounted;
  }
  window.DynamaxVendorPOS = Object.freeze({mount,unmount() {mounted?.destroy(); mounted = undefined;}});
})();
