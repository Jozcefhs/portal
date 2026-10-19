const lookupForm = document.getElementById('paymentLookupForm');
const statusEl = document.getElementById('paymentStatus');
const lookupBtn = document.getElementById('lookupBtn');
const feePanel = document.getElementById('feePanel');
const feeList = document.getElementById('feeList');
const accountSummary = document.getElementById('accountSummary');
const payBtn = document.getElementById('payBtn');
const breakdownEl = document.getElementById('schoolFeeBreakdown');
const walletAmountBox = document.getElementById('walletAmountBox');
const walletAmountInput = document.getElementById('walletAmount');

let currentEmail = '';
let currentCode = '';
let currentFees = [];
let currentBreakdown = [];
const debugMode = new URLSearchParams(window.location.search).get('debug') === '1';

const SCHOOL_FEES_TOTAL_CODE = 'SCHOOL_FEES_TOTAL';

function setStatus(message, type) {
  statusEl.textContent = message || '';
  statusEl.className = 'status ' + (type || '');
}

function formatMoney(amount, currency) {
  const number = Number(String(amount || '0').replace(/,/g, ''));
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN'
  }).format(Number.isFinite(number) ? number : 0);
}

function isWalletFee(fee) {
  return fee && (fee.FeeCode === 'WALLET_TOPUP' || String(fee.FeeCategory || '').toLowerCase() === 'wallet');
}

function isSchoolFee(fee) {
  return fee && !isWalletFee(fee) && String(fee.FeeCategory || 'School Fee').trim().toLowerCase() === 'school fee';
}

function isSchoolFeesTotal(fee) {
  return fee && String(fee.FeeCode || '') === SCHOOL_FEES_TOTAL_CODE;
}

