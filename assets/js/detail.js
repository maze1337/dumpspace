// Detail panes: one class/struct (layout map, members, C++), one enum, one type's functions.
import { h, icon, copyText } from './dom.js';
import { getType, parentOf, resolveType, childrenOf, getEnum, getFunctions } from './data.js';
import {
  fmt, hex, hexPad, typeTokens, ownLayout, parentEndOf, typeToCpp, enumToCpp, functionsToCpp,
  linesToText, plural, KIND_NAME,
} from './format.js';
import { href } from './routes.js';

const TAB_LABEL = { classes: 'Classes', structs: 'Structs', enums: 'Enums', functions: 'Functions' };
const bytes = (n, base) => (base === 'hex' ? `${hex(n)} bytes` : plural(n, 'byte'));
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- shared pieces

function typeLink(model, name, kindLetter) {
  const cls = 'k-' + (KIND_NAME[kindLetter] || 'basic');
  const ref = kindLetter === 'D' ? null : resolveType(model, name, kindLetter);
  if (!ref) {
    return kindLetter === 'D'
      ? h('span', { class: cls }, name)
      : h('span', { class: `${cls} is-unresolved`, title: 'This type is not in the dump' }, name);
  }
  return h('a', { class: `tlink ${cls}`, href: href({ hash: model.info.hash, tab: ref.kind, name: ref.key }) }, name);
}

function typeView(model, tr) {
  return h('span', { class: 'type' }, typeTokens(tr).map((tok) => {
    if (tok.ref) return typeLink(model, tok.t, tok.kind);
    if (tok.kind === 'D') return h('span', { class: 'k-basic' }, tok.t);
    return tok.t;
  }));
}

function codeView(model, lines) {
  const code = h('code');
  lines.forEach((ln, i) => {
    if (i) code.append('\n');
    for (const tok of ln) {
      if (tok.ref) code.append(typeLink(model, tok.t, tok.kind || 'C'));
      else if (tok.c) code.append(h('span', { class: tok.c }, tok.t));
      else code.append(tok.t);
    }
  });
  return h('div', { class: 'code-wrap' }, h('pre', { class: 'code', tabindex: '0', 'aria-label': 'C++ code' }, code));
}

function segmented(label, options, value, onChange) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': label },
    options.map(([v, text]) => h('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(v === value), onclick: () => v !== value && onChange(v),
    }, text)));
}

function toggle(id, label, checked, onChange) {
  return h('label', { class: 'toggle', for: id },
    h('input', { type: 'checkbox', id, checked: checked || null, onchange: (e) => onChange(e.target.checked) }),
    h('span', { class: 'toggle-ui', 'aria-hidden': 'true' }),
    h('span', null, label));
}

function copyButton(label, getText, toastText) {
  return h('button', { type: 'button', class: 'btn btn-small', onclick: () => copyText(getText(), toastText) }, icon('copy', 16), label);
}

function head(model, { tab, kindText, kindClass, title, facts, lineage, actions }) {
  return h('header', { class: 'd-head' },
    h('a', { class: 'back-link', href: href({ hash: model.info.hash, tab }) }, icon('back', 16), `All ${TAB_LABEL[tab].toLowerCase()}`),
    h('div', { class: 'd-title-row' },
      h('span', { class: `kind-chip ${kindClass}` }, kindText),
      h('h1', { class: 'd-title' }, title),
      h('button', { type: 'button', class: 'icon-btn', title: 'Copy name', 'aria-label': 'Copy name', onclick: () => copyText(title, `Copied ${title}`) }, icon('copy', 16))),
    facts && facts.length ? h('dl', { class: 'd-facts' }, facts.map(([k, v]) => h('div', { class: 'fact' }, h('dt', null, k), h('dd', null, v)))) : null,
    lineage || null,
    actions && actions.length ? h('div', { class: 'd-actions' }, actions) : null);
}

function section(title, count, ...kids) {
  return h('section', { class: 'd-section' },
    h('h2', { class: 'd-h2' }, title, count != null ? h('span', { class: 'count' }, count.toLocaleString('en-US')) : null),
    kids);
}

