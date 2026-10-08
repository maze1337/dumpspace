// The game overview and the global offsets page.
import { h, icon, copyText, store } from './dom.js';
import { resolveType } from './data.js';
import { fmt, hex, plural, engineLabel, relativeTime, offsetsToCpp, linesToText } from './format.js';
import { href } from './routes.js';

const CORE_TYPES = [
  'UObject', 'UClass', 'UWorld', 'ULevel', 'UGameInstance', 'ULocalPlayer', 'APlayerController',
  'APawn', 'ACharacter', 'AActor', 'APlayerState', 'AGameStateBase', 'USceneComponent',
  'MonoBehaviour', 'Component', 'GameObject', 'Transform', 'Camera',
];

function dateText(ms) {
  return `${new Date(ms).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}, ${relativeTime(ms)}`;
}

function externalLink(text, url) {
  return /^https?:\/\//i.test(url || '') ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : text;
}

function typeChips(model, names) {
  return h('ul', { class: 'chips' }, names.map(({ tab, name }) => h('li', null,
    h('a', { class: `chip-link chip-${tab}`, href: href({ hash: model.info.hash, tab, name }) }, name))));
}

function offsetsTable(model, rows) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'members offsets-table' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Name'), h('th', { scope: 'col', class: 'c-off' }, 'Value'), h('th', { scope: 'col', class: 'c-size' }, 'Decimal'))),
    h('tbody', null, rows.map((o) => h('tr', { class: 'row-member' },
      h('td', { class: 'c-name' }, o.name),
      h('td', { class: 'c-off' }, h('button', { type: 'button', class: 'off-btn', title: 'Copy value', onclick: () => copyText(hex(o.value), `Copied ${hex(o.value)}`) }, hex(o.value))),
      h('td', { class: 'c-size' }, String(o.value))))),
  ));
}

export function renderOverview(host, model, ctx) {
  const info = model.info;
  const base = ctx.prefs.base;
  const updated = model.updatedAt || info.uploaded;
  const facts = [['Engine', info.local ? 'Opened from this computer' : engineLabel(info.engine)]];
  if (updated) facts.push(['Updated', dateText(updated)]);
  if (model.credit && model.credit.dumper_used) facts.push(['Dumped with', externalLink(String(model.credit.dumper_used), model.credit.dumper_link)]);
  if (info.uploader && info.uploader.name) facts.push(['Added by', externalLink(info.uploader.name, info.uploader.link)]);
  if (model.version) facts.push(['Format version', String(model.version)]);

  const page = h('div', { class: 'page' });
  page.append(h('header', { class: 'page-head' },
    h('h1', { class: 'page-title' }, info.name),
    info.sample ? h('p', { class: 'note' }, 'This is made-up sample data that shows how a dump looks. Remove it with tools/games.mjs once you have added your own games.') : null,
    h('dl', { class: 'd-facts' }, facts.map(([k, v]) => h('div', { class: 'fact' }, h('dt', null, k), h('dd', null, v))))));

  if (model.missing.length) {
    page.append(h('p', { class: 'note' }, `Missing from this dump: ${model.missing.join(', ')}. The matching tabs are empty.`));
  }

  const core = CORE_TYPES.map((name) => {
    const ref = resolveType(model, name, 'C');
    return ref && ref.kind !== 'enums' ? { tab: ref.kind, name: ref.key } : null;
  }).filter(Boolean);
  const recent = info.local ? [] : store.get(`oa.recent.${info.hash}`, []).filter((r) => r && model[r.tab] && model[r.tab].has(r.name)).slice(0, 8);

  const columns = h('div', { class: 'ov-grid' });
  const left = h('div', { class: 'ov-col' });
  const right = h('div', { class: 'ov-col' });
  columns.append(left, right);

  if (recent.length) {
    left.append(h('section', { class: 'd-section' }, h('h2', { class: 'd-h2' }, 'Recently viewed'), typeChips(model, recent)));
  }
  if (core.length) {
    left.append(h('section', { class: 'd-section' },
      h('h2', { class: 'd-h2' }, 'Core types'),
      h('p', { class: 'd-hint' }, 'Engine types that most other classes build on. A good place to start.'),
      typeChips(model, core)));
  }

  // Largest classes and structs, drawn to scale.
  const sized = [];
  for (const tab of ['classes', 'structs']) for (const [key, e] of model[tab]) if (e.size > 0) sized.push({ tab, key, size: e.size });
  sized.sort((a, b) => b.size - a.size);
  const top = sized.slice(0, 10);
  if (top.length) {
    const max = top[0].size;
    left.append(h('section', { class: 'd-section' },
      h('h2', { class: 'd-h2' }, 'Largest types'),
      h('p', { class: 'd-hint' }, 'Size in bytes, bars drawn to the same scale.'),
      h('ol', { class: 'bars' }, top.map((t) => h('li', { class: 'bar-row' },
        h('a', { class: `bar-name chip-${t.tab}`, href: href({ hash: info.hash, tab: t.tab, name: t.key }) }, t.key),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: `bar-fill fill-${t.tab}`, style: { width: `${Math.max(1, (t.size / max) * 100)}%` } })),
        h('span', { class: 'bar-value' }, fmt(t.size, base)))))));
  }

  const offsetRows = model.offsets.filter((o) => typeof o.value === 'number');
  right.append(h('section', { class: 'd-section' },
    h('h2', { class: 'd-h2' }, 'Global offsets', h('span', { class: 'count' }, String(offsetRows.length))),
    offsetRows.length
      ? [offsetsTable(model, offsetRows.slice(0, 10)), offsetRows.length > 10 ? h('p', null, h('a', { href: href({ hash: info.hash, tab: 'offsets' }) }, `All ${offsetRows.length} offsets`)) : null]
      : h('p', { class: 'muted' }, 'This dump has no global offsets.')));

  right.append(h('section', { class: 'd-section' },
    h('h2', { class: 'd-h2' }, 'In this dump'),
    h('ul', { class: 'stat-list' },
      [['classes', 'class', 'classes'], ['structs', 'struct', 'structs'], ['functions', 'type with functions', 'types with functions'], ['enums', 'enum', 'enums']]
        .map(([tab, one, many]) => h('li', null, h('a', { href: href({ hash: info.hash, tab }) }, plural(model.names[tab].length, one, many)))))));

  page.append(columns);
  host.append(page);
}

export function renderOffsets(host, model) {
  const rows = model.offsets.filter((o) => typeof o.value === 'number');
  const page = h('div', { class: 'page' });
  const cpp = () => linesToText(offsetsToCpp(rows));
  page.append(h('header', { class: 'page-head' },
    h('h1', { class: 'page-title' }, 'Offsets'),
    h('p', { class: 'page-lede' }, 'Global offsets from OffsetsInfo. Addresses are relative to the module base; INDEX values are virtual table indexes.'),
    rows.length ? h('div', { class: 'd-actions' }, h('button', { type: 'button', class: 'btn btn-small', onclick: () => copyText(cpp(), 'Copied C++') }, icon('copy', 16), 'Copy C++')) : null));
  page.append(rows.length ? offsetsTable(model, rows) : h('p', { class: 'muted' }, 'This dump has no global offsets.'));
  if (model.credit && model.credit.dumper_used) {
    page.append(h('p', { class: 'd-hint' }, 'Dumped with ', externalLink(String(model.credit.dumper_used), model.credit.dumper_link), '.'));
  }
  host.append(page);
}
