(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const selected = (a, b) => a === b ? ' selected' : '';
  function render(data) {
    if (!data.capabilities?.canManageRooms) return '<p class="muted">Hotel managers configure room previews and the physical-key dispenser here.</p>';
    const device = data.keyDispenser || {};
    const roomTypes = [...new Set((data.rooms || []).map(room => room.RoomType).filter(Boolean))].sort();
    const types = roomTypes.map(type => `<option>${escape(type)}</option>`).join('');
    const rooms = (data.rooms || []).map(room => `<option value="${escape(room.RoomId)}">Room ${escape(room.RoomNumber)} · ${escape(room.KeySlot || 'no slot')} · ${room.KeyStocked ? 'key loaded' : 'empty'}${room.KeyCommandId ? ' · HANDOFF LOCKED' : ''}</option>`).join('');
    return `<div class="hotel-setup-grid">
      <form data-hotel-setup="media" class="panel compact-form"><p class="eyebrow">Show guests what to expect</p><h3>Room-type photo or video</h3>
        <p class="muted">One picture or video per room type, shared by that type’s rooms in this branch. Uploading replaces its current preview.</p>
        <label>Room type<select name="RoomType" required>${types}</select></label>
        <label>Description<textarea name="Description" maxlength="600" placeholder="Room features and amenities"></textarea></label>
        <label>Picture or short video · up to 8 MB<input name="MediaFile" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"></label>
        <label class="hotel-check"><input name="Remove" type="checkbox"> Remove this type’s preview</label>
        <button type="submit" ${types ? '' : 'disabled'}>Publish room preview</button>
        <div class="hotel-media-previews">${(data.roomTypes || []).map(row => `<figure>${row.MediaType === 'video' ? `<video controls playsinline preload="metadata" src="${escape(row.MediaUrl)}"></video>` : `<img loading="lazy" src="${escape(row.MediaUrl)}" alt="${escape(row.RoomType)}">`}<figcaption>${escape(row.RoomType)}</figcaption></figure>`).join('')}</div>
      </form>
      <form data-hotel-setup="device" class="panel compact-form"><p class="eyebrow">Physical keys · one dispenser per branch</p><h3>Key dispenser</h3>
        <p class="muted">Keep disabled until your hardware integration is tested. A slot must contain the correct room key. <a href="hotel-dispenser-guide.html" target="_blank" rel="noopener">Hardware integration guide</a></p>
        <label>Dispenser name<input name="Name" value="${escape(device.Name || 'Reception key dispenser')}" maxlength="100" required></label>
        <label>Collection<select name="Enabled"><option value="false">Disabled — reception issues keys</option><option value="true"${selected(device.Enabled, true)}>Enabled — machine issues keys</option></select></label>
        <label>Check-in hour (0–23)<input name="CheckInHour" type="number" min="0" max="23" value="${escape(device.CheckInHour ?? 14)}" required></label>
        <label>Check-out hour (1–23)<input name="CheckOutHour" type="number" min="1" max="23" value="${escape(device.CheckOutHour ?? 12)}" required></label>
        <label>Local UTC offset in minutes (Nigeria: 60)<input name="UtcOffsetMinutes" type="number" min="-720" max="840" value="${escape(device.UtcOffsetMinutes ?? 60)}" required></label>
        <label class="hotel-check"><input name="RotateToken" type="checkbox"> Replace the device’s secret token (old token stops working)</label>
        ${device.DeviceId ? `<label>Device ID<input readonly value="${escape(device.DeviceId)}"></label><p class="muted">Last contact: ${escape(device.LastSeenAt || 'Not connected yet')}</p>` : ''}
        <button type="submit">Save dispenser settings</button>
        <div id="hotelDeviceToken" hidden></div>
      </form>
      <form data-hotel-setup="slot" class="panel compact-form"><p class="eyebrow">Load or return a physical key</p><h3>Room key slots</h3>
        <label>Room<select name="RoomId" required><option value="">Select room</option>${rooms}</select></label>
        <label>Machine slot ID<input name="KeySlot" maxlength="32" pattern="[A-Za-z0-9_-]{1,32}" placeholder="For example: A01"></label>
        <label>Key inventory<select name="KeyStocked"><option value="false">Empty / unavailable</option><option value="true">Correct room key loaded</option></select></label>
        <label class="hotel-check"><input name="PhysicalKeyConfirmed" type="checkbox"> I physically checked the room number on the key and loaded it in this slot.</label>
        <p class="muted">Check-out does not reload the machine. Inspect the returned key and cleaned room, then confirm loading here.</p>
        <button type="submit" ${device.DeviceId ? '' : 'disabled'}>Save key slot</button>
      </form>
      ${device.ActiveCommandId ? `<form data-hotel-setup="resolve" class="panel compact-form"><p class="eyebrow">Active handoff</p><h3>Inspect and resolve</h3>
        <p class="muted">Command: ${escape(device.ActiveCommandId)}. Disable the dispenser first. Stop its controller and physically inspect the slot before continuing. Never resolve while the motor could still run.</p>
        <label>Inspection outcome<select name="Outcome"><option value="">Select outcome</option><option value="released">Correct key was released — check guest in</option><option value="not-released">No key released — cancel this collection code</option></select></label>
        <label>Inspection note<textarea name="Reason" required minlength="10" maxlength="500"></textarea></label>
        <label class="hotel-check"><input name="PhysicalInspection" type="checkbox" required> Controller stopped; physical inspection completed.</label>
        <button type="submit">Resolve handoff</button></form>` : ''}
    </div>`;
  }
  function mount(container, data, request, refresh, status) {
    container.innerHTML = render(data);
    container.querySelectorAll('[data-hotel-setup]').forEach(form => form.addEventListener('submit', async event => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      status('Saving hotel self-service settings…');
      try {
        const payload = Object.fromEntries(new FormData(form));
        const kind = form.dataset.hotelSetup;
        payload.action = ({ media: 'saveHotelRoomMedia', device: 'saveHotelKeyDevice', slot: 'saveHotelKeySlot', resolve: 'resolveHotelKeyCommand' })[kind];
        for (const name of ['Remove', 'RotateToken', 'PhysicalKeyConfirmed', 'PhysicalInspection']) payload[name] = payload[name] === 'on';
        if (kind === 'device') payload.Enabled = payload.Enabled === 'true';
        if (kind === 'slot') payload.KeyStocked = payload.KeyStocked === 'true';
        if (kind === 'media' && !payload.Remove) {
          const file = form.elements.MediaFile.files[0];
          if (!file || file.size > 8 * 1024 * 1024) throw new Error('Choose a picture or short video no larger than 8 MB.');
          payload.MimeType = file.type;
          const url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('File could not be read.')); reader.readAsDataURL(file); });
          payload.FileBase64 = String(url).split(',')[1];
        }
        delete payload.MediaFile;
        const result = await request(payload);
        refresh(result);
        status(result.message, 'ok');
        if (result.deviceToken) {
          const output = document.getElementById('hotelDeviceToken');
          if (output) {
            output.hidden = false;
            const label = document.createElement('label');
            label.textContent = 'New device token — copy now; it will not be shown again';
            const input = document.createElement('input'); input.readOnly = true; input.value = result.deviceToken;
            label.append(input); output.append(label); output.scrollIntoView({ block: 'center' });
          }
        }
      } catch (error) { status(error.message || String(error), 'bad'); }
      finally { if (button.isConnected) button.disabled = false; }
    }));
    const form = container.querySelector('[data-hotel-setup="slot"]');
    form?.elements.RoomId.addEventListener('change', () => {
      const room = (data.rooms || []).find(row => row.RoomId === form.elements.RoomId.value);
      form.elements.KeySlot.value = room?.KeySlot || '';
      form.elements.KeyStocked.value = 'false';
      form.elements.PhysicalKeyConfirmed.checked = false;
    });
    const mediaForm = container.querySelector('[data-hotel-setup="media"]');
    const populateDescription = () => { mediaForm.elements.Description.value = (data.roomTypes || []).find(row => row.RoomType === mediaForm.elements.RoomType.value)?.Description || ''; };
    if (mediaForm) { mediaForm.elements.RoomType.addEventListener('change', populateDescription); populateDescription(); }
  }
  window.DynamaxHotelSelfService = { render, mount };
})();