function flash(el) {
  if (!el) return;
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
  el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function focusTarget(pane, attr, value) {
  if (!value) return;
  requestAnimationFrame(() => {
    let el = null;
    try {
      el = pane.querySelector(`[${attr}="${CSS.escape(value)}"]`);
    } catch {
      el = null;
    }
    if (el) {
      el.classList.add('is-target');
      flash(el);
    }
  });
}

export function notFound(pane, model, route) {
  pane.append(h('div', { class: 'empty' },
    h('p', { class: 'empty-title' }, `${route.name} is not in this dump.`),
    h('p', null, h('a', { href: href({ hash: model.info.hash, tab: route.tab }) }, `Back to ${TAB_LABEL[route.tab] || 'the list'}`))));
}

// ---------------------------------------------------------------- class / struct

function ancestorTypes(model, t) {
  const letter = t.kind === 'structs' ? 'S' : 'C';
  return [...t.parents].reverse().map((name) => {
    const ref = resolveType(model, name, letter);
    const type = ref && ref.kind !== 'enums' ? getType(model, ref.kind, ref.key) : null;
    return { name, ref, type };
  });
}

function layoutMap(model, ctx, t, parentEnd, layout, onPick) {
  const base = ctx.prefs.base;
  const total = t.size;
  const pad = hexPad(total);
  const segs = [];
  let prevEnd = 0;
  let alt = 0;
  for (const a of ancestorTypes(model, t)) {
    if (a.type && a.type.size > prevEnd && a.type.size <= parentEnd) {
      segs.push({ type: 'inherit', start: prevEnd, size: a.type.size - prevEnd, name: a.name, ref: a.ref, alt: alt++ % 2 });
      prevEnd = a.type.size;
    }
  }
  if (parentEnd > prevEnd) segs.push({ type: 'inherit', start: prevEnd, size: parentEnd - prevEnd, name: t.parents[0] || 'parent', ref: null, alt: alt++ % 2 });
  for (const row of layout.rows) {
    if (row.kind === 'gap') segs.push({ type: 'gap', start: row.start, size: row.size });
    else if (row.kind === 'member') segs.push({ type: 'member', start: row.m.offset, size: Math.max(row.m.size, 1), m: row.m });
  }

  // "Own part" squeezes the inherited bytes into a short block on the left, so the
  // members this type adds get most of the width. The squeezed block is marked with a break.
  const canZoom = parentEnd > 0 && parentEnd < total;
  const scalePref = ctx.prefs.mapScale;
  const zoom = canZoom && (scalePref === 'own' || (scalePref !== 'whole' && parentEnd / total > 0.5));
  const CAP = 0.1;
  const pos = (n) => {
    if (!zoom) return n / total;
    if (n <= parentEnd) return (n / parentEnd) * CAP;
    return CAP + ((n - parentEnd) / (total - parentEnd)) * (1 - CAP);
  };
  const pct = (f) => `${Math.min(100, Math.max(0, f * 100))}%`;
  const track = h('div', { class: 'map-track' });
  segs.forEach((s, i) => {
    let cls = 'seg';
    if (s.type === 'inherit') cls += ` seg-inherit${s.alt ? ' is-alt' : ''}`;
    else if (s.type === 'gap') cls += ' seg-gap';
    else cls += ` seg-${KIND_NAME[s.m.type.kind] || 'basic'}`;
    const a = pos(s.start);
    const b = pos(Math.min(total, s.start + s.size));
    track.append(h('div', { class: cls, style: { left: pct(a), width: pct(Math.max(0, b - a)) }, dataset: { i: String(i) } }));
  });
  if (zoom) track.append(h('div', { class: 'map-break', style: { left: pct(CAP) }, title: 'Inherited bytes are not drawn to scale in this view' }));

  const idle = h('span', { class: 'muted' }, 'Point at the map to see what sits at each offset.');
  const readout = h('p', { class: 'map-readout', 'aria-live': 'polite' }, idle);
  const show = (s) => {
    readout.replaceChildren();
    const at = h('span', { class: 'ro-off' }, fmt(s.start, base, base === 'hex' ? pad : 0));
    if (s.type === 'member') {
      readout.append(at, typeView(model, s.m.type), h('span', { class: 'ro-name' }, s.m.name + (s.m.bit != null ? ` : 1 (bit ${s.m.bit})` : '')), h('span', { class: 'muted' }, s.m.bit != null ? '1 bit' : bytes(s.m.size, base)));
    } else if (s.type === 'gap') {
      readout.append(at, h('span', null, 'Unknown'), h('span', { class: 'muted' }, `${bytes(s.size, base)} the dump does not describe`));
    } else {
      readout.append(at, h('span', null, 'Inherited from'), s.ref ? h('a', { class: 'tlink', href: href({ hash: model.info.hash, tab: s.ref.kind, name: s.ref.key }) }, s.name) : h('span', null, s.name), h('span', { class: 'muted' }, bytes(s.size, base)));
    }
  };
  const pick = (e) => {
    const el = e.target.closest('.seg');
    return el ? segs[Number(el.dataset.i)] : null;
  };
  track.addEventListener('pointermove', (e) => {
    const s = pick(e);
    if (s) show(s);
  });
  track.addEventListener('click', (e) => {
    const s = pick(e);
    if (!s) return;
    show(s);
    if (s.type === 'member') onPick(s.m.name);
  });

  const tickValues = zoom
    ? [parentEnd, parentEnd + (total - parentEnd) / 3, parentEnd + ((total - parentEnd) * 2) / 3, total]
    : [0, total / 4, total / 2, (total * 3) / 4, total];
  const ticks = tickValues.map((v, i) => h('span', {
    class: `tick${i === 0 ? ' is-first' : ''}${i === tickValues.length - 1 ? ' is-last' : ''}`,
    style: { left: pct(pos(v)) },
  }, fmt(Math.round(v), base)));
  const kinds = new Set(segs.map((s) => (s.type === 'member' ? KIND_NAME[s.m.type.kind] || 'basic' : s.type)));
  const legendItems = [
    ['inherit', 'Inherited'], ['class', 'Class or pointer'], ['struct', 'Struct'], ['enum', 'Enum'], ['basic', 'Basic type'], ['gap', 'Unknown'],
  ].filter(([k]) => kinds.has(k));

  const scale = canZoom
    ? segmented('Map scale', [['whole', 'Whole type'], ['own', 'Own part']], zoom ? 'own' : 'whole', (v) => { ctx.setPref('mapScale', v); ctx.refresh(); })
    : null;

  return h('figure', { class: 'map', 'aria-label': `Memory layout of ${t.name}` },
    h('div', { class: 'map-head' },
      h('span', { class: 'map-title' }, `Memory layout, ${bytes(total, base)}`),
      scale),
    track,
    h('div', { class: 'map-scale', 'aria-hidden': 'true' }, ticks),
    readout,
    h('ul', { class: 'legend' }, legendItems.map(([k, label]) => h('li', null, h('span', { class: `swatch sw-${k}` }), label))));
}

function memberRow(model, ctx, row, pad, { inherited = false } = {}) {
  const base = ctx.prefs.base;
  const off = (n) => fmt(n, base, base === 'hex' ? pad : 0);
  if (row.kind === 'gap') {
    return h('tr', { class: `row-gap${inherited ? ' is-inherited' : ''}` },
      h('td', { class: 'c-off' }, off(row.start)),
      h('td', { class: 'c-size' }, fmt(row.size, base)),
      h('td', { class: 'c-gap', colspan: '2', title: 'Padding or native data that the dump does not describe' }, 'Unknown'));
  }
  const m = row.m;
  const isStatic = row.kind === 'static';
  const offText = off(m.offset) + (m.bit != null ? `:${m.bit}` : '');
  const nameText = m.name + (m.dim > 1 ? `[${m.dim}]` : '') + (m.bit != null ? ' : 1' : '');
  return h('tr', { class: `row-member${inherited ? ' is-inherited' : ''}${isStatic ? ' is-static' : ''}`, 'data-member': inherited ? null : m.name },
    h('td', { class: 'c-off' }, isStatic
      ? h('span', { class: 'muted' }, 'static')
      : h('button', { type: 'button', class: 'off-btn', title: 'Copy offset', onclick: () => copyText(off(m.offset), `Copied ${off(m.offset)}`) }, offText)),
    h('td', { class: 'c-size' }, m.bit != null ? '1 bit' : m.size > 0 ? fmt(m.size, base) : '?'),
    h('td', { class: 'c-type' }, typeView(model, m.type)),
    h('td', { class: 'c-name' }, nameText));
}

function membersTable(model, ctx, t, parentEnd, layout) {
  const base = ctx.prefs.base;
  const maxEnd = t.members.reduce((n, m) => Math.max(n, m.offset + m.size), t.size);
  const pad = hexPad(maxEnd);
  const range = (a, b) => `${fmt(a, base, base === 'hex' ? pad : 0)} to ${fmt(b, base, base === 'hex' ? pad : 0)}`;
  const tbody = h('tbody');
  const showInherited = ctx.prefs.inherited && t.parents.length > 0;

  if (t.parents.length) {
    if (showInherited) {
      for (const a of ancestorTypes(model, t)) {
        if (!a.type) {
          tbody.append(h('tr', { class: 'row-group' }, h('td', { colspan: '4' }, h('span', { class: 'group-name' }, a.name), h('span', { class: 'muted' }, 'not in this dump'))));
          continue;
        }
        const aEnd = parentEndOf(a.type, parentOf(model, a.type));
        tbody.append(h('tr', { class: 'row-group' }, h('td', { colspan: '4' },
          h('a', { class: 'tlink group-name', href: href({ hash: model.info.hash, tab: a.ref.kind, name: a.ref.key }) }, a.name),
          h('span', { class: 'muted' }, range(aEnd, a.type.size)))));
        for (const row of ownLayout(a.type, aEnd).rows) tbody.append(memberRow(model, ctx, row, pad, { inherited: true }));
      }
      tbody.append(h('tr', { class: 'row-group is-self' }, h('td', { colspan: '4' }, h('span', { class: 'group-name' }, t.name), h('span', { class: 'muted' }, t.size > 0 ? range(parentEnd, t.size) : 'own members'))));
    } else {
      const parentRef = resolveType(model, t.parents[0], t.kind === 'structs' ? 'S' : 'C');
      tbody.append(h('tr', { class: 'row-inherit' },
        h('td', { class: 'c-off' }, fmt(0, base, base === 'hex' ? pad : 0)),
        h('td', { class: 'c-size' }, parentEnd > 0 ? fmt(parentEnd, base) : '?'),
        h('td', { colspan: '2' },
          h('span', { class: 'muted' }, 'Inherited from '),
          parentRef ? h('a', { class: 'tlink', href: href({ hash: model.info.hash, tab: parentRef.kind, name: parentRef.key }) }, t.parents[0]) : h('span', null, t.parents[0]),
          h('button', { type: 'button', class: 'link-btn', onclick: () => { ctx.setPref('inherited', true); ctx.refresh(); } }, 'Show inherited members'))));
    }
  }
  for (const row of layout.rows) tbody.append(memberRow(model, ctx, row, pad));
  if (!layout.rows.length) tbody.append(h('tr', { class: 'row-empty' }, h('td', { colspan: '4' }, 'This type has no members of its own.')));

  return h('div', { class: 'table-wrap' }, h('table', { class: 'members' },
    h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'c-off' }, 'Offset'), h('th', { scope: 'col', class: 'c-size' }, 'Size'), h('th', { scope: 'col' }, 'Type'), h('th', { scope: 'col' }, 'Name'))),
    tbody));
}

