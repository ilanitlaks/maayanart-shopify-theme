if (!customElements.get('bundle-suggestions')) {
  customElements.define('bundle-suggestions', class extends HTMLElement {
    connectedCallback() {
      this.active = true;
      this.version = 0;
      this.owner = this.closest('product-info');
      this.list = this.querySelector('ul');
      this.onSelection = ({ data }) => {
        if (this.owner?.contains(data?.event?.target)) this.cancel();
      };
      this.onVariant = ({ data }) => {
        if (String(data?.sectionId) === this.dataset.section) {
          this.dataset.variantId = String(data.variant?.id || '');
          this.load(data.variant?.id);
        }
      };
      if (typeof subscribe === 'function') {
        this.unsubscribeSelection = subscribe(PUB_SUB_EVENTS.optionValueSelectionChange, this.onSelection);
        this.unsubscribeVariant = subscribe(PUB_SUB_EVENTS.variantChange, this.onVariant);
      }
      // A form-input change is also emitted by Dawn before its variantChange event.
      this.onChange = (event) => {
        if (event.target.matches('input[name="id"]')) {
          this.dataset.variantId = event.target.value;
          this.load(event.target.value);
        }
      };
      this.owner?.addEventListener('change', this.onChange);
      this.start = () => {
        this.idle = window.setTimeout(() => this.load(this.dataset.variantId), 0);
      };
      if (document.readyState === 'complete') this.start();
      else window.addEventListener('load', this.start, { once: true });
    }

    disconnectedCallback() {
      this.active = false;
      this.cancel();
      window.clearTimeout(this.idle);
      window.removeEventListener('load', this.start);
      this.unsubscribeSelection?.();
      this.unsubscribeVariant?.();
      this.owner?.removeEventListener('change', this.onChange);
    }

    cancel() {
      this.version++;
      this.controller?.abort();
      this.loadingId = null;
      this.hidden = true;
      this.list.replaceChildren();
    }

    async load(id) {
      if (!this.active || (id && this.loadingId === String(id))) return;
      this.cancel();
      if (!/^\d+$/.test(String(id || ''))) return;
      this.loadingId = String(id);
      const version = this.version;
      this.controller = new AbortController();
      const signal = this.controller.signal;
      const controller = this.controller;
      const timeout = window.setTimeout(() => controller.abort(), 15000);
      const query = `query BundleSuggestions($id: ID!, $after: String, $country: CountryCode!)
        @inContext(country: $country) {
          node(id: $id) { ... on ProductVariant {
            requiresComponents
            product { id variants(first: 1) { nodes { requiresComponents } } }
            groupedBy(first: 12, after: $after) {
              nodes { id title availableForSale requiresComponents price { amount currencyCode }
                image { url altText }
                product { id title onlineStoreUrl availableForSale requiresSellingPlan }
              }
              pageInfo { hasNextPage endCursor }
            }
          } }
        }`;
      try {
        const bundles = new Map();
        const cursors = new Set();
        let after = null;
        do {
          const response = await fetch('/api/2026-10/graphql.json', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
            body: JSON.stringify({ query, variables: {
              id: `gid://shopify/ProductVariant/${id}`, after, country: this.dataset.country,
            } }),
          });
          if (!response.ok) throw new Error('Bundle discovery failed');
          const result = await response.json();
          if (result.errors?.length) throw new Error('Bundle query failed');
          if (!this.active || version !== this.version) return;
          const variant = result.data?.node;
          // Suppress bundle product pages even if a different variant was selected.
          if (!variant || variant.requiresComponents || variant.product?.variants?.nodes?.some(v => v.requiresComponents)) return;
          if (variant.product?.id !== `gid://shopify/Product/${this.dataset.productId}`) return;
          const page = variant.groupedBy;
          if (!page?.nodes || !page.pageInfo) throw new Error('Incomplete bundle results');
          for (const bundle of page.nodes) {
            if (bundle.availableForSale && bundle.requiresComponents && bundle.product?.availableForSale &&
                !bundle.product.requiresSellingPlan && bundle.product.id !== variant.product.id &&
                bundle.price?.currencyCode === this.dataset.currency && this.bundleUrl(bundle)) {
              bundles.set(bundle.id, bundle);
            }
          }
          after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
          if (page.pageInfo.hasNextPage && (!after || cursors.has(after))) throw new Error('Invalid bundle cursor');
          if (after) cursors.add(after);
        } while (after);
        if (this.active && version === this.version && bundles.size) {
          this.render([...bundles.values()]);
          this.hidden = false;
        }
      } catch {
        if (version === this.version) {
          this.hidden = true;
          this.list.replaceChildren();
        }
      } finally {
        window.clearTimeout(timeout);
        if (version === this.version) this.loadingId = null;
      }
    }

    bundleUrl(bundle) {
      try {
        if (!bundle.product.onlineStoreUrl) return null;
        const source = new URL(bundle.product.onlineStoreUrl);
        if (source.protocol !== 'https:') return null;
        const match = source.pathname.match(/\/products\/([^/]+)\/?$/);
        const variant = bundle.id.match(/^gid:\/\/shopify\/ProductVariant\/(\d+)$/);
        if (!match || !variant) return null;
        return `${this.dataset.root.replace(/\/$/, '')}/products/${match[1]}?variant=${variant[1]}`;
      } catch { return null; }
    }

    render(bundles) {
      const fragment = document.createDocumentFragment();
      for (const bundle of bundles) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'bundle-suggestions__link';
        link.href = this.bundleUrl(bundle);
        if (bundle.image?.url) {
          const url = new URL(bundle.image.url);
          if (url.protocol === 'https:') {
            url.searchParams.set('width', '180');
            const image = document.createElement('img');
            image.className = 'bundle-suggestions__image';
            image.src = url.href;
            image.alt = ''; // The adjacent link text names the same destination.
            image.width = image.height = 90;
            image.loading = 'lazy';
            link.append(image);
          }
        }
        const details = document.createElement('span');
        const title = document.createElement('span');
        title.className = 'bundle-suggestions__name';
        title.textContent = bundle.product.title + (bundle.title !== 'Default Title' ? ` — ${bundle.title}` : '');
        const price = document.createElement('bdi');
        price.className = 'bundle-suggestions__price';
        price.textContent = new Intl.NumberFormat(this.dataset.locale || 'he-IL', {
          style: 'currency', currency: bundle.price.currencyCode,
        }).format(Number(bundle.price.amount));
        details.append(title, price);
        link.append(details);
        item.append(link);
        fragment.append(item);
      }
      this.list.replaceChildren(fragment);
    }
  });
}
