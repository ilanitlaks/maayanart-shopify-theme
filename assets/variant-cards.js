if (!customElements.get('variant-cards')) {
  customElements.define('variant-cards', class extends HTMLElement {
    connectedCallback() {
      this.busy = false;
      this.onClick = this.handleClick.bind(this);
      this.onCartChange = () => { if (!this.busy) this.refresh().catch(() => {}); };
      this.addEventListener('click', this.onClick);
      document.addEventListener('cart:action', this.onCartChange);
      if (typeof subscribe === 'function') this.unsubscribe = subscribe(PUB_SUB_EVENTS.cartUpdate, this.onCartChange);
      this.onCartChange();
    }

    disconnectedCallback() {
      this.removeEventListener('click', this.onClick);
      document.removeEventListener('cart:action', this.onCartChange);
      this.unsubscribe?.();
    }

    async request(path, body) {
      const response = await fetch(`${window.Shopify?.routes?.root || '/'}${path}`, body ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      } : { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || data.status >= 400) {
        const error = new Error(data.description || data.message || 'לא ניתן לעדכן את הסל. נסו שוב.');
        error.cartRejected = true;
        throw error;
      }
      return data;
    }

    async refresh() {
      const cart = await this.request('cart.js');
      this.renderCart(cart);
      if (this.pendingConfirmation) {
        const confirmation = this.pendingConfirmation;
        this.pendingConfirmation = null;
        this.confirmUpdate(cart, confirmation);
      }
      return cart;
    }

    confirmUpdate(cart, { card, button, id, increase }) {
      card.querySelector('[data-error]').textContent = '';
      const actualQuantity = cart.items.filter(item => String(item.variant_id) === id).reduce((sum, item) => sum + item.quantity, 0);
      if (increase && typeof animateCartAddition === 'function') animateCartAddition(button, cart);
      this.querySelector('[data-status]').textContent = `הסל עודכן: ${card.querySelector('h3').textContent}, כמות ${actualQuantity}`;
    }

    renderCart(cart) {
      this.cart = cart;
      this.querySelectorAll('[data-variant-id]').forEach(card => {
        const quantity = cart.items.filter(item => String(item.variant_id) === card.dataset.variantId)
          .reduce((sum, item) => sum + item.quantity, 0);
        card.querySelector('[data-quantity]').textContent = quantity;
        card.querySelector('[data-delta="-1"]').disabled = this.busy || quantity === 0;
        card.querySelector('[data-delta="1"]').disabled = this.busy || card.querySelector('[data-available]').dataset.available !== 'true' ||
          (card.dataset.max !== '' && quantity >= Number(card.dataset.max));
      });
    }

    async handleClick(event) {
      const button = event.target.closest('[data-delta]');
      if (!button || this.busy || button.disabled) return;
      const card = button.closest('[data-variant-id]');
      this.busy = true;
      this.setAttribute('aria-busy', 'true');
      this.querySelector('[data-status]').textContent = '';
      this.querySelectorAll('[data-error]').forEach(message => { message.textContent = ''; });
      this.querySelectorAll('button').forEach(item => { item.disabled = true; });
      let mutationAttempted = false;
      let mutationSucceeded = false;
      let cartVerified = false;
      let confirmation;
      try {
        await this.refresh();
        cartVerified = true;
        const id = card.dataset.variantId;
        const lines = this.cart.items.filter(item => String(item.variant_id) === id);
        // Never merge or alter personalized / subscription lines implicitly.
        if (lines.length > 1 || lines.some(item => item.selling_plan_allocation || Object.keys(item.properties || {}).length)) {
          throw new Error('אפשרות זו כוללת התאמה אישית או מנוי. לשינוי הכמות יש לפתוח את סל הקניות.');
        }
        const current = lines.reduce((sum, item) => sum + item.quantity, 0);
        const step = Number(card.dataset.step) || 1;
        const min = Number(card.dataset.min) || 1;
        const next = Number(button.dataset.delta) > 0 ? (current ? current + step : min) : (current - step < min ? 0 : current - step);
        if (card.dataset.max !== '' && next > Number(card.dataset.max)) throw new Error('הגעתם לכמות המרבית להזמנה.');
        confirmation = { card, button, id, increase: next > current };
        const cartUI = document.querySelector('cart-drawer');
        const sections = cartUI?.getSectionsToRender().map(section => section.id) || ['cart-icon-bubble'];
        const common = { sections, sections_url: window.location.pathname };
        mutationAttempted = true;
        cartVerified = false;
        const result = lines.length
          ? await this.request('cart/change.js', { ...common, id: lines[0].key, quantity: next })
          : await this.request('cart/add.js', { ...common, items: [{ id, quantity: next }] });
        mutationSucceeded = true;
        // change.js already returns a full cart; add.js requires one read.
        let cart;
        if (Array.isArray(result.items) && typeof result.item_count === 'number') {
          cart = result;
          this.renderCart(cart);
        } else {
          try {
            cart = await this.refresh();
          } catch {
            // Retry only verification, never the mutation itself.
            cart = await this.refresh();
          }
        }
        cartVerified = true;
        card.querySelector('[data-error]').textContent = '';
        // Refresh the existing Dawn surfaces without opening a second purchase flow.
        sections.forEach(section => {
          const definition = cartUI?.getSectionsToRender().find(item => item.id === section);
          const target = definition?.selector ? document.querySelector(definition.selector) : document.getElementById(section);
          const html = result.sections?.[section];
          if (!target || !html) return;
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          const selector = definition?.selector || '.shopify-section';
          const source = parsed.querySelector(selector);
          const destination = definition?.selector ? target : target.querySelector(selector) || target;
          if (source) destination.innerHTML = source.innerHTML;
        });
        cartUI?.querySelector('#CartDrawer-Overlay')?.addEventListener('click', () => cartUI.close());
        cartUI?.classList.toggle('is-empty', cart.item_count === 0);
        this.confirmUpdate(cart, confirmation);
        if (typeof publish === 'function') publish(PUB_SUB_EVENTS.cartUpdate, { source: 'variant-cards', cartData: cart });
      } catch (error) {
        if (mutationSucceeded) {
          if (!cartVerified) this.pendingConfirmation = confirmation;
          card.querySelector('[data-error]').textContent = 'העדכון בסל הצליח, אך לא ניתן לרענן את התצוגה. רעננו את העמוד לפני פעולה נוספת; אין צורך להוסיף שוב.';
        } else if (mutationAttempted && !error.cartRejected) {
          card.querySelector('[data-error]').textContent = 'לא ניתן לאמת אם הסל עודכן. בדקו את סל הקניות או רעננו את העמוד לפני ניסיון נוסף.';
        } else {
          card.querySelector('[data-error]').textContent = error.message || 'לא ניתן לעדכן את הסל. נסו שוב.';
          if (error.cartRejected) cartVerified = true;
        }
      } finally {
        this.busy = false;
        this.removeAttribute('aria-busy');
        if (cartVerified) this.renderCart(this.cart);
        if (!button.disabled) button.focus();
      }
    }
  });
}
