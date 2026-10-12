import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const root = new URL('../', import.meta.url);
const script = await readFile(new URL('js/school-menu.js', root), 'utf8');

function setup() {
  const handlers = { document: new Map(), window: new Map(), link: new Map(), media: new Map() };
  const listen = (scope) => (type, handler) => handlers[scope].set(type, handler);
  const summary = { focusCalled: false, focus() { this.focusCalled = true; } };
  const link = { addEventListener: listen('link') };
  const inside = {};
  const outside = {};
  const menu = {
    open: false,
    contains(target) { return [this, summary, link, inside].includes(target); },
    querySelector() { return summary; },
    querySelectorAll() { return [link]; }
  };
  const document = {
    visibilityState: 'visible',
    querySelector() { return menu; },
    addEventListener: listen('document')
  };
  const window = {
    addEventListener: listen('window'),
    matchMedia(query) {
      assert.equal(query, '(max-width: 620px)');
      return { addEventListener: listen('media') };
    }
  };
  runInNewContext(script, { document, window });
  return { handlers, menu, summary, link, inside, outside, document };
}

test('School landing loads the menu behavior and explicitly hides the closed panel', async () => {
  const [html, css, worker] = await Promise.all(['school.html', 'css/school-landing.css', 'sw.js'].map((path) => readFile(new URL(path, root), 'utf8')));
  assert.match(html, /src="js\/school-menu\.js\?v=20261012-menu-dismissal" defer/);
  assert.match(html, /css\/school-landing\.css\?v=20261012-menu-dismissal/);
  assert.match(html, /<summary aria-label="Portal navigation menu">/);
  assert.match(css, /\.landing-mobile-menu:not\(\[open\]\) \.landing-mobile-menu-panel\s*\{\s*display: none;/);
  assert.match(worker, /SHELL\.push\('\/js\/school-menu\.js'\)/);
});

test('outside clicks and focus dismiss the menu without interfering with native summary toggling', () => {
  const { handlers, menu, summary, inside, outside } = setup();
  for (const type of ['click', 'focusin']) {
    menu.open = true;
    handlers.document.get(type)({ target: inside });
    assert.equal(menu.open, true);
    handlers.document.get(type)({ target: summary });
    assert.equal(menu.open, true);
    handlers.document.get(type)({ target: outside });
    assert.equal(menu.open, false);
    handlers.document.get(type)({ target: summary });
    assert.equal(menu.open, false);
  }
});

test('Escape closes the menu and restores summary focus only when it was open', () => {
  const { handlers, menu, summary } = setup();
  handlers.document.get('keydown')({ key: 'Escape' });
  assert.equal(summary.focusCalled, false);
  menu.open = true;
  handlers.document.get('keydown')({ key: 'Enter' });
  assert.equal(menu.open, true);
  handlers.document.get('keydown')({ key: 'Escape' });
  assert.equal(menu.open, false);
  assert.equal(summary.focusCalled, true);
});

test('navigation, history restoration, tab hiding and layout changes close the menu', () => {
  const { handlers, menu, document } = setup();
  for (const handler of [handlers.link.get('click'), handlers.window.get('pagehide'), handlers.window.get('pageshow'), handlers.media.get('change')]) {
    menu.open = true;
    handler();
    assert.equal(menu.open, false);
  }
  menu.open = true;
  handlers.document.get('visibilitychange')();
  assert.equal(menu.open, true);
  document.visibilityState = 'hidden';
  handlers.document.get('visibilitychange')();
  assert.equal(menu.open, false);
});

test('menu script safely does nothing on a page without the mobile menu', () => {
  assert.doesNotThrow(() => runInNewContext(script, { document: { querySelector: () => null } }));
});
