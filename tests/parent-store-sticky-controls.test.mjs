import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const [source, html, css, shell] = await Promise.all([
  'js/parent-store-layout.js', 'parent-dashboard.html', 'css/parent-store.css', 'sw.js'
].map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));

function layout({ mobile = true, controlsHeight = 190, navigationHeight = 66, observer = true, missing = '' } = {}) {
  const properties = new Map();
  const listeners = new Map();
  const observed = [];
  const dimensions = { mobile, controlsHeight, navigationHeight };
  let resize;
  const controls = { getBoundingClientRect: () => ({ height: dimensions.controlsHeight }) };
  const navigation = { getBoundingClientRect: () => ({ height: dimensions.navigationHeight }) };
  const store = {
    style: { setProperty: (key, value) => properties.set(key, value) },
    querySelector: () => missing === 'controls' ? null : controls
  };
  const context = {
    document: {
      querySelector: () => missing === 'store' ? null : store,
      getElementById: () => missing === 'navigation' ? null : navigation
    },
    window: {
      matchMedia: (query) => {
        assert.equal(query, '(max-width: 680px)');
        return { matches: dimensions.mobile };
      },
      addEventListener: (name, callback) => listeners.set(name, callback)
    }
  };
  if (observer) context.ResizeObserver = class {
    constructor(callback) { resize = callback; }
    observe(element) { observed.push(element); }
  };
  vm.runInNewContext(source, context);
  return { properties, listeners, observed, dimensions, store, controls, navigation, resize: () => resize?.() };
}

test('the heading, cart shortcut, search and filters share one sticky container', () => {
  const [, bar] = html.match(/<div class="parent-store-controls">([\s\S]*?)<\/div>\s*<div class="parent-store-layout">/) || [];
  assert.ok(bar, 'Store controls must precede the scrolling catalog/cart layout');
  for (const id of ['storeCartShortcut', 'storeSearch', 'storeTypeFilter', 'storeCategoryFilter', 'storeSort']) {
    assert.match(bar, new RegExp(`id="${id}"`));
  }
  assert.match(bar, /<h2>School Store<\/h2>/);
  assert.doesNotMatch(bar, /id="storeCartPanel"|id="schoolStores"/);
  assert.match(css, /\.parent-store-controls\s*\{[^}]*position: sticky;[^}]*top: var\(--store-sticky-top\);[^}]*z-index: 19;[^}]*background: var\(--store-surface\)/);
  assert.match(css, /html\[data-theme="dark"\] \.parent-store\s*\{[^}]*--store-surface: #111e2e/);
});

test('phones keep controls at the top, without reserving the bottom navigation height', () => {
  const state = layout({ controlsHeight: 192.4 });
  assert.equal(state.properties.get('--store-sticky-top'), '0px');
  assert.equal(state.properties.get('--store-controls-height'), '193px');
  assert.deepEqual(state.observed, [state.controls, state.navigation]);
});

test('wider screens place controls below the measured top navigation', () => {
  const state = layout({ mobile: false, navigationHeight: 67.2, controlsHeight: 104.3 });
  assert.equal(state.properties.get('--store-sticky-top'), '68px');
  assert.equal(state.properties.get('--store-controls-height'), '105px');
});

test('showing a hidden store panel measures the bar without replacing its size with zero', () => {
  const state = layout({ controlsHeight: 0 });
  assert.equal(state.properties.has('--store-controls-height'), false);
  state.dimensions.controlsHeight = 214;
  state.resize();
  assert.equal(state.properties.get('--store-controls-height'), '214px');
  state.dimensions.controlsHeight = 0;
  state.resize();
  assert.equal(state.properties.get('--store-controls-height'), '214px');
});

test('rotation, navigation wrapping and font resizing recompute both offsets', () => {
  const state = layout();
  state.dimensions.mobile = false;
  state.dimensions.navigationHeight = 92;
  state.dimensions.controlsHeight = 168;
  state.listeners.get('resize')();
  assert.equal(state.properties.get('--store-sticky-top'), '92px');
  assert.equal(state.properties.get('--store-controls-height'), '168px');
  state.dimensions.controlsHeight = 224;
  state.resize();
  assert.equal(state.properties.get('--store-controls-height'), '224px');
});

test('window resize remains a fallback when ResizeObserver is unavailable', () => {
  const state = layout({ observer: false });
  assert.equal(state.observed.length, 0);
  state.dimensions.controlsHeight = 207;
  state.listeners.get('resize')();
  assert.equal(state.properties.get('--store-controls-height'), '207px');
});

test('missing controls or store are safe and a missing navigation gives a zero offset', () => {
  for (const missing of ['store', 'controls']) {
    const state = layout({ missing });
    assert.equal(state.properties.size, 0);
    assert.equal(state.listeners.size, 0);
  }
  const state = layout({ missing: 'navigation', mobile: false });
  assert.equal(state.properties.get('--store-sticky-top'), '0px');
  assert.deepEqual(state.observed, [state.controls]);
});

test('cart and page scroll targets clear the sticky bar, while the phone cart still scrolls normally', () => {
  const offset = 'calc(var(--store-sticky-top) + var(--store-controls-height) + 12px)';
  for (const selector of ['.parent-store-grid', '.parent-store .store-cart-panel']) {
    const rule = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    assert.ok(rule.includes(`scroll-margin-top: ${offset}`));
  }
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.parent-store \.store-cart-panel\s*\{[^}]*position: static/);
});

test('cache-busted layout assets are loaded and included in the new offline shell', () => {
  assert.match(html, /js\/parent-store-layout\.js\?v=20261008-sticky-controls" defer/);
  assert.match(shell, /dynamax-v355-wat-timestamps/);
  assert.match(shell, /SHELL\.push\('\/js\/parent-store-layout\.js'\)/);
});
