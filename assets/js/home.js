// Home: the list of games and opening dumps from this computer.
import { h, icon } from './dom.js';
import { CONFIG } from './config.js';
import { loadGameList } from './data.js';
import { engineLabel, engineShort, relativeTime, plural } from './format.js';
import { href } from './routes.js';
import { brand, themeToggle } from './chrome.js';

const homeState = { q: '', engine: 'all', sort: 'updated' };

function initials(name) {
  const words = String(name).replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function countsText(c) {
  if (!c) return null;
  const parts = [];
  if (c.classes != null) parts.push(plural(c.classes, 'class', 'classes'));
  if (c.structs != null) parts.push(plural(c.structs, 'struct'));
  if (c.enums != null) parts.push(plural(c.enums, 'enum'));
  return parts.length ? parts.join(', ') : null;
}

function gameRow(g) {
  const badges = [];
  if (g.sample) badges.push(h('span', { class: 'badge' }, 'Sample'));
  if (g.local) badges.push(h('span', { class: 'badge badge-local' }, 'Local'));
  const when = g.uploaded ? relativeTime(g.uploaded) : '';
  return h('li', null, h('a', { class: 'game-row', href: href({ hash: g.hash }) },
    h('span', { class: 'game-mono', 'aria-hidden': 'true' }, h('span', { class: 'mono-letters' }, initials(g.name)), h('span', { class: 'mono-engine' }, g.local ? 'Local' : engineShort(g.engine))),
    h('span', { class: 'game-main' },
      h('span', { class: 'game-name' }, h('span', null, g.name), badges),
      h('span', { class: 'game-sub' },
        h('span', null, g.local ? `Opened from this computer, ${plural(g.fileCount || 0, 'file')}` : engineLabel(g.engine)),
        countsText(g.counts) ? h('span', null, countsText(g.counts)) : null)),
    h('span', { class: 'game-meta' },
      when ? h('span', null, g.local ? `Opened ${when}` : `Updated ${when}`) : null,
      g.uploader && g.uploader.name ? h('span', { class: 'muted' }, `by ${g.uploader.name}`) : null),
    h('span', { class: 'game-go', 'aria-hidden': 'true' }, icon('next', 18))));
}

function renderList(host, games, error) {
  const engines = [...new Set(games.map((g) => (g.local ? 'Local' : g.engine)))].sort();
  const search = h('input', { type: 'search', id: 'game-filter', class: 'input', placeholder: 'Filter games', 'aria-label': 'Filter games', autocomplete: 'off' });
  search.value = homeState.q;
  const sort = h('select', { id: 'game-sort', class: 'select', 'aria-label': 'Sort games' },
    [['updated', 'Recently updated'], ['name', 'Name']].map(([v, t]) => h('option', { value: v, selected: v === homeState.sort || null }, t)));
  const filters = h('div', { class: 'segmented engine-filter', role: 'group', 'aria-label': 'Engine' });
  const list = h('ul', { class: 'game-list' });
  const count = h('span', { class: 'count' });

  const draw = () => {
    const q = homeState.q.trim().toLowerCase();
    let shown = games.filter((g) => (homeState.engine === 'all' || (g.local ? 'Local' : g.engine) === homeState.engine)
      && (!q || g.name.toLowerCase().includes(q)));
    shown = shown.slice().sort(homeState.sort === 'name'
      ? (a, b) => a.name.localeCompare(b.name)
      : (a, b) => (b.local - a.local) || (b.uploaded - a.uploaded));
    count.textContent = String(games.length);
    filters.replaceChildren(...[['all', 'All'], ...engines.map((e) => [e, e === 'Local' ? 'Local' : engineShort(e)])].map(([v, t]) => h('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(homeState.engine === v),
      onclick: () => { homeState.engine = v; draw(); },
    }, t)));
    if (!games.length) {
      list.replaceChildren(h('li', { class: 'empty' },
        h('p', { class: 'empty-title' }, error ? 'The game list could not be loaded.' : 'No games yet.'),
        h('p', { class: 'muted' }, error
          ? `${CONFIG.gameList} is missing or invalid (${error.message}). Add a game with tools/games.mjs, or open dump files above.`
          : 'Add a game with tools/games.mjs, or open dump files from your computer above.')));
      return;
    }
    list.replaceChildren(...(shown.length ? shown.map(gameRow) : [h('li', { class: 'empty' }, h('p', { class: 'muted' }, 'No games match this filter.'))]));
  };

  search.addEventListener('input', () => { homeState.q = search.value; draw(); });
  sort.addEventListener('change', () => { homeState.sort = sort.value; draw(); });

  host.replaceChildren(
    h('div', { class: 'games-head' },
      h('h2', { class: 'games-title', id: 'games-title' }, 'Games', count),
      h('div', { class: 'games-tools' }, filters, search, sort)),
    list);
  draw();
}

export async function renderHome(root, ctx) {
  document.title = CONFIG.siteName;
  const files = h('input', { type: 'file', id: 'open-files', class: 'visually-hidden', multiple: true, accept: '.json,.gz', tabindex: '-1', 'aria-hidden': 'true' });
  const folder = h('input', { type: 'file', id: 'open-folder', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
  folder.webkitdirectory = true;
  files.addEventListener('change', () => { ctx.openLocal([...files.files]); files.value = ''; });
  folder.addEventListener('change', () => { ctx.openLocal([...folder.files]); folder.value = ''; });
  const canPickFolder = 'webkitdirectory' in folder && typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

  const gamesSection = h('section', { class: 'games', 'aria-labelledby': 'games-title' },
    h('p', { class: 'muted' }, 'Loading games…'));

  const page = h('div', { class: 'home' },
    h('header', { class: 'topbar' }, brand(), h('div', { class: 'topbar-spacer' }), themeToggle()),
    h('main', { class: 'home-main', id: 'main' },
      h('section', { class: 'intro' },
        h('h1', { class: 'intro-title' }, CONFIG.tagline),
        h('p', { class: 'intro-text' }, 'Browse the classes, structs, functions, enums and offsets in SDK dumps of your own games. Every type shows a map of where its members sit in memory, which bytes it inherits and which bytes nothing describes.'),
        h('div', { class: 'intro-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => files.click() }, icon('file', 18), 'Open dump files'),
          canPickFolder ? h('button', { type: 'button', class: 'btn', onclick: () => folder.click() }, icon('folder', 18), 'Open dump folder') : null,
          files, folder),
        h('p', { class: 'intro-note' }, 'Pick the five files from a Dumper-7 or UEDumper "Dumpspace" folder, or drop them on this page. They are read in this browser and never uploaded.')),
      gamesSection),
    h('footer', { class: 'footer' },
      h('p', null, `${CONFIG.siteName} reads the Dumpspace JSON format (ClassesInfo, StructsInfo, FunctionsInfo, EnumsInfo and OffsetsInfo).`),
      CONFIG.repoUrl ? h('p', null, h('a', { href: CONFIG.repoUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Source and setup guide')) : null));
  root.replaceChildren(page);

  const { games, error } = await loadGameList();
  if (!document.contains(gamesSection)) return;
  renderList(gamesSection, games, error);
}
