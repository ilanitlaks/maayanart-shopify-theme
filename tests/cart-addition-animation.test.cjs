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
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok, status: ok ? 200 : 422, json: async () => ({ items: [{ variant_id: 42, quantity: options?.method === 'POST' ? 2 : serverQuantity }], item_count: serverQuantity }) };
    },
  };
  const source = fs.readFileSync('assets/global.js', 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('function flyToCart(')), context);
  context.flyToCart = element => flights.push(element);
  context.updateCartCount = cart => counts.push(cart);
  let serverQuantity = 2;
  const quantity = { textContent: '1' }, error = { textContent: '' };
  const box = { dataset: { variantId: '42' }, parentElement: { querySelector() { return error; } }, querySelector() { return quantity; } };
  context.document.querySelectorAll = () => [box];
  const button = {};
  const runClick = async direction => {
    serverQuantity = direction === 'minus' ? 0 : 2;
    return click({
    target: { closest(selector) {
      if (selector === '.card-qty') return box;
      return selector === `.card-qty__${direction}` ? button : null;
    } }, preventDefault() {}, stopPropagation() {},
    });
  };
  return { context, runClick, events, timers, flights, counts, requests, button, quantity, error, box };
}

for (const kind of ['ordinary product', 'group child']) {
  test(`${kind}: one header event and one flight after successful addition`, async () => {
    const f = fixture();
    await f.runClick('plus');
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests.filter(request => request.options?.method === 'POST').length, 1);
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
  assert.match(f.error.textContent, /לא ניתן לעדכן את הסל/);
  assert.equal(f.counts.length, 0);
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

for (const failure of ['network', 'server', 'timeout']) {
  test(`${failure} failure leaves quantities unchanged and blocks an uncertain retry`, async () => {
    const f = fixture();
    f.context.fetch = async (url, options) => {
      f.requests.push({ url, options });
      if (failure === 'network') throw new Error('Connection lost');
      return { ok: false, status: failure === 'timeout' ? 408 : 500 };
    };
    await f.runClick('plus');
    assert.match(f.error.textContent, /לא ניתן לאמת/);
    await f.runClick('plus');
    assert.equal(f.requests.length, 1);
    assert.equal(f.quantity.textContent, '1');
    assert.equal(f.counts.length, 0);
    assert.equal(f.events.length, 0);
    assert.equal(f.timers.length, 0);
  });
}

test('successful write followed by failed verification is not submitted again', async () => {
  const f = fixture();
  f.context.fetch = async (url, options) => {
    f.requests.push({ url, options });
    if (options?.method === 'POST') return { ok: true, status: 200 };
    throw new Error('Cart read failed');
  };
  await f.runClick('plus');
  assert.match(f.error.textContent, /העדכון בסל הצליח/);
  await f.runClick('plus');
  assert.equal(f.requests.length, 2);
  assert.equal(f.quantity.textContent, '1');
  assert.equal(f.counts.length, 0);
  assert.equal(f.events.length, 0);
});

test('rapid duplicate clicks share a variant lock until verification completes', async () => {
  const f = fixture();
  const originalFetch = f.context.fetch;
  let finish;
  f.context.fetch = (url, options) => options?.method === 'POST'
    ? new Promise(resolve => { f.requests.push({ url, options }); finish = resolve; })
    : originalFetch(url, options);
  const first = f.runClick('plus');
  await f.runClick('plus');
  assert.equal(f.requests.length, 1);
  finish({ ok: true, status: 200 });
  await first;
  assert.equal(f.requests.filter(request => request.options?.method === 'POST').length, 1);
  assert.equal(f.events.length, 1);
});

test('a later successful action clears a previous rejection and uses server quantity', async () => {
  const f = fixture(false);
  await f.runClick('plus');
  assert.notEqual(f.error.textContent, '');
  f.context.fetch = async () => ({ ok: true, status: 200,
    json: async () => ({ items: [{ variant_id: 42, quantity: 7 }], item_count: 7 }) });
  await f.runClick('plus');
  assert.equal(f.error.textContent, '');
  assert.equal(f.quantity.textContent, 7);
  assert.equal(f.counts[0].item_count, 7);
  assert.equal(f.events.length, 1);
});

test('dynamically inserted duplicate cards receive verified quantity and error cleanup', async () => {
  const f = fixture();
  const otherQuantity = { textContent: '99' }, otherError = { textContent: 'Old error' };
  const other = { dataset: { variantId: '42' }, querySelector: () => otherQuantity,
    parentElement: { querySelector: () => otherError } };
  f.context.document.querySelectorAll = () => [f.box, other];
  await f.runClick('plus');
  assert.equal(otherQuantity.textContent, 2);
  assert.equal(otherError.textContent, '');
});

test('variant-card controls are ignored by the ordinary-card listener', async () => {
  const f = fixture();
  await f.runClick('variant-control');
  assert.equal(f.requests.length, 0);
  assert.equal(f.events.length, 0);
});

test('failed subtraction leaves the displayed quantity and cart bubble unchanged', async () => {
  const f = fixture(false);
  await f.runClick('minus');
  assert.equal(f.quantity.textContent, '1');
  assert.equal(f.counts.length, 0);
  assert.notEqual(f.error.textContent, '');
});