function functionList(model, owner, fns, highlight) {
  return h('ul', { class: 'fn-list' }, fns.map((fn) => {
    const sig = h('code', { class: 'sig' });
    sig.append(typeView(model, fn.ret), ' ', h('span', { class: 'fn-name' }, fn.name), '(');
    fn.params.forEach((p, i) => {
      if (i) sig.append(', ');
      sig.append(typeView(model, p.type), p.ref ? h('span', { class: 'k-basic' }, p.ref) : '', p.name ? ` ${p.name}` : '');
    });
    sig.append(')');
    return h('li', { class: `fn${fn.name === highlight ? ' is-target' : ''}`, 'data-fn': fn.name },
      h('button', { type: 'button', class: 'off-btn addr', title: 'Copy address', onclick: () => copyText(hex(fn.address), `Copied ${hex(fn.address)}`) }, hex(fn.address)),
      sig,
      fn.flags.length ? h('div', { class: 'flags' }, fn.flags.map((f) => h('span', { class: 'flag' }, f))) : null);
  }));
}

export function renderTypeDetail(pane, model, route, ctx) {
  const kind = route.tab;
  const t = getType(model, kind, route.name);
  if (!t) return notFound(pane, model, route);
  const base = ctx.prefs.base;
  const parent = parentOf(model, t);
  const parentEnd = parentEndOf(t, parent);
  const layout = ownLayout(t, parentEnd);
  const word = kind === 'classes' ? 'class' : 'struct';
  const fns = model.functions.has(t.name) ? getFunctions(model, t.name) : [];
  const kids = childrenOf(model, kind, t.name);
  const unknown = layout.rows.reduce((n, r) => n + (r.kind === 'gap' ? r.size : 0), 0);

  const facts = [['Size', t.size > 0 ? fmt(t.size, base) : 'not in dump']];
  if (t.parents.length && parentEnd > 0) facts.push(['Inherited', fmt(parentEnd, base)]);
  facts.push(['Own members', t.members.length.toLocaleString('en-US')]);
  if (layout.sized) facts.push(['Unknown bytes', fmt(unknown, base)]);
  if (fns.length) facts.push(['Functions', fns.length.toLocaleString('en-US')]);

  const lineage = t.parents.length
    ? h('nav', { class: 'lineage', 'aria-label': 'Inheritance' },
      ancestorTypes(model, t).map((a) => [
        a.ref ? h('a', { class: 'tlink', href: href({ hash: model.info.hash, tab: a.ref.kind, name: a.ref.key }) }, a.name) : h('span', { class: 'is-unresolved' }, a.name),
        h('span', { class: 'lineage-sep', 'aria-hidden': 'true' }, '›'),
      ]),
      h('strong', null, t.name))
    : null;

  const cpp = () => linesToText(typeToCpp(t, word, parentEnd));
  const actions = [
    segmented('View', [['table', 'Members'], ['cpp', 'C++']], ctx.prefs.code ? 'cpp' : 'table', (v) => { ctx.setPref('code', v === 'cpp'); ctx.refresh(); }),
  ];
  if (t.parents.length && !ctx.prefs.code) actions.push(toggle('show-inherited', 'Show inherited members', ctx.prefs.inherited, (v) => { ctx.setPref('inherited', v); ctx.refresh(); }));
  actions.push(copyButton('Copy C++', cpp, 'Copied C++'));

  pane.append(head(model, { tab: kind, kindText: word, kindClass: `kind-${word}`, title: t.name, facts, lineage, actions }));

  let table = null;
  const pickMember = (name) => {
    if (ctx.prefs.code || !table) return;
    try {
      flash(table.querySelector(`tr[data-member="${CSS.escape(name)}"]`));
    } catch {
      /* ignore */
    }
  };
  if (layout.sized && t.size > 0) pane.append(layoutMap(model, ctx, t, parentEnd, layout, pickMember));
  else if (t.members.length) pane.append(h('p', { class: 'note' }, 'This dump has no size information for this type, so there is no layout map and no padding.'));

  if (ctx.prefs.code) pane.append(codeView(model, typeToCpp(t, word, parentEnd)));
  else {
    table = membersTable(model, ctx, t, parentEnd, layout);
    pane.append(table);
  }

  if (fns.length) {
    pane.append(section('Functions', fns.length,
      h('p', { class: 'd-hint' }, 'Addresses are relative to the module base. Select one to copy it.'),
      functionList(model, t.name, fns, null),
      h('p', null, h('a', { href: href({ hash: model.info.hash, tab: 'functions', name: t.name }) }, 'Open in the Functions tab'))));
  }

  if (kids.length) {
    const LIMIT = 60;
    const list = h('ul', { class: 'chips' });
    const fill = (all) => {
      list.replaceChildren(...(all ? kids : kids.slice(0, LIMIT)).map((k) => h('li', null, h('a', { class: 'chip-link', href: href({ hash: model.info.hash, tab: kind, name: k }) }, k))));
      if (!all && kids.length > LIMIT) list.append(h('li', null, h('button', { type: 'button', class: 'link-btn', onclick: () => fill(true) }, `Show all ${kids.length.toLocaleString('en-US')}`)));
    };
    fill(false);
    pane.append(section(`Types that inherit from ${t.name}`, kids.length, list));
  }

  focusTarget(pane, 'data-member', route.member);
}

