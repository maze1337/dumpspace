// Pieces shared by every page: the brand link, theme switch and number format switch.
import { h, icon, store } from './dom.js';
import { CONFIG } from './config.js';

function chipMark() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('brand-mark');
  const body = document.createElementNS(ns, 'rect');
  for (const [k, v] of Object.entries({ x: 6, y: 3.5, width: 12, height: 17, rx: 1.5 })) body.setAttribute(k, v);
  body.setAttribute('class', 'mark-body');
  svg.append(body);
  for (const y of [7, 10.5, 14, 17.5]) {
    for (const [x1, x2] of [[2.5, 6], [18, 21.5]]) {
      const pin = document.createElementNS(ns, 'line');
      for (const [k, v] of Object.entries({ x1, x2, y1: y, y2: y })) pin.setAttribute(k, v);
      pin.setAttribute('class', 'mark-pin');
      svg.append(pin);
    }
  }
  const dot = document.createElementNS(ns, 'circle');
  for (const [k, v] of Object.entries({ cx: 9, cy: 6.5, r: 1 })) dot.setAttribute(k, v);
  dot.setAttribute('class', 'mark-dot');
  svg.append(dot);
  return svg;
}

export function brand() {
  return h('a', { class: 'brand', href: '#/', 'aria-label': `${CONFIG.siteName}, all games` },
    chipMark(),
    h('span', { class: 'brand-name' }, CONFIG.siteName));
}

function prefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : prefersDark();
}

export function themeToggle() {
  const btn = h('button', { type: 'button', class: 'icon-btn theme-btn' });
  const sync = () => {
    const dark = isDark();
    btn.replaceChildren(icon(dark ? 'sun' : 'moon'));
    const label = dark ? 'Use light theme' : 'Use dark theme';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('oa.theme', next);
    sync();
  });
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
  } catch {
    /* older browsers */
  }
  sync();
  return btn;
}

export function baseToggle(ctx) {
  const options = [['hex', 'Hex'], ['dec', 'Dec']];
  const wrap = h('div', { class: 'segmented base-toggle', role: 'group', 'aria-label': 'Number format' });
  const buttons = options.map(([v, text]) => h('button', {
    type: 'button',
    class: 'seg-btn',
    title: v === 'hex' ? 'Show offsets and sizes in hexadecimal' : 'Show offsets and sizes in decimal',
    'aria-pressed': String(ctx.prefs.base === v),
    onclick: () => {
      if (ctx.prefs.base === v) return;
      ctx.setPref('base', v);
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === buttons[options.findIndex(([o]) => o === v)]));
      ctx.refresh();
    },
  }, text));
  wrap.append(...buttons);
  return wrap;
}
