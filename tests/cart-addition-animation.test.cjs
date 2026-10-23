const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture(ok = true) {
  const events = [], timers = [], flights = [], counts = [], requests = [];
  let click;
  const context = {
    document: {
      addEventListener(name, handler) { if (name === 'click') click = handler; },
      dispatchEvent(event) { events.push(event.type); },
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok }; },
  };
  const source = fs.readFileSync('assets/global.js', 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('function flyToCart(')), context);
  context.flyToCart = element => flights.push(element);
  context.updateCartCount = cart => counts.push(cart);
  const quantity = { textContent: '1' };
  const box = { dataset: { variantId: '42' }, querySelector() { return quantity; } };
  const button = {};
  const runClick = async direction => click({
    target: { closest(selector) {
      if (selector === '.card-qty') return box;
      return selector === `.card-qty__${direction}` ? button : null;
    } }, preventDefault() {}, stopPropagation() {},
  });
  return { context, runClick, events, timers, flights, counts, requests, button, quantity };
}

for (const kind of ['ordinary product', 'group child']) {
  test(`${kind}: one header event and one flight after successful addition`, async () => {
    const f = fixture();
    await f.runClick('plus');
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.events, ['cart:action']);
    assert.equal(f.counts.length, 1);
    assert.equal(f.quantity.textContent, 2);
    assert.equal(f.timers.length, 1);
    assert.equal(f.timers[0].delay, 150);
    f.timers[0].callback();
    assert.deepEqual(f.flights, [f.button]);
  });
}

test('Shopify rejection produces no header event or animation', async () => {
  const f = fixture(false);
  await f.runClick('plus');
  assert.equal(f.events.length, 0);
  assert.equal(f.timers.length, 0);
  assert.equal(f.quantity.textContent, '1');
});

test('subtraction retains cart count update without addition animation', async () => {
  const f = fixture();
  await f.runClick('minus');
  assert.equal(f.events.length, 0);
  assert.equal(f.timers.length, 0);
  assert.equal(f.counts.length, 1);
  assert.equal(f.quantity.textContent, 0);
});

test('shared helper accepts confirmed variant cart without another cart fetch', () => {
  const f = fixture();
  const cart = { item_count: 3 };
  f.context.animateCartAddition(f.button, cart);
  assert.deepEqual(f.events, ['cart:action']);
  assert.equal(f.counts[0], cart);
  assert.equal(f.requests.length, 0);
  assert.equal(f.timers.length, 1);
  f.timers[0].callback();
  assert.equal(f.flights.length, 1);
});
