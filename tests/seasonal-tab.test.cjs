const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  let Component;
  const listeners = new Map();
  const toggle = { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, focus() { this.focused = true; } };
  const panel = { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, contains: el => el === 'link' };
  const close = {};
  for (const element of [toggle, close]) element.addEventListener = (name, fn) => listeners.set(element === toggle ? 'link-' + name : 'close', fn);
  const document = { activeElement: null, addEventListener(name, fn, options) { listeners.set(name, fn); assert(options.signal); } };
  const window = { clearTimeout, setTimeout, scrollY: 100, innerHeight: 800, matchMedia: () => ({ matches: true }) };
  vm.runInNewContext(fs.readFileSync('assets/seasonal-tab.js', 'utf8'), {
    HTMLElement: class {}, customElements: { get() {}, define(name, value) { Component = value; } },
    window, document, AbortController,
  });
  const instance = new Component();
  instance.dataset = { section: 'promotion' };
  instance.querySelector = selector => ({ '.seasonal-tab__link': toggle, '.seasonal-tab__content': panel, '.seasonal-tab__close': close })[selector];
  instance.classList = { toggle(name, value) { instance.openClass = value; } };
  instance.addEventListener = (name, fn) => listeners.set(name, fn);
  instance.contains = el => el === toggle || el === 'link';
  instance.matches = () => false;
  instance.connectedCallback();
  return { instance, toggle, panel, listeners, document, window };
}

test('first tap opens without navigation; second activation follows the native link', () => {
  const f = fixture();
  assert.equal(f.instance.hidden, false);
  let prevented = false;
  f.listeners.get('link-click')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.instance.isOpen, true);
  assert.equal(f.toggle.attrs['aria-expanded'], 'true');
  assert.equal(f.panel.inert, false);
  prevented = false;
  f.listeners.get('link-click')({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(f.instance.isOpen, true);
  f.listeners.get('close')();
  assert.equal(f.panel.inert, true);
  assert.equal(f.panel.attrs['aria-hidden'], 'true');
  f.instance.disconnectedCallback();
});

test('hover opens only for mouse, not touch; Escape and close restore focus when needed', () => {
  const f = fixture();
  f.listeners.get('pointerenter')({ pointerType: 'touch' });
  assert.equal(f.instance.isOpen, false);
  f.listeners.get('pointerenter')({ pointerType: 'mouse' });
  assert.equal(f.instance.isOpen, true);
  f.document.activeElement = 'link';
  f.listeners.get('keydown')({ key: 'Escape' });
  assert.equal(f.instance.isOpen, false);
  assert.equal(f.toggle.focused, true);
  f.instance.setOpen(true);
  f.listeners.get('close')();
  assert.equal(f.instance.isOpen, false);
  f.instance.disconnectedCallback();
});

test('outside click closes, inside link does not intercept native navigation', () => {
  const f = fixture();
  f.instance.setOpen(true);
  f.listeners.get('pointerdown')({ target: 'link' });
  assert.equal(f.instance.isOpen, true);
  f.listeners.get('pointerdown')({ target: 'outside' });
  assert.equal(f.instance.isOpen, false);
  f.instance.disconnectedCallback();
  assert.equal(f.instance.events.signal.aborted, true);
});

test('scroll waits for half a viewport from opening before closing and restoring focus', () => {
  const f = fixture();
  f.instance.setOpen(true);
  f.document.activeElement = 'link';
  f.window.scrollY = 499;
  f.listeners.get('scroll')();
  assert.equal(f.instance.isOpen, true);
  f.instance.setOpen(true);
  f.window.scrollY = 500;
  f.listeners.get('scroll')();
  assert.equal(f.instance.isOpen, false);
  assert.equal(f.panel.inert, true);
  assert.equal(f.toggle.attrs['aria-expanded'], 'false');
  assert.equal(f.toggle.focused, true);
  f.toggle.focused = false;
  f.listeners.get('scroll')();
  assert.equal(f.toggle.focused, false);
  f.window.scrollY = 600;
  f.instance.setOpen(true);
  f.window.scrollY = 201;
  f.listeners.get('scroll')();
  assert.equal(f.instance.isOpen, true);
  f.window.scrollY = 200;
  f.listeners.get('scroll')();
  assert.equal(f.instance.isOpen, false);
  f.instance.disconnectedCallback();
});

test('Space toggles without scrolling and Escape returns focus to the shared link', () => {
  const f = fixture();
  let prevented = false;
  f.listeners.get('link-keydown')({ key: ' ', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.instance.isOpen, true);
  f.document.activeElement = f.toggle;
  f.listeners.get('keydown')({ key: 'Escape' });
  assert.equal(f.instance.isOpen, false);
  assert.equal(f.toggle.focused, true);
  f.instance.disconnectedCallback();
});

test('leaving the tab closes after delay but keyboard focus keeps it open', async () => {
  const f = fixture();
  f.instance.setOpen(true);
  f.listeners.get('pointerleave')();
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(f.instance.isOpen, false);
  f.instance.setOpen(true);
  f.document.activeElement = 'link';
  f.listeners.get('pointerleave')();
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(f.instance.isOpen, true);
  f.instance.disconnectedCallback();
});

test('Liquid keeps content editable, escapes text, and hides incomplete/disabled campaigns', () => {
  const { Liquid } = require(require.resolve('liquidjs', { paths: [process.cwd(), path.join(process.env.APPDATA || '', 'npm/node_modules/@shopify/theme')] }));
  const engine = new Liquid();
  const source = fs.readFileSync('sections/seasonal-tab.liquid', 'utf8');
  const markup = source.split('{% schema %}')[0];
  for (const name of ['asset_url', 'stylesheet_tag', 'image_url', 'image_tag']) engine.registerFilter(name, value => value);
  const settings = { show_promotion: true, image: 'test.png', heading: '<script>alert(1)</script>', link: '/collections/test', vertical_position: 45 };
  const render = changes => engine.parseAndRenderSync(markup, { section: { id: 'promo', settings: { ...settings, ...changes } }, request: {} });
  assert.match(render(), /aria-controls="SeasonalContent-promo"/);
  assert.match(render(), /href="\/collections\/test"/);
  assert.match(render(), /&lt;script&gt;/);
  assert.match(render(), /גלו עוד/);
  assert.match(render({ peek_label: '<עוד>' }), /&lt;עוד&gt;/);
  for (const changes of [{ show_promotion: false }, { image: '' }, { link: '' }]) assert.doesNotMatch(render(changes), /<seasonal-tab/);
  const schema = JSON.parse(source.split('{% schema %}')[1].split('{% endschema %}')[0]);
  assert.deepEqual(schema.enabled_on.templates, ['index']);
  assert.equal(schema.limit, 1);
  for (const key of ['image', 'heading', 'peek_label', 'link', 'text', 'show_promotion']) assert(schema.settings.some(setting => setting.id === key));
});
