(function () {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const section = byId('ownerHelpSettings');
  const form = byId('ownerHelpForm');
  const fields = byId('ownerHelpFields');
  const list = byId('ownerHelpFaqList');
  const status = byId('ownerHelpStatus');
  const publish = byId('saveOwnerHelp');
  const reload = byId('reloadOwnerHelp');
  const add = byId('ownerHelpAddFaq');
  let getPassword = () => '';
  let revision = null;
  let ready = false;
  let busy = false;
  let dirty = false;
  let rowSequence = 0;

  function message(text, bad = false) {
    status.textContent = text;
    status.className = `status ${bad ? 'bad' : 'ok'}`;
  }
  function setBusy(value) {
    busy = value;
    fields.disabled = value || !ready;
    publish.disabled = value || !ready;
    reload.disabled = value;
    add.disabled = value || !ready || list.children.length >= 30;
  }
  function markDirty() {
    dirty = true;
    message('You have unpublished help changes. Plan prices and payment settings are not affected.');
  }
  function button(label, action, disabled = false) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'secondary'; node.textContent = label; node.disabled = disabled;
    node.addEventListener('click', action);
    return node;
  }
  function faqValues() {
    return Array.from(list.children).map((row) => ({
      Question: row.querySelector('[data-faq-question]').value.trim(),
      Answer: row.querySelector('[data-faq-answer]').value.trim()
    }));
  }
  function renderFaqs(faqs) {
    list.replaceChildren(...faqs.map((faq, index) => {
      const row = document.createElement('div');
      row.className = 'owner-help-faq-row';
      const number = ++rowSequence;
      const questionLabel = document.createElement('label');
      questionLabel.textContent = `Question ${index + 1}`;
      const question = document.createElement('input');
      question.id = `ownerHelpQuestion${number}`; questionLabel.htmlFor = question.id;
      question.dataset.faqQuestion = ''; question.maxLength = 180; question.required = true;
      question.value = String(faq.Question || '');
      questionLabel.append(question);
      const answerLabel = document.createElement('label');
      answerLabel.textContent = 'Answer';
      const answer = document.createElement('textarea');
      answer.id = `ownerHelpAnswer${number}`; answerLabel.htmlFor = answer.id;
      answer.dataset.faqAnswer = ''; answer.maxLength = 3000; answer.required = true; answer.rows = 3;
      answer.value = String(faq.Answer || '');
      answerLabel.append(answer);
      const actions = document.createElement('div');
      actions.className = 'owner-help-faq-actions';
      const move = (offset) => {
        const current = faqValues();
        [current[index], current[index + offset]] = [current[index + offset], current[index]];
        renderFaqs(current); markDirty();
        list.children[index + offset].querySelector('[data-faq-question]').focus();
      };
      actions.append(button('Move up', () => move(-1), index === 0), button('Move down', () => move(1), index === faqs.length - 1), button('Remove FAQ', () => {
        const current = faqValues(); current.splice(index, 1); renderFaqs(current); markDirty(); add.focus();
      }));
      row.append(questionLabel, answerLabel, actions);
      return row;
    }));
    add.disabled = !ready || busy || list.children.length >= 30;
  }
  async function request(payload) {
    const response = await fetch('/api/help-config', payload ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    } : { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || data.unavailable || !data.config || !Number.isSafeInteger(data.config.Revision)) {
      const error = new Error(data?.message || 'Help settings could not be loaded. Try again when connected.');
      error.conflict = response.status === 409;
      throw error;
    }
    return data;
  }
  function render(config) {
    revision = config.Revision;
    byId('ownerSupportEmail').value = config.SupportEmail || '';
    byId('ownerHardwareShopUrl').value = config.HardwareShopUrl || '';
    renderFaqs(Array.isArray(config.Faqs) ? config.Faqs : []);
    dirty = false;
  }
  async function load(passwordProvider) {
    if (busy) return;
    if (typeof passwordProvider === 'function') getPassword = passwordProvider;
    section.hidden = false;
    setBusy(true);
    message('Loading published help settings…');
    try {
      const data = await request();
      ready = true;
      render(data.config);
      message(data.published ? 'Published help settings loaded. Edit and publish when ready.' : 'Default help loaded. Add your support email and publish when ready.');
    } catch (error) {
      message(`${error.message} Existing drafts are unchanged.`, true);
    } finally { setBusy(false); }
  }
  form.addEventListener('input', markDirty);
  add.addEventListener('click', () => {
    if (!ready || busy || list.children.length >= 30) return;
    renderFaqs([...faqValues(), { Question: '', Answer: '' }]);
    markDirty();
    list.lastElementChild.querySelector('[data-faq-question]').focus();
  });
  reload.addEventListener('click', async () => {
    if (dirty && !await window.DynamaxDialogs.confirm({ title: 'Reload help settings?', message: 'Discard your unpublished help changes and load the published version?', confirmText: 'Discard and reload' })) return;
    await load();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ready || busy || !getPassword()) return;
    const faqs = faqValues();
    if (faqs.some((faq) => !faq.Question || !faq.Answer)) { message('Enter a question and answer for every FAQ, or remove the blank row.', true); return; }
    const config = { SupportEmail: byId('ownerSupportEmail').value.trim(), HardwareShopUrl: byId('ownerHardwareShopUrl').value.trim(), Faqs: faqs };
    try {
      const shop = new URL(config.HardwareShopUrl);
      if (shop.protocol !== 'https:' || shop.username || shop.password) throw new Error();
    } catch (_error) { message('Enter a secure HTTPS shop link without a username or password.', true); return; }
    setBusy(true); message('Publishing help settings…');
    try {
      const data = await request({ password: getPassword(), ExpectedRevision: revision, config });
      render(data.config);
      message('Help settings published. All editions will use this support contact, shop link and FAQ list.');
    } catch (error) {
      message(`${error.message} Your draft has been kept.${error.conflict ? ' Reload published settings before publishing again; copy any changes you want to keep first.' : ''}`, true);
    } finally { setBusy(false); }
  });
  window.DynamaxOwnerHelpSettings = Object.freeze({ load });
}());
