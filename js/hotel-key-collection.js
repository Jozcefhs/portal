(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const body = { ReservationId: params.get('reservation') || '', GuestAccessToken: params.get('token') || '' };
  const status = document.getElementById('collectionStatus');
  const details = document.getElementById('collectionDetails');
  const button = document.getElementById('refreshCollection');
  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true; button.disabled = true;
    details.hidden = true;
    document.getElementById('collectionCode').textContent = '';
    status.textContent = 'Checking verified payment and key collection…';
    try {
      const response = await fetch('/api/hotel-key-collection', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load collection details.');
      status.textContent = data.status;
      document.getElementById('collectionRoom').textContent = `Room ${data.roomNumber}`;
      document.getElementById('collectionStay').textContent = `${data.arrivalDate} to ${data.departureDate}`;
      document.getElementById('collectionCode').textContent = data.code || '';
      document.getElementById('collectionWindow').textContent = data.code
        ? `Valid from ${new Date(data.notBefore).toLocaleString()} until ${new Date(data.expiresAt).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}, your device time zone).` : '';
      document.getElementById('collectionMessage').textContent = data.message;
      details.hidden = false;
    } catch (error) { status.textContent = error.message || 'Contact reception for help with your booking.'; }
    finally { busy = false; button.disabled = false; }
  }
  button.addEventListener('click', refresh);
  document.getElementById('copyCollectionLink').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); status.textContent = 'Private link copied. Store it safely; anyone with this link can retrieve your code.'; }
    catch { status.textContent = 'Copy the complete address from your browser, including the part after #, and keep it private.'; }
  });
  document.getElementById('printCollection').addEventListener('click', () => window.print());
  refresh();
})();
