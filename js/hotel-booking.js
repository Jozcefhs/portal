const bookingForm = document.getElementById('hotelBookingForm');
const bookingButton = document.getElementById('hotelBookingButton');
const bookingStatus = document.getElementById('hotelBookingStatus');
const roomChoices = document.getElementById('hotelRoomChoices');
const roomTools = document.getElementById('hotelRoomTools');
const roomSearch = document.getElementById('hotelRoomSearch');
const roomType = document.getElementById('hotelRoomType');
const roomSort = document.getElementById('hotelRoomSort');
const roomCount = document.getElementById('hotelRoomCount');
const roomPager = document.getElementById('hotelRoomPager');
const roomPageLabel = document.getElementById('hotelRoomPageLabel');
const roomPrevious = document.getElementById('hotelRoomPrevious');
const roomNext = document.getElementById('hotelRoomNext');
const selectedRoomId = document.getElementById('hotelSelectedRoomId');
const selectedRoomSummary = document.getElementById('hotelSelectedRoomSummary');
const totalNode = document.getElementById('hotelBookingTotal');
const branchInput = document.getElementById('hotelBookingBranch');
const arrivalInput = document.getElementById('hotelArrivalDate');
const departureInput = document.getElementById('hotelDepartureDate');
const organisationNode = document.getElementById('hotelBookingOrganisation');
const logoNode = document.getElementById('hotelBookingLogo');
let availableRooms = [];
let roomPage = 0;
let availabilityRequest = 0;
const ROOMS_PER_PAGE = 12;

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
  return availableRooms.find((room) => clean(room.RoomId) === selectedRoomId.value);
}

function setStatus(message = '', tone = '') {
  bookingStatus.textContent = message;
  bookingStatus.className = `status ${tone}`.trim();
}

function updateTotal() {
  const room = selectedRoom();
  const stayNights = nights();
  selectedRoomSummary.hidden = !room;
  selectedRoomSummary.textContent = room
    ? `Selected: ${clean(room.RoomType) || 'Room'} · Room ${clean(room.RoomNumber)} · ${money(room.NightlyRate)} / night · Up to ${room.Capacity} guest${Number(room.Capacity) === 1 ? '' : 's'}`
    : '';
  totalNode.querySelector('strong').textContent = room && stayNights
    ? `${money(Number(room.NightlyRate || 0) * stayNights)} · ${stayNights} night${stayNights === 1 ? '' : 's'}`
    : 'Choose a room';
  bookingButton.disabled = !room || stayNights < 1;
}

function filteredRooms() {
  const query = clean(roomSearch.value).toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const type = roomType.value;
  const rooms = availableRooms.filter((room) => (
    (!type || clean(room.RoomType) === type) &&
    terms.every((term) => [room.RoomNumber, room.RoomType, room.RoomId, room.Capacity]
      .map(clean).join(' ').toLowerCase().includes(term))
  ));
  const compareNumber = (left, right) => clean(left.RoomNumber).localeCompare(clean(right.RoomNumber), undefined, { numeric: true });
  if (roomSort.value === 'price-asc' || roomSort.value === 'price-desc') {
    const direction = roomSort.value === 'price-asc' ? 1 : -1;
    rooms.sort((left, right) => direction * (Number(left.NightlyRate) - Number(right.NightlyRate)) || compareNumber(left, right));
  } else rooms.sort(compareNumber);
  return rooms;
}

