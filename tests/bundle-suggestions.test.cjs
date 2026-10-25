const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const bundle = (id = 24, changes = {}) => ({
  id: `gid://shopify/ProductVariant/${id}`, title: 'Default Title', availableForSale: true,
  requiresComponents: true, price: { amount: '67.90', currencyCode: 'ILS' },
  image: { url: 'https://cdn.shopify.com/bundle.jpg' },
  product: { id: `gid://shopify/Product/${id}`, title: 'מארז נרות', availableForSale: true,
    requiresSellingPlan: false, onlineStoreUrl: 'https://maayanart.com/products/bundle' }, ...changes,
});
const page = (nodes = [], more = false, cursor = null, changes = {}) => ({ data: { node: {
  requiresComponents: false,
  product: { id: 'gid://shopify/Product/1', variants: { nodes: [{ requiresComponents: false }] } },
  groupedBy: { nodes, pageInfo: { hasNextPage: more, endCursor: cursor } }, ...changes,
} } });

function fixture(responses) {
  let Component;
  const calls = [];
  const events = {};
  const element = () => ({ children: [], append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; } });
  const context = {
    HTMLElement: class {}, customElements: { get() {}, define(name, value) { Component = value; } },
    AbortController, URL, Intl, Map, Set,
    window: { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} },
    document: { readyState: 'loading', createElement: element, createDocumentFragment: element },
    PUB_SUB_EVENTS: { optionValueSelectionChange: 'selection', variantChange: 'variant' },
    subscribe(name, callback) { events[name] = callback; return () => { delete events[name]; }; },
    async fetch(url, options) {
      calls.push({ url, ...options, body: JSON.parse(options.body) });
      const result = responses.shift();
      if (result instanceof Error) throw result;
      return { ok: true, json: async () => typeof result === 'function' ? result() : result };
    },
  };
  vm.runInNewContext(fs.readFileSync('assets/bundle-suggestions.js', 'utf8'), context);
  const component = new Component();
  component.dataset = { section: 'main', variantId: '10', productId: '1', country: 'IL', locale: 'he', currency: 'ILS', root: '/he/' };
  const list = element();
  component.querySelector = () => list;
  component.closest = () => ({ contains: () => true, addEventListener() {}, removeEventListener() {} });
  component.connectedCallback();
  return { component, calls, list, events };
}

test('paginates, deduplicates and renders safe localized variant links and live prices', async () => {
  const f = fixture([page([bundle()], true, 'next'), page([bundle(), bundle(48)])]);
  await f.component.load('10');
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].body.variables.after, 'next');
  assert.equal(f.calls[0].body.variables.id, 'gid://shopify/ProductVariant/10');
  assert.equal(f.calls[0].url, '/api/2026-10/graphql.json');
  assert.equal(f.component.hidden, false);
  const cards = f.list.children[0].children;
  assert.equal(cards.length, 2);
  const link = cards[0].children[0];
  assert.equal(link.href, '/he/products/bundle?variant=24');
  assert.match(link.children[1].children[1].textContent, /67\.90/);
  assert.equal(link.children[0].loading, 'lazy');
  f.component.disconnectedCallback();
});

test('filters sold-out, unpublished, subscription and wrong-currency suggestions', async () => {
  const unpublished = bundle(); unpublished.product.onlineStoreUrl = null;
  const subscription = bundle(); subscription.product.requiresSellingPlan = true;
  const f = fixture([page([bundle(24, { availableForSale: false }), unpublished, subscription,
    bundle(48, { price: { amount: '10', currencyCode: 'USD' } })])]);
  await f.component.load('10');
  assert.equal(f.component.hidden, true);
});

for (const [name, response] of [
  ['no bundles', page()], ['network failure', new Error('offline')],
  ['GraphQL failure', { errors: [{ message: 'Denied' }] }],
  ['bundle variant', page([bundle()], false, null, { requiresComponents: true })],
  ['bundle product', page([bundle()], false, null, { product: {
    id: 'gid://shopify/Product/1', variants: { nodes: [{ requiresComponents: true }] },
  } })],
]) test(`stays hidden: ${name}`, async () => {
  const f = fixture([response]);
  await f.component.load('10');
  assert.equal(f.component.hidden, true);
  assert.equal(f.list.children.length, 0);
});

test('ignores stale responses after rapid variant switching', async () => {
  let resolve;
  const f = fixture([() => new Promise(r => { resolve = r; }), page([bundle(48)])]);
  const first = f.component.load('10');
  await new Promise(r => setImmediate(r));
  await f.component.load('11');
  resolve(page([bundle(24)]));
  await first;
  assert.match(f.list.children[0].children[0].children[0].href, /variant=48/);
  assert.equal(f.calls[0].signal.aborted, true);
});

test('hides stale suggestions as soon as selection begins and scopes variant events', async () => {
  const f = fixture([page([bundle()]), page([bundle(48)])]);
  await f.component.load('10');
  f.events.selection({ data: { event: { target: {} } } });
  assert.equal(f.component.hidden, true);
  f.events.variant({ data: { sectionId: 'other', variant: { id: 11 } } });
  assert.equal(f.calls.length, 1);
  await f.component.onVariant({ data: { sectionId: 'main', variant: { id: 11 } } });
  await new Promise(r => setImmediate(r));
  assert.equal(f.component.hidden, false);
  f.component.disconnectedCallback();
  assert.equal(Object.keys(f.events).length, 0);
});

test('a broken later page hides the entire component, and invalid cursors cannot loop', async () => {
  for (const responses of [[page([bundle()], true, 'next'), new Error('offline')],
    [page([bundle()], true, 'same'), page([bundle()], true, 'same')]]) {
    const f = fixture(responses);
    await f.component.load('10');
    assert.equal(f.component.hidden, true);
    assert.equal(f.calls.length, 2);
  }
});

test('untrusted URLs are rejected and product titles are rendered as text', async () => {
  const malicious = bundle();
  malicious.product.title = '<img src=x onerror=alert(1)>';
  const f = fixture([page([malicious])]);
  await f.component.load('10');
  const link = f.list.children[0].children[0].children[0];
  assert.equal(link.children[1].children[0].textContent, malicious.product.title);
  assert.equal(f.component.bundleUrl(bundle(24, { product: { onlineStoreUrl: 'javascript:alert(1)' } })), null);
  assert.equal(f.calls.every(call => call.url === '/api/2026-10/graphql.json'), true);
});

test('Liquid renders an initially hidden, accessible component without purchase controls', () => {
  const path = require('node:path');
  const { Liquid } = require(require.resolve('liquidjs', { paths: [process.cwd(),
    path.join(process.env.APPDATA || '', 'npm/node_modules/@shopify/theme')] }));
  const liquid = new Liquid({ root: 'snippets', extname: '.liquid' });
  for (const name of ['asset_url', 'stylesheet_tag']) liquid.registerFilter(name, value => value);
  const html = liquid.renderFileSync('bundle-suggestions', { product: {
    id: 1, selected_or_first_available_variant: { id: 10 },
  }, section_id: 'main', localization: { country: { iso_code: 'IL' } },
  request: { locale: { iso_code: 'he' } }, cart: { currency: { iso_code: 'ILS' } }, routes: { root_url: '/' } });
  assert.match(html, /<bundle-suggestions\s+hidden/);
  assert.match(html, /aria-labelledby="BundleSuggestions-main"/);
  assert.match(html, /data-variant-id="10"/);
  assert.match(html, /dir="rtl"/);
  assert.doesNotMatch(html, /<form|<button|name="id"/);
});