// ---------------------------------------------------------------- enum

export function renderEnumDetail(pane, model, route, ctx) {
  const en = getEnum(model, route.name);
  if (!en) return notFound(pane, model, route);
  const base = ctx.prefs.base;
  const facts = [['Underlying type', en.underlying || '?'], ['Values', en.values.length.toLocaleString('en-US')]];
  if (en.values.length) {
    const lo = en.values.reduce((n, v) => Math.min(n, v.value), Infinity);
    const hi = en.values.reduce((n, v) => Math.max(n, v.value), -Infinity);
    facts.push(['Range', `${lo} to ${hi}`]);
  }
  const cpp = () => linesToText(enumToCpp(en.name, en));
  pane.append(head(model, {
    tab: 'enums', kindText: 'enum', kindClass: 'kind-enum', title: en.name, facts,
    actions: [
      segmented('View', [['table', 'Values'], ['cpp', 'C++']], ctx.prefs.code ? 'cpp' : 'table', (v) => { ctx.setPref('code', v === 'cpp'); ctx.refresh(); }),
      copyButton('Copy C++', cpp, 'Copied C++'),
    ],
  }));
  if (ctx.prefs.code) {
    pane.append(codeView(model, enumToCpp(en.name, en)));
    return;
  }
  const other = base === 'hex' ? 'dec' : 'hex';
  const tbody = h('tbody', null, en.values.map((v) => h('tr', { class: 'row-member', 'data-member': v.name },
    h('td', { class: 'c-name' }, v.name),
    h('td', { class: 'c-off' }, h('button', { type: 'button', class: 'off-btn', title: 'Copy value', onclick: () => copyText(fmt(v.value, base), `Copied ${fmt(v.value, base)}`) }, fmt(v.value, base))),
    h('td', { class: 'c-size' }, fmt(v.value, other)))));
  if (!en.values.length) tbody.append(h('tr', { class: 'row-empty' }, h('td', { colspan: '3' }, 'This enum has no values.')));
  pane.append(h('div', { class: 'table-wrap' }, h('table', { class: 'members enum-table' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Name'), h('th', { scope: 'col', class: 'c-off' }, base === 'hex' ? 'Hex' : 'Value'), h('th', { scope: 'col', class: 'c-size' }, base === 'hex' ? 'Value' : 'Hex'))),
    tbody)));
  focusTarget(pane, 'data-member', route.member);
}

// ---------------------------------------------------------------- functions of one type

export function renderFunctionsDetail(pane, model, route, ctx) {
  if (!model.functions.has(route.name)) return notFound(pane, model, route);
  const fns = getFunctions(model, route.name);
  const ref = resolveType(model, route.name, 'C');
  const facts = [['Functions', fns.length.toLocaleString('en-US')]];
  const cpp = () => linesToText(functionsToCpp(route.name, fns));
  const actions = [copyButton('Copy C++', cpp, 'Copied C++')];
  if (ref && ref.kind !== 'enums') actions.unshift(h('a', { class: 'btn btn-small', href: href({ hash: model.info.hash, tab: ref.kind, name: ref.key }) }, `Open ${ref.kind === 'classes' ? 'class' : 'struct'}`));
  pane.append(head(model, { tab: 'functions', kindText: 'functions', kindClass: 'kind-function', title: route.name, facts, actions }));

  const listHost = h('div');
  if (fns.length > 12) {
    const input = h('input', { type: 'search', id: 'fn-filter', class: 'input', placeholder: 'Filter functions', 'aria-label': 'Filter functions' });
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      listHost.replaceChildren(functionList(model, route.name, q ? fns.filter((f) => f.name.toLowerCase().includes(q)) : fns, route.member));
    });
    pane.append(h('div', { class: 'd-tools' }, input));
  }
  pane.append(h('p', { class: 'd-hint' }, 'Addresses are relative to the module base. Select one to copy it.'));
  listHost.append(functionList(model, route.name, fns, route.member));
  pane.append(listHost);
  focusTarget(pane, 'data-fn', route.member);
}

export function renderEmptyDetail(pane, model, tab) {
  const text = {
    classes: 'Pick a class to see its members, its memory layout and its functions.',
    structs: 'Pick a struct to see its members and its memory layout.',
    enums: 'Pick an enum to see its values.',
    functions: 'Pick a type to see its functions and their addresses.',
  }[tab];
  const count = model.names[tab].length;
  pane.append(h('div', { class: 'empty' },
    h('p', { class: 'empty-title' }, count ? text : `This dump has no ${TAB_LABEL[tab].toLowerCase()}.`),
    count ? h('p', { class: 'muted' }, 'Press / to search every type, member and function at once.') : null));
}
