(function installFinancialValueFormatting(global) {
  const selector = 'input[data-finance-input]';

  function cleanNumericText(value, maximumFractionDigits = 2) {
    const text = String(value ?? '').replace(/[\s,]/g, '');
    const negative = text.startsWith('-');
    const unsigned = text.replace(/-/g, '').replace(/[^\d.]/g, '');
    const dotAt = unsigned.indexOf('.');
    const wholeText = dotAt >= 0 ? unsigned.slice(0, dotAt) : unsigned;
    const fractionText = dotAt >= 0
      ? unsigned.slice(dotAt + 1).replace(/\./g, '').slice(0, maximumFractionDigits)
      : '';
    const whole = (wholeText || (dotAt >= 0 ? '0' : '')).replace(/^0+(?=\d)/, '');
    if (!whole && dotAt < 0) return '';
    return `${negative ? '-' : ''}${whole}${dotAt >= 0 ? `.${fractionText}` : ''}`;
  }

  function fractionDigitsFor(input) {
    const configured = Number(input?.dataset?.financeDecimals);
    if (Number.isInteger(configured) && configured >= 0 && configured <= 12) return configured;
    const step = String(input?.getAttribute?.('step') || '0.01');
    const decimalAt = step.indexOf('.');
    return decimalAt >= 0 ? Math.min(12, step.length - decimalAt - 1) : 2;
  }

  function format(value, maximumFractionDigits = 2, minimumFractionDigits = 0) {
    const cleaned = cleanNumericText(value, maximumFractionDigits);
    if (!cleaned || cleaned === '-') return cleaned;
    const negative = cleaned.startsWith('-');
    const unsigned = negative ? cleaned.slice(1) : cleaned;
    const hasDecimal = unsigned.includes('.');
    const [whole = '0', enteredFraction = ''] = unsigned.split('.');
    const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const fraction = hasDecimal
      ? enteredFraction.padEnd(minimumFractionDigits, '0').slice(0, maximumFractionDigits)
      : minimumFractionDigits > 0 ? ''.padEnd(minimumFractionDigits, '0') : '';
    return `${negative ? '-' : ''}${groupedWhole}${hasDecimal || minimumFractionDigits > 0 ? `.${fraction}` : ''}`;
  }

  function raw(value, maximumFractionDigits = 12) {
    const cleaned = cleanNumericText(value, maximumFractionDigits);
    return cleaned.endsWith('.') ? cleaned.slice(0, -1) : cleaned;
  }

  function parse(value) {
    const number = Number(raw(value));
    return Number.isFinite(number) ? number : Number.NaN;
  }

  function validate(input) {
    if (!input || !input.setCustomValidity) return;
    const text = raw(input.value, fractionDigitsFor(input));
    if (!text) {
      input.setCustomValidity('');
      return;
    }
    const number = Number(text);
    if (!Number.isFinite(number)) {
      input.setCustomValidity('Enter a valid financial value.');
      return;
    }
    const minimum = Number(input.getAttribute('min'));
    if (input.hasAttribute('min') && Number.isFinite(minimum) && number < minimum) {
      input.setCustomValidity(`Enter a value of at least ${format(minimum, fractionDigitsFor(input))}.`);
      return;
    }
    const maximum = Number(input.getAttribute('max'));
    if (input.hasAttribute('max') && Number.isFinite(maximum) && number > maximum) {
      input.setCustomValidity(`Enter a value no greater than ${format(maximum, fractionDigitsFor(input))}.`);
      return;
    }
    input.setCustomValidity('');
  }

  function formatInput(input, preserveCaret = false) {
    if (!input) return;
    const previous = input.value;
    const previousCaret = preserveCaret ? input.selectionStart ?? previous.length : previous.length;
    const significantBeforeCaret = previous.slice(0, previousCaret).replace(/[^\d.]/g, '').length;
    const minimumFractionDigits = input.readOnly ? Number(input.dataset.financeFixed || 0) : 0;
    input.value = format(previous, fractionDigitsFor(input), minimumFractionDigits);
    validate(input);
    if (!preserveCaret || input.readOnly || global.document?.activeElement !== input) return;
    let seen = 0;
    let caret = input.value.length;
    for (let index = 0; index < input.value.length; index += 1) {
      if (/[\d.]/.test(input.value[index])) seen += 1;
      if (seen >= significantBeforeCaret) {
        caret = index + 1;
        break;
      }
    }
    input.setSelectionRange(caret, caret);
  }

  function normalizeFormData(event) {
    event.target.querySelectorAll(selector).forEach((input) => {
      if (!input.name || input.disabled) return;
      event.formData.set(input.name, raw(input.value, fractionDigitsFor(input)));
    });
  }

  function enhance(input) {
    if (!input || input.dataset.financeEnhanced === 'true') return input;
    input.dataset.financeEnhanced = 'true';
    input.type = 'text';
    input.inputMode = 'decimal';
    input.addEventListener('input', () => formatInput(input, true));
    input.addEventListener('blur', () => formatInput(input));
    const form = input.form;
    if (form && form.dataset.financeFormEnhanced !== 'true') {
      form.dataset.financeFormEnhanced = 'true';
      form.addEventListener('formdata', normalizeFormData);
      form.addEventListener('reset', () => global.setTimeout(() => refresh(form), 0));
    }
    formatInput(input);
    return input;
  }

  function refresh(root = global.document) {
    root?.querySelectorAll?.(selector).forEach(enhance);
    if (root?.matches?.(selector)) enhance(root);
  }

  function set(input, value) {
    if (!input) return;
    enhance(input);
    input.value = value === null || value === undefined ? '' : String(value);
    formatInput(input);
  }

  const api = Object.freeze({ cleanNumericText, format, raw, parse, refresh, set });
  global.DynamaxFinancialValues = api;

  if (!global.document) return;
  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', () => refresh(global.document), { once: true });
  } else {
    refresh(global.document);
  }
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === 1) refresh(node);
    }));
  }).observe(global.document.documentElement, { childList: true, subtree: true });
})(typeof window === 'undefined' ? globalThis : window);
