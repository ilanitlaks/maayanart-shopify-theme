const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture(items = [], fail = false) {
  let Component;
  const animations = [];
  const cartIcon = { innerHTML: '', querySelector() { return null; } };
  const context = { HTMLElement: class {}, customElements: { get() {}, define(name, value) { Component = value; } },
    animateCartAddition(button, cart) { animations.push({ button, cart }); },
    window: { location: { pathname: '/products/pilot' } },
    DOMParser: class { parseFromString(html) { return { querySelector() { return { innerHTML: html }; } }; } },
    document: { querySelector() { return null; }, getElementById(id) { return id === 'cart-icon-bubble' ? cartIcon : null; } } };
  vm.runInNewContext(fs.readFileSync('assets/variant-cards.js', 'utf8'), context);
  const instance = new Component();
  const status = { textContent: '' }, error = { textContent: '' };
  const minus = { disabled: false }, plus = { disabled: false }, quantity = { textContent: '0' };
  const card = { dataset: { variantId: '12345', min: '1', step: '1', max: '' }, querySelector(selector) {
    return ({ '[data-quantity]': quantity, '[data-delta="-1"]': minus, '[data-delta="1"]': plus,
      '[data-available]': { dataset: { available: 'true' } }, '[data-error]': error, h3: { textContent: 'אדום' } })[selector];
  } };
  instance.querySelector = selector => selector === '[data-error]' ? error : status;
  const otherError = { textContent: '' };
  instance.querySelectorAll = selector => selector === 'button' ? [minus, plus] : selector === '[data-error]' ? [error, otherError] : [card];
  instance.setAttribute = instance.removeAttribute = () => {};
  const calls = [];
  const reads = [];
  instance.request = async (path, body) => {
    if (path === 'cart.js') { reads.push(path); return { items, item_count: items.reduce((n, item) => n + item.quantity, 0) }; }
    calls.push({ path, body });
    if (fail) { const error = new Error('אזל המלאי'); error.cartRejected = true; throw error; }
    items = body.items ? [{ variant_id: 12345, key: 'line-key', quantity: body.items[0].quantity }] :
      items.map(item => ({ ...item, quantity: body.quantity }));
    const result = { sections: { 'cart-icon-bubble': `cart count: ${items.reduce((n, item) => n + item.quantity, 0)}` } };
    if (path === 'cart/change.js') Object.assign(result, { items, item_count: items.reduce((n, item) => n + item.quantity, 0) });
    return result;
  };
  const click = async delta => {
    const button = delta > 0 ? plus : minus;
    button.dataset = { delta: String(delta) };
    button.closest = () => card;
    button.focus = () => {};
    await instance.handleClick({ target: { closest: () => button } });
  };
  return { click, calls, reads, quantity, error, otherError, status, instance, cartIcon, animations, plus, minus };
}

test('adds the variant ID, then increments the existing line key', async () => {
  const f = fixture();
  await f.click(1);
  assert.equal(f.calls[0].body.items[0].id, '12345');
  assert.equal(f.quantity.textContent, 1);
  assert.equal(f.cartIcon.innerHTML, 'cart count: 1');
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].cart.item_count, 1);
  await f.click(1);
  assert.equal(f.calls[1].body.id, 'line-key');
  assert.equal(f.calls[1].body.quantity, 2);
  await f.click(-1);
  await f.click(-1);
  assert.equal(f.calls[3].body.quantity, 0);
  assert.equal(f.quantity.textContent, 0);
  assert.equal(f.cartIcon.innerHTML, 'cart count: 0');
  assert.equal(f.animations.length, 2); // Both additions, neither subtraction.
});
test('inventory rejection preserves the confirmed cart quantity and displays an error', async () => {
  const f = fixture([], true);
  await f.click(1);
  assert.equal(f.quantity.textContent, 0);
  assert.equal(f.error.textContent, 'אזל המלאי');
  assert.equal(f.instance.busy, false);
  assert.equal(f.animations.length, 0);
});
test('personalized lines are not silently merged or overwritten', async () => {
  const f = fixture([{ variant_id: 12345, key: 'custom-key', quantity: 2, properties: { name: 'test' } }]);
  await f.click(1);
  assert.equal(f.calls.length, 0);
  assert.match(f.error.textContent, /התאמה אישית/);
});

