import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../js/help.js', import.meta.url), 'utf8');
const ownerSource = await readFile(new URL('../js/owner-help-settings.js', import.meta.url), 'utf8');
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  removeAttribute(name) { delete this[name]; }
  focus() { this.focused = true; }
  querySelector(selector) {
    const key = selector === '[data-faq-question]' ? 'faqQuestion' : 'faqAnswer';
    for (const child of this.children) {
      if (key in child.dataset) return child;
      const result = child.querySelector(selector);
      if (result) return result;
    }
    return null;
  }
  get lastElementChild() { return this.children.at(-1); }
}

const config = (extra = {}) => ({ SupportEmail: 'help@example.org', HardwareShopUrl: 'https://vehiclepass.dynamax.cc/shop', Faqs: [{ Question: 'How do cards work?', Answer: 'Ask for a compatible NFC card.' }, { Question: 'How do I get help?', Answer: 'Contact support.' }], Revision: 2, ...extra });
const response = (configValue = config(), extra = {}) => ({ ok: true, status: 200, json: async () => ({ ok: true, config: configValue, ...extra }) });
function harness(script, replies = [response()]) {
  const nodes = new Map();
  const calls = [];
  const confirms = [];
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const window = { DynamaxDialogs: { confirm: async (options) => { confirms.push(options); return window.confirmResult; } }, confirmResult: true };
  const context = vm.createContext({ document: { getElementById: node, createElement: (tag) => new Element(tag) }, URL, window, fetch: async (...args) => {
    calls.push(args); const reply = replies.shift(); if (reply instanceof Error) throw reply; return reply;
  } });
  vm.runInContext(script, context);
  return { node, calls, confirms, window, replies, tick: () => new Promise((resolve) => setImmediate(resolve)), click: (id) => node(id).listeners.click(), submit: () => node('ownerHelpForm').listeners.submit({ preventDefault() {} }), input: () => node('ownerHelpForm').listeners.input(), load: () => window.DynamaxOwnerHelpSettings.load(() => 'owner-password-fixture') };
}

test('public help loads configured email and shop without HTML interpretation', async () => {
  const ui = harness(source, [response(config({ Faqs: [{ Question: '<img src=x onerror=alert(1)>', Answer: '<script>bad()</script>' }] }))]);
  await ui.tick();
  assert.equal(ui.calls[0][0], '/api/help-config');
  assert.equal(ui.calls[0][1].cache, 'no-store');
  assert.equal(ui.node('helpSupportLink').href, 'mailto:help%40example.org');
  assert.equal(ui.node('helpSupportLink').hidden, false);
  assert.equal(ui.node('helpSupportUnavailable').hidden, true);
  assert.equal(ui.node('helpShopLink').href, 'https://vehiclepass.dynamax.cc/shop');
  const [details] = ui.node('helpFaqList').children;
  assert.equal(details.tagName, 'details');
  assert.equal(details.children[0].tagName, 'summary');
  assert.match(details.children[0].textContent, /<img/);
  assert.equal(details.children[1].textContent, '<script>bad()</script>');
  assert.equal(details.children[1].children.length, 0);
});

test('FAQ search matches questions and answers with clear empty results', async () => {
  const ui = harness(source); await ui.tick();
  ui.node('helpFaqSearch').value = 'nfc'; ui.node('helpFaqSearch').listeners.input();
  assert.equal(ui.node('helpFaqList').children.length, 1);
  assert.match(ui.node('helpFaqCount').textContent, /1 of 2/);
  ui.node('helpFaqSearch').value = 'not found'; ui.node('helpFaqSearch').listeners.input();
  assert.equal(ui.node('helpFaqList').children.length, 0);
  assert.match(ui.node('helpFaqCount').textContent, /0 of 2/);
});

test('unpublished email and unsafe destinations never make a broken or injected link', async () => {
  for (const email of ['', 'support@example.org?bcc=evil@example.org', 'x@example.org\r\nSubject:bad']) {
    const ui = harness(source, [response(config({ SupportEmail: email, HardwareShopUrl: 'javascript:alert(1)', Faqs: [] }))]);
    await ui.tick();
    assert.equal(ui.node('helpSupportLink').hidden, true);
    assert.equal(ui.node('helpSupportLink').href, undefined);
    assert.match(ui.node('helpSupportUnavailable').textContent, /not been published/);
    assert.equal(ui.node('helpShopLink').href, 'https://vehiclepass.dynamax.cc/shop');
    assert.match(ui.node('helpFaqCount').textContent, /No FAQs/);
  }
});

test('help outage is explicit and retry recovers', async () => {
  const ui = harness(source, [response(config(), { unavailable: true }), response()]); await ui.tick();
  assert.equal(ui.node('helpRetry').hidden, false);
  assert.match(ui.node('helpStatus').textContent, /could not be loaded/);
  assert.equal(ui.node('helpSupportLink').hidden, true);
  assert.equal(ui.node('helpFaqList').children.length, 2, 'Safe fallback FAQs should remain useful during a published-help outage');
  await ui.click('helpRetry');
  assert.equal(ui.node('helpRetry').hidden, true);
  assert.equal(ui.node('helpSupportLink').hidden, false);
});