function toAmount(value) {
  const amount = Number(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function isYes(value) {
  return ['yes', 'y', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function termText(feeOrAccount) {
  const term = String((feeOrAccount && feeOrAccount.Term) || '').trim();
  const session = String((feeOrAccount && feeOrAccount.AcademicSession) || '').trim();
  const parts = [];
  if (term && term.toLowerCase() !== 'all') parts.push(term);
  if (session && session.toLowerCase() !== 'all') parts.push(session);
  return parts.join(' | ');
}

function selectedFee() {
  const selected = document.querySelector('input[name="feeCode"]:checked');
  if (!selected) return null;
  return currentFees.find((fee) => String(fee.FeeCode) === selected.value) || null;
}

function paymentAmountRules(fee) {
  if (!fee) return { show: false, min: 0, max: 0, defaultAmount: '' };
  if (isWalletFee(fee)) {
    return {
      show: true,
      label: 'Wallet Top-up Amount',
      min: toAmount(fee.MinAmount),
      max: toAmount(fee.MaxAmount),
      defaultAmount: fee.MinAmount || ''
    };
  }
  if (isSchoolFeesTotal(fee) && isYes(fee.AllowInstallment)) {
    const fullAmount = toAmount(fee.Amount);
    const minAmount = toAmount(fee.MinAmount);
    return {
      show: true,
      label: 'School Fee Amount to Pay Now',
      min: minAmount,
      max: fullAmount,
      defaultAmount: minAmount > 0 ? minAmount : fullAmount
    };
  }
  return { show: false, min: 0, max: 0, defaultAmount: '' };
}

function updateWalletAmountVisibility() {
  const fee = selectedFee();
  const rules = paymentAmountRules(fee);
  const label = walletAmountBox.querySelector('label');
  walletAmountBox.hidden = !rules.show;
  if (label) label.textContent = rules.label || 'Amount';
  walletAmountInput.min = rules.min > 0 ? String(rules.min) : '0';
  walletAmountInput.max = rules.max > 0 ? String(rules.max) : '';
  if (rules.show && !walletAmountInput.value) {
    walletAmountInput.value = rules.defaultAmount || '';
  }
  if (!rules.show) {
    walletAmountInput.value = '';
  }
}

function renderBreakdown(breakdown) {
  currentBreakdown = breakdown || [];
  breakdownEl.innerHTML = '';
  if (!currentBreakdown.length) {
    breakdownEl.hidden = true;
    return;
  }
  breakdownEl.hidden = false;
  const title = document.createElement('h2');
  title.textContent = 'School Fee Breakdown';
  breakdownEl.appendChild(title);
  const breakdownTerm = termText(currentBreakdown[0]);
  if (breakdownTerm) {
    const term = document.createElement('p');
    term.className = 'muted';
    term.textContent = `Fee period: ${breakdownTerm}`;
    breakdownEl.appendChild(term);
  }
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = 'This shows how the school fee total is made up. If Accounts enabled part payment, you can enter the amount to pay now.';
  breakdownEl.appendChild(note);
  let total = 0;
  currentBreakdown.forEach((fee) => {
    const amount = toAmount(fee.Amount);
    total += amount;
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    const name = document.createElement('span');
    const itemTerm = termText(fee);
    name.textContent = `${fee.FeeName || fee.FeeCode}${itemTerm ? ` - ${itemTerm}` : ''}`;
    const value = document.createElement('strong');
    const paid = toAmount(fee.PaidAmount);
    const original = toAmount(fee.OriginalAmount);
    const acceptanceCredit = toAmount(fee.AcceptanceCreditApplied);
    if (paid > 0 && original > 0) {
      const paidLabel = acceptanceCredit > 0
        ? `paid/credited ${formatMoney(paid, fee.Currency)} of ${formatMoney(original, fee.Currency)}`
        : `paid ${formatMoney(paid, fee.Currency)} of ${formatMoney(original, fee.Currency)}`;
      value.textContent = `${formatMoney(amount, fee.Currency)} balance (${paidLabel})`;
    } else {
      value.textContent = formatMoney(amount, fee.Currency);
    }
    row.append(name, value);
    breakdownEl.appendChild(row);
  });
  const totalRow = document.createElement('div');
  totalRow.className = 'breakdown-row total';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'Outstanding Balance';
  const totalValue = document.createElement('strong');
  totalValue.textContent = formatMoney(total, currentBreakdown[0].Currency || 'NGN');
  totalRow.append(totalLabel, totalValue);
  breakdownEl.appendChild(totalRow);
}

function schoolFeeTotalItem(breakdown) {
  const items = (breakdown || []).filter(isSchoolFee);
  if (!items.length) return null;
  const total = items.reduce((sum, fee) => {
    return sum + toAmount(fee.Amount);
  }, 0);
  if (total <= 0) return null;
  const installmentItems = items.filter((fee) => isYes(fee.AllowInstallment));
  const installmentMinimum = items.reduce((sum, fee) => {
    if (!isYes(fee.AllowInstallment)) return sum;
    const min = toAmount(fee.MinAmount);
    return sum + (min > 0 ? min : 0);
  }, 0);
  const minimumInstallmentPortion = installmentItems.length && installmentMinimum <= 0 ? 1 : installmentMinimum;
  const minAmount = Math.min(total, minimumInstallmentPortion);
  const allowInstallment = installmentItems.length > 0 && minAmount < total;
  const originalTotal = items.reduce((sum, fee) => sum + toAmount(fee.OriginalAmount || fee.Amount), 0);
  const acceptanceCreditApplied = items.reduce((sum, fee) => sum + toAmount(fee.AcceptanceCreditApplied), 0);
  const schoolFeesTotalCreditApplied = items.reduce((sum, fee) => sum + toAmount(fee.SchoolFeesTotalCreditApplied), 0);
  const generalFeeCreditApplied = items.reduce((sum, fee) => sum + toAmount(fee.GeneralFeeCreditApplied), 0);
  const creditApplied = Math.max(0, originalTotal - total);
  return {
    FeeCode: SCHOOL_FEES_TOTAL_CODE,
    FeeName: 'School Fees Total',
    FeeCategory: 'School Fee',
    Amount: total,
    OriginalAmount: originalTotal || total,
    CreditApplied: creditApplied,
    AcceptanceCreditApplied: acceptanceCreditApplied,
    SchoolFeesTotalCreditApplied: schoolFeesTotalCreditApplied,
    GeneralFeeCreditApplied: generalFeeCreditApplied,
    PreviousFeePaymentApplied: Math.max(0, creditApplied - acceptanceCreditApplied - schoolFeesTotalCreditApplied - generalFeeCreditApplied),
    Currency: items[0].Currency || 'NGN',
    AllowInstallment: allowInstallment ? 'YES' : 'NO',
    MinAmount: allowInstallment ? minAmount : '',
    MaxAmount: total,
    PaymentType: 'SchoolFeesTotal',
    AcademicSession: items[0].AcademicSession || '',
    Term: items[0].Term || '',
    Components: items.map((fee) => ({
      FeeCode: fee.FeeCode,
      FeeName: fee.FeeName,
      FeeCategory: fee.FeeCategory || 'School Fee',
      Amount: fee.Amount,
      OriginalAmount: fee.OriginalAmount || fee.Amount,
      PaidAmount: fee.PaidAmount || '',
      AcceptanceCreditApplied: fee.AcceptanceCreditApplied || '',
      SchoolFeesTotalCreditApplied: fee.SchoolFeesTotalCreditApplied || '',
      GeneralFeeCreditApplied: fee.GeneralFeeCreditApplied || '',
      BalanceAmount: fee.BalanceAmount || fee.Amount,
      Currency: fee.Currency || items[0].Currency || 'NGN',
      AcademicSession: fee.AcademicSession || '',
      Term: fee.Term || '',
      AllowInstallment: fee.AllowInstallment || '',
      MinAmount: fee.MinAmount || '',
      MaxAmount: fee.MaxAmount || ''
    }))
  };
}

function buildPayableItems(fees, breakdown) {
  const items = [];
  const schoolTotal = schoolFeeTotalItem(breakdown);
  if (schoolTotal) {
    items.push(schoolTotal);
  }
  (fees || []).forEach((fee) => {
    if (isSchoolFee(fee)) return;
    items.push(fee);
  });
  return items;
}

function renderFees(account, fees, breakdown) {
  currentFees = buildPayableItems(fees || [], breakdown || []);
  feeList.innerHTML = '';
  feePanel.hidden = false;
  const accountPeriod = termText(account);
  const debugText = debugMode && account.BillingSource ? ` | Billing Source: ${account.BillingSource}` : '';
  accountSummary.textContent = `${account.DisplayName || 'Student'} | ${account.ApplicationReference || account.AccountRef || ''} | ${account.ClassName || ''} | ${account.StudentType || ''}${accountPeriod ? ' | ' + accountPeriod : ''}${debugText}`;
  renderBreakdown(breakdown || []);

  if (!currentFees.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'There are no online payment items due at the moment.';
    feeList.appendChild(empty);
    payBtn.disabled = true;
    updateWalletAmountVisibility();
    return;
  }

  payBtn.disabled = false;
  currentFees.forEach((fee, index) => {
    const id = `fee-${index}`;
    const row = document.createElement('label');
    row.className = 'fee-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'feeCode';
    input.value = fee.FeeCode;
    input.id = id;
    input.checked = index === 0;
    input.addEventListener('change', updateWalletAmountVisibility);
    const textWrap = document.createElement('span');
    const name = document.createElement('strong');
    const feePeriod = termText(fee);
    name.textContent = `${fee.FeeName || fee.FeeCode}${fee.FeeCategory ? ` (${fee.FeeCategory})` : ''}${feePeriod ? ` - ${feePeriod}` : ''}`;
    const amount = document.createElement('small');
    if (isWalletFee(fee)) {
      amount.textContent = 'Enter amount';
    } else if (isSchoolFeesTotal(fee) && isYes(fee.AllowInstallment)) {
      amount.textContent = `${formatMoney(fee.Amount, fee.Currency)} total | part payment allowed`;
    } else {
      amount.textContent = formatMoney(fee.Amount, fee.Currency);
    }
    textWrap.append(name, amount);
    row.append(input, textWrap);
    feeList.appendChild(row);
  });
  updateWalletAmountVisibility();
}

lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  currentEmail = document.getElementById('email').value.trim().toLowerCase();
  currentCode = document.getElementById('code').value.trim().toUpperCase();
  feePanel.hidden = true;
  lookupBtn.disabled = true;
  setStatus('Checking payable fees...', '');

  try {
    const response = await fetch('/api/payment-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail, code: currentCode })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not load payable fees.');
    }
    renderFees(data.account || {}, data.fees || [], data.schoolFeeBreakdown || []);
    setStatus('Review the payable amount and continue to Paystack checkout.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    lookupBtn.disabled = false;
  }
});

payBtn.addEventListener('click', async () => {
  const fee = selectedFee();
  if (!fee) {
    setStatus('Select a payment item to pay.', 'bad');
    return;
  }
  const rules = paymentAmountRules(fee);
  const enteredAmount = rules.show ? Number(walletAmountInput.value || 0) : 0;
  if (rules.show && (!Number.isFinite(enteredAmount) || enteredAmount <= 0)) {
    setStatus('Enter the amount to pay.', 'bad');
    return;
  }
  if (rules.show && rules.min > 0 && enteredAmount < rules.min) {
    setStatus(`Minimum amount is ${formatMoney(rules.min, fee.Currency)}.`, 'bad');
    return;
  }
  if (rules.show && rules.max > 0 && enteredAmount > rules.max) {
    setStatus(`Maximum amount is ${formatMoney(rules.max, fee.Currency)}.`, 'bad');
    return;
  }

  payBtn.disabled = true;
  setStatus('Starting secure checkout...', '');
  try {
    const response = await fetch('/api/init-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: currentEmail,
        code: currentCode,
        feeCode: fee.FeeCode,
        components: fee.Components || undefined,
        amount: rules.show ? enteredAmount : undefined
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not initialize payment.');
    }
    window.location.href = data.authorizationUrl;
  } catch (error) {
    setStatus(error.message, 'bad');
    payBtn.disabled = false;
  }
});
