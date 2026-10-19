(function () {
  function addPasswordToggle(input) {
    if (!(input instanceof HTMLInputElement) || input.dataset.passwordToggleReady === 'true') return;

    const wrapper = document.createElement('div');
    wrapper.className = 'password-field';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'password-toggle';
    toggle.textContent = 'Show';
    toggle.setAttribute('aria-label', 'Show password');
    toggle.setAttribute('aria-pressed', 'false');

    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input, toggle);
    input.dataset.passwordToggleReady = 'true';

    function setVisible(visible) {
      input.type = visible ? 'text' : 'password';
      toggle.textContent = visible ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      toggle.setAttribute('aria-pressed', String(visible));
    }

    toggle.addEventListener('click', function () {
      setVisible(input.type === 'password');
    });

    input.form?.addEventListener('reset', function () {
      setVisible(false);
    });
  }

  function enhancePasswordInputs(root) {
    if (root instanceof HTMLInputElement && root.matches('input[type="password"]')) {
      addPasswordToggle(root);
    }
    if (root.querySelectorAll) {
      root.querySelectorAll('input[type="password"]').forEach(addPasswordToggle);
    }
  }

  enhancePasswordInputs(document);

  new MutationObserver(function (changes) {
    changes.forEach(function (change) {
      change.addedNodes.forEach(function (node) {
        if (node.nodeType === Node.ELEMENT_NODE) enhancePasswordInputs(node);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
}());