test('owner editor publishes only help with loaded revision and current unlock password', async () => {
  const ui = harness(ownerSource, [response(), response(config({ Revision: 3 }))]);
  await ui.load();
  assert.equal(ui.node('ownerHelpSettings').hidden, false);
  assert.equal(ui.node('ownerHelpFields').disabled, false);
  ui.node('ownerSupportEmail').value = ' changed@example.org '; ui.input();
  await ui.submit();
  const post = JSON.parse(ui.calls[1][1].body);
  assert.deepEqual(Object.keys(post).sort(), ['ExpectedRevision', 'config', 'password']);
  assert.equal(post.ExpectedRevision, 2);
  assert.equal(post.config.SupportEmail, 'changed@example.org');
  assert.equal(post.password, 'owner-password-fixture');
  assert.match(ui.node('ownerHelpStatus').textContent, /published/);
});

test('failed initial load disables publishing instead of overwriting settings with defaults', async () => {
  const ui = harness(ownerSource, [response(config(), { unavailable: true })]);
  await ui.load(); await ui.submit();
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.node('saveOwnerHelp').disabled, true);
  assert.equal(ui.node('ownerHelpFields').disabled, true);
});

test('conflicts and failed reloads retain all owner draft fields', async () => {
  const ui = harness(ownerSource, [response(), { ok: false, status: 409, json: async () => ({ message: 'Someone updated the help settings.' }) }, new Error('offline')]);
  await ui.load();
  ui.node('ownerSupportEmail').value = 'mydraft@example.org';
  const question = ui.node('ownerHelpFaqList').children[0].querySelector('[data-faq-question]');
  question.value = 'My unsaved question'; ui.input();
  await ui.submit();
  assert.equal(ui.node('ownerSupportEmail').value, 'mydraft@example.org');
  assert.equal(question.value, 'My unsaved question');
  assert.match(ui.node('ownerHelpStatus').textContent, /draft has been kept/);
  assert.match(ui.node('ownerHelpStatus').textContent, /Reload published/);
  ui.window.confirmResult = false; await ui.click('reloadOwnerHelp');
  assert.equal(ui.calls.length, 2);
  assert.match(ui.confirms[0].message, /Discard/);
  ui.window.confirmResult = true; await ui.click('reloadOwnerHelp');
  assert.equal(ui.node('ownerSupportEmail').value, 'mydraft@example.org');
  assert.equal(question.value, 'My unsaved question');
  assert.equal(ui.node('saveOwnerHelp').disabled, false);
});

test('owner can reorder/remove FAQs without dropping unsaved text', async () => {
  const ui = harness(ownerSource); await ui.load();
  let rows = ui.node('ownerHelpFaqList').children;
  rows[0].querySelector('[data-faq-question]').value = 'Changed first question';
  rows[0].children[2].children[1].listeners.click();
  rows = ui.node('ownerHelpFaqList').children;
  assert.equal(rows[1].querySelector('[data-faq-question]').value, 'Changed first question');
  rows[0].children[2].children[2].listeners.click();
  assert.equal(ui.node('ownerHelpFaqList').children.length, 1);
  assert.equal(ui.node('ownerHelpFaqList').children[0].querySelector('[data-faq-question]').value, 'Changed first question');
  await ui.click('ownerHelpAddFaq');
  assert.equal(ui.node('ownerHelpFaqList').children.length, 2);
  await ui.submit();
  assert.equal(ui.calls.length, 1, 'Blank FAQ should not save');
  assert.match(ui.node('ownerHelpStatus').textContent, /blank row/);
});

test('owner shop rejects unsafe schemes and credentials before posting', async () => {
  const ui = harness(ownerSource); await ui.load();
  for (const url of ['http://example.org', 'javascript:alert(1)', 'https://user:password@example.org']) {
    ui.node('ownerHardwareShopUrl').value = url; await ui.submit();
  }
  assert.equal(ui.calls.length, 1);
  assert.match(ui.node('ownerHelpStatus').textContent, /HTTPS/);
});

test('owner limits align with backend and no support address is hardcoded', async () => {
  const ui = harness(ownerSource, [response(config({ Faqs: Array.from({ length: 30 }, (_, n) => ({ Question: `Question ${n}`, Answer: 'Answer' })) }))]);
  await ui.load();
  assert.equal(ui.node('ownerHelpAddFaq').disabled, true);
  await ui.click('ownerHelpAddFaq');
  assert.equal(ui.node('ownerHelpFaqList').children.length, 30);
  const row = ui.node('ownerHelpFaqList').children[0];
  assert.equal(row.querySelector('[data-faq-question]').maxLength, 180);
  assert.equal(row.querySelector('[data-faq-answer]').maxLength, 3000);
  assert.doesNotMatch(source + ownerSource + await read('products.html'), /support@dynamax\.cc/);
});

test('help owner form is separate from pricing and linked from staff, parent and public surfaces', async () => {
  const html = await read('plan-management.html');
  const pricingStart = html.indexOf('<form id="planPricingForm"');
  const pricingEnd = html.indexOf('</form>', pricingStart);
  assert.ok(pricingEnd < html.indexOf('<form id="ownerHelpForm"'));
  assert.match(html, /id="saveOwnerHelp" type="submit"/);
  assert.match(await read('js/plan-management.js'), /load\(\(\) => unlockedPassword\)/);
  for (const path of ['admin.html', 'parent-dashboard.html', 'index.html', 'products.html', 'school.html']) {
    assert.match(await read(path), /href="help\.html"/, path);
  }
});
