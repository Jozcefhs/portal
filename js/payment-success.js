const statusEl = document.getElementById('confirmationStatus');
const box = document.getElementById('confirmationBox');
const leadEl = document.getElementById('confirmationLead');

function setStatus(message, type) {
  statusEl.textContent = message || '';
  statusEl.className = 'status ' + (type || '');
}

function setLead(message) {
  if (leadEl) {
    leadEl.textContent = message || '';
  }
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN'
  }).format(Number(amount || 0));
}

function shouldReleaseIdempotencyKey(response, data) {
  const status = Number(response?.status || 0);
  if (response?.ok && data?.ok) return true;
  if (status < 400 || status >= 500 || [408, 425, 429].includes(status)) return false;
  if (status === 409 && /IDEMPOTENCY_(IN_PROGRESS|LOCKED|OWNERSHIP_LOST|OUTCOME_UNCERTAIN)|already being processed|outcome.+uncertain|unresolved request|no longer owned/i.test(
    `${data?.code || ''} ${data?.message || ''}`
  )) return false;
  return status < 500;
}

function verificationIdempotency(reference, isFormPurchase) {
  const safeReference = String(reference || '').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 120);
  const storageKey = `dynamaxPaymentVerification:${isFormPurchase ? 'form' : 'general'}:${safeReference}`;
  const deterministicKey = `payment-success:${isFormPurchase ? 'form' : 'general'}:${safeReference}`.slice(0, 160);
  let key = '';
  try {
    key = sessionStorage.getItem(storageKey) || deterministicKey;
    sessionStorage.setItem(storageKey, key);
  } catch (_error) {
    key = deterministicKey;
  }
  return {
    key,
    release() {
      try {
        sessionStorage.removeItem(storageKey);
      } catch (_error) {
        // Storage can be unavailable in hardened/private browser contexts.
      }
    }
  };
}

function publicVerificationError(error, reference) {
  const status = Number(error?.status || 0);
  const message = String(error?.message || '').trim();
  const internalFailure = status >= 500
    || /cannot read propert|undefined|null|typeerror|referenceerror|syntaxerror/i.test(message);
  if (!internalFailure) return message || 'Payment could not be verified.';
  return `Payment confirmation is temporarily unavailable. If you were charged, do not pay again. Refresh this page or contact the Accounts Office with reference ${reference}.`;
}