function renderRoomPage() {
  if (!availableRooms.length) {
    roomCount.textContent = '';
    roomPager.hidden = true;
    roomChoices.innerHTML = '<p class="status bad">No rooms are available for these dates. Try another stay period or contact the hotel.</p>';
    return;
  }
  const rooms = filteredRooms();
  const pageCount = Math.max(1, Math.ceil(rooms.length / ROOMS_PER_PAGE));
  roomPage = Math.min(roomPage, pageCount - 1);
  roomCount.textContent = rooms.length === availableRooms.length
    ? `${availableRooms.length} available room${availableRooms.length === 1 ? '' : 's'} for these dates`
    : `${rooms.length} of ${availableRooms.length} available rooms match your filters`;
  roomChoices.innerHTML = rooms.length
    ? rooms.slice(roomPage * ROOMS_PER_PAGE, (roomPage + 1) * ROOMS_PER_PAGE).map((room) => `
      <button type="button" class="hotel-room-choice" data-room-id="${escapeHtml(room.RoomId)}" aria-pressed="${clean(room.RoomId) === selectedRoomId.value}" aria-label="Choose ${escapeHtml(room.RoomType || 'room')} ${escapeHtml(room.RoomNumber)}, up to ${escapeHtml(room.Capacity)} guests, ${escapeHtml(money(room.NightlyRate))} per night">
        <strong>Room ${escapeHtml(room.RoomNumber)}</strong>
        <small>${escapeHtml(room.RoomType || 'Room')} · ${escapeHtml(room.Capacity)} guest${Number(room.Capacity) === 1 ? '' : 's'}</small>
        <b>${escapeHtml(money(room.NightlyRate))}<span> / night</span></b>
      </button>`).join('')
    : '<p class="muted hotel-room-empty">No rooms match those filters. Try another type or search.</p>';
  roomPager.hidden = pageCount < 2;
  roomPageLabel.textContent = `Page ${roomPage + 1} of ${pageCount}`;
  roomPrevious.disabled = roomPage === 0;
  roomNext.disabled = roomPage >= pageCount - 1;
}

function renderRooms(rooms = [], preferredRoomId = '') {
  availableRooms = rooms;
  roomPage = 0;
  roomTools.hidden = !rooms.length;
  const types = [...new Set(rooms.map((room) => clean(room.RoomType)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  roomType.innerHTML = '<option value="">All types</option>' + types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');
  roomSearch.value = '';
  roomSort.value = 'number';
  selectedRoomId.value = rooms.find((room) => clean(room.RoomId) === preferredRoomId)?.RoomId || rooms[0]?.RoomId || '';
  renderRoomPage();
  updateTotal();
}

roomSearch.addEventListener('input', () => { roomPage = 0; renderRoomPage(); });
roomType.addEventListener('change', () => { roomPage = 0; renderRoomPage(); });
roomSort.addEventListener('change', () => { roomPage = 0; renderRoomPage(); });
roomPrevious.addEventListener('click', () => { roomPage -= 1; renderRoomPage(); });
roomNext.addEventListener('click', () => { roomPage += 1; renderRoomPage(); });
roomChoices.addEventListener('click', (event) => {
  const choice = event.target.closest('button[data-room-id]');
  if (!choice || !roomChoices.contains(choice)) return;
  selectedRoomId.value = choice.dataset.roomId;
  roomChoices.querySelectorAll('button[data-room-id]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button === choice));
  });
  delete bookingForm.dataset.idempotencyKey;
  updateTotal();
});

async function loadAvailability() {
  const request = ++availabilityRequest;
  if (!arrivalInput.value || !departureInput.value || nights() < 1) {
    renderRooms([]);
    setStatus('Departure date must be after the arrival date.', 'bad');
    return;
  }
  const preferredRoomId = selectedRoomId.value;
  availableRooms = [];
  selectedRoomId.value = '';
  bookingButton.disabled = true;
  roomTools.hidden = true;
  roomPager.hidden = true;
  roomCount.textContent = '';
  updateTotal();
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
    if (request !== availabilityRequest) return;
    if (!response.ok || !data?.ok) throw new Error(data?.message || 'Room availability could not be loaded.');
    if (clean(data.organisationName)) organisationNode.textContent = clean(data.organisationName);
    renderRooms(data.rooms || [], preferredRoomId);
  } catch (error) {
    if (request !== availabilityRequest) return;
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
bookingForm.addEventListener('input', (event) => {
  if (![roomSearch, roomType, roomSort].includes(event.target)) delete bookingForm.dataset.idempotencyKey;
});

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
