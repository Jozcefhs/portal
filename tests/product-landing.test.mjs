import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { onRequestGet, onRequestHead } from '../functions/index.js';

const root = new URL('../', import.meta.url);

test('the company homepage is served only on the Dynamax apex and www hosts', async () => {
  for (const host of ['dynamax.cc', 'www.dynamax.cc']) {
    let assetUrl = '';
    const response = await onRequestGet({
      request: new Request(`https://${host}/`),
      env: { ASSETS: { fetch: async (request) => { assetUrl = request.url; return new Response('products'); } } },
      next: () => { throw new Error('The company host must not fall through to the suite launcher.'); }
    });
    assert.equal(response.status, 200);
    assert.equal(assetUrl, `https://${host}/products`);
  }
  let nextCalls = 0;
  const response = await onRequestGet({
    request: new Request('https://dynamaxms.pages.dev/'),
    env: { ASSETS: { fetch: () => { throw new Error('The suite host must keep its own homepage.'); } } },
    next: () => { nextCalls += 1; return new Response('suite'); }
  });
  assert.equal(await response.text(), 'suite');
  assert.equal(nextCalls, 1);
  assert.equal(onRequestHead, onRequestGet);
});

test('the compact product landing includes trademark, product menu and contact links', async () => {
  const html = await readFile(new URL('products.html', root), 'utf8');
  const routes = JSON.parse(await readFile(new URL('_routes.json', root), 'utf8'));
  assert.ok(routes.include.includes('/'));
  assert.ok(routes.include.includes('/api/*'));
  assert.match(html, /<main id="main">/);
  assert.match(html, /href="https:\/\/dynamaxms\.pages\.dev\/"/);
  assert.match(html, /href="https:\/\/vehiclepass\.dynamax\.cc\/"/);
  assert.match(html, /href="https:\/\/vendmac\.dynamax\.cc\/"/);
  assert.match(html, /Dynamax<sup class="trademark">™<\/sup>/);
  assert.doesNotMatch(html, /images\/Logo\.png/);
  assert.match(html, /href="images\/dynamax-mark\.svg"/);
  assert.match(html, /<details class="products-menu">[\s\S]*?<summary>Products/);
  assert.match(html, /<script src="js\/products\.js\?v=20261002-menu" defer><\/script>/);
  assert.match(html, /href="mailto:support@dynamax\.cc"/);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/@DynamaxVendmac"/);
  assert.match(html, /class="about-link youtube-link"/);
  assert.match(html, /class="youtube-link footer-youtube"/);
});

test('the Products menu closes outside, on selection, and when returning to the page', async () => {
  const script = await readFile(new URL('js/products.js', root), 'utf8');
  const handlers = { document: new Map(), window: new Map(), link: new Map() };
  const listen = (scope) => (name, handler) => handlers[scope].set(name, handler);
  const summary = { focusCalled: false, focus() { this.focusCalled = true; } };
  const link = { addEventListener: listen('link') };
  const inside = {};
  const outside = {};
  const menu = {
    open: false,
    contains(target) { return target === summary || target === link || target === inside; },
    querySelector() { return summary; },
    querySelectorAll() { return [link]; }
  };
  const document = {
    visibilityState: 'visible',
    querySelector() { return menu; },
    addEventListener: listen('document')
  };
  runInNewContext(script, { document, window: { addEventListener: listen('window') } });

  menu.open = true;
  handlers.document.get('click')({ target: inside });
  assert.equal(menu.open, true);
  handlers.document.get('click')({ target: outside });
  assert.equal(menu.open, false);

  menu.open = true;
  handlers.document.get('focusin')({ target: outside });
  assert.equal(menu.open, false);

  menu.open = true;
  handlers.document.get('keydown')({ key: 'Escape' });
  assert.equal(menu.open, false);
  assert.equal(summary.focusCalled, true);

  menu.open = true;
  handlers.link.get('click')();
  assert.equal(menu.open, false);

  menu.open = true;
  handlers.window.get('pagehide')();
  assert.equal(menu.open, false);
  menu.open = true;
  handlers.window.get('pageshow')();
  assert.equal(menu.open, false);

  menu.open = true;
  document.visibilityState = 'hidden';
  handlers.document.get('visibilitychange')();
  assert.equal(menu.open, false);
});