async function verifyPayment() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');
  const paymentType = params.get('type') || '';
  const isCommerce = params.get('commerce') === '1';
  const isPublicStore = isCommerce && params.get('source') === 'public-store';
  const isChurchGiving = paymentType.toLowerCase() === 'church';
  const isPublicGiving = isChurchGiving && params.get('source') === 'public-giving';
  const isHotel = paymentType.toLowerCase() === 'hotel';
  const isPublicHotel = isHotel && params.get('source') === 'public-hotel';
  const branchId = params.get('branch') || 'main';
  const anotherLink = document.getElementById('anotherPaymentLink');
  const returnLink = document.getElementById('returnPortalLink');
  if (isHotel) {
    if (anotherLink) {
      anotherLink.href = isPublicHotel
        ? `hotel-booking.html?branch=${encodeURIComponent(branchId)}`
        : 'admin?workspace=faith';
      anotherLink.textContent = isPublicHotel ? 'Book another stay' : 'Return to Hotel Services';
    }
    if (returnLink) {
      returnLink.href = isPublicHotel ? 'index.html' : 'admin?workspace=faith';
      returnLink.textContent = isPublicHotel ? 'Return to organisation portal' : 'Return to organisation operations';
    }
  } else if (isCommerce) {
    if (anotherLink) {
      anotherLink.href = isPublicStore
        ? `store.html?branch=${encodeURIComponent(branchId)}`
        : 'admin?workspace=faith';
      anotherLink.textContent = isPublicStore ? 'Return to the store' : 'Record another sale';
    }
    if (returnLink) {
      returnLink.href = isPublicStore ? 'index.html' : 'admin?workspace=faith';
      returnLink.textContent = isPublicStore ? 'Return to organisation portal' : 'Return to organisation operations';
    }
  } else if (isChurchGiving) {
    if (anotherLink) {
      anotherLink.href = isPublicGiving
        ? `give.html?workspace=faith&branch=${encodeURIComponent(branchId)}`
        : 'admin?workspace=faith';
      anotherLink.textContent = 'Make another donation';
    }
    if (returnLink) {
      returnLink.href = isPublicGiving ? 'index.html' : 'admin?workspace=faith';
      returnLink.textContent = isPublicGiving ? 'Return to Dynamax' : 'Return to organisation operations';
    }
  }
  if (!reference) {
    setStatus('Payment reference is missing. Please contact the Accounts Office.', 'bad');
    return;
  }

  try {
    const isFormPurchase = paymentType.toLowerCase() === 'form';
    const idempotency = verificationIdempotency(reference, isFormPurchase);
    const response = await fetch(isFormPurchase ? '/api/verify-form-payment' : '/api/verify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotency.key
      },
      body: JSON.stringify({ reference, idempotencyKey: idempotency.key })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      if (shouldReleaseIdempotencyKey(response, data)) idempotency.release();
      const error = new Error(data?.message || 'Payment could not be verified.');
      error.status = response.status;
      throw error;
    }
    idempotency.release();
    setLead(isFormPurchase
      ? 'Your admission form purchase has been confirmed.'
      : (isHotel
          ? 'Your hotel reservation and payment have been confirmed.'
          : (isCommerce
          ? (isPublicStore ? 'Your store payment and purchase have been confirmed.' : 'The customer payment and sale have been confirmed.')
          : (isChurchGiving ? 'Your gift has been confirmed.' : 'Your payment has been confirmed.'))));
    setStatus(
      isFormPurchase
        ? 'Admission form purchased successfully.'
        : (isHotel
            ? 'Hotel reservation payment verified successfully.'
            : (isCommerce
            ? (isPublicStore ? 'Store payment verified successfully.' : 'Sale payment verified and posted successfully.')
            : (isChurchGiving ? 'Gift payment verified successfully.' : 'Payment verified successfully.'))),
      'ok'
    );
    const details = document.createElement('div');
    details.className = 'receipt-box';
    const rows = isFormPurchase
      ? [
          ['Applicant', data.applicantName || 'Admission applicant'],
          ['Email', data.email || ''],
          ['Receipt No.', data.receiptNo || ''],
          ['Verification Code', data.verificationCode || ''],
          ['Amount', formatMoney(data.amount, data.currency)],
          ['Reference', data.reference || reference],
          ['Code Expiry Date', data.expiryDate || '']
        ]
      : (isHotel ? [
          ['Reservation', data.hotelReservation?.ReservationId || 'Hotel reservation'],
          ['Guest', data.hotelReservation?.GuestName || ''],
          ['Room', data.hotelReservation?.RoomNumber || ''],
          ['Stay', data.hotelReservation?.ArrivalDate && data.hotelReservation?.DepartureDate
            ? `${data.hotelReservation.ArrivalDate} to ${data.hotelReservation.DepartureDate}`
            : ''],
          ['Amount', formatMoney(data.amount, data.currency)],
          ['Reference', data.reference || reference]
        ] : (isCommerce ? [
          ['Sale', data.feeName || data.commerceSale?.Department || 'Organisation sale'],
          ['Customer', data.commerceSale?.CustomerName || 'Walk-in customer'],
          ['Items', (data.commerceSale?.Items || []).map((item) => `${item.ItemName} × ${item.Quantity}`).join(', ')],
          ['Amount', formatMoney(data.amount, data.currency)],
          ['Reference', data.reference || reference]
        ] : [
          [isChurchGiving ? 'Gift' : 'Fee', data.feeName || (isChurchGiving ? 'Donation or offering' : 'Online Payment')],
          ['Amount', formatMoney(data.amount, data.currency)],
          ['Reference', data.reference || reference]
        ]));

    rows.forEach(([label, value]) => {
      if (!value) return;
      const line = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      line.append(strong, document.createTextNode(value));
      details.appendChild(line);
    });
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = isFormPurchase
      ? 'Use this email address and verification code to register. A copy has also been sent to your email.'
      : (isHotel
          ? 'Your reservation is paid and ready for hotel check-in on the scheduled arrival date.'
          : (isCommerce
          ? (isPublicStore
              ? 'Your order has been recorded and a receipt will be sent to your email.'
              : 'The payment, stock movement, and Finance & Accounting entry have been recorded.')
          : (isChurchGiving
              ? 'Your gift has been recorded. An official receipt will be sent to your email.'
              : 'Your payment has been recorded with the Accounts Office.')));
    details.appendChild(note);
    if (isFormPurchase) {
      const link = document.createElement('p');
      const anchor = document.createElement('a');
      anchor.className = 'btn';
      anchor.href = data.formLink || 'verify.html';
      anchor.textContent = 'Register Now';
      link.appendChild(anchor);
      details.appendChild(link);
    }
    box.appendChild(details);
  } catch (error) {
    setLead('We could not confirm your payment automatically.');
    const internalFailure = Number(error?.status || 0) >= 500
      || /cannot read propert|undefined|null|typeerror|referenceerror|syntaxerror/i.test(String(error?.message || ''));
    if (internalFailure && anotherLink) {
      anotherLink.hidden = true;
      document.getElementById('anotherPaymentRow')?.setAttribute('hidden', '');
    }
    setStatus(publicVerificationError(error, reference), 'bad');
  }
}

verifyPayment();
