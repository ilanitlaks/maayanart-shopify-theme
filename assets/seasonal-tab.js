if (!customElements.get('seasonal-tab')) {
  customElements.define('seasonal-tab', class extends HTMLElement {
    connectedCallback() {
      this.link = this.querySelector('.seasonal-tab__link');
      this.content = this.querySelector('.seasonal-tab__content');
      this.closeButton = this.querySelector('.seasonal-tab__close');
      this.isOpen = false;
      this.events = new AbortController();
      const options = { signal: this.events.signal };
      this.link.addEventListener('click', event => {
        // A closed drawer consumes the first activation. Once open, keep native link behavior.
        if (!this.isOpen) {
          event.preventDefault();
          this.setOpen(true);
        }
      }, options);
      this.link.addEventListener('keydown', event => {
        if (event.key === ' ') {
          event.preventDefault();
          this.setOpen(!this.isOpen);
        }
      }, options);
      this.closeButton.addEventListener('click', () => this.setOpen(false, true), options);
      this.addEventListener('pointerenter', event => {
        window.clearTimeout(this.closeTimer);
        if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover) and (pointer: fine)').matches) this.setOpen(true);
      }, options);
      this.addEventListener('pointerleave', () => this.scheduleClose(), options);
      this.addEventListener('focusout', () => this.scheduleClose(), options);
      this.addEventListener('focusin', () => window.clearTimeout(this.closeTimer), options);
      document.addEventListener('pointerdown', event => {
        if (this.isOpen && !this.contains(event.target)) this.setOpen(false);
      }, options);
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.isOpen) {
          this.setOpen(false, this.contains(document.activeElement));
        }
      }, options);
      document.addEventListener('scroll', () => {
        if (this.isOpen && Math.abs(window.scrollY - this.openScrollY) >= window.innerHeight / 2) {
          this.setOpen(false, this.contains(document.activeElement));
        }
      }, { ...options, passive: true, capture: true });
      document.addEventListener('shopify:section:deselect', event => {
        if (event.detail?.sectionId === this.dataset.section) this.setOpen(false);
      }, options);
      this.setOpen(false);
      this.hidden = false;
    }

    scheduleClose() {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = window.setTimeout(() => {
        if (!this.contains(document.activeElement) && !this.matches(':hover')) this.setOpen(false);
      }, 250);
    }

    setOpen(open, restoreFocus = false) {
      window.clearTimeout(this.closeTimer);
      if (open && !this.isOpen) this.openScrollY = window.scrollY;
      this.isOpen = open;
      this.classList.toggle('is-open', open);
      this.link.setAttribute('aria-expanded', String(open));
      this.content.setAttribute('aria-hidden', String(!open));
      this.content.inert = !open;
      this.closeButton.hidden = !open;
      if (restoreFocus) this.link.focus({ preventScroll: true });
    }

    disconnectedCallback() {
      this.events?.abort();
      window.clearTimeout(this.closeTimer);
    }
  });
}
