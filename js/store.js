const storeProducts = document.getElementById('publicStoreProducts');
const storeCartLines = document.getElementById('publicStoreCart');
const storeTotal = document.getElementById('publicStoreTotal');
const storeItemCount = document.getElementById('publicStoreItemCount');
const storeSearch = document.getElementById('publicStoreSearch');
const storeForm = document.getElementById('publicStoreCheckoutForm');
const storeButton = document.getElementById('publicStoreCheckoutButton');
const storeStatus = document.getElementById('publicStoreStatus');
const storeBranch = document.getElementById('publicStoreBranch');
const storeOrganisation = document.getElementById('publicStoreOrganisation');
const storeLogo = document.getElementById('publicStoreLogo');
const storeHeader = document.getElementById('publicStoreHeader');
const storeCartShortcut = document.getElementById('publicStoreCartShortcut');
const storeCartBadge = document.getElementById('publicStoreCartBadge');
const storeCheckout = document.getElementById('publicStoreCheckout');
const cart = new Map();
let inventory = [];

function syncStoreStickyOffset() {
  const height = Math.ceil(storeHeader.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--public-store-header-height', `${height}px`);
}

syncStoreStickyOffset();
window.addEventListener('resize', syncStoreStickyOffset);
if ('ResizeObserver' in window) {
  const stickyHeaderObserver = new ResizeObserver(syncStoreStickyOffset);
  stickyHeaderObserver.observe(storeHeader);
}

const clean = (value) => String(value ?? '').trim();
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function requestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function money(value) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(Number(value || 0));
}

function setStatus(message = '', tone = '') {
  storeStatus.textContent = message;
  storeStatus.className = `public-store-status ${tone}`.trim();
}

function invalidateCheckout() {
  delete storeForm.dataset.idempotencyKey;
}

function cartTotal() {
  return [...cart.values()].reduce((sum, entry) => sum + Number(entry.item.Price || 0) * entry.quantity, 0);
}

function renderProducts() {
  const query = clean(storeSearch.value).toLowerCase();
  const visible = inventory.filter((item) => !query || [item.ItemName, item.ItemCode, item.Category, item.Size].map(clean).join(' ').toLowerCase().includes(query));
  storeItemCount.textContent = `${inventory.length} item${inventory.length === 1 ? '' : 's'}`;
  storeProducts.innerHTML = visible.length ? visible.map((item) => {
    const reference = clean(item.ItemCode);
    const added = cart.has(reference);
    return `<article class="public-store-product"><div><strong>${escapeHtml(item.ItemName)}</strong><span>${escapeHtml([item.Category, item.Size].filter(Boolean).join(' · '))}</span><small>${escapeHtml(money(item.Price))} · ${Number(item.Quantity || 0)} available</small></div><button type="button" class="${added ? 'is-added' : ''}" data-add-store-item="${escapeHtml(reference)}">${added ? 'Add another' : 'Add to cart'}</button></article>`;
  }).join('') : '<p class="public-store-empty">No matching store items are available.</p>';
  storeProducts.querySelectorAll('[data-add-store-item]').forEach((button) => button.addEventListener('click', () => {
    const reference = button.dataset.addStoreItem;
    const item = inventory.find((row) => clean(row.ItemCode) === reference);
    if (!item) return;
    const entry = cart.get(reference) || { item, quantity: 0 };
    entry.quantity = Math.min(Number(item.Quantity || 1), entry.quantity + 1);
    cart.set(reference, entry);
    invalidateCheckout();
    renderProducts();
    renderCart();
  }));
}

