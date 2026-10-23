const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
// Reuse the Liquid renderer shipped with Shopify CLI; no runtime theme dependency.
const { Liquid } = require(require.resolve('liquidjs', { paths: [process.cwd(), path.join(process.env.APPDATA || '', 'npm/node_modules/@shopify/theme')] }));
const liquid = new Liquid({ root: 'snippets', extname: '.liquid' });
for (const name of ['asset_url', 'stylesheet_tag', 'inline_asset_content', 'placeholder_svg_tag']) liquid.registerFilter(name, value => value);
liquid.registerFilter('money', value => `${(Number(value) / 100).toFixed(2)} ILS`);
liquid.registerFilter('money_with_currency', value => `${(Number(value) / 100).toFixed(2)} ILS`);
liquid.registerFilter('t', value => value);
liquid.registerFilter('item_count_for_variant', (cart, id) => (cart.items || []).filter(item => item.variant_id === id).reduce((sum, item) => sum + item.quantity, 0));
const product = overrides => ({ id: 1, handle: 'ordinary', title: 'Product', price: 1000, price_min: 1000, price_max: 2000,
  available: true, variants_count: 2, variants: [], media: [{ media_type: 'image', id: 1 }], tags: [], collections: [], selling_plan_groups: [], ...overrides });
const eligible = value => liquid.renderFileSync('variant-cards-enabled', { product: value }).trim() === 'true';

for (const [name, changes, expected] of [
  ['single variant', { variants_count: 1 }, false],
  ['multiple variants without a selected pilot', {}, true],
  ['group parent', { tags: ['group:hair'], price: 0 }, false],
  ['group child', { tags: [' GROUP:hair '] }, false],
  ['subscription', { selling_plan_groups: [{ id: 1 }] }, false],
  ['gift card', { 'gift_card?': true }, false],
  ['legacy parent with linked children', { price: 0, metafields: { custom: { child_products: { value: [{ id: 2 }] } } } }, false],
  ['ordinary free variant', { price: 0 }, true],
  ['sold out product', { available: false }, true],
  ['250 variants', { variants_count: 250 }, true],
  ['251 variants', { variants_count: 251 }, false],
  ['tiered quantity pricing', { 'quantity_price_breaks_configured?': true }, false],
  ['no media', { media: [] }, false],
  ['video only', { media: [{ media_type: 'video' }] }, false],
  ['video followed by image', { media: [{ media_type: 'video' }, { media_type: 'image' }] }, true],
]) test(`eligibility: ${name}`, () => assert.equal(eligible(product(changes)), expected));

test('actual card rendering preserves single-variant quantity buttons and group parent links', () => {
  const render = changes => liquid.renderFileSync('card-product', { card_product: product(changes), settings: { card_style: 'standard' }, cart: { items: [] } });
  const multiple = render({});
  assert.match(multiple, /class="card-options-btn">לכל האפשרויות/);
  assert.doesNotMatch(multiple, /class="card-qty__btn/);
  const single = render({ variants_count: 1, selected_or_first_available_variant: { id: 42 } });
  assert.match(single, /data-variant-id="42"/);
  assert.match(single, /card-qty__plus/);
  const parent = render({ price: 0, tags: ['group:hair'] });
  assert.match(parent, /card-options-btn/);
  const child = render({ tags: ['group:hair'], variants_count: 1, selected_or_first_available_variant: { id: 99 } });
  assert.match(child, /data-variant-id="99"/);
});

test('variant cards render distinct prices, correct IDs, existing cart counts and sold-out controls', () => {
  const html = liquid.renderFileSync('variant-cards', { product: product({ variants: [
    { id: 11, title: 'White', price: 1000, available: true, quantity_rule: { min: 1, increment: 1 } },
    { id: 22, title: 'Black', price: 2000, available: false, quantity_rule: { min: 1, increment: 1 } },
    { id: 33, title: 'Free', price: 0, available: true, quantity_rule: { min: 1, increment: 1 } },
  ] }), settings: { card_style: 'standard' }, cart: { items: [{ variant_id: 11, quantity: 2 }] } });
  assert.match(html, /10\.00 ILS/);
  assert.match(html, /20\.00 ILS/);
  assert.match(html, /0\.00 ILS/);
  assert.doesNotMatch(html, /parent-product-children/);
  assert.match(html, /data-quantity>2</);
  const soldOutCard = html.slice(html.indexOf('data-variant-id="22"'), html.indexOf('data-variant-id="33"'));
  assert.match(soldOutCard, /data-delta="1"[^>]*disabled/);
  assert.match(soldOutCard, /אזל המלאי/);
});

test('collection and homepage tabs share the same product-card renderer', () => {
  for (const file of ['sections/main-collection-product-grid.liquid', 'sections/featured-collections-tabs.liquid']) {
    assert.match(fs.readFileSync(file, 'utf8'), /render 'card-product'/);
  }
  assert.ok(!fs.readFileSync('config/settings_schema.json', 'utf8').includes('variant_cards_pilot'));
});
