// Search across every type, member, function and enum value of the open game.
import { h, icon } from './dom.js';
import { getSearchIndex, runSearch } from './data.js';
import { build } from './routes.js';

const KIND_TEXT = { classes: 'class', structs: 'struct', enums: 'enum', function: 'function', member: 'member', value: 'value' };

function highlight(name, query) {
  let q = query.trim();
  const sep = q.indexOf('::');
  if (sep >= 0) q = q.slice(sep + 2);
  const i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return name;
  return [name.slice(0, i), h('mark', null, name.slice(i, i + q.length)), name.slice(i + q.length)];
}

export class SearchDialog {
  constructor(ctx) {
    this.ctx = ctx;
    this.model = null;
    this.results = [];
    this.active = 0;
    this.input = h('input', {
      id: 'global-search', type: 'search', class: 'search-input', autocomplete: 'off', spellcheck: 'false',
      placeholder: 'Search types, members, functions and enum values',
      'aria-label': 'Search this game', 'aria-controls': 'search-results', 'aria-autocomplete': 'list', role: 'combobox', 'aria-expanded': 'true',
    });
    this.status = h('p', { class: 'search-status', 'aria-live': 'polite' });
    this.list = h('ul', { id: 'search-results', class: 'search-results', role: 'listbox', 'aria-label': 'Results' });
    this.box = h('div', { class: 'search-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' },
      h('div', { class: 'search-field' },
        icon('search'),
        this.input,
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close search', onclick: () => this.close() }, icon('close'))),
      this.status,
      this.list);
    this.el = h('div', { class: 'overlay search-overlay', hidden: true }, this.box);
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    document.body.append(this.el);
    this.input.addEventListener('input', () => this.schedule());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open(model) {
    this.model = model;
    this.lastFocus = document.activeElement;
    this.el.hidden = false;
    this.input.focus();
    this.input.select();
    if (!model.search) {
      this.status.textContent = 'Building the search index…';
      setTimeout(() => {
        getSearchIndex(model);
        this.update();
      }, 16);
    } else {
      this.update();
    }
  }

  close() {
    this.el.hidden = true;
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(), 60);
  }

  update() {
    if (!this.model) return;
    const q = this.input.value;
    if (!q.trim()) {
      this.results = [];
      this.list.replaceChildren();
      this.status.textContent = 'Type part of a name. Write Class::member to search inside one type.';
      return;
    }
    const { results, total } = runSearch(getSearchIndex(this.model), q, 60);
    this.results = results;
    this.active = 0;
    if (!total) this.status.textContent = 'No matches. Try a shorter part of the name.';
    else if (total > results.length) this.status.textContent = `Showing ${results.length} of ${total.toLocaleString('en-US')} matches`;
    else this.status.textContent = `${total} match${total === 1 ? '' : 'es'}`;
    this.list.replaceChildren(...results.map((it, i) => h('li', {
      role: 'option', id: `sr-${i}`, class: 'sr-item', 'aria-selected': String(i === 0),
      onclick: () => this.go(i), onpointermove: () => this.setActive(i, false),
    },
    h('span', { class: `kind-chip kind-${KIND_TEXT[it.k]}` }, KIND_TEXT[it.k]),
    h('span', { class: 'sr-name' }, highlight(it.name, q)),
    it.k === 'value' ? h('span', { class: 'sr-owner' }, `${it.owner} = ${it.value}`) : it.owner ? h('span', { class: 'sr-owner' }, it.owner) : null)));
    this.input.setAttribute('aria-activedescendant', results.length ? 'sr-0' : '');
  }

  setActive(i, scroll = true) {
    if (!this.results.length) return;
    this.active = (i + this.results.length) % this.results.length;
    for (const li of this.list.children) li.setAttribute('aria-selected', String(li.id === `sr-${this.active}`));
    this.input.setAttribute('aria-activedescendant', `sr-${this.active}`);
    if (scroll) this.list.children[this.active]?.scrollIntoView({ block: 'nearest' });
  }

  onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this.setActive(this.active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.setActive(this.active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); this.go(this.active); }
    else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
  }

  routeFor(it) {
    const hash = this.model.info.hash;
    if (it.k === 'function') return { hash, tab: 'functions', name: it.owner, member: it.name };
    if (it.k === 'member') return { hash, tab: it.kind, name: it.owner, member: it.name };
    if (it.k === 'value') return { hash, tab: 'enums', name: it.owner, member: it.name };
    return { hash, tab: it.k, name: it.name };
  }

  go(i) {
    const it = this.results[i];
    if (!it) return;
    this.close();
    this.ctx.navigate(build(this.routeFor(it)));
  }
}
