(function () {
  'use strict';
  const fallbackShop = 'https://vehiclepass.dynamax.cc/shop';
  const nodes = Object.fromEntries(['helpShopLink', 'helpSupportLink', 'helpSupportUnavailable', 'helpFaqSearch', 'helpFaqList', 'helpFaqCount', 'helpStatus', 'helpRetry'].map((id) => [id, document.getElementById(id)]));
  let faqs = [];
  let loading = false;

  function safeShop(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : fallbackShop;
    } catch (_error) { return fallbackShop; }
  }

  function safeEmail(value) {
    if (typeof value !== 'string' || /[\r\n\x00-\x1f\x7f]/.test(value)) return '';
    const email = value.trim();
    const [local, domain, extra] = email.split('@');
    return email.length <= 254 && local && local.length <= 64 && extra === undefined
      && /^[A-Za-z0-9.!$'*+_`{|}~-]+$/.test(local) && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..')
      && domain && domain.length <= 253 && domain.includes('.')
      && domain.split('.').every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label)) ? email : '';
  }

  function renderFaqs() {
    const query = nodes.helpFaqSearch.value.trim().toLocaleLowerCase();
    const matching = faqs.filter((faq) => `${faq.Question} ${faq.Answer}`.toLocaleLowerCase().includes(query));
    nodes.helpFaqList.replaceChildren(...matching.map((faq) => {
      const row = document.createElement('details');
      const title = document.createElement('summary');
      const answer = document.createElement('p');
      title.textContent = faq.Question;
      answer.textContent = faq.Answer;
      row.append(title, answer);
      return row;
    }));
    nodes.helpFaqCount.textContent = query
      ? `${matching.length} of ${faqs.length} questions match your search.`
      : faqs.length ? `${faqs.length} questions · Select a question to read the answer.` : 'No FAQs have been published yet.';
  }

  async function load() {
    if (loading) return;
    loading = true;
    nodes.helpRetry.disabled = true;
    nodes.helpStatus.textContent = 'Loading help…';
    try {
      const response = await fetch('/api/help-config', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.ok || !data.config) throw new Error('Help is temporarily unavailable.');
      nodes.helpShopLink.href = safeShop(data.config.HardwareShopUrl);
      const email = data.unavailable ? '' : safeEmail(data.config.SupportEmail);
      nodes.helpSupportLink.hidden = !email;
      if (email) {
        nodes.helpSupportLink.href = `mailto:${encodeURIComponent(email)}`;
        nodes.helpSupportLink.textContent = email;
      } else nodes.helpSupportLink.removeAttribute('href');
      nodes.helpSupportUnavailable.hidden = Boolean(email);
      nodes.helpSupportUnavailable.textContent = data.unavailable
        ? 'The support contact could not be loaded. Retry when connected, or ask your organisation administrator for assistance.'
        : 'A platform support email has not been published yet. Ask your organisation administrator for assistance.';
      faqs = (Array.isArray(data.config.Faqs) ? data.config.Faqs : []).filter((faq) => typeof faq?.Question === 'string' && typeof faq?.Answer === 'string' && faq.Question.trim() && faq.Answer.trim());
      nodes.helpFaqSearch.disabled = false;
      renderFaqs();
      nodes.helpStatus.textContent = data.unavailable ? 'Published help could not be loaded. General guidance is shown below; retry to load the latest help and support contact.' : '';
      nodes.helpRetry.hidden = !data.unavailable;
    } catch (_error) {
      nodes.helpSupportUnavailable.textContent = 'The support contact could not be loaded. Retry when connected, or ask your organisation administrator for assistance.';
      nodes.helpStatus.textContent = 'Help could not be loaded. Your hardware shop link is still available.';
      nodes.helpRetry.hidden = false;
    } finally {
      loading = false;
      nodes.helpRetry.disabled = false;
    }
  }
  nodes.helpFaqSearch.addEventListener('input', renderFaqs);
  nodes.helpRetry.addEventListener('click', load);
  load();
}());
