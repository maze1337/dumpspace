// Virtual list: only the rows in view exist in the DOM, so lists with
// tens of thousands of types stay fast.

export class VList {
  constructor(scroller, { rowHeight, render }) {
    this.scroller = scroller;
    this.rowHeight = rowHeight;
    this.renderRow = render;
    this.items = [];
    this.rows = new Map();
    this.inner = document.createElement('div');
    this.inner.className = 'vlist-inner';
    scroller.append(this.inner);
    this.queued = false;
    scroller.addEventListener('scroll', () => this.schedule(), { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(scroller);
    }
  }

  setItems(items) {
    this.items = items;
    this.inner.style.height = `${items.length * this.rowHeight}px`;
    for (const el of this.rows.values()) el.remove();
    this.rows.clear();
    this.draw();
  }

  schedule() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  draw() {
    const rh = this.rowHeight;
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight || 640;
    const start = Math.max(0, Math.floor(top / rh) - 10);
    const end = Math.min(this.items.length, Math.ceil((top + height) / rh) + 10);
    for (const [i, el] of this.rows) {
      if (i < start || i >= end) {
        el.remove();
        this.rows.delete(i);
      }
    }
    for (let i = start; i < end; i++) {
      if (this.rows.has(i)) continue;
      const el = this.renderRow(this.items[i], i);
      el.style.transform = `translateY(${i * rh}px)`;
      el.style.height = `${rh}px`;
      this.inner.append(el);
      this.rows.set(i, el);
    }
  }

  /** Re-render the rows that are visible (for example after the selection changes). */
  refresh() {
    for (const el of this.rows.values()) el.remove();
    this.rows.clear();
    this.draw();
  }

  scrollToIndex(i) {
    if (i < 0) return;
    const rh = this.rowHeight;
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight || 640;
    const y = i * rh;
    if (y < top || y + rh > top + height) this.scroller.scrollTop = Math.max(0, y - height / 2 + rh / 2);
    this.draw();
  }

  destroy() {
    if (this.observer) this.observer.disconnect();
  }
}
