// The game screen: top bar, tabs, the type list and the detail pane.
import { h, icon, store } from './dom.js';
import { CONFIG } from './config.js';
import { loadGame } from './data.js';
import { fmt, engineShort } from './format.js';
import { href } from './routes.js';
import { VList } from './vlist.js';
import { brand, baseToggle, themeToggle } from './chrome.js';
import { renderTypeDetail, renderEnumDetail, renderFunctionsDetail, renderEmptyDetail } from './detail.js';
import { renderOverview, renderOffsets } from './overview.js';

const TAB_DEFS = [
  ['overview', 'Overview'], ['classes', 'Classes'], ['structs', 'Structs'],
  ['functions', 'Functions'], ['enums', 'Enums'], ['offsets', 'Offsets'],
];
const LIST_LABEL = { classes: 'classes', structs: 'structs', enums: 'enums', functions: 'types with functions' };
const SORTS = {
  classes: [['name', 'Name'], ['size', 'Largest first']],
  structs: [['name', 'Name'], ['size', 'Largest first']],
  enums: [['name', 'Name'], ['count', 'Most values']],
  functions: [['name', 'Name'], ['count', 'Most functions']],
};

export class GameShell {
  constructor(root, info, ctx) {
    this.info = info;
    this.hash = info.hash;
    this.ctx = ctx;
    this.model = null;
    this.loading = null;
    this.tab = null;
    this.route = null;
    this.listState = {};
    this.lower = {};
    this.vlist = null;

    this.tabsEl = h('nav', { class: 'tabs', 'aria-label': 'Sections' });
    this.body = h('main', { class: 'game-body', id: 'main' });
    this.searchBtn = h('button', { type: 'button', class: 'search-btn', disabled: true, onclick: () => this.openSearch() },
      icon('search', 16), h('span', { class: 'search-btn-text' }, 'Search everything'), h('kbd', null, '/'));
    const top = h('header', { class: 'topbar' },
      brand(),
      h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '/'),
      h('a', { class: 'crumb-game', href: href({ hash: info.hash }) }, info.name),
      h('span', { class: 'engine-tag' }, info.local ? 'Local' : engineShort(info.engine)),
      h('div', { class: 'topbar-spacer' }),
      this.searchBtn,
      baseToggle(ctx),
      themeToggle());
    this.el = h('div', { class: 'game' }, top, this.tabsEl, this.body);
    root.replaceChildren(this.el);
  }

  openSearch() {
    if (this.model) this.ctx.search.open(this.model);
  }

  async show(route) {
    this.route = route;
    if (!this.model) {
      if (!this.loading) {
        this.renderLoading();
        this.loading = loadGame(this.hash, (p) => this.onProgress(p));
      }
      let model;
      try {
        model = await this.loading;
      } catch (e) {
        if (this.route === route) this.renderError(e);
        this.loading = null;
        return;
      }
      if (this.route !== route) return;
      if (!this.model) {
        this.model = model;
        this.renderTabs();
        this.searchBtn.disabled = false;
      }
    }
    this.setActiveTab(route.tab);
    if (this.tab !== route.tab) this.buildTab(route.tab);
    this.select(route);
    this.trackRecent(route);
    document.title = [route.name, this.info.name, CONFIG.siteName].filter(Boolean).join(' | ');
  }

  renderLoading() {
    this.progressText = h('p', { class: 'loading-text' }, `Loading ${this.info.name}…`);
    this.progressFill = h('span', { class: 'loading-fill' });
    this.body.replaceChildren(h('div', { class: 'loading', role: 'status' },
      this.progressText,
      h('div', { class: 'loading-bar', 'aria-hidden': 'true' }, this.progressFill)));
  }

  onProgress({ step, total, file }) {
    if (this.progressText) this.progressText.textContent = `Loading ${file}, file ${step} of ${total}`;
    if (this.progressFill) this.progressFill.style.width = `${((step - 1) / total) * 100}%`;
  }

  renderError(e) {
    const missing = e && e.message === 'not-found';
    this.body.replaceChildren(h('div', { class: 'empty' },
      h('p', { class: 'empty-title' }, missing ? 'This game is not in GameList.json.' : `${this.info.name} could not be loaded.`),
      missing ? null : h('p', { class: 'muted' }, String((e && e.message) || e)),
      h('p', null, h('a', { href: '#/' }, 'Back to all games'))));
  }

  renderTabs() {
    const m = this.model;
    const counts = {
      classes: m.names.classes.length, structs: m.names.structs.length, functions: m.names.functions.length,
      enums: m.names.enums.length, offsets: m.offsets.length,
    };
    this.tabLinks = {};
    this.tabsEl.replaceChildren(...TAB_DEFS.map(([id, label]) => {
      const a = h('a', { class: 'tab', href: href({ hash: this.hash, tab: id }) },
        h('span', null, label),
        counts[id] != null ? h('span', { class: 'tab-count' }, counts[id].toLocaleString('en-US')) : null);
      this.tabLinks[id] = a;
      return a;
    }));
  }

  setActiveTab(tab) {
    for (const [id, a] of Object.entries(this.tabLinks || {})) {
      if (id === tab) {
        a.setAttribute('aria-current', 'page');
        if (a.scrollIntoView && this.tabsEl.scrollWidth > this.tabsEl.clientWidth) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else a.removeAttribute('aria-current');
    }
  }

  buildTab(tab) {
    this.tab = tab;
    if (this.vlist) this.vlist.destroy();
    this.vlist = null;
    this.split = null;
    this.body.replaceChildren();
    this.body.dataset.tab = tab;
    if (tab === 'overview' || tab === 'offsets') return;
    this.listPane = h('aside', { class: 'list-pane', 'aria-label': `List of ${LIST_LABEL[tab]}` });
    this.detailPane = h('section', { class: 'detail-pane', 'aria-label': 'Details' });
    this.split = h('div', { class: 'split' }, this.listPane, this.detailPane);
    this.body.append(this.split);
    this.buildList(tab);
  }

  buildList(tab) {
    const st = this.listState[tab] || (this.listState[tab] = { q: '', sort: 'name' });
    const input = h('input', {
      type: 'search', id: `filter-${tab}`, class: 'input', placeholder: `Filter ${LIST_LABEL[tab]}`,
      'aria-label': `Filter ${LIST_LABEL[tab]}`, autocomplete: 'off', spellcheck: 'false',
    });
    input.value = st.q;
    const select = h('select', { id: `sort-${tab}`, class: 'select', 'aria-label': 'Sort order' },
      SORTS[tab].map(([v, t]) => h('option', { value: v, selected: v === st.sort || null }, t)));
    this.countEl = h('p', { class: 'list-count', 'aria-live': 'polite' });
    const scroller = h('div', { class: 'list-scroll' });
    this.listPane.replaceChildren(h('div', { class: 'list-tools' }, input, select), this.countEl, scroller);
    this.vlist = new VList(scroller, { rowHeight: 34, render: (key) => this.listRow(tab, key) });

    const apply = () => {
      this.listItems = this.filterItems(tab, st);
      this.vlist.setItems(this.listItems);
      const total = this.model.names[tab].length;
      this.countEl.textContent = st.q.trim()
        ? `${this.listItems.length.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${LIST_LABEL[tab]}`
        : `${total.toLocaleString('en-US')} ${LIST_LABEL[tab]}`;
    };
    let timer = 0;
    input.addEventListener('input', () => {
      st.q = input.value;
      clearTimeout(timer);
      timer = setTimeout(apply, 80);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.listItems && this.listItems.length) {
        e.preventDefault();
        this.ctx.navigate(href({ hash: this.hash, tab, name: this.listItems[0] }).slice(1));
      }
    });
    select.addEventListener('change', () => {
      st.sort = select.value;
      apply();
    });
    apply();
  }

  filterItems(tab, st) {
    const names = this.model.names[tab];
    const lower = this.lower[tab] || (this.lower[tab] = names.map((n) => n.toLowerCase()));
    const q = st.q.trim().toLowerCase();
    let items = q ? names.filter((_, i) => lower[i].includes(q)) : names;
    if (st.sort !== 'name') {
      const map = this.model[tab];
      const metric = (k) => (st.sort === 'size' ? map.get(k).size : map.get(k).count);
      items = items.slice().sort((a, b) => metric(b) - metric(a));
    }
    return items;
  }

  listRow(tab, key) {
    const e = this.model[tab].get(key);
    let meta = '';
    if (tab === 'classes' || tab === 'structs') meta = e.size > 0 ? fmt(e.size, this.ctx.prefs.base) : `${e.count} fields`;
    else meta = e.count.toLocaleString('en-US');
    const selected = key === this.selectedName;
    return h('a', {
      class: `list-row${selected ? ' is-selected' : ''}`,
      href: href({ hash: this.hash, tab, name: key }),
      'aria-current': selected ? 'true' : null,
      title: key,
    }, h('span', { class: 'list-name' }, key), h('span', { class: 'list-meta' }, meta));
  }

  select(route) {
    const tab = route.tab;
    if (tab === 'overview') {
      this.body.replaceChildren();
      renderOverview(this.body, this.model, this.ctx);
      return;
    }
    if (tab === 'offsets') {
      this.body.replaceChildren();
      renderOffsets(this.body, this.model, this.ctx);
      return;
    }
    const changed = this.selectedName !== route.name;
    this.selectedName = route.name;
    this.split.classList.toggle('has-selection', route.name != null);
    this.detailPane.replaceChildren();
    if (changed) this.detailPane.scrollTop = 0;
    if (route.name == null) renderEmptyDetail(this.detailPane, this.model, tab);
    else if (tab === 'classes' || tab === 'structs') renderTypeDetail(this.detailPane, this.model, route, this.ctx);
    else if (tab === 'enums') renderEnumDetail(this.detailPane, this.model, route, this.ctx);
    else renderFunctionsDetail(this.detailPane, this.model, route, this.ctx);
    if (this.vlist) {
      this.vlist.refresh();
      if (changed && route.name != null) this.vlist.scrollToIndex(this.listItems.indexOf(route.name));
    }
  }

  /** Re-render the current view in place, for example after the number format changes. */
  refresh() {
    if (!this.model || !this.route) return;
    const pane = this.split ? this.detailPane : this.body;
    const scroll = pane.scrollTop;
    this.select({ ...this.route, member: null });
    pane.scrollTop = scroll;
  }

  trackRecent(route) {
    if (this.info.local || !route.name || !['classes', 'structs', 'enums', 'functions'].includes(route.tab)) return;
    const key = `oa.recent.${this.hash}`;
    const list = store.get(key, []).filter((r) => r && !(r.tab === route.tab && r.name === route.name));
    list.unshift({ tab: route.tab, name: route.name });
    store.set(key, list.slice(0, 10));
  }
}