function renderCart() {
  const entries = [...cart.entries()];
  const itemCount = entries.reduce((sum, [, entry]) => sum + entry.quantity, 0);
  storeCartLines.innerHTML = entries.length ? entries.map(([reference, entry]) => `<article class="public-store-cart-line"><div><strong>${escapeHtml(entry.item.ItemName)}</strong><span>${escapeHtml(money(Number(entry.item.Price || 0) * entry.quantity))}</span></div><input type="number" min="1" max="${Number(entry.item.Quantity || 1)}" step="1" value="${entry.quantity}" data-store-cart-quantity="${escapeHtml(reference)}" aria-label="Quantity for ${escapeHtml(entry.item.ItemName)}"><button type="button" data-remove-store-item="${escapeHtml(reference)}" aria-label="Remove ${escapeHtml(entry.item.ItemName)}" title="Remove item">&#128465;</button></article>`).join('') : '<p class="public-store-empty">Choose an item to begin.</p>';
  storeTotal.textContent = money(cartTotal());
  storeButton.disabled = !entries.length;
  storeCartBadge.textContent = String(itemCount);
  storeCartShortcut.disabled = !itemCount;
  storeCartShortcut.setAttribute('aria-label', itemCount ? `View cart and checkout, ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Cart is empty');
  storeCartLines.querySelectorAll('[data-store-cart-quantity]').forEach((input) => input.addEventListener('change', () => {
    const entry = cart.get(input.dataset.storeCartQuantity);
    if (!entry) return;
    entry.quantity = Math.max(1, Math.min(Number(entry.item.Quantity || 1), Math.floor(Number(input.value || 1))));
    invalidateCheckout();
    renderCart();
  }));
  storeCartLines.querySelectorAll('[data-remove-store-item]').forEach((button) => button.addEventListener('click', () => {
    cart.delete(button.dataset.removeStoreItem);
    invalidateCheckout();
    renderProducts();
    renderCart();
  }));
}

storeCartShortcut.addEventListener('click', () => {
  if (!cart.size) return;
  storeCheckout.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => storeCheckout.focus({ preventScroll: true }), 250);
});

const requestedBranch = clean(new URLSearchParams(window.location.search).get('branch')).toLowerCase();
storeBranch.value = /^[a-z0-9][a-z0-9._-]{0,79}$/.test(requestedBranch) ? requestedBranch : 'main';

async function loadStore() {
  try {
    const response = await fetch(`/api/public-organization-store?branch=${encodeURIComponent(storeBranch.value)}`, {
      credentials: 'same-origin', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load the organisation store.');
    inventory = Array.isArray(data.items) ? data.items : [];
    renderProducts();
    renderCart();
    if (!inventory.length) setStatus('No priced items are currently available.', 'bad');
  } catch (error) {
    inventory = [];
    renderProducts();
    renderCart();
    setStatus(error.message || String(error), 'bad');
  }
}

storeSearch.addEventListener('input', renderProducts);
storeForm.addEventListener('input', invalidateCheckout);
storeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!cart.size || storeButton.disabled) return;
  const idempotencyKey = storeForm.dataset.idempotencyKey || requestId();
  storeForm.dataset.idempotencyKey = idempotencyKey;
  storeButton.disabled = true;
  storeButton.textContent = 'Preparing payment…';
  setStatus('Preparing your secure payment…');
  try {
    const turnstile = window.DynamaxPublicApi?.getTurnstileToken
      ? await window.DynamaxPublicApi.getTurnstileToken('organization_store')
      : {};
    const payload = {
      ...Object.fromEntries(new FormData(storeForm).entries()),
      ...turnstile,
      PaymentMethod: 'Paystack Online',
      Items: [...cart.entries()].map(([Reference, entry]) => ({ Reference, Quantity: entry.quantity })),
      SaleRequestId: idempotencyKey,
      idempotencyKey
    };
    const response = await fetch('/api/public-organization-store', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const error = new Error(data.message || 'Could not start the secure payment.');
      error.responseReceived = true;
      throw error;
    }
    const paymentUrl = clean(data.authorizationUrl || data.sale?.AuthorizationUrl);
    if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(paymentUrl)) throw new Error('The secure payment address was not returned.');
    setStatus('Opening secure payment now. Your receipt will be emailed after payment…', 'ok');
    window.location.assign(paymentUrl);
  } catch (error) {
    if (error.responseReceived) delete storeForm.dataset.idempotencyKey;
    setStatus(error.message || String(error), 'bad');
    storeButton.disabled = !cart.size;
    storeButton.textContent = 'Continue to secure payment';
  }
});

window.siteProfileReady.then((profile) => {
  const name = clean(profile.OrganisationName || profile.OrganizationName || profile.SchoolName) || 'Dynamax';
  storeOrganisation.textContent = name;
  document.title = `${name} Organisation Store`;
  const logo = clean(profile.WebLogoUrl);
  if (logo) storeLogo.src = logo;
  syncStoreStickyOffset();
}).catch(() => null);

loadStore();
