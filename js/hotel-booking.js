const bookingForm = document.getElementById('hotelBookingForm');
const bookingButton = document.getElementById('hotelBookingButton');
const bookingStatus = document.getElementById('hotelBookingStatus');
const roomChoices = document.getElementById('hotelRoomChoices');
const totalNode = document.getElementById('hotelBookingTotal');
const branchInput = document.getElementById('hotelBookingBranch');
const arrivalInput = document.getElementById('hotelArrivalDate');
const departureInput = document.getElementById('hotelDepartureDate');
const organisationNode = document.getElementById('hotelBookingOrganisation');
const logoNode = document.getElementById('hotelBookingLogo');
let availableRooms = [];

function clean(value) {
  return String(value ?? '').trim();
}

function requestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function money(value) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(Number(value || 0));
}

function nights() {
  const start = Date.parse(`${arrivalInput.value}T00:00:00Z`);
  const end = Date.parse(`${departureInput.value}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 86400000)) : 0;
}

function selectedRoom() {
  const id = bookingForm.elements.RoomId?.value;
  return availableRooms.find((room) => clean(room.RoomId) === clean(id));
}

function setStatus(message = '', tone = '') {
  bookingStatus.textContent = message;
  bookingStatus.className = `status ${tone}`.trim();
}

function updateTotal() {
  const room = selectedRoom();
  const stayNights = nights();
  totalNode.querySelector('strong').textContent = room && stayNights
    ? `${money(Number(room.NightlyRate || 0) * stayNights)} · ${stayNights} night${stayNights === 1 ? '' : 's'}`
    : 'Choose a room';
  bookingButton.disabled = !room || stayNights < 1;
}

function renderRooms(rooms = []) {
  availableRooms = rooms;
  if (!rooms.length) {
    roomChoices.innerHTML = '<p class="status bad">No rooms are available for these dates. Try another stay period or contact the hotel.</p>';
    updateTotal();
    return;
  }
  roomChoices.innerHTML = rooms.map((room, index) => `
    <label class="hotel-room-choice">
      <input type="radio" name="RoomId" value="${escapeHtml(room.RoomId)}" ${index === 0 ? 'checked' : ''} required>
      <span><strong>${escapeHtml(room.RoomType || 'Room')} · ${escapeHtml(room.RoomNumber)}</strong><small>Up to ${escapeHtml(room.Capacity)} guest${Number(room.Capacity) === 1 ? '' : 's'}</small><b>${escapeHtml(money(room.NightlyRate))} / night</b></span>
    </label>`).join('');
  roomChoices.querySelectorAll('input[name="RoomId"]').forEach((input) => input.addEventListener('change', updateTotal));
  updateTotal();
}

async function loadAvailability() {
  if (!arrivalInput.value || !departureInput.value || nights() < 1) {
    renderRooms([]);
    setStatus('Departure date must be after the arrival date.', 'bad');
    return;
  }
  bookingButton.disabled = true;
  roomChoices.innerHTML = '<p class="muted">Checking room availability…</p>';
  setStatus('');
  try {
    const query = new URLSearchParams({
      branch: branchInput.value,
      arrival: arrivalInput.value,
      departure: departureInput.value
    });
    const response = await fetch(`/api/public-hotel?${query}`, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Room availability could not be loaded.');
    if (clean(data.organisationName)) organisationNode.textContent = clean(data.organisationName);
    renderRooms(data.rooms || []);
  } catch (error) {
    renderRooms([]);
    setStatus(error.message || String(error), 'bad');
  }
}

const requestedBranch = clean(new URLSearchParams(window.location.search).get('branch')).toLowerCase();
branchInput.value = /^[a-z0-9._-]{1,80}$/.test(requestedBranch) ? requestedBranch : 'main';
const today = new Date();
const tomorrow = new Date(today.getTime() + 86400000);
const dateValue = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
arrivalInput.min = dateValue(today);
departureInput.min = dateValue(tomorrow);
arrivalInput.value = dateValue(today);
departureInput.value = dateValue(tomorrow);

arrivalInput.addEventListener('change', () => {
  const next = new Date(`${arrivalInput.value}T00:00:00`);
  next.setDate(next.getDate() + 1);
  departureInput.min = dateValue(next);
  if (!departureInput.value || departureInput.value <= arrivalInput.value) departureInput.value = dateValue(next);
  delete bookingForm.dataset.idempotencyKey;
  loadAvailability();
});
departureInput.addEventListener('change', () => {
  delete bookingForm.dataset.idempotencyKey;
  loadAvailability();
});
bookingForm.addEventListener('input', () => delete bookingForm.dataset.idempotencyKey);

window.siteProfileReady.then((profile) => {
  const name = clean(profile.OrganisationName || profile.OrganizationName || profile.SchoolName) || 'Dynamax';
  organisationNode.textContent = name;
  document.title = `Book a room — ${name}`;
  if (clean(profile.WebLogoUrl)) logoNode.src = clean(profile.WebLogoUrl);
}).catch(() => null);

bookingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (bookingButton.disabled || !selectedRoom()) return;
  const idempotencyKey = bookingForm.dataset.idempotencyKey || requestId();
  bookingForm.dataset.idempotencyKey = idempotencyKey;
  bookingButton.disabled = true;
  bookingButton.textContent = 'Preparing secure payment…';
  setStatus('Confirming availability and creating your reservation…');
  try {
    const turnstile = window.DynamaxPublicApi?.getTurnstileToken
      ? await window.DynamaxPublicApi.getTurnstileToken('hotel_booking')
      : {};
    const payload = {
      ...Object.fromEntries(new FormData(bookingForm).entries()),
      ...turnstile,
      idempotencyKey
    };
    const response = await fetch('/api/public-hotel', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const error = new Error(data?.message || 'The hotel booking could not be started.');
      error.responseReceived = true;
      throw error;
    }
    const paymentUrl = clean(data.authorizationUrl);
    if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(paymentUrl)) throw new Error('The secure payment address was not returned.');
    setStatus('Reservation saved. Opening secure Paystack checkout…', 'ok');
    window.location.assign(paymentUrl);
  } catch (error) {
    if (error?.responseReceived) delete bookingForm.dataset.idempotencyKey;
    setStatus(error.message || String(error), 'bad');
    bookingButton.disabled = !selectedRoom();
    bookingButton.textContent = 'Reserve and pay online';
  }
});

loadAvailability();