test('new actions clear previous success and all old errors before requesting the cart', async () => {
  const f = fixture();
  f.status.textContent = 'old success';
  f.error.textContent = 'old error';
  f.otherError.textContent = 'another old error';
  const request = f.instance.request;
  f.instance.request = async (...args) => {
    if (f.calls.length === 0) {
      assert.equal(f.status.textContent, '');
      assert.equal(f.error.textContent, '');
      assert.equal(f.otherError.textContent, '');
    }
    return request(...args);
  };
  await f.click(1);
  assert.match(f.status.textContent, /כמות 1/);
  assert.equal(f.error.textContent, '');
  await f.click(-1);
  assert.equal(f.quantity.textContent, 0);
  assert.match(f.status.textContent, /כמות 0/);
});

test('failure is local to the affected card and does not leave a success announcement', async () => {
  const f = fixture([], true);
  f.status.textContent = 'old success';
  await f.click(1);
  assert.equal(f.status.textContent, '');
  assert.equal(f.error.textContent, 'אזל המלאי');
  assert.equal(f.otherError.textContent, '');
});

test('success announcements are visually hidden and errors belong to each card', () => {
  const template = fs.readFileSync('snippets/variant-cards.liquid', 'utf8');
  assert.match(template, /<p class="visually-hidden" data-status role="status" aria-live="polite"/);
  assert.ok(template.indexOf('data-error role="alert"') < template.indexOf('</article>'));
});

test('successful add with a failed verification recovers without another mutation', async () => {
  const f = fixture();
  const request = f.instance.request;
  let reads = 0;
  f.instance.request = async (...args) => {
    if (args[0] === 'cart.js' && ++reads === 2) throw new Error('refresh failed');
    return request(...args);
  };
  await f.click(1);
  assert.equal(f.calls.length, 1);
  assert.equal(reads, 3);
  assert.equal(f.quantity.textContent, 1);
  assert.equal(f.cartIcon.innerHTML, 'cart count: 1');
  assert.equal(f.error.textContent, '');
  assert.equal(f.animations.length, 1);
  assert.equal(f.plus.disabled, false);
});

test('persistent verification failure reports confirmed success and blocks uncertain further mutations', async () => {
  const f = fixture();
  const request = f.instance.request;
  let reads = 0;
  f.instance.request = async (...args) => {
    if (args[0] === 'cart.js' && ++reads > 1) throw new Error('refresh failed');
    return request(...args);
  };
  await f.click(1);
  assert.equal(f.calls.length, 1);
  assert.match(f.error.textContent, /העדכון בסל הצליח/);
  assert.equal(f.animations.length, 0);
  assert.equal(f.plus.disabled, true);
  await f.click(1);
  assert.equal(f.calls.length, 1);
});

test('a lost mutation response is treated as uncertain, never retried automatically', async () => {
  const f = fixture();
  const request = f.instance.request;
  f.instance.request = async (...args) => {
    const result = await request(...args);
    if (args[0] === 'cart/add.js') throw new Error('response lost');
    return result;
  };
  await f.click(1);
  assert.equal(f.calls.length, 1);
  assert.match(f.error.textContent, /לא ניתן לאמת אם הסל עודכן/);
  assert.equal(f.plus.disabled, true);
  assert.equal(f.animations.length, 0);
});

test('normal additions use two cart reads, changes use just the preflight read', async () => {
  const f = fixture();
  await f.click(1);
  assert.equal(f.reads.length, 2);
  await f.click(1);
  assert.equal(f.reads.length, 3);
  await f.click(-1);
  assert.equal(f.reads.length, 4);
  assert.equal(f.quantity.textContent, 1);
  assert.equal(f.cartIcon.innerHTML, 'cart count: 1');
  assert.equal(f.animations.length, 2);
});

test('a later successful verification clears the warning and animates exactly once', async () => {
  const f = fixture();
  const request = f.instance.request;
  let reads = 0;
  f.instance.request = async (...args) => {
    if (args[0] === 'cart.js' && ++reads > 1) throw new Error('refresh failed');
    return request(...args);
  };
  await f.click(1);
  assert.match(f.error.textContent, /העדכון בסל הצליח/);
  f.instance.request = request;
  await f.instance.refresh();
  assert.equal(f.error.textContent, '');
  assert.equal(f.quantity.textContent, 1);
  assert.equal(f.animations.length, 1);
  await f.instance.refresh();
  assert.equal(f.animations.length, 1);
  assert.equal(f.calls.length, 1);
});
