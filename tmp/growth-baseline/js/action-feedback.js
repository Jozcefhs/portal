(function () {
  function begin(button, loadingText = 'Working...') {
    if (!button || button.disabled || button.dataset.actionBusy === 'true') return false;
    button.dataset.actionBusy = 'true';
    button.dataset.actionNormalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    button.textContent = loadingText;
    return true;
  }

  function end(button) {
    if (!button) return;
    const normalHtml = button.dataset.actionNormalHtml;
    button.disabled = false;
    button.classList.remove('is-loading');
    button.setAttribute('aria-busy', 'false');
    if (normalHtml !== undefined) button.innerHTML = normalHtml;
    delete button.dataset.actionBusy;
    delete button.dataset.actionNormalHtml;
  }

  window.DynamaxActionFeedback = Object.freeze({ begin, end });
})();
